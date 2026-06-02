import type { ToolDefinition } from "../../tools";
import {
  createRunSubAgentTool,
  type RunSubAgentInput,
  type RunSubAgentResult,
  type SubAgentDispatch,
} from "./run-sub-agent";

/** `runSeo` — the Orchestrator's tool-adapter to the SEO sub-agent (O3). */
export const RUN_SEO_TOOL_ID = "runSeo";

export function createRunSeoTool(
  dispatch: SubAgentDispatch,
): ToolDefinition<RunSubAgentInput, RunSubAgentResult> {
  return createRunSubAgentTool(
    RUN_SEO_TOOL_ID,
    "Chiede allo specialista SEO suggerimenti (title/meta/keyword/link) per uno slot; restituisce un breve riassunto.",
    dispatch,
  );
}
