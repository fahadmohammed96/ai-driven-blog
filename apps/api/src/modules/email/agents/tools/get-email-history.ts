import type { ToolDefinition } from "../../../../platform/ai/tools";
import { schema, isObject } from "./schema";

/**
 * `getEmailHistory` — past newsletter performance for the tenant, so the LLM can
 * mimic subjects that resonated (agentic-plan §4, Slice S3). The signal would
 * come from `metric_snapshots` (open/click rates per send); that read is the
 * INJECTED accessor's job, under the tenant's RLS scope.
 *
 * TODO(debt): DEBT-032 — no email-engagement source is wired yet
 * (`metric_snapshots` carries no per-newsletter dimension), so the default
 * accessor is a deterministic empty stub. Trigger: when newsletter open/click
 * metrics land. Keeps the CI at zero cost and the seam (injected accessor) is
 * already the right one — only the implementation is swapped.
 */

export const GET_EMAIL_HISTORY_TOOL_ID = "getEmailHistory";

const DEFAULT_LIMIT = 3;

/** A past newsletter surfaced as an exemplar (subject the model can learn from). */
export interface EmailHistoryEntry {
  subject: string;
  /** Open rate in [0, 1] if known; 0 from the stub. */
  openRate: number;
}

/** Injected at the boundary: rank the tenant's past newsletters (RLS-scoped). */
export type EmailHistoryAccessor = (tenantId: string, limit: number) => Promise<EmailHistoryEntry[]>;

/**
 * The deterministic stub accessor (DEBT-032): no email-engagement source is
 * wired, so it returns no exemplars. Swapped for the real ranking accessor when
 * newsletter metrics are joinable.
 */
export const STUB_EMAIL_HISTORY: EmailHistoryAccessor = async () => [];

export interface GetEmailHistoryInput {
  limit?: number;
}

function isInput(v: unknown): v is GetEmailHistoryInput {
  return isObject(v) && (v.limit === undefined || typeof v.limit === "number");
}

function isOutput(v: unknown): v is { entries: EmailHistoryEntry[] } {
  return (
    isObject(v) &&
    Array.isArray(v.entries) &&
    v.entries.every(
      (e) => isObject(e) && typeof e.subject === "string" && typeof e.openRate === "number",
    )
  );
}

export function createGetEmailHistoryTool(
  acc: EmailHistoryAccessor = STUB_EMAIL_HISTORY,
): ToolDefinition<GetEmailHistoryInput, { entries: EmailHistoryEntry[] }> {
  return {
    id: GET_EMAIL_HISTORY_TOOL_ID,
    description:
      "Restituisce le newsletter passate con il miglior tasso di apertura (esempi di subject). Stub finché non ci sono metriche email.",
    inputSchema: schema("getEmailHistory input", isInput),
    outputSchema: schema("getEmailHistory output", isOutput),
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 600,
    stubArgs: () => ({ limit: DEFAULT_LIMIT }),
    execute: async (input, ctx) => ({
      entries: await acc(ctx.tenantId, input.limit ?? DEFAULT_LIMIT),
    }),
  };
}
