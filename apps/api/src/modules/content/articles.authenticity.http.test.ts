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
import { ArticlesController } from "./articles.controller";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT = "44444444-4444-4444-4444-444444444444";
const OTHER = "99999999-9999-9999-9999-999999999999";

// A substantial, generic (non first-person) paragraph: the measurer flags it.
const GENERIC = "La città offre numerose attrazioni turistiche da vedere durante tutta la giornata.";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let db: Db;
let app: INestApplication;

async function seed(tenantId: string, title: string, blocks: Block[]): Promise<string> {
  const row = await withTenant(db, tenantId, (tx) =>
    insertContentItem(tx, { tenantId, type: "article", title, blocks, status: "draft" }),
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

describe("articles authenticity HTTP (GET /articles/:id/authenticity)", () => {
  it("computes the experience score + flags from the stored blocks", async () => {
    const id = await seed(TENANT, "Generico", [
      { type: "heading", level: 2, text: "La meta" },
      { type: "paragraph", text: GENERIC },
    ]);
    const res = await request(app.getHttpServer()).get(`/articles/${id}/authenticity`).expect(200);

    expect(typeof res.body.score).toBe("number");
    expect(res.body.score).toBeGreaterThanOrEqual(0);
    expect(res.body.score).toBeLessThanOrEqual(1);
    // The generic paragraph reads as not-lived → score 0 and one nudge.
    expect(res.body.score).toBe(0);
    expect(Array.isArray(res.body.flags)).toBe(true);
    expect(res.body.flags).toHaveLength(1);
    expect(res.body.flags[0].suggestion).toMatch(/esperienza/i);
  });

  it("cannot read another tenant's authenticity — RLS isolation (404)", async () => {
    const otherId = await seed(OTHER, "Roba altrui", [{ type: "paragraph", text: GENERIC }]);
    await request(app.getHttpServer()).get(`/articles/${otherId}/authenticity`).expect(404);
  });
});
