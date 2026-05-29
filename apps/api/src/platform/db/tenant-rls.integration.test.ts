import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "./client";
import { contentItems } from "./schema";

const here = dirname(fileURLToPath(import.meta.url));
// src/platform/db -> apps/api/drizzle
const migrationsDir = resolve(here, "../../../drizzle");

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let db: Db;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  adminPool = new Pool({ connectionString: container.getConnectionUri() });

  // Apply migrations in lexicographic order.
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
  }

  // A non-superuser role is required for RLS to apply (superusers bypass it).
  await adminPool.query(`CREATE ROLE appuser LOGIN PASSWORD 'app_pw' NOSUPERUSER`);
  await adminPool.query(`GRANT USAGE ON SCHEMA public TO appuser`);
  await adminPool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, content_items TO appuser`,
  );

  // Seed the tenant registry (no RLS on tenants).
  await adminPool.query(
    `INSERT INTO tenants (id, slug, name) VALUES ($1,'tenant-a','Tenant A'), ($2,'tenant-b','Tenant B')`,
    [TENANT_A, TENANT_B],
  );

  const appUri = `postgresql://appuser:app_pw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  const created = createDb(appUri);
  appPool = created.pool;
  db = created.db;

  // Insert tenant-scoped rows as the restricted role, each under its tenant context.
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_tenant', ${TENANT_A}, true)`);
    await tx.execute(sql`insert into content_items (tenant_id, title) values (${TENANT_A}::uuid, 'A-1')`);
    await tx.execute(sql`insert into content_items (tenant_id, title) values (${TENANT_A}::uuid, 'A-2')`);
  });
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_tenant', ${TENANT_B}, true)`);
    await tx.execute(sql`insert into content_items (tenant_id, title) values (${TENANT_B}::uuid, 'B-1')`);
  });
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("RLS tenant isolation", () => {
  it("a query scoped to tenant A sees only tenant A rows", async () => {
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_tenant', ${TENANT_A}, true)`);
      return tx.select().from(contentItems);
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.tenantId === TENANT_A)).toBe(true);
  });

  it("a query scoped to tenant B sees only tenant B rows", async () => {
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_tenant', ${TENANT_B}, true)`);
      return tx.select().from(contentItems);
    });
    expect(rows).toHaveLength(1);
    expect(rows.every((r) => r.tenantId === TENANT_B)).toBe(true);
  });

  it("without a tenant context no rows are visible (deny by default)", async () => {
    const rows = await db.transaction((tx) => tx.select().from(contentItems));
    expect(rows).toHaveLength(0);
  });
});
