import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { insertContentItem, applyTransition, publishContentItem, ContentNotFoundError } from "./content.repo";
import { InvalidTransitionError } from "./state-machine";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let db: Db;

async function newDraft(): Promise<string> {
  const row = await withTenant(db, TENANT_A, (tx) =>
    insertContentItem(tx, { tenantId: TENANT_A, type: "article", title: "Bozza", blocks: [] }),
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
    `INSERT INTO tenants (id, slug, name) VALUES ($1,'tenant-a','Tenant A'), ($2,'tenant-b','Tenant B')`,
    [TENANT_A, TENANT_B],
  );

  ({ db, pool: appPool } = createDb(
    `postgresql://appuser:app_pw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("publication lifecycle (persisted)", () => {
  it("walks draft → proposed → review → approved → published", async () => {
    const id = await newDraft();
    expect((await applyTransition(db, TENANT_A, id, "propose")).status).toBe("proposed");
    expect((await applyTransition(db, TENANT_A, id, "startReview")).status).toBe("review");
    expect((await applyTransition(db, TENANT_A, id, "approve")).status).toBe("approved");

    const published = await publishContentItem(db, TENANT_A, id);
    expect(published.status).toBe("published");
    expect(published.publishedAt).toBeInstanceOf(Date);
  });

  it("publishes idempotently — published_at is stamped once", async () => {
    const id = await newDraft();
    await applyTransition(db, TENANT_A, id, "propose");
    await applyTransition(db, TENANT_A, id, "startReview");
    await applyTransition(db, TENANT_A, id, "approve");

    const first = await publishContentItem(db, TENANT_A, id);
    const second = await publishContentItem(db, TENANT_A, id);

    expect(second.status).toBe("published");
    expect(second.publishedAt?.getTime()).toBe(first.publishedAt?.getTime());
  });

  it("refuses to publish before approval", async () => {
    const id = await newDraft();
    await expect(publishContentItem(db, TENANT_A, id)).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("refuses an illegal transition (approve from draft)", async () => {
    const id = await newDraft();
    await expect(applyTransition(db, TENANT_A, id, "approve")).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("cannot transition another tenant's item (RLS hides it)", async () => {
    const id = await newDraft();
    await expect(applyTransition(db, TENANT_B, id, "propose")).rejects.toBeInstanceOf(ContentNotFoundError);
  });
});
