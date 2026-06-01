import { desc, eq } from "drizzle-orm";
import type { SeoProposal } from "@blogs/contracts";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { contentItems } from "../../platform/db/schema";
import { slugify } from "./agents/seo-agent";
import type { InternalLinkCandidate } from "./agents/tools/get-internal-link-candidates";
import type { ExistingContentItem } from "./agents/tools/get-existing-content";

/**
 * Real, RLS-scoped data accessors the SEO controller injects into the agent's
 * tools (the boundary seam — the agent itself stays pure). All reads go through
 * `withTenant`, so the tenant context drives RLS.
 *
 * TODO(debt): DEBT-028 — internal-link candidates are ranked by recency, not
 * pgvector similarity: `content_embeddings` carries no `content_item_id`, so
 * chunks can't be mapped back to linkable items yet.
 */

/** Related items to suggest as internal links: the tenant's other published items. */
export function makeInternalLinkCandidatesAccessor(db: Db) {
  return async (
    tenantId: string,
    _query: string,
    k: number,
  ): Promise<InternalLinkCandidate[]> =>
    withTenant(db, tenantId, async (tx) => {
      const rows = await tx
        .select({ id: contentItems.id, title: contentItems.title })
        .from(contentItems)
        .where(eq(contentItems.status, "published"))
        .orderBy(desc(contentItems.updatedAt))
        .limit(k);
      return rows.map((r) => ({ contentItemId: r.id, title: r.title }));
    });
}

/**
 * The tenant's existing items (title + slug) for anti-cannibalization and slug
 * collision. A slug is the approved SEO slug if present, else derived from the
 * title (so even un-annotated items reserve their natural slug).
 */
export function makeExistingContentAccessor(db: Db) {
  return async (tenantId: string): Promise<ExistingContentItem[]> =>
    withTenant(db, tenantId, async (tx) => {
      const rows = await tx
        .select({
          id: contentItems.id,
          title: contentItems.title,
          seoProposal: contentItems.seoProposal,
        })
        .from(contentItems);
      return rows.map((r) => ({
        contentItemId: r.id,
        title: r.title,
        slug: (r.seoProposal as SeoProposal | null)?.slug ?? slugify(r.title),
      }));
    });
}
