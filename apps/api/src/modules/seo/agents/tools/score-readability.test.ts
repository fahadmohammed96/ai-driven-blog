import { describe, it, expect } from "vitest";
import {
  scoreReadability,
  seoAnalyze,
  countSyllables,
  createScoreReadabilityTool,
  createSeoAnalyzeTool,
} from "./score-readability";

// Deterministic SEO analysis tools (Flesch-Kincaid + keyword frequency) — NO
// LLM, pure functions over the draft text (agentic-plan §4/§5, Slice S1).

describe("scoreReadability (Flesch Reading Ease, deterministic)", () => {
  it("scores empty text as trivially readable (100)", () => {
    expect(scoreReadability("")).toBe(100);
    expect(scoreReadability("   ")).toBe(100);
  });

  it("is deterministic and clamped to 0..100", () => {
    const text = "Ho camminato lungo la costa al tramonto. Il mare era calmo.";
    const a = scoreReadability(text);
    const b = scoreReadability(text);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(100);
  });

  it("rates short, simple sentences as easier than long, complex ones", () => {
    const simple = "Vado al mare. Il sole è bello. Mi piace molto.";
    const complex =
      "L'organizzazione infrastrutturale dell'amministrazione metropolitana richiede una pianificazione particolarmente sofisticata e multidimensionale.";
    expect(scoreReadability(simple)).toBeGreaterThan(scoreReadability(complex));
  });

  it("counts syllables by vowel groups (min 1)", () => {
    expect(countSyllables("mare")).toBe(2);
    expect(countSyllables("casa")).toBe(2);
    expect(countSyllables("strada")).toBe(2);
    // No vowel → at least one syllable.
    expect(countSyllables("brr")).toBe(1);
  });
});

describe("seoAnalyze (keyword frequency, deterministic)", () => {
  it("picks the most frequent significant term as the primary keyword", () => {
    const text =
      "Il viaggio in Sicilia è un viaggio indimenticabile. Questo viaggio resta nel cuore.";
    const a = seoAnalyze(text);
    expect(a.primaryKeyword).toBe("viaggio");
    expect(a.wordCount).toBeGreaterThan(0);
    expect(a.keywordDensity).toBeGreaterThan(0);
    // Same input → same output.
    expect(seoAnalyze(text)).toEqual(a);
  });

  it("excludes stopwords and very short tokens", () => {
    const text = "il la le di che per con";
    expect(seoAnalyze(text).primaryKeyword).toBe("");
  });
});

describe("tool factories", () => {
  it("scoreReadability tool runs deterministically via execute()", async () => {
    const tool = createScoreReadabilityTool();
    const out = await tool.execute({ text: "Vado al mare. Il sole è bello." }, {
      tenantId: "t",
      agentId: "seo",
      runId: "r",
    });
    expect(out.score).toBe(scoreReadability("Vado al mare. Il sole è bello."));
    // stubArgs is valid against the tool's own input schema (StubLlmAdapter invariant).
    expect(tool.inputSchema.safeParse(tool.stubArgs()).success).toBe(true);
  });

  it("seoAnalyze tool stubArgs passes its own input schema", () => {
    const tool = createSeoAnalyzeTool();
    expect(tool.inputSchema.safeParse(tool.stubArgs()).success).toBe(true);
  });
});
