import type { Embedder } from "./embedder";
import type { LlmPort } from "./llm";
import { WriterAgent } from "./agents/writer-agent";

// Brand-voice + prompt assembly moved to `./prompt` to break the pipeline↔Writer
// import cycle; re-exported so existing callers keep importing from `./pipeline`.
export {
  renderSystemPrompt,
  buildPrompt,
  type BrandVoice,
} from "./prompt";
import type { BrandVoice } from "./prompt";

export interface GenerateDraftDeps {
  embedder: Embedder;
  llm: LlmPort;
  retrieve: (tenantId: string, queryEmbedding: number[], k: number) => Promise<string[]>;
}

export interface GenerateDraftInput {
  tenantId: string;
  brief: string;
  voice: BrandVoice;
  k?: number;
  /**
   * Optional metric-derived hint from the feedback loop (Fase 4, Slice 2): the
   * `promptHint` of a {@link ContentProposal} (e.g. "favour pinterest"). When
   * present it is woven into the prompt so the next cycle's draft adapts to what
   * performed — the loop changes WHAT is generated, the human still approves.
   * TODO(debt): DEBT-014 — the live generation endpoint
   * (`verticals/travel/itineraries.controller.ts`) does not yet pull this hint
   * from `FeedbackService`; the bridge is here + tested, the auto-injection is
   * the follow-up (tied to the autonomy engine).
   */
  feedbackHint?: string;
}

export interface DraftResult {
  draft: string;
  usedContext: string[];
  system: string;
}

/**
 * RAG + brand voice draft generation. As of slice A1-writer this is a THIN
 * WRAPPER over {@link WriterAgent} (the Writer is now a real `AgentRunner`
 * client): identical external behaviour — same RAG retrieval, same brand-voice
 * system prompt, same single-shot draft for the deterministic stub — so every
 * caller (`itineraries.controller.ts`, …) is untouched. The Writer adds the
 * authenticity exit gate on top, which only triggers a (single) retry when the
 * model returns generic prose; the offline stub draft is first-person and passes
 * it on the first turn, keeping CI/E2E to one round-trip.
 */
export async function generateDraft(
  deps: GenerateDraftDeps,
  input: GenerateDraftInput,
): Promise<DraftResult> {
  const writer = new WriterAgent({
    llm: deps.llm,
    accessors: {
      embed: (text) => deps.embedder.embed(text),
      retrieve: deps.retrieve,
    },
  });
  const proposal = await writer.run(
    {
      brief: input.brief,
      voice: input.voice,
      ...(input.k !== undefined ? { k: input.k } : {}),
      ...(input.feedbackHint !== undefined ? { feedbackHint: input.feedbackHint } : {}),
    },
    { tenantId: input.tenantId },
  );
  return {
    draft: proposal.payload.draft,
    usedContext: proposal.payload.usedContext,
    system: proposal.payload.system,
  };
}
