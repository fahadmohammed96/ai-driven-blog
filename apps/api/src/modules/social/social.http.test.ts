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
import type { Block } from "@blogs/contracts";
import { DB } from "../../platform/tokens";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { TenancyService } from "../tenancy";
import { insertContentItem } from "../content";
import { SocialController } from "./social.controller";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT = "44444444-4444-4444-4444-444444444444";
const ASSET = "55555555-5555-5555-5555-555555555555";

const WITH_IMAGE: Block[] = [
  { type: "heading", level: 1, text: "Una settimana in Giappone" },
  { type: "paragraph", text: "Ho camminato tra i vicoli di Shibuya al tramonto." },
  { type: "image", assetId: ASSET, alt: "Tokyo" },
];
const NO_IMAGE: Block[] = [{ type: "paragraph", text: "Solo testo, nessuna foto." }];

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let db: Db;
let app: INestApplication;

async function seedArticle(blocks: Block[]): Promise<string> {
  const row = await withTenant(db, TENANT, (tx) =>
    insertContentItem(tx, { tenantId: TENANT, type: "article", title: "Una settimana in Giappone", blocks }),
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
    `GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, content_items, channel_posts TO appuser`,
  );
  await adminPool.query(`INSERT INTO tenants (id, slug, name) VALUES ($1,'founder','Founder')`, [TENANT]);

  ({ db, pool: appPool } = createDb(
    `postgresql://appuser:app_pw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));

  process.env.FOUNDER_TENANT_ID = TENANT;
  const moduleRef = await Test.createTestingModule({
    controllers: [SocialController],
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

describe("social HTTP", () => {
  it("repurposes an article into N posts and lists them back", async () => {
    const id = await seedArticle(WITH_IMAGE);
    const server = app.getHttpServer();

    const res = await request(server)
      .post(`/articles/${id}/repurpose`)
      .send({ channels: ["instagram", "x", "pinterest"] })
      .expect(201);
    expect(res.body.posts).toHaveLength(3);

    const list = await request(server).get(`/articles/${id}/posts`).expect(200);
    expect(list.body.posts.map((p: { channel: string }) => p.channel).sort()).toEqual([
      "instagram",
      "pinterest",
      "x",
    ]);
  });

  it("rejects an empty channel list (400)", async () => {
    const id = await seedArticle(WITH_IMAGE);
    await request(app.getHttpServer())
      .post(`/articles/${id}/repurpose`)
      .send({ channels: [] })
      .expect(400);
  });

  it("404s on an unknown article", async () => {
    await request(app.getHttpServer())
      .post(`/articles/66666666-6666-6666-6666-666666666666/repurpose`)
      .send({ channels: ["x"] })
      .expect(404);
  });

  it("422s when pinterest is requested but the article has no image", async () => {
    const id = await seedArticle(NO_IMAGE);
    await request(app.getHttpServer())
      .post(`/articles/${id}/repurpose`)
      .send({ channels: ["pinterest"] })
      .expect(422);
  });

  it("approves a repurposed post (human-in-the-loop gate), idempotently", async () => {
    const id = await seedArticle(WITH_IMAGE);
    const server = app.getHttpServer();

    const res = await request(server)
      .post(`/articles/${id}/repurpose`)
      .send({ channels: ["instagram"] })
      .expect(201);
    const postId = res.body.posts[0].id as string;
    expect(res.body.posts[0].status).toBe("draft");

    const approved = await request(server).post(`/articles/${id}/posts/${postId}/approve`).expect(201);
    expect(approved.body.post.status).toBe("approved");

    // re-approve is idempotent
    await request(server).post(`/articles/${id}/posts/${postId}/approve`).expect(201);

    // unknown post → 404
    await request(server)
      .post(`/articles/${id}/posts/77777777-7777-7777-7777-777777777777/approve`)
      .expect(404);
  });

  it("refuses to reject an already-approved post (409)", async () => {
    const id = await seedArticle(WITH_IMAGE);
    const server = app.getHttpServer();
    const res = await request(server)
      .post(`/articles/${id}/repurpose`)
      .send({ channels: ["instagram"] })
      .expect(201);
    const postId = res.body.posts[0].id as string;
    await request(server).post(`/articles/${id}/posts/${postId}/approve`).expect(201);
    await request(server).post(`/articles/${id}/posts/${postId}/reject`).expect(409);
  });
});
