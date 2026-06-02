import { desc, eq, sql } from "drizzle-orm";
import type { Block, ChannelPostMap, EmailDraft, Proposal, SeoProposal } from "@blogs/contracts";
import type { Db } from "../../platform/db/client";
import { withTenant, type Tx } from "../../platform/db/tenant";
import { agentProposals, aiAgentRuns } from "../../platform/db/schema";
import type { ToolCall } from "../../platform/ai/tools";
// Cross-module via the public barrel only (arch boundary): the social channel
// posts repo is the gate sink for `social_captions` proposals.
import { insertChannelPosts } from "../social";
import {
  annotateSeoProposal,
  getContentItem,
  insertContentItem,
  transitionContentItem,
  ContentNotFoundError,
  type ContentItemRow,
} from "./content.repo";

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

export class EmailSinkNotConfiguredError extends Error {
  constructor() {
    super("approving an 'email_draft' requires an EmailDraftSink (wired by the email module)");
    this.name = "EmailSinkNotConfiguredError";
  }
}

/**
 * The gate sink for `email_draft` proposals (Slice S3): on approval the draft is
 * sent to its theme's confirmed-opt-in segment. The IMPLEMENTATION lives in
 * `modules/email` (it reuses `sendNewsletterToSegment` + the `EmailPort`); it is
 * INJECTED here so `modules/content` does NOT import `modules/email` — avoiding
 * the barrel cycle the S2 review flagged for social (DEBT-031c). The interface is
 * owned by the store (the seam); the email module supplies the function.
 */
export interface EmailDraftSink {
  /** Send the approved draft to the theme's segment; returns who it went to. */
  send(tenantId: string, draft: EmailDraft): Promise<{ recipients: string[] }>;
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
  /**
   * Whether the producing run was audited: true iff an `ai_agent_runs` row exists
   * for `runId`. The runner writes that row BEST-EFFORT, so a proposal can land
   * with `auditRecorded=false` (audit write degraded). The gate uses this with
   * `TenantSettings.auditPolicy` to decide whether to surface the proposal.
   */
  auditRecorded: boolean;
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
  private readonly emailSink?: EmailDraftSink;

  constructor(
    private readonly db: Db,
    opts: { emailSink?: EmailDraftSink } = {},
  ) {
    this.emailSink = opts.emailSink;
  }

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
          // Non-null only when the best-effort audit row exists → auditRecorded.
          // TODO(debt): DEBT-026 — derived at query-time from the LEFT JOIN, not a
          // persisted column; interacts with ai_agent_runs retention (DEBT-021).
          runRowId: aiAgentRuns.id,
        })
        .from(agentProposals)
        .leftJoin(aiAgentRuns, eq(aiAgentRuns.id, agentProposals.runId))
        .where(eq(agentProposals.status, "pending"))
        .orderBy(desc(agentProposals.createdAt));
      return rows.map((r) =>
        toStaged(r.p, r.toolCalls as ToolCall[] | null, r.runRowId !== null),
      );
    });
  }

  async approve(tenantId: string, id: string): Promise<ContentItemRow> {
    return withTenant(this.db, tenantId, async (tx) => {
      const row = await selectPending(tx, id);
      // Route by proposal type to the right human-gate sink (agent→gate map). The
      // gate is always a CONSUMER of the staging table, never bypassed.
      const result =
        row.type === "seo_suggestions"
          ? await approveSeoSuggestions(tx, row)
          : row.type === "social_captions"
            ? await approveSocialCaptions(tx, tenantId, row)
            : row.type === "email_draft"
              ? await approveEmailDraft(tx, tenantId, row, this.emailSink)
              : await approveContentDraft(tx, tenantId, row);
      await tx
        .update(agentProposals)
        .set({ status: "approved", reviewedAt: sql`now()` })
        .where(eq(agentProposals.id, id));
      return result;
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

/**
 * `content_draft` gate (Writer): inject the payload into the EXISTING Phase-1
 * publication state machine — a new draft content item, then draft → review (the
 * gate is the consumer, critica #6).
 */
async function approveContentDraft(
  tx: Tx,
  tenantId: string,
  row: typeof agentProposals.$inferSelect,
): Promise<ContentItemRow> {
  const payload = row.payload as ContentDraftPayload;
  const created = await insertContentItem(tx, {
    tenantId,
    type: "article",
    title: deriveTitle(payload),
    blocks: draftToBlocks(payload),
  });
  const reviewed = await transitionContentItem(tx, created.id, "propose");
  return transitionContentItem(tx, reviewed.id, "startReview");
}

/**
 * `seo_suggestions` gate (SEO Agent, Slice S1): NON-BLOCKING — annotate the
 * target content item's `seo_proposal` field. It does NOT mint a new item nor
 * touch the publication state; the SEO enriches the existing item. The target id
 * rides in the payload (`SeoProposal.contentItemId`).
 */
async function approveSeoSuggestions(
  tx: Tx,
  row: typeof agentProposals.$inferSelect,
): Promise<ContentItemRow> {
  const seo = row.payload as SeoProposal;
  return annotateSeoProposal(tx, seo.contentItemId, seo);
}

/**
 * `social_captions` gate (Social Agent, Slice S2): insert the proposed posts as
 * `channel_posts` at status `draft` — the EXISTING Phase-2.5 per-post approval
 * gate (`setPostApproval`) stays the final gate before anything goes out. This
 * does NOT publish and does NOT touch the publication state machine; it returns
 * the source content item (status unchanged) so the gate response shape matches
 * the other types. The subject id rides in the payload (`ChannelPostMap.contentItemId`).
 */
async function approveSocialCaptions(
  tx: Tx,
  tenantId: string,
  row: typeof agentProposals.$inferSelect,
): Promise<ContentItemRow> {
  const map = row.payload as ChannelPostMap;
  await insertChannelPosts(tx, tenantId, map.contentItemId, map.posts);
  const item = await getContentItem(tx, map.contentItemId);
  if (!item) throw new ContentNotFoundError(map.contentItemId);
  return item;
}

/**
 * `email_draft` gate (Email Agent, Slice S3): the approval IS the send gate. The
 * approved draft is sent to its theme's confirmed-opt-in segment via the INJECTED
 * `EmailDraftSink` (reuses `sendNewsletterToSegment` in `modules/email`); nothing
 * was sent before this human approval (the propose-only invariant).
 *
 * IDEMPOTENT for re-approval, sequential AND concurrent: the outer `approve` only
 * reaches this for a still-`pending` row, and `selectPending` now takes a
 * `FOR UPDATE` lock, so a concurrent approve waits and then sees the row already
 * `approved` and throws — the send runs exactly once. The subject article is
 * validated BEFORE the (irreversible) send, so a missing item throws without
 * having emailed the segment. The article (status unchanged) is returned so the
 * gate response shape matches the other types; theme + contentItemId ride in the
 * payload (`EmailDraft`).
 *
 * TODO(debt): DEBT-033 — the send still happens INSIDE the approve transaction:
 * if the status UPDATE fails after the send, the rollback cannot recall the email
 * and a retry re-sends. The real fix is a post-commit send (commit `approved`
 * first, then send — the `commerce.payDeposit` pattern); out of scope here.
 */
async function approveEmailDraft(
  tx: Tx,
  tenantId: string,
  row: typeof agentProposals.$inferSelect,
  sink: EmailDraftSink | undefined,
): Promise<ContentItemRow> {
  if (!sink) throw new EmailSinkNotConfiguredError();
  const draft = row.payload as EmailDraft;
  // Validate the subject article BEFORE the irreversible send (S3 review #2).
  const item = await getContentItem(tx, draft.contentItemId);
  if (!item) throw new ContentNotFoundError(draft.contentItemId);
  await sink.send(tenantId, draft);
  return item;
}

/**
 * Read a proposal that must exist and still be pending — the idempotent gate.
 * `FOR UPDATE` locks the row so concurrent approve/reject of the SAME proposal
 * serialize: the second waiter re-reads the committed row, sees it is no longer
 * `pending`, and throws (`ProposalNotPendingError`). This keeps a side-effectful
 * approve — e.g. an `email_draft` send — from running twice under concurrency.
 * Requires an open transaction (always true: callers run inside `withTenant`).
 */
async function selectPending(
  tx: Tx,
  id: string,
): Promise<typeof agentProposals.$inferSelect> {
  const rows = await tx
    .select()
    .from(agentProposals)
    .where(eq(agentProposals.id, id))
    .for("update");
  const row = rows[0];
  if (!row) throw new ProposalNotFoundError(id);
  if (row.status !== "pending") throw new ProposalNotPendingError(id, row.status);
  return row;
}

function toStaged(
  row: typeof agentProposals.$inferSelect,
  toolCalls: ToolCall[] | null,
  auditRecorded: boolean,
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
    auditRecorded,
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
