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
import type { AffiliateLinkView, AffiliateStats } from "@blogs/contracts";
import { DB } from "../../platform/tokens";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { TenancyService } from "../tenancy";
import { insertContentItem } from "../content";
import { AffiliateController } from "./affiliate.controller";
import { RedirectorController } from "./redirector.controller";
import { insertAffiliateLink } from "./affiliate.repo";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
// The founder tenant the controllers run as (set via FOUNDER_TENANT_ID below).
const TENANT = "44444444-4444-4444-4444-444444444444";
// A second tenant whose links must NEVER be seen/redirected/counted (RLS).
const OTHER = "99999999-9999-9999-9999-999999999999";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let db: Db;
let app: INestApplication;

async function seedArticle(title: string): Promise<string> {
  const row = await withTenant(db, TENANT, (tx) =>
    insertContentItem(tx, { tenantId: TENANT, type: "article", title, blocks: [] }),
  );
  return row.id;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  adminPool = new Pool({ connectionString: container.getConnectionUri() });
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
  await adminPool.query(`CREATE ROLE appuser LOGIN PASSWORD 'app_pw' NOSUPERUSER`);
  await adminPool.query(`GRANT USAGE ON SCHEMA public TO appuser`);
  await adminPool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, content_items, affiliate_links, affiliate_clicks TO appuser`,
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
    controllers: [AffiliateController, RedirectorController],
    providers: [TenancyService, { provide: DB, useValue: db }],
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

// Each test uses a unique code so the shared container's rows never collide.
let n = 0;
const code = (p: string): string => `${p}-${Date.now()}-${n++}`;

describe("affiliate hub + /go redirector + click tracking (HTTP)", () => {
  it("creates a link (clicks 0), redirects through /go/:code, and counts the click", async () => {
    const server = app.getHttpServer();
    const c = code("japan");
    const target = "https://partner.example.com/japan?ref=blogs";

    const created = await request(server)
      .post("/affiliates")
      .send({ code: c, targetUrl: target, channel: "instagram" })
      .expect(201);
    const link = created.body as AffiliateLinkView;
    expect(link.code).toBe(c);
    expect(link.clicks).toBe(0);

    // The redirector 302s to the target and does NOT follow (supertest default).
    const redirect = await request(server).get(`/go/${c}`).expect(302);
    expect(redirect.headers.location).toBe(target);

    // The click was recorded → the link's count is now 1.
    const after = await request(server).get("/affiliates").expect(200);
    const mine = (after.body.links as AffiliateLinkView[]).find((l) => l.code === c)!;
    expect(mine.clicks).toBe(1);

    // A second click increments to 2.
    await request(server).get(`/go/${c}`).expect(302);
    const after2 = await request(server).get("/affiliates").expect(200);
    expect((after2.body.links as AffiliateLinkView[]).find((l) => l.code === c)!.clicks).toBe(2);
  });

  it("segments counts per link / article / channel", async () => {
    const server = app.getHttpServer();
    const articleA = await seedArticle("Affiliate article A");
    const channelA = code("chan");
    const codeA = code("a");
    const codeB = code("b");

    // Link A: associated with an article + a channel, clicked 3×.
    await request(server)
      .post("/affiliates")
      .send({ code: codeA, targetUrl: "https://example.com/a", contentItemId: articleA, channel: channelA })
      .expect(201);
    // Link B: same channel, no article, clicked 1×.
    await request(server)
      .post("/affiliates")
      .send({ code: codeB, targetUrl: "https://example.com/b", channel: channelA })
      .expect(201);

    for (let i = 0; i < 3; i++) await request(server).get(`/go/${codeA}`).expect(302);
    await request(server).get(`/go/${codeB}`).expect(302);

    const stats = (await request(server).get("/affiliates/stats").expect(200)).body as AffiliateStats;

    // Per link: A has 3, B has 1.
    expect(stats.byLink.find((l) => l.code === codeA)!.clicks).toBe(3);
    expect(stats.byLink.find((l) => l.code === codeB)!.clicks).toBe(1);
    // Per article: only A's clicks carry the article.
    expect(stats.byArticle.find((a) => a.contentItemId === articleA)!.clicks).toBe(3);
    // Per channel: this channel saw A(3) + B(1) = 4.
    expect(stats.byChannel.find((ch) => ch.channel === channelA)!.clicks).toBe(4);
  });

  it("404s an unknown code", async () => {
    await request(app.getHttpServer()).get(`/go/${code("missing")}`).expect(404);
  });

  it("409s a duplicate code (unique per tenant)", async () => {
    const server = app.getHttpServer();
    const c = code("dup");
    await request(server).post("/affiliates").send({ code: c, targetUrl: "https://example.com/x" }).expect(201);
    await request(server).post("/affiliates").send({ code: c, targetUrl: "https://example.com/y" }).expect(409);
  });

  it("400s an invalid payload (bad target URL / bad code)", async () => {
    const server = app.getHttpServer();
    await request(server).post("/affiliates").send({ code: code("ok"), targetUrl: "not-a-url" }).expect(400);
    await request(server).post("/affiliates").send({ code: "Bad Code!", targetUrl: "https://example.com" }).expect(400);
  });

  it("edits a link via PATCH; unknown id → 404", async () => {
    const server = app.getHttpServer();
    const c = code("edit");
    const created = await request(server)
      .post("/affiliates")
      .send({ code: c, targetUrl: "https://example.com/old" })
      .expect(201);
    const id = (created.body as AffiliateLinkView).id;

    const patched = await request(server)
      .patch(`/affiliates/${id}`)
      .send({ targetUrl: "https://example.com/new", label: "Etichetta" })
      .expect(200);
    expect((patched.body as AffiliateLinkView).targetUrl).toBe("https://example.com/new");
    expect((patched.body as AffiliateLinkView).label).toBe("Etichetta");

    // The new target is what the redirector now sends to.
    const redirect = await request(server).get(`/go/${c}`).expect(302);
    expect(redirect.headers.location).toBe("https://example.com/new");

    await request(server)
      .patch(`/affiliates/66666666-6666-6666-6666-666666666666`)
      .send({ targetUrl: "https://example.com/z" })
      .expect(404);
  });

  it("RLS: cannot see, redirect, or count another tenant's link", async () => {
    const server = app.getHttpServer();
    const foreignCode = code("foreign");
    // Seed a link directly under OTHER's tenant context.
    await withTenant(db, OTHER, (tx) =>
      insertAffiliateLink(tx, {
        tenantId: OTHER,
        code: foreignCode,
        targetUrl: "https://secret.example.com/other",
        channel: "x",
      }),
    );

    // The founder (controller tenant) never resolves OTHER's code → 404.
    await request(server).get(`/go/${foreignCode}`).expect(404);

    // …and never lists it.
    const list = await request(server).get("/affiliates").expect(200);
    expect((list.body.links as AffiliateLinkView[]).some((l) => l.code === foreignCode)).toBe(false);

    // …and its channel never shows in the founder's stats from a foreign click.
    const stats = (await request(server).get("/affiliates/stats").expect(200)).body as AffiliateStats;
    expect(stats.byLink.some((l) => l.code === foreignCode)).toBe(false);
  });
});
