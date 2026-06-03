/**
 * Model tiering — the single place that maps an agent's *intent* (how much
 * reasoning power a step needs) to a concrete Anthropic model id and its price.
 *
 * Agents and the runner only ever speak in tiers (`fast` | `balanced` |
 * `powerful`); swapping the underlying model, or repricing, is a one-file edit
 * here and never touches agent code. Tiers decouple us from commercial model
 * names (decisione vincolante, agentic-plan §"Risoluzione dei conflitti").
 */

export type ModelTier = "fast" | "balanced" | "powerful";

/**
 * Tier -> Anthropic model id. THIS map is the only source of truth for which
 * model a tier resolves to; verify the ids against the current model lineup
 * when Anthropic ships a new generation.
 *  - fast      -> Haiku   (routing/classification, short prompts, high volume)
 *  - balanced  -> Sonnet  (writing/judgement — the workhorse)
 *  - powerful  -> Opus    (offline calibration only; never in the hot path)
 */
export const MODEL_IDS: Record<ModelTier, string> = {
  fast: "claude-haiku-4-5-20251001",
  balanced: "claude-sonnet-4-6",
  powerful: "claude-opus-4-8",
};

export interface TokenPrice {
  /** USD per input token. */
  input: number;
  /** USD per output token. */
  output: number;
  /** USD per cached-prefix read token (much cheaper than a fresh input token). */
  cacheRead: number;
}

/**
 * Price table in USD per MILLION tokens. Cache-read pricing is the standard
 * ~10% of the input price for ephemeral prompt caching.
 * TODO(debt): DEBT-016 — prices hardcoded; trigger = first Anthropic repricing.
 */
const PRICING_PER_MTOK: Record<ModelTier, TokenPrice> = {
  fast: { input: 0.8, output: 4, cacheRead: 0.08 },
  balanced: { input: 3, output: 15, cacheRead: 0.3 },
  powerful: { input: 15, output: 75, cacheRead: 1.5 },
};

const PER_MILLION = 1_000_000;

/** Per-TOKEN price for a tier (pure lookup; used by metering in R1-B). */
export function pricePerToken(tier: ModelTier): TokenPrice {
  const p = PRICING_PER_MTOK[tier];
  return {
    input: p.input / PER_MILLION,
    output: p.output / PER_MILLION,
    cacheRead: p.cacheRead / PER_MILLION,
  };
}

/** Minimal shape `estimateWorstCaseUsd` needs from an AgentDefinition. */
export interface WorstCaseDef {
  model: ModelTier;
  /** Max LLM round-trips the runner will allow for this agent. */
  maxSteps: number;
  /** Hard cap on OUTPUT tokens per call. */
  maxTokens: number;
}

/** 30% headroom over pure output cost to account for tool-result input tokens. */
const WORST_CASE_BUFFER = 1.3;

/**
 * Prudent worst-case USD cost of a full agent run — the L1 pre-job estimate the
 * R1-B circuit-breaker checks BEFORE entering the loop. Pure and deterministic:
 *
 *   maxSteps × maxTokens × outputPricePerToken(model) × 1.3
 *
 * It assumes every step emits the full output budget (the true worst case) and
 * adds a buffer for the input tokens tool results inject back into the context.
 */
export function estimateWorstCaseUsd(def: WorstCaseDef): number {
  return (
    def.maxSteps *
    def.maxTokens *
    pricePerToken(def.model).output *
    WORST_CASE_BUFFER
  );
}
