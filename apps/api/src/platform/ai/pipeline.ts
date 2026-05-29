import type { Embedder } from "./embedder";
import type { LlmClient } from "./llm";

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

export function buildPrompt(brief: string, context: string[]): string {
  const ctx = context.length
    ? `Contesto dai contenuti dell'utente:\n${context
        .map((c, i) => `[${i + 1}] ${c}`)
        .join("\n")}\n\n`
    : "";
  return `${ctx}Brief: ${brief}\n\nScrivi una bozza di articolo.`;
}

export interface GenerateDraftDeps {
  embedder: Embedder;
  llm: LlmClient;
  retrieve: (tenantId: string, queryEmbedding: number[], k: number) => Promise<string[]>;
}

export interface GenerateDraftInput {
  tenantId: string;
  brief: string;
  voice: BrandVoice;
  k?: number;
}

export interface DraftResult {
  draft: string;
  usedContext: string[];
  system: string;
}

/** RAG + brand voice: embed the brief, retrieve context, prompt the LLM. */
export async function generateDraft(
  deps: GenerateDraftDeps,
  input: GenerateDraftInput,
): Promise<DraftResult> {
  const queryEmbedding = await deps.embedder.embed(input.brief);
  const usedContext = await deps.retrieve(input.tenantId, queryEmbedding, input.k ?? 3);
  const system = renderSystemPrompt(input.voice);
  const prompt = buildPrompt(input.brief, usedContext);
  const draft = await deps.llm.complete({ system, prompt });
  return { draft, usedContext, system };
}
