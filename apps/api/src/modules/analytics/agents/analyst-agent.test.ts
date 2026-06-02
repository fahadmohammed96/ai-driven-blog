import { describe, it, expect } from "vitest";
import { performanceReportSchema, type AnalyticsDashboard } from "@blogs/contracts";
import { AnalystAgent, type AnalystAccessors } from "./analyst-agent";
import { aggregateChannelBreakdown, rankTopContent } from "./aggregate";
import { StubLlmAdapter, type LlmPort, type LlmRequest } from "../../../platform/ai/llm";
import type {
  AgentRunStore,
  AgentRunRecord,
} from "../../../platform/ai/agent-run-store";

// Analyst Agent on the generic AgentRunner (Slice O1). Stub LLM everywhere → zero
// cost. The aggregation is deterministic; the LLM only narrates insights.

const TENANT = "11111111-1111-1111-1111-111111111111";
const ITEM_A = "22222222-2222-2222-2222-222222222222";
const ITEM_B = "33333333-3333-3333-3333-333333333333";

/** A cross-channel dashboard fixture: organic > instagram > blog by engagement. */
function fixtureDashboard(): AnalyticsDashboard {
  return {
    rows: [
      { source: "social", kind: "internal", channel: "instagram", metric: "clicks", value: 50, period: "all", contentItemId: ITEM_A },
      { source: "affiliate", kind: "internal", channel: "blog", metric: "clicks", value: 10, period: "all", contentItemId: ITEM_A },
      { source: "ga4", kind: "external", channel: "organic", metric: "sessions", value: 120, period: "all", contentItemId: ITEM_B },
    ],
    bySource: [],
    byChannel: [
      { channel: "instagram", metrics: [{ source: "social", metric: "clicks", value: 50 }] },
      { channel: "blog", metrics: [{ source: "affiliate", metric: "clicks", value: 10 }] },
      { channel: "organic", metrics: [{ source: "ga4", metric: "sessions", value: 120 }] },
    ],
    ingestedAt: "2026-06-01T00:00:00.000Z",
  };
}

function fakeAccessors(dashboard = fixtureDashboard()): AnalystAccessors {
  return { dashboard: async () => dashboard };
}

/** A spy port that records every request and returns a fixed end_turn completion. */
function spyLlm(content = "prose, not JSON"): { port: LlmPort; calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  const port: LlmPort = {
    complete: async (req) => {
      calls.push(req);
      return {
        content,
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
      };
    },
  };
  return { port, calls };
}

/** Full in-memory AgentRunStore so the runner's replay branch is exercised. */
function memStore(): AgentRunStore {
  const rows = new Map<string, AgentRunRecord>();
  return {
    findByTaskId: async (tenantId, taskId) => rows.get(`${tenantId}:${taskId}`) ?? null,
    record: async (rec) => {
      rows.set(`${rec.tenantId}:${rec.taskId}`, {
        ...rec,
        createdAt: new Date("2026-06-01T10:00:00.000Z"),
      });
    },
  };
}

describe("aggregate (deterministic, pure)", () => {
  it("rolls channels up per metric, sorted (channel + metric) for stability", () => {
    const a = aggregateChannelBreakdown(fixtureDashboard());
    const b = aggregateChannelBreakdown(fixtureDashboard());
    expect(a).toEqual(b);
    expect(a.map((c) => c.channel)).toEqual(["blog", "instagram", "organic"]);
  });

  it("ranks content by aggregate engagement, dominant metric, descending", () => {
    const top = rankTopContent(fixtureDashboard(), 5);
    // ITEM_B: sessions 120; ITEM_A: clicks 50+10 = 60.
    expect(top).toEqual([
      { contentItemId: ITEM_B, value: 120, metric: "sessions" },
      { contentItemId: ITEM_A, value: 60, metric: "clicks" },
    ]);
  });
});

describe("AnalystAgent.run", () => {
  it("requires exactly one of { llm, provider }", () => {
    expect(() => new AnalystAgent({ accessors: fakeAccessors() } as never)).toThrow();
  });

  it("produces a valid PerformanceReport with NON-EMPTY insights from a prose stub", async () => {
    const agent = new AnalystAgent({ llm: new StubLlmAdapter(), accessors: fakeAccessors() });
    const proposal = await agent.run({ periodDays: 30, mode: "sync" }, { tenantId: TENANT });

    expect(proposal.type).toBe("analyst_insight");
    expect(proposal.agentId).toBe("analyst");
    expect(proposal.requiresHumanGate).toBe(true);
    expect(performanceReportSchema.safeParse(proposal.payload).success).toBe(true);

    const report = proposal.payload;
    expect(report.period.days).toBe(30);
    expect(report.insights.length).toBeGreaterThan(0);
    expect(report.recommendations.length).toBeGreaterThan(0);
    // Deterministic structure: organic is the top channel.
    expect(report.insights.some((i) => i.includes("organic"))).toBe(true);
    expect(report.channelBreakdown.map((c) => c.channel)).toEqual(["blog", "instagram", "organic"]);
    expect(report.topContent[0]!.contentItemId).toBe(ITEM_B);
  });

  it("aggregation is deterministic: same input → same channelBreakdown/topContent", async () => {
    const mk = () => new AnalystAgent({ llm: spyLlm().port, accessors: fakeAccessors() });
    const p1 = await mk().run({ periodDays: 30, mode: "sync" }, { tenantId: TENANT });
    const p2 = await mk().run({ periodDays: 30, mode: "sync" }, { tenantId: TENANT });
    expect(p2.payload.channelBreakdown).toEqual(p1.payload.channelBreakdown);
    expect(p2.payload.topContent).toEqual(p1.payload.topContent);
  });

  it("merges the LLM's JSON narrative on top of the deterministic seed", async () => {
    const content = JSON.stringify({
      insights: ["Insight dal modello."],
      recommendations: ["Raccomandazione dal modello."],
    });
    const agent = new AnalystAgent({ llm: new StubLlmAdapter({ content }), accessors: fakeAccessors() });
    const { payload } = await agent.run({ periodDays: 14, mode: "sync" }, { tenantId: TENANT });
    expect(payload.insights).toContain("Insight dal modello.");
    expect(payload.recommendations).toContain("Raccomandazione dal modello.");
    // The deterministic seed is still present (insights never replaced, only extended).
    expect(payload.insights.length).toBeGreaterThan(1);
  });

  it("BATCH path → SAME schema and SAME aggregation as the SYNC path (parity)", async () => {
    const sync = await new AnalystAgent({ llm: new StubLlmAdapter(), accessors: fakeAccessors() })
      .run({ periodDays: 30, mode: "sync" }, { tenantId: TENANT });
    const batch = await new AnalystAgent({ llm: new StubLlmAdapter(), accessors: fakeAccessors() })
      .run({ periodDays: 30, mode: "batch" }, { tenantId: TENANT });

    expect(performanceReportSchema.safeParse(sync.payload).success).toBe(true);
    expect(performanceReportSchema.safeParse(batch.payload).success).toBe(true);
    // Same schema AND same deterministic content (DEBT-037: batch == sync today).
    expect(batch.payload.channelBreakdown).toEqual(sync.payload.channelBreakdown);
    expect(batch.payload.topContent).toEqual(sync.payload.topContent);
    expect(batch.payload.period).toEqual(sync.payload.period);
  });

  it("IDEMPOTENT: same tenant|period|mode → STABLE proposal id (staging dedup)", async () => {
    const store = memStore();
    const triggeredAt = new Date("2026-06-01T10:00:00.000Z");
    const mk = () => new AnalystAgent({ llm: spyLlm().port, accessors: fakeAccessors(), store });
    const p1 = await mk().run({ periodDays: 30, mode: "sync" }, { tenantId: TENANT, triggeredAt });
    const p2 = await mk().run({ periodDays: 30, mode: "sync" }, { tenantId: TENANT, triggeredAt });
    // Stable id across replays → persist's onConflictDoNothing(id) dedupes.
    expect(p2.id).toBe(p1.id);
    expect(p2.id).toBe(p2.runId);
  });

  it("a DIFFERENT periodDays is NOT a replay (re-keys the run)", async () => {
    const store = memStore();
    const triggeredAt = new Date("2026-06-01T10:00:00.000Z");
    const mk = () => new AnalystAgent({ llm: spyLlm().port, accessors: fakeAccessors(), store });
    const p30 = await mk().run({ periodDays: 30, mode: "sync" }, { tenantId: TENANT, triggeredAt });
    const p7 = await mk().run({ periodDays: 7, mode: "sync" }, { tenantId: TENANT, triggeredAt });
    expect(p7.id).not.toBe(p30.id);
    expect(p7.payload.period.days).toBe(7);
    expect(p30.payload.period.days).toBe(30);
  });
});
