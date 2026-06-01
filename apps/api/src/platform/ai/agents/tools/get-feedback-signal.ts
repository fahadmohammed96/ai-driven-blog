import type { ToolDefinition } from "../../tools";
import {
  deriveFeedbackSignal,
  buildContentProposal,
  type AnalyticsDashboard,
  type FeedbackSignal,
} from "@blogs/contracts";
import { schema, isObject } from "./schema";

/**
 * `getFeedbackSignal` — the metric-derived self-improvement hint for the Writer
 * (agentic-plan §4, Slice A2). The signal is DETERMINISTIC: the tool fetches the
 * content item's cross-channel dashboard and applies the pure
 * `deriveFeedbackSignal`/`buildContentProposal` from `@blogs/contracts` — the LLM
 * orchestrates, it never recomputes the engagement maths (cost control §5).
 *
 * BOUNDARY: `metric_snapshots` lives in a MODULE; `platform/ai` must not import
 * it. So the tool speaks only the local `AnalyticsDashboard` shape and the caller
 * (the analytics/content controller, which MAY read metrics under the tenant's
 * RLS scope) injects an accessor that adapts the real rollups into it — exactly
 * the pattern the other Writer tools use. The pure function applies INSIDE the
 * tool; the caller wires the DB fetch.
 *
 * Preference is PRE-INJECTION of the hint into the brief (free, when the
 * Orchestrator supplies it); this tool exists for the stand-alone case where the
 * Writer runs without an upstream signal. See {@link WriterAgent}.
 */

export const GET_FEEDBACK_SIGNAL_TOOL_ID = "getFeedbackSignal";

/** Injected at the boundary: fetch the cross-channel dashboard for a content item. */
export type GetFeedbackSignalAccessor = (
  tenantId: string,
  contentItemId: string,
) => Promise<AnalyticsDashboard>;

export interface GetFeedbackSignalInput {
  contentItemId: string;
}

export interface GetFeedbackSignalOutput {
  /** The deterministic, metric-derived signal (channel ranking, top, underperformers). */
  signal: FeedbackSignal;
  /** The self-improvement hint derived from the signal, for the next draft. */
  promptHint: string;
}

function isInput(v: unknown): v is GetFeedbackSignalInput {
  return isObject(v) && typeof v.contentItemId === "string";
}

function isOutput(v: unknown): v is GetFeedbackSignalOutput {
  return isObject(v) && isObject(v.signal) && typeof v.promptHint === "string";
}

export function createGetFeedbackSignalTool(
  acc: GetFeedbackSignalAccessor,
): ToolDefinition<GetFeedbackSignalInput, GetFeedbackSignalOutput> {
  return {
    id: GET_FEEDBACK_SIGNAL_TOOL_ID,
    description:
      "Restituisce il segnale di feedback derivato dalle metriche del contenuto " +
      "(canale con più engagement, canali sotto la media) e l'indicazione per " +
      "migliorare il prossimo ciclo editoriale. Deterministico, nessun ricalcolo dal modello.",
    inputSchema: schema("getFeedbackSignal input", isInput),
    outputSchema: schema("getFeedbackSignal output", isOutput),
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 1_000,
    stubArgs: () => ({ contentItemId: "00000000-0000-0000-0000-000000000000" }),
    execute: async (input, ctx) => {
      const dashboard = await acc(ctx.tenantId, input.contentItemId);
      const signal = deriveFeedbackSignal(dashboard);
      const { promptHint } = buildContentProposal(signal);
      return { signal, promptHint };
    },
  };
}
