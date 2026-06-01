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
import { DbCredentialStore } from "../integration";
import { ProviderRegistry, LLM_ANTHROPIC_CONNECTOR } from "./provider-registry";
import { StubLlmAdapter } from "./llm";

/**
 * Runtime RLS + decryption test for the BYOK provider path. Connects as the
 * least-privilege `app_rw`-style role (NOSUPERUSER) — the same shape as the
 * existing `credentials.integration.test.ts` — so a missing grant or RLS policy
 * surfaces here, not only in e2e. `llm_anthropic` reuses the encrypted
 * `connector_credentials` table (no new table, no migration): the API key rides
 * in the `accessToken` slot, sealed AES-256-GCM, isolated per tenant by RLS.
 */

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const MASTER = "integration-master-secret";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let db: Db;
let store: DbCredentialStore;

async function seedTenantKey(tenantId: string, key: string) {
  await store.save(tenantId, LLM_ANTHROPIC_CONNECTOR, {
    accessToken: key,
    // An LLM API key has no OAuth refresh/expiry; a non-empty placeholder keeps
    // the reused envelope sealable (empty → empty ciphertext → malformed). DEBT-023.
    refreshToken: "byok-no-refresh",
    expiresAt: 0,
  });
}

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

describe("ProviderRegistry over connector_credentials (encrypted, RLS-scoped)", () => {
  it("decrypts the tenant's stored llm_anthropic key and builds the per-tenant port", async () => {
    await seedTenantKey(TENANT_A, "sk-tenant-a-real");

    const seenKeys: string[] = [];
    const registry = new ProviderRegistry({
      store,
      anthropicFactory: (apiKey) => {
        seenKeys.push(apiKey);
        return new StubLlmAdapter();
      },
      platformFactory: () => {
        throw new Error("platform key must not be used when a tenant key exists");
      },
    });

    const port = await registry.getClient(TENANT_A);

    expect(seenKeys).toEqual(["sk-tenant-a-real"]);
    expect(typeof port.complete).toBe("function");
  });

  it("stores the key sealed, not in plaintext", async () => {
    await seedTenantKey(TENANT_A, "sk-plaintext-probe");
    const { rows } = await adminPool.query<{ access_token: string }>(
      `SELECT access_token FROM connector_credentials WHERE tenant_id = $1 AND connector = $2`,
      [TENANT_A, LLM_ANTHROPIC_CONNECTOR],
    );
    expect(rows[0]!.access_token).not.toContain("sk-plaintext-probe");
  });

  it("does NOT read another tenant's llm_anthropic key (RLS) → platform fallback", async () => {
    await seedTenantKey(TENANT_A, "sk-tenant-a-secret");

    // A's key is invisible to B at the store level.
    expect(await store.load(TENANT_B, LLM_ANTHROPIC_CONNECTOR)).toBeNull();

    const platform = new StubLlmAdapter();
    const registry = new ProviderRegistry({
      store,
      anthropicFactory: () => {
        throw new Error("must not build a tenant adapter for B (no credential)");
      },
      platformFactory: () => platform,
    });

    // B has no credential of its own → platform key, never A's.
    expect(await registry.getClient(TENANT_B)).toBe(platform);
  });
});
