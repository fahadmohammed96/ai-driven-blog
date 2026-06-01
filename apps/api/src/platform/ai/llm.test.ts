import { describe, it, expect } from "vitest";
import { StubLlmAdapter } from "./llm";
import type { LlmRequest, Message } from "./llm";
import type { ToolDefinition, SchemaLike } from "./tools";

/**
 * A representative tool used to exercise the stub's tool-use path. It mirrors
 * the real `ToolDefinition` contract: `stubArgs()` MUST produce a value that the
 * tool's own `inputSchema.safeParse` accepts, so the stub never emits a
 * malformed tool call into the loop.
 */
interface GetStopArgs {
  itineraryId: string;
  stopIndex: number;
}

const stopSchema: SchemaLike<GetStopArgs> = {
  safeParse(input: unknown) {
    const v = input as Partial<GetStopArgs>;
    if (typeof v?.itineraryId === "string" && typeof v?.stopIndex === "number") {
      return { success: true, data: v as GetStopArgs };
    }
    return { success: false, error: "invalid GetStopArgs" };
  },
  parse(input: unknown) {
    const r = this.safeParse(input);
    if (!r.success) throw new Error("invalid");
    return r.data;
  },
};

const getStop: ToolDefinition<GetStopArgs, { text: string }> = {
  id: "getItineraryStop",
  description: "Read one canonical stop of an itinerary (deterministic).",
  inputSchema: stopSchema,
  outputSchema: {
    safeParse: (i) => ({ success: true, data: i as { text: string } }),
    parse: (i) => i as { text: string },
  },
  tenantScoped: true,
  side: "read",
  stubArgs: () => ({ itineraryId: "it-1", stopIndex: 0 }),
  async execute() {
    return { text: "stub" };
  },
};

const DEFINED_TOOLS: ToolDefinition[] = [getStop];

function baseReq(over: Partial<LlmRequest> = {}): LlmRequest {
  return {
    tenantId: "t1",
    agentId: "writer",
    runId: "run-1",
    model: "balanced",
    system: [{ type: "text", text: "system" }],
    tools: [getStop],
    messages: [{ role: "user", content: "scrivi" }],
    maxTokens: 1_000,
    ...over,
  };
}

describe("StubLlmAdapter — zero-cost, deterministic tool-use scenarios", () => {
  it("immediate-end-turn: no tool calls, stops on end_turn", async () => {
    const llm = new StubLlmAdapter({ scenario: "immediate-end-turn" });
    const resp = await llm.complete(baseReq());
    expect(resp.stopReason).toBe("end_turn");
    expect(resp.toolCalls ?? []).toHaveLength(0);
    expect(resp.content.length).toBeGreaterThan(0);
    expect(resp.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
    });
  });

  it("one-tool-then-end: step 1 calls allowedTools[0], step 2 ends", async () => {
    const llm = new StubLlmAdapter({ scenario: "one-tool-then-end" });

    const step1 = await llm.complete(baseReq());
    expect(step1.stopReason).toBe("tool_use");
    expect(step1.toolCalls).toBeDefined();
    expect(step1.toolCalls![0]!.name).toBe(DEFINED_TOOLS[0]!.id);

    // The tool result is appended to the transcript before the next step.
    const call = step1.toolCalls![0]!;
    const messages: Message[] = [
      { role: "user", content: "scrivi" },
      { role: "assistant", content: "" },
      { role: "tool_result", toolCallId: call.id, toolName: call.name, content: "ok" },
    ];
    const step2 = await llm.complete(baseReq({ messages }));
    expect(step2.stopReason).toBe("end_turn");
    expect(step2.toolCalls ?? []).toHaveLength(0);
  });

  it("cycle-until-max: always returns tool_use (drives the runner to maxSteps)", async () => {
    const llm = new StubLlmAdapter({ scenario: "cycle-until-max" });
    for (let i = 0; i < 5; i++) {
      const resp = await llm.complete(baseReq());
      expect(resp.stopReason).toBe("tool_use");
      expect(resp.toolCalls![0]!.name).toBe(DEFINED_TOOLS[0]!.id);
    }
  });

  it("builds tool args via the real tool's stubArgs() so they pass inputSchema", async () => {
    const llm = new StubLlmAdapter({ scenario: "one-tool-then-end" });
    const resp = await llm.complete(baseReq());
    const args = resp.toolCalls![0]!.input;
    expect(getStop.inputSchema.safeParse(args).success).toBe(true);
  });
});

describe("every defined tool's stubArgs() satisfies its own inputSchema", () => {
  it.each(DEFINED_TOOLS.map((t) => [t.id, t] as const))(
    "%s",
    (_id, tool) => {
      expect(tool.inputSchema.safeParse(tool.stubArgs()).success).toBe(true);
    },
  );
});
