import type { ToolDefinition } from "../../tools";
import { schema, isObject } from "./schema";

/**
 * `getContentCalendar` — the tenant's scheduled/in-flight content, serialized for
 * the Orchestrator (agentic-plan §4). Content lives in `modules/content`; the
 * kernel must not import it, so the tool speaks this local shape and the caller
 * injects an accessor that adapts `content_items` rows into it.
 */

export const GET_CONTENT_CALENDAR_TOOL_ID = "getContentCalendar";

export interface CalendarEntry {
  contentItemId: string;
  title: string;
  status: string;
}

export type GetContentCalendarAccessor = (tenantId: string) => Promise<CalendarEntry[]>;

/** No input — the runner injects `tenantId` (tenantScoped). */
export type GetContentCalendarInput = Record<string, never>;

export interface GetContentCalendarOutput {
  entries: CalendarEntry[];
}

function isOutput(v: unknown): v is GetContentCalendarOutput {
  return isObject(v) && Array.isArray((v as { entries?: unknown }).entries);
}

export function createGetContentCalendarTool(
  acc: GetContentCalendarAccessor,
): ToolDefinition<GetContentCalendarInput, GetContentCalendarOutput> {
  return {
    id: GET_CONTENT_CALENDAR_TOOL_ID,
    description:
      "Restituisce i contenuti programmati/in lavorazione del tenant (id, titolo, stato) per pianificare il calendario.",
    inputSchema: schema("getContentCalendar input", (v): v is GetContentCalendarInput => isObject(v)),
    outputSchema: schema("getContentCalendar output", isOutput),
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 2_000,
    stubArgs: () => ({}),
    execute: async (_input, ctx) => ({ entries: await acc(ctx.tenantId) }),
  };
}
