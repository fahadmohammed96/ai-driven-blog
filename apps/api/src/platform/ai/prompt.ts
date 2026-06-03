/**
 * Brand-voice + prompt assembly for the Writer (extracted from `pipeline.ts` so
 * the Writer agent and its tools can reuse it WITHOUT importing `pipeline.ts` —
 * which now imports the agent, and would otherwise form a cycle). `pipeline.ts`
 * re-exports these so existing callers (`verticals/travel/article.ts`, tests)
 * keep importing them from `./pipeline` unchanged.
 */

import type { ResearchBrief } from "@blogs/contracts";

export interface BrandVoice {
  tone: string;
  audience: string;
}

export function renderSystemPrompt(voice: BrandVoice): string {
  return [
    "Sei un redattore di blog di viaggio.",
    `Tono: ${voice.tone}.`,
    `Pubblico: ${voice.audience}.`,
    "Scrivi in questa voce. L'AI propone, l'umano conferma.",
  ].join(" ");
}

export function buildPrompt(
  brief: string,
  context: string[],
  feedbackHint?: string,
  researchContext?: ResearchBrief,
): string {
  const ctx = context.length
    ? `Contesto dai contenuti dell'utente:\n${context
        .map((c, i) => `[${i + 1}] ${c}`)
        .join("\n")}\n\n`
    : "";
  // The metric-derived hint from the feedback loop (Slice 2) — a REAL input that
  // observably shapes the generation prompt. The LLM stays stubbed at the
  // boundary; what changes is the instruction it receives (ADR-0026).
  const hint = feedbackHint?.trim()
    ? `Indicazione dai dati (loop di feedback): ${feedbackHint.trim()}\n\n`
    : "";
  // The Researcher's brief (Slice X1), woven in like `feedbackHint`: a REAL input
  // that shapes the prompt. BACKWARD-COMPAT INVARIANT — with `researchContext`
  // absent this is the empty string, so the prompt is BYTE-IDENTICAL to before.
  const research = researchContext ? renderResearchBlock(researchContext) : "";
  return `${ctx}${hint}${research}Brief: ${brief}\n\nScrivi una bozza di articolo.`;
}

/** Render the Researcher's facts/sources as a prompt block (Slice X1). */
function renderResearchBlock(rc: ResearchBrief): string {
  const lines: string[] = ["Ricerca (fonti):"];
  for (const f of rc.facts) lines.push(`- ${f}`);
  for (const s of rc.sources) lines.push(`- Fonte: ${s.title} (${s.url})`);
  return `${lines.join("\n")}\n\n`;
}
