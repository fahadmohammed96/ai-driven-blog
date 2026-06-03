import type { ToolContext, ToolDefinition } from "../../tools";
import { schema, isObject } from "./schema";

/**
 * Generic sub-agent tool builder for the Editorial Orchestrator (agentic-plan
 * Slice O3, CRUX 1). The Orchestrator lives in `platform/ai/agents` and the
 * kernel MUST NOT import `modules/*` (the concrete `SeoAgent`/`AnalystAgent`
 * live in modules). So the `run-{writer,seo,analyst}` tools are GENERIC: they
 * carry only the call shape and receive a DISPATCH callback injected at the
 * composition-root, which binds them to the real sub-agents (each with its own
 * `AgentRunner` + budget). The kernel never names a module.
 *
 * Failure isolation lives in the Orchestrator (it wraps the dispatch so a sub-
 * agent throw — including `BudgetExceededError` from the per-sub-run budget re-
 * read — is caught and recorded in `agentNotes`, never propagated). The tool
 * itself is a thin shape; `ToolRegistry.dispatch` would also catch a throw, but
 * the Orchestrator's wrapper is what records the note.
 */

/** The instruction the Orchestrator hands a sub-agent (free-text brief/topic). */
export interface RunSubAgentInput {
  instruction: string;
}

/** The summary a sub-agent run returns to the Orchestrator's transcript. */
export interface RunSubAgentResult {
  agentId: string;
  ok: boolean;
  summary: string;
}

/**
 * The injected dispatch: runs the concrete sub-agent for `agentId` and returns a
 * short summary. The Orchestrator wraps the raw sub-agent call in try/catch so
 * this NEVER rejects — a failure resolves to `{ ok: false, … }` and is noted.
 */
export type SubAgentDispatch = (
  input: RunSubAgentInput,
  ctx: ToolContext,
) => Promise<RunSubAgentResult>;

function isInput(v: unknown): v is RunSubAgentInput {
  return isObject(v) && typeof v.instruction === "string";
}

function isResult(v: unknown): v is RunSubAgentResult {
  return (
    isObject(v) &&
    typeof v.agentId === "string" &&
    typeof v.ok === "boolean" &&
    typeof v.summary === "string"
  );
}

/**
 * Build a `run<SubAgent>` tool from an id, a description and an injected
 * dispatch. `tenantScoped` so the runner injects `tenantId`; `side: 'draft'`
 * because the sub-agent only PROPOSES (nothing it does publishes). The result is
 * truncated before re-entering the loop (caps context blow-up).
 */
export function createRunSubAgentTool(
  toolId: string,
  description: string,
  dispatch: SubAgentDispatch,
): ToolDefinition<RunSubAgentInput, RunSubAgentResult> {
  return {
    id: toolId,
    description,
    inputSchema: schema(`${toolId} input`, isInput),
    outputSchema: schema(`${toolId} output`, isResult),
    tenantScoped: true,
    side: "draft",
    maxOutputTokens: 1_500,
    stubArgs: () => ({ instruction: "Proponi un contributo per il prossimo slot editoriale." }),
    execute: (input, ctx) => dispatch(input, ctx),
  };
}
