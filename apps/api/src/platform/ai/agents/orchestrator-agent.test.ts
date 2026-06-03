import { describe, it, expect } from "vitest";
import { editorialPlanSchema } from "@blogs/contracts";
import {
  OrchestratorAgent,
  type OrchestratorAccessors,
  type OrchestratorSubAgents,
} from "./orchestrator-agent";
import { WriterAgent, type WriterAccessors } from "./writer-agent";
import { AnalystAgent } from "../../../modules/analytics/agents/analyst-agent";
import type { AnalystAccessors } from "../../../modules/analytics/agents/analyst-agent";
import type { AnalyticsDashboard } from "@blogs/contracts";
import { StubLlmAdapter, type LlmPort, type LlmResponse } from "../llm";
import { TwoLevelBudgetGuard } from "../budget-guard";
import type { AgentRunStore, AgentRunRecord } from "../agent-run-store";

/**
 * Editorial Orchestrator (Slice O3) — flat, centralized orchestration. The
 * Orchestrator calls the other agents as TOOLS, isolates their failures into
 * `agentNotes`, and ALWAYS produces a propose-only `Proposal<EditorialPlan>`.
 * Stub LLM everywhere → zero cost. The plan's slots come from a deterministic
 * seed, so even an immediate end_turn yields a valid, non-empty plan.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";
const ZERO = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };

function fakeAccessors(over: Partial<OrchestratorAccessors> = {}): OrchestratorAccessors {
  return {
    getContentCalendar: async () => [
      { contentItemId: "c1", title: "Bozza ferma", status: "draft" },
    ],
    listTrips: async () => [
      { id: "t1", title: "Tour della Toscana" },
      { id: "t2", title: "Costa Amalfitana" },
    ],
    getTenantSettings: async () => ({
      channels: ["blog", "instagram"],
      specialistAutonomy: { writer: "manual", seo: "manual", social: "manual", email: "manual" },
    }),
    ...over,
  };
}

/**
 * A scripted LLM port: each entry is either a tool name to call this step or an
 * `end` payload to finish. The orchestrator's loop drives these in order.
 */
type Step = { tool: string } | { end: string };
function scriptedLlm(steps: Step[]): LlmPort {
  let i = 0;
  return {
    complete: async (req): Promise<LlmResponse> => {
      const step = steps[Math.min(i, steps.length - 1)]!;
      i += 1;
      if ("end" in step) {
        return { content: step.end, stopReason: "end_turn", usage: { ...ZERO } };
      }
      const tool = req.tools?.find((t) => t.id === step.tool);
      return {
        content: "",
        toolCalls: tool ? [{ id: `call-${i}`, name: tool.id, input: tool.stubArgs() }] : [],
        stopReason: "tool_use",
        usage: { ...ZERO },
      };
    },
  };
}

/** Full in-memory AgentRunStore so the runner's idempotent replay branch fires. */
function memStore(): AgentRunStore {
  const rows = new Map<string, AgentRunRecord>();
  return {
    findByTaskId: async (tenantId, taskId) => rows.get(`${tenantId}:${taskId}`) ?? null,
    record: async (rec) => {
      rows.set(`${rec.tenantId}:${rec.taskId}`, {
        ...rec,
        createdAt: new Date("2026-06-02T10:00:00.000Z"),
      });
    },
  };
}

describe("OrchestratorAgent.run", () => {
  it("requires exactly one of { llm, provider }", () => {
    expect(
      () => new OrchestratorAgent({ accessors: fakeAccessors() } as never),
    ).toThrow();
  });

  it("produces a valid EditorialPlan with NON-EMPTY slots from a seed (immediate end_turn)", async () => {
    const agent = new OrchestratorAgent({
      llm: new StubLlmAdapter(), // returns prose → seed-only plan
      accessors: fakeAccessors(),
    });
    const proposal = await agent.run({ horizonDays: 14 }, { tenantId: TENANT });

    expect(proposal.type).toBe("editorial_plan");
    expect(proposal.agentId).toBe("orchestrator");
    expect(proposal.requiresHumanGate).toBe(true);
    expect(proposal.status).toBe("pending");
    expect(editorialPlanSchema.safeParse(proposal.payload).success).toBe(true);

    const plan = proposal.payload;
    expect(plan.horizonDays).toBe(14);
    expect(plan.slots.length).toBeGreaterThan(0);
    // 14 days → 2 weeks; uncovered trips become slot topics.
    expect(plan.slots.map((s) => s.topic)).toContain("Tour della Toscana");
    expect(plan.priorities.length).toBeGreaterThan(0);
  });

  it("invokes all three sub-agents as tools → their summaries land in agentNotes", async () => {
    const subAgents: OrchestratorSubAgents = {
      runWriter: async () => ({ summary: "bozza pronta" }),
      runSeo: async () => ({ summary: "meta ottimizzata" }),
      runAnalyst: async () => ({ summary: "instagram in crescita" }),
    };
    const agent = new OrchestratorAgent({
      llm: scriptedLlm([
        { tool: "runWriter" },
        { tool: "runSeo" },
        { tool: "runAnalyst" },
        { end: "{}" },
      ]),
      accessors: fakeAccessors(),
      subAgents,
    });
    const { payload } = await agent.run({ horizonDays: 7 }, { tenantId: TENANT });
    expect(payload.agentNotes.writer).toBe("bozza pronta");
    expect(payload.agentNotes.seo).toBe("meta ottimizzata");
    expect(payload.agentNotes.analyst).toBe("instagram in crescita");
  });

  it("merges the LLM's JSON priorities on top of the deterministic seed", async () => {
    const content = JSON.stringify({
      priorities: [{ item: "Priorità dal modello", why: "ragione" }],
    });
    const agent = new OrchestratorAgent({
      llm: new StubLlmAdapter({ content }),
      accessors: fakeAccessors(),
    });
    const { payload } = await agent.run({ horizonDays: 7 }, { tenantId: TENANT });
    expect(payload.priorities.some((p) => p.item === "Priorità dal modello")).toBe(true);
    // The deterministic seed is still present (priorities extended, not replaced).
    expect(payload.priorities.length).toBeGreaterThan(1);
  });

  it("ISOLATES a sub-agent failure into agentNotes — NO exception propagates", async () => {
    const subAgents: OrchestratorSubAgents = {
      runWriter: async () => {
        throw new Error("boom");
      },
    };
    const agent = new OrchestratorAgent({
      llm: scriptedLlm([{ tool: "runWriter" }, { end: "{}" }]),
      accessors: fakeAccessors(),
      subAgents,
    });
    // The whole run resolves (no throw) and still yields a valid plan.
    const { payload } = await agent.run({ horizonDays: 7 }, { tenantId: TENANT });
    expect(payload.agentNotes.writer).toMatch(/boom/);
    expect(payload.slots.length).toBeGreaterThan(0);
  });

  it("maxSteps reached → partial plan, truncated:true (still valid from the seed)", async () => {
    const subAgents: OrchestratorSubAgents = { runWriter: async () => ({ summary: "ok" }) };
    const agent = new OrchestratorAgent({
      llm: scriptedLlm([{ tool: "runWriter" }]), // always asks for a tool → never ends
      accessors: fakeAccessors(),
      subAgents,
    });
    const proposal = await agent.run({ horizonDays: 7 }, { tenantId: TENANT });
    expect(proposal.truncated).toBe(true);
    expect(editorialPlanSchema.safeParse(proposal.payload).success).toBe(true);
    expect(proposal.payload.slots.length).toBeGreaterThan(0);
  });

  it("BUDGET (critica #2/#10): the guard RE-READS spend → 2nd sub-agent is refused, recorded, no crash", async () => {
    // Shared budget guard whose metering FLIPS to over-cap after the first read,
    // proving the re-read: sub-agent #1 starts (spent 0), sub-agent #2 is refused.
    let reads = 0;
    const metering = { monthlySpendUsd: async () => (reads++ === 0 ? 0 : 1_000) };
    const budget = new TwoLevelBudgetGuard({ metering, resolveBudgetUsd: async () => 50 });

    const writerAcc: WriterAccessors = {
      embed: async () => [0, 0, 0],
      retrieve: async () => [],
    };
    const writer = new WriterAgent({
      llm: new StubLlmAdapter(),
      accessors: writerAcc,
      store: memStore(),
      budget,
    });
    const analystAcc: AnalystAccessors = {
      dashboard: async (): Promise<AnalyticsDashboard> => ({
        rows: [],
        bySource: [],
        byChannel: [],
        ingestedAt: "2026-06-01T00:00:00.000Z",
      }),
    };
    const analyst = new AnalystAgent({
      llm: new StubLlmAdapter(),
      accessors: analystAcc,
      store: memStore(),
      budget,
    });

    const subAgents: OrchestratorSubAgents = {
      runWriter: (_input, ctx) =>
        writer
          .run({ brief: "tema", voice: { tone: "t", audience: "a" } }, { tenantId: ctx.tenantId })
          .then((p) => ({ summary: p.payload.draft.slice(0, 20) })),
      runAnalyst: (_input, ctx) =>
        analyst
          .run({ periodDays: 30, mode: "sync" }, { tenantId: ctx.tenantId })
          .then((p) => ({ summary: `insight: ${p.payload.insights.length}` })),
    };

    const agent = new OrchestratorAgent({
      llm: scriptedLlm([{ tool: "runWriter" }, { tool: "runAnalyst" }, { end: "{}" }]),
      accessors: fakeAccessors(),
      subAgents,
      store: memStore(),
    });
    const { payload } = await agent.run({ horizonDays: 7 }, { tenantId: TENANT });

    // Writer ran (spent read #1 = 0 → OK); Analyst was refused (read #2 = over cap).
    expect(payload.agentNotes.writer).toBeTruthy();
    expect(payload.agentNotes.analyst).toMatch(/budget|exceeded/i);
    // The Orchestrator did NOT crash — a partial plan still ships.
    expect(payload.slots.length).toBeGreaterThan(0);
  });

  it("IDEMPOTENT: same tenant|horizon same day → STABLE id; different horizon → no replay", async () => {
    const store = memStore();
    const triggeredAt = new Date("2026-06-02T10:00:00.000Z");
    const mk = () =>
      new OrchestratorAgent({ llm: scriptedLlm([{ end: "{}" }]), accessors: fakeAccessors(), store });

    const p1 = await mk().run({ horizonDays: 30 }, { tenantId: TENANT, triggeredAt });
    const p2 = await mk().run({ horizonDays: 30 }, { tenantId: TENANT, triggeredAt });
    expect(p2.id).toBe(p1.id); // staging dedup: stable id == runId
    expect(p2.id).toBe(p2.runId);

    const p7 = await mk().run({ horizonDays: 7 }, { tenantId: TENANT, triggeredAt });
    expect(p7.id).not.toBe(p1.id); // a different horizon re-keys the run (no replay)
    expect(p7.payload.horizonDays).toBe(7);
  });

  it("PROPOSE-ONLY/SEAM: the plan is staged pending, never auto-executed", async () => {
    const agent = new OrchestratorAgent({ llm: new StubLlmAdapter(), accessors: fakeAccessors() });
    const proposal = await agent.run({ horizonDays: 7 }, { tenantId: TENANT });
    // Always staged pending behind the human gate; the autonomy engine (DEBT-041)
    // is not built, so nothing is auto-dispatched.
    expect(proposal.status).toBe("pending");
    expect(proposal.requiresHumanGate).toBe(true);
  });
});
