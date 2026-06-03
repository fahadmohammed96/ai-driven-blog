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
import { DB } from "../../platform/tokens";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { TenancyService } from "../tenancy";
import { insertContentItem, getContentItem } from "../content";
import { ArticlesController } from "./articles.controller";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
// The founder tenant the controller runs as (set via FOUNDER_TENANT_ID below).
const TENANT = "44444444-4444-4444-4444-444444444444";
// A second tenant whose items must NEVER be writable by the founder (RLS).
const OTHER = "99999999-9999-9999-9999-999999999999";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let db: Db;
let app: INestApplication;

async function seed(tenantId: string, title: string): Promise<string> {
  const row = await withTenant(db, tenantId, (tx) =>
    insertContentItem(tx, {
      tenantId,
      type: "article",
      title,
      blocks: [{ type: "paragraph", text: "originale" }],
      status: "draft",
    }),
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
  await adminPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, content_items TO appuser`);
  await adminPool.query(
    `INSERT INTO tenants (id, slug, name) VALUES ($1,'founder','Founder'), ($2,'other','Other')`,
    [TENANT, OTHER],
  );

  ({ db, pool: appPool } = createDb(
    `postgresql://appuser:app_pw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));

  process.env.FOUNDER_TENANT_ID = TENANT;
  const moduleRef = await Test.createTestingModule({
    controllers: [ArticlesController],
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

describe("articles patch HTTP (PATCH /articles/:id)", () => {
  it("updates title + blocks and persists them", async () => {
    const id = await seed(TENANT, "Titolo iniziale");
    const newBlocks = [
      { type: "heading", level: 2, text: "Nuovo titolo di sezione" },
      { type: "paragraph", text: "Testo riscritto a mano dall'autore." },
    ];

    const res = await request(app.getHttpServer())
      .patch(`/articles/${id}`)
      .send({ title: "Titolo aggiornato", blocks: newBlocks })
      .expect(200);

    expect(res.body.title).toBe("Titolo aggiornato");
    expect(res.body.blocks).toEqual(newBlocks);

    // Re-read through the public GET to prove it was persisted, not just echoed.
    const after = await request(app.getHttpServer()).get(`/articles/${id}`).expect(200);
    expect(after.body.title).toBe("Titolo aggiornato");
    expect(after.body.blocks).toEqual(newBlocks);
  });

  it("cannot patch another tenant's item — RLS isolation (404, no cross-tenant write)", async () => {
    const otherId = await seed(OTHER, "Roba di un altro tenant");

    // The founder (current tenant context) tries to overwrite OTHER's item.
    await request(app.getHttpServer())
      .patch(`/articles/${otherId}`)
      .send({ title: "HACKED", blocks: [{ type: "paragraph", text: "hacked" }] })
      .expect(404);

    // The other tenant's item is untouched across the RLS boundary.
    const stillThere = await withTenant(db, OTHER, (tx) => getContentItem(tx, otherId));
    expect(stillThere?.title).toBe("Roba di un altro tenant");
    expect(stillThere?.blocks).toEqual([{ type: "paragraph", text: "originale" }]);
  });

  it("rejects an invalid blocks payload (400)", async () => {
    const id = await seed(TENANT, "Da non rompere");
    await request(app.getHttpServer())
      .patch(`/articles/${id}`)
      .send({ blocks: [{ type: "paragraph" }] }) // missing required `text`
      .expect(400);

    // The bad request left the item unchanged.
    const after = await request(app.getHttpServer()).get(`/articles/${id}`).expect(200);
    expect(after.body.title).toBe("Da non rompere");
  });
});
