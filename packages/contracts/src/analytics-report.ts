import { z } from "zod";

/**
 * PerformanceReport — the Analyst agent's output (agentic-plan Slice O1). The
 * Analyst reads the tenant's cross-channel `metric_snapshots` (via the unified
 * analytics dashboard), aggregates them DETERMINISTICALLY, and wraps the numbers
 * with narrative `insights`/`recommendations` synthesised by the LLM. Unlike the
 * SEO/Social/Email specialists (which transform ONE article), the Analyst emits
 * an INFORMATIVE report: it is staged as an `analyst_insight` proposal that the
 * founder ACKNOWLEDGES (no content/state mutation downstream) — input for the
 * future Editorial Orchestrator (O3).
 *
 * OUTPUT-SAFETY: every field stays plain TEXT (the proposal card escapes by
 * default; there is no `href`/URL field here), so a narrative line can never
 * become an injection vector when rendered.
 */

/** The window the report covers. `from`/`to` are optional ISO labels (forward-looking). */
export const reportPeriodSchema = z.object({
  days: z.number().int().positive(),
  from: z.string().optional(),
  to: z.string().optional(),
});
export type ReportPeriod = z.infer<typeof reportPeriodSchema>;

/** One channel's metrics, summed across sources (deterministic aggregation). */
export const channelBreakdownEntrySchema = z.object({
  channel: z.string(),
  metrics: z.array(z.object({ metric: z.string(), value: z.number() })),
});
export type ChannelBreakdownEntry = z.infer<typeof channelBreakdownEntrySchema>;

/** A content item ranked by its aggregate engagement, with its dominant metric. */
export const topContentEntrySchema = z.object({
  contentItemId: z.string(),
  value: z.number(),
  metric: z.string(),
});
export type TopContentEntry = z.infer<typeof topContentEntrySchema>;

/**
 * The Analyst's report payload. `channelBreakdown`/`topContent` are the
 * deterministic aggregation; `insights`/`recommendations` are narrative text
 * (deterministic seed + optional LLM synthesis). The `analyst_insight` proposal
 * carries this as its payload.
 */
export const performanceReportSchema = z.object({
  period: reportPeriodSchema,
  channelBreakdown: z.array(channelBreakdownEntrySchema),
  topContent: z.array(topContentEntrySchema),
  insights: z.array(z.string()),
  recommendations: z.array(z.string()),
});
export type PerformanceReport = z.infer<typeof performanceReportSchema>;
