import { describe, it, expect } from "vitest";
import {
  MeteredLlmAdapter,
  StubLlmAdapter,
  createLlmPortFromEnv,
  type LlmPort,
  type LlmRequest,
  type LlmResponse,
} from "./llm";
import type { MeteringService, MeteringRecordInput } from "./metering";
import { BudgetExceededError, type BudgetGuard } from "./budget-guard";

function req(over: Partial<LlmRequest> = {}): LlmRequest {
  return {
    tenantId: "t1",
    agentId: "writer",
    runId: "11111111-1111-1111-1111-111111111111",
    model: "balanced",
    system: [{ type: "text", text: "system" }],
    messages: [{ role: "user", content: "scrivi" }],
    maxTokens: 1_000,
    ...over,
  };
}

class SpyLlm implements LlmPort {
  public calls = 0;
  constructor(private readonly usage: LlmResponse["usage"]) {}
  async complete(): Promise<LlmResponse> {
    this.calls++;
    return { content: "draft", stopReason: "end_turn", usage: this.usage };
  }
}

function fakeMetering(sink: MeteringRecordInput[]): MeteringService {
  return {
    record: async (i) => {
      sink.push(i);
    },
    monthlySpendUsd: async () => 0,
  };
}

const okBudget: BudgetGuard = { check: async () => {} };

describe("MeteredLlmAdapter", () => {
  it("records AFTER complete, with the response's usage attributed to the request", async () => {
    const usage = { inputTokens: 120, outputTokens: 40, cacheReadTokens: 10 };
    const inner = new SpyLlm(usage);
    const recorded: MeteringRecordInput[] = [];
    const llm = new MeteredLlmAdapter(inner, {
      metering: fakeMetering(recorded),
      budget: okBudget,
    });

    const resp = await llm.complete(req());

    expect(inner.calls).toBe(1);
    expect(resp.content).toBe("draft");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      tenantId: "t1",
      agentName: "writer",
      runId: "11111111-1111-1111-1111-111111111111",
      model: "balanced",
      usage,
    });
  });

  it("does NOT call complete (nor record) when the budget guard throws", async () => {
    const inner = new SpyLlm({ inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 });
    const recorded: MeteringRecordInput[] = [];
    const denyBudget: BudgetGuard = {
      check: async () => {
        throw new BudgetExceededError({
          tenantId: "t1",
          level: "L2",
          capUsd: 1,
          spentUsd: 2,
        });
      },
    };
    const llm = new MeteredLlmAdapter(inner, {
      metering: fakeMetering(recorded),
      budget: denyBudget,
    });

    await expect(llm.complete(req())).rejects.toBeInstanceOf(BudgetExceededError);
    expect(inner.calls).toBe(0);
    expect(recorded).toHaveLength(0);
  });
});

describe("createLlmPortFromEnv composition", () => {
  it("returns a bare port when no metering deps are given (back-compat)", () => {
    const port = createLlmPortFromEnv();
    expect(port).not.toBeInstanceOf(MeteredLlmAdapter);
    expect(typeof port.complete).toBe("function");
  });

  it("composes metered(anthropic|stub) when metering deps are supplied", () => {
    const port = createLlmPortFromEnv({
      metering: fakeMetering([]),
      budget: okBudget,
    });
    expect(port).toBeInstanceOf(MeteredLlmAdapter);
  });

  it("the metered stub still records its (zero) usage event", async () => {
    // Build over the stub explicitly so the assertion never depends on whether
    // ANTHROPIC_API_KEY happens to be present (no network in tests).
    const recorded: MeteringRecordInput[] = [];
    const port = new MeteredLlmAdapter(new StubLlmAdapter(), {
      metering: fakeMetering(recorded),
      budget: okBudget,
    });
    await port.complete(req({ runId: undefined }));
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
    });
  });
});
