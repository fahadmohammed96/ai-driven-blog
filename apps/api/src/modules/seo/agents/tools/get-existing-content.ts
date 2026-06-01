import type { ToolDefinition } from "../../../../platform/ai/tools";
import { schema, isObject } from "./schema";

/**
 * `getExistingContent` — the tenant's existing items (title + slug), for two SEO
 * jobs (agentic-plan §4, Slice S1): (1) ANTI-CANNIBALIZATION — the model avoids
 * proposing a title/keyword that competes with content the tenant already ranks
 * for; (2) SLUG COLLISION — `SeoAgent` derives a unique slug against this set.
 *
 * BOUNDARY: the caller injects the accessor (a tenant-scoped `content_items`
 * read), so the tool never imports the content module's internals.
 */

export const GET_EXISTING_CONTENT_TOOL_ID = "getExistingContent";

/** An existing tenant item, as seen by the SEO agent. */
export interface ExistingContentItem {
  contentItemId: string;
  title: string;
  slug: string;
}

/** Injected at the boundary: list the tenant's existing content (title + slug). */
export type ExistingContentAccessor = (tenantId: string) => Promise<ExistingContentItem[]>;

function isOutput(v: unknown): v is { items: ExistingContentItem[] } {
  return (
    isObject(v) &&
    Array.isArray(v.items) &&
    v.items.every(
      (i) =>
        isObject(i) &&
        typeof i.contentItemId === "string" &&
        typeof i.title === "string" &&
        typeof i.slug === "string",
    )
  );
}

export function createGetExistingContentTool(
  acc: ExistingContentAccessor,
): ToolDefinition<Record<string, never>, { items: ExistingContentItem[] }> {
  return {
    id: GET_EXISTING_CONTENT_TOOL_ID,
    description:
      "Elenca i contenuti esistenti del tenant (titolo + slug) per evitare cannibalizzazione e collisioni di slug.",
    inputSchema: schema("getExistingContent input", (v): v is Record<string, never> => isObject(v)),
    outputSchema: schema("getExistingContent output", isOutput),
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 1_500,
    stubArgs: () => ({}),
    execute: async (_input, ctx) => ({ items: await acc(ctx.tenantId) }),
  };
}
