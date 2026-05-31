import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { ensureAppRole, isRlsBypassed } from "../../platform/db/bootstrap";
import { metricSnapshots } from "../../platform/db/schema";
import { AnalyticsService, createAnalyticsSources } from "../analytics";
import { FeedbackService } from "./feedback.service";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let adminDb: Db;
let appDb: Db;
let feedback: FeedbackService;

/** Seed a tenant's snapshot as the app role (replace, RLS-scoped). */
async function seed(
  tenant: string,
  rows: { source: string; channel: string; metric: string; value: number }[],
): Promise<void> {
  await withTenant(appDb, tenant, async (tx) => {
    await tx.delete(metricSnapshots);
    await tx.insert(metricSnapshots).values(
      rows.map((r) => ({ tenantId: tenant, period: "all", ...r })),
    );
  });
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

  // Provision + connect as the real least-privilege runtime role (DEBT-005): the
  // feedback loop must work with only the granted SELECT on metric_snapshots.
  await ensureAppRole(adminDb, "app_rw", "app_rw");
  ({ db: appDb, pool: appPool } = createDb(
    `postgresql://app_rw:app_rw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));
  feedback = new FeedbackService(new AnalyticsService(appDb, createAnalyticsSources()));
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("feedback loop — adapts proposals as the runtime app role (RLS)", () => {
  it("connects as a role that does NOT bypass RLS", async () => {
    expect(await isRlsBypassed(appDb)).toBe(false);
  });

  it("given metric set A the proposal is X, given set B it changes to Y", async () => {
    // A: pinterest performs.
    await seed(TENANT_A, [
      { source: "affiliate", channel: "pinterest", metric: "clicks", value: 40 },
      { source: "affiliate", channel: "instagram", metric: "clicks", value: 5 },
    ]);
    const x = await feedback.nextProposal(TENANT_A);
    expect(x.proposal.primaryChannel).toBe("pinterest");

    // B: instagram performs (cross-source sum).
    await seed(TENANT_A, [
      { source: "ga4", channel: "instagram", metric: "sessions", value: 50 },
      { source: "affiliate", channel: "instagram", metric: "clicks", value: 10 },
      { source: "affiliate", channel: "pinterest", metric: "clicks", value: 5 },
    ]);
    const y = await feedback.nextProposal(TENANT_A);
    expect(y.proposal.primaryChannel).toBe("instagram");
    expect(y.proposal.primaryChannel).not.toBe(x.proposal.primaryChannel);
  });

  it("isolates proposals per tenant (RLS): B's metrics never shape A's proposal", async () => {
    await seed(TENANT_B, [{ source: "affiliate", channel: "x", metric: "clicks", value: 99999 }]);
    await seed(TENANT_A, [
      { source: "affiliate", channel: "pinterest", metric: "clicks", value: 40 },
      { source: "affiliate", channel: "instagram", metric: "clicks", value: 5 },
    ]);

    const a = await feedback.nextProposal(TENANT_A);
    expect(a.proposal.primaryChannel).toBe("pinterest");
    expect(a.signal.channelRanking.some((c) => c.channel === "x")).toBe(false);

    const b = await feedback.nextProposal(TENANT_B);
    expect(b.proposal.primaryChannel).toBe("x");
  });
});
