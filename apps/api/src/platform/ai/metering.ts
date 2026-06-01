import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { withTenant } from "../db/tenant";
import { aiUsageEvents } from "../db/schema";
import { pricePerToken, type ModelTier } from "./model-registry";

/**
 * Metering (Slice R1-B) — every LLM round-trip is recorded as one
 * `ai_usage_events` row, and the per-tenant monthly spend is the running
 * `SUM(cost_usd)` re-read from that table. This is the ground truth the
 * circuit-breaker (`budget-guard.ts`) checks BEFORE every (sub-)run, so an
 * Orchestrator can never out-spend the cap by racing in-memory counters.
 */

/** Token usage as reported by `LlmResponse.usage`. */
export interface UsageTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface MeteringRecordInput {
  tenantId: string;
  /** Joins toward `ai_agent_runs` (A1-core); null for single-shot calls. */
  runId?: string | null;
  agentName: string;
  model: ModelTier;
  usage: UsageTokens;
}

export interface MeteringService {
  /** Persist one usage event SYNCHRONOUSLY (spend is on the DB before we return). */
  record(input: MeteringRecordInput): Promise<void>;
  /** Sum of `cost_usd` for the tenant in the current calendar month (USD). */
  monthlySpendUsd(tenantId: string): Promise<number>;
}

/**
 * Pure cost of a single call in USD: input + output + cache-read tokens each
 * priced by their tier rate. Cache reads are billed at the cheap cache rate, so
 * they're folded into the dollar amount even though only input/output token
 * COUNTS are persisted on the row. Deterministic — unit-testable without a DB.
 */
export function computeCostUsd(model: ModelTier, usage: UsageTokens): number {
  const p = pricePerToken(model);
  return (
    usage.inputTokens * p.input +
    usage.outputTokens * p.output +
    usage.cacheReadTokens * p.cacheRead
  );
}

/** Postgres-backed metering. Writes/reads under the tenant's RLS scope (app_rw). */
export class PostgresMeteringService implements MeteringService {
  constructor(private readonly db: Db) {}

  async record(input: MeteringRecordInput): Promise<void> {
    const costUsd = computeCostUsd(input.model, input.usage);
    await withTenant(this.db, input.tenantId, (tx) =>
      tx.insert(aiUsageEvents).values({
        tenantId: input.tenantId,
        runId: input.runId ?? null,
        agentName: input.agentName,
        model: input.model,
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        // numeric column: pass a fixed-precision string to avoid float drift.
        costUsd: costUsd.toFixed(6),
      }),
    );
  }

  async monthlySpendUsd(tenantId: string): Promise<number> {
    return withTenant(this.db, tenantId, async (tx) => {
      // RLS already scopes to the tenant; we only bound to the current month.
      // SUM over numeric comes back as a string from the driver -> Number().
      const rows = await tx.execute<{ spent: string }>(
        sql`select coalesce(sum(${aiUsageEvents.costUsd}), 0)::text as spent
            from ${aiUsageEvents}
            where ${aiUsageEvents.createdAt} >= date_trunc('month', now())`,
      );
      return Number(rows.rows[0]?.spent ?? 0);
    });
  }
}
