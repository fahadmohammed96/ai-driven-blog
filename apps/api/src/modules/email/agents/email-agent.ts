import { createHash, randomUUID } from "node:crypto";
import type { Block, EmailDraft, Proposal, Theme } from "@blogs/contracts";
import { emailDraftSchema } from "@blogs/contracts";
import {
  AgentRunner,
  type AgentInput,
  type RunContext,
  type RunLogger,
} from "../../../platform/ai/agent-runner";
import type { AgentDefinition } from "../../../platform/ai/agent-registry";
import { hashAgentDefinition } from "../../../platform/ai/agent-registry";
import { ToolRegistry } from "../../../platform/ai/tool-registry";
import type { LlmPort } from "../../../platform/ai/llm";
import type { ProviderRegistry } from "../../../platform/ai/provider-registry";
import type { SchemaLike, ToolDefinition } from "../../../platform/ai/tools";
import type { BudgetGuard } from "../../../platform/ai/budget-guard";
import type { AgentRunStore, RunEnvelope } from "../../../platform/ai/agent-run-store";
import {
  createProjectToNewsletterTool,
  projectToNewsletter,
  type NewsletterSource,
  PROJECT_TO_NEWSLETTER_TOOL_ID,
} from "./tools/project-to-newsletter";
import {
  createGetBrandVoiceTool,
  GET_BRAND_VOICE_TOOL_ID,
  type BrandVoiceAccessor,
  type BrandVoiceView,
} from "./tools/get-brand-voice";
import {
  createGetSegmentProfileTool,
  GET_SEGMENT_PROFILE_TOOL_ID,
  STUB_SEGMENT_PROFILE,
  type SegmentProfileAccessor,
} from "./tools/get-segment-profile";
import {
  createGetEmailHistoryTool,
  GET_EMAIL_HISTORY_TOOL_ID,
  STUB_EMAIL_HISTORY,
  type EmailHistoryAccessor,
} from "./tools/get-email-history";

/**
 * EmailAgent (agentic-plan Slice S3) — pairs the DETERMINISTIC newsletter
 * projector with an OPTIONAL LLM refinement of the high-impact subject/preheader,
 * the biforcation made structural IN CODE (cost control §5, critica #4), exactly
 * like the SocialAgent (S2):
 *
 *   (A) deterministic — project the article into an {@link EmailDraft}, compute a
 *       pure {@link brandVoiceScore} (draft ↔ brand-voice keyword overlap). If it
 *       clears the threshold the agent emits the proposal WITHOUT EVER TOUCHING
 *       `LlmPort` — "no LLM when the projector is good enough" is a GUARANTEE.
 *   (B) LLM — only when the score is below threshold: a single AgentRunner run
 *       (tier `balanced`) refines `subject` + `preheader`; the `body` stays the
 *       deterministic article projection, then the two are merged.
 *
 * Either way it emits a propose-only `Proposal<EmailDraft>` (type `email_draft`)
 * that lands in `agent_proposals` staging and, on approval, is sent to the
 * theme's confirmed-opt-in segment through the EXISTING Phase-2.5 distribution
 * gate (`AgentProposalStore.approve`). The agent NEVER sends.
 */

/**
 * Below this draft↔brand-voice overlap the run escalates to the LLM layer.
 * A DEFAULT CONSTANT (not a `TenantSettings` field) on purpose — mirrors S2's
 * `DEFAULT_BRAND_VOICE_THRESHOLD`.
 * TODO(debt): DEBT-032 — make it per-tenant configurable when a tenant asks for
 * a different brand-voice sensitivity (would touch the settings deep-equals).
 */
export const DEFAULT_EMAIL_BRAND_VOICE_THRESHOLD = 0.5;

/** Data accessors injected at the boundary (the caller reads under tenant RLS). */
export interface EmailAccessors {
  brandVoice: BrandVoiceAccessor;
  /** Confirmed-segment size per theme; optional (the tool is context for the LLM). */
  segmentProfile?: SegmentProfileAccessor;
  /** Past newsletter exemplars; defaults to the DEBT-032 stub. */
  emailHistory?: EmailHistoryAccessor;
}

export interface EmailAgentDeps {
  /** Exactly one of `llm` (fixed port) / `provider` (per-tenant BYOK, R1-C). */
  llm?: LlmPort;
  provider?: ProviderRegistry;
  accessors: EmailAccessors;
  store?: AgentRunStore;
  budget?: BudgetGuard;
  logger?: RunLogger;
}

export interface EmailRunInput {
  contentItemId: string;
  /** The source article (canonical block model) the newsletter is projected from. */
  article: { title: string; blocks: Block[]; link?: string };
  /** The theme whose segment will receive the newsletter on approval. */
  theme: Theme;
  /** Override the brand-voice escalation threshold (tests); default constant. */
  threshold?: number;
}

/** No-op store: a stand-alone run persists no audit row (caller wires the real one). */
const NOOP_RUN_STORE: AgentRunStore = {
  findByTaskId: async () => null,
  record: async () => {},
};
/** Always-ok budget for contexts with no DB to meter against (unit tests). */
const OK_BUDGET: BudgetGuard = { check: async () => {} };

const EMAIL_SYSTEM_PROMPT =
  "Sei lo specialista email. Ti vengono dati il subject e il preheader di una " +
  "newsletter già impaginata. Riscrivili per massimizzare l'apertura, restando nel " +
  "brand voice del tenant e SENZA toccare il corpo. Rispondi SOLO con un oggetto " +
  'JSON {"subject": string, "preheader": string}. Niente altro testo.';

/** The tools the LLM path may call (shared with the version hash so it's accurate). */
const ALLOWED_TOOLS = [
  PROJECT_TO_NEWSLETTER_TOOL_ID,
  GET_BRAND_VOICE_TOOL_ID,
  GET_SEGMENT_PROFILE_TOOL_ID,
  GET_EMAIL_HISTORY_TOOL_ID,
];

/** Stable base shared by the def (model/tools/output set per run). */
const EMAIL_DEF_BASE = {
  id: "email",
  role: "Specialista email: trasforma l'articolo in bozza newsletter per segmento",
  systemPrompt: EMAIL_SYSTEM_PROMPT,
  model: "balanced",
  maxSteps: 2,
  maxTokens: 3_000,
  maxContextTokens: 12_000,
  budgetCap: { inputTokens: 12_000, outputTokens: 3_000 },
  autonomyAxis: "email",
  proposalType: "email_draft",
} satisfies Partial<AgentDefinition<EmailDraft>>;

/** A `SchemaLike` backed by the contract's zod schema (the runner uses parse/safeParse). */
function emailDraftSchemaLike(): SchemaLike<EmailDraft> {
  return {
    safeParse: (input) => {
      const r = emailDraftSchema.safeParse(input);
      return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
    },
    parse: (input) => emailDraftSchema.parse(input),
  };
}

const EMAIL_VERSION = hashAgentDefinition({
  ...EMAIL_DEF_BASE,
  model: "balanced",
  allowedTools: ALLOWED_TOOLS,
  outputSchema: emailDraftSchemaLike() as SchemaLike<unknown>,
} as AgentDefinition);

// ── brand-voice score (deterministic, pure — exported for unit tests) ─────────

const SCORE_STOPWORDS = new Set([
  "una", "uno", "del", "della", "delle", "dei", "degli", "gli", "che", "con",
  "per", "tra", "fra", "the", "and", "with", "from", "your", "this", "that",
  "nel", "nella", "alla", "allo", "sono", "come", "più", "meno",
]);

/** Significant lowercase words (len ≥ 4, no stopwords), de-duplicated. */
function keywords(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const w = raw.trim();
    if (w.length < 4 || SCORE_STOPWORDS.has(w)) continue;
    seen.add(w);
  }
  return [...seen];
}

/** The plain text a draft contributes to the brand-voice overlap corpus (HTML stripped). */
export function draftText(draft: EmailDraft): string {
  const bodyText = draft.body.replace(/<[^>]+>/g, " ");
  return `${draft.subject} ${draft.preheader} ${bodyText}`;
}

/**
 * Deterministic brand-voice fit in [0, 1]: the fraction of the brand voice's
 * keywords (tone + audience) that already appear in the projected draft. Pure —
 * same input → same score. An EMPTY brand voice has nothing to satisfy, so it
 * scores 1 (the deterministic path is taken; no LLM is spent shaping a voice
 * that was never configured). Mirrors S2's `brandVoiceScore`.
 */
export function brandVoiceScore(draft: EmailDraft, brandVoice: BrandVoiceView): number {
  const brandKeywords = keywords(`${brandVoice.tone} ${brandVoice.audience}`);
  if (brandKeywords.length === 0) return 1;
  const corpus = new Set(keywords(draftText(draft)));
  const matched = brandKeywords.filter((k) => corpus.has(k)).length;
  return matched / brandKeywords.length;
}

// ── LLM subject/preheader merge (deterministic fallback on bad/empty JSON) ─────

function parseSubjectPreheader(content: string): { subject?: string; preheader?: string } {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      return {
        ...(typeof o.subject === "string" ? { subject: o.subject } : {}),
        ...(typeof o.preheader === "string" ? { preheader: o.preheader } : {}),
      };
    }
  } catch {
    // Not JSON (e.g. the offline stub returns prose) → pure deterministic fallback.
  }
  return {};
}

const SUBJECT_MAX = 200;
const PREHEADER_MAX = 200;

/**
 * Overlay the LLM's subject/preheader onto the deterministic draft, within the
 * field limits, then re-validate. The BODY/cta/contentItemId/theme are never
 * touched. Any field the LLM omits (or the whole thing, for a prose stub) falls
 * back to the projection; if the merged draft fails schema validation the
 * projected draft is returned unchanged — the LLM can only improve copy, never
 * break the contract or the body.
 */
export function mergeSubjectPreheader(projected: EmailDraft, content: string): EmailDraft {
  const copy = parseSubjectPreheader(content);
  const candidate: EmailDraft = {
    ...projected,
    subject: copy.subject?.trim() ? copy.subject.trim().slice(0, SUBJECT_MAX) : projected.subject,
    preheader: copy.preheader?.trim()
      ? copy.preheader.trim().slice(0, PREHEADER_MAX)
      : projected.preheader,
  };
  const parsed = emailDraftSchema.safeParse(candidate);
  return parsed.success ? parsed.data : projected;
}

/** The user message for the refinement: the projected subject/preheader + voice. */
function buildBrief(draft: EmailDraft, brandVoice: BrandVoiceView): string {
  return JSON.stringify({
    theme: draft.theme,
    brandVoice,
    current: { subject: draft.subject, preheader: draft.preheader },
  });
}

/**
 * Deterministic idempotency key (mirrors the runner's recipe). The THEME is part
 * of task identity — a same-day re-suggest for a DIFFERENT theme is NOT a replay
 * (checklist S1/S2). Matches `deriveTaskId(agentId, subjectId, day)` with
 * `subjectId = contentItemId:theme`.
 */
function deriveTaskId(contentItemId: string, theme: Theme, triggeredAt: Date): string {
  const day = triggeredAt.toISOString().slice(0, 10);
  return createHash("sha256")
    .update(`email|${contentItemId}:${theme}|${day}`)
    .digest("hex")
    .slice(0, 32);
}

export class EmailAgent {
  private readonly accessors: EmailAccessors;
  private readonly resolveLlm: (tenantId: string) => Promise<LlmPort>;
  private readonly emailHistory: EmailHistoryAccessor;
  private readonly segmentProfile: SegmentProfileAccessor;
  private readonly runnerDeps: { store: AgentRunStore; budget: BudgetGuard; logger?: RunLogger };
  private readonly logger: RunLogger;

  constructor(deps: EmailAgentDeps) {
    if (!deps.llm === !deps.provider) {
      throw new Error("EmailAgent requires exactly one of { llm, provider }");
    }
    this.accessors = deps.accessors;
    this.resolveLlm = deps.provider
      ? (tenantId) => deps.provider!.getClient(tenantId)
      : async () => deps.llm!;
    this.emailHistory = deps.accessors.emailHistory ?? STUB_EMAIL_HISTORY;
    this.segmentProfile = deps.accessors.segmentProfile ?? STUB_SEGMENT_PROFILE;
    this.logger = deps.logger ?? { error: (m, meta) => console.error(m, meta) };
    this.runnerDeps = {
      store: deps.store ?? NOOP_RUN_STORE,
      budget: deps.budget ?? OK_BUDGET,
      ...(deps.logger ? { logger: deps.logger } : {}),
    };
  }

  async run(
    input: EmailRunInput,
    ctx: { tenantId: string; triggeredAt?: Date; runId?: string },
  ): Promise<Proposal<EmailDraft>> {
    const threshold = input.threshold ?? DEFAULT_EMAIL_BRAND_VOICE_THRESHOLD;
    const brandVoice = await this.accessors.brandVoice(ctx.tenantId);

    const source: NewsletterSource = {
      contentItemId: input.contentItemId,
      title: input.article.title,
      blocks: input.article.blocks,
      ...(input.article.link ? { link: input.article.link } : {}),
    };
    const projected = projectToNewsletter(source, input.theme);
    const score = brandVoiceScore(projected, brandVoice);

    // ── (A) DETERMINISTIC PATH — STRUCTURAL GUARANTEE: no LlmPort is touched ──
    if (score >= threshold) {
      return this.deterministicProposal(input, ctx, projected);
    }
    // ── (B) LLM PATH — one refinement step, then merge ───────────────────────
    return this.llmProposal(input, ctx, projected, brandVoice);
  }

  /** Path A: emit the projected draft as a proposal WITHOUT any LLM round-trip. */
  private async deterministicProposal(
    input: EmailRunInput,
    ctx: { tenantId: string; triggeredAt?: Date; runId?: string },
    projected: EmailDraft,
  ): Promise<Proposal<EmailDraft>> {
    const triggeredAt = ctx.triggeredAt ?? new Date();
    const taskId = deriveTaskId(input.contentItemId, input.theme, triggeredAt);

    // Idempotency: a prior deterministic run for this task → replay it, no work.
    const existing = await this.runnerDeps.store.findByTaskId(ctx.tenantId, taskId);
    if (existing) {
      return this.toProposal(ctx.tenantId, existing.id, existing.envelope.payload as EmailDraft, {
        estimatedCostUsd: existing.envelope.estimatedCostUsd,
        tokensUsed: existing.envelope.tokensUsed,
        truncated: existing.envelope.truncated,
        rationale: existing.envelope.rationale,
        auditRecorded: true,
        createdAt: existing.createdAt,
      });
    }

    const runId = ctx.runId ?? randomUUID();
    const rationale = `Deterministic: brand-voice score ≥ threshold; no LLM used (theme '${input.theme}').`;
    const tokensUsed = { input: 0, output: 0, cached: 0 };

    // Best-effort audit so the proposal is VISIBLE at the gate even under
    // auditPolicy=obbligatorio (the gate withholds un-audited proposals).
    let auditRecorded = true;
    try {
      const envelope: RunEnvelope = {
        status: "completed",
        payload: projected,
        rationale,
        estimatedCostUsd: 0,
        tokensUsed,
        truncated: false,
      };
      await this.runnerDeps.store.record({
        id: runId,
        tenantId: ctx.tenantId,
        agentName: "email",
        taskId,
        steps: 0,
        toolCalls: [],
        envelope,
        agentDefinitionVersion: EMAIL_VERSION,
      });
    } catch (err) {
      auditRecorded = false;
      this.logger.error("ai_agent_runs audit write failed (email path A)", {
        runId,
        tenantId: ctx.tenantId,
        error: (err as Error).message,
      });
    }

    return this.toProposal(ctx.tenantId, runId, projected, {
      estimatedCostUsd: 0,
      tokensUsed,
      truncated: false,
      rationale,
      auditRecorded,
      createdAt: new Date(),
    });
  }

  /** Path B: a single AgentRunner run refines subject/preheader, then merges. */
  private async llmProposal(
    input: EmailRunInput,
    ctx: { tenantId: string; triggeredAt?: Date; runId?: string },
    projected: EmailDraft,
    brandVoice: BrandVoiceView,
  ): Promise<Proposal<EmailDraft>> {
    const llm = await this.resolveLlm(ctx.tenantId);
    const source: NewsletterSource = {
      contentItemId: input.contentItemId,
      title: input.article.title,
      blocks: input.article.blocks,
      ...(input.article.link ? { link: input.article.link } : {}),
    };
    const tools: ToolDefinition[] = [
      createProjectToNewsletterTool(source, input.theme) as ToolDefinition,
      createGetBrandVoiceTool(this.accessors.brandVoice) as ToolDefinition,
      createGetSegmentProfileTool(this.segmentProfile) as ToolDefinition,
      createGetEmailHistoryTool(this.emailHistory) as ToolDefinition,
    ];
    const registry = new ToolRegistry(tools);

    const def: AgentDefinition<EmailDraft> = {
      ...EMAIL_DEF_BASE,
      model: "balanced",
      allowedTools: ALLOWED_TOOLS,
      outputSchema: emailDraftSchemaLike(),
      // Merge the LLM's subject/preheader (or its deterministic fallback) onto the
      // deterministic projection — the body is never the LLM's.
      parseOutput: (content) => mergeSubjectPreheader(projected, content),
    };

    const runner = new AgentRunner({ llm, tools: registry, ...this.runnerDeps });
    const agentInput: AgentInput = {
      // Theme folds into the runner's taskId (subjectId) → distinct themes are
      // distinct tasks (no cross-theme replay).
      subjectId: `${input.contentItemId}:${input.theme}`,
      content: buildBrief(projected, brandVoice),
    };
    const runCtx: RunContext = {
      tenantId: ctx.tenantId,
      ...(ctx.triggeredAt ? { triggeredAt: ctx.triggeredAt } : {}),
      ...(ctx.runId ? { runId: ctx.runId } : {}),
    };
    const proposal = await runner.run<EmailDraft>(def, agentInput, runCtx);

    // Reuse the (stable) runId as the proposal id so a same-day replay re-stages
    // the SAME id → persist's onConflictDoNothing(id) dedupes (mirrors S2).
    return this.toProposal(ctx.tenantId, proposal.runId, proposal.payload, {
      estimatedCostUsd: proposal.estimatedCostUsd,
      tokensUsed: proposal.tokensUsed,
      truncated: proposal.truncated,
      rationale: proposal.rationale,
      auditRecorded: proposal.auditRecorded,
      createdAt: proposal.createdAt,
    });
  }

  /** Assemble the common `Proposal<EmailDraft>` envelope. */
  private toProposal(
    tenantId: string,
    runId: string,
    payload: EmailDraft,
    meta: {
      estimatedCostUsd: number;
      tokensUsed: { input: number; output: number; cached: number };
      truncated: boolean;
      rationale: string;
      auditRecorded: boolean;
      createdAt: Date;
    },
  ): Proposal<EmailDraft> {
    return {
      // Reuse the (stable) runId as the proposal id so a same-day replay re-stages
      // the SAME id → persist's onConflictDoNothing(id) dedupes (mirrors AgentRunner.replay).
      id: runId,
      tenantId,
      agentId: "email",
      runId,
      type: "email_draft",
      payload,
      rationale: meta.rationale,
      estimatedCostUsd: meta.estimatedCostUsd,
      tokensUsed: meta.tokensUsed,
      status: "pending",
      requiresHumanGate: true,
      truncated: meta.truncated,
      auditRecorded: meta.auditRecorded,
      agentDefinitionVersion: EMAIL_VERSION,
      createdAt: meta.createdAt,
    };
  }
}
