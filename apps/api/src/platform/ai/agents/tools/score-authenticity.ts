import type { Block } from "@blogs/contracts";
import { EXPERIENCE_SUGGESTION, measureAuthenticity } from "../../authenticity";

/**
 * Authenticity as the Writer's RUNNER EXIT GATE (agentic-plan §5, critica #4) —
 * NOT a tool in the loop. The score is a NUMBER, not editorial advice: feeding it
 * back as a tool would be circular. Instead the runner calls `scoreAuthenticity`
 * after an `end_turn`; if it's below threshold the runner appends
 * `buildAuthenticityFeedbackHint(score)` for EXACTLY ONE extra iteration.
 *
 * The scorer reuses the Phase-1 pure meter (`measureAuthenticity`, which judges
 * `Block[]`): the Writer's draft is a plain string, so we split it into
 * paragraph blocks first. No LLM, fully deterministic.
 */

/** Below this share of first-person paragraphs the draft reads as generic. */
export const AUTHENTICITY_THRESHOLD = 0.5;

/** Split a draft string into the paragraph blocks the Phase-1 meter judges. */
export function draftToBlocks(draft: string): Block[] {
  return draft
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((text) => ({ type: "paragraph", text }));
}

/** 0..1 share of substantial paragraphs that carry a lived, first-person voice. */
export function scoreAuthenticity(draft: string): number {
  return measureAuthenticity(draftToBlocks(draft)).score;
}

/** Deterministic, score-derived hint appended for the single authenticity retry. */
export function buildAuthenticityFeedbackHint(score: number): string {
  const pct = Math.round(score * 100);
  return (
    `La bozza risulta poco personale (autenticità ${pct}%). ` +
    `${EXPERIENCE_SUGGESTION} ` +
    "Riscrivi i passaggi generici in prima persona, con esperienze ed emozioni realmente vissute."
  );
}
