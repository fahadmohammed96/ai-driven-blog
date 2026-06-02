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
import { DB, LLM, EMAIL_DRAFT_SINK } from "../../platform/tokens";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { HashingEmbedder } from "../../platform/ai/embedder";
import { retrieveSimilar } from "../../platform/ai/rag";
import { createProviderRegistryFromEnv } from "../../platform/ai/provider-registry";
import { PostgresMeteringService } from "../../platform/ai/metering";
import { TwoLevelBudgetGuard, BudgetExceededError } from "../../platform/ai/budget-guard";
import { PostgresAgentRunStore } from "../../platform/ai/agent-run-store";
import { WriterAgent } from "../../platform/ai/agents/writer-agent";
import { ResearcherAgent } from "../../platform/ai/agents/researcher-agent";
import { STUB_SEARCH_SOURCES } from "../../platform/ai/agents/tools/search-sources";
import type { ResearchBrief } from "@blogs/contracts";
import type { BrandVoice } from "../../platform/ai/pipeline";
import { TenancyService } from "../tenancy";
import { getTenantSettings } from "../settings";
import { InvalidTransitionError } from "./state-machine";
import { ContentNotFoundError } from "./content.repo";
import {
  PostgresAgentProposalStore,
  ProposalNotFoundError,
  ProposalNotPendingError,
  type EmailDraftSink,
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
  /**
   * The Researcher (Slice X1). Built with the SAME BYOK-aware provider + run-audit
   * store + budget as the Writer (its runs are metered/budgeted too). It is RUN
   * only when the tenant's `externalResearch` flag is on (see `generate`); its
   * external `searchSources` tool is the deterministic offline stub (DEBT-034).
   */
  private readonly researcher: ResearcherAgent;

  constructor(
    @Inject(DB) private readonly db: Db,
    // The legacy LLM token is injected only to keep DI order stable; the agentic
    // path builds its own metered LlmPort below.
    @Inject(LLM) _legacyLlm: unknown,
    // The email_draft gate sink (built in InfraModule), so approving an email
    // proposal from the unified queue sends to the segment — without this module
    // importing modules/email. Other proposal types have no external sink.
    @Inject(EMAIL_DRAFT_SINK) emailSink: EmailDraftSink,
    private readonly tenancy: TenancyService,
  ) {
    this.proposals = new PostgresAgentProposalStore(db, { emailSink });
    this.metering = new PostgresMeteringService(db);
    this.budget = new TwoLevelBudgetGuard({
      metering: this.metering,
      resolveBudgetUsd: (tenantId) =>
        withTenant(db, tenantId, (tx) => getTenantSettings(tx)).then((s) => s.budgetUsdMonthly),
    });
    // BYOK-aware metered LlmPort source (DEBT-023/025): the per-tenant Anthropic
    // key when present, else the platform key — and the zero-cost stub when there
    // is no key at all (CI/E2E). Budget pre-check + synchronous metering wrap every
    // round-trip, exactly as the previous createLlmPortFromEnv composition did.
    const provider = createProviderRegistryFromEnv(db, {
      metering: this.metering,
      budget: this.budget,
    });
    const embedder = new HashingEmbedder();
    const runStore = new PostgresAgentRunStore(db);
    this.writer = new WriterAgent({
      provider,
      accessors: {
        embed: (text) => embedder.embed(text),
        retrieve: (tenantId, embedding, k) => retrieveSimilar(db, tenantId, embedding, k),
      },
      store: runStore,
      budget: this.budget,
    });
    this.researcher = new ResearcherAgent({
      provider,
      accessors: {
        embed: (text) => embedder.embed(text),
        retrieve: (tenantId, embedding, k) => retrieveSimilar(db, tenantId, embedding, k),
        // External SERP is the deterministic offline stub at the boundary (DEBT-034):
        // no network, no key, zero cost in CI/E2E.
        searchSources: STUB_SEARCH_SOURCES,
      },
      store: runStore,
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
    const tenantId = this.tenantId;
    try {
      // Slice X1: when the tenant opted into external research, run the Researcher
      // FIRST and enrich the Writer with its ephemeral brief. With the flag OFF
      // the Researcher never runs and `researchContext` stays absent — the path is
      // byte-for-byte the previous Writer-only flow (cost-zero invariant).
      // NOTE: no `itineraryId` is forwarded to the Researcher here — this entrypoint
      // does NOT wire the `getItinerary`/`getMediaForStop` accessors, so it was dead
      // input (the Researcher's itinerary branch never fired). Cabling those
      // accessors is the travel-controller migration → DEBT-035.
      const settings = await withTenant(this.db, tenantId, (tx) => getTenantSettings(tx));
      let researchContext: ResearchBrief | undefined;
      if (settings.externalResearch.enabled) {
        researchContext = await this.researcher.run(
          { topic: brief, externalEnabled: true },
          { tenantId },
        );
      }

      // FIX 1 (X1 review): fold the research dimension into the Writer's idempotency
      // subject. The Writer's default subjectId is the brief alone, so a re-run with
      // the same brief/day but the flag flipped OFF→ON would share the flag-OFF
      // taskId and REPLAY the un-enriched proposal — the tenant pays the Researcher
      // but the enriched draft is discarded and `research_context` is built on a
      // stale run. Keying on the flag forks the run so ON yields a fresh, enriched
      // draft (idempotency-replay class, lezioni S1/S2).
      const subjectId = `${brief}|research:${settings.externalResearch.enabled}`;
      const proposal = await this.writer.run(
        { brief, voice: DEFAULT_VOICE, subjectId, ...(researchContext ? { researchContext } : {}) },
        { tenantId },
      );
      // Fold the human-facing title into the staged payload so approval can mint
      // a content item without re-deriving it (the Writer payload is text-only).
      const payload = { ...(proposal.payload as object), ...(title ? { title } : {}) };
      // Lay the brief onto the staged proposal for the human gate (critica #14);
      // the store persists `research_context` only when present.
      await this.proposals.persist({
        ...proposal,
        payload,
        ...(researchContext ? { researchContext } : {}),
      });
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
