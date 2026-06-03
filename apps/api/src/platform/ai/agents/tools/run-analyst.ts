import type { ToolDefinition } from "../../tools";
import {
  createRunSubAgentTool,
  type RunSubAgentInput,
  type RunSubAgentResult,
  type SubAgentDispatch,
} from "./run-sub-agent";

/** `runAnalyst` — the Orchestrator's tool-adapter to the Analyst sub-agent (O3). */
export const RUN_ANALYST_TOOL_ID = "runAnalyst";

export function createRunAnalystTool(
  dispatch: SubAgentDispatch,
): ToolDefinition<RunSubAgentInput, RunSubAgentResult> {
  return createRunSubAgentTool(
    RUN_ANALYST_TOOL_ID,
    "Chiede all'analista un report sintetico delle performance cross-canale per orientare le priorità; restituisce un breve riassunto.",
    dispatch,
  );
}
