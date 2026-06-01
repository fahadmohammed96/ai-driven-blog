/**
 * Proposal<T> — the common envelope every AI agent emits (agentic-plan §6).
 *
 * The architectural invariant of the agentic platform (ADR-0020): the runtime
 * NEVER touches published state. An `AgentRunner` run produces exactly one
 * `Proposal<T>` that lands in a human gate (`requiresHumanGate` is always
 * `true` in propose-only). The payload is validated by the agent's
 * `outputSchema`; the cost/usage fields make the spend transparent in the
 * review surface; `truncated`/`auditRecorded` surface graceful degradation
 * (a partial run, or an audit write that failed) instead of hiding it.
 *
 * Generic over the payload `T` so each agent types its own output (a content
 * draft, an editorial plan, a lead classification, …) while sharing one
 * envelope, one gate contract, and one audit shape.
 */

export type ProposalStatus = "pending" | "approved" | "rejected" | "modified";

/**
 * The kind of proposal, which selects the human gate it flows into (see the
 * agent→gate map in agentic-plan §6). Kept open (`| string`) so a new agent can
 * introduce a new type without editing this union — the extensibility the user
 * asked for (vincolo #3).
 */
export type ProposalType =
  | "content_draft"
  | "editorial_plan"
  | "seo_suggestions"
  | "social_captions"
  | "email_draft"
  | "lead_classification"
  | "analyst_insight";

/** Token usage attributed to the run (sum across its LLM round-trips). */
export interface ProposalTokens {
  input: number;
  output: number;
  cached: number;
}

export interface Proposal<T = unknown> {
  id: string;
  tenantId: string;
  agentId: string;
  /** Joins toward `ai_agent_runs` — the run that produced this proposal. */
  runId: string;
  type: ProposalType | string;
  /** Validated against the agent's `outputSchema`. */
  payload: T;
  rationale: string;
  estimatedCostUsd: number;
  tokensUsed: ProposalTokens;
  status: ProposalStatus;
  /** ALWAYS true in propose-only: nothing is acted on without a human. */
  requiresHumanGate: true;
  /** A partial run (hit maxSteps / maxContextTokens before a clean finish). */
  truncated: boolean;
  /** False when the best-effort `ai_agent_runs` write failed (degraded, logged). */
  auditRecorded: boolean;
  /** Stable hash of the AgentDefinition snapshot that produced this proposal. */
  agentDefinitionVersion: string;
  createdAt: Date;
}
