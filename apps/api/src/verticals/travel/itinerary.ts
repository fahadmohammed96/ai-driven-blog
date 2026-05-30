import type { Block, Itinerary, ItineraryStop } from "@blogs/contracts";

/** Human-readable date span for a stop ("2026-04-01" or "2026-04-01 – 2026-04-04"). */
export function formatStopDates(stop: ItineraryStop): string {
  return stop.startDate === stop.endDate
    ? stop.startDate
    : `${stop.startDate} – ${stop.endDate}`;
}

/**
 * Serialize an itinerary into canonical blocks (ADR-0004): a title heading, then
 * for each stop a level-2 heading and a paragraph with its dates and notes.
 * Pure transform — the editable structured Itinerary projected to portable blocks.
 */
export function itineraryToBlocks(itinerary: Itinerary): Block[] {
  const blocks: Block[] = [{ type: "heading", level: 1, text: itinerary.title }];
  for (const stop of itinerary.stops) {
    blocks.push({ type: "heading", level: 2, text: stop.place });
    const parts = [formatStopDates(stop)];
    if (stop.notes) parts.push(stop.notes);
    blocks.push({ type: "paragraph", text: parts.join(" — ") });
  }
  return blocks;
}
