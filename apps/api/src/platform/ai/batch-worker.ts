import { PgBoss, type Job, type SendOptions, type WorkOptions } from "pg-boss";
import { PGBOSS_SCHEMA } from "../db/bootstrap";
import type { AgentDefinition } from "./agent-registry";
import type { AgentInput, AgentRunner } from "./agent-runner";

/**
 * BatchWorker — the platform's async job transport (Slice O0, ADR-0030), a thin
 * lifecycle/enqueue/work facade over pg-boss. It is deliberately GENERIC and
 * ISOLATED from the Orchestrator (O3) and from every concrete agent: it knows
 * how to start/stop the queue, enqueue a job, and register a handler — nothing
 * about WHICH agent runs or WHAT the editorial plan is.
 *
 * Least-privilege (the design crux): the worker connects as the runtime app role
 * (`app_rw`, NOSUPERUSER) and MUST NEVER run DDL. So it is constructed with
 * `migrate:false` (schema install/migrate is admin-side, see `ensurePgBoss`) and
 * `supervise:false`/`schedule:false` (pg-boss maintenance — partition/archive
 * management — needs DDL and is deferred to admin/hardening, DEBT-040). The
 * baseline queues are created admin-side too, so the worker only ever does DML
 * (send/fetch/complete) on existing tables.
 *
 * Isolation (arch boundary): `platform/ai` must not import `modules/*`. The
 * "which agent runs" decision is therefore INJECTED — {@link makeAgentBatchHandler}
 * takes a resolver composed at the composition root (`main.ts`), never an import.
 */

/** The platform queue carrying agent-batch jobs (see {@link AgentBatchPayload}). */
export const AGENT_BATCH_QUEUE = "agent-batch";

/**
 * A handler for a queue: receives the typed job payload (and the raw job, which
 * pg-boss always supplies). `job` is optional in the TYPE only so a handler can
 * be unit-tested by direct invocation with just the payload.
 */
export type BatchJobHandler<T> = (data: T, job?: Job<T>) => Promise<unknown>;

export interface BatchWorkerOptions {
  /** The runtime (app_rw) connection string — DML only, never DDL. */
  connectionString: string;
  /** Defaults to the dedicated, non-tenant `pgboss` schema. */
  schema?: string;
  /** Surfaces pg-boss-internal errors (worker loop, not handler errors). */
  onError?: (err: Error) => void;
}

export class BatchWorker {
  private readonly boss: PgBoss;

  constructor(opts: BatchWorkerOptions) {
    this.boss = new PgBoss({
      connectionString: opts.connectionString,
      schema: opts.schema ?? PGBOSS_SCHEMA,
      // RUNTIME app_rw: DDL is forbidden. Schema/queues are provisioned admin-side
      // (ensurePgBoss); maintenance that needs DDL is deferred (DEBT-040).
      migrate: false,
      createSchema: false,
      supervise: false,
      schedule: false,
    });
    // A failed handler FAILS its job (pg-boss catches it); 'error' here is a
    // worker-loop/internal error. Listen so it never becomes an unhandled crash.
    const onError = opts.onError ?? ((err) => console.error("[batch-worker] pg-boss error", err));
    this.boss.on("error", onError);
  }

  /** Start the worker. With migrate:false this only CHECKS the schema (no DDL). */
  async start(): Promise<this> {
    await this.boss.start();
    return this;
  }

  /** Graceful shutdown: drains in-flight jobs, then closes the pool. */
  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true });
  }

  /** Enqueue a job onto a (pre-created) queue; returns the job id. */
  async enqueue<T extends object>(
    name: string,
    data: T,
    opts?: SendOptions,
  ): Promise<string | null> {
    return opts ? this.boss.send(name, data, opts) : this.boss.send(name, data);
  }

  /**
   * Register a handler for a queue. pg-boss v12 hands the handler an ARRAY of
   * jobs (batch fetch); we default to one-at-a-time and unwrap to a single job,
   * so handlers stay simple. A throw fails the job → pg-boss retries up to the
   * queue/job `retryLimit`, then marks it `failed` WITHOUT crashing the worker.
   */
  async work<T extends object>(
    name: string,
    handler: BatchJobHandler<T>,
    opts: WorkOptions = {},
  ): Promise<string> {
    return this.boss.work<T>(name, opts, async (jobs: Job<T>[]) => {
      const results: unknown[] = [];
      for (const job of jobs) {
        results.push(await handler(job.data, job));
      }
      // With the default batchSize of 1 this is a single result; pg-boss stores
      // it as the job `output`, recoverable via {@link getJob}.
      return results.length === 1 ? results[0] : results;
    });
  }

  /**
   * Fetch a job (incl. `state` and `output`) by id — for result retrieval.
   * NOTE: pg-boss v12 marks `getJobById` `@deprecated` (in favour of `findJobs`),
   * but it is retained and fully functional (the integration test reads completed
   * AND failed jobs through it); kept for the single-id ergonomic. Migrate to
   * `findJobs(name, { id })` if/when a future major removes it.
   */
  async getJob<T extends object>(name: string, id: string): Promise<Job<T> & { state: string; output: unknown } | null> {
    const job = await this.boss.getJobById<T>(name, id, {});
    return job as (Job<T> & { state: string; output: unknown }) | null;
  }
}

/**
 * The baseline "agent batch" payload: enough to run ANY registered agent on the
 * queue without `platform/ai` importing the agent's module.
 */
export interface AgentBatchPayload {
  /** The agent definition id to resolve + run. */
  agentId: string;
  tenantId: string;
  input: AgentInput;
  /**
   * STABLE idempotency key (critica #7). Propagated verbatim to `ctx.taskId`, so
   * an at-least-once double delivery of the SAME payload replays the existing
   * `Proposal` instead of re-running the LLM. MUST include every input that
   * shapes the output (the caller derives it).
   */
  taskId: string;
  /** Optional ISO timestamp anchoring the run (audit/derived-key parity). */
  triggeredAt?: string;
}

/** Resolves an `agentId` to its definition — injected, NEVER a `modules/*` import. */
export type AgentResolver = (agentId: string) => AgentDefinition<unknown>;

export interface AgentBatchHandlerDeps {
  runner: AgentRunner;
  resolve: AgentResolver;
}

/**
 * Build the baseline agent-batch handler. It runs the resolved agent via the
 * shared {@link AgentRunner}, PROPAGATING the payload's `taskId` into
 * `ctx.taskId` — that is the entire idempotency guarantee for at-least-once
 * delivery: the runner's `findByTaskId` short-circuits a re-delivery to a replay
 * (same `Proposal`, no second LLM call, no second `ai_agent_runs` row).
 *
 * Metering/budget ride along for free: the runner uses the same cost-controlled
 * `LlmPort` it always does; in CI the stub LLM makes this zero-cost.
 */
export function makeAgentBatchHandler(
  deps: AgentBatchHandlerDeps,
): BatchJobHandler<AgentBatchPayload> {
  return async (data) => {
    const def = deps.resolve(data.agentId);
    const proposal = await deps.runner.run(def, data.input, {
      tenantId: data.tenantId,
      taskId: data.taskId,
      ...(data.triggeredAt ? { triggeredAt: new Date(data.triggeredAt) } : {}),
    });
    // Return a compact result for the job `output` — never the full payload.
    return {
      proposalId: proposal.id,
      runId: proposal.runId,
      status: proposal.status,
      agentId: def.id,
    };
  };
}
