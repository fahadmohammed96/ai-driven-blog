import { createHash } from "node:crypto";
import type { Specialist } from "@blogs/contracts";
import type { ProposalType } from "@blogs/contracts";
import type { ModelTier } from "./model-registry";
import type { SchemaLike } from "./tools";

/**
 * AgentDefinition + AgentRegistry (agentic-plan §3) — the extensible catalogue of
 * agents. Adding an agent = one `AgentDefinition` record (+ any new tools, + a
 * proposal→gate mapping); the runner, loop, metering and gates never change.
 * Definitions are STATIC code today (no table) — DEBT-020.
 *
 * The definition is generic over its payload `T`: `outputSchema` validates the
 * `Proposal<T>.payload` the runner emits. `SchemaLike` (not a hard Zod import)
 * keeps `platform/ai` decoupled from a validation library — a Zod schema
 * satisfies it as-is (same convention as `tools.ts`).
 */

/** A pluggable exit-gate hint: returned when the gate rejects a candidate payload. */
export interface ExitGateFeedback {
  /** Deterministic hint appended to the transcript for ONE extra iteration. */
  feedbackHint: string;
}

export interface AgentDefinition<T = unknown> {
  id: string;
  role: string;
  systemPrompt: string;
  model: ModelTier;
  /** Subset of the ToolRegistry this agent may call. */
  allowedTools: string[];
  /** Max LLM round-trips before the run is truncated. */
  maxSteps: number;
  /** Hard cap on OUTPUT tokens per call. */
  maxTokens: number;
  /** Cap on INPUT context tokens — the runner stops (truncates) if exceeded. */
  maxContextTokens: number;
  /** Per-run worst-case budget envelope. */
  budgetCap: { inputTokens: number; outputTokens: number };
  /** Validates the proposal payload. */
  outputSchema: SchemaLike<T>;
  /** Ties the agent to the tenant's per-specialist autonomy policy. */
  autonomyAxis: Specialist;
  /** The proposal type this agent emits → selects the human gate. */
  proposalType: ProposalType;
  /**
   * PLUGGABLE exit gate (agentic-plan §5, critica #4). Called by the RUNNER
   * after an `end_turn`, NOT hardcoded to any agent. If it returns a feedback
   * hint and the runner hasn't already retried, the hint is appended for exactly
   * ONE extra iteration. The Writer wires `scoreAuthenticity` here in A1-writer.
   */
  // Method syntax (not an arrow-property) so the generic stays bivariant — an
  // AgentDefinition<string> remains assignable to AgentDefinition<unknown> for
  // the registry/version helpers.
  exitGate?(payload: T): ExitGateFeedback | null | undefined;
  /**
   * Parse the model's text into the payload shape. Defaults to the raw string
   * (cast to `T`). Structured agents override this (e.g. `JSON.parse`).
   */
  parseOutput?(content: string): T;
}

/**
 * The set of definition fields that are *semantically* identifying — everything
 * JSON-serialisable. Functions/schemas (`outputSchema`, `exitGate`,
 * `parseOutput`) are intentionally excluded: they don't serialise stably, and a
 * change to them that matters always coincides with a field change here.
 */
function serialisableShape(def: AgentDefinition): Record<string, unknown> {
  return {
    id: def.id,
    role: def.role,
    systemPrompt: def.systemPrompt,
    model: def.model,
    allowedTools: def.allowedTools,
    maxSteps: def.maxSteps,
    maxTokens: def.maxTokens,
    maxContextTokens: def.maxContextTokens,
    budgetCap: def.budgetCap,
    autonomyAxis: def.autonomyAxis,
    proposalType: def.proposalType,
  };
}

/** Canonical JSON with recursively sorted keys, so the hash is order-stable. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const entries = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${entries.join(",")}}`;
}

/**
 * Stable version hash of a definition (agentic-plan §3, critica #12). Same
 * definition → same hash; any change to an identifying field → a new hash. The
 * hash is snapshotted onto every `Proposal` and `ai_agent_runs` row so a
 * proposal is always attributable to the exact agent config that produced it.
 */
export function hashAgentDefinition(def: AgentDefinition): string {
  const digest = createHash("sha256")
    .update(stableStringify(serialisableShape(def)))
    .digest("hex");
  return `v1-${digest.slice(0, 16)}`;
}

export class AgentRegistry {
  private readonly defs = new Map<string, AgentDefinition>();

  register(def: AgentDefinition): void {
    if (this.defs.has(def.id)) {
      throw new Error(`agent already registered: ${def.id}`);
    }
    this.defs.set(def.id, def);
  }

  get(id: string): AgentDefinition {
    const def = this.defs.get(id);
    if (!def) throw new Error(`unknown agent: ${id}`);
    return def;
  }

  /** Stable version hash of the registered definition (see {@link hashAgentDefinition}). */
  version(id: string): string {
    return hashAgentDefinition(this.get(id));
  }
}
