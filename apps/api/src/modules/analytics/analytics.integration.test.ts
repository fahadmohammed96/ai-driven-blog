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
import {
  affiliateClicks,
  affiliateLinks,
  subscribers,
} from "../../platform/db/schema";
import { AnalyticsService } from "./analytics.service";
import { createAnalyticsSources } from "./sources";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let adminDb: Db;
let appDb: Db;
let service: AnalyticsService;

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  ({ db: adminDb, pool: adminPool } = createDb(container.getConnectionUri()));
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
  await adminPool.query(
    `INSERT INTO tenants (id, slug, name) VALUES ($1,'tenant-a','A'), ($2,'tenant-b','B')`,
    [TENANT_A, TENANT_B],
  );

  // Provision + connect as the real least-privilege runtime role (DEBT-005), so
  // the metric_snapshots grants (INSERT/DELETE/SELECT) are proven at runtime.
  await ensureAppRole(adminDb, "app_rw", "app_rw");
  ({ db: appDb, pool: appPool } = createDb(
    `postgresql://app_rw:app_rw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));
  service = new AnalyticsService(appDb, createAnalyticsSources());
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("unified analytics — ingest + dashboard as the runtime app role (RLS)", () => {
  it("connects as a role that does NOT bypass RLS", async () => {
    expect(await isRlsBypassed(appDb)).toBe(false);
  });

  it("ingests internal + external sources and serves the cross-channel dashboard", async () => {
    // Seed an affiliate click + a confirmed subscriber for A as the app role.
    await withTenant(appDb, TENANT_A, async (tx) => {
      const [link] = await tx
        .insert(affiliateLinks)
        .values({ tenantId: TENANT_A, code: "int-a", targetUrl: "https://example.com/a", channel: "blog" })
        .returning();
      await tx.insert(affiliateClicks).values({ tenantId: TENANT_A, linkId: link!.id, channel: "blog" });
      await tx.insert(subscribers).values({
        tenantId: TENANT_A,
        email: "int-a@example.com",
        status: "confirmed",
        confirmToken: "int-tok-a",
      });
    });

    const ingest = await service.ingestAll(TENANT_A);
    expect(ingest.bySource.map((s) => s.source)).toEqual(
      expect.arrayContaining(["affiliate", "email", "social", "content", "ga4", "search_console"]),
    );

    const dash = await service.getDashboard(TENANT_A);
    // REAL internal: affiliate blog click + confirmed subscriber.
    expect(dash.rows.find((r) => r.source === "affiliate" && r.channel === "blog" && r.metric === "clicks")?.value).toBe(1);
    expect(dash.rows.find((r) => r.source === "email" && r.metric === "subscribers")?.value).toBe(1);
    // STUBBED external present + labelled.
    expect(dash.rows.find((r) => r.source === "ga4" && r.metric === "sessions" && r.channel === "organic")?.kind).toBe("external");
    expect(dash.ingestedAt).not.toBeNull();
  });

  it("isolates metrics per tenant (RLS): B ingests/reads only its own, A's survive", async () => {
    // B has no internal signal of its own → affiliate rows are empty, but the
    // external stubs still populate (deterministic fixtures).
    await service.ingestAll(TENANT_B);
    const dashB = await service.getDashboard(TENANT_B);
    expect(dashB.rows.some((r) => r.source === "affiliate")).toBe(false);
    expect(dashB.rows.some((r) => r.source === "ga4")).toBe(true);

    // A's affiliate metric is untouched by B's ingest (RLS-scoped replace).
    const dashA = await service.getDashboard(TENANT_A);
    expect(dashA.rows.find((r) => r.source === "affiliate" && r.channel === "blog")?.value).toBe(1);
  });
});
