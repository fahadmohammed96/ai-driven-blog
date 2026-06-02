import {
  inboundProposalSchema,
  type BrandVoice,
  type InboundProposal,
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
import type { ModelTier } from "../../../platform/ai/model-registry";
import type { ProviderRegistry } from "../../../platform/ai/provider-registry";
import type { SchemaLike, ToolDefinition } from "../../../platform/ai/tools";
import type { BudgetGuard } from "../../../platform/ai/budget-guard";
import type { AgentRunStore } from "../../../platform/ai/agent-run-store";
import {
  createRetrieveContextTool,
  type RetrieveContextAccessor,
} from "../../../platform/ai/agents/tools/retrieve-context";
import {
  classifyInbound,
  qualifyLead,
  suggestNextAction,
  buildSeedReply,
} from "./classify";
import {
  createClassifyInboundTool,
  createGetLeadsTool,
  createGetTenantSettingsTool,
  createGetBookingsTool,
  type LeadsAccessor,
  type BrandVoiceAccessor,
} from "./tools/inbound-tools";

/**
 * InboundAgent (agentic-plan Slice O2) — the CRM "front door" classifier on the
 * generic `AgentRunner`, mirroring the Analyst (O1) in FORM: it is INFORMATIVE
 * and PROPOSE-ONLY / NO-SEND. Given a raw inbound signal it CLASSIFIES it
 * (info/lead/reclamo), drafts a reply, qualifies a potential lead and suggests
 * the next human action, emitting a `Proposal<InboundProposal>` (type
 * `lead_classification`). The proposal lands in `agent_proposals` staging and, on
 * approval, is ACKNOWLEDGE-ONLY — the founder RECOGNISES it and then acts via the
 * EXISTING Fase-3 lead pipeline (untouched) or replies by hand. NOTHING is sent.
 *
 * It does NOT redo the Fase-3 single-shot `draftProposal`, and the approve branch
 * NEVER calls `NotificationPort` — the no-send invariant is structural.
 *
 * DETERMINISTIC SEED (cost control §5): the classification, lead qualification,
 * seed reply and next action are computed in code BEFORE the loop (a pure keyword
 * heuristic, DEBT-039), so even the offline stub (which returns prose, not JSON)
 * yields a VALID `InboundProposal` with the CORRECT `classification`. The single
 * LLM step only refines `proposedReply` — its JSON `{proposedReply}` is merged on
 * top of the seed; prose falls back to the seed reply alone.
 *
 * TIER (per-run): a `reclamo` is delicate → `balanced` (Sonnet); everything else
 * → `fast` (Haiku). Chosen from the deterministic seed, not the prompt.
 */

export interface InboundAccessors {
  /** Read the tenant's existing pipeline leads (RLS-scoped at the boundary). */
  leads: LeadsAccessor;
  /** Read the tenant's brand voice (RLS-scoped at the boundary). */
  brandVoice: BrandVoiceAccessor;
  /** RAG over the tenant's content (the product "knowledge base"). */
  rag: RetrieveContextAccessor;
}

export interface InboundAgentDeps {
  /** Exactly one of `llm` (fixed port) / `provider` (per-tenant BYOK, R1-C). */
  llm?: LlmPort;
  provider?: ProviderRegistry;
  accessors: InboundAccessors;
  store?: AgentRunStore;
  budget?: BudgetGuard;
  logger?: RunLogger;
}

export interface InboundRunInput {
  /** The raw inbound message to triage. */
  message: string;
  /** An existing pipeline lead this signal relates to, if known. */
  leadId?: string;
}

/** No-op store: a stand-alone run persists no audit row (caller wires the real one). */
const NOOP_RUN_STORE: AgentRunStore = {
  findByTaskId: async () => null,
  record: async () => {},
};
/** Always-ok budget for contexts with no DB to meter against (unit tests). */
const OK_BUDGET: BudgetGuard = { check: async () => {} };

const INBOUND_SYSTEM_PROMPT =
  "Sei l'addetto front-office della redazione di viaggi. Hai già la classificazione " +
  "(info/lead/reclamo) del messaggio in ingresso. Scrivi una risposta breve, cortese e " +
  "nel tono del brand. Rispondi SOLO con un oggetto JSON: {\"proposedReply\": string}. " +
  "Niente altro testo. Non promettere nulla che richieda conferma: l'umano rivedrà la risposta.";

const INBOUND_DEF_BASE = {
  id: "inbound",
  role: "Inbound: classifica i segnali in ingresso e propone una risposta e una qualifica del lead",
  systemPrompt: INBOUND_SYSTEM_PROMPT,
  maxSteps: 5,
  maxTokens: 3_000,
  maxContextTokens: 16_000,
  budgetCap: { inputTokens: 16_000, outputTokens: 3_000 },
  // Reuse an EXISTING Specialist axis (the type is the `Specialist` union, so
  // "inbound" is not assignable). Mirrors the Analyst/Researcher, which reuse "writer".
  autonomyAxis: "writer",
  proposalType: "lead_classification",
} satisfies Partial<AgentDefinition<InboundProposal>>;

/** `inboundProposalSchema` (zod) satisfies `SchemaLike` — the runner only calls safeParse/parse. */
const inboundProposalSchemaLike: SchemaLike<InboundProposal> = inboundProposalSchema;

/** Pull the LLM's refined reply (if it returned the agreed JSON; prose → none). */
function parseLlmReply(content: string): string | undefined {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object") {
      const reply = (parsed as Record<string, unknown>).proposedReply;
      if (typeof reply === "string" && reply.trim()) return reply.trim();
    }
  } catch {
    // Not JSON (e.g. the offline stub returns prose) → pure deterministic seed.
  }
  return undefined;
}

export class InboundAgent {
  private readonly accessors: InboundAccessors;
  private readonly resolveLlm: (tenantId: string) => Promise<LlmPort>;
  private readonly runnerDeps: { store: AgentRunStore; budget: BudgetGuard; logger?: RunLogger };

  constructor(deps: InboundAgentDeps) {
    if (!deps.llm === !deps.provider) {
      throw new Error("InboundAgent requires exactly one of { llm, provider }");
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
    input: InboundRunInput,
    ctx: { tenantId: string; taskId?: string; triggeredAt?: Date; runId?: string },
  ): Promise<Proposal<InboundProposal>> {
    // ── Deterministic seed (no LLM): classify the message and derive the reply,
    //    qualification and next action so the payload is valid — with the CORRECT
    //    classification — even from a prose stub.
    const classification = classifyInbound(input.message);
    const voice: BrandVoice = await this.accessors.brandVoice(ctx.tenantId);
    const seedReply = buildSeedReply(classification, voice.tone);
    const leadQualification = qualifyLead(classification, input.message, input.leadId);
    const nextAction = suggestNextAction(classification);
    const rationale =
      `Classificato come "${classification}" da euristica deterministica per parole chiave ` +
      `(DEBT-039). Proposta di risposta e qualifica derivate dal segnale; nessun invio.`;

    // A reclamo is delicate → balanced (Sonnet); everything else → fast (Haiku).
    const tier: ModelTier = classification === "reclamo" ? "balanced" : "fast";

    const tools: ToolDefinition[] = [
      createClassifyInboundTool() as ToolDefinition,
      createGetLeadsTool(this.accessors.leads) as ToolDefinition,
      createGetTenantSettingsTool(this.accessors.brandVoice) as ToolDefinition,
      createGetBookingsTool() as ToolDefinition,
      createRetrieveContextTool(this.accessors.rag) as ToolDefinition,
    ];
    const registry = new ToolRegistry(tools);

    const def: AgentDefinition<InboundProposal> = {
      ...INBOUND_DEF_BASE,
      model: tier,
      allowedTools: tools.map((t) => t.id),
      outputSchema: inboundProposalSchemaLike,
      // The classification/qualification/next-action close over the deterministic
      // seed; the LLM's JSON reply (or, for a prose stub, nothing) only refines
      // `proposedReply`, so `classification` is ALWAYS the heuristic's verdict.
      parseOutput: (content): InboundProposal => ({
        classification,
        proposedReply: parseLlmReply(content) ?? seedReply,
        ...(leadQualification ? { leadQualification } : {}),
        suggestedNextAction: nextAction,
        rationale,
      }),
    };

    const llm = await this.resolveLlm(ctx.tenantId);
    const runner = new AgentRunner({ llm, tools: registry, ...this.runnerDeps });
    // `subjectId` (idempotency) folds EVERY input that shapes the output: tenant,
    // the message AND the leadId — so a re-run with a different message/lead is NOT
    // a replay of the wrong classification (lezioni S1/S2/X1-F1).
    const subjectId = `${ctx.tenantId}|msg:${input.message}|lead:${input.leadId ?? ""}`;
    const agentInput: AgentInput = {
      subjectId,
      content: JSON.stringify({ message: input.message, classification, leadId: input.leadId }),
    };
    const runCtx: RunContext = {
      tenantId: ctx.tenantId,
      ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
      ...(ctx.triggeredAt ? { triggeredAt: ctx.triggeredAt } : {}),
      ...(ctx.runId ? { runId: ctx.runId } : {}),
    };

    const proposal = await runner.run<InboundProposal>(def, agentInput, runCtx);
    // IDEMPOTENCY: pin the id to `runId` so a re-run re-stages the SAME id →
    // `persist`'s onConflictDoNothing(id) dedupes (mirrors Analyst O1, lezioni S1/S2).
    return { ...proposal, id: proposal.runId };
  }
}
