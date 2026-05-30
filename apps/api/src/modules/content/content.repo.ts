import { eq, sql } from "drizzle-orm";
import type { Block } from "@blogs/contracts";
import type { Tx } from "../../platform/db/tenant";
import { contentItems } from "../../platform/db/schema";

export type ContentType = "article" | "itinerary";

/** A persisted content item (canonical row), tenant-scoped by RLS. */
export type ContentItemRow = typeof contentItems.$inferSelect;

export interface NewContentItem {
  tenantId: string;
  type: ContentType;
  title: string;
  blocks: Block[];
  status?: string;
}

/** Insert a content item under the current tenant context; returns the row. */
export async function insertContentItem(tx: Tx, input: NewContentItem): Promise<ContentItemRow> {
  const [row] = await tx
    .insert(contentItems)
    .values({
      tenantId: input.tenantId,
      type: input.type,
      title: input.title,
      blocks: input.blocks,
      ...(input.status ? { status: input.status } : {}),
    })
    .returning();
  // INSERT ... RETURNING always yields exactly the inserted row.
  return row as ContentItemRow;
}

/** Fetch a content item by id (RLS returns null for other tenants). */
export async function getContentItem(tx: Tx, id: string): Promise<ContentItemRow | null> {
  const rows = await tx.select().from(contentItems).where(eq(contentItems.id, id));
  return rows[0] ?? null;
}

/** Patch the editable fields of a content item, bumping updated_at. */
export async function updateContentItem(
  tx: Tx,
  id: string,
  patch: { title?: string; blocks?: Block[] },
): Promise<void> {
  await tx
    .update(contentItems)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(contentItems.id, id));
}
