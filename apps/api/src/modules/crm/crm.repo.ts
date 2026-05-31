import { desc, eq, sql, type SQL } from "drizzle-orm";
import type { LeadStatus, NotificationChannel } from "@blogs/contracts";
import type { Tx } from "../../platform/db/tenant";
import { leads } from "../../platform/db/schema";

export type LeadRow = typeof leads.$inferSelect;

export interface NewLead {
  tenantId: string;
  customerEmail: string;
  customerName?: string | null;
  channel: NotificationChannel;
  request: string;
  portalToken: string;
}

/** Insert an inbound lead (status `received`) under the tenant context. */
export async function insertLead(tx: Tx, input: NewLead): Promise<LeadRow> {
  const [row] = await tx
    .insert(leads)
    .values({
      tenantId: input.tenantId,
      customerEmail: input.customerEmail,
      customerName: input.customerName ?? null,
      channel: input.channel,
      request: input.request,
      portalToken: input.portalToken,
    })
    .returning();
  return row as LeadRow;
}

/** Fetch a lead by id (RLS returns null for other tenants). */
export async function getLead(tx: Tx, id: string): Promise<LeadRow | null> {
  const rows = await tx.select().from(leads).where(eq(leads.id, id));
  return rows[0] ?? null;
}

/** Fetch a lead by its unguessable portal token (the client-portal read view). */
export async function getLeadByPortalToken(tx: Tx, token: string): Promise<LeadRow | null> {
  const rows = await tx.select().from(leads).where(eq(leads.portalToken, token));
  return rows[0] ?? null;
}

/** All of the tenant's leads, newest first (the founder's CRM inbox). */
export async function listLeads(tx: Tx): Promise<LeadRow[]> {
  return tx.select().from(leads).orderBy(desc(leads.createdAt));
}

/** Patch a lead's pipeline fields; bumps `updated_at`. Returns the row. */
export async function updateLead(
  tx: Tx,
  id: string,
  patch: {
    status?: LeadStatus;
    proposal?: string | null;
    depositCents?: number | null;
    currency?: string;
    paymentRef?: string | null;
    approvedAt?: Date | SQL | null;
    sentAt?: Date | SQL | null;
    confirmedAt?: Date | SQL | null;
    deliveredAt?: Date | SQL | null;
  },
): Promise<LeadRow> {
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.proposal !== undefined) set.proposal = patch.proposal;
  if (patch.depositCents !== undefined) set.depositCents = patch.depositCents;
  if (patch.currency !== undefined) set.currency = patch.currency;
  if (patch.paymentRef !== undefined) set.paymentRef = patch.paymentRef;
  if (patch.approvedAt !== undefined) set.approvedAt = patch.approvedAt;
  if (patch.sentAt !== undefined) set.sentAt = patch.sentAt;
  if (patch.confirmedAt !== undefined) set.confirmedAt = patch.confirmedAt;
  if (patch.deliveredAt !== undefined) set.deliveredAt = patch.deliveredAt;
  const [row] = await tx.update(leads).set(set).where(eq(leads.id, id)).returning();
  return row as LeadRow;
}
