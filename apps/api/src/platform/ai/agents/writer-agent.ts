import type { Proposal, ResearchBrief } from "@blogs/contracts";
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
import { buildPrompt, renderSystemPrompt, type BrandVoice } from "../prompt";
import {
  scoreAuthenticity,
  buildAuthenticityFeedbackHint,
  AUTHENTICITY_THRESHOLD,
} from "./tools/score-authenticity";
import {
  createRetrieveContextTool,
  type RetrieveContextAccessor,
} from "./tools/retrieve-context";
import {
  createGetBrandVoiceTool,
  type GetBrandVoiceAccessor,
} from "./tools/get-brand-voice";
import {
  createGetItineraryTool,
  type GetItineraryAccessor,
} from "./tools/get-itinerary";
import {
  createGetMediaForStopTool,
  type GetMediaForStopAccessor,
} from "./tools/get-media-for-stop";
import {
  createGetFeedbackSignalTool,
  GET_FEEDBACK_SIGNAL_TOOL_ID,
  type GetFeedbackSignalAccessor,
} from "./tools/get-feedback-signal";

/**
 * WriterAgent — the FIRST real agent on `AgentRunner` (agentic-plan Slice
 * A1-writer). It validates the pattern every later specialist (SEO/Social/Email)
 * reuses: a static `AgentDefinition` + injected, boundary-respecting tools, an
 * `scoreAuthenticity` EXIT GATE (not a tool, critica #4), driven by the generic
 * runner — no loop code here.
 *
 * BOUNDARY (the arch-test does NOT police `platform/*` — we do): the Writer's
 * data tools are wired via INJECTED accessors. The kernel never imports
 * `modules/*`/`verticals/*`; the caller (e.g. `itineraries.controller.ts`, which
 * MAY import travel/media) supplies accessors that adapt module data into the
 * tools' local, serialisable shapes — exactly the pattern `generateDraft` set.
 *
 * The Writer's payload is an {@link ArticleDraft}. Today it lands as a draft in
 * the Phase-1 publication state machine (the same sink `generateDraft` fed);
 * `agent_proposals` staging arrives in T1. See DEBT-022.
 */

/** The Writer's `content_draft` payload — the same fields `generateDraft` returns. */
export interface ArticleDraft {
  /** The generated article text. */
  draft: string;
  /** RAG chunks retrieved up front and woven into the prompt (backward compat). */
  usedContext: string[];
  /** The brand-voice system prompt used for this run. */
  system: string;
}

/** Data accessors injected at the boundary (see BOUNDARY note above). */
export interface WriterAccessors {
  embed(text: string): Promise<number[]>;
  retrieve(tenantId: string, embedding: number[], k: number): Promise<string[]>;
  /** Optional: only registered as a tool when supplied by the caller. */
  getBrandVoice?: GetBrandVoiceAccessor;
  getItinerary?: GetItineraryAccessor;
  getMediaForStop?: GetMediaForStopAccessor;
  /**
   * Optional metric-feedback accessor (Slice A2). Only registered as the
   * `getFeedbackSignal` tool, and only OFFERED on a run that carries a
   * `contentItemId` and has no pre-injected hint (see {@link WriterAgent.run}).
   */
  getFeedbackSignal?: GetFeedbackSignalAccessor;
}

export interface WriterAgentDeps {
  /**
   * The Writer's LLM source. Exactly ONE of:
   *  - `provider`: a {@link ProviderRegistry} — the preferred, BYOK-aware source
   *    (R1-C). The port is resolved PER TENANT at `run()` time, so a tenant with
   *    its own key uses it and everyone else falls back to the platform key.
   *  - `llm`: a fixed {@link LlmPort}. The legacy seam still used by the
   *    `generateDraft` compat wrapper (and unit tests). Behaviour is identical to
   *    the provider path with no tenant credential — the registry's own fallback.
   */
  llm?: LlmPort;
  provider?: ProviderRegistry;
  accessors: WriterAccessors;
  /** Defaults to a no-op store: `generateDraft`'s sink is unchanged (DEBT-022). */
  store?: AgentRunStore;
  /** Defaults to an always-ok guard (no DB to meter the bare `generateDraft` path). */
  budget?: BudgetGuard;
  logger?: RunLogger;
}

export interface WriterRunInput {
  brief: string;
  voice: BrandVoice;
  k?: number;
  /** Metric-derived feedback-loop hint, woven into the prompt (ADR-0026). */
  feedbackHint?: string;
  /**
   * The content item this run refines (Slice A2). When present AND no
   * `feedbackHint` is pre-injected, the Writer is offered the `getFeedbackSignal`
   * tool so the model can pull the metric-derived self-improvement hint itself
   * (the stand-alone case). With a pre-injected `feedbackHint` the tool is NOT
   * offered — the signal is already in the prompt, so a fetch would be wasteful.
   */
  contentItemId?: string;
  /** Idempotency subject; defaults to the brief. */
  subjectId?: string;
  /**
   * The Researcher's ephemeral brief (Slice X1). When present it is woven into
   * the prompt (`buildPrompt`'s research block) — and the caller also lays it onto
   * `Proposal.researchContext` for the human gate. Absent → the prompt is
   * byte-identical to before (backward compat).
   */
  researchContext?: ResearchBrief;
}

const DEFAULT_K = 3;

/** No-op store: the bare `generateDraft` path persists no audit row (DEBT-022). */
const NOOP_RUN_STORE: AgentRunStore = {
  findByTaskId: async () => null,
  record: async () => {},
};

/** Always-ok budget: no DB to meter against on the bare `generateDraft` path. */
const OK_BUDGET: BudgetGuard = { check: async () => {} };

/**
 * Static, identifying fields of the Writer definition (agentic-plan §"Loop
 * limitati": balanced tier, 4 steps = gather + 1 draft + ≤1 authenticity retry).
 * `systemPrompt`/`allowedTools`/schemas are overlaid per run (the brand voice and
 * the available accessors are tenant/call specific).
 */
const WRITER_DEF_BASE = {
  id: "writer",
  role: "Redattore di articoli di viaggio nella brand voice del tenant",
  model: "balanced",
  maxSteps: 4,
  maxTokens: 8_000,
  maxContextTokens: 30_000,
  budgetCap: { inputTokens: 30_000, outputTokens: 8_000 },
  autonomyAxis: "writer",
  proposalType: "content_draft",
} satisfies Partial<AgentDefinition<ArticleDraft>>;

function articleDraftSchema(): SchemaLike<ArticleDraft> {
  const valid = (v: unknown): v is ArticleDraft => {
    const o = v as Partial<ArticleDraft>;
    return (
      typeof o === "object" &&
      o !== null &&
      typeof o.draft === "string" &&
      o.draft.length > 0 &&
      Array.isArray(o.usedContext) &&
      o.usedContext.every((c) => typeof c === "string") &&
      typeof o.system === "string"
    );
  };
  return {
    safeParse: (input) =>
      valid(input)
        ? { success: true, data: input }
        : { success: false, error: "invalid ArticleDraft" },
    parse: (input) => {
      if (!valid(input)) throw new Error("invalid ArticleDraft payload");
      return input;
    },
  };
}

export class WriterAgent {
  private readonly accessors: WriterAccessors;
  /** Tools offered on EVERY run (A1-writer): the data-gathering palette. */
  private readonly baseToolIds: string[];
  /** The feedback tool id, present only when its accessor was supplied (A2). */
  private readonly feedbackToolId: string | undefined;
  private readonly tools: ToolRegistry;
  /** Resolves the LlmPort for a run's tenant (per-tenant BYOK, or fixed legacy port). */
  private readonly resolveLlm: (tenantId: string) => Promise<LlmPort>;
  private readonly runnerDeps: {
    store: AgentRunStore;
    budget: BudgetGuard;
    logger?: RunLogger;
  };

  constructor(deps: WriterAgentDeps) {
    if (!deps.llm === !deps.provider) {
      throw new Error("WriterAgent requires exactly one of { llm, provider }");
    }
    this.accessors = deps.accessors;
    const baseTools = buildWriterTools(deps.accessors);
    this.baseToolIds = baseTools.map((t) => t.id);
    const allTools = [...baseTools];
    // The feedback tool is registered when its accessor is supplied, but it is
    // OFFERED per-run (only with a contentItemId and no pre-injected hint) — so
    // the bare `generateDraft` path is unchanged (it offers it never).
    if (deps.accessors.getFeedbackSignal) {
      allTools.push(
        createGetFeedbackSignalTool(deps.accessors.getFeedbackSignal) as ToolDefinition,
      );
      this.feedbackToolId = GET_FEEDBACK_SIGNAL_TOOL_ID;
    } else {
      this.feedbackToolId = undefined;
    }
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
    input: WriterRunInput,
    ctx: { tenantId: string; taskId?: string; triggeredAt?: Date; runId?: string },
  ): Promise<Proposal<ArticleDraft>> {
    const k = input.k ?? DEFAULT_K;
    // Resolve the LlmPort for THIS tenant (R1-C): the registry hands back the
    // tenant's own key if present, else the platform key (the stub in CI/E2E).
    // The runner is built per-run so each tenant gets the right port.
    const llm = await this.resolveLlm(ctx.tenantId);
    const runner = new AgentRunner({ llm, tools: this.tools, ...this.runnerDeps });
    // Pre-retrieve RAG context and seed it into the prompt, exactly as the
    // original `generateDraft` did — so even the deterministic stub (no tool
    // call) produces an IDENTICAL draft (backward compat). The `retrieveContext`
    // tool lets a real model fetch *more*, but the seed guarantees the baseline.
    const queryEmbedding = await this.accessors.embed(input.brief);
    const usedContext = await this.accessors.retrieve(ctx.tenantId, queryEmbedding, k);
    const system = renderSystemPrompt(input.voice);
    const prompt = buildPrompt(
      input.brief,
      usedContext,
      input.feedbackHint,
      input.researchContext,
    );

    // Offer `getFeedbackSignal` only stand-alone (A2): a contentItemId to refine,
    // its accessor wired, and NO hint already in the prompt (pre-injection is free
    // — re-fetching would just spend tokens). The model then decides whether to
    // call it; with a pre-injected hint the tool is absent, so zero feedback calls.
    // TODO(debt): DEBT-024 — no live caller injects the accessor / propagates a
    // contentItemId yet, and the pre-injected hint awaits the Orchestrator.
    const preInjected = input.feedbackHint !== undefined;
    const allowedTools =
      this.feedbackToolId !== undefined && input.contentItemId !== undefined && !preInjected
        ? [...this.baseToolIds, this.feedbackToolId]
        : this.baseToolIds;

    const def: AgentDefinition<ArticleDraft> = {
      ...WRITER_DEF_BASE,
      systemPrompt: system,
      allowedTools,
      outputSchema: articleDraftSchema(),
      // The LLM emits the article text; the structured payload closes over the
      // pre-retrieved context + rendered system (the runner only sees `content`).
      parseOutput: (content) => ({ draft: content, usedContext, system }),
      // EXIT GATE (critica #4): the runner calls this after end_turn. A low score
      // appends a deterministic hint for exactly ONE retry; never an LLM tool.
      exitGate: (payload) => {
        const score = scoreAuthenticity(payload.draft);
        return score < AUTHENTICITY_THRESHOLD
          ? { feedbackHint: buildAuthenticityFeedbackHint(score) }
          : null;
      },
    };

    const agentInput: AgentInput = {
      subjectId: input.subjectId ?? input.brief,
      content: prompt,
    };
    const runCtx: RunContext = {
      tenantId: ctx.tenantId,
      ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
      ...(ctx.triggeredAt ? { triggeredAt: ctx.triggeredAt } : {}),
      ...(ctx.runId ? { runId: ctx.runId } : {}),
    };
    return runner.run<ArticleDraft>(def, agentInput, runCtx);
  }
}

/** Build the Writer's tool palette from whatever accessors the caller supplied. */
function buildWriterTools(accessors: WriterAccessors): ToolDefinition[] {
  const retrieveAcc: RetrieveContextAccessor = {
    embed: accessors.embed,
    retrieve: accessors.retrieve,
  };
  const tools: ToolDefinition[] = [
    createRetrieveContextTool(retrieveAcc) as ToolDefinition,
  ];
  if (accessors.getBrandVoice) {
    tools.push(createGetBrandVoiceTool(accessors.getBrandVoice) as ToolDefinition);
  }
  if (accessors.getItinerary) {
    tools.push(createGetItineraryTool(accessors.getItinerary) as ToolDefinition);
  }
  if (accessors.getMediaForStop) {
    tools.push(createGetMediaForStopTool(accessors.getMediaForStop) as ToolDefinition);
  }
  return tools;
}
