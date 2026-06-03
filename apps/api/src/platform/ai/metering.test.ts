import { describe, it, expect } from "vitest";
import { computeCostUsd } from "./metering";
import { pricePerToken, type ModelTier } from "./model-registry";

describe("computeCostUsd (pure, deterministic cost from tier price + usage)", () => {
  it("prices input + output + cache-read tokens each at their tier rate", () => {
    const usage = { inputTokens: 1_000, outputTokens: 500, cacheReadTokens: 2_000 };
    const p = pricePerToken("balanced");
    const expected =
      usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead;
    expect(computeCostUsd("balanced", usage)).toBeCloseTo(expected, 12);
    // balanced: in $3/Mtok, out $15/Mtok, cache $0.3/Mtok
    expect(computeCostUsd("balanced", usage)).toBeCloseTo(0.0111, 10);
  });

  it("is zero for zero usage (the stub adapter never costs anything)", () => {
    for (const tier of ["fast", "balanced", "powerful"] as ModelTier[]) {
      expect(
        computeCostUsd(tier, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }),
      ).toBe(0);
    }
  });

  it("charges cache reads far less than fresh input tokens", () => {
    const fresh = computeCostUsd("balanced", {
      inputTokens: 1_000,
      outputTokens: 0,
      cacheReadTokens: 0,
    });
    const cached = computeCostUsd("balanced", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000,
    });
    expect(cached).toBeLessThan(fresh);
  });
});
