import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import type { Itinerary } from "@blogs/contracts";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { contentItems } from "../../platform/db/schema";
import { saveItinerary, loadItinerary, updateItinerary } from "./itinerary.repo";
import { itineraryToBlocks } from "./itinerary";

const here = dirname(fileURLToPath(import.meta.url));
// src/verticals/travel -> apps/api/drizzle
const migrationsDir = resolve(here, "../../../drizzle");

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

const itinerary: Itinerary = {
  title: "Giappone in 10 giorni",
  stops: [
    {
      place: "Tokyo",
      geo: { lat: 35.68, lng: 139.69 },
      startDate: "2026-04-01",
      endDate: "2026-04-04",
      notes: "Shibuya e il miglior ramen.",
    },
    // No geo, no notes — exercises the optional round-trip.
    { place: "Kyoto", startDate: "2026-04-05", endDate: "2026-04-07" },
  ],
};

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let db: Db;

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  adminPool = new Pool({ connectionString: container.getConnectionUri() });

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
  }

  // RLS only applies to a non-superuser role.
  await adminPool.query(`CREATE ROLE appuser LOGIN PASSWORD 'app_pw' NOSUPERUSER`);
  await adminPool.query(`GRANT USAGE ON SCHEMA public TO appuser`);
  await adminPool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, content_items, itinerary_stops TO appuser`,
  );
  await adminPool.query(
    `INSERT INTO tenants (id, slug, name) VALUES ($1,'tenant-a','Tenant A'), ($2,'tenant-b','Tenant B')`,
    [TENANT_A, TENANT_B],
  );

  const appUri = `postgresql://appuser:app_pw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  const created = createDb(appUri);
  appPool = created.pool;
  db = created.db;
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("itinerary persistence (tenant-scoped)", () => {
  it("creates an itinerary and round-trips it back", async () => {
    const id = await saveItinerary(db, TENANT_A, itinerary);
    const loaded = await loadItinerary(db, TENANT_A, id);
    expect(loaded).toEqual(itinerary);
  });

  it("stores the itinerary serialized as canonical blocks", async () => {
    const id = await saveItinerary(db, TENANT_A, itinerary);
    const blocks = await withTenant(db, TENANT_A, async (tx) => {
      const [row] = await tx
        .select({ blocks: contentItems.blocks })
        .from(contentItems)
        .where(eq(contentItems.id, id));
      return row?.blocks;
    });
    expect(blocks).toEqual(itineraryToBlocks(itinerary));
  });

  it("does not leak an itinerary across tenants (RLS)", async () => {
    const id = await saveItinerary(db, TENANT_A, itinerary);
    expect(await loadItinerary(db, TENANT_B, id)).toBeNull();
  });

  it("reflects an edit (replace stops + reserialize)", async () => {
    const id = await saveItinerary(db, TENANT_A, itinerary);
    const edited: Itinerary = {
      title: "Giappone — rivisto",
      stops: [{ place: "Osaka", startDate: "2026-04-02", endDate: "2026-04-03", notes: "Street food." }],
    };
    await updateItinerary(db, TENANT_A, id, edited);
    expect(await loadItinerary(db, TENANT_A, id)).toEqual(edited);
  });
});
