import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { createDb, type Db } from "../db/client";
import { withTenant } from "../db/tenant";
import { ensureAppRole, isRlsBypassed } from "../db/bootstrap";
import { aiAgentRuns } from "../db/schema";
import { PostgresAgentRunStore, type AgentRunWrite } from "./agent-run-store";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let adminDb: Db;
let appDb: Db;
let store: PostgresAgentRunStore;

function write(over: Partial<AgentRunWrite> = {}): AgentRunWrite {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    tenantId: TENANT_A,
    agentName: "stub",
    taskId: "task-a",
    steps: 1,
    toolCalls: [],
    envelope: {
      status: "completed",
      payload: "draft text",
      rationale: "Completed in 1 step(s).",
      estimatedCostUsd: 0,
      tokensUsed: { input: 0, output: 0, cached: 0 },
      truncated: false,
    },
    agentDefinitionVersion: "v1-deadbeefdeadbeef",
    ...over,
  };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  ({ db: adminDb, pool: adminPool } = createDb(container.getConnectionUri()));

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
  await adminPool.query(
    `INSERT INTO tenants (id, slug, name) VALUES ($1,'tenant-a','A'), ($2,'tenant-b','B')`,
    [TENANT_A, TENANT_B],
  );

  // Least-privilege runtime role (DEBT-005): RLS is actually enforced as app_rw.
  await ensureAppRole(adminDb, "app_rw", "app_rw");
  ({ db: appDb, pool: appPool } = createDb(
    `postgresql://app_rw:app_rw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));
  store = new PostgresAgentRunStore(appDb);
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("ai_agent_runs RLS (Docker, as app_rw)", () => {
  it("runs as a role that does NOT bypass RLS", async () => {
    expect(await isRlsBypassed(appDb)).toBe(false);
  });

  // RLS guard (critica #8): a run written for one tenant is invisible to another.
  it("isolates runs per tenant — another tenant cannot read them", async () => {
    await store.record(write());

    const seenByA = await withTenant(appDb, TENANT_A, async (tx) => {
      const r = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from ${aiAgentRuns}`,
      );
      return Number(r.rows[0]!.n);
    });
    const seenByB = await withTenant(appDb, TENANT_B, async (tx) => {
      const r = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from ${aiAgentRuns}`,
      );
      return Number(r.rows[0]!.n);
    });

    expect(seenByA).toBeGreaterThanOrEqual(1);
    expect(seenByB).toBe(0);
  });

  it("findByTaskId is tenant-scoped: tenant B cannot see tenant A's task", async () => {
    expect(await store.findByTaskId(TENANT_A, "task-a")).not.toBeNull();
    expect(await store.findByTaskId(TENANT_B, "task-a")).toBeNull();
  });

  it("round-trips the run-result envelope through usage_json", async () => {
    await store.record(
      write({
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        taskId: "task-a2",
        steps: 2,
        toolCalls: [{ id: "c1", name: "dummy", input: { q: "ping" } }],
        envelope: {
          status: "pending",
          payload: { draft: "partial" },
          rationale: "Run truncated.",
          estimatedCostUsd: 0.0123,
          tokensUsed: { input: 10, output: 20, cached: 5 },
          truncated: true,
        },
      }),
    );

    const rec = await store.findByTaskId(TENANT_A, "task-a2");
    expect(rec).not.toBeNull();
    expect(rec!.steps).toBe(2);
    expect(rec!.toolCalls[0]!.name).toBe("dummy");
    expect(rec!.envelope.truncated).toBe(true);
    expect(rec!.envelope.estimatedCostUsd).toBeCloseTo(0.0123, 6);
    expect(rec!.envelope.tokensUsed).toEqual({ input: 10, output: 20, cached: 5 });
  });
});
