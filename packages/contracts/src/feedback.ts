import type { AnalyticsDashboard } from "./analytics";

/**
 * Feedback loop (Fase 4 — intelligenza, Slice 2). Turns the unified analytics
 * rollups (Slice 1, `metric_snapshots` → `byChannel`) into **deterministic
 * signals** that adapt the next cycle's AI proposal: favour the channel that
 * performed, deprioritise the underperformers. The signal is a REAL input that
 * observably changes the proposal's plan/ranking/prompt-hint; the LLM itself
 * stays STUBBED at the boundary (ADR-0026). The acceptance is about the
 * INPUTS/PLAN changing, not the LLM text.
 *
 * Pure & deterministic by design: the same dashboard always yields the same
 * proposal, so the loop is unit-testable in CI today (works off whatever is in
 * `metric_snapshots`, real internal data or the stubbed external fixtures).
 * Respects ADR-0020: the loop changes WHAT is proposed, never the approval gate.
 */

/**
 * The metrics that count as channel **engagement** (positive volume the founder
 * wants more of). Inventory/effort metrics (`posts`, `items`, `published`,
 * `subscribers`) and rank metrics (`avg_position`) are intentionally excluded:
 * they measure activity or position, not how an audience responded per channel.
 */
export const ENGAGEMENT_METRICS = ["clicks", "sessions", "users", "impressions"] as const;
export type EngagementMetric = (typeof ENGAGEMENT_METRICS)[number];

/** Channel with no attribution — never a target to emphasise. */
const UNATTRIBUTED = "unattributed";

function isEngagementMetric(metric: string): boolean {
  return (ENGAGEMENT_METRICS as readonly string[]).includes(metric);
}

/** A channel and its summed cross-source engagement score. */
export interface ChannelScore {
  channel: string;
  score: number;
}

/** How strongly the next proposal should lean on a channel. */
export type ProposalWeight = "primary" | "secondary" | "deprioritize";

/**
 * The metric-derived signal: channels ranked by engagement, the top performer,
 * and the below-average underperformers. Deterministic — descending by score,
 * ties broken by channel name so the ordering never wobbles.
 */
export interface FeedbackSignal {
  channelRanking: ChannelScore[];
  topChannel: string | null;
  underperformers: string[];
}

/** One channel's place in the next proposal's plan. */
export interface ProposalEmphasis {
  channel: string;
  score: number;
  weight: ProposalWeight;
}

/**
 * The adapted next-cycle proposal. `emphasis` is the ranked plan; `primaryChannel`
 * is the one to lead with; `promptHint` is the metric-derived line fed INTO the
 * (stubbed) generation prompt; `rationale` is the human-facing "why this proposal"
 * citing the signal — surfaced so the human confirms with eyes open (ADR-0020).
 */
export interface ContentProposal {
  primaryChannel: string | null;
  emphasis: ProposalEmphasis[];
  promptHint: string;
  rationale: string;
}

/** The endpoint payload: the derived signal + the proposal it produced. */
export interface NextProposal {
  signal: FeedbackSignal;
  proposal: ContentProposal;
}

/**
 * Derive the deterministic feedback signal from the analytics dashboard. Sums
 * the engagement metrics per channel (cross-source — e.g. a channel's GA4
 * sessions and affiliate clicks add up), drops `unattributed`, ranks descending
 * with an alphabetical tie-break, and flags the below-mean channels as
 * underperformers (only meaningful when there is more than one channel).
 */
export function deriveFeedbackSignal(dashboard: AnalyticsDashboard): FeedbackSignal {
  const scores = new Map<string, number>();
  for (const ch of dashboard.byChannel) {
    if (ch.channel === UNATTRIBUTED) continue;
    let score = 0;
    for (const m of ch.metrics) {
      if (isEngagementMetric(m.metric)) score += m.value;
    }
    scores.set(ch.channel, (scores.get(ch.channel) ?? 0) + score);
  }

  const channelRanking: ChannelScore[] = [...scores.entries()]
    .map(([channel, score]) => ({ channel, score }))
    .sort((a, b) => b.score - a.score || a.channel.localeCompare(b.channel));

  const topChannel = channelRanking[0]?.channel ?? null;
  const mean = channelRanking.length
    ? channelRanking.reduce((total, c) => total + c.score, 0) / channelRanking.length
    : 0;
  const underperformers =
    channelRanking.length > 1
      ? channelRanking
          .filter((c) => c.score < mean)
          .map((c) => c.channel)
          .sort((a, b) => a.localeCompare(b))
      : [];

  return { channelRanking, topChannel, underperformers };
}

/**
 * Build the next-cycle proposal from the signal. The plan leads with the top
 * channel, deprioritises the underperformers, and keeps the rest as secondary;
 * the `promptHint` and `rationale` cite the signal so both the generator and the
 * human see why the proposal shifted. With no metrics yet, returns a neutral,
 * unadapted proposal (the loop simply has nothing to say).
 */
export function buildContentProposal(signal: FeedbackSignal): ContentProposal {
  const under = new Set(signal.underperformers);
  const emphasis: ProposalEmphasis[] = signal.channelRanking.map((c) => ({
    channel: c.channel,
    score: c.score,
    weight:
      c.channel === signal.topChannel
        ? "primary"
        : under.has(c.channel)
          ? "deprioritize"
          : "secondary",
  }));

  if (!signal.topChannel) {
    return {
      primaryChannel: null,
      emphasis,
      promptHint: "Nessun segnale dai dati: proponi un mix di canali bilanciato.",
      rationale:
        "Nessuna metrica disponibile: proposta neutra, nessun adattamento dal loop di feedback.",
    };
  }

  const top = signal.channelRanking[0]!;
  const deprioritized = emphasis
    .filter((e) => e.weight === "deprioritize")
    .map((e) => e.channel);

  const promptHint = [
    `Favorisci contenuti per il canale "${signal.topChannel}" (engagement più alto: ${top.score}).`,
    deprioritized.length ? `Riduci l'enfasi su: ${deprioritized.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const rationale = [
    `Proposta adattata dalle metriche: "${signal.topChannel}" è il canale con più engagement (${top.score}).`,
    deprioritized.length ? `Sotto la media e deprioritizzati: ${deprioritized.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return { primaryChannel: signal.topChannel, emphasis, promptHint, rationale };
}

/** Convenience: derive the signal and build the proposal in one call. */
export function nextProposalFrom(dashboard: AnalyticsDashboard): NextProposal {
  const signal = deriveFeedbackSignal(dashboard);
  return { signal, proposal: buildContentProposal(signal) };
}
