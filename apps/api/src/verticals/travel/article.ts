import type { Block, Itinerary, ItineraryStop } from "@blogs/contracts";
import { renderSystemPrompt, type BrandVoice } from "../../platform/ai/pipeline";
import type { LlmClient } from "../../platform/ai/llm";
import { measureAuthenticity, type AuthenticityReport } from "../../platform/ai/authenticity";
import { formatStopDates } from "./itinerary";

/** A photo to weave into the article, bound to a stop by index. */
export interface ArticlePhoto {
  assetId: string;
  stopIndex: number;
  alt?: string;
  caption?: string;
}

export interface AssembleArticleDeps {
  llm: LlmClient;
  /** Optional RAG: retrieve context paragraphs to ground the user's voice. */
  retrieve?: (query: string) => Promise<string[]>;
}

export interface AssembleArticleInput {
  itinerary: Itinerary;
  voice: BrandVoice;
  userNotes?: string;
  photos?: ArticlePhoto[];
}

export interface ArticleDraft {
  blocks: Block[];
  authenticity: AuthenticityReport;
  system: string;
}

function stopPrompt(
  itinerary: Itinerary,
  stop: ItineraryStop,
  userNotes: string | undefined,
  context: string[],
): string {
  const lines = [
    `Articolo di viaggio: "${itinerary.title}".`,
    `Scrivi un paragrafo sulla tappa "${stop.place}" (${formatStopDates(stop)}).`,
  ];
  if (stop.notes) lines.push(`Appunti di tappa: ${stop.notes}`);
  if (userNotes) lines.push(`Note dell'autore: ${userNotes}`);
  if (context.length) {
    lines.push(
      `Contesto dai contenuti dell'utente:\n${context.map((c, i) => `[${i + 1}] ${c}`).join("\n")}`,
    );
  }
  lines.push("Restituisci solo il testo del paragrafo, nella voce indicata.");
  return lines.join("\n");
}

/**
 * Build an article draft from an itinerary: a title, then for each stop a
 * heading, an LLM-written paragraph (brand voice + optional RAG) and the photos
 * organized into that stop, embedded in place. Returns the blocks plus an
 * authenticity report pointing at sections that still read generic.
 */
export async function assembleArticleFromItinerary(
  deps: AssembleArticleDeps,
  input: AssembleArticleInput,
): Promise<ArticleDraft> {
  const system = renderSystemPrompt(input.voice);
  const photos = input.photos ?? [];
  const blocks: Block[] = [{ type: "heading", level: 1, text: input.itinerary.title }];

  for (let i = 0; i < input.itinerary.stops.length; i++) {
    const stop = input.itinerary.stops[i]!;
    const context = deps.retrieve
      ? await deps.retrieve(`${input.itinerary.title} ${stop.place} ${stop.notes ?? ""}`)
      : [];
    const prose = await deps.llm.complete({ system, prompt: stopPrompt(input.itinerary, stop, input.userNotes, context) });

    blocks.push({ type: "heading", level: 2, text: stop.place });
    blocks.push({ type: "paragraph", text: prose.trim() });

    for (const photo of photos.filter((p) => p.stopIndex === i)) {
      blocks.push({
        type: "image",
        assetId: photo.assetId,
        alt: photo.alt ?? stop.place,
        ...(photo.caption ? { caption: photo.caption } : {}),
      });
    }
  }

  return { blocks, authenticity: measureAuthenticity(blocks), system };
}
