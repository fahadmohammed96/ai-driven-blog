import type { Proposal, SeoProposal, InternalLink } from "@blogs/contracts";
import { seoProposalSchema } from "@blogs/contracts";
import {
  AgentRunner,
  type AgentInput,
  type RunContext,
  type RunLogger,
} from "../../../platform/ai/agent-runner";
import type { AgentDefinition } from "../../../platform/ai/agent-registry";
import { ToolRegistry } from "../../../platform/ai/tool-registry";
import type { LlmPort } from "../../../platform/ai/llm";
import type { ProviderRegistry } from "../../../platform/ai/provider-registry";
import type { ModelTier } from "../../../platform/ai/model-registry";
import type { SchemaLike, ToolDefinition } from "../../../platform/ai/tools";
import type { BudgetGuard } from "../../../platform/ai/budget-guard";
import type { AgentRunStore } from "../../../platform/ai/agent-run-store";
import {
  createScoreReadabilityTool,
  createSeoAnalyzeTool,
  scoreReadability,
  seoAnalyze,
} from "./tools/score-readability";
import {
  createGetInternalLinkCandidatesTool,
  type InternalLinkCandidatesAccessor,
} from "./tools/get-internal-link-candidates";
import {
  createGetExistingContentTool,
  type ExistingContentAccessor,
} from "./tools/get-existing-content";
import { createGetSerpSnapshotTool } from "./tools/get-serp-snapshot";

/**
 * SeoAgent (agentic-plan Slice S1) — replaces the SEO settings "knob" with an
 * agent on the generic `AgentRunner`, following the Writer's A1-writer pattern:
 * a static `AgentDefinition` + injected, boundary-respecting tools, driven by the
 * runner (no loop code here). It emits a `Proposal<SeoProposal>` (type
 * `seo_suggestions`) that lands in `agent_proposals` staging and, on approval, is
 * annotated onto `content_items.seo_proposal` — NON-BLOCKING, it never touches
 * the publication state machine.
 *
 * DETERMINISTIC SEED (cost control §5): readability (Flesch), keyword analysis,
 * internal-link candidates and the unique slug are computed in code BEFORE the
 * loop; the LLM only authors the editorial copy (title / meta / keyword). So even
 * the offline stub (which returns prose, not JSON) yields a VALID `SeoProposal`
 * via the deterministic fallback — a real model just writes better copy.
 *
 * TIER ESCALATION (biforcation in code, not prompt): the run uses `fast` (Haiku)
 * by default and escalates to `balanced` (Sonnet) only when the draft's
 * readability is below {@link READABILITY_ESCALATION_THRESHOLD} — a harder text
 * is worth the stronger model for rewriting copy.
 */

/** Below this Flesch Reading Ease the run escalates from `fast` to `balanced`. */
export const READABILITY_ESCALATION_THRESHOLD = 60;

/** Data accessors injected at the boundary (the caller reads under tenant RLS). */
export interface SeoAccessors {
  internalLinkCandidates: InternalLinkCandidatesAccessor;
  existingContent: ExistingContentAccessor;
}

export interface SeoAgentDeps {
  /** Exactly one of `llm` (fixed port) / `provider` (per-tenant BYOK, R1-C). */
  llm?: LlmPort;
  provider?: ProviderRegistry;
  accessors: SeoAccessors;
  store?: AgentRunStore;
  budget?: BudgetGuard;
  logger?: RunLogger;
}

export interface SeoRunInput {
  contentItemId: string;
  /** The article draft text the proposal is computed against. */
  draft: string;
  /** Optional explicit title hint; otherwise derived from the draft. */
  title?: string;
  /** Internal-link candidate fan-out; defaults to 3. */
  k?: number;
}

const DEFAULT_K = 3;
const META_MAX = 155;

/** No-op store: a stand-alone run persists no audit row (caller wires the real one). */
const NOOP_RUN_STORE: AgentRunStore = {
  findByTaskId: async () => null,
  record: async () => {},
};
/** Always-ok budget for contexts with no DB to meter against (unit tests). */
const OK_BUDGET: BudgetGuard = { check: async () => {} };

const SEO_SYSTEM_PROMPT =
  "Sei lo specialista SEO. Dato il testo di un articolo, proponi i metadati SEO " +
  "ottimali. Rispondi SOLO con un oggetto JSON con esattamente questi campi: " +
  '{"title": string (≤60 caratteri), "metaDescription": string (≤155 caratteri), ' +
  '"primaryKeyword": string}. Niente altro testo.';

const SEO_DEF_BASE = {
  id: "seo",
  role: "Specialista SEO: propone title, meta description, keyword e link interni",
  systemPrompt: SEO_SYSTEM_PROMPT,
  maxSteps: 3,
  maxTokens: 4_000,
  maxContextTokens: 20_000,
  budgetCap: { inputTokens: 20_000, outputTokens: 4_000 },
  autonomyAxis: "seo",
  proposalType: "seo_suggestions",
} satisfies Partial<AgentDefinition<SeoProposal>>;

/** A `SchemaLike` backed by the contract's zod schema (the runner uses parse/safeParse). */
function seoProposalSchemaLike(): SchemaLike<SeoProposal> {
  return {
    safeParse: (input) => {
      const r = seoProposalSchema.safeParse(input);
      return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
    },
    parse: (input) => seoProposalSchema.parse(input),
  };
}

// ── Slug helpers (deterministic, pure — exported for unit tests) ──────────────

/** Lowercase, accent-stripped, hyphen-separated slug; capped at 80 chars. */
export function slugify(text: string): string {
  const base = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return base || "contenuto";
}

/** Append `-2`, `-3`, … until the slug is absent from `existing` (anti-collision). */
export function uniqueSlug(base: string, existing: ReadonlySet<string>): string {
  if (!existing.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!existing.has(candidate)) return candidate;
  }
}

/** First non-empty line of the draft (markdown heading stripped), capped at 120. */
function deriveTitle(draft: string, explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim().slice(0, 120);
  const firstLine = draft.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean);
  return (firstLine ? firstLine.slice(0, 120) : "Contenuto") || "Contenuto";
}

/** First sentence(s) of the draft, trimmed to the meta-description budget. */
function deriveMeta(draft: string): string {
  const flat = draft.replace(/\s+/g, " ").trim();
  if (!flat) return "Contenuto";
  if (flat.length <= META_MAX) return flat;
  return `${flat.slice(0, META_MAX - 1).trimEnd()}…`;
}

/** Editorial copy the LLM may supply; everything else is computed deterministically. */
interface LlmCopy {
  title?: string;
  metaDescription?: string;
  primaryKeyword?: string;
}

function parseLlmCopy(content: string): LlmCopy {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      return {
        ...(typeof o.title === "string" ? { title: o.title } : {}),
        ...(typeof o.metaDescription === "string" ? { metaDescription: o.metaDescription } : {}),
        ...(typeof o.primaryKeyword === "string" ? { primaryKeyword: o.primaryKeyword } : {}),
      };
    }
  } catch {
    // Not JSON (e.g. the offline stub returns prose) → pure deterministic fallback.
  }
  return {};
}

export class SeoAgent {
  private readonly accessors: SeoAccessors;
  private readonly resolveLlm: (tenantId: string) => Promise<LlmPort>;
  private readonly runnerDeps: { store: AgentRunStore; budget: BudgetGuard; logger?: RunLogger };

  constructor(deps: SeoAgentDeps) {
    if (!deps.llm === !deps.provider) {
      throw new Error("SeoAgent requires exactly one of { llm, provider }");
    }
    this.accessors = deps.accessors;
    this.resolveLlm = deps.provider
      ? (tenantId) => deps.provider!.getClient(tenantId)
      : async () => deps.llm!;
    this.runnerDeps = {
      store: deps.store ?? NOOP_RUN_STORE,
      budget: deps.budget ?? OK_BUDGET,
      ...(deps.logger ? { logger: deps.logger } : {}),
    };
  }

  async run(
    input: SeoRunInput,
    ctx: { tenantId: string; taskId?: string; triggeredAt?: Date; runId?: string },
  ): Promise<Proposal<SeoProposal>> {
    const k = input.k ?? DEFAULT_K;
    // ── Deterministic seed (no LLM): readability drives the tier, keyword/links
    //    /slug are computed here so the payload is valid even from a prose stub.
    const readabilityScore = scoreReadability(input.draft);
    const tier: ModelTier =
      readabilityScore < READABILITY_ESCALATION_THRESHOLD ? "balanced" : "fast";
    const analysis = seoAnalyze(input.draft);

    const candidates = await this.accessors.internalLinkCandidates(ctx.tenantId, input.draft, k);
    const internalLinks: InternalLink[] = candidates
      .filter((c) => c.contentItemId !== input.contentItemId)
      .map((c) => ({ contentItemId: c.contentItemId, anchor: c.title }));

    const existing = await this.accessors.existingContent(ctx.tenantId);
    // The accessor returns ALL the tenant's items — exclude the item being
    // optimized so its own slug isn't treated as a collision (mirrors the
    // internal-link self-filter above).
    const existingSlugs = new Set(
      existing.filter((e) => e.contentItemId !== input.contentItemId).map((e) => e.slug),
    );

    const tools: ToolDefinition[] = [
      createSeoAnalyzeTool() as ToolDefinition,
      createScoreReadabilityTool() as ToolDefinition,
      createGetInternalLinkCandidatesTool(this.accessors.internalLinkCandidates) as ToolDefinition,
      createGetExistingContentTool(this.accessors.existingContent) as ToolDefinition,
      createGetSerpSnapshotTool() as ToolDefinition,
    ];
    const registry = new ToolRegistry(tools);

    const def: AgentDefinition<SeoProposal> = {
      ...SEO_DEF_BASE,
      model: tier,
      allowedTools: tools.map((t) => t.id),
      outputSchema: seoProposalSchemaLike(),
      // Merge the LLM's editorial copy (or its deterministic fallback) with the
      // pre-computed deterministic fields into the final SeoProposal.
      parseOutput: (content) => {
        const copy = parseLlmCopy(content);
        const title = copy.title?.trim() || deriveTitle(input.draft, input.title);
        const metaDescription = copy.metaDescription?.trim() || deriveMeta(input.draft);
        const primaryKeyword =
          copy.primaryKeyword?.trim() || analysis.primaryKeyword || "contenuto";
        const slug = uniqueSlug(slugify(title), existingSlugs);
        return {
          contentItemId: input.contentItemId,
          title: title.slice(0, 120),
          metaDescription: metaDescription.slice(0, 320),
          primaryKeyword,
          slug,
          internalLinks,
          readabilityScore,
        };
      },
    };

    const llm = await this.resolveLlm(ctx.tenantId);
    const runner = new AgentRunner({ llm, tools: registry, ...this.runnerDeps });
    const agentInput: AgentInput = { subjectId: input.contentItemId, content: input.draft };
    const runCtx: RunContext = {
      tenantId: ctx.tenantId,
      ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
      ...(ctx.triggeredAt ? { triggeredAt: ctx.triggeredAt } : {}),
      ...(ctx.runId ? { runId: ctx.runId } : {}),
    };
    return runner.run<SeoProposal>(def, agentInput, runCtx);
  }
}
