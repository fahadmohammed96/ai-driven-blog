import type { ToolDefinition } from "../../tools";
import { schema, isObject } from "./schema";

/**
 * `getMediaForStop` — the photos auto-organised onto an itinerary stop
 * (`itinerary_stop_photos`, agentic-plan §4). That table lives in the MEDIA
 * module; `platform/ai` must not import it. The tool speaks this local shape and
 * the caller injects an accessor that reads media under the tenant's RLS scope.
 */

export const GET_MEDIA_FOR_STOP_TOOL_ID = "getMediaForStop";

export interface StopPhoto {
  assetId: string;
  caption?: string;
  place?: string;
}

export interface StopMedia {
  photos: StopPhoto[];
}

export type GetMediaForStopAccessor = (
  tenantId: string,
  input: { itineraryId: string; stopIndex: number },
) => Promise<StopMedia>;

export interface GetMediaForStopInput {
  itineraryId: string;
  stopIndex: number;
}

function isInput(v: unknown): v is GetMediaForStopInput {
  return isObject(v) && typeof v.itineraryId === "string" && typeof v.stopIndex === "number";
}

function isOutput(v: unknown): v is StopMedia {
  return (
    isObject(v) &&
    Array.isArray(v.photos) &&
    v.photos.every((p) => isObject(p) && typeof p.assetId === "string")
  );
}

export function createGetMediaForStopTool(
  acc: GetMediaForStopAccessor,
): ToolDefinition<GetMediaForStopInput, StopMedia> {
  return {
    id: GET_MEDIA_FOR_STOP_TOOL_ID,
    description:
      "Restituisce le foto organizzate sulla tappa indicata (per incastonarle nell'articolo).",
    inputSchema: schema("getMediaForStop input", isInput),
    outputSchema: schema("getMediaForStop output", isOutput),
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 1_500,
    stubArgs: () => ({ itineraryId: "00000000-0000-0000-0000-000000000000", stopIndex: 0 }),
    execute: (input, ctx) =>
      acc(ctx.tenantId, { itineraryId: input.itineraryId, stopIndex: input.stopIndex }),
  };
}
