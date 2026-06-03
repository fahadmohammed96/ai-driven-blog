import { estimateWorstCaseUsd, type WorstCaseDef } from "./model-registry";
import type { MeteringService } from "./metering";

/**
 * Two-level budget circuit-breaker (Slice R1-B). Called BEFORE every (sub-)run,
 * it re-reads the tenant's monthly spend from the DB so an Orchestrator firing N
 * sub-agents can never spend N × the per-tenant cap (agentic-plan §"Controlli di
 * costo", critica #2/#10):
 *
 *   L2 — hard cap (the invariant that matters): monthly spend ≥ cap → refuse.
 *   L1 — pre-job estimate: worst-case of THIS run would exceed the remaining
 *        headroom (cap − spent) → refuse before entering the loop.
 *
 * Evaluation order is L2 then L1 by design: an already-breached cap is the
 * stronger, run-independent reason to stop, so it's attributed to L2; only when
 * still under the cap does the prudent per-run estimate (L1) gate entry. This
 * also keeps the two levels independently testable — `spent ≥ cap` reports L2,
 * `spent < cap` with an oversized worst-case reports L1.
 */

export type BudgetLevel = "L1" | "L2";

export interface BudgetExceededDetail {
  tenantId: string;
  level: BudgetLevel;
  capUsd: number;
  spentUsd: number;
  /** Present only for L1 (the pre-job worst-case that overflowed the headroom). */
  worstCaseUsd?: number;
}

export class BudgetExceededError extends Error {
  readonly level: BudgetLevel;
  readonly detail: BudgetExceededDetail;
  constructor(detail: BudgetExceededDetail) {
    super(
      `AI budget exceeded (${detail.level}) for tenant ${detail.tenantId}: ` +
        `spent $${detail.spentUsd.toFixed(4)} / cap $${detail.capUsd.toFixed(4)}` +
        (detail.worstCaseUsd !== undefined
          ? ` (worst-case $${detail.worstCaseUsd.toFixed(4)})`
          : ""),
    );
    this.name = "BudgetExceededError";
    this.level = detail.level;
    this.detail = detail;
  }
}

export interface BudgetGuard {
  /** Throws {@link BudgetExceededError} if this run must not start. */
  check(tenantId: string, def: WorstCaseDef): Promise<void>;
}

export interface BudgetGuardDeps {
  metering: Pick<MeteringService, "monthlySpendUsd">;
  /** Per-tenant monthly cap in USD (from `TenantSettings.budgetUsdMonthly`). */
  resolveBudgetUsd: (tenantId: string) => Promise<number>;
}

export class TwoLevelBudgetGuard implements BudgetGuard {
  constructor(private readonly deps: BudgetGuardDeps) {}

  async check(tenantId: string, def: WorstCaseDef): Promise<void> {
    const capUsd = await this.deps.resolveBudgetUsd(tenantId);
    // Re-read from the DB every call — NOT an in-memory counter (critica #2/#10).
    const spentUsd = await this.deps.metering.monthlySpendUsd(tenantId);

    // L2: hard cap already reached.
    if (spentUsd >= capUsd) {
      throw new BudgetExceededError({ tenantId, level: "L2", capUsd, spentUsd });
    }

    // L1: would this run's worst case overflow the remaining headroom?
    const worstCaseUsd = estimateWorstCaseUsd(def);
    if (worstCaseUsd > capUsd - spentUsd) {
      throw new BudgetExceededError({
        tenantId,
        level: "L1",
        capUsd,
        spentUsd,
        worstCaseUsd,
      });
    }
  }
}
