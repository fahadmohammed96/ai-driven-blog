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
import { insertContentItem } from "../content";
import { ArticlesController } from "./articles.controller";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
// The founder tenant the controller runs as (set via FOUNDER_TENANT_ID below).
const TENANT = "44444444-4444-4444-4444-444444444444";
// A second tenant whose items must NEVER leak into the founder's list (RLS).
const OTHER = "99999999-9999-9999-9999-999999999999";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let db: Db;
let app: INestApplication;

interface SeedSpec {
  tenantId: string;
  type: "article" | "itinerary";
  title: string;
  status?: string;
}

async function seed(spec: SeedSpec): Promise<string> {
  const row = await withTenant(db, spec.tenantId, (tx) =>
    insertContentItem(tx, {
      tenantId: spec.tenantId,
      type: spec.type,
      title: spec.title,
      blocks: [],
      ...(spec.status ? { status: spec.status } : {}),
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

  // The founder's items (a mix of type + status) and one item belonging to OTHER.
  await seed({ tenantId: TENANT, type: "article", title: "Bozza articolo", status: "draft" });
  await seed({ tenantId: TENANT, type: "article", title: "Articolo pubblicato", status: "published" });
  await seed({ tenantId: TENANT, type: "itinerary", title: "Giro del Giappone", status: "draft" });
  await seed({ tenantId: OTHER, type: "article", title: "Roba di un altro tenant", status: "published" });

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

interface ListItem {
  id: string;
  type: string;
  status: string;
  title: string;
}

describe("articles list HTTP (GET /articles)", () => {
  it("lists the tenant's content items, never another tenant's (RLS isolation)", async () => {
    const res = await request(app.getHttpServer()).get("/articles").expect(200);
    const items = res.body.items as ListItem[];
    const titles = items.map((i) => i.title);

    expect(titles).toContain("Bozza articolo");
    expect(titles).toContain("Articolo pubblicato");
    expect(titles).toContain("Giro del Giappone");
    // The other tenant's item is invisible across the RLS boundary.
    expect(titles).not.toContain("Roba di un altro tenant");
    expect(items).toHaveLength(3);
    // Each item carries the fields the Library renders (badge + navigation).
    for (const i of items) {
      expect(i.id).toMatch(/[0-9a-f-]{36}/);
      expect(i.type).toBeTruthy();
      expect(i.status).toBeTruthy();
    }
  });

  it("filters by type", async () => {
    const res = await request(app.getHttpServer()).get("/articles?type=itinerary").expect(200);
    const items = res.body.items as ListItem[];
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Giro del Giappone");
    expect(items[0]!.type).toBe("itinerary");
  });

  it("filters by status", async () => {
    const res = await request(app.getHttpServer()).get("/articles?status=published").expect(200);
    const items = res.body.items as ListItem[];
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Articolo pubblicato");
    expect(items[0]!.status).toBe("published");
  });

  it("combines type + status filters", async () => {
    const res = await request(app.getHttpServer())
      .get("/articles?type=article&status=draft")
      .expect(200);
    const items = res.body.items as ListItem[];
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Bozza articolo");
  });
});
