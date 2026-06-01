import type { Embedder } from "./embedder";
import type { LlmPort } from "./llm";

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

export function buildPrompt(brief: string, context: string[], feedbackHint?: string): string {
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
  return `${ctx}${hint}Brief: ${brief}\n\nScrivi una bozza di articolo.`;
}

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

/** RAG + brand voice: embed the brief, retrieve context, prompt the LLM. */
export async function generateDraft(
  deps: GenerateDraftDeps,
  input: GenerateDraftInput,
): Promise<DraftResult> {
  const queryEmbedding = await deps.embedder.embed(input.brief);
  const usedContext = await deps.retrieve(input.tenantId, queryEmbedding, input.k ?? 3);
  const system = renderSystemPrompt(input.voice);
  const prompt = buildPrompt(input.brief, usedContext, input.feedbackHint);
  // Single-shot generation via the generalized port — same external behaviour as
  // before (no tools, one round-trip, `balanced` tier == the previous Sonnet).
  // tenantId/agentId/runId are carried for the metering+audit that R1-B/A1 add;
  // the Writer becomes a real AgentRunner client in slice A1-writer.
  const response = await deps.llm.complete({
    tenantId: input.tenantId,
    agentId: "writer",
    runId: "generate-draft",
    model: "balanced",
    system: [{ type: "text", text: system }],
    messages: [{ role: "user", content: prompt }],
    maxTokens: 1500,
  });
  return { draft: response.content, usedContext, system };
}
