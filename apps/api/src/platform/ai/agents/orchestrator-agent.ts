import {
  editorialPlanSchema,
  type EditorialPlan,
  type EditorialPriority,
  type EditorialSlot,
  type Proposal,
} from "@blogs/contracts";
import {
  AgentRunner,
  type AgentInput,
  type RunContext,
  type RunLogger,
} from "../agent-runner";
import type { AgentDefinition } from "../agent-registry";
import { ToolRegistry } from "../tool-registry";
import type { LlmPort } from "../llm";
import type { ProviderRegistry } from "../provider-registry";
import type { SchemaLike, ToolContext, ToolDefinition } from "../tools";
import type { BudgetGuard } from "../budget-guard";
import type { AgentRunStore } from "../agent-run-store";
import { isObject } from "./tools/schema";
import {
  createGetContentCalendarTool,
  type CalendarEntry,
  type GetContentCalendarAccessor,
} from "./tools/get-content-calendar";
import {
  createListTripsTool,
  type ListTripsAccessor,
  type TripSummary,
} from "./tools/list-trips";
import {
  createGetTenantSettingsTool,
  type GetTenantSettingsAccessor,
  type OrchestratorTenantSettings,
} from "./tools/get-tenant-settings";
import type { RunSubAgentInput, SubAgentDispatch } from "./tools/run-sub-agent";
import { createRunWriterTool } from "./tools/run-writer";
import { createRunSeoTool } from "./tools/run-seo";
import { createRunAnalystTool } from "./tools/run-analyst";

/**
 * OrchestratorAgent — the "director" (agentic-plan Slice O3). The ONE agent that
 * calls the others as TOOLS: FLAT, CENTRALIZED orchestration (no hierarchy, no
 * nested loops). It produces a `Proposal<EditorialPlan>` (a calendar of slots,
 * priorities, and per-specialist notes) and STAGES it for the human gate — it
 * does NOT write content and does NOT publish.
 *
 * PROPOSE-ONLY is preserved structurally: the plan is ALWAYS staged `pending`,
 * never auto-executed. The future autonomy engine — which would auto-dispatch a
 * slot to its specialist when its per-specialist autonomy level allows — is a
 * DOCUMENTED SEAM here (see {@link AUTONOMY_ENGINE_ENABLED}), not built (founder
 * "seam only" decision, DEBT-041).
 *
 * BOUNDARY (CRUX 1): this kernel file must NOT import `modules/*`. The sub-agents
 * (Writer/SEO/Analyst) are INJECTED as dispatch callbacks (`subAgents`), and the
 * deterministic context comes through injected accessors. The binding to the
 * concrete `WriterAgent`/`SeoAgent`/`AnalystAgent` happens at the composition
 * root (the orchestrator controller), which may import their module barrels.
 *
 * FAILURE ISOLATION (CRUX 2): each sub-agent builds its OWN `AgentRunner` whose
 * `BudgetGuard.check` re-reads the tenant's monthly spend from the DB before the
 * run — so an Orchestrator firing N sub-agents can never spend N × the cap. A
 * sub-agent that throws (including `BudgetExceededError` from that re-read) is
 * CAUGHT here and recorded in `agentNotes`; the exception NEVER propagates and
 * the plan still ships (partial).
 *
 * DETERMINISTIC SEED (cost control §5): the slots/priorities are computed in code
 * BEFORE the loop from `getContentCalendar`/`listTrips`/`getTenantSettings`, so
 * even the offline stub (which returns prose, not JSON) yields a VALID plan with
 * NON-EMPTY `slots`. The single `balanced` LLM loop only refines priorities and
 * may consult the sub-agents to enrich the notes.
 */

/**
 * The autonomy-engine flag (founder "seam only" decision). FALSE today: the plan
 * is always staged for the human gate. Flipping it on is DEBT-041 (build the
 * engine + the per-slot gate + the active reading of the autonomy levels). Typed
 * `boolean` (not the literal `false`) so the seam branch is not dead code.
 */
const AUTONOMY_ENGINE_ENABLED: boolean = false;

/** Data accessors injected at the boundary (the caller reads under tenant RLS). */
export interface OrchestratorAccessors {
  getContentCalendar: GetContentCalendarAccessor;
  listTrips: ListTripsAccessor;
  getTenantSettings: GetTenantSettingsAccessor;
}

/** A sub-agent invocation: runs the concrete sub-agent and returns a short summary. */
export type SubAgentRun = (
  input: RunSubAgentInput,
  ctx: ToolContext,
) => Promise<{ summary: string }>;

/** Sub-agents the Orchestrator may call as tools. Each is OPTIONAL (offered only if wired). */
export interface OrchestratorSubAgents {
  runWriter?: SubAgentRun;
  runSeo?: SubAgentRun;
  runAnalyst?: SubAgentRun;
}

export interface OrchestratorAgentDeps {
  /** Exactly one of `llm` (fixed port) / `provider` (per-tenant BYOK, R1-C). */
  llm?: LlmPort;
  provider?: ProviderRegistry;
  accessors: OrchestratorAccessors;
  /** Sub-agents bound at the composition root; absent ones are simply not offered. */
  subAgents?: OrchestratorSubAgents;
  store?: AgentRunStore;
  budget?: BudgetGuard;
  logger?: RunLogger;
}

export interface OrchestratorRunInput {
  /** Planning horizon in days (drives the number of weekly slots). */
  horizonDays: number;
}

/** No-op store: a stand-alone run persists no audit row (caller wires the real one). */
const NOOP_RUN_STORE: AgentRunStore = {
  findByTaskId: async () => null,
  record: async () => {},
};
/** Always-ok budget for contexts with no DB to meter against (unit tests). */
const OK_BUDGET: BudgetGuard = { check: async () => {} };

const ORCHESTRATOR_SYSTEM_PROMPT =
  "Sei il regista editoriale della redazione. Hai un calendario di contenuti, " +
  "una lista di viaggi e i canali attivi del tenant. Puoi consultare gli " +
  "specialisti (writer, seo, analyst) tramite gli strumenti per arricchire le " +
  "priorità. NON scrivi contenuti e NON pubblichi: proponi solo un piano. " +
  "Quando hai finito, rispondi SOLO con un oggetto JSON: " +
  '{"priorities": [{"item": string, "why": string}]}. Niente altro testo.';

const ORCHESTRATOR_DEF_BASE = {
  id: "orchestrator",
  role: "Regista editoriale: pianifica calendario e priorità coordinando gli specialisti",
  systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
  model: "balanced",
  maxSteps: 10,
  maxTokens: 6_000,
  maxContextTokens: 40_000,
  budgetCap: { inputTokens: 40_000, outputTokens: 6_000 },
  // Reuse an EXISTING Specialist axis: `autonomyAxis` is the `Specialist` union and
  // adding "orchestrator" to `SPECIALISTS` is explicitly out of scope (founder
  // decision). Mirrors the Analyst, which reuses "writer".
  autonomyAxis: "writer",
  proposalType: "editorial_plan",
} satisfies Partial<AgentDefinition<EditorialPlan>>;

/** `editorialPlanSchema` (zod) satisfies `SchemaLike` — the runner uses safeParse/parse. */
const editorialPlanSchemaLike: SchemaLike<EditorialPlan> = editorialPlanSchema;

/** Build the weekly slots from the horizon, uncovered trips and enabled channels. */
function buildSeedSlots(
  horizonDays: number,
  trips: TripSummary[],
  calendar: CalendarEntry[],
  channels: string[],
): EditorialSlot[] {
  const weeks = Math.max(1, Math.ceil(horizonDays / 7));
  const scheduled = new Set(calendar.map((c) => c.title.trim().toLowerCase()));
  const uncovered = trips.filter((t) => !scheduled.has(t.title.trim().toLowerCase()));
  const topics = (uncovered.length ? uncovered : trips).map((t) => t.title);
  const channel = channels[0];
  const slots: EditorialSlot[] = [];
  for (let w = 0; w < weeks; w++) {
    const topic = topics.length
      ? topics[w % topics.length]!
      : `Contenuto editoriale (settimana ${w + 1})`;
    slots.push({
      when: `Settimana ${w + 1}`,
      topic,
      ...(channel ? { channel } : {}),
      rationale: topics.length
        ? "Viaggio non ancora coperto dal calendario: candidato prioritario."
        : "Slot di continuità editoriale per mantenere la cadenza di pubblicazione.",
    });
  }
  return slots;
}

/** Derive seed priorities from coverage gaps and stuck drafts (always ≥1). */
function buildSeedPriorities(
  trips: TripSummary[],
  calendar: CalendarEntry[],
): EditorialPriority[] {
  const out: EditorialPriority[] = [];
  const scheduled = new Set(calendar.map((c) => c.title.trim().toLowerCase()));
  const uncovered = trips.filter((t) => !scheduled.has(t.title.trim().toLowerCase()));
  if (uncovered.length) {
    out.push({
      item: `Coprire ${uncovered.length} viaggio/i non ancora pianificato/i`,
      why: "Massimizza la copertura dell'offerta di viaggi esistente.",
    });
  }
  if (calendar.some((c) => c.status === "draft")) {
    out.push({
      item: "Far avanzare le bozze ferme verso la pubblicazione",
      why: "Riduce il work-in-progress accumulato nel calendario.",
    });
  }
  if (!out.length) {
    out.push({
      item: "Definire i prossimi temi editoriali",
      why: "Nessun segnale prioritario dai dati correnti.",
    });
  }
  return out;
}

/** Editorial priorities the LLM may supply; everything structural is deterministic. */
function parseLlmPriorities(content: string): EditorialPriority[] {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (isObject(parsed) && Array.isArray(parsed.priorities)) {
      return parsed.priorities
        .filter(
          (p): p is { item: string; why?: unknown } =>
            isObject(p) && typeof p.item === "string" && p.item.trim().length > 0,
        )
        .map((p) => ({ item: p.item, why: typeof p.why === "string" ? p.why : "" }));
    }
  } catch {
    // Not JSON (e.g. the offline stub returns prose) → pure deterministic seed.
  }
  return [];
}

export class OrchestratorAgent {
  private readonly accessors: OrchestratorAccessors;
  private readonly subAgents: OrchestratorSubAgents;
  private readonly resolveLlm: (tenantId: string) => Promise<LlmPort>;
  private readonly runnerDeps: { store: AgentRunStore; budget: BudgetGuard; logger?: RunLogger };

  constructor(deps: OrchestratorAgentDeps) {
    if (!deps.llm === !deps.provider) {
      throw new Error("OrchestratorAgent requires exactly one of { llm, provider }");
    }
    this.accessors = deps.accessors;
    this.subAgents = deps.subAgents ?? {};
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
    input: OrchestratorRunInput,
    ctx: { tenantId: string; taskId?: string; triggeredAt?: Date; runId?: string },
  ): Promise<Proposal<EditorialPlan>> {
    // ── Deterministic seed (no LLM): gather context, compute slots + priorities,
    //    so the payload is valid even from a prose stub.
    const [calendar, trips, settings] = await Promise.all([
      this.accessors.getContentCalendar(ctx.tenantId),
      this.accessors.listTrips(ctx.tenantId),
      this.accessors.getTenantSettings(ctx.tenantId),
    ]);
    const seedSlots = buildSeedSlots(input.horizonDays, trips, calendar, settings.channels);
    const seedPriorities = buildSeedPriorities(trips, calendar);

    // `agentNotes` is populated DURING the loop by the wrapped sub-agent dispatches
    // and snapshotted into the payload at parse time (all tool calls have finished
    // by end_turn / truncation).
    const agentNotes: Record<string, string> = {};

    const contextTools: ToolDefinition[] = [
      createGetContentCalendarTool((t) => this.accessors.getContentCalendar(t)) as ToolDefinition,
      createListTripsTool((t) => this.accessors.listTrips(t)) as ToolDefinition,
      createGetTenantSettingsTool((t) => this.accessors.getTenantSettings(t)) as ToolDefinition,
    ];

    // Wrap each wired sub-agent with the FAILURE-ISOLATION boundary: a throw (incl.
    // BudgetExceededError from the sub-run's budget re-read) is caught, recorded in
    // `agentNotes`, and resolved as a non-final tool result — never propagated.
    const subAgentTools: ToolDefinition[] = [];
    const wire = (
      agentId: string,
      raw: SubAgentRun | undefined,
      make: (d: SubAgentDispatch) => ToolDefinition,
    ): void => {
      if (!raw) return;
      const dispatch: SubAgentDispatch = async (toolInput, toolCtx) => {
        try {
          const { summary } = await raw(toolInput, toolCtx);
          agentNotes[agentId] = summary;
          return { agentId, ok: true, summary };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          agentNotes[agentId] = `non disponibile: ${msg}`;
          return { agentId, ok: false, summary: `errore: ${msg}` };
        }
      };
      subAgentTools.push(make(dispatch));
    };
    wire("writer", this.subAgents.runWriter, (d) => createRunWriterTool(d) as ToolDefinition);
    wire("seo", this.subAgents.runSeo, (d) => createRunSeoTool(d) as ToolDefinition);
    wire("analyst", this.subAgents.runAnalyst, (d) => createRunAnalystTool(d) as ToolDefinition);

    const tools = [...contextTools, ...subAgentTools];
    const registry = new ToolRegistry(tools);

    const def: AgentDefinition<EditorialPlan> = {
      ...ORCHESTRATOR_DEF_BASE,
      allowedTools: tools.map((t) => t.id),
      outputSchema: editorialPlanSchemaLike,
      // The structured plan closes over the deterministic seed + the agentNotes
      // gathered in the loop; the LLM's JSON priorities (or, for a prose stub,
      // nothing) are appended to the seed — slots stay deterministic + non-empty.
      parseOutput: (content): EditorialPlan => ({
        horizonDays: input.horizonDays,
        slots: seedSlots,
        priorities: [...seedPriorities, ...parseLlmPriorities(content)],
        agentNotes: { ...agentNotes },
      }),
    };

    const llm = await this.resolveLlm(ctx.tenantId);
    const runner = new AgentRunner({ llm, tools: registry, ...this.runnerDeps });
    // `subjectId` (idempotency) folds every input that shapes the output: the
    // tenant and the horizon. Same tenant|horizon same day → stable taskId →
    // stable id (staging dedup); a different horizon re-keys the run (no replay).
    const subjectId = `${ctx.tenantId}|horizon:${input.horizonDays}`;
    const agentInput: AgentInput = {
      subjectId,
      content: JSON.stringify({
        horizonDays: input.horizonDays,
        channels: settings.channels,
        trips: trips.map((t) => t.title),
        calendar: calendar.map((c) => ({ title: c.title, status: c.status })),
        seedSlots,
      }),
    };
    const runCtx: RunContext = {
      tenantId: ctx.tenantId,
      ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
      ...(ctx.triggeredAt ? { triggeredAt: ctx.triggeredAt } : {}),
      ...(ctx.runId ? { runId: ctx.runId } : {}),
    };

    const proposal = await runner.run<EditorialPlan>(def, agentInput, runCtx);

    // ── AUTONOMY SEAM (founder decision: SEAM ONLY; engine = DEBT-041) ──────────
    // This is the single innesto point of the future autonomy engine. When it is
    // enabled, the engine would — per slot — read the EXISTING per-specialist
    // autonomy level (settings.specialistAutonomy, the T2 stub) and, where a level
    // is `auto-within-limits`, AUTO-DISPATCH the slot to its specialist (still
    // inside the budget guard) instead of staging it. Today the engine does NOT
    // exist (AUTONOMY_ENGINE_ENABLED === false) and every level resolves to
    // `manual`, so the plan is ALWAYS staged as a `pending` proposal — propose-only
    // is preserved (ADR-0020). The seam READS the levels; it does not create them.
    const willAutoExecute =
      AUTONOMY_ENGINE_ENABLED &&
      Object.values(settings.specialistAutonomy).some((lvl) => lvl === "auto-within-limits");
    if (willAutoExecute) {
      // DEBT-041: the autonomy engine (auto-execute the approved plan behind the
      // flag) + the per-slot gate. Not built — founder "seam only" decision.
      throw new Error("autonomy engine not implemented (DEBT-041)");
    }

    // IDEMPOTENCY: pin the id to `runId` (the runner emits a fresh id on a clean run
    // but `id == runId` on replay) so a re-run re-stages the SAME id →
    // `persist`'s onConflictDoNothing(id) dedupes (mirrors Analyst, lezioni S1/S2).
    return { ...proposal, id: proposal.runId };
  }
}

/** Re-export the kernel settings shape so the composition root can adapt to it. */
export type { OrchestratorTenantSettings };
