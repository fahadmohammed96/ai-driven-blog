import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { createDb, type Db } from "../db/client";
import { DbCredentialStore } from "./credentials.repo";
import type { OAuthToken } from "./oauth";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const MASTER = "integration-master-secret";

const TOKEN: OAuthToken = {
  accessToken: "access-secret-123",
  refreshToken: "refresh-secret-456",
  expiresAt: Date.UTC(2030, 0, 1),
};

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let db: Db;
let store: DbCredentialStore;

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  adminPool = new Pool({ connectionString: container.getConnectionUri() });
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
  await adminPool.query(`CREATE ROLE appuser LOGIN PASSWORD 'app_pw' NOSUPERUSER`);
  await adminPool.query(`GRANT USAGE ON SCHEMA public TO appuser`);
  await adminPool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, connector_credentials TO appuser`,
  );
  await adminPool.query(
    `INSERT INTO tenants (id, slug, name) VALUES ($1,'tenant-a','A'), ($2,'tenant-b','B')`,
    [TENANT_A, TENANT_B],
  );
  ({ db, pool: appPool } = createDb(
    `postgresql://appuser:app_pw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));
  store = new DbCredentialStore(db, MASTER);
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("DbCredentialStore (encrypted, RLS-scoped)", () => {
  it("round-trips a token set", async () => {
    await store.save(TENANT_A, "pinterest", TOKEN);
    expect(await store.load(TENANT_A, "pinterest")).toEqual(TOKEN);
  });

  it("stores the tokens sealed, not in plaintext", async () => {
    await store.save(TENANT_A, "pinterest", TOKEN);
    const { rows } = await adminPool.query<{ access_token: string; refresh_token: string }>(
      `SELECT access_token, refresh_token FROM connector_credentials WHERE tenant_id = $1`,
      [TENANT_A],
    );
    expect(rows[0]!.access_token).not.toContain("access-secret-123");
    expect(rows[0]!.refresh_token).not.toContain("refresh-secret-456");
  });

  it("updates in place on re-save (unique per tenant+connector)", async () => {
    await store.save(TENANT_A, "pinterest", TOKEN);
    const updated = { ...TOKEN, accessToken: "rotated-access" };
    await store.save(TENANT_A, "pinterest", updated);
    expect((await store.load(TENANT_A, "pinterest"))?.accessToken).toBe("rotated-access");
  });

  it("isolates tenants via RLS", async () => {
    await store.save(TENANT_A, "pinterest", TOKEN);
    expect(await store.load(TENANT_B, "pinterest")).toBeNull();

    await store.save(TENANT_B, "pinterest", { ...TOKEN, accessToken: "b-access" });
    expect((await store.load(TENANT_B, "pinterest"))?.accessToken).toBe("b-access");
    // A is unchanged by B's write.
    expect((await store.load(TENANT_A, "pinterest"))?.accessToken).toBe(TOKEN.accessToken);
  });
});
