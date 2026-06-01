import type { ToolDefinition } from "../../tools";
import { schema, isObject } from "./schema";

/**
 * `getItinerary` — the travel itinerary serialized for the Writer (agentic-plan
 * §4). The itinerary lives in the TRAVEL vertical; `platform/ai` must not import
 * it (kernel boundary). So the tool speaks only this local, serialisable shape,
 * and the caller (the travel controller, which MAY import travel) injects an
 * accessor that adapts the real `Itinerary` into it.
 */

export const GET_ITINERARY_TOOL_ID = "getItinerary";

export interface SerializedStop {
  place: string;
  notes?: string;
  startDate?: string;
  endDate?: string;
}

export interface SerializedItinerary {
  title: string;
  stops: SerializedStop[];
}

export type GetItineraryAccessor = (
  tenantId: string,
  itineraryId: string,
) => Promise<SerializedItinerary>;

export interface GetItineraryInput {
  itineraryId: string;
}

function isInput(v: unknown): v is GetItineraryInput {
  return isObject(v) && typeof v.itineraryId === "string";
}

function isOutput(v: unknown): v is SerializedItinerary {
  return (
    isObject(v) &&
    typeof v.title === "string" &&
    Array.isArray(v.stops) &&
    v.stops.every((s) => isObject(s) && typeof s.place === "string")
  );
}

export function createGetItineraryTool(
  acc: GetItineraryAccessor,
): ToolDefinition<GetItineraryInput, SerializedItinerary> {
  return {
    id: GET_ITINERARY_TOOL_ID,
    description:
      "Restituisce l'itinerario (titolo e tappe con date e appunti) da cui scrivere l'articolo.",
    inputSchema: schema("getItinerary input", isInput),
    outputSchema: schema("getItinerary output", isOutput),
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 3_000,
    stubArgs: () => ({ itineraryId: "00000000-0000-0000-0000-000000000000" }),
    execute: (input, ctx) => acc(ctx.tenantId, input.itineraryId),
  };
}
