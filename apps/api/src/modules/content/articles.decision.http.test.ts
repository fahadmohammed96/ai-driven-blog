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
// A second tenant whose items must NEVER be transitioned by the founder (RLS).
const OTHER = "99999999-9999-9999-9999-999999999999";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let db: Db;
let app: INestApplication;

async function seed(tenantId: string, title: string, status: string): Promise<string> {
  const row = await withTenant(db, tenantId, (tx) =>
    insertContentItem(tx, { tenantId, type: "article", title, blocks: [], status }),
  );
  return row.id;
}

async function statusOf(tenantId: string, id: string): Promise<string | null> {
  const item = await withTenant(db, tenantId, (tx) => getContentItem(tx, id));
  return item?.status ?? null;
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

describe("article proposal decisions HTTP (propose/approve/reject)", () => {
  it("propose advances a draft to 'proposed' and persists it", async () => {
    const id = await seed(TENANT, "Bozza da proporre", "draft");
    const res = await request(app.getHttpServer()).post(`/articles/${id}/propose`).expect(200);
    expect(res.body.status).toBe("proposed");
    expect(await statusOf(TENANT, id)).toBe("proposed");
  });

  it("approve walks a proposed item through review to 'approved' and persists it", async () => {
    const id = await seed(TENANT, "Proposta da approvare", "proposed");
    const res = await request(app.getHttpServer()).post(`/articles/${id}/approve`).expect(200);
    expect(res.body.status).toBe("approved");
    expect(await statusOf(TENANT, id)).toBe("approved");
  });

  it("approve also works from 'review'", async () => {
    const id = await seed(TENANT, "In revisione", "review");
    const res = await request(app.getHttpServer()).post(`/articles/${id}/approve`).expect(200);
    expect(res.body.status).toBe("approved");
    expect(await statusOf(TENANT, id)).toBe("approved");
  });

  it("reject sends a proposed item back to 'draft' and persists it", async () => {
    const id = await seed(TENANT, "Proposta da rifiutare", "proposed");
    const res = await request(app.getHttpServer()).post(`/articles/${id}/reject`).expect(200);
    expect(res.body.status).toBe("draft");
    expect(await statusOf(TENANT, id)).toBe("draft");
  });

  it("refuses an illegal decision (approve from draft) with 409, item unchanged", async () => {
    const id = await seed(TENANT, "Bozza non proposta", "draft");
    await request(app.getHttpServer()).post(`/articles/${id}/approve`).expect(409);
    expect(await statusOf(TENANT, id)).toBe("draft");
  });

  it("RLS isolation: the founder cannot transition another tenant's item (404), it stays untouched", async () => {
    const foreignId = await seed(OTHER, "Proposta di un altro tenant", "proposed");
    // Across the RLS boundary the item is invisible → 404, never transitioned.
    await request(app.getHttpServer()).post(`/articles/${foreignId}/approve`).expect(404);
    await request(app.getHttpServer()).post(`/articles/${foreignId}/reject`).expect(404);
    expect(await statusOf(OTHER, foreignId)).toBe("proposed");
  });
});
