import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Inject,
  Post,
} from "@nestjs/common";
import type { Block, BrandVoice } from "@blogs/contracts";
import { DB, LLM } from "../../platform/tokens";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { HashingEmbedder } from "../../platform/ai/embedder";
import { retrieveSimilar } from "../../platform/ai/rag";
import { createProviderRegistryFromEnv } from "../../platform/ai/provider-registry";
import { PostgresMeteringService } from "../../platform/ai/metering";
import { TwoLevelBudgetGuard, BudgetExceededError } from "../../platform/ai/budget-guard";
import { PostgresAgentRunStore } from "../../platform/ai/agent-run-store";
import { WriterAgent } from "../../platform/ai/agents/writer-agent";
import { OrchestratorAgent } from "../../platform/ai/agents/orchestrator-agent";
import { TenancyService } from "../tenancy";
import { getTenantSettings } from "../settings";
import { listContentItems, PostgresAgentProposalStore } from "../content";
// Sub-agents bound at the composition root via their PUBLIC barrels (the arch
// boundary allows barrel imports; this controller is the binding point — CRUX 1).
import {
  SeoAgent,
  makeInternalLinkCandidatesAccessor,
  makeExistingContentAccessor,
} from "../seo";
import { AnalystAgent, AnalyticsService, createAnalyticsSources } from "../analytics";
import { listTrips } from "../commerce";

/**
 * Editorial Orchestrator entrypoint (Slice O3). Runs the Orchestrator — the ONE
 * agent that calls Writer/SEO/Analyst as TOOLS (flat, centralized) — and STAGES
 * its `Proposal<EditorialPlan>` in `agent_proposals` (`pending`). Approval flows
 * through the existing `/agent-proposals/:id/approve` gate, whose `editorial_plan`
 * branch is ACKNOWLEDGE-ONLY — nothing is published, mutated, or auto-dispatched
 * (propose-only preserved; the autonomy engine is DEBT-041).
 *
 * COMPOSITION ROOT (CRUX 1): the kernel `OrchestratorAgent` never imports
 * `modules/*`. Here — a module that imports only public barrels — the concrete
 * sub-agents are built (each with the SAME BYOK-aware metered port + run-audit
 * store + the SHARED budget guard, so the guard re-reads DB spend before EACH
 * sub-run — CRUX 2) and injected as the Orchestrator's `runWriter`/`runSeo`/
 * `runAnalyst` dispatches.
 *
 * SCOPE NOTE (DEBT-041): this baseline endpoint is SYNCHRONOUS; scheduled/batch
 * plans will travel over pg-boss (O0). Social/Email are NOT orchestrated yet
 * (the plan lists Writer/SEO/Analyst); the SEO sub-run optimizes the tenant's
 * most recent content item (or notes there is none).
 */

const DEFAULT_VOICE: BrandVoice = {
  tone: "personale e curioso",
  audience: "viaggiatori indipendenti",
};

@Controller("orchestrator")
export class OrchestratorController {
  private readonly proposals: PostgresAgentProposalStore;
  private readonly agent: OrchestratorAgent;

  constructor(
    @Inject(DB) db: Db,
    // Legacy LLM token injected only to keep DI order stable (as in the other
    // agentic staging controllers); the agentic path builds its own metered port.
    @Inject(LLM) _legacyLlm: unknown,
    private readonly tenancy: TenancyService,
  ) {
    this.proposals = new PostgresAgentProposalStore(db);
    const metering = new PostgresMeteringService(db);
    const budget = new TwoLevelBudgetGuard({
      metering,
      resolveBudgetUsd: (tenantId) =>
        withTenant(db, tenantId, (tx) => getTenantSettings(tx)).then((s) => s.budgetUsdMonthly),
    });
    const provider = createProviderRegistryFromEnv(db, { metering, budget });
    const runStore = new PostgresAgentRunStore(db);
    const embedder = new HashingEmbedder();

    // Sub-agents — each metered + budgeted with the SHARED guard (re-read per run).
    const writer = new WriterAgent({
      provider,
      accessors: {
        embed: (text) => embedder.embed(text),
        retrieve: (tenantId, embedding, k) => retrieveSimilar(db, tenantId, embedding, k),
      },
      store: runStore,
      budget,
    });
    const seo = new SeoAgent({
      provider,
      accessors: {
        internalLinkCandidates: makeInternalLinkCandidatesAccessor(db),
        existingContent: makeExistingContentAccessor(db),
      },
      store: runStore,
      budget,
    });
    const analytics = new AnalyticsService(db, createAnalyticsSources());
    const analyst = new AnalystAgent({
      provider,
      accessors: { dashboard: (tenantId) => analytics.getDashboard(tenantId) },
      store: runStore,
      budget,
    });

    this.agent = new OrchestratorAgent({
      provider,
      accessors: {
        getContentCalendar: (tenantId) =>
          withTenant(db, tenantId, (tx) => listContentItems(tx)).then((items) =>
            items.map((i) => ({ contentItemId: i.id, title: i.title, status: i.status })),
          ),
        listTrips: (tenantId) =>
          withTenant(db, tenantId, (tx) => listTrips(tx)).then((trips) =>
            trips.map((t) => ({ id: t.id, title: t.title, ...(t.theme ? { theme: t.theme } : {}) })),
          ),
        getTenantSettings: (tenantId) =>
          withTenant(db, tenantId, (tx) => getTenantSettings(tx)).then((s) => ({
            channels: s.channels.filter((c) => c.enabled).map((c) => c.channel),
            specialistAutonomy: s.specialistAutonomy,
          })),
      },
      subAgents: {
        runWriter: (input, ctx) =>
          writer
            .run({ brief: input.instruction, voice: DEFAULT_VOICE }, { tenantId: ctx.tenantId })
            .then((p) => ({ summary: p.payload.draft.slice(0, 200) })),
        runSeo: async (_input, ctx) => {
          const items = await withTenant(db, ctx.tenantId, (tx) => listContentItems(tx));
          const target = items[0];
          if (!target) return { summary: "Nessun contenuto da ottimizzare." };
          const draft = blocksToText(target.blocks);
          const p = await seo.run(
            { contentItemId: target.id, draft, title: target.title },
            { tenantId: ctx.tenantId },
          );
          return { summary: `SEO per "${p.payload.title}" (slug: ${p.payload.slug}).` };
        },
        runAnalyst: (_input, ctx) =>
          analyst
            .run({ periodDays: 30, mode: "sync" }, { tenantId: ctx.tenantId })
            .then((p) => ({ summary: p.payload.insights[0] ?? "Nessun insight disponibile." })),
      },
      store: runStore,
      budget,
    });
  }

  private get tenantId(): string {
    return this.tenancy.current().tenantId;
  }

  @Post("plan")
  @HttpCode(201)
  async plan(
    @Body() body: { horizonDays?: unknown } | undefined,
  ): Promise<{ id: string; status: string }> {
    const horizonDays = parseHorizonDays(body?.horizonDays);
    const tenantId = this.tenantId;
    try {
      const proposal = await this.agent.run({ horizonDays }, { tenantId });
      await this.proposals.persist(proposal);
      return { id: proposal.id, status: proposal.status };
    } catch (err) {
      if (err instanceof BudgetExceededError) throw new ConflictException(err.message);
      throw err;
    }
  }
}

const DEFAULT_HORIZON_DAYS = 28;

/** A positive integer horizon; defaults to 28, rejects non-positive / non-finite. */
function parseHorizonDays(value: unknown): number {
  if (value === undefined) return DEFAULT_HORIZON_DAYS;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestException("horizonDays must be a positive integer");
  }
  return value;
}

/** Flatten a content item's canonical blocks into the plain text the SEO agent reads. */
function blocksToText(blocks: Block[]): string {
  return blocks
    .map((b) => (typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : ""))
    .filter(Boolean)
    .join("\n\n");
}
