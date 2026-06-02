import { describe, it, expect } from "vitest";
import type { ResearchBrief } from "@blogs/contracts";
import { buildPrompt } from "./prompt";

// Slice X1 added a 4th `researchContext` param to `buildPrompt`. The backward-compat
// INVARIANT (mirror of `feedbackHint`): with it ABSENT the output must be
// BYTE-IDENTICAL to the 3-arg form, so the Writer's existing path is untouched.

const BRIEF = "Scrivi sul cibo in Giappone";
const CONTEXT = ["Tokyo ramen guide: best bowls in Shinjuku."];

describe("buildPrompt — researchContext backward compat (Slice X1)", () => {
  it("is byte-identical with no researchContext (vs the 3-arg call)", () => {
    expect(buildPrompt(BRIEF, CONTEXT)).toBe(buildPrompt(BRIEF, CONTEXT, undefined, undefined));
    // And identical whether or not the new param is passed at all.
    expect(buildPrompt(BRIEF, CONTEXT, "Indicazione X")).toBe(
      buildPrompt(BRIEF, CONTEXT, "Indicazione X", undefined),
    );
  });

  it("does not mention research when no researchContext is given", () => {
    expect(buildPrompt(BRIEF, CONTEXT)).not.toContain("Ricerca (fonti)");
  });

  it("weaves facts and sources into the prompt when researchContext is present", () => {
    const rc: ResearchBrief = {
      facts: ["Il ramen di Shinjuku è celebre."],
      sources: [{ title: "Guida Tokyo", url: "https://example.com/tokyo" }],
      keyInsights: [],
      gapsToFill: [],
      rationale: "",
    };
    const out = buildPrompt(BRIEF, CONTEXT, undefined, rc);
    expect(out).toContain("Ricerca (fonti):");
    expect(out).toContain("Il ramen di Shinjuku è celebre.");
    expect(out).toContain("Guida Tokyo (https://example.com/tokyo)");
    // The brief and the existing context are still present (the block is additive).
    expect(out).toContain(BRIEF);
    expect(out).toContain("Tokyo ramen guide");
    // The enriched prompt differs from the baseline (observable input).
    expect(out).not.toBe(buildPrompt(BRIEF, CONTEXT));
  });
});
