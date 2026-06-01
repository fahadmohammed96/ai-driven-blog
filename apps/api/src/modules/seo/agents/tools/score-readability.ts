import type { ToolDefinition } from "../../../../platform/ai/tools";
import { schema, isObject } from "./schema";

/**
 * `scoreReadability` / `seoAnalyze` — the SEO Agent's DETERMINISTIC analysis
 * tools (agentic-plan §4, Slice S1). NO LLM: readability is Flesch Reading Ease,
 * keyword analysis is plain frequency — pure functions over the draft text, so
 * the model orchestrates but never recomputes the maths (cost control §5). Both
 * are also the runner's pre-computation seed (see `SeoAgent.run`).
 */

// ── Flesch Reading Ease (readability) ────────────────────────────────────────

const VOWELS = "aeiouyàèéìíòóùúâêîôûäëïöü";

/** Count syllables in a word ≈ number of maximal vowel groups (min 1). */
export function countSyllables(word: string): number {
  const w = word.toLowerCase();
  let groups = 0;
  let inVowel = false;
  for (const ch of w) {
    const isVowel = VOWELS.includes(ch);
    if (isVowel && !inVowel) groups += 1;
    inVowel = isVowel;
  }
  return Math.max(1, groups);
}

function words(text: string): string[] {
  return text.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
}

function sentenceCount(text: string): number {
  const parts = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  return Math.max(1, parts.length);
}

/**
 * Flesch Reading Ease (0..100, higher = easier), clamped. Deterministic over the
 * input text; an empty text scores 100 (nothing to read is trivially "easy").
 */
export function scoreReadability(text: string): number {
  const ws = words(text);
  if (ws.length === 0) return 100;
  const sentences = sentenceCount(text);
  const syllables = ws.reduce((sum, w) => sum + countSyllables(w), 0);
  const wordsPerSentence = ws.length / sentences;
  const syllablesPerWord = syllables / ws.length;
  const raw = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
  return Math.round(Math.min(100, Math.max(0, raw)) * 100) / 100;
}

// ── Keyword analysis (anti-thin: density + primary keyword) ───────────────────

/** Common IT/EN stopwords excluded from the primary-keyword pick. */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "are", "was",
  "il", "lo", "la", "le", "gli", "un", "una", "di", "che", "per", "con", "del",
  "della", "delle", "dei", "degli", "una", "uno", "non", "più", "come", "ogni",
  "sono", "stato", "stata", "questa", "questo", "ho", "ha", "si", "se", "ma",
]);

export interface SeoAnalysis {
  wordCount: number;
  /** The most frequent significant term (stopwords/short tokens excluded). */
  primaryKeyword: string;
  /** Share of total words the primary keyword represents (0..1). */
  keywordDensity: number;
}

/** Deterministic keyword analysis over the draft text. */
export function seoAnalyze(text: string): SeoAnalysis {
  const ws = words(text).map((w) => w.toLowerCase());
  const wordCount = ws.length;
  const freq = new Map<string, number>();
  for (const w of ws) {
    if (w.length <= 2 || STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  let primaryKeyword = "";
  let best = 0;
  // Ties broken deterministically by first appearance order (Map keeps insertion).
  for (const [word, count] of freq) {
    if (count > best) {
      best = count;
      primaryKeyword = word;
    }
  }
  return {
    wordCount,
    primaryKeyword,
    keywordDensity: wordCount > 0 ? best / wordCount : 0,
  };
}

// ── Tool factories (no accessor — pure) ───────────────────────────────────────

export const SCORE_READABILITY_TOOL_ID = "scoreReadability";
export const SEO_ANALYZE_TOOL_ID = "seoAnalyze";

interface TextInput {
  text: string;
}
function isTextInput(v: unknown): v is TextInput {
  return isObject(v) && typeof v.text === "string";
}

export function createScoreReadabilityTool(): ToolDefinition<TextInput, { score: number }> {
  return {
    id: SCORE_READABILITY_TOOL_ID,
    description:
      "Calcola la leggibilità del testo (Flesch Reading Ease, 0..100: più alto = più leggibile). Deterministico, nessun LLM.",
    inputSchema: schema("scoreReadability input", isTextInput),
    outputSchema: schema(
      "scoreReadability output",
      (v): v is { score: number } => isObject(v) && typeof v.score === "number",
    ),
    tenantScoped: false,
    side: "read",
    maxOutputTokens: 200,
    stubArgs: () => ({ text: "Un breve testo di esempio." }),
    execute: async (input) => ({ score: scoreReadability(input.text) }),
  };
}

export function createSeoAnalyzeTool(): ToolDefinition<TextInput, SeoAnalysis> {
  return {
    id: SEO_ANALYZE_TOOL_ID,
    description:
      "Analizza il testo per parola chiave primaria, densità e conteggio parole. Deterministico, nessun LLM.",
    inputSchema: schema("seoAnalyze input", isTextInput),
    outputSchema: schema(
      "seoAnalyze output",
      (v): v is SeoAnalysis =>
        isObject(v) &&
        typeof v.wordCount === "number" &&
        typeof v.primaryKeyword === "string" &&
        typeof v.keywordDensity === "number",
    ),
    tenantScoped: false,
    side: "read",
    maxOutputTokens: 300,
    stubArgs: () => ({ text: "Un breve testo di esempio." }),
    execute: async (input) => seoAnalyze(input.text),
  };
}
