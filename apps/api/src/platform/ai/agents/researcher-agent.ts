import { researchBriefSchema, type ResearchBrief, type ResearchSource } from "@blogs/contracts";
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
import type { SchemaLike, ToolDefinition } from "../tools";
import type { BudgetGuard } from "../budget-guard";
import type { AgentRunStore } from "../agent-run-store";
import {
  createRetrieveContextTool,
  type RetrieveContextAccessor,
} from "./tools/retrieve-context";
import {
  createGetItineraryTool,
  type GetItineraryAccessor,
} from "./tools/get-itinerary";
import {
  createGetMediaForStopTool,
  type GetMediaForStopAccessor,
} from "./tools/get-media-for-stop";
import {
  createSearchSourcesTool,
  STUB_SEARCH_SOURCES,
  SEARCH_SOURCES_TOOL_ID,
  type SearchSourcesAccessor,
} from "./tools/search-sources";

/**
 * ResearcherAgent — Slice X1. UNLIKE the specialists (SEO/Social/Email) it does
 * NOT stage a `Proposal` of its own: its output is an EPHEMERAL `ResearchBrief`
 * (in-memory, job-scoped) that ENRICHES a Writer run. The Writer flow runs it
 * first (when the tenant's external-research flag is on), injects the brief into
 * `buildPrompt`, and lays it onto `Proposal.researchContext` for the human gate.
 * There is no new table and no new endpoint (critica #9).
 *
 * It still runs on the generic `AgentRunner` (same pattern as the Writer): a
 * static definition + injected, boundary-respecting tools. The brief is built
 * DETERMINISTICALLY in `parseOutput` from evidence pre-gathered before the loop —
 * so even the offline LLM stub yields a schema-valid brief, and the same
 * topic (+ stub `searchSources`) always yields the same brief (replay-stable).
 *
 * COST-ZERO INVARIANT: with `externalEnabled=false` the `searchSources`
 * (`side:'external'`) tool is NOT offered AND not pre-called, so no external
 * source is reachable and the accessor is never invoked (zero external calls).
 */

export const RESEARCHER_PROPOSAL_TYPE = "research_brief";

/** Data accessors injected at the boundary (kernel never imports modules/*). */
export interface ResearcherAccessors {
  embed(text: string): Promise<number[]>;
  retrieve(tenantId: string, embedding: number[], k: number): Promise<string[]>;
  /** Optional: only registered as a tool when supplied (itinerary vertical). */
  getItinerary?: GetItineraryAccessor;
  /** Optional: only registered as a tool when supplied (media module). */
  getMediaForStop?: GetMediaForStopAccessor;
  /**
   * The external SERP port. Defaults to the deterministic offline {@link
   * STUB_SEARCH_SOURCES} (DEBT-034). It is OFFERED + pre-called ONLY when a run
   * sets `externalEnabled` — the per-tenant opt-in.
   */
  searchSources?: SearchSourcesAccessor;
}

export interface ResearcherAgentDeps {
  /** Exactly ONE of `llm` / `provider` (BYOK-aware), as the Writer. */
  llm?: LlmPort;
  provider?: ProviderRegistry;
  accessors: ResearcherAccessors;
  /** Defaults to a no-op store (no audit row). */
  store?: AgentRunStore;
  /** Defaults to an always-ok guard. */
  budget?: BudgetGuard;
  logger?: RunLogger;
}

export interface ResearcherRunInput {
  /** The research subject — the same brief/topic the Writer will generate from. */
  topic: string;
  /** Optional itinerary to pull verified dates/places from (travel primary source). */
  itineraryId?: string;
  /** Per-tenant opt-in: when true the external `searchSources` tool is reachable. */
  externalEnabled: boolean;
  /** RAG fan-out; defaults to 3. */
  k?: number;
}

const DEFAULT_K = 3;

const NOOP_RUN_STORE: AgentRunStore = {
  findByTaskId: async () => null,
  record: async () => {},
};

const OK_BUDGET: BudgetGuard = { check: async () => {} };

/**
 * Static, identifying fields of the Researcher definition (agentic-plan X1: `fast`
 * tier for the gather, room for a few tool steps). `allowedTools`/schemas are
 * overlaid per run (the external tool is offered only on opt-in).
 */
const RESEARCHER_DEF_BASE = {
  id: "researcher",
  role: "Ricercatore che raccoglie fonti e fatti per ancorare la bozza dell'articolo",
  systemPrompt: [
    "Sei un ricercatore per un blog di viaggio.",
    "Raccogli fatti e fonti affidabili a sostegno del tema indicato.",
    "Privilegia i contenuti e gli itinerari del tenant (fonti primarie verificate);",
    "usa fonti esterne solo quando disponibili. L'AI propone, l'umano conferma.",
  ].join(" "),
  model: "fast",
  maxSteps: 5,
  maxTokens: 5_000,
  maxContextTokens: 24_000,
  budgetCap: { inputTokens: 24_000, outputTokens: 5_000 },
  autonomyAxis: "writer",
  proposalType: RESEARCHER_PROPOSAL_TYPE,
} satisfies Partial<AgentDefinition<ResearchBrief>>;

/** `researchBriefSchema` (zod) satisfies `SchemaLike` — the runner only calls safeParse/parse. */
const researchBriefSchemaLike: SchemaLike<ResearchBrief> = researchBriefSchema;

export class ResearcherAgent {
  private readonly accessors: ResearcherAccessors;
  private readonly searchSources: SearchSourcesAccessor;
  /** Tools offered on EVERY run: the internal data palette. */
  private readonly baseToolIds: string[];
  private readonly tools: ToolRegistry;
  private readonly resolveLlm: (tenantId: string) => Promise<LlmPort>;
  private readonly runnerDeps: {
    store: AgentRunStore;
    budget: BudgetGuard;
    logger?: RunLogger;
  };

  constructor(deps: ResearcherAgentDeps) {
    if (!deps.llm === !deps.provider) {
      throw new Error("ResearcherAgent requires exactly one of { llm, provider }");
    }
    this.accessors = deps.accessors;
    this.searchSources = deps.accessors.searchSources ?? STUB_SEARCH_SOURCES;

    const retrieveAcc: RetrieveContextAccessor = {
      embed: deps.accessors.embed,
      retrieve: deps.accessors.retrieve,
    };
    const baseTools: ToolDefinition[] = [
      createRetrieveContextTool(retrieveAcc) as ToolDefinition,
    ];
    if (deps.accessors.getItinerary) {
      baseTools.push(createGetItineraryTool(deps.accessors.getItinerary) as ToolDefinition);
    }
    if (deps.accessors.getMediaForStop) {
      baseTools.push(createGetMediaForStopTool(deps.accessors.getMediaForStop) as ToolDefinition);
    }
    this.baseToolIds = baseTools.map((t) => t.id);

    // The external tool is REGISTERED (so a per-run opt-in can offer it) but only
    // OFFERED — i.e. advertised to the model AND pre-called — when externalEnabled.
    const allTools = [
      ...baseTools,
      createSearchSourcesTool(this.searchSources) as ToolDefinition,
    ];
    this.tools = new ToolRegistry(allTools);

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
    input: ResearcherRunInput,
    ctx: { tenantId: string; taskId?: string; triggeredAt?: Date; runId?: string },
  ): Promise<ResearchBrief> {
    const k = input.k ?? DEFAULT_K;
    const llm = await this.resolveLlm(ctx.tenantId);
    const runner = new AgentRunner({ llm, tools: this.tools, ...this.runnerDeps });

    // ── Pre-gather the evidence DETERMINISTICALLY (the "gather" seed) ──────────
    // Internal RAG (always). Same role the Writer's pre-retrieve plays: it makes
    // even the no-tool-call stub produce a complete, schema-valid brief.
    const queryEmbedding = await this.accessors.embed(input.topic);
    const chunks = await this.accessors.retrieve(ctx.tenantId, queryEmbedding, k);

    // Itinerary (internal, verified): dates/places are a primary deterministic
    // source. Only if the accessor + an itineraryId are present.
    const itineraryFacts: string[] = [];
    if (this.accessors.getItinerary && input.itineraryId) {
      const itin = await this.accessors.getItinerary(ctx.tenantId, input.itineraryId);
      for (const s of itin.stops) {
        itineraryFacts.push(
          `${itin.title} — tappa: ${s.place}${s.notes ? ` (${s.notes})` : ""}`,
        );
      }
    }

    // External sources — ONLY on opt-in. With the flag OFF this branch never
    // runs, the tool is never offered, and the accessor is never invoked
    // (cost-zero invariant: zero external calls).
    const externalSources: ResearchSource[] = [];
    const externalFacts: string[] = [];
    if (input.externalEnabled) {
      const res = await this.searchSources(ctx.tenantId, { query: input.topic });
      for (const s of res.sources) {
        externalSources.push({ title: s.title, url: s.url });
        externalFacts.push(s.snippet);
      }
    }

    const facts = [...chunks, ...itineraryFacts, ...externalFacts];
    const keyInsights: string[] = [
      facts.length
        ? `Raccolti ${facts.length} elementi di contesto su "${input.topic}".`
        : `Nessun contesto interno disponibile su "${input.topic}".`,
    ];
    if (externalSources.length) {
      keyInsights.push(`Integrate ${externalSources.length} fonti esterne.`);
    }
    const gapsToFill = input.externalEnabled
      ? []
      : ["Ricerca esterna disattivata: i fatti provengono solo dai contenuti del tenant."];

    const allowedTools = input.externalEnabled
      ? [...this.baseToolIds, SEARCH_SOURCES_TOOL_ID]
      : this.baseToolIds;

    const def: AgentDefinition<ResearchBrief> = {
      ...RESEARCHER_DEF_BASE,
      allowedTools,
      outputSchema: researchBriefSchemaLike,
      // The LLM emits narrative reasoning; the structured brief closes over the
      // deterministically pre-gathered evidence (the runner only sees `content`).
      parseOutput: (content) => ({
        facts,
        sources: externalSources,
        keyInsights,
        gapsToFill,
        rationale: content,
      }),
    };

    // `taskId` (idempotency) must fold every input that shapes the output: the
    // topic, the itinerary, AND the flag state — so a re-run with the flag toggled
    // does not replay the wrong (internal-only vs. external) brief.
    const subjectId = `${input.topic}|${input.itineraryId ?? ""}|ext:${input.externalEnabled}`;
    const agentInput: AgentInput = {
      subjectId,
      content: `Tema di ricerca: ${input.topic}\n\nElenca i fatti e le fonti utili per scrivere l'articolo.`,
    };
    const runCtx: RunContext = {
      tenantId: ctx.tenantId,
      ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
      ...(ctx.triggeredAt ? { triggeredAt: ctx.triggeredAt } : {}),
      ...(ctx.runId ? { runId: ctx.runId } : {}),
    };

    const proposal = await runner.run<ResearchBrief>(def, agentInput, runCtx);
    return proposal.payload;
  }
}
