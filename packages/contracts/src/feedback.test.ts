import { describe, it, expect } from "vitest";
import type { AnalyticsDashboard, ChannelRollup } from "./analytics";
import {
  buildContentProposal,
  deriveFeedbackSignal,
  nextProposalFrom,
} from "./feedback";

/** Build a minimal dashboard from per-channel (source, metric, value) tuples. */
function dashboard(byChannel: ChannelRollup[]): AnalyticsDashboard {
  return { rows: [], bySource: [], byChannel, ingestedAt: "2026-05-31T00:00:00Z" };
}

describe("feedback loop — metrics adapt the next proposal (deterministic)", () => {
  // THE acceptance: given metric set A the proposal is X; given set B it changes
  // to Y accordingly. Same code, different metrics → different proposal.
  it("metric set A (pinterest performs) → proposal leads with pinterest", () => {
    const A = dashboard([
      { channel: "pinterest", metrics: [{ source: "affiliate", metric: "clicks", value: 40 }] },
      { channel: "instagram", metrics: [{ source: "affiliate", metric: "clicks", value: 5 }] },
    ]);

    const { signal, proposal } = nextProposalFrom(A);

    expect(signal.topChannel).toBe("pinterest");
    expect(signal.underperformers).toEqual(["instagram"]);
    expect(proposal.primaryChannel).toBe("pinterest");
    expect(proposal.emphasis).toEqual([
      { channel: "pinterest", score: 40, weight: "primary" },
      { channel: "instagram", score: 5, weight: "deprioritize" },
    ]);
    expect(proposal.promptHint).toContain("pinterest");
    expect(proposal.rationale).toContain("pinterest");
  });

  it("metric set B (instagram performs, cross-source) → proposal changes to lead with instagram", () => {
    const B = dashboard([
      // instagram now wins, and engagement sums ACROSS sources (sessions + clicks).
      {
        channel: "instagram",
        metrics: [
          { source: "ga4", metric: "sessions", value: 50 },
          { source: "affiliate", metric: "clicks", value: 10 },
        ],
      },
      { channel: "pinterest", metrics: [{ source: "affiliate", metric: "clicks", value: 5 }] },
    ]);

    const { signal, proposal } = nextProposalFrom(B);

    expect(signal.topChannel).toBe("instagram");
    expect(signal.underperformers).toEqual(["pinterest"]);
    expect(proposal.primaryChannel).toBe("instagram");
    // The SAME pair of channels now ranks the other way → the plan flipped.
    expect(proposal.emphasis.find((e) => e.channel === "instagram")).toEqual({
      channel: "instagram",
      score: 60,
      weight: "primary",
    });
    expect(proposal.emphasis.find((e) => e.channel === "pinterest")?.weight).toBe("deprioritize");
    expect(proposal.promptHint).toContain("instagram");
  });

  it("ignores inventory/rank metrics (posts, avg_position) and unattributed channel", () => {
    const d = dashboard([
      // 'blog' has only effort/rank metrics → score 0, never the top performer.
      {
        channel: "blog",
        metrics: [
          { source: "social", metric: "posts", value: 99 },
          { source: "search_console", metric: "avg_position", value: 3 },
        ],
      },
      { channel: "organic", metrics: [{ source: "ga4", metric: "sessions", value: 12 }] },
      // unattributed engagement must not become the recommended channel.
      { channel: "unattributed", metrics: [{ source: "affiliate", metric: "clicks", value: 1000 }] },
    ]);

    const signal = deriveFeedbackSignal(d);
    expect(signal.topChannel).toBe("organic");
    expect(signal.channelRanking.map((c) => c.channel)).not.toContain("unattributed");
    expect(signal.channelRanking.find((c) => c.channel === "blog")?.score).toBe(0);
  });

  it("breaks ties deterministically by channel name", () => {
    const d = dashboard([
      { channel: "x", metrics: [{ source: "ga4", metric: "sessions", value: 10 }] },
      { channel: "instagram", metrics: [{ source: "ga4", metric: "sessions", value: 10 }] },
    ]);
    const signal = deriveFeedbackSignal(d);
    // Equal scores → alphabetical: instagram before x; neither is below the mean.
    expect(signal.channelRanking.map((c) => c.channel)).toEqual(["instagram", "x"]);
    expect(signal.topChannel).toBe("instagram");
    expect(signal.underperformers).toEqual([]);
  });

  it("no metrics → neutral, unadapted proposal", () => {
    const { signal, proposal } = nextProposalFrom(dashboard([]));
    expect(signal.topChannel).toBeNull();
    expect(proposal.primaryChannel).toBeNull();
    expect(proposal.emphasis).toEqual([]);
    expect(proposal.rationale).toContain("Nessuna metrica");
  });

  it("buildContentProposal is a pure function of the signal", () => {
    const signal = {
      channelRanking: [
        { channel: "pinterest", score: 40 },
        { channel: "instagram", score: 5 },
      ],
      topChannel: "pinterest",
      underperformers: ["instagram"],
    };
    expect(buildContentProposal(signal)).toEqual(buildContentProposal(signal));
  });
});
