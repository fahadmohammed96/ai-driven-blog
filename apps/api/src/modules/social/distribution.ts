import type { Channel } from "@blogs/contracts";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
// Read the source article via the content module's public barrel.
import { getContentItem, ContentNotFoundError } from "../content";
import { repurpose, type ArticleContent } from "./repurpose";
import { nextPostStatus, type PostAction } from "./approval";
import {
  insertChannelPosts,
  listChannelPosts,
  getChannelPostById,
  setChannelPostStatus,
  type ChannelPostRow,
} from "./social.repo";

/** Raised when repurposing targets a content item that is not an article. */
export class NotAnArticleError extends Error {
  constructor(public readonly id: string) {
    super(`content item is not an article: ${id}`);
    this.name = "NotAnArticleError";
  }
}

/** Raised when an approval action targets a non-existent channel post. */
export class ChannelPostNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`channel post not found: ${id}`);
    this.name = "ChannelPostNotFoundError";
  }
}

export interface RepurposeOptions {
  /** Outbound link woven into pins (e.g. the published article URL). */
  link?: string;
}

/**
 * Repurpose a stored article into channel-adapted posts and persist them,
 * tenant-scoped. Throws ContentNotFoundError / NotAnArticleError on bad input
 * and ChannelRequiresImageError if a visual channel lacks an image.
 */
export async function repurposeArticle(
  db: Db,
  tenantId: string,
  contentItemId: string,
  channels: Channel[],
  opts: RepurposeOptions = {},
): Promise<ChannelPostRow[]> {
  return withTenant(db, tenantId, async (tx) => {
    const item = await getContentItem(tx, contentItemId);
    if (!item) throw new ContentNotFoundError(contentItemId);
    if (item.type !== "article") throw new NotAnArticleError(contentItemId);

    const article: ArticleContent = {
      title: item.title,
      blocks: item.blocks,
      ...(opts.link ? { link: opts.link } : {}),
    };
    const posts = repurpose(article, channels);
    return insertChannelPosts(tx, tenantId, contentItemId, posts);
  });
}

/** List the posts already derived from an article (RLS-scoped). */
export function getChannelPosts(
  db: Db,
  tenantId: string,
  contentItemId: string,
): Promise<ChannelPostRow[]> {
  return withTenant(db, tenantId, (tx) => listChannelPosts(tx, contentItemId));
}

/**
 * Apply the human approval gate (approve/reject) to a channel post, RLS-scoped.
 * The transition itself is the pure `nextPostStatus` (idempotent / guarded).
 */
export async function setPostApproval(
  db: Db,
  tenantId: string,
  postId: string,
  action: PostAction,
): Promise<ChannelPostRow> {
  return withTenant(db, tenantId, async (tx) => {
    const post = await getChannelPostById(tx, postId);
    if (!post) throw new ChannelPostNotFoundError(postId);
    const status = nextPostStatus(post.status, action);
    const updated = await setChannelPostStatus(tx, postId, status);
    if (!updated) throw new ChannelPostNotFoundError(postId);
    return updated;
  });
}
