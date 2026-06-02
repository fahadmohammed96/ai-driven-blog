import {
  performanceReportSchema,
  deriveFeedbackSignal,
  buildContentProposal,
  type PerformanceReport,
  type Proposal,
} from "@blogs/contracts";
import {
  AgentRunner,
  type AgentInput,
  type RunContext,
  type RunLogger,
} from "../../../platform/ai/agent-runner";
import type { AgentDefinition } from "../../../platform/ai/agent-registry";
import { ToolRegistry } from "../../../platform/ai/tool-registry";
import type { LlmPort } from "../../../platform/ai/llm";
import type { ProviderRegistry } from "../../../platform/ai/provider-registry";
import type { SchemaLike, ToolDefinition } from "../../../platform/ai/tools";
import type { BudgetGuard } from "../../../platform/ai/budget-guard";
import type { AgentRunStore } from "../../../platform/ai/agent-run-store";
import { aggregateChannelBreakdown, rankTopContent } from "./aggregate";
import { createAnalystTools, type AnalyticsReadAccessor } from "./tools/analyst-tools";

/**
 * AnalystAgent (agentic-plan Slice O1) — a specialist on the generic
 * `AgentRunner`, like SEO/Social. UNLIKE them it does NOT transform one article:
 * it reads the tenant's cross-channel `metric_snapshots` (via the unified
 * dashboard accessor), aggregates them DETERMINISTICALLY, and emits an INFORMATIVE
 * `Proposal<PerformanceReport>` (type `analyst_insight`). The proposal lands in
 * `agent_proposals` staging and, on approval, is ACKNOWLEDGE-ONLY — the founder
 * recognises it (input for the future Orchestrator O3), nothing downstream
 * mutates content or publication state.
 *
 * DETERMINISTIC SEED (cost control §5): the channel breakdown, top content and the
 * seed insights/recommendations are computed in code BEFORE the loop, so even the
 * offline stub (which returns prose, not JSON) yields a VALID report with a
 * NON-EMPTY `insights`. The single `balanced` LLM step only enriches the narrative
 * — its JSON `{insights, recommendations}` is merged on top of the seed; prose
 * falls back to the seed alone.
 *
 * BATCH SEAM (DEBT-037): `mode: 'batch'` today runs the SAME synchronous logic and
 * produces the SAME schema as `'sync'` (parity is the acceptance). The real
 * Anthropic Batch API (−50%) needs async scheduling = Slice O0 (pg-boss).
 */

/** How the run is scheduled. Both modes produce the same report schema today (DEBT-037). */
export type AnalystMode = "sync" | "batch";

export interface AnalystAccessors {
  /** Read the tenant's unified cross-channel dashboard (RLS-scoped at the boundary). */
  dashboard: AnalyticsReadAccessor;
}

export interface AnalystAgentDeps {
  /** Exactly one of `llm` (fixed port) / `provider` (per-tenant BYOK, R1-C). */
  llm?: LlmPort;
  provider?: ProviderRegistry;
  accessors: AnalystAccessors;
  store?: AgentRunStore;
  budget?: BudgetGuard;
  logger?: RunLogger;
}

export interface AnalystRunInput {
  /** The window the report covers, in days. */
  periodDays: number;
  /** Sync vs batch scheduling (same schema today, DEBT-037). */
  mode: AnalystMode;
  /** Top-content ranking fan-out; defaults to 5. */
  topLimit?: number;
}

const DEFAULT_TOP_LIMIT = 5;

/** No-op store: a stand-alone run persists no audit row (caller wires the real one). */
const NOOP_RUN_STORE: AgentRunStore = {
  findByTaskId: async () => null,
  record: async () => {},
};
/** Always-ok budget for contexts with no DB to meter against (unit tests). */
const OK_BUDGET: BudgetGuard = { check: async () => {} };

const ANALYST_SYSTEM_PROMPT =
  "Sei l'analista della redazione. Date le metriche cross-canale aggregate, sintetizza " +
  "insight e raccomandazioni editoriali concreti e brevi. Rispondi SOLO con un oggetto JSON: " +
  '{"insights": string[], "recommendations": string[]}. Niente altro testo. ' +
  "Non inventare numeri: commenta solo i dati forniti.";

const ANALYST_DEF_BASE = {
  id: "analyst",
  role: "Analista: legge le metriche cross-canale e produce insight e raccomandazioni",
  systemPrompt: ANALYST_SYSTEM_PROMPT,
  model: "balanced",
  maxSteps: 5,
  maxTokens: 4_000,
  maxContextTokens: 24_000,
  budgetCap: { inputTokens: 24_000, outputTokens: 4_000 },
  // Reuse an EXISTING Specialist axis (the type is the `Specialist` union, so
  // "analyst" is not assignable). Mirrors the Researcher, which reuses "writer".
  autonomyAxis: "writer",
  proposalType: "analyst_insight",
} satisfies Partial<AgentDefinition<PerformanceReport>>;

/** `performanceReportSchema` (zod) satisfies `SchemaLike` — the runner only calls safeParse/parse. */
const performanceReportSchemaLike: SchemaLike<PerformanceReport> = performanceReportSchema;

/** Narrative the LLM may supply; everything structural is computed deterministically. */
interface LlmNarrative {
  insights: string[];
  recommendations: string[];
}

function parseLlmNarrative(content: string): LlmNarrative {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      const strings = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
      return { insights: strings(o.insights), recommendations: strings(o.recommendations) };
    }
  } catch {
    // Not JSON (e.g. the offline stub returns prose) → pure deterministic seed.
  }
  return { insights: [], recommendations: [] };
}

export class AnalystAgent {
  private readonly accessors: AnalystAccessors;
  private readonly resolveLlm: (tenantId: string) => Promise<LlmPort>;
  private readonly runnerDeps: { store: AgentRunStore; budget: BudgetGuard; logger?: RunLogger };

  constructor(deps: AnalystAgentDeps) {
    if (!deps.llm === !deps.provider) {
      throw new Error("AnalystAgent requires exactly one of { llm, provider }");
    }
    this.accessors = deps.accessors;
    this.resolveLlm = deps.provider
      ? (tenantId) => deps.provider!.getClient(tenantId)
      : async () => deps.llm!;
    this.runnerDeps = {
      store: deps.store ?? NOOP_RUN_STORE,
      budget: deps.budget ?? OK_BUDGET,
      ...(deps.logger ? { logger: deps.logger } : {}),
    };
  }

  async run(
    input: AnalystRunInput,
    ctx: { tenantId: string; taskId?: string; triggeredAt?: Date; runId?: string },
  ): Promise<Proposal<PerformanceReport>> {
    const topLimit = input.topLimit ?? DEFAULT_TOP_LIMIT;

    // ── Deterministic seed (no LLM): aggregate the metrics + derive the seed
    //    narrative, so the payload is valid even from a prose stub. The `mode`
    //    does NOT change this logic today (DEBT-037): batch == sync, same schema.
    const dashboard = await this.accessors.dashboard(ctx.tenantId);
    const channelBreakdown = aggregateChannelBreakdown(dashboard);
    const topContent = rankTopContent(dashboard, topLimit);

    const signal = deriveFeedbackSignal(dashboard);
    const contentProposal = buildContentProposal(signal);
    const seedInsights: string[] = [
      signal.topChannel
        ? `Il canale con più engagement è "${signal.topChannel}".`
        : "Nessun segnale di engagement nelle metriche del periodo.",
      `Analizzati ${channelBreakdown.length} canale/i e ${topContent.length} contenuto/i sul periodo di ${input.periodDays} giorni.`,
    ];
    if (signal.underperformers.length) {
      seedInsights.push(`Canali sotto la media: ${signal.underperformers.join(", ")}.`);
    }
    const seedRecommendations: string[] = [contentProposal.promptHint];

    const tools: ToolDefinition[] = createAnalystTools(this.accessors.dashboard);
    const registry = new ToolRegistry(tools);

    const def: AgentDefinition<PerformanceReport> = {
      ...ANALYST_DEF_BASE,
      allowedTools: tools.map((t) => t.id),
      outputSchema: performanceReportSchemaLike,
      // The structured numbers close over the deterministic seed; the LLM's JSON
      // narrative (or, for a prose stub, nothing) is merged ON TOP of the seed, so
      // `insights` is ALWAYS non-empty.
      parseOutput: (content): PerformanceReport => {
        const narrative = parseLlmNarrative(content);
        return {
          period: { days: input.periodDays },
          channelBreakdown,
          topContent,
          insights: [...seedInsights, ...narrative.insights],
          recommendations: [...seedRecommendations, ...narrative.recommendations],
        };
      },
    };

    const llm = await this.resolveLlm(ctx.tenantId);
    const runner = new AgentRunner({ llm, tools: registry, ...this.runnerDeps });
    // `subjectId` (idempotency) folds EVERY input that shapes the output: tenant,
    // period AND mode — so a re-run with a different period (or mode) is NOT a
    // replay of the wrong report (lezioni S1/S2).
    const subjectId = `${ctx.tenantId}|days:${input.periodDays}|mode:${input.mode}`;
    const agentInput: AgentInput = {
      subjectId,
      content: JSON.stringify({ periodDays: input.periodDays, channelBreakdown, topContent }),
    };
    const runCtx: RunContext = {
      tenantId: ctx.tenantId,
      ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
      ...(ctx.triggeredAt ? { triggeredAt: ctx.triggeredAt } : {}),
      ...(ctx.runId ? { runId: ctx.runId } : {}),
    };

    const proposal = await runner.run<PerformanceReport>(def, agentInput, runCtx);
    // IDEMPOTENCY: the runner emits a fresh `randomUUID()` id on a clean run but
    // `id == runId` on replay. Pin the id to `runId` so a re-run re-stages the SAME
    // id → `persist`'s onConflictDoNothing(id) dedupes (mirrors Social, lezioni S1/S2).
    return { ...proposal, id: proposal.runId };
  }
}
