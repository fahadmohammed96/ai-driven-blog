import { Inject, Injectable } from "@nestjs/common";
import {
  type AnalyticsDashboard,
  type ChannelRollup,
  type IngestResult,
  type MetricSnapshotView,
  type SourceRollup,
  sourceKind,
} from "@blogs/contracts";
import { DB } from "../../platform/tokens";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { ANALYTICS_SOURCES, type AnalyticsSourcePort } from "./source.port";
import {
  type MetricSnapshotRow,
  lastIngestedAt,
  listSnapshots,
  replaceSnapshotsForSource,
} from "./analytics.repo";

/**
 * Unified analytics service (Fase 4, slice 1). Ingests every registered source —
 * internal read models + stubbed external adapters — into the one `metric_snapshots`
 * model, and serves the cross-channel dashboard rollup. Tenant-scoped via
 * `withTenant` (RLS) on every read and write.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ANALYTICS_SOURCES) private readonly sources: AnalyticsSourcePort[],
  ) {}

  /**
   * Run ingestion across all sources, idempotently replacing each source's
   * snapshot. Note (DEBT-013): the external sources are deterministic stubs, so
   * collecting them inside the write tx is harmless; a live GA4/GSC adapter must
   * fetch OUTSIDE this tx (ADR-0025).
   */
  async ingestAll(tenantId: string): Promise<IngestResult> {
    return withTenant(this.db, tenantId, async (tx) => {
      const bySource: IngestResult["bySource"] = [];
      let ingested = 0;
      for (const src of this.sources) {
        const metrics = await src.collect({ tx, tenantId });
        const count = await replaceSnapshotsForSource(tx, tenantId, src.source, metrics);
        bySource.push({ source: src.source, kind: src.kind, count });
        ingested += count;
      }
      return { ingested, bySource };
    });
  }

  /** The unified cross-channel dashboard: flat rows + per-source/per-channel rollups. */
  async getDashboard(tenantId: string): Promise<AnalyticsDashboard> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [rows, ingestedAt] = await Promise.all([listSnapshots(tx), lastIngestedAt(tx)]);
      const views = rows.map(toView);
      return {
        rows: views,
        bySource: rollupBySource(views),
        byChannel: rollupByChannel(views),
        ingestedAt,
      };
    });
  }
}

function toView(row: MetricSnapshotRow): MetricSnapshotView {
  return {
    source: row.source,
    kind: sourceKind(row.source),
    channel: row.channel,
    metric: row.metric,
    value: row.value,
    period: row.period,
    contentItemId: row.contentItemId,
  };
}

/** Sum each source's metrics across its channels (stable source order preserved). */
function rollupBySource(views: MetricSnapshotView[]): SourceRollup[] {
  const out: SourceRollup[] = [];
  const index = new Map<string, SourceRollup>();
  for (const v of views) {
    let group = index.get(v.source);
    if (!group) {
      group = { source: v.source, kind: v.kind, metrics: [] };
      index.set(v.source, group);
      out.push(group);
    }
    const existing = group.metrics.find((m) => m.metric === v.metric);
    if (existing) existing.value += v.value;
    else group.metrics.push({ metric: v.metric, value: v.value });
  }
  return out;
}

/** Group every (source, metric, value) under the channel it was seen on. */
function rollupByChannel(views: MetricSnapshotView[]): ChannelRollup[] {
  const out: ChannelRollup[] = [];
  const index = new Map<string, ChannelRollup>();
  for (const v of views) {
    const channel = v.channel ?? "unattributed";
    let group = index.get(channel);
    if (!group) {
      group = { channel, metrics: [] };
      index.set(channel, group);
      out.push(group);
    }
    group.metrics.push({ source: v.source, metric: v.metric, value: v.value });
  }
  return out;
}
