import { desc, eq, sql } from "drizzle-orm";
import type { Block, Proposal } from "@blogs/contracts";
import type { Db } from "../../platform/db/client";
import { withTenant, type Tx } from "../../platform/db/tenant";
import { agentProposals, aiAgentRuns } from "../../platform/db/schema";
import type { ToolCall } from "../../platform/ai/tools";
import { insertContentItem, transitionContentItem, type ContentItemRow } from "./content.repo";

/**
 * `agent_proposals` staging store (Slice T1) — the human gate's consumer side of
 * the agentic pipeline. An agent run lands its `Proposal<T>` here (`pending`);
 * the founder reviews it on the "Code proposte" surface; on approve the payload
 * is injected into the EXISTING Phase-1 publication state machine (a fresh
 * `content_items` draft → review) and the row is marked `approved` — the gate is
 * a CONSUMER of the staging table, never bypassed (resolves the DEBT-022 sink).
 *
 * All reads/writes run under the tenant's RLS scope (app_rw). `run_id` is joined
 * back to `ai_agent_runs.tool_calls_json` so the UI can show the agent's
 * reasoning (the ReAct tool trace) next to its cost.
 */

export class ProposalNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`agent proposal not found: ${id}`);
    this.name = "ProposalNotFoundError";
  }
}

export class ProposalNotPendingError extends Error {
  constructor(public readonly id: string, public readonly status: string) {
    super(`agent proposal ${id} is '${status}', not pending`);
    this.name = "ProposalNotPendingError";
  }
}

/** A staged proposal row enriched with its run's reasoning (tool-call trace). */
export interface StagedProposal {
  id: string;
  tenantId: string;
  agentName: string;
  runId: string;
  type: string;
  payload: unknown;
  rationale: string;
  estimatedCostUsd: number;
  tokensUsed: { input: number; output: number; cached: number };
  status: string;
  agentDefinitionVersion: string;
  researchContext: unknown | null;
  createdAt: Date;
  reviewedAt: Date | null;
  /** The producing run's ReAct tool trace (the agent's "reasoning"), if audited. */
  toolCalls: ToolCall[];
}

/** The Writer's `content_draft` payload, plus an optional caller-supplied title. */
interface ContentDraftPayload {
  draft: string;
  title?: string;
}

export interface AgentProposalStore {
  persist(proposal: Proposal): Promise<void>;
  listPending(tenantId: string): Promise<StagedProposal[]>;
  /** Inject the approved payload into the Phase-1 state machine; mark approved. */
  approve(tenantId: string, id: string): Promise<ContentItemRow>;
  reject(tenantId: string, id: string): Promise<void>;
}

export class PostgresAgentProposalStore implements AgentProposalStore {
  constructor(private readonly db: Db) {}

  async persist(proposal: Proposal): Promise<void> {
    await withTenant(this.db, proposal.tenantId, (tx) =>
      tx
        .insert(agentProposals)
        .values({
          id: proposal.id,
          tenantId: proposal.tenantId,
          agentName: proposal.agentId,
          runId: proposal.runId,
          type: proposal.type,
          payload: proposal.payload,
          rationale: proposal.rationale,
          // numeric column: fixed-precision string to avoid float drift.
          estimatedCostUsd: proposal.estimatedCostUsd.toFixed(6),
          tokensUsed: proposal.tokensUsed,
          status: proposal.status,
          agentDefinitionVersion: proposal.agentDefinitionVersion,
          ...(proposal.researchContext !== undefined
            ? { researchContext: proposal.researchContext }
            : {}),
        })
        // A retried/idempotent run can replay the same proposal id — staging it
        // twice is a no-op, not a PK violation.
        .onConflictDoNothing({ target: agentProposals.id }),
    );
  }

  async listPending(tenantId: string): Promise<StagedProposal[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      // LEFT JOIN the run audit so the UI gets the reasoning in one round-trip;
      // best-effort audit means a run row may be absent → empty tool trace.
      const rows = await tx
        .select({
          p: agentProposals,
          toolCalls: aiAgentRuns.toolCallsJson,
        })
        .from(agentProposals)
        .leftJoin(aiAgentRuns, eq(aiAgentRuns.id, agentProposals.runId))
        .where(eq(agentProposals.status, "pending"))
        .orderBy(desc(agentProposals.createdAt));
      return rows.map((r) => toStaged(r.p, r.toolCalls as ToolCall[] | null));
    });
  }

  async approve(tenantId: string, id: string): Promise<ContentItemRow> {
    return withTenant(this.db, tenantId, async (tx) => {
      const row = await selectPending(tx, id);
      const payload = row.payload as ContentDraftPayload;
      // Inject the proposal into the EXISTING Phase-1 state machine: a new draft
      // content item, then draft → review (the gate is the consumer, critica #6).
      const created = await insertContentItem(tx, {
        tenantId,
        type: "article",
        title: deriveTitle(payload),
        blocks: draftToBlocks(payload),
      });
      const reviewed = await transitionContentItem(tx, created.id, "propose");
      const inReview = await transitionContentItem(tx, reviewed.id, "startReview");
      await tx
        .update(agentProposals)
        .set({ status: "approved", reviewedAt: sql`now()` })
        .where(eq(agentProposals.id, id));
      return inReview;
    });
  }

  async reject(tenantId: string, id: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await selectPending(tx, id);
      await tx
        .update(agentProposals)
        .set({ status: "rejected", reviewedAt: sql`now()` })
        .where(eq(agentProposals.id, id));
    });
  }
}

/** Read a proposal that must exist and still be pending (idempotent gate). */
async function selectPending(
  tx: Tx,
  id: string,
): Promise<typeof agentProposals.$inferSelect> {
  const rows = await tx
    .select()
    .from(agentProposals)
    .where(eq(agentProposals.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) throw new ProposalNotFoundError(id);
  if (row.status !== "pending") throw new ProposalNotPendingError(id, row.status);
  return row;
}

function toStaged(
  row: typeof agentProposals.$inferSelect,
  toolCalls: ToolCall[] | null,
): StagedProposal {
  return {
    id: row.id,
    tenantId: row.tenantId,
    agentName: row.agentName,
    runId: row.runId,
    type: row.type,
    payload: row.payload,
    rationale: row.rationale,
    estimatedCostUsd: Number(row.estimatedCostUsd),
    tokensUsed: row.tokensUsed as StagedProposal["tokensUsed"],
    status: row.status,
    agentDefinitionVersion: row.agentDefinitionVersion,
    researchContext: row.researchContext ?? null,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
    toolCalls: toolCalls ?? [],
  };
}

/** A content_draft's title: explicit if supplied, else the draft's first line. */
function deriveTitle(payload: ContentDraftPayload): string {
  if (payload.title && payload.title.trim()) return payload.title.trim();
  const firstLine = payload.draft.split("\n").map((l) => l.trim()).find(Boolean);
  return firstLine ? firstLine.slice(0, 120) : "Bozza AI";
}

/** Project the generated draft text into canonical paragraph blocks (ADR-0004). */
function draftToBlocks(payload: ContentDraftPayload): Block[] {
  const paragraphs = payload.draft
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const body = paragraphs.length ? paragraphs : [payload.draft.trim() || "(vuoto)"];
  return body.map((text) => ({ type: "paragraph", text }));
}
