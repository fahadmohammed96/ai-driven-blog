import { createHash, randomUUID } from "node:crypto";
import type { Proposal } from "@blogs/contracts";
import { computeCostUsd } from "./metering";
import type { BudgetGuard } from "./budget-guard";
import type { LlmPort, LlmRequest } from "./llm";
import type { CacheableBlock, Message, ToolCall, ToolContext } from "./tools";
import { type AgentDefinition, hashAgentDefinition } from "./agent-registry";
import type { ToolRegistry } from "./tool-registry";
import type { AgentRunStore, RunEnvelope } from "./agent-run-store";

/**
 * AgentRunner — the generic ReAct loop (agentic-plan §5), isolated from any
 * concrete agent. It composes the cost-controlled `LlmPort`, dispatches tools,
 * enforces the step/context caps, and emits exactly one `Proposal<T>` into a
 * human gate (propose-only is structural). Concrete agents (Writer, SEO, …) are
 * just `AgentDefinition`s the runner drives — they add no loop code.
 *
 * Cost controls wired here: idempotent `taskId` (a retry never re-pays a done
 * run), an L1 pre-loop budget check (no loop on an over-budget run), per-call
 * metering inside the injected `LlmPort`, and `maxSteps`/`maxContextTokens`
 * early-exit. Audit is best-effort: a failed `ai_agent_runs` write degrades to
 * `auditRecorded=false` + a structured log, never a lost proposal (critica #10).
 */

/** The seed for a run. `subjectId` keys the idempotent `taskId`. */
export interface AgentInput {
  subjectId: string;
  content: string;
}

export interface RunContext {
  tenantId: string;
  /** Overrides the derived idempotency key (e.g. a caller-supplied job id). */
  taskId?: string;
  /** Anchors the day-bucket of the derived `taskId`; defaults to now. */
  triggeredAt?: Date;
  /** Overrides the generated run id (e.g. to join a pre-allocated audit row). */
  runId?: string;
}

export interface RunLogger {
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface AgentRunnerDeps {
  llm: LlmPort;
  tools: ToolRegistry;
  store: AgentRunStore;
  budget: BudgetGuard;
  logger?: RunLogger;
}

/** ~4 chars per token — the same rough heuristic the tool truncation uses. */
const CHARS_PER_TOKEN = 4;

function roughTokenCount(messages: Message[]): number {
  return Math.ceil(JSON.stringify(messages).length / CHARS_PER_TOKEN);
}

/** Deterministic idempotency key: same agent + subject + UTC day → same task. */
function deriveTaskId(agentId: string, subjectId: string, triggeredAt: Date): string {
  const day = triggeredAt.toISOString().slice(0, 10);
  return createHash("sha256")
    .update(`${agentId}|${subjectId}|${day}`)
    .digest("hex")
    .slice(0, 32);
}

export class AgentRunner {
  private readonly logger: RunLogger;

  constructor(private readonly deps: AgentRunnerDeps) {
    this.logger = deps.logger ?? {
      error: (message, meta) => console.error(message, meta),
    };
  }

  async run<T>(
    def: AgentDefinition<T>,
    input: AgentInput,
    ctx: RunContext,
  ): Promise<Proposal<T>> {
    const triggeredAt = ctx.triggeredAt ?? new Date();
    const taskId = ctx.taskId ?? deriveTaskId(def.id, input.subjectId, triggeredAt);
    const version = hashAgentDefinition(def);

    // 0. Idempotency (critica #7): a prior run for this task → return its
    //    proposal, NEVER touch the LLM. The full agent_proposals staging lands
    //    in T1; until then we rebuild the proposal from the audit envelope.
    const existing = await this.deps.store.findByTaskId(ctx.tenantId, taskId);
    if (existing) {
      return this.replay(def, existing);
    }

    // 1. L1 pre-loop budget check: an over-budget run never enters the loop.
    await this.deps.budget.check(ctx.tenantId, def);

    const runId = ctx.runId ?? randomUUID();
    const toolCtx: ToolContext = { tenantId: ctx.tenantId, agentId: def.id, runId };
    const toolDefs = this.deps.tools.resolve(def.allowedTools);

    const system: CacheableBlock[] = [{ type: "text", text: def.systemPrompt }];
    const messages: Message[] = [{ role: "user", content: input.content }];
    const baseReq: Omit<LlmRequest, "messages"> = {
      tenantId: ctx.tenantId,
      agentId: def.id,
      runId,
      model: def.model,
      system,
      ...(toolDefs.length ? { tools: toolDefs } : {}),
      maxTokens: def.maxTokens,
    };

    const usedTools: ToolCall[] = [];
    const agg = { input: 0, output: 0, cached: 0 };
    let steps = 0;
    let truncated = false;
    let alreadyRetried = false;
    let lastContent = "";
    let payload: T | undefined;

    for (let step = 1; step <= def.maxSteps; step++) {
      // Input cap (critica #5): stop before the context window blows up.
      if (roughTokenCount(messages) > def.maxContextTokens) {
        truncated = true;
        break;
      }

      const resp = await this.deps.llm.complete({ ...baseReq, messages });
      steps = step;
      agg.input += resp.usage.inputTokens;
      agg.output += resp.usage.outputTokens;
      agg.cached += resp.usage.cacheReadTokens;
      lastContent = resp.content;

      if (resp.stopReason === "tool_use") {
        const calls = resp.toolCalls ?? [];
        usedTools.push(...calls);
        const results = await this.deps.tools.dispatch(calls, toolCtx);
        messages.push({ role: "assistant", content: resp.content });
        for (const r of results) {
          messages.push({
            role: "tool_result",
            toolCallId: r.toolCallId,
            toolName: r.toolName,
            content: r.content,
          });
        }
        // A terminal tool ends the loop; otherwise loop on (until the cap).
        if (results.some((r) => r.final)) break;
        if (step === def.maxSteps) {
          truncated = true;
          break;
        }
        continue;
      }

      if (resp.stopReason === "max_tokens") {
        // Output hit the per-call cap mid-generation → partial result.
        truncated = true;
        break;
      }

      // end_turn: candidate payload ready.
      const candidate = def.parseOutput
        ? def.parseOutput(resp.content)
        : (resp.content as unknown as T);

      // PLUGGABLE exit gate (critica #4): the gate re-validates after EVERY
      // end_turn, but a rejection only triggers a retry ONCE — the hint is
      // appended for exactly one extra iteration, never an unbounded loop. If
      // the gate still rejects after that retry, the candidate is accepted as-is
      // (best-effort), so the loop always terminates.
      const feedback = def.exitGate?.(candidate);
      if (feedback && !alreadyRetried) {
        messages.push({ role: "assistant", content: resp.content });
        messages.push({ role: "user", content: feedback.feedbackHint });
        alreadyRetried = true;
        if (step === def.maxSteps) {
          truncated = true;
          break;
        }
        continue;
      }

      def.outputSchema.parse(candidate);
      payload = candidate;
      break;
    }

    const finalPayload = payload ?? (lastContent as unknown as T);
    const tokensUsed = { input: agg.input, output: agg.output, cached: agg.cached };
    const estimatedCostUsd = computeCostUsd(def.model, {
      inputTokens: agg.input,
      outputTokens: agg.output,
      cacheReadTokens: agg.cached,
    });
    const rationale = truncated
      ? `Run truncated after ${steps} step(s): a cap (maxSteps/maxContextTokens/maxTokens) was reached; partial result.`
      : `Completed in ${steps} step(s).`;
    const envelope: RunEnvelope = {
      status: truncated ? "pending" : "completed",
      payload: finalPayload,
      rationale,
      estimatedCostUsd,
      tokensUsed,
      truncated,
    };

    // Best-effort audit (critica #10): a failed write degrades to
    // auditRecorded=false + a structured log, but the proposal still ships.
    let auditRecorded = true;
    try {
      await this.deps.store.record({
        id: runId,
        tenantId: ctx.tenantId,
        agentName: def.id,
        taskId,
        steps,
        toolCalls: usedTools,
        envelope,
        agentDefinitionVersion: version,
      });
    } catch (err) {
      auditRecorded = false;
      this.logger.error("ai_agent_runs audit write failed", {
        runId,
        tenantId: ctx.tenantId,
        agentId: def.id,
        taskId,
        error: (err as Error).message,
      });
    }

    return {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      agentId: def.id,
      runId,
      type: def.proposalType,
      payload: finalPayload,
      rationale,
      estimatedCostUsd,
      tokensUsed,
      status: "pending",
      requiresHumanGate: true,
      truncated,
      auditRecorded,
      agentDefinitionVersion: version,
      createdAt: new Date(),
    };
  }

  /** Rebuild the prior proposal from its audit row (idempotent replay). */
  private replay<T>(def: AgentDefinition<T>, rec: {
    id: string;
    tenantId: string;
    envelope: RunEnvelope;
    agentDefinitionVersion: string;
    createdAt: Date;
  }): Proposal<T> {
    const env = rec.envelope;
    return {
      id: rec.id,
      tenantId: rec.tenantId,
      agentId: def.id,
      runId: rec.id,
      type: def.proposalType,
      payload: env.payload as T,
      rationale: env.rationale,
      estimatedCostUsd: env.estimatedCostUsd,
      tokensUsed: env.tokensUsed,
      status: "pending",
      requiresHumanGate: true,
      truncated: env.truncated,
      auditRecorded: true,
      agentDefinitionVersion: rec.agentDefinitionVersion,
      createdAt: rec.createdAt,
    };
  }
}
