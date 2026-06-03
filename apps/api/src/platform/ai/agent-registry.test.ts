import { describe, it, expect } from "vitest";
import {
  AgentRegistry,
  hashAgentDefinition,
  type AgentDefinition,
} from "./agent-registry";
import type { SchemaLike } from "./tools";

const stringSchema: SchemaLike<string> = {
  safeParse: (i) =>
    typeof i === "string" && i.length > 0
      ? { success: true, data: i }
      : { success: false, error: "not a non-empty string" },
  parse: (i) => {
    if (typeof i !== "string" || !i.length) throw new Error("invalid");
    return i;
  },
};

function baseDef(over: Partial<AgentDefinition<string>> = {}): AgentDefinition<string> {
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

describe("AgentRegistry", () => {
  it("registers and gets a definition", () => {
    const reg = new AgentRegistry();
    const def = baseDef();
    reg.register(def);
    expect(reg.get("stub")).toBe(def);
  });

  it("throws on an unknown agent and on a double registration", () => {
    const reg = new AgentRegistry();
    expect(() => reg.get("nope")).toThrow(/unknown agent/);
    reg.register(baseDef());
    expect(() => reg.register(baseDef())).toThrow(/already registered/);
  });
});

describe("hashAgentDefinition / version", () => {
  it("is stable: the same definition yields the same version", () => {
    expect(hashAgentDefinition(baseDef())).toBe(hashAgentDefinition(baseDef()));
  });

  it("is insensitive to functions/schemas (only identifying fields count)", () => {
    const a = baseDef({ outputSchema: stringSchema, exitGate: () => null });
    const b = baseDef({ outputSchema: { ...stringSchema }, parseOutput: (s) => s });
    expect(hashAgentDefinition(a)).toBe(hashAgentDefinition(b));
  });

  it("changes when an identifying field changes", () => {
    const base = hashAgentDefinition(baseDef());
    expect(hashAgentDefinition(baseDef({ maxSteps: 4 }))).not.toBe(base);
    expect(hashAgentDefinition(baseDef({ systemPrompt: "different" }))).not.toBe(base);
    expect(hashAgentDefinition(baseDef({ model: "balanced" }))).not.toBe(base);
  });

  it("AgentRegistry.version delegates to the hash", () => {
    const reg = new AgentRegistry();
    const def = baseDef();
    reg.register(def);
    expect(reg.version("stub")).toBe(hashAgentDefinition(def));
    expect(reg.version("stub")).toMatch(/^v1-[0-9a-f]{16}$/);
  });
});
