import { eq, sql } from "drizzle-orm";
import type { Block, PublicationStatus } from "@blogs/contracts";
import type { Db } from "../../platform/db/client";
import { withTenant, type Tx } from "../../platform/db/tenant";
import { contentItems } from "../../platform/db/schema";
import { nextStatus, type PublicationEvent } from "./state-machine";

export class ContentNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`content item not found: ${id}`);
    this.name = "ContentNotFoundError";
  }
}

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

/**
 * Drive a content item through the publication state machine, atomically.
 * Illegal transitions throw; `published_at` is stamped exactly once (the first
 * time it reaches 'published'); re-publishing a published item is a no-op.
 */
export async function transitionContentItem(
  tx: Tx,
  id: string,
  event: PublicationEvent,
): Promise<ContentItemRow> {
  const item = await getContentItem(tx, id);
  if (!item) throw new ContentNotFoundError(id);

  const to = nextStatus(item.status as PublicationStatus, event); // throws on illegal
  if (item.status === to) return item; // idempotent self-loop (publish when published)

  const patch: { status: PublicationStatus; updatedAt: ReturnType<typeof sql>; publishedAt?: ReturnType<typeof sql> } = {
    status: to,
    updatedAt: sql`now()`,
  };
  if (to === "published") patch.publishedAt = sql`now()`;

  const [row] = await tx.update(contentItems).set(patch).where(eq(contentItems.id, id)).returning();
  return row as ContentItemRow;
}

/** Tenant-scoped wrapper around {@link transitionContentItem}. */
export function applyTransition(
  db: Db,
  tenantId: string,
  id: string,
  event: PublicationEvent,
): Promise<ContentItemRow> {
  return withTenant(db, tenantId, (tx) => transitionContentItem(tx, id, event));
}

/** Publish a content item (idempotent): convenience for the 'publish' event. */
export function publishContentItem(db: Db, tenantId: string, id: string): Promise<ContentItemRow> {
  return applyTransition(db, tenantId, id, "publish");
}
