import { and, eq, sql } from "drizzle-orm";
import type { SubscriberStatus, Theme } from "@blogs/contracts";
import { type Tx } from "../../platform/db/tenant";
import { subscribers, subscriptions } from "../../platform/db/schema";

export type SubscriberRow = typeof subscribers.$inferSelect;

export function findSubscriberByEmail(tx: Tx, email: string): Promise<SubscriberRow | undefined> {
  return tx
    .select()
    .from(subscribers)
    .where(eq(subscribers.email, email))
    .then((rows) => rows[0]);
}

export function findSubscriberByToken(tx: Tx, token: string): Promise<SubscriberRow | undefined> {
  return tx
    .select()
    .from(subscribers)
    .where(eq(subscribers.confirmToken, token))
    .then((rows) => rows[0]);
}

/** Insert a new subscriber in the `pending` state with a fresh confirm token. */
export async function insertSubscriber(
  tx: Tx,
  input: { tenantId: string; email: string; token: string },
): Promise<SubscriberRow> {
  const [row] = await tx
    .insert(subscribers)
    .values({ tenantId: input.tenantId, email: input.email, confirmToken: input.token })
    .returning();
  return row as SubscriberRow;
}

/** Re-arm a returning (unsubscribed) subscriber for a fresh double opt-in. */
export async function resetToPending(tx: Tx, id: string, token: string): Promise<SubscriberRow> {
  const [row] = await tx
    .update(subscribers)
    .set({
      status: "pending",
      confirmToken: token,
      requestedAt: sql`now()`,
      confirmedAt: null,
      unsubscribedAt: null,
    })
    .where(eq(subscribers.id, id))
    .returning();
  return row as SubscriberRow;
}

/** Apply a lifecycle status, stamping the matching timestamp once. */
export async function setSubscriberStatus(
  tx: Tx,
  id: string,
  status: SubscriberStatus,
): Promise<SubscriberRow> {
  const patch: Record<string, unknown> = { status };
  if (status === "confirmed") patch.confirmedAt = sql`coalesce(${subscribers.confirmedAt}, now())`;
  if (status === "unsubscribed") patch.unsubscribedAt = sql`now()`;
  const [row] = await tx.update(subscribers).set(patch).where(eq(subscribers.id, id)).returning();
  return row as SubscriberRow;
}

/** Opt the subscriber into the given themes (idempotent on (subscriber, theme)). */
export async function addThemes(
  tx: Tx,
  input: { tenantId: string; subscriberId: string; themes: Theme[] },
): Promise<void> {
  if (input.themes.length === 0) return;
  await tx
    .insert(subscriptions)
    .values(input.themes.map((theme) => ({ tenantId: input.tenantId, subscriberId: input.subscriberId, theme })))
    .onConflictDoNothing({ target: [subscriptions.subscriberId, subscriptions.theme] });
}

export interface SegmentMember {
  email: string;
  token: string;
}

/** The segment for a theme: confirmed subscribers opted into it (email + token). */
export async function confirmedSegmentForTheme(tx: Tx, theme: Theme): Promise<SegmentMember[]> {
  const rows = await tx
    .select({ email: subscribers.email, token: subscribers.confirmToken })
    .from(subscribers)
    .innerJoin(subscriptions, eq(subscriptions.subscriberId, subscribers.id))
    .where(and(eq(subscriptions.theme, theme), eq(subscribers.status, "confirmed")));
  return rows;
}
