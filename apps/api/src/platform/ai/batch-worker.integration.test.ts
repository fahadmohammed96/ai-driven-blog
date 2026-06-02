import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { createDb, type Db } from "../db/client";
import { withTenant } from "../db/tenant";
import {
  ensureAppRole,
  ensurePgBoss,
  grantPgBossSchema,
  PGBOSS_SCHEMA,
} from "../db/bootstrap";
import { aiAgentRuns } from "../db/schema";
import {
  BatchWorker,
  makeAgentBatchHandler,
  AGENT_BATCH_QUEUE,
  type AgentBatchPayload,
} from "./batch-worker";
import { AgentRunner } from "./agent-runner";
import { ToolRegistry } from "./tool-registry";
import { StubLlmAdapter, type LlmPort } from "./llm";
import { PostgresAgentRunStore } from "./agent-run-store";
import type { AgentDefinition } from "./agent-registry";
import type { SchemaLike } from "./tools";
import type { BudgetGuard } from "./budget-guard";

/**
 * Slice O0 acceptance — pg-boss platform worker baseline. EVERYTHING the worker
 * does runs as the least-privilege `app_rw` role (the design crux): the pgboss
 * schema + queues are installed admin-side, the role gets DML-only grants, and
 * the worker connects as `app_rw`. If a grant is missing the worker hits
 * "permission denied for ..." here — exactly the lesson from DEBT-005/regola 13.
 */

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT_A = "11111111-1111-1111-1111-111111111111";

const Q_PLUMB = "o0-plumbing";
const Q_RETRY = "o0-retry";
const Q_ALIVE = "o0-alive";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let adminDb: Db;
let appDb: Db;
let worker: BatchWorker;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll `fn` until `pred` holds, with a hard cap so the test can never hang. */
async function poll<T>(
  fn: () => Promise<T>,
  pred: (v: T) => boolean,
  { tries = 80, delayMs = 300 } = {},
): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (pred(v)) return v;
    await sleep(delayMs);
  }
  throw new Error("poll timed out");
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  ({ db: adminDb, pool: adminPool } = createDb(container.getConnectionUri()));

  // App schema (drizzle migrations) as admin — gives us ai_agent_runs + RLS.
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
  await adminPool.query(`INSERT INTO tenants (id, slug, name) VALUES ($1,'tenant-a','A')`, [
    TENANT_A,
  ]);

  // pg-boss install + baseline queues — ADMIN-SIDE (DDL). Then the app role gets
  // DML-only on the pgboss schema and connects as the least-privilege role.
  await ensurePgBoss(container.getConnectionUri(), [
    { name: AGENT_BATCH_QUEUE, options: { retryLimit: 2 } },
    { name: Q_PLUMB },
    { name: Q_RETRY, options: { retryLimit: 1, retryDelay: 0 } },
    { name: Q_ALIVE },
  ]);
  await ensureAppRole(adminDb, "app_rw", "app_rw");
  await grantPgBossSchema(adminDb, "app_rw");

  const appConnUri = `postgresql://app_rw:app_rw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  ({ db: appDb, pool: appPool } = createDb(appConnUri));

  worker = new BatchWorker({ connectionString: appConnUri, schema: PGBOSS_SCHEMA, onError: () => {} });
  await worker.start();
}, 240_000);

afterAll(async () => {
  await worker?.stop();
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

// ── test doubles for the agent-batch idempotency case ───────────────────────

const stringSchema: SchemaLike<string> = {
  safeParse: (i) =>
    typeof i === "string" && i.length > 0
      ? { success: true, data: i }
      : { success: false, error: "not a non-empty string" },
  parse: (i) => {
    if (typeof i !== "string" || !i.length) throw new Error("invalid payload");
    return i;
  },
};

function stubAgent(): AgentDefinition<string> {
  return {
    id: "o0-batch-stub",
    role: "test agent",
    systemPrompt: "you are a test",
    model: "fast",
    allowedTools: [],
    maxSteps: 3,
    maxTokens: 1_000,
    maxContextTokens: 10_000,
    budgetCap: { inputTokens: 1_000, outputTokens: 1_000 },
    outputSchema: stringSchema,
    autonomyAxis: "writer",
    proposalType: "content_draft",
  };
}

class CountingLlm implements LlmPort {
  calls = 0;
  constructor(private readonly inner: LlmPort) {}
  async complete(req: Parameters<LlmPort["complete"]>[0]) {
    this.calls++;
    return this.inner.complete(req);
  }
}

const okBudget: BudgetGuard = { check: async () => {} };

describe("Slice O0 — pg-boss platform worker baseline (as app_rw)", () => {
  it("connects as a role that does NOT bypass RLS (least-privilege)", async () => {
    const rows = await appPool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(rows.rows[0]!.rolsuper).toBe(false);
    expect(rows.rows[0]!.rolbypassrls).toBe(false);
  });

  it("plumbing: enqueue → worker processes → completed → result recoverable", async () => {
    await worker.work<{ x: string }>(
      Q_PLUMB,
      async (data) => ({ echo: data.x }),
      { pollingIntervalSeconds: 0.5 },
    );

    const id = await worker.enqueue(Q_PLUMB, { x: "ciao" });
    expect(id).toBeTruthy();

    const job = await poll(
      () => worker.getJob<{ x: string }>(Q_PLUMB, id!),
      (j) => j?.state === "completed",
    );
    expect(job!.state).toBe("completed");
    expect((job!.output as { echo: string }).echo).toBe("ciao");
  });

  it("retry/failure: a throwing handler retries to the limit → failed, worker stays alive", async () => {
    let attempts = 0;
    await worker.work(
      Q_RETRY,
      async () => {
        attempts++;
        throw new Error("boom");
      },
      { pollingIntervalSeconds: 0.5 },
    );

    const id = await worker.enqueue(Q_RETRY, { n: 1 });
    const failed = await poll(
      () => worker.getJob(Q_RETRY, id!),
      (j) => j?.state === "failed",
      { tries: 120, delayMs: 300 },
    );
    expect(failed!.state).toBe("failed");
    // retryLimit:1 → one initial attempt + one retry, then failed. No unhandled
    // throw crashed the worker (the next assertion proves it's still processing).
    expect(attempts).toBe(2);

    // The worker survived the failure: a fresh job on another queue still runs.
    await worker.work(Q_ALIVE, async () => ({ ok: true }), { pollingIntervalSeconds: 0.5 });
    const aliveId = await worker.enqueue(Q_ALIVE, { ping: true });
    const alive = await poll(
      () => worker.getJob(Q_ALIVE, aliveId!),
      (j) => j?.state === "completed",
    );
    expect((alive!.output as { ok: boolean }).ok).toBe(true);
  });

  it("idempotency (critica #7): same job processed twice → same Proposal, LLM runs once", async () => {
    const llm = new CountingLlm(new StubLlmAdapter({ scenario: "immediate-end-turn" }));
    const def = stubAgent();
    const store = new PostgresAgentRunStore(appDb);
    const runner = new AgentRunner({ llm, tools: new ToolRegistry(), store, budget: okBudget });
    const handler = makeAgentBatchHandler({
      runner,
      resolve: (id) => {
        if (id !== def.id) throw new Error(`unknown agent: ${id}`);
        return def;
      },
    });

    const payload: AgentBatchPayload = {
      agentId: def.id,
      tenantId: TENANT_A,
      input: { subjectId: "o0-subject", content: "scrivi" },
      // STABLE key → at-least-once double delivery replays, never re-pays.
      taskId: "o0-fixed-task-key",
      triggeredAt: "2026-06-02T10:00:00Z",
    };

    type R = { proposalId: string; runId: string; status: string };
    const first = (await handler(payload)) as R;
    const second = (await handler(payload)) as R;

    // The STABLE identity across an at-least-once re-delivery is the runId (the
    // externalization clause: the Proposal's stable id mirrors `replay → id:
    // rec.id`). The second processing replayed the SAME run, and the LLM was
    // touched exactly ONCE — the re-delivery short-circuited via findByTaskId.
    expect(second.runId).toBe(first.runId);
    expect(second.status).toBe(first.status);
    // A replay returns Proposal.id == runId (A1-core contract), so the replayed
    // processing resolves to the original run's stable identity.
    expect(second.proposalId).toBe(first.runId);
    expect(llm.calls).toBe(1);

    // And exactly ONE audit row exists for that (tenant, taskId): no duplicate run.
    const runs = await withTenant(appDb, TENANT_A, (tx) =>
      tx
        .select()
        .from(aiAgentRuns)
        .where(and(eq(aiAgentRuns.tenantId, TENANT_A), eq(aiAgentRuns.taskId, payload.taskId))),
    );
    expect(runs).toHaveLength(1);
  });
});
