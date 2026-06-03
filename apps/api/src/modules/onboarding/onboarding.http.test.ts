import "reflect-metadata";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { sql } from "drizzle-orm";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import type { ProvisionedTenant } from "@blogs/contracts";
import { DB } from "../../platform/tokens";
import { createDb, type Db } from "../../platform/db/client";
import { AuthModule, AuthService } from "../auth";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingService } from "./onboarding.service";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let adminDb: Db;
let db: Db;
let app: INestApplication;
let token: string;

let n = 0;
const uniq = (p: string): string => `${p}-${Date.now()}-${n++}`;

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  ({ db: adminDb, pool: adminPool } = createDb(container.getConnectionUri()));
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));

  // A least-privilege runtime role; onboarding's settings seed needs tenant_settings.
  await adminPool.query(`CREATE ROLE appuser LOGIN PASSWORD 'app_pw' NOSUPERUSER`);
  await adminPool.query(`GRANT USAGE ON SCHEMA public TO appuser`);
  await adminPool.query(`GRANT SELECT ON tenants TO appuser`);
  await adminPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_settings TO appuser`);

  ({ db, pool: appPool } = createDb(
    `postgresql://appuser:app_pw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));

  // The service writes the tenancy root on the ADMIN connection (privileged).
  process.env.DATABASE_ADMIN_URL = container.getConnectionUri();
  process.env.FOUNDER_EMAIL = "founder@test.dev";
  process.env.FOUNDER_PASSWORD = "founderpass";
  process.env.JWT_SECRET = "onboarding-http-secret";
  delete process.env.FOUNDER_PASSWORD_HASH;

  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule],
    controllers: [OnboardingController],
    providers: [OnboardingService, { provide: DB, useValue: db }],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();

  // Issue a real founder session the same way the product does (no jwt import).
  token = app.get(AuthService).login("founder@test.dev", "founderpass").token;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("tenant onboarding endpoint (POST /tenants)", () => {
  it("rejects unauthenticated and bad-token requests (401)", async () => {
    const server = app.getHttpServer();
    await request(server).post("/tenants").send({ slug: uniq("nope"), name: "Nope" }).expect(401);
    await request(server)
      .post("/tenants")
      .set("Authorization", "Bearer not-a-real-token")
      .send({ slug: uniq("nope"), name: "Nope" })
      .expect(401);
  });

  it("onboards a new tenant + seeds baseline settings (201), idempotent on slug", async () => {
    const server = app.getHttpServer();
    const slug = uniq("tenant");

    const res = await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${token}`)
      .send({ slug, name: "New Tenant" })
      .expect(201);
    const created = res.body as ProvisionedTenant;
    expect(created.slug).toBe(slug);
    expect(created.id).toBeTruthy();
    expect(created.settings.specialistAutonomy.writer).toBe("manual");

    // The tenancy root + baseline settings actually landed.
    const tenant = await adminDb.execute<{ id: string }>(
      sql`select id from tenants where slug = ${slug}`,
    );
    expect(tenant.rows[0]!.id).toBe(created.id);
    const settings = await adminDb.execute<{ n: number }>(
      sql`select count(*)::int as n from tenant_settings where tenant_id = ${created.id}`,
    );
    expect(Number(settings.rows[0]!.n)).toBe(1);

    // Re-onboarding the same slug returns the same tenant (idempotent).
    const again = await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${token}`)
      .send({ slug, name: "New Tenant Renamed" })
      .expect(201);
    expect((again.body as ProvisionedTenant).id).toBe(created.id);
  });

  it("rejects an invalid slug (400)", async () => {
    const server = app.getHttpServer();
    await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${token}`)
      .send({ slug: "Not A Slug", name: "x" })
      .expect(400);
  });
});
