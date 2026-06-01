import { createHash, randomUUID } from "node:crypto";
import type { Channel, ChannelPost, ChannelPostMap, Proposal } from "@blogs/contracts";
import { channelPostSchema, channelPostMapSchema, CHANNEL_LIMITS } from "@blogs/contracts";
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
import type { ModelTier } from "../../../platform/ai/model-registry";
import type { SchemaLike, ToolDefinition } from "../../../platform/ai/tools";
import type { BudgetGuard } from "../../../platform/ai/budget-guard";
import type { AgentRunStore, RunEnvelope } from "../../../platform/ai/agent-run-store";
import { truncateWords, type ArticleContent } from "../repurpose";
import { channelConstraints, createGetChannelConstraintsTool } from "./tools/get-channel-constraints";
import { createGetBrandVoiceTool, type BrandVoiceView } from "./tools/get-brand-voice";
import {
  createGetTopPerformingPostsTool,
  STUB_TOP_PERFORMING_POSTS,
  type TopPerformingPostsAccessor,
} from "./tools/get-top-performing-posts";
import { createProjectToSocialTool, projectChannels } from "./tools/project-to-social";

/**
 * SocialAgent (agentic-plan Slice S2) — pairs the DETERMINISTIC channel
 * projectors (ADR-0017, `repurpose`) with an OPTIONAL LLM caption layer, the
 * biforcation made structural IN CODE (cost control §5, critica #4):
 *
 *   (A) deterministic — project the article, compute a pure {@link brandVoiceScore}
 *       (caption ↔ brand-voice keyword overlap). If it clears the threshold the
 *       agent emits the proposal WITHOUT EVER TOUCHING `LlmPort` — "no LLM when
 *       the projector is good enough" is a GUARANTEE, not a prompt hint.
 *   (B) LLM — only when the score is below threshold: ONE LLM step PER CHANNEL
 *       rewrites the caption/hashtags within the channel's hard limits, then the
 *       results are merged. `fast` (Haiku) for x/instagram, `balanced` (Sonnet)
 *       for pinterest.
 *
 * Either way it emits a propose-only `Proposal<ChannelPostMap>` (type
 * `social_captions`) that lands in `agent_proposals` staging and, on approval, is
 * inserted as `channel_posts` at `draft` — the EXISTING Phase-2.5 per-post gate
 * (`setPostApproval`) stays the final gate before anything goes out. The agent
 * NEVER publishes.
 */

/**
 * Below this caption↔brand-voice overlap the run escalates to the LLM layer.
 * A DEFAULT CONSTANT (not a `TenantSettings` field) on purpose.
 * TODO(debt): DEBT-030 — make it per-tenant configurable when a tenant asks for a
 * different brand-voice sensitivity (would touch the settings deep-equals).
 */
export const DEFAULT_BRAND_VOICE_THRESHOLD = 0.5;

/** Raised when none of the requested∩enabled channels can be projected. */
export class NoProducibleChannelsError extends Error {
  constructor(public readonly contentItemId: string) {
    super(`no producible channels for content item: ${contentItemId}`);
    this.name = "NoProducibleChannelsError";
  }
}

/** The tenant context the agent reads (brand voice + the enabled channels). */
export interface TenantBrandContext {
  brandVoice: BrandVoiceView;
  /** The channels the tenant has enabled — the output is intersected with these. */
  channels: Channel[];
}

export type BrandContextAccessor = (tenantId: string) => Promise<TenantBrandContext>;

/** Data accessors injected at the boundary (the caller reads under tenant RLS). */
export interface SocialAccessors {
  brandContext: BrandContextAccessor;
  /** Past high-performing posts per channel; defaults to the DEBT-030 stub. */
  topPerformingPosts?: TopPerformingPostsAccessor;
}

export interface SocialAgentDeps {
  /** Exactly one of `llm` (fixed port) / `provider` (per-tenant BYOK, R1-C). */
  llm?: LlmPort;
  provider?: ProviderRegistry;
  accessors: SocialAccessors;
  store?: AgentRunStore;
  budget?: BudgetGuard;
  logger?: RunLogger;
}

export interface SocialRunInput {
  contentItemId: string;
  /** The source article (canonical block model) the posts are projected from. */
  article: ArticleContent;
  /** The channels the founder asked for (intersected with the tenant's enabled). */
  channels: Channel[];
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

const SOCIAL_SYSTEM_PROMPT =
  "Sei lo specialista social. Riscrivi la caption/gli hashtag del post per il canale " +
  "indicato, restando ENTRO i vincoli di piattaforma forniti e nel brand voice del tenant. " +
  "Rispondi SOLO con un oggetto JSON: per instagram {\"caption\": string, \"hashtags\": string[]}, " +
  "per x {\"tweets\": string[]}, per pinterest {\"title\": string, \"description\": string}. Niente altro testo.";

/** Stable base shared by the per-channel defs (model/tools are set per run). */
const SOCIAL_DEF_BASE = {
  id: "social",
  role: "Specialista social: adatta l'articolo in post per canale (caption/hashtag)",
  systemPrompt: SOCIAL_SYSTEM_PROMPT,
  maxSteps: 2,
  maxTokens: 3_000,
  maxContextTokens: 12_000,
  budgetCap: { inputTokens: 12_000, outputTokens: 3_000 },
  autonomyAxis: "social",
  proposalType: "social_captions",
} satisfies Partial<AgentDefinition<ChannelPost>>;

/** Tier per channel (cost control §1): fast for short text, balanced for pins. */
function tierForChannel(channel: Channel): ModelTier {
  return channel === "pinterest" ? "balanced" : "fast";
}

/** A `SchemaLike` backed by the contract's zod schema (the runner uses parse/safeParse). */
function channelPostSchemaLike(): SchemaLike<ChannelPost> {
  return {
    safeParse: (input) => {
      const r = channelPostSchema.safeParse(input);
      return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
    },
    parse: (input) => channelPostSchema.parse(input),
  };
}

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

/** The text a channel post contributes to the brand-voice overlap corpus. */
export function postText(post: ChannelPost): string {
  switch (post.channel) {
    case "instagram":
      return `${post.caption} ${post.hashtags.join(" ")}`;
    case "x":
      return post.tweets.join(" ");
    case "pinterest":
      return `${post.title} ${post.description}`;
  }
}

/**
 * Deterministic brand-voice fit in [0, 1]: the fraction of the brand voice's
 * keywords (tone + audience) that already appear in the projected captions. Pure
 * — same input → same score. An EMPTY brand voice has nothing to satisfy, so it
 * scores 1 (the deterministic path is taken; no LLM is spent shaping a voice that
 * was never configured).
 */
export function brandVoiceScore(posts: ChannelPost[], brandVoice: BrandVoiceView): number {
  const brandKeywords = keywords(`${brandVoice.tone} ${brandVoice.audience}`);
  if (brandKeywords.length === 0) return 1;
  const corpus = new Set(keywords(posts.map(postText).join(" ")));
  const matched = brandKeywords.filter((k) => corpus.has(k)).length;
  return matched / brandKeywords.length;
}

// ── per-channel LLM copy merge (deterministic fallback on bad/empty JSON) ──────

interface ChannelCopy {
  caption?: string;
  hashtags?: string[];
  tweets?: string[];
  title?: string;
  description?: string;
}

function parseChannelCopy(content: string): ChannelCopy {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      return {
        ...(typeof o.caption === "string" ? { caption: o.caption } : {}),
        ...(Array.isArray(o.hashtags) && o.hashtags.every((h) => typeof h === "string")
          ? { hashtags: o.hashtags as string[] }
          : {}),
        ...(Array.isArray(o.tweets) && o.tweets.every((t) => typeof t === "string")
          ? { tweets: o.tweets as string[] }
          : {}),
        ...(typeof o.title === "string" ? { title: o.title } : {}),
        ...(typeof o.description === "string" ? { description: o.description } : {}),
      };
    }
  } catch {
    // Not JSON (e.g. the offline stub returns prose) → pure deterministic fallback.
  }
  return {};
}

/** Normalize a hashtag to `#word`, lowercased, alnum only. */
function normalizeHashtag(tag: string): string {
  const word = tag.replace(/^#+/, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return word ? `#${word}` : "";
}

/**
 * Overlay the LLM's editorial copy onto the deterministic projected post, within
 * the channel's hard limits, then re-validate. Any field the LLM omits (or the
 * whole thing, for a prose stub) falls back to the projector's value; if the
 * merged post fails schema validation the projected post is returned unchanged —
 * the LLM can only improve copy, never break the channel contract.
 */
export function mergeChannelCopy(projected: ChannelPost, content: string): ChannelPost {
  const copy = parseChannelCopy(content);
  let candidate: ChannelPost;
  switch (projected.channel) {
    case "instagram": {
      const caption = copy.caption?.trim()
        ? truncateWords(copy.caption.trim(), CHANNEL_LIMITS.instagram.caption)
        : projected.caption;
      const hashtags = copy.hashtags
        ? copy.hashtags.map(normalizeHashtag).filter(Boolean).slice(0, CHANNEL_LIMITS.instagram.hashtags)
        : projected.hashtags;
      candidate = { channel: "instagram", caption, hashtags };
      break;
    }
    case "x": {
      const tweets =
        copy.tweets && copy.tweets.length
          ? copy.tweets.map((t) => t.trim()).filter(Boolean).map((t) => truncateWords(t, CHANNEL_LIMITS.x.tweet))
          : projected.tweets;
      candidate = { channel: "x", tweets };
      break;
    }
    case "pinterest": {
      candidate = {
        ...projected,
        title: copy.title?.trim()
          ? truncateWords(copy.title.trim(), CHANNEL_LIMITS.pinterest.title)
          : projected.title,
        description: copy.description?.trim()
          ? truncateWords(copy.description.trim(), CHANNEL_LIMITS.pinterest.description)
          : projected.description,
      };
      break;
    }
  }
  const parsed = channelPostSchema.safeParse(candidate);
  return parsed.success ? parsed.data : projected;
}

/** The user message for a per-channel rewrite: the projected post + its limits + voice. */
function buildChannelBrief(post: ChannelPost, brandVoice: BrandVoiceView): string {
  const limits = channelConstraints(post.channel);
  return JSON.stringify({
    channel: post.channel,
    constraints: limits,
    brandVoice,
    current: post,
  });
}

/** Deterministic idempotency key for the path-A audit row (mirrors the runner). */
function deriveTaskId(contentItemId: string, triggeredAt: Date): string {
  const day = triggeredAt.toISOString().slice(0, 10);
  return createHash("sha256").update(`social|${contentItemId}|${day}`).digest("hex").slice(0, 32);
}

const SOCIAL_VERSION = hashAgentDefinition({
  ...SOCIAL_DEF_BASE,
  model: "fast",
  allowedTools: [],
  outputSchema: channelPostSchemaLike() as SchemaLike<unknown>,
} as AgentDefinition);

export class SocialAgent {
  private readonly accessors: SocialAccessors;
  private readonly resolveLlm: (tenantId: string) => Promise<LlmPort>;
  private readonly topPerforming: TopPerformingPostsAccessor;
  private readonly runnerDeps: { store: AgentRunStore; budget: BudgetGuard; logger?: RunLogger };
  private readonly logger: RunLogger;

  constructor(deps: SocialAgentDeps) {
    if (!deps.llm === !deps.provider) {
      throw new Error("SocialAgent requires exactly one of { llm, provider }");
    }
    this.accessors = deps.accessors;
    this.resolveLlm = deps.provider
      ? (tenantId) => deps.provider!.getClient(tenantId)
      : async () => deps.llm!;
    this.topPerforming = deps.accessors.topPerformingPosts ?? STUB_TOP_PERFORMING_POSTS;
    this.logger = deps.logger ?? { error: (m, meta) => console.error(m, meta) };
    this.runnerDeps = {
      store: deps.store ?? NOOP_RUN_STORE,
      budget: deps.budget ?? OK_BUDGET,
      ...(deps.logger ? { logger: deps.logger } : {}),
    };
  }

  async run(
    input: SocialRunInput,
    ctx: { tenantId: string; taskId?: string; triggeredAt?: Date; runId?: string },
  ): Promise<Proposal<ChannelPostMap>> {
    const threshold = input.threshold ?? DEFAULT_BRAND_VOICE_THRESHOLD;
    const { brandVoice, channels: enabled } = await this.accessors.brandContext(ctx.tenantId);

    // Only requested channels that the tenant has enabled (∩), de-duplicated,
    // request order preserved.
    const seen = new Set<Channel>();
    const effective = input.channels.filter(
      (c) => enabled.includes(c) && !seen.has(c) && (seen.add(c), true),
    );
    const projected = projectChannels(input.article, effective);
    if (projected.length === 0) throw new NoProducibleChannelsError(input.contentItemId);

    const score = brandVoiceScore(projected, brandVoice);

    // ── (A) DETERMINISTIC PATH — STRUCTURAL GUARANTEE: no LlmPort is touched ──
    if (score >= threshold) {
      return this.deterministicProposal(input, ctx, projected);
    }
    // ── (B) LLM PATH — one step per channel, then merge ──────────────────────
    return this.llmProposal(input, ctx, projected, brandVoice);
  }

  /** Path A: emit the projected posts as a proposal WITHOUT any LLM round-trip. */
  private async deterministicProposal(
    input: SocialRunInput,
    ctx: { tenantId: string; taskId?: string; triggeredAt?: Date; runId?: string },
    projected: ChannelPost[],
  ): Promise<Proposal<ChannelPostMap>> {
    const triggeredAt = ctx.triggeredAt ?? new Date();
    const taskId = ctx.taskId ?? deriveTaskId(input.contentItemId, triggeredAt);

    // Idempotency: a prior deterministic run for this task → replay it, no work.
    const existing = await this.runnerDeps.store.findByTaskId(ctx.tenantId, taskId);
    if (existing) {
      return this.toProposal(ctx.tenantId, existing.id, existing.envelope.payload as ChannelPostMap, {
        estimatedCostUsd: existing.envelope.estimatedCostUsd,
        tokensUsed: existing.envelope.tokensUsed,
        truncated: existing.envelope.truncated,
        rationale: existing.envelope.rationale,
        auditRecorded: true,
        createdAt: existing.createdAt,
      });
    }

    const payload: ChannelPostMap = { contentItemId: input.contentItemId, posts: projected };
    channelPostMapSchema.parse(payload);
    const runId = ctx.runId ?? randomUUID();
    const rationale = `Deterministic: brand-voice score ≥ threshold for ${projected.length} channel(s); no LLM used.`;
    const tokensUsed = { input: 0, output: 0, cached: 0 };

    // Best-effort audit so the proposal is VISIBLE at the gate even under
    // auditPolicy=obbligatorio (the gate withholds un-audited proposals).
    let auditRecorded = true;
    try {
      const envelope: RunEnvelope = {
        status: "completed",
        payload,
        rationale,
        estimatedCostUsd: 0,
        tokensUsed,
        truncated: false,
      };
      await this.runnerDeps.store.record({
        id: runId,
        tenantId: ctx.tenantId,
        agentName: "social",
        taskId,
        steps: 0,
        toolCalls: [],
        envelope,
        agentDefinitionVersion: SOCIAL_VERSION,
      });
    } catch (err) {
      auditRecorded = false;
      this.logger.error("ai_agent_runs audit write failed (social path A)", {
        runId,
        tenantId: ctx.tenantId,
        error: (err as Error).message,
      });
    }

    return this.toProposal(ctx.tenantId, runId, payload, {
      estimatedCostUsd: 0,
      tokensUsed,
      truncated: false,
      rationale,
      auditRecorded,
      createdAt: new Date(),
    });
  }

  /** Path B: one AgentRunner run PER channel (one LLM step each), then merge. */
  private async llmProposal(
    input: SocialRunInput,
    ctx: { tenantId: string; triggeredAt?: Date },
    projected: ChannelPost[],
    brandVoice: BrandVoiceView,
  ): Promise<Proposal<ChannelPostMap>> {
    const llm = await this.resolveLlm(ctx.tenantId);
    const tools: ToolDefinition[] = [
      createProjectToSocialTool(input.article) as ToolDefinition,
      createGetChannelConstraintsTool() as ToolDefinition,
      createGetBrandVoiceTool((tid) =>
        this.accessors.brandContext(tid).then((c) => c.brandVoice),
      ) as ToolDefinition,
      createGetTopPerformingPostsTool(this.topPerforming) as ToolDefinition,
    ];
    const allowedTools = tools.map((t) => t.id);

    const channelProposals: Proposal<ChannelPost>[] = [];
    for (const post of projected) {
      const registry = new ToolRegistry(tools);
      const def: AgentDefinition<ChannelPost> = {
        ...SOCIAL_DEF_BASE,
        model: tierForChannel(post.channel),
        allowedTools,
        outputSchema: channelPostSchemaLike(),
        // Merge the LLM copy (or its deterministic fallback) onto the projection.
        parseOutput: (content) => mergeChannelCopy(post, content),
      };
      const runner = new AgentRunner({ llm, tools: registry, ...this.runnerDeps });
      const agentInput: AgentInput = {
        subjectId: `${input.contentItemId}:${post.channel}`,
        content: buildChannelBrief(post, brandVoice),
      };
      const runCtx: RunContext = {
        tenantId: ctx.tenantId,
        ...(ctx.triggeredAt ? { triggeredAt: ctx.triggeredAt } : {}),
      };
      channelProposals.push(await runner.run<ChannelPost>(def, agentInput, runCtx));
    }

    const posts = channelProposals.map((p) => p.payload);
    const payload: ChannelPostMap = { contentItemId: input.contentItemId, posts };
    channelPostMapSchema.parse(payload);

    const estimatedCostUsd = channelProposals.reduce((s, p) => s + p.estimatedCostUsd, 0);
    const tokensUsed = channelProposals.reduce(
      (acc, p) => ({
        input: acc.input + p.tokensUsed.input,
        output: acc.output + p.tokensUsed.output,
        cached: acc.cached + p.tokensUsed.cached,
      }),
      { input: 0, output: 0, cached: 0 },
    );
    const truncated = channelProposals.some((p) => p.truncated);
    const auditRecorded = channelProposals.every((p) => p.auditRecorded);
    // Reuse the first channel run's id so the gate's LEFT JOIN surfaces its
    // reasoning trace next to the merged proposal.
    const runId = channelProposals[0]?.runId ?? randomUUID();
    const rationale = `LLM caption layer across ${posts.length} channel(s) (brand-voice score below threshold).`;

    return this.toProposal(ctx.tenantId, runId, payload, {
      estimatedCostUsd,
      tokensUsed,
      truncated,
      rationale,
      auditRecorded,
      createdAt: new Date(),
    });
  }

  /** Assemble the common `Proposal<ChannelPostMap>` envelope. */
  private toProposal(
    tenantId: string,
    runId: string,
    payload: ChannelPostMap,
    meta: {
      estimatedCostUsd: number;
      tokensUsed: { input: number; output: number; cached: number };
      truncated: boolean;
      rationale: string;
      auditRecorded: boolean;
      createdAt: Date;
    },
  ): Proposal<ChannelPostMap> {
    return {
      id: randomUUID(),
      tenantId,
      agentId: "social",
      runId,
      type: "social_captions",
      payload,
      rationale: meta.rationale,
      estimatedCostUsd: meta.estimatedCostUsd,
      tokensUsed: meta.tokensUsed,
      status: "pending",
      requiresHumanGate: true,
      truncated: meta.truncated,
      auditRecorded: meta.auditRecorded,
      agentDefinitionVersion: SOCIAL_VERSION,
      createdAt: meta.createdAt,
    };
  }
}
