import { z } from "zod";

/**
 * Unified analytics (Fase 4 — intelligenza, slice 1). One cross-channel model
 * that ingests metrics from **internal** sources we already own (affiliate
 * clicks, newsletter subscribers, social channel-posts, published content) and
 * from **external** sources stubbed at the boundary (GA4, Search Console) — the
 * same boundary-stub discipline as the LLM/Email/Payment/Notification ports of
 * earlier phases. A single dashboard rolls the metrics up per source and per
 * channel. Live GA4/GSC adapters are a founder follow-up (DEBT — see ADR).
 */

/**
 * Whether a metric source is read from our own DB (`internal`) or fetched from a
 * third-party API stubbed at the boundary (`external`). The dashboard labels
 * `external` rows as stubbed so a real number is never confused with a fixture.
 */
export type MetricSourceKind = "internal" | "external";

/**
 * The known metric sources and their kind. Internal sources read existing
 * tenant-scoped tables; external sources have a deterministic boundary stub
 * today (live = DEBT). Unknown sources default to `internal` in {@link sourceKind}.
 */
export const METRIC_SOURCES = {
  affiliate: "internal",
  email: "internal",
  social: "internal",
  content: "internal",
  ga4: "external",
  search_console: "external",
} as const satisfies Record<string, MetricSourceKind>;

export type MetricSource = keyof typeof METRIC_SOURCES;

/** The external (stubbed-at-the-boundary) sources, for UI labelling/iteration. */
export const EXTERNAL_METRIC_SOURCES: MetricSource[] = (
  Object.keys(METRIC_SOURCES) as MetricSource[]
).filter((s) => METRIC_SOURCES[s] === "external");

/** Classify a source string; unknown sources are treated as internal. */
export function sourceKind(source: string): MetricSourceKind {
  return METRIC_SOURCES[source as MetricSource] === "external" ? "external" : "internal";
}

/**
 * One unified metric data point as returned by the dashboard. `channel` is the
 * cross-channel key (instagram/pinterest/blog/newsletter/organic/…), null when a
 * metric is not channel-attributable. `value` is a double (counts, but also avg
 * position). `period` is the bucket label (`all` for the current snapshot — the
 * column is forward-looking for time-series in later slices). `contentItemId`
 * optionally ties a metric to a piece of content.
 */
export interface MetricSnapshotView {
  source: string;
  kind: MetricSourceKind;
  channel: string | null;
  metric: string;
  value: number;
  period: string;
  contentItemId: string | null;
}

/** A per-source rollup: each metric summed across that source's channels. */
export interface SourceRollup {
  source: string;
  kind: MetricSourceKind;
  metrics: { metric: string; value: number }[];
}

/** A per-channel rollup: every (source, metric, value) seen on that channel. */
export interface ChannelRollup {
  channel: string;
  metrics: { source: string; metric: string; value: number }[];
}

/**
 * The unified cross-channel dashboard payload (GET /analytics). `rows` is the flat
 * unified model; `bySource`/`byChannel` are the cross-channel rollups the UI
 * renders; `ingestedAt` is the last ingestion time (null before the first ingest).
 */
export interface AnalyticsDashboard {
  rows: MetricSnapshotView[];
  bySource: SourceRollup[];
  byChannel: ChannelRollup[];
  ingestedAt: string | null;
}

/** The outcome of running ingestion across all sources (POST /analytics/ingest). */
export interface IngestResult {
  ingested: number;
  bySource: { source: string; kind: MetricSourceKind; count: number }[];
}

/**
 * Validation for one metric data point produced by a source adapter. Keeps a
 * source from writing a NaN/negative-less value or an over-long label into the
 * unified model. `period` defaults to the current snapshot bucket `all`.
 */
export const metricInputSchema = z.object({
  source: z.string().min(1).max(64),
  channel: z.string().min(1).max(64).nullable().default(null),
  metric: z.string().min(1).max(64),
  value: z.number().finite(),
  period: z.string().min(1).max(32).default("all"),
  contentItemId: z.string().uuid().nullable().default(null),
});
export type MetricInput = z.infer<typeof metricInputSchema>;
