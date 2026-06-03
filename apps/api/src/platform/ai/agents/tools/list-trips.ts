import type { ToolDefinition } from "../../tools";
import { schema, isObject } from "./schema";

/**
 * `listTrips` — the tenant's travel trips, serialized for the Orchestrator
 * (agentic-plan §4). Trips live in `modules/commerce`; the kernel must not
 * import it, so the tool speaks this local shape and the caller injects an
 * accessor adapting `trips` rows into it.
 */

export const LIST_TRIPS_TOOL_ID = "listTrips";

export interface TripSummary {
  id: string;
  title: string;
  theme?: string;
}

export type ListTripsAccessor = (tenantId: string) => Promise<TripSummary[]>;

/** No input — the runner injects `tenantId` (tenantScoped). */
export type ListTripsInput = Record<string, never>;

export interface ListTripsOutput {
  trips: TripSummary[];
}

function isOutput(v: unknown): v is ListTripsOutput {
  return isObject(v) && Array.isArray((v as { trips?: unknown }).trips);
}

export function createListTripsTool(
  acc: ListTripsAccessor,
): ToolDefinition<ListTripsInput, ListTripsOutput> {
  return {
    id: LIST_TRIPS_TOOL_ID,
    description:
      "Restituisce i viaggi del tenant (id, titolo, tema) come candidati da trasformare in contenuti.",
    inputSchema: schema("listTrips input", (v): v is ListTripsInput => isObject(v)),
    outputSchema: schema("listTrips output", isOutput),
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 2_000,
    stubArgs: () => ({}),
    execute: async (_input, ctx) => ({ trips: await acc(ctx.tenantId) }),
  };
}
