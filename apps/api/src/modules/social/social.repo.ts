import { desc, eq } from "drizzle-orm";
import type { ChannelPost } from "@blogs/contracts";
import { type Tx } from "../../platform/db/tenant";
import { channelPosts } from "../../platform/db/schema";

/** A persisted channel post (tenant-scoped by RLS). */
export type ChannelPostRow = typeof channelPosts.$inferSelect;

/** Insert the channel-adapted posts for a source article; returns the rows. */
export async function insertChannelPosts(
  tx: Tx,
  tenantId: string,
  contentItemId: string,
  posts: ChannelPost[],
): Promise<ChannelPostRow[]> {
  if (posts.length === 0) return [];
  const rows = await tx
    .insert(channelPosts)
    .values(posts.map((p) => ({ tenantId, contentItemId, channel: p.channel, payload: p })))
    .returning();
  return rows as ChannelPostRow[];
}

/** List the channel posts derived from a content item, newest first. */
export function listChannelPosts(tx: Tx, contentItemId: string): Promise<ChannelPostRow[]> {
  return tx
    .select()
    .from(channelPosts)
    .where(eq(channelPosts.contentItemId, contentItemId))
    .orderBy(desc(channelPosts.createdAt));
}

/** Fetch a single channel post by id (RLS-scoped). */
export async function getChannelPostById(tx: Tx, id: string): Promise<ChannelPostRow | undefined> {
  const [row] = await tx.select().from(channelPosts).where(eq(channelPosts.id, id)).limit(1);
  return row as ChannelPostRow | undefined;
}

/** Persist a new approval status on a channel post; returns the updated row. */
export async function setChannelPostStatus(
  tx: Tx,
  id: string,
  status: string,
): Promise<ChannelPostRow | undefined> {
  const [row] = await tx
    .update(channelPosts)
    .set({ status })
    .where(eq(channelPosts.id, id))
    .returning();
  return row as ChannelPostRow | undefined;
}
