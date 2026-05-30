import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import type { Itinerary } from "@blogs/contracts";
import type { LlmClient } from "../../platform/ai/llm";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { itineraryStops, itineraryStopPhotos } from "../../platform/db/schema";
import { insertMediaAsset } from "../../modules/media";
import { saveItinerary } from "./itinerary.repo";
import { loadItineraryPhotos } from "./itinerary-photos";
import { assembleArticleFromItinerary } from "./article";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT = "11111111-1111-1111-1111-111111111111";

const itinerary: Itinerary = {
  title: "Giappone",
  stops: [
    { place: "Tokyo", geo: { lat: 35.68, lng: 139.69 }, startDate: "2026-04-01", endDate: "2026-04-04", notes: "ramen" },
    { place: "Kyoto", geo: { lat: 35.01, lng: 135.77 }, startDate: "2026-04-05", endDate: "2026-04-07", notes: "templi" },
  ],
};

class FakeLlm implements LlmClient {
  async complete(): Promise<string> {
    return "Ho camminato a lungo e ho assaggiato piatti che ricordo ancora.";
  }
}

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let db: Db;
let itineraryId: string;

async function stopIdByPlace(place: string): Promise<string> {
  return withTenant(db, TENANT, async (tx) => {
    const [row] = await tx
      .select({ id: itineraryStops.id })
      .from(itineraryStops)
      .where(and(eq(itineraryStops.contentItemId, itineraryId), eq(itineraryStops.place, place)));
    return row!.id;
  });
}

async function linkAsset(stopId: string, contentItemId: string): Promise<string> {
  const assetId = randomUUID();
  await withTenant(db, TENANT, async (tx) => {
    await insertMediaAsset(tx, {
      id: assetId,
      tenantId: TENANT,
      contentItemId,
      storageKey: `${TENANT}/${assetId}/original.jpg`,
      variants: { thumb: "t.jpg", web: "w.jpg" },
    });
    await tx.insert(itineraryStopPhotos).values({ tenantId: TENANT, stopId, assetId });
  });
  return assetId;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  adminPool = new Pool({ connectionString: container.getConnectionUri() });
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));

  await adminPool.query(`CREATE ROLE appuser LOGIN PASSWORD 'app_pw' NOSUPERUSER`);
  await adminPool.query(`GRANT USAGE ON SCHEMA public TO appuser`);
  await adminPool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, content_items, itinerary_stops, media_assets, itinerary_stop_photos TO appuser`,
  );
  await adminPool.query(`INSERT INTO tenants (id, slug, name) VALUES ($1,'tenant-a','Tenant A')`, [TENANT]);

  ({ db, pool: appPool } = createDb(
    `postgresql://appuser:app_pw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));

  itineraryId = await saveItinerary(db, TENANT, itinerary);
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("article from a real itinerary + its photos", () => {
  it("loads photos with the right stop index and weaves them into the article", async () => {
    const tokyoAsset = await linkAsset(await stopIdByPlace("Tokyo"), itineraryId);
    const kyotoAsset = await linkAsset(await stopIdByPlace("Kyoto"), itineraryId);

    const photos = await loadItineraryPhotos(db, TENANT, itineraryId);
    expect(photos).toHaveLength(2);
    expect(photos.find((p) => p.assetId === tokyoAsset)?.stopIndex).toBe(0);
    expect(photos.find((p) => p.assetId === kyotoAsset)?.stopIndex).toBe(1);

    const { blocks, authenticity } = await assembleArticleFromItinerary(
      { llm: new FakeLlm() },
      { itinerary, voice: { tone: "caldo", audience: "viaggiatori" }, photos },
    );

    const tokyoH = blocks.findIndex((b) => b.type === "heading" && b.text === "Tokyo");
    const kyotoH = blocks.findIndex((b) => b.type === "heading" && b.text === "Kyoto");
    const tokyoImg = blocks.findIndex((b) => b.type === "image" && b.assetId === tokyoAsset);
    const kyotoImg = blocks.findIndex((b) => b.type === "image" && b.assetId === kyotoAsset);

    expect(tokyoImg).toBeGreaterThan(tokyoH);
    expect(tokyoImg).toBeLessThan(kyotoH);
    expect(kyotoImg).toBeGreaterThan(kyotoH);
    // The first-person fake prose reads as lived -> high authenticity.
    expect(authenticity.score).toBe(1);
  });
});
