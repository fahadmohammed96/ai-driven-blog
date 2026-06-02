import { describe, it, expect, vi } from "vitest";
import { AgentRunner, type RunContext } from "./agent-runner";
import { AgentRegistry, type AgentDefinition } from "./agent-registry";
import { ToolRegistry } from "./tool-registry";
import { StubLlmAdapter, type LlmPort } from "./llm";
import type { SchemaLike, ToolDefinition } from "./tools";
import type {
  AgentRunStore,
  AgentRunRecord,
  AgentRunWrite,
} from "./agent-run-store";
import type { BudgetGuard } from "./budget-guard";

// ── test doubles ────────────────────────────────────────────────────────────

const STUB_DRAFT =
  "Ho vissuto questa tappa con calma, lasciandomi sorprendere da ogni dettaglio e da ogni incontro.";

const stringSchema: SchemaLike<string> = {
  safeParse: (i) =>
    typeof i === "string" && i.length > 0
      ? { success: true, data: i }
      : { success: false, error: "not a non-empty string" },
  parse: (i) => {
    if (typeof i !== "string" || !i.length) throw new Error("invalid payload");
    return i;
  },
};

/** A deterministic dummy tool — read-only, used ONLY in tests (no real module). */
function makeDummyTool(): {
  tool: ToolDefinition<{ q: string }, { echo: string }>;
  calls: () => number;
} {
  let calls = 0;
  const inputSchema: SchemaLike<{ q: string }> = {
    safeParse: (i) =>
      typeof i === "object" && i !== null && typeof (i as { q?: unknown }).q === "string"
        ? { success: true, data: i as { q: string } }
        : { success: false, error: "bad" },
    parse: (i) => i as { q: string },
  };
  const outputSchema: SchemaLike<{ echo: string }> = {
    safeParse: (i) => ({ success: true, data: i as { echo: string } }),
    parse: (i) => i as { echo: string },
  };
  const tool: ToolDefinition<{ q: string }, { echo: string }> = {
    id: "dummy",
    description: "echoes the query",
    inputSchema,
    outputSchema,
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 100,
    stubArgs: () => ({ q: "ping" }),
    execute: async (input) => {
      calls++;
      return { echo: input.q };
    },
  };
  return { tool, calls: () => calls };
}

function stubAgent(over: Partial<AgentDefinition<string>> = {}): AgentDefinition<string> {
  return {
    id: "stub",
    role: "test agent",
    systemPrompt: "you are a test",
    model: "fast",
    allowedTools: [],
    maxSteps: 3,
    maxTokens: 1_000,
    maxContextTokens: 10_000,
    budgetCap: { inputTokens: 1_000, outputTokens: 1_000 },
    outputSchema: stringSchema,
    autonomyAxis: "writer",
    proposalType: "content_draft",
    ...over,
  };
}

class FakeStore implements AgentRunStore {
  readonly rows: AgentRunWrite[] = [];
  async findByTaskId(tenantId: string, taskId: string): Promise<AgentRunRecord | null> {
    const w = this.rows.find((r) => r.tenantId === tenantId && r.taskId === taskId);
    return w ? { ...w, createdAt: new Date("2026-06-01T00:00:00Z") } : null;
  }
  async record(write: AgentRunWrite): Promise<void> {
    this.rows.push(write);
  }
}

/** Counts round-trips so we can prove idempotency skips the LLM entirely. */
class CountingLlm implements LlmPort {
  calls = 0;
  constructor(private readonly inner: LlmPort) {}
  async complete(req: Parameters<LlmPort["complete"]>[0]) {
    this.calls++;
    return this.inner.complete(req);
  }
}

/** A port that returns a single `max_tokens`-truncated response with fixed content. */
function maxTokensLlm(content: string): LlmPort {
  return {
    complete: async () => ({
      content,
      stopReason: "max_tokens" as const,
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
    }),
  };
}

const okBudget: BudgetGuard = { check: async () => {} };

const TENANT = "11111111-1111-1111-1111-111111111111";
const ctx = (over: Partial<RunContext> = {}): RunContext => ({
  tenantId: TENANT,
  triggeredAt: new Date("2026-06-01T10:00:00Z"),
  ...over,
});

function runner(llm: LlmPort, store: AgentRunStore, tools = new ToolRegistry()) {
  return new AgentRunner({ llm, tools, store, budget: okBudget });
}

// ── tests ─────────────────────────────────────────────────────────────────

describe("AgentRunner — generic ReAct loop", () => {
  it("immediate-end-turn → valid Proposal in 1 step", async () => {
    const llm = new CountingLlm(new StubLlmAdapter({ scenario: "immediate-end-turn" }));
    const store = new FakeStore();
    const proposal = await runner(llm, store).run(
      stubAgent(),
      { subjectId: "s1", content: "scrivi" },
      ctx(),
    );

    expect(llm.calls).toBe(1);
    expect(proposal.payload).toBe(STUB_DRAFT);
    expect(proposal.truncated).toBe(false);
    expect(proposal.requiresHumanGate).toBe(true);
    expect(proposal.status).toBe("pending");
    expect(proposal.type).toBe("content_draft");
    expect(proposal.auditRecorded).toBe(true);
    expect(proposal.tokensUsed).toEqual({ input: 0, output: 0, cached: 0 });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.steps).toBe(1);
  });

  it("agent_definition_version is present on the proposal and the audit row", async () => {
    const llm = new StubLlmAdapter({ scenario: "immediate-end-turn" });
    const store = new FakeStore();
    const def = stubAgent();
    const proposal = await runner(llm, store).run(
      def,
      { subjectId: "s1", content: "scrivi" },
      ctx(),
    );
    expect(proposal.agentDefinitionVersion).toMatch(/^v1-[0-9a-f]{16}$/);
    expect(store.rows[0]!.agentDefinitionVersion).toBe(proposal.agentDefinitionVersion);
  });

  it("one-tool-then-end → tool runs, result is appended, second step produces the payload", async () => {
    const { tool, calls } = makeDummyTool();
    const tools = new ToolRegistry([tool]);
    const llm = new CountingLlm(new StubLlmAdapter({ scenario: "one-tool-then-end" }));
    const store = new FakeStore();

    const proposal = await runner(llm, store, tools).run(
      stubAgent({ allowedTools: ["dummy"] }),
      { subjectId: "s2", content: "scrivi" },
      ctx(),
    );

    expect(calls()).toBe(1);
    expect(llm.calls).toBe(2);
    expect(proposal.payload).toBe(STUB_DRAFT);
    expect(proposal.truncated).toBe(false);
    expect(store.rows[0]!.steps).toBe(2);
    expect(store.rows[0]!.toolCalls).toHaveLength(1);
    expect(store.rows[0]!.toolCalls[0]!.name).toBe("dummy");
  });

  it("cycle-until-max → maxSteps with an unparseable partial → INVALID, non-approvable (DEBT-029)", async () => {
    const { tool } = makeDummyTool();
    const tools = new ToolRegistry([tool]);
    const llm = new CountingLlm(new StubLlmAdapter({ scenario: "cycle-until-max" }));
    const store = new FakeStore();

    const proposal = await runner(llm, store, tools).run(
      stubAgent({ allowedTools: ["dummy"], maxSteps: 2 }),
      { subjectId: "s3", content: "scrivi" },
      ctx(),
    );

    expect(llm.calls).toBe(2);
    expect(proposal.truncated).toBe(true);
    // The dangling tool_use leaves an empty partial that fails outputSchema, so the
    // run is staged as `invalid` (the gate hides/refuses it) — never a raw payload.
    expect(proposal.status).toBe("invalid");
    expect(store.rows[0]!.steps).toBe(2);
    expect(store.rows[0]!.envelope.status).toBe("invalid");
  });

  it("truncated but the partial still validates → kept as an approvable PENDING partial (DEBT-029)", async () => {
    const store = new FakeStore();
    const proposal = await runner(maxTokensLlm("Un racconto parziale ma valido."), store).run(
      stubAgent(),
      { subjectId: "s8", content: "scrivi" },
      ctx(),
    );

    expect(proposal.truncated).toBe(true);
    // lastContent passes the outputSchema → salvaged via parseOutput/schema, approvable.
    expect(proposal.status).toBe("pending");
    expect(proposal.payload).toBe("Un racconto parziale ma valido.");
    expect(store.rows[0]!.envelope.status).toBe("pending");
  });

  it("replay of an INVALID run stays invalid (no re-run, still non-approvable) (DEBT-029)", async () => {
    const { tool } = makeDummyTool();
    const tools = new ToolRegistry([tool]);
    const llm = new CountingLlm(new StubLlmAdapter({ scenario: "cycle-until-max" }));
    const store = new FakeStore();
    const r = runner(llm, store, tools);
    const def = stubAgent({ allowedTools: ["dummy"], maxSteps: 2 });
    const input = { subjectId: "s9", content: "scrivi" };

    const first = await r.run(def, input, ctx());
    expect(first.status).toBe("invalid");
    expect(llm.calls).toBe(2);

    const second = await r.run(def, input, ctx());
    expect(llm.calls).toBe(2); // replayed, not re-run
    expect(second.status).toBe("invalid");
    expect(second.id).toBe(first.runId);
  });

  it("idempotency: a second run with the same taskId returns the existing proposal, no LLM call", async () => {
    const llm = new CountingLlm(new StubLlmAdapter({ scenario: "immediate-end-turn" }));
    const store = new FakeStore();
    const r = runner(llm, store);
    const input = { subjectId: "s4", content: "scrivi" };

    const first = await r.run(stubAgent(), input, ctx());
    expect(llm.calls).toBe(1);

    const second = await r.run(stubAgent(), input, ctx());
    // The LLM was NOT touched again.
    expect(llm.calls).toBe(1);
    expect(store.rows).toHaveLength(1);
    // The replay returns the SAME run (id == the stored run id == first.runId).
    expect(second.runId).toBe(first.runId);
    expect(second.id).toBe(first.runId);
    expect(second.payload).toBe(first.payload);
  });

  it("pluggable exit gate that rejects once → exactly ONE extra iteration", async () => {
    const gate = vi
      .fn<(p: string) => { feedbackHint: string } | null>()
      .mockReturnValueOnce({ feedbackHint: "be more authentic" })
      .mockReturnValue(null);
    const llm = new CountingLlm(new StubLlmAdapter({ scenario: "immediate-end-turn" }));
    const store = new FakeStore();

    const proposal = await runner(llm, store).run(
      stubAgent({ exitGate: gate }),
      { subjectId: "s5", content: "scrivi" },
      ctx(),
    );

    expect(gate).toHaveBeenCalledTimes(2);
    expect(llm.calls).toBe(2); // one rejection + one acceptance, never more
    expect(proposal.truncated).toBe(false);
    expect(proposal.payload).toBe(STUB_DRAFT);
  });

  it("audit write failure → auditRecorded=false + structured log, proposal still returned", async () => {
    const failing: AgentRunStore = {
      findByTaskId: async () => null,
      record: async () => {
        throw new Error("permission denied for table ai_agent_runs");
      },
    };
    const errors: Array<{ message: string; meta?: Record<string, unknown> }> = [];
    const llm = new StubLlmAdapter({ scenario: "immediate-end-turn" });
    const r = new AgentRunner({
      llm,
      tools: new ToolRegistry(),
      store: failing,
      budget: okBudget,
      logger: { error: (message, meta) => errors.push({ message, meta }) },
    });

    const proposal = await r.run(
      stubAgent(),
      { subjectId: "s6", content: "scrivi" },
      ctx(),
    );

    expect(proposal.auditRecorded).toBe(false);
    expect(proposal.payload).toBe(STUB_DRAFT);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/audit write failed/);
    expect(errors[0]!.meta).toMatchObject({ tenantId: TENANT, agentId: "stub" });
  });

  it("registry-driven: the runner accepts a definition resolved from the registry", async () => {
    const reg = new AgentRegistry();
    reg.register(stubAgent());
    const llm = new StubLlmAdapter({ scenario: "immediate-end-turn" });
    const store = new FakeStore();
    const proposal = await runner(llm, store).run(
      reg.get("stub") as AgentDefinition<string>,
      { subjectId: "s7", content: "scrivi" },
      ctx(),
    );
    expect(proposal.agentDefinitionVersion).toBe(reg.version("stub"));
  });
});
