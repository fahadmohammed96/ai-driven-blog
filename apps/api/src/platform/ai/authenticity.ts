import type { Block } from "@blogs/contracts";

/** Where a draft reads as generic rather than lived — a nudge to add experience. */
export interface AuthenticityFlag {
  blockIndex: number;
  heading?: string;
  suggestion: string;
}

export interface AuthenticityReport {
  /** Share of substantial paragraphs that carry a first-person/experiential voice (0..1). */
  score: number;
  flags: AuthenticityFlag[];
}

export const EXPERIENCE_SUGGESTION =
  "Aggiungi un'esperienza personale o un dettaglio sensoriale qui.";

/** Below this length a paragraph is treated as a caption/aside, not judged. */
const MIN_PARAGRAPH_LENGTH = 40;

/**
 * Heuristic "experience meter" (NOT an AI detector): a paragraph reads as lived
 * when it carries a first-person Italian voice. Generic, substantial paragraphs
 * are flagged so the human knows where to add real experience (E-E-A-T).
 */
/** First-person Italian markers that signal a lived, personal account. */
const FIRST_PERSON =
  /\b(io|mi|me|mia|mio|miei|mie|ho|abbiamo|siamo|ci|nostro|nostra|nostri|nostre|ricordo|ricordi)\b/i;

function hasExperientialVoice(text: string): boolean {
  return FIRST_PERSON.test(text);
}

export function measureAuthenticity(blocks: Block[]): AuthenticityReport {
  const flags: AuthenticityFlag[] = [];
  let considered = 0;
  let experiential = 0;
  let currentHeading: string | undefined;

  blocks.forEach((block, index) => {
    if (block.type === "heading") {
      currentHeading = block.text;
      return;
    }
    if (block.type !== "paragraph") return;
    if (block.text.length < MIN_PARAGRAPH_LENGTH) return;

    considered += 1;
    if (hasExperientialVoice(block.text)) {
      experiential += 1;
    } else {
      flags.push({
        blockIndex: index,
        ...(currentHeading ? { heading: currentHeading } : {}),
        suggestion: EXPERIENCE_SUGGESTION,
      });
    }
  });

  const score = considered === 0 ? 1 : experiential / considered;
  return { score, flags };
}
