import type { BrandVoice } from "@blogs/contracts";
import type { LlmClient } from "../../platform/ai/llm";

/**
 * Build the system prompt for a custom-trip proposal in the tenant's brand voice.
 * Reads the per-tenant voice (from Settings — paying down DEBT-010 for this path:
 * the proposal reads the stored brand voice, not a hard-coded constant). Mirrors
 * `platform/ai`'s `renderSystemPrompt`, but framed as a one-to-one travel-consultant
 * reply rather than a blog draft.
 */
export function renderProposalSystemPrompt(voice: BrandVoice): string {
  const tone = voice.tone.trim() || "caldo e professionale";
  const audience = voice.audience.trim() || "viaggiatori che cercano un viaggio su misura";
  return [
    "Sei un consulente di viaggi su misura.",
    `Tono: ${tone}.`,
    `Cliente: ${audience}.`,
    "Scrivi una proposta di viaggio personalizzata e un preventivo con acconto.",
    "L'AI propone, l'umano conferma: questa bozza sarà rivista prima di essere inviata.",
  ].join(" ");
}

/** Build the user prompt from the client's free-form request. */
export function buildProposalPrompt(request: string): string {
  return `Richiesta del cliente:\n${request}\n\nScrivi la proposta di viaggio.`;
}

export interface DraftProposalDeps {
  llm: LlmClient;
}

export interface DraftProposalInput {
  request: string;
  voice: BrandVoice;
}

/**
 * Draft a custom-trip proposal through the LLM port (a deterministic stub in
 * tests, the real Anthropic client behind `ANTHROPIC_API_KEY` in prod). Returns
 * the proposal text — which the human reviews before it is ever sent (the gate).
 */
export async function draftProposal(
  deps: DraftProposalDeps,
  input: DraftProposalInput,
): Promise<string> {
  const system = renderProposalSystemPrompt(input.voice);
  const prompt = buildProposalPrompt(input.request);
  return deps.llm.complete({ system, prompt });
}
