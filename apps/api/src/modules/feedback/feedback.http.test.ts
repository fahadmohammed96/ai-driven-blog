import "reflect-metadata";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import type { MetricInput, NextProposal } from "@blogs/contracts";
import { DB } from "../../platform/tokens";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { metricSnapshots } from "../../platform/db/schema";
import { TenancyService } from "../tenancy";
import { AnalyticsService, ANALYTICS_SOURCES, createAnalyticsSources } from "../analytics";
import { FeedbackController } from "./feedback.controller";
import { FeedbackService } from "./feedback.service";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT = "44444444-4444-4444-4444-444444444444";
const OTHER = "99999999-9999-9999-9999-999999999999";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let db: Db;
let app: INestApplication;

/** Replace the tenant's snapshot with exactly these metric rows (RLS-scoped). */
async function seedMetrics(tenant: string, metrics: MetricInput[]): Promise<void> {
  await withTenant(db, tenant, async (tx) => {
    await tx.delete(metricSnapshots);
    if (metrics.length) {
      await tx.insert(metricSnapshots).values(
        metrics.map((m) => ({
          tenantId: tenant,
          source: m.source,
          channel: m.channel,
          metric: m.metric,
          value: m.value,
          period: m.period,
        })),
      );
    }
  });
}

function metric(source: string, channel: string, metric: string, value: number): MetricInput {
  return { source, channel, metric, value, period: "all", contentItemId: null };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  adminPool = new Pool({ connectionString: container.getConnectionUri() });
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
  // Least-privilege runtime-shaped role: only what the loop needs (SELECT to read
  // the dashboard; INSERT/DELETE here just to seed snapshots in the test).
  await adminPool.query(`CREATE ROLE appuser LOGIN PASSWORD 'app_pw' NOSUPERUSER`);
  await adminPool.query(`GRANT USAGE ON SCHEMA public TO appuser`);
  await adminPool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, metric_snapshots TO appuser`,
  );
  await adminPool.query(
    `INSERT INTO tenants (id, slug, name) VALUES ($1,'founder','Founder'), ($2,'other','Other')`,
    [TENANT, OTHER],
  );

  ({ db, pool: appPool } = createDb(
    `postgresql://appuser:app_pw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));

  process.env.FOUNDER_TENANT_ID = TENANT;
  const moduleRef = await Test.createTestingModule({
    controllers: [FeedbackController],
    providers: [
      TenancyService,
      FeedbackService,
      AnalyticsService,
      { provide: DB, useValue: db },
      { provide: ANALYTICS_SOURCES, useFactory: createAnalyticsSources },
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("feedback loop — analytics metrics adapt the next AI proposal (HTTP)", () => {
  it("metric set A → proposal leads with the channel that performed (pinterest)", async () => {
    const server = app.getHttpServer();
    await seedMetrics(TENANT, [
      metric("affiliate", "pinterest", "clicks", 40),
      metric("affiliate", "instagram", "clicks", 5),
    ]);

    const a = (await request(server).get("/feedback/proposal").expect(200)).body as NextProposal;
    expect(a.signal.topChannel).toBe("pinterest");
    expect(a.proposal.primaryChannel).toBe("pinterest");
    expect(a.proposal.emphasis.find((e) => e.channel === "instagram")?.weight).toBe("deprioritize");
    expect(a.proposal.promptHint).toContain("pinterest");
    expect(a.proposal.rationale).toContain("pinterest");
  });

  it("metric set B (different results) → the SAME loop changes the proposal to instagram", async () => {
    const server = app.getHttpServer();
    // Now instagram wins, and engagement sums across sources (sessions + clicks).
    await seedMetrics(TENANT, [
      metric("ga4", "instagram", "sessions", 50),
      metric("affiliate", "instagram", "clicks", 10),
      metric("affiliate", "pinterest", "clicks", 5),
    ]);

    const b = (await request(server).get("/feedback/proposal").expect(200)).body as NextProposal;
    expect(b.signal.topChannel).toBe("instagram");
    expect(b.proposal.primaryChannel).toBe("instagram");
    expect(b.proposal.emphasis.find((e) => e.channel === "instagram")?.score).toBe(60);
    expect(b.proposal.emphasis.find((e) => e.channel === "pinterest")?.weight).toBe("deprioritize");
    expect(b.proposal.promptHint).toContain("instagram");
  });

  it("RLS: the proposal is shaped only by the tenant's own metrics", async () => {
    const server = app.getHttpServer();
    // OTHER tenant has a huge engagement on a secret channel.
    await seedMetrics(OTHER, [metric("affiliate", "secret-channel", "clicks", 99999)]);
    // The founder's own metrics still favour pinterest.
    await seedMetrics(TENANT, [
      metric("affiliate", "pinterest", "clicks", 40),
      metric("affiliate", "instagram", "clicks", 5),
    ]);

    const mine = (await request(server).get("/feedback/proposal").expect(200)).body as NextProposal;
    expect(mine.proposal.primaryChannel).toBe("pinterest");
    expect(mine.signal.channelRanking.some((c) => c.channel === "secret-channel")).toBe(false);
  });

  it("no metrics yet → a neutral, unadapted proposal (loop has nothing to say)", async () => {
    const server = app.getHttpServer();
    await seedMetrics(TENANT, []);
    const empty = (await request(server).get("/feedback/proposal").expect(200)).body as NextProposal;
    expect(empty.proposal.primaryChannel).toBeNull();
    expect(empty.proposal.rationale).toContain("Nessuna metrica");
  });
});
