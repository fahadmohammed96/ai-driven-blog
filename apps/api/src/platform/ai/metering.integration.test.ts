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
import { aiUsageEvents } from "../db/schema";
import { PostgresMeteringService, computeCostUsd } from "./metering";
import { TwoLevelBudgetGuard, BudgetExceededError } from "./budget-guard";
import type { WorstCaseDef } from "./model-registry";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");

// Distinct tenants so each scenario's sums are independent under RLS.
const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const TENANT_C = "33333333-3333-3333-3333-333333333333";
const TENANT_D = "44444444-4444-4444-4444-444444444444";

const DEF: WorstCaseDef = { model: "balanced", maxSteps: 4, maxTokens: 8_000 };

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let adminDb: Db;
let appDb: Db;
let metering: PostgresMeteringService;

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  ({ db: adminDb, pool: adminPool } = createDb(container.getConnectionUri()));

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
  await adminPool.query(
    `INSERT INTO tenants (id, slug, name) VALUES
       ($1,'tenant-a','A'), ($2,'tenant-b','B'), ($3,'tenant-c','C'), ($4,'tenant-d','D')`,
    [TENANT_A, TENANT_B, TENANT_C, TENANT_D],
  );

  // Provision the least-privilege runtime role and connect as it (DEBT-005).
  await ensureAppRole(adminDb, "app_rw", "app_rw");
  ({ db: appDb, pool: appPool } = createDb(
    `postgresql://app_rw:app_rw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));
  metering = new PostgresMeteringService(appDb);
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("ai_usage_events metering (Docker, as app_rw)", () => {
  it("runs as a role that does NOT bypass RLS", async () => {
    expect(await isRlsBypassed(appDb)).toBe(false);
  });

  // RLS guard (critica #8): a row written for one tenant is invisible to another.
  it("isolates usage events per tenant — another tenant counts zero", async () => {
    await metering.record({
      tenantId: TENANT_A,
      agentName: "writer",
      model: "balanced",
      usage: { inputTokens: 1_000, outputTokens: 500, cacheReadTokens: 0 },
    });

    const seenByA = await withTenant(appDb, TENANT_A, async (tx) => {
      const r = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from ${aiUsageEvents}`,
      );
      return Number(r.rows[0]!.n);
    });
    const seenByB = await withTenant(appDb, TENANT_B, async (tx) => {
      const r = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from ${aiUsageEvents}`,
      );
      return Number(r.rows[0]!.n);
    });

    expect(seenByA).toBeGreaterThanOrEqual(1);
    expect(seenByB).toBe(0);
  });

  it("record inserts a row and SUM(cost_usd) per tenant equals the expected cost", async () => {
    const usage = { inputTokens: 2_000, outputTokens: 1_000, cacheReadTokens: 500 };
    await metering.record({
      tenantId: TENANT_B,
      runId: null,
      agentName: "seo",
      model: "fast",
      usage,
    });

    const expected = computeCostUsd("fast", usage);
    expect(await metering.monthlySpendUsd(TENANT_B)).toBeCloseTo(expected, 9);

    const rows = await withTenant(appDb, TENANT_B, (tx) =>
      tx.select().from(aiUsageEvents),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.agentName).toBe("seo");
    expect(rows[0]!.model).toBe("fast");
    expect(rows[0]!.inputTokens).toBe(2_000);
  });

  it("monthlySpendUsd sums only the current month and only this tenant", async () => {
    // Current-month spend for C.
    await metering.record({
      tenantId: TENANT_C,
      agentName: "writer",
      model: "balanced",
      usage: { inputTokens: 0, outputTokens: 1_000, cacheReadTokens: 0 },
    });
    const current = computeCostUsd("balanced", {
      inputTokens: 0,
      outputTokens: 1_000,
      cacheReadTokens: 0,
    });

    // A row dated to a past month must NOT be counted.
    await withTenant(appDb, TENANT_C, (tx) =>
      tx.insert(aiUsageEvents).values({
        tenantId: TENANT_C,
        agentName: "writer",
        model: "balanced",
        inputTokens: 0,
        outputTokens: 999_999,
        costUsd: "123.456789",
        createdAt: new Date("2020-01-15T00:00:00Z"),
      }),
    );

    // Another tenant's spend must NOT leak in.
    await metering.record({
      tenantId: TENANT_A,
      agentName: "writer",
      model: "balanced",
      usage: { inputTokens: 9_999, outputTokens: 9_999, cacheReadTokens: 0 },
    });

    expect(await metering.monthlySpendUsd(TENANT_C)).toBeCloseTo(current, 9);
  });

  // Orchestrator simulation (critica #2/#10): the guard re-reads the DB before
  // every sub-run, so the second sub-run sees the first's spend.
  it("BudgetGuard re-reads spend between two sub-runs (second sees the first's cost)", async () => {
    const CAP = 1; // USD
    const guard = new TwoLevelBudgetGuard({
      metering,
      resolveBudgetUsd: async () => CAP,
    });

    // Before sub-run #1: tenant D is empty, worst-case ($0.624) fits the cap.
    await expect(guard.check(TENANT_D, DEF)).resolves.toBeUndefined();

    // Sub-run #1 spends $15 (1M output tokens on balanced) — over the cap.
    await metering.record({
      tenantId: TENANT_D,
      agentName: "orchestrator",
      model: "balanced",
      usage: { inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0 },
    });

    // Before sub-run #2: the guard re-reads the DB and trips the hard cap (L2).
    const err = await guard.check(TENANT_D, DEF).catch((e) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect((err as BudgetExceededError).level).toBe("L2");
    expect((err as BudgetExceededError).detail.spentUsd).toBeCloseTo(15, 6);
  });
});
