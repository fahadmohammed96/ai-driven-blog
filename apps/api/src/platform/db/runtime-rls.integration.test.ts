import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createDb, type Db } from "./client";
import { withTenant } from "./tenant";
import { ensureAppRole, isRlsBypassed } from "./bootstrap";
import { DEFAULT_TENANT_SETTINGS } from "@blogs/contracts";
import {
  contentItems,
  itineraryStops,
  mediaAssets,
  itineraryStopPhotos,
  tenantSettings,
} from "./schema";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let adminDb: Db;
let appDb: Db;

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  ({ db: adminDb, pool: adminPool } = createDb(container.getConnectionUri()));

  // Schema as the superuser/admin connection.
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
  await adminPool.query(
    `INSERT INTO tenants (id, slug, name) VALUES ($1,'tenant-a','A'), ($2,'tenant-b','B')`,
    [TENANT_A, TENANT_B],
  );

  // Provision the runtime app role (the function under test), then connect as it.
  await ensureAppRole(adminDb, "app_rw", "app_rw");
  ({ db: appDb, pool: appPool } = createDb(
    `postgresql://app_rw:app_rw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("runtime RLS via the least-privilege app role (DEBT-005)", () => {
  it("connects as a role that does NOT bypass RLS", async () => {
    expect(await isRlsBypassed(appDb)).toBe(false);
  });

  it("enforces tenant isolation at runtime, as the app role", async () => {
    await withTenant(appDb, TENANT_A, (tx) =>
      tx.insert(contentItems).values({ tenantId: TENANT_A, type: "article", title: "A1" }),
    );

    const seenByA = await withTenant(appDb, TENANT_A, (tx) => tx.select().from(contentItems));
    expect(seenByA).toHaveLength(1);

    const seenByB = await withTenant(appDb, TENANT_B, (tx) => tx.select().from(contentItems));
    expect(seenByB).toHaveLength(0);
  });

  it("has sufficient grants to write every app table (full Fase 1 chain)", async () => {
    const linkCount = await withTenant(appDb, TENANT_A, async (tx) => {
      const [ci] = await tx
        .insert(contentItems)
        .values({ tenantId: TENANT_A, type: "itinerary", title: "Grants" })
        .returning();
      const [stop] = await tx
        .insert(itineraryStops)
        .values({
          tenantId: TENANT_A,
          contentItemId: ci!.id,
          position: 0,
          place: "Tokyo",
          startDate: "2026-04-01",
          endDate: "2026-04-02",
        })
        .returning();
      const [asset] = await tx
        .insert(mediaAssets)
        .values({
          id: randomUUID(),
          tenantId: TENANT_A,
          contentItemId: ci!.id,
          storageKey: "k/original.jpg",
          variants: { thumb: "t.jpg", web: "w.jpg" },
        })
        .returning();
      await tx
        .insert(itineraryStopPhotos)
        .values({ tenantId: TENANT_A, stopId: stop!.id, assetId: asset!.id });
      const links = await tx.select().from(itineraryStopPhotos);
      return links.length;
    });
    expect(linkCount).toBeGreaterThan(0);
  });

  // Regression guard: every tenant-scoped table the runtime touches must be in
  // bootstrap's APP_RW_TABLES, or the app role gets "permission denied" at
  // runtime (slice 4: tenant_settings was missing → settings GET 500 in e2e).
  it("can write+read tenant_settings as the app role (grant present)", async () => {
    const stored = await withTenant(appDb, TENANT_A, async (tx) => {
      await tx.insert(tenantSettings).values({
        tenantId: TENANT_A,
        settings: DEFAULT_TENANT_SETTINGS,
      });
      return tx.select().from(tenantSettings);
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.settings.specialistAutonomy.writer).toBe("manual");
  });
});
