import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { Block, PublicationStatus } from "@blogs/contracts";
import type { Db } from "../../platform/db/client";
import { withTenant, type Tx } from "../../platform/db/tenant";
import { contentItems } from "../../platform/db/schema";
import { nextStatus, InvalidTransitionError, type PublicationEvent } from "./state-machine";

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

/** Optional filters for the content-item list read-model. */
export interface ContentListFilters {
  type?: ContentType;
  status?: PublicationStatus;
}

/**
 * List the current tenant's content items (RLS scopes to the tenant context),
 * newest-touched first. `type` / `status` narrow the result when provided.
 * Read-model behind the Library surface (slice 1).
 */
export async function listContentItems(
  tx: Tx,
  filters: ContentListFilters = {},
): Promise<ContentItemRow[]> {
  const conds: SQL[] = [];
  if (filters.type) conds.push(eq(contentItems.type, filters.type));
  if (filters.status) conds.push(eq(contentItems.status, filters.status));
  const where = conds.length ? and(...conds) : undefined;
  return tx
    .select()
    .from(contentItems)
    .where(where)
    .orderBy(desc(contentItems.updatedAt));
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

/**
 * The legal chain an item awaiting a human decision walks to reach 'approved'.
 * `proposed` first enters `review`, then is approved — the human's "approve" on
 * the Proposal Queue (slice 3) collapses that chain into one gesture.
 */
const APPROVE_PATH: Partial<Record<PublicationStatus, PublicationEvent>> = {
  proposed: "startReview",
  review: "approve",
};

export type ProposalDecision = "approve" | "reject";

/**
 * Apply a human decision to a content item awaiting review (status `proposed`
 * or `review`) over the publish state machine, atomically and tenant-scoped
 * (RLS). `approve` walks it to `approved` through the legal chain
 * (proposed→review→approved); `reject` sends it back to `draft` (requestChanges).
 * An illegal source state throws {@link InvalidTransitionError}; a missing/foreign
 * item throws {@link ContentNotFoundError}.
 */
export async function decideContentItem(
  db: Db,
  tenantId: string,
  id: string,
  decision: ProposalDecision,
): Promise<ContentItemRow> {
  return withTenant(db, tenantId, async (tx) => {
    let item = await getContentItem(tx, id);
    if (!item) throw new ContentNotFoundError(id);
    if (decision === "reject") return transitionContentItem(tx, id, "requestChanges");
    while (item.status !== "approved") {
      const event = APPROVE_PATH[item.status as PublicationStatus];
      if (!event) throw new InvalidTransitionError(item.status as PublicationStatus, "approve");
      item = await transitionContentItem(tx, id, event);
    }
    return item;
  });
}

/** Event that advances each non-terminal status toward 'published'. */
const ADVANCE: Partial<Record<PublicationStatus, PublicationEvent>> = {
  draft: "propose",
  proposed: "startReview",
  review: "approve",
  approved: "publish",
};

/**
 * Walk a content item all the way to 'published' through the legal chain, in a
 * single transaction (the founder's "confirm" = approve + publish; a granular
 * review UI can later drive states one at a time). Idempotent once published.
 */
export async function publishThroughReview(
  db: Db,
  tenantId: string,
  id: string,
): Promise<ContentItemRow> {
  return withTenant(db, tenantId, async (tx) => {
    let item = await getContentItem(tx, id);
    if (!item) throw new ContentNotFoundError(id);
    while (item.status !== "published") {
      const event = ADVANCE[item.status as PublicationStatus];
      if (!event) throw new InvalidTransitionError(item.status as PublicationStatus, "publish");
      item = await transitionContentItem(tx, id, event);
    }
    return item;
  });
}
