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
import type { AnalyticsDashboard, IngestResult } from "@blogs/contracts";
import { DB } from "../../platform/tokens";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import {
  affiliateClicks,
  affiliateLinks,
  channelPosts,
  contentItems,
  metricSnapshots,
  subscribers,
} from "../../platform/db/schema";
import { TenancyService } from "../tenancy";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { ANALYTICS_SOURCES } from "./source.port";
import { createAnalyticsSources } from "./sources";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT = "44444444-4444-4444-4444-444444444444";
const OTHER = "99999999-9999-9999-9999-999999999999";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let db: Db;
let app: INestApplication;

let n = 0;
const uniq = (p: string): string => `${p}-${Date.now()}-${n++}`;

/** Seed one of each internal-source signal for `tenant`; returns the labels used. */
async function seedInternal(tenant: string): Promise<{ affChannel: string; socChannel: string }> {
  const affChannel = uniq("aff");
  const socChannel = uniq("soc");
  await withTenant(db, tenant, async (tx) => {
    // Content (published) → content source.
    const [article] = await tx
      .insert(contentItems)
      .values({ tenantId: tenant, type: "article", title: "Analytics seed", status: "published" })
      .returning();
    // Affiliate click on a unique channel → affiliate source.
    const [link] = await tx
      .insert(affiliateLinks)
      .values({ tenantId: tenant, code: uniq("code"), targetUrl: "https://example.com/x", channel: affChannel })
      .returning();
    await tx.insert(affiliateClicks).values({ tenantId: tenant, linkId: link!.id, channel: affChannel });
    // Confirmed subscriber → email source.
    await tx.insert(subscribers).values({
      tenantId: tenant,
      email: uniq("s") + "@example.com",
      status: "confirmed",
      confirmToken: uniq("tok"),
    });
    // Channel post on a unique channel → social source.
    await tx.insert(channelPosts).values({
      tenantId: tenant,
      contentItemId: article!.id,
      channel: socChannel,
      payload: { channel: "instagram", caption: "x", hashtags: [] } as never,
    });
  });
  return { affChannel, socChannel };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  adminPool = new Pool({ connectionString: container.getConnectionUri() });
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
  await adminPool.query(`CREATE ROLE appuser LOGIN PASSWORD 'app_pw' NOSUPERUSER`);
  await adminPool.query(`GRANT USAGE ON SCHEMA public TO appuser`);
  await adminPool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, content_items, channel_posts, subscribers, affiliate_links, affiliate_clicks, metric_snapshots TO appuser`,
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
    controllers: [AnalyticsController],
    providers: [
      TenancyService,
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

describe("unified analytics — ingest + cross-channel dashboard (HTTP)", () => {
  it("ingests real internal sources + stubbed external ones into one dashboard", async () => {
    const server = app.getHttpServer();
    const { affChannel, socChannel } = await seedInternal(TENANT);

    const ingest = (await request(server).post("/analytics/ingest").expect(200)).body as IngestResult;
    // Every registered source ran; internal + external both present.
    const sources = ingest.bySource.map((s) => s.source);
    expect(sources).toEqual(expect.arrayContaining(["affiliate", "email", "social", "content", "ga4", "search_console"]));
    expect(ingest.bySource.find((s) => s.source === "ga4")!.kind).toBe("external");
    expect(ingest.bySource.find((s) => s.source === "affiliate")!.kind).toBe("internal");
    expect(ingest.ingested).toBeGreaterThan(0);

    const dash = (await request(server).get("/analytics").expect(200)).body as AnalyticsDashboard;
    expect(dash.ingestedAt).not.toBeNull();

    // REAL internal: the seeded affiliate click shows on its unique channel.
    const aff = dash.rows.find((r) => r.source === "affiliate" && r.channel === affChannel && r.metric === "clicks");
    expect(aff?.value).toBe(1);
    expect(aff?.kind).toBe("internal");
    // REAL internal: the seeded social post shows on its unique channel.
    expect(dash.rows.find((r) => r.source === "social" && r.channel === socChannel && r.metric === "posts")?.value).toBe(1);

    // STUBBED external, clearly labelled: GA4 organic sessions + Search Console avg position.
    const ga4 = dash.rows.find((r) => r.source === "ga4" && r.channel === "organic" && r.metric === "sessions");
    expect(ga4?.kind).toBe("external");
    expect(ga4?.value).toBe(1240);
    expect(dash.rows.find((r) => r.source === "search_console" && r.metric === "avg_position")?.value).toBeCloseTo(14.2);

    // CROSS-CHANNEL rollups: per-source (affiliate internal, ga4 external) and
    // per-channel (organic carries BOTH ga4 + search_console — cross-source).
    expect(dash.bySource.find((s) => s.source === "affiliate")!.kind).toBe("internal");
    expect(dash.bySource.find((s) => s.source === "ga4")!.kind).toBe("external");
    const organic = dash.byChannel.find((c) => c.channel === "organic")!;
    expect(organic.metrics.some((m) => m.source === "ga4")).toBe(true);
    expect(organic.metrics.some((m) => m.source === "search_console")).toBe(true);
  });

  it("re-ingestion is idempotent (counts don't double, no duplicate external rows)", async () => {
    const server = app.getHttpServer();
    const before = (await request(server).get("/analytics").expect(200)).body as AnalyticsDashboard;
    const ga4Before = before.rows.filter((r) => r.source === "ga4").length;
    const affOrganicBefore = before.rows.find((r) => r.source === "ga4" && r.channel === "organic" && r.metric === "sessions")!.value;

    await request(server).post("/analytics/ingest").expect(200);
    const after = (await request(server).get("/analytics").expect(200)).body as AnalyticsDashboard;

    // External stub rows replaced (not appended) → same count, same values.
    expect(after.rows.filter((r) => r.source === "ga4").length).toBe(ga4Before);
    expect(after.rows.find((r) => r.source === "ga4" && r.channel === "organic" && r.metric === "sessions")!.value).toBe(affOrganicBefore);
  });

  it("RLS: the founder's dashboard never shows another tenant's metrics", async () => {
    const server = app.getHttpServer();
    const secret = uniq("secret");
    // Seed a metric row directly under OTHER's tenant context.
    await withTenant(db, OTHER, (tx) =>
      tx.insert(metricSnapshots).values({
        tenantId: OTHER,
        source: "affiliate",
        channel: secret,
        metric: "clicks",
        value: 999,
        period: "all",
      }),
    );

    // Founder ingests + reads: OTHER's row never appears.
    await request(server).post("/analytics/ingest").expect(200);
    const dash = (await request(server).get("/analytics").expect(200)).body as AnalyticsDashboard;
    expect(dash.rows.some((r) => r.channel === secret)).toBe(false);

    // …and the founder's source-replace never deleted OTHER's row (RLS-scoped delete).
    const otherRows = await withTenant(db, OTHER, (tx) => tx.select().from(metricSnapshots));
    expect(otherRows.some((r) => r.channel === secret)).toBe(true);
  });
});
