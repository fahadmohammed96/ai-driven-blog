import { describe, it, expect } from "vitest";
import * as aiPublic from "./index";

/**
 * Architectural guard (critica #14): the public barrel of `platform/ai` is the
 * ONLY supported entry point for the LLM layer. It exposes the port + factory +
 * types, and deliberately HIDES the concrete adapters so no caller can pin
 * itself to Anthropic or to the stub. A direct `import { AnthropicLlmAdapter }`
 * is then indistinguishable from a mistake — which is the point.
 */
describe("platform/ai public barrel", () => {
  const exported = Object.keys(aiPublic).sort();

  it("exports exactly the port surface (and nothing else)", () => {
    expect(exported).toEqual(["createLlmFromEnv"].sort());
  });

  it("does NOT export the concrete adapters", () => {
    expect(exported).not.toContain("AnthropicLlmAdapter");
    expect(exported).not.toContain("StubLlmAdapter");
    expect(exported).not.toContain("AnthropicLlmClient");
    expect(exported).not.toContain("StubLlmClient");
  });

  it("exposes a working env factory that returns an LlmPort", () => {
    const port = aiPublic.createLlmFromEnv();
    expect(typeof port.complete).toBe("function");
  });
});
