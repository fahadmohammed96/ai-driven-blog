import { desc, eq, isNotNull, sql } from "drizzle-orm";
import type { Tx } from "../../platform/db/tenant";
import { affiliateClicks, affiliateLinks } from "../../platform/db/schema";

/** A persisted affiliate link (canonical row), tenant-scoped by RLS. */
export type AffiliateLinkRow = typeof affiliateLinks.$inferSelect;

export class DuplicateCodeError extends Error {
  constructor(public readonly code: string) {
    super(`affiliate code already exists: ${code}`);
    this.name = "DuplicateCodeError";
  }
}

export interface NewAffiliateLink {
  tenantId: string;
  code: string;
  targetUrl: string;
  contentItemId?: string | null;
  channel?: string | null;
  label?: string | null;
}

/** Postgres unique-violation (SQLSTATE 23505), possibly wrapped by the driver. */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  const causeCode = (err as { cause?: { code?: string } }).cause?.code;
  return code === "23505" || causeCode === "23505";
}

/**
 * Insert an affiliate link under the current tenant context; returns the row.
 * A duplicate `code` (unique per tenant) surfaces as {@link DuplicateCodeError}.
 */
export async function insertAffiliateLink(tx: Tx, input: NewAffiliateLink): Promise<AffiliateLinkRow> {
  try {
    const [row] = await tx
      .insert(affiliateLinks)
      .values({
        tenantId: input.tenantId,
        code: input.code,
        targetUrl: input.targetUrl,
        contentItemId: input.contentItemId ?? null,
        channel: input.channel ?? null,
        label: input.label ?? null,
      })
      .returning();
    return row as AffiliateLinkRow;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateCodeError(input.code);
    throw err;
  }
}

/** Resolve a link by its public `/go/` code (RLS returns null for other tenants). */
export async function getAffiliateLinkByCode(tx: Tx, code: string): Promise<AffiliateLinkRow | null> {
  const rows = await tx.select().from(affiliateLinks).where(eq(affiliateLinks.code, code));
  return rows[0] ?? null;
}

/** Fetch a link by id (RLS returns null for other tenants). */
export async function getAffiliateLink(tx: Tx, id: string): Promise<AffiliateLinkRow | null> {
  const rows = await tx.select().from(affiliateLinks).where(eq(affiliateLinks.id, id));
  return rows[0] ?? null;
}

/** Patch a link's editable fields (never `code`); bumps `updated_at`. */
export async function updateAffiliateLink(
  tx: Tx,
  id: string,
  patch: {
    targetUrl?: string;
    contentItemId?: string | null;
    channel?: string | null;
    label?: string | null;
  },
): Promise<void> {
  await tx
    .update(affiliateLinks)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(affiliateLinks.id, id));
}

/**
 * Record one click through the redirector. The link's associations are
 * snapshotted onto the click row so per-article / per-channel counts stay
 * correct even if the link is later re-pointed. Kept to a single lightweight
 * INSERT so the redirect stays fast.
 */
export async function recordClick(tx: Tx, link: AffiliateLinkRow): Promise<void> {
  await tx.insert(affiliateClicks).values({
    tenantId: link.tenantId,
    linkId: link.id,
    contentItemId: link.contentItemId,
    channel: link.channel,
  });
}

/** A link with its total click count, for the Affiliate read endpoints. */
export interface AffiliateLinkWithClicks {
  id: string;
  code: string;
  targetUrl: string;
  contentItemId: string | null;
  channel: string | null;
  label: string | null;
  createdAt: Date;
  clicks: number;
}

const clickCount = sql<number>`count(${affiliateClicks.id})::int`;

/**
 * List the current tenant's links (RLS-scoped), newest first, each with its
 * total click count (LEFT JOIN so a link with zero clicks still appears).
 */
export async function listLinksWithClicks(tx: Tx): Promise<AffiliateLinkWithClicks[]> {
  return tx
    .select({
      id: affiliateLinks.id,
      code: affiliateLinks.code,
      targetUrl: affiliateLinks.targetUrl,
      contentItemId: affiliateLinks.contentItemId,
      channel: affiliateLinks.channel,
      label: affiliateLinks.label,
      createdAt: affiliateLinks.createdAt,
      clicks: clickCount,
    })
    .from(affiliateLinks)
    .leftJoin(affiliateClicks, eq(affiliateClicks.linkId, affiliateLinks.id))
    .groupBy(affiliateLinks.id)
    .orderBy(desc(affiliateLinks.createdAt));
}

/** Click counts per link (id + code), descending by clicks. */
export async function countClicksByLink(
  tx: Tx,
): Promise<{ linkId: string; code: string; clicks: number }[]> {
  return tx
    .select({ linkId: affiliateLinks.id, code: affiliateLinks.code, clicks: clickCount })
    .from(affiliateLinks)
    .leftJoin(affiliateClicks, eq(affiliateClicks.linkId, affiliateLinks.id))
    .groupBy(affiliateLinks.id)
    .orderBy(desc(clickCount));
}

/** Click counts per associated article (only clicks that carry an article). */
export async function countClicksByArticle(
  tx: Tx,
): Promise<{ contentItemId: string; clicks: number }[]> {
  const rows = await tx
    .select({ contentItemId: affiliateClicks.contentItemId, clicks: clickCount })
    .from(affiliateClicks)
    .where(isNotNull(affiliateClicks.contentItemId))
    .groupBy(affiliateClicks.contentItemId)
    .orderBy(desc(clickCount));
  return rows.map((r) => ({ contentItemId: r.contentItemId as string, clicks: r.clicks }));
}

/** Click counts per placement channel (only clicks that carry a channel). */
export async function countClicksByChannel(
  tx: Tx,
): Promise<{ channel: string; clicks: number }[]> {
  const rows = await tx
    .select({ channel: affiliateClicks.channel, clicks: clickCount })
    .from(affiliateClicks)
    .where(isNotNull(affiliateClicks.channel))
    .groupBy(affiliateClicks.channel)
    .orderBy(desc(clickCount));
  return rows.map((r) => ({ channel: r.channel as string, clicks: r.clicks }));
}
