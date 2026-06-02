import type { ToolDefinition } from "../../tools";
import {
  createRunSubAgentTool,
  type RunSubAgentInput,
  type RunSubAgentResult,
  type SubAgentDispatch,
} from "./run-sub-agent";

/** `runWriter` — the Orchestrator's tool-adapter to the Writer sub-agent (O3). */
export const RUN_WRITER_TOOL_ID = "runWriter";

export function createRunWriterTool(
  dispatch: SubAgentDispatch,
): ToolDefinition<RunSubAgentInput, RunSubAgentResult> {
  return createRunSubAgentTool(
    RUN_WRITER_TOOL_ID,
    "Chiede al redattore (Writer) una bozza/anteprima per uno slot editoriale; restituisce un breve riassunto.",
    dispatch,
  );
}
