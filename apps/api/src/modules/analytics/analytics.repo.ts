import { desc, eq, sql } from "drizzle-orm";
import type { MetricInput } from "@blogs/contracts";
import type { Tx } from "../../platform/db/tenant";
import { metricSnapshots } from "../../platform/db/schema";

/** A persisted unified metric row, tenant-scoped by RLS. */
export type MetricSnapshotRow = typeof metricSnapshots.$inferSelect;

/**
 * Replace a source's snapshot for the current tenant: delete its existing rows,
 * then **upsert** the freshly collected ones. This makes re-ingestion
 * **idempotent** (running twice yields the same rows) and keeps one source's data
 * independent of the others. RLS scopes both the delete and the insert to the
 * current tenant.
 *
 * The upsert (on the `(tenant_id, source, channel, metric, period)` unique key)
 * is what makes ingest safe under **concurrent/overlapping** runs: without it,
 * two ingests could each delete-then-insert the same key and leave two rows (a
 * race the shared-tenant e2e exposed). With it, a duplicate is impossible — the
 * conflicting write updates the existing row instead.
 */
export async function replaceSnapshotsForSource(
  tx: Tx,
  tenantId: string,
  source: string,
  metrics: MetricInput[],
): Promise<number> {
  await tx.delete(metricSnapshots).where(eq(metricSnapshots.source, source));
  if (metrics.length === 0) return 0;
  await tx
    .insert(metricSnapshots)
    .values(
      metrics.map((m) => ({
        tenantId,
        source: m.source,
        channel: m.channel ?? null,
        metric: m.metric,
        value: m.value,
        period: m.period,
        contentItemId: m.contentItemId ?? null,
      })),
    )
    .onConflictDoUpdate({
      target: [
        metricSnapshots.tenantId,
        metricSnapshots.source,
        metricSnapshots.channel,
        metricSnapshots.metric,
        metricSnapshots.period,
      ],
      set: {
        value: sql`excluded.value`,
        contentItemId: sql`excluded.content_item_id`,
        capturedAt: sql`now()`,
      },
    });
  return metrics.length;
}

/** All of the current tenant's metric rows, newest snapshot first. */
export function listSnapshots(tx: Tx): Promise<MetricSnapshotRow[]> {
  return tx.select().from(metricSnapshots).orderBy(desc(metricSnapshots.capturedAt));
}

/**
 * The most recent ingestion time for the tenant as an ISO string, or null if
 * never ingested. The `max()` aggregate comes back as a string from the driver
 * (not a Date like a plain column), so we normalize through `new Date(...)`.
 */
export async function lastIngestedAt(tx: Tx): Promise<string | null> {
  const [row] = await tx
    .select({ max: sql<string | null>`max(${metricSnapshots.capturedAt})` })
    .from(metricSnapshots);
  return row?.max ? new Date(row.max).toISOString() : null;
}
