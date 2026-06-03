import {
  ENGAGEMENT_METRICS,
  type AnalyticsDashboard,
  type ChannelBreakdownEntry,
  type TopContentEntry,
} from "@blogs/contracts";

/**
 * Deterministic cross-channel aggregation for the Analyst agent (Slice O1) — the
 * "seed" computed in code BEFORE the LLM loop, so even the offline stub yields a
 * valid, stable `PerformanceReport`. Pure functions: same dashboard → same output
 * (cost control §5 — the model narrates, it never recomputes the maths).
 */

const ENGAGEMENT = new Set<string>(ENGAGEMENT_METRICS);

/**
 * Roll each channel's metrics up across its sources: one `{metric, value}` per
 * metric, summed. Channels and metrics are sorted alphabetically so the ordering
 * never wobbles between runs (replay-stable).
 */
export function aggregateChannelBreakdown(dashboard: AnalyticsDashboard): ChannelBreakdownEntry[] {
  return dashboard.byChannel
    .map((ch) => {
      const byMetric = new Map<string, number>();
      for (const m of ch.metrics) {
        byMetric.set(m.metric, (byMetric.get(m.metric) ?? 0) + m.value);
      }
      const metrics = [...byMetric.entries()]
        .map(([metric, value]) => ({ metric, value }))
        .sort((a, b) => a.metric.localeCompare(b.metric));
      return { channel: ch.channel, metrics };
    })
    .sort((a, b) => a.channel.localeCompare(b.channel));
}

/**
 * Rank content items by their aggregate engagement (sum of the ENGAGEMENT_METRICS
 * the feedback loop already trusts). Each entry reports the single dominant metric
 * (highest value, alphabetical tie-break). Ranked descending by score with a
 * contentItemId tie-break (deterministic), capped at `limit`.
 */
export function rankTopContent(dashboard: AnalyticsDashboard, limit: number): TopContentEntry[] {
  const acc = new Map<string, { score: number; topMetric: string; topValue: number }>();
  for (const r of dashboard.rows) {
    if (!r.contentItemId || !ENGAGEMENT.has(r.metric)) continue;
    const cur = acc.get(r.contentItemId) ?? { score: 0, topMetric: r.metric, topValue: -Infinity };
    cur.score += r.value;
    if (
      r.value > cur.topValue ||
      (r.value === cur.topValue && r.metric.localeCompare(cur.topMetric) < 0)
    ) {
      cur.topValue = r.value;
      cur.topMetric = r.metric;
    }
    acc.set(r.contentItemId, cur);
  }
  return [...acc.entries()]
    .map(([contentItemId, v]) => ({ contentItemId, value: v.score, metric: v.topMetric }))
    .sort((a, b) => b.value - a.value || a.contentItemId.localeCompare(b.contentItemId))
    .slice(0, limit);
}

/**
 * STATIC, hard-coded sector benchmark (DEBT-036). No real sector comparison — the
 * numbers are placeholders so `compareToBenchmark` has something to compare against
 * until a customer asks for a real sector benchmark.
 */
export const STATIC_BENCHMARK: Record<string, number> = {
  clicks: 100,
  sessions: 500,
  users: 300,
  impressions: 2000,
};

/** A metric's tenant total vs the static benchmark, with the signed delta. */
export interface BenchmarkComparison {
  metric: string;
  value: number;
  benchmark: number;
  delta: number;
}

/**
 * Compare the tenant's engagement totals (summed across every channel) to the
 * STATIC_BENCHMARK (DEBT-036). Deterministic: sorted by metric name.
 */
export function compareToStaticBenchmark(dashboard: AnalyticsDashboard): BenchmarkComparison[] {
  const totals = new Map<string, number>();
  for (const ch of dashboard.byChannel) {
    for (const m of ch.metrics) {
      if (!ENGAGEMENT.has(m.metric)) continue;
      totals.set(m.metric, (totals.get(m.metric) ?? 0) + m.value);
    }
  }
  return [...Object.keys(STATIC_BENCHMARK)]
    .sort((a, b) => a.localeCompare(b))
    .map((metric) => {
      const value = totals.get(metric) ?? 0;
      const benchmark = STATIC_BENCHMARK[metric]!;
      return { metric, value, benchmark, delta: value - benchmark };
    });
}
