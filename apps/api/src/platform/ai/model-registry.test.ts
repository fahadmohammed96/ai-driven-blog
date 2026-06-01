import { describe, it, expect } from "vitest";
import {
  MODEL_IDS,
  pricePerToken,
  estimateWorstCaseUsd,
  type ModelTier,
} from "./model-registry";

describe("model-registry tier -> model id mapping", () => {
  it("maps each tier to the agreed Anthropic model id", () => {
    expect(MODEL_IDS.fast).toBe("claude-haiku-4-5-20251001");
    expect(MODEL_IDS.balanced).toBe("claude-sonnet-4-6");
    expect(MODEL_IDS.powerful).toBe("claude-opus-4-8");
  });

  it("covers exactly the three tiers", () => {
    const tiers = Object.keys(MODEL_IDS).sort();
    expect(tiers).toEqual(["balanced", "fast", "powerful"]);
  });
});

describe("pricePerToken", () => {
  it("returns per-token prices (per-million / 1e6), output dearer than input", () => {
    for (const tier of ["fast", "balanced", "powerful"] as ModelTier[]) {
      const p = pricePerToken(tier);
      expect(p.input).toBeGreaterThan(0);
      expect(p.output).toBeGreaterThan(p.input);
      expect(p.cacheRead).toBeGreaterThan(0);
      expect(p.cacheRead).toBeLessThan(p.input); // cache reads are cheap
      // per-token, not per-million
      expect(p.output).toBeLessThan(1);
    }
  });
});

describe("estimateWorstCaseUsd (pure, deterministic — fuels the R1-B circuit-breaker)", () => {
  it("equals maxSteps * maxTokens * output-price-per-token * 1.3 buffer", () => {
    const def = { model: "balanced" as ModelTier, maxSteps: 4, maxTokens: 8_000 };
    const expected =
      def.maxSteps * def.maxTokens * pricePerToken(def.model).output * 1.3;
    expect(estimateWorstCaseUsd(def)).toBeCloseTo(expected, 10);
    // balanced output = $15/Mtok -> 0.000015/token; 4*8000*0.000015*1.3
    expect(estimateWorstCaseUsd(def)).toBeCloseTo(0.624, 6);
  });

  it("is monotonic in steps, tokens and tier strength", () => {
    const base = { model: "fast" as ModelTier, maxSteps: 2, maxTokens: 1_000 };
    expect(estimateWorstCaseUsd({ ...base, maxSteps: 4 })).toBeGreaterThan(
      estimateWorstCaseUsd(base),
    );
    expect(estimateWorstCaseUsd({ ...base, maxTokens: 2_000 })).toBeGreaterThan(
      estimateWorstCaseUsd(base),
    );
    expect(estimateWorstCaseUsd({ ...base, model: "powerful" })).toBeGreaterThan(
      estimateWorstCaseUsd(base),
    );
  });
});
