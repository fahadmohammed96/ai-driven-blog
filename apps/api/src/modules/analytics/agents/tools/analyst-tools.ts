import {
  deriveFeedbackSignal,
  buildContentProposal,
  type AnalyticsDashboard,
} from "@blogs/contracts";
import type { ToolDefinition } from "../../../../platform/ai/tools";
import {
  aggregateChannelBreakdown,
  rankTopContent,
  compareToStaticBenchmark,
} from "../aggregate";
import { schema, isObject } from "./schema";

/**
 * Analyst tools (Slice O1) — all DETERMINISTIC, `side:'read'`, with a
 * `maxOutputTokens` cap so a tool result is truncated before re-injection (cost
 * control §5). They read the tenant's cross-channel dashboard via the injected
 * {@link AnalyticsReadAccessor} (the controller supplies the RLS-scoped
 * `AnalyticsService.getDashboard`), so `modules/analytics` never recomputes the
 * engagement maths inside the model and the boundary stays clean.
 */

/** Injected at the boundary: read the tenant's unified dashboard (RLS-scoped). */
export type AnalyticsReadAccessor = (tenantId: string) => Promise<AnalyticsDashboard>;

const DEFAULT_TOP_LIMIT = 5;

export const QUERY_METRICS_TOOL_ID = "queryMetrics";
export const GET_TOP_CONTENT_TOOL_ID = "getTopContent";
export const COMPARE_TO_BENCHMARK_TOOL_ID = "compareToBenchmark";
export const DERIVE_FEEDBACK_SIGNAL_TOOL_ID = "deriveFeedbackSignal";
export const BUILD_CONTENT_PROPOSAL_TOOL_ID = "buildContentProposal";

/** `queryMetrics`: the per-channel rollup (metrics summed across sources). */
export function createQueryMetricsTool(acc: AnalyticsReadAccessor): ToolDefinition {
  return {
    id: QUERY_METRICS_TOOL_ID,
    description:
      "Restituisce l'aggregazione cross-canale delle metriche del tenant (per canale, " +
      "metriche sommate tra le sorgenti). Deterministico, nessun ricalcolo dal modello.",
    inputSchema: schema("queryMetrics input", isObject),
    outputSchema: schema("queryMetrics output", isObject),
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 1_500,
    stubArgs: () => ({}),
    execute: async (_input, ctx) => ({
      channelBreakdown: aggregateChannelBreakdown(await acc(ctx.tenantId)),
    }),
  };
}

interface GetTopContentInput {
  limit?: number;
}

function isGetTopContentInput(v: unknown): v is GetTopContentInput {
  return isObject(v) && (v.limit === undefined || typeof v.limit === "number");
}

/** `getTopContent`: content items ranked by aggregate engagement. */
export function createGetTopContentTool(acc: AnalyticsReadAccessor): ToolDefinition<GetTopContentInput> {
  return {
    id: GET_TOP_CONTENT_TOOL_ID,
    description:
      "Restituisce i contenuti con il maggior engagement nel periodo (ranking per contentItemId). Deterministico.",
    inputSchema: schema("getTopContent input", isGetTopContentInput),
    outputSchema: schema("getTopContent output", isObject),
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 1_000,
    stubArgs: () => ({ limit: DEFAULT_TOP_LIMIT }),
    execute: async (input, ctx) => ({
      topContent: rankTopContent(await acc(ctx.tenantId), input.limit ?? DEFAULT_TOP_LIMIT),
    }),
  };
}

/**
 * `compareToBenchmark`: tenant engagement totals vs a STATIC sector benchmark.
 * TODO(debt): DEBT-036 — the benchmark is hard-coded, not a real sector
 * comparison. Trigger: the first sector benchmark a customer asks for.
 */
export function createCompareToBenchmarkTool(acc: AnalyticsReadAccessor): ToolDefinition {
  return {
    id: COMPARE_TO_BENCHMARK_TOOL_ID,
    description:
      "Confronta i totali di engagement del tenant con un benchmark STATICO di settore (placeholder).",
    inputSchema: schema("compareToBenchmark input", isObject),
    outputSchema: schema("compareToBenchmark output", isObject),
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 800,
    stubArgs: () => ({}),
    execute: async (_input, ctx) => ({
      comparisons: compareToStaticBenchmark(await acc(ctx.tenantId)),
    }),
  };
}

/**
 * `deriveFeedbackSignal`: REUSES the shared, deterministic
 * `deriveFeedbackSignal`/`buildContentProposal` from `@blogs/contracts` (same
 * derivation the Writer's `getFeedbackSignal` tool uses) — no reimplementation.
 */
export function createDeriveFeedbackSignalTool(acc: AnalyticsReadAccessor): ToolDefinition {
  return {
    id: DERIVE_FEEDBACK_SIGNAL_TOOL_ID,
    description:
      "Deriva il segnale di feedback dalle metriche (canale con più engagement, sotto-media) e l'indicazione per il prossimo ciclo. Deterministico.",
    inputSchema: schema("deriveFeedbackSignal input", isObject),
    outputSchema: schema("deriveFeedbackSignal output", isObject),
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 1_000,
    stubArgs: () => ({}),
    execute: async (_input, ctx) => {
      const signal = deriveFeedbackSignal(await acc(ctx.tenantId));
      const { promptHint } = buildContentProposal(signal);
      return { signal, promptHint };
    },
  };
}

/**
 * `buildContentProposal`: a TEXT content suggestion derived from the metric gap
 * (the underperformers / top channel), reusing the shared deterministic builder.
 */
export function createBuildContentProposalTool(acc: AnalyticsReadAccessor): ToolDefinition {
  return {
    id: BUILD_CONTENT_PROPOSAL_TOOL_ID,
    description:
      "Propone un suggerimento di contenuto (testo) a partire dal gap nelle metriche. Deterministico.",
    inputSchema: schema("buildContentProposal input", isObject),
    outputSchema: schema("buildContentProposal output", isObject),
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 800,
    stubArgs: () => ({}),
    execute: async (_input, ctx) => {
      const signal = deriveFeedbackSignal(await acc(ctx.tenantId));
      const proposal = buildContentProposal(signal);
      return { suggestion: proposal.promptHint, rationale: proposal.rationale };
    },
  };
}

/** All five Analyst tools, wired to the same RLS-scoped dashboard accessor. */
export function createAnalystTools(acc: AnalyticsReadAccessor): ToolDefinition[] {
  return [
    createQueryMetricsTool(acc) as ToolDefinition,
    createGetTopContentTool(acc) as ToolDefinition,
    createCompareToBenchmarkTool(acc) as ToolDefinition,
    createDeriveFeedbackSignalTool(acc) as ToolDefinition,
    createBuildContentProposalTool(acc) as ToolDefinition,
  ];
}
