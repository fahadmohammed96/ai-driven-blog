import { describe, it, expect } from "vitest";
import {
  TwoLevelBudgetGuard,
  BudgetExceededError,
  type BudgetGuardDeps,
} from "./budget-guard";
import { estimateWorstCaseUsd, type WorstCaseDef } from "./model-registry";

const DEF: WorstCaseDef = { model: "balanced", maxSteps: 4, maxTokens: 8_000 };

function guard(over: Partial<BudgetGuardDeps> & { spent: number; cap: number }) {
  const deps: BudgetGuardDeps = {
    metering: { monthlySpendUsd: async () => over.spent },
    resolveBudgetUsd: async () => over.cap,
  };
  return new TwoLevelBudgetGuard(deps);
}

describe("TwoLevelBudgetGuard.check", () => {
  it("passes when spend is low and the worst-case fits the headroom", async () => {
    const cap = estimateWorstCaseUsd(DEF) * 10;
    await expect(guard({ spent: 0, cap }).check("t1", DEF)).resolves.toBeUndefined();
  });

  it("L1: refuses when this run's worst-case would overflow the remaining headroom", async () => {
    // Still UNDER the cap (so L2 does not trip), but only a sliver of headroom
    // left — smaller than the run's worst-case estimate.
    const worst = estimateWorstCaseUsd(DEF);
    const cap = 100;
    const spent = cap - worst / 2; // headroom = worst/2 < worst -> L1 trips
    const err = await guard({ spent, cap })
      .check("t1", DEF)
      .catch((e) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect((err as BudgetExceededError).level).toBe("L1");
    expect((err as BudgetExceededError).detail.worstCaseUsd).toBeCloseTo(worst, 10);
  });

  it("L2: refuses when monthly spend has already reached the cap", async () => {
    const err = await guard({ spent: 50, cap: 50 })
      .check("t1", DEF)
      .catch((e) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect((err as BudgetExceededError).level).toBe("L2");
  });

  it("L2 takes precedence when the cap is already blown (over budget)", async () => {
    const err = await guard({ spent: 80, cap: 50 })
      .check("t1", DEF)
      .catch((e) => e);
    expect((err as BudgetExceededError).level).toBe("L2");
  });
});
