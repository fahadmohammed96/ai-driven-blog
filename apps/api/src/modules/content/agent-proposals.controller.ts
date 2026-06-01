import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { DB, LLM } from "../../platform/tokens";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { HashingEmbedder } from "../../platform/ai/embedder";
import { retrieveSimilar } from "../../platform/ai/rag";
import { createLlmPortFromEnv } from "../../platform/ai/llm";
import { PostgresMeteringService } from "../../platform/ai/metering";
import { TwoLevelBudgetGuard, BudgetExceededError } from "../../platform/ai/budget-guard";
import { PostgresAgentRunStore } from "../../platform/ai/agent-run-store";
import { WriterAgent } from "../../platform/ai/agents/writer-agent";
import type { BrandVoice } from "../../platform/ai/pipeline";
import { TenancyService } from "../tenancy";
import { getTenantSettings } from "../settings";
import { InvalidTransitionError } from "./state-machine";
import { ContentNotFoundError } from "./content.repo";
import {
  PostgresAgentProposalStore,
  ProposalNotFoundError,
  ProposalNotPendingError,
  type StagedProposal,
} from "./agent-proposal-store";

/**
 * "Code proposte" agentic surface (Slice T1). The Writer (and every later agent)
 * stages its `Proposal<T>` in `agent_proposals`; this controller is the human
 * gate: it lists pending proposals WITH the budget headroom they will spend
 * against, the agent's reasoning trace and definition version, and approves /
 * rejects them. Approve injects the payload into the existing Phase-1 publication
 * state machine — nothing is ever published automatically (ADR-0020).
 *
 * Wiring lives here rather than in `infra.module` so the agentic path composes
 * `metered(stub|anthropic)` + the run-audit store WITHOUT disturbing the legacy
 * `generateDraft`/travel `LLM` token (DEBT-022/023 continue). See DEBT-025.
 */

const DEFAULT_VOICE: BrandVoice = {
  tone: "personale e curioso",
  audience: "viaggiatori indipendenti",
};

interface ProposalView {
  id: string;
  agentName: string;
  type: string;
  status: string;
  estimatedCostUsd: number;
  tokensUsed: StagedProposal["tokensUsed"];
  agentDefinitionVersion: string;
  rationale: string;
  title: string;
  draftPreview: string;
  reasoning: { name: string; input: unknown }[];
  researchContext: unknown | null;
  createdAt: Date;
}

@Controller("agent-proposals")
export class AgentProposalsController {
  private readonly proposals: PostgresAgentProposalStore;
  private readonly metering: PostgresMeteringService;
  private readonly budget: TwoLevelBudgetGuard;
  private readonly writer: WriterAgent;

  constructor(
    @Inject(DB) private readonly db: Db,
    // The legacy LLM token is injected only to keep DI order stable; the agentic
    // path builds its own metered LlmPort below.
    @Inject(LLM) _legacyLlm: unknown,
    private readonly tenancy: TenancyService,
  ) {
    this.proposals = new PostgresAgentProposalStore(db);
    this.metering = new PostgresMeteringService(db);
    this.budget = new TwoLevelBudgetGuard({
      metering: this.metering,
      resolveBudgetUsd: (tenantId) =>
        withTenant(db, tenantId, (tx) => getTenantSettings(tx)).then((s) => s.budgetUsdMonthly),
    });
    // Metered port: budget pre-check + synchronous spend recording around every
    // round-trip. Stub (zero-cost) when ANTHROPIC_API_KEY is absent (CI/E2E).
    const llm = createLlmPortFromEnv({ metering: this.metering, budget: this.budget });
    const embedder = new HashingEmbedder();
    this.writer = new WriterAgent({
      llm,
      accessors: {
        embed: (text) => embedder.embed(text),
        retrieve: (tenantId, embedding, k) => retrieveSimilar(db, tenantId, embedding, k),
      },
      store: new PostgresAgentRunStore(db),
      budget: this.budget,
    });
  }

  private get tenantId(): string {
    return this.tenancy.current().tenantId;
  }

  /**
   * Agentic Writer entrypoint (resolves the DEBT-022 sink): run the Writer with
   * the real run-audit store + budget, then STAGE its proposal in
   * `agent_proposals` (`pending`) instead of writing the draft directly. The
   * human approves it on the queue before anything reaches `content_items`.
   */
  @Post("generate")
  @HttpCode(201)
  async generate(
    @Body() body: { brief?: unknown; title?: unknown } | undefined,
  ): Promise<{ id: string; status: string }> {
    const brief = body?.brief;
    if (typeof brief !== "string" || !brief.trim()) {
      throw new BadRequestException("brief is required");
    }
    const title = typeof body?.title === "string" ? body.title : undefined;
    try {
      const proposal = await this.writer.run(
        { brief, voice: DEFAULT_VOICE },
        { tenantId: this.tenantId },
      );
      // Fold the human-facing title into the staged payload so approval can mint
      // a content item without re-deriving it (the Writer payload is text-only).
      const payload = { ...(proposal.payload as object), ...(title ? { title } : {}) };
      await this.proposals.persist({ ...proposal, payload });
      return { id: proposal.id, status: proposal.status };
    } catch (err) {
      if (err instanceof BudgetExceededError) throw new ConflictException(err.message);
      throw err;
    }
  }

  @Get()
  async list(): Promise<{ tenantBudgetResiduoUsd: number; proposals: ProposalView[] }> {
    const tenantId = this.tenantId;
    const [rows, settings, spent] = await Promise.all([
      this.proposals.listPending(tenantId),
      withTenant(this.db, tenantId, (tx) => getTenantSettings(tx)),
      this.metering.monthlySpendUsd(tenantId),
    ]);
    // Budget headroom shown at the gate (critica #13): cap − spent this month.
    const tenantBudgetResiduoUsd = round6(settings.budgetUsdMonthly - spent);
    // Audit policy enforcement (Slice T2): under `obbligatorio` a proposal whose
    // run was NOT audited (`auditRecorded=false`, the best-effort write degraded)
    // is withheld from the queue — no audit, no review (ADR-0020 accountability).
    // `best-effort` shows it anyway. Default is strict.
    const visible =
      settings.auditPolicy === "obbligatorio"
        ? rows.filter((r) => r.auditRecorded)
        : rows;
    return { tenantBudgetResiduoUsd, proposals: visible.map(toView) };
  }

  @Post(":id/approve")
  @HttpCode(200)
  async approve(@Param("id") id: string): Promise<{ id: string; status: string }> {
    try {
      const item = await this.proposals.approve(this.tenantId, id);
      return { id: item.id, status: item.status };
    } catch (err) {
      throw mapError(err);
    }
  }

  @Post(":id/reject")
  @HttpCode(200)
  async reject(@Param("id") id: string): Promise<{ ok: true }> {
    try {
      await this.proposals.reject(this.tenantId, id);
      return { ok: true };
    } catch (err) {
      throw mapError(err);
    }
  }
}

function toView(p: StagedProposal): ProposalView {
  const payload = (p.payload ?? {}) as { draft?: string; title?: string };
  const draft = typeof payload.draft === "string" ? payload.draft : "";
  return {
    id: p.id,
    agentName: p.agentName,
    type: p.type,
    status: p.status,
    estimatedCostUsd: p.estimatedCostUsd,
    tokensUsed: p.tokensUsed,
    agentDefinitionVersion: p.agentDefinitionVersion,
    rationale: p.rationale,
    title: payload.title?.trim() || draft.split("\n").map((l) => l.trim()).find(Boolean) || "Bozza AI",
    draftPreview: draft.slice(0, 280),
    reasoning: p.toolCalls.map((c) => ({ name: c.name, input: c.input })),
    researchContext: p.researchContext,
    createdAt: p.createdAt,
  };
}

function mapError(err: unknown): Error {
  if (err instanceof ProposalNotFoundError) return new NotFoundException();
  if (err instanceof ProposalNotPendingError) return new ConflictException(err.message);
  if (err instanceof ContentNotFoundError) return new NotFoundException();
  if (err instanceof InvalidTransitionError) return new ConflictException(err.message);
  return err as Error;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
