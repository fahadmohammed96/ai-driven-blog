import { and, eq } from "drizzle-orm";
import type { ProposalTokens } from "@blogs/contracts";
import type { Db } from "../db/client";
import { withTenant } from "../db/tenant";
import { aiAgentRuns } from "../db/schema";
import type { ToolCall } from "./tools";

/**
 * Persistence seam for `ai_agent_runs` (Slice A1-core). Two operations:
 *   - `findByTaskId` — the idempotency check the runner does BEFORE any LLM call.
 *   - `record` — the best-effort audit write AFTER the loop. It MAY throw; the
 *     runner catches it, marks `auditRecorded=false`, logs, and still returns
 *     the proposal.
 *
 * `usage_json` carries the {@link RunEnvelope}: the run-result snapshot that lets
 * an idempotent replay reconstruct the exact `Proposal` without re-running the
 * model (the full `agent_proposals` staging table arrives in T1).
 */

/** The run-result snapshot persisted in `ai_agent_runs.usage_json`. */
export interface RunEnvelope {
  /** 'completed' (clean finish) or 'pending' (a truncated, partial run). */
  status: "completed" | "pending";
  payload: unknown;
  rationale: string;
  estimatedCostUsd: number;
  tokensUsed: ProposalTokens;
  truncated: boolean;
}

export interface AgentRunRecord {
  id: string;
  tenantId: string;
  agentName: string;
  taskId: string;
  steps: number;
  toolCalls: ToolCall[];
  envelope: RunEnvelope;
  agentDefinitionVersion: string;
  createdAt: Date;
}

export interface AgentRunWrite {
  id: string;
  tenantId: string;
  agentName: string;
  taskId: string;
  steps: number;
  toolCalls: ToolCall[];
  envelope: RunEnvelope;
  agentDefinitionVersion: string;
}

export interface AgentRunStore {
  findByTaskId(tenantId: string, taskId: string): Promise<AgentRunRecord | null>;
  /** Persist the run audit row. Throws on failure (runner degrades gracefully). */
  record(write: AgentRunWrite): Promise<void>;
}

/** Postgres-backed store. Reads/writes under the tenant's RLS scope (app_rw). */
export class PostgresAgentRunStore implements AgentRunStore {
  constructor(private readonly db: Db) {}

  async findByTaskId(tenantId: string, taskId: string): Promise<AgentRunRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(aiAgentRuns)
        .where(and(eq(aiAgentRuns.tenantId, tenantId), eq(aiAgentRuns.taskId, taskId)))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        tenantId: row.tenantId,
        agentName: row.agentName,
        taskId: row.taskId,
        steps: row.steps,
        toolCalls: row.toolCallsJson as ToolCall[],
        envelope: row.usageJson as RunEnvelope,
        agentDefinitionVersion: row.agentDefinitionVersion,
        createdAt: row.createdAt,
      };
    });
  }

  async record(write: AgentRunWrite): Promise<void> {
    await withTenant(this.db, write.tenantId, (tx) =>
      tx.insert(aiAgentRuns).values({
        id: write.id,
        tenantId: write.tenantId,
        agentName: write.agentName,
        taskId: write.taskId,
        steps: write.steps,
        toolCallsJson: write.toolCalls,
        usageJson: write.envelope,
        agentDefinitionVersion: write.agentDefinitionVersion,
      }),
    );
  }
}
