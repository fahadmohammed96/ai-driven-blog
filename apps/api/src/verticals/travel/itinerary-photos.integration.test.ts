import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import type { Itinerary } from "@blogs/contracts";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { itineraryStops, mediaAssets, itineraryStopPhotos } from "../../platform/db/schema";
import { S3Storage } from "../../modules/media";
import { getMediaAsset } from "../../modules/media";
import { saveItinerary } from "./itinerary.repo";
import { attachPhotoToItinerary } from "./itinerary-photos";
import { makeJpegWithExif, makePlainJpeg } from "../../modules/media/photo.fixtures";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const BUCKET = "media";

const itinerary: Itinerary = {
  title: "Giappone",
  stops: [
    { place: "Tokyo", geo: { lat: 35.68, lng: 139.69 }, startDate: "2026-04-01", endDate: "2026-04-04" },
    { place: "Kyoto", geo: { lat: 35.01, lng: 135.77 }, startDate: "2026-04-05", endDate: "2026-04-07" },
  ],
};

let pg: StartedPostgreSqlContainer;
let minio: StartedTestContainer;
let adminPool: Pool;
let appPool: Pool;
let db: Db;
let storage: S3Storage;
let itineraryId: string;

async function stopIdByPlace(place: string): Promise<string> {
  return withTenant(db, TENANT_A, async (tx) => {
    const [row] = await tx
      .select({ id: itineraryStops.id })
      .from(itineraryStops)
      .where(and(eq(itineraryStops.contentItemId, itineraryId), eq(itineraryStops.place, place)));
    return row!.id;
  });
}

beforeAll(async () => {
  [pg, minio] = await Promise.all([
    new PostgreSqlContainer("pgvector/pgvector:pg16").start(),
    new GenericContainer("minio/minio")
      .withExposedPorts(9000)
      .withEnvironment({ MINIO_ROOT_USER: "minio", MINIO_ROOT_PASSWORD: "minio12345" })
      .withCommand(["server", "/data"])
      .withWaitStrategy(Wait.forHttp("/minio/health/ready", 9000))
      .start(),
  ]);

  adminPool = new Pool({ connectionString: pg.getConnectionUri() });
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));

  await adminPool.query(`CREATE ROLE appuser LOGIN PASSWORD 'app_pw' NOSUPERUSER`);
  await adminPool.query(`GRANT USAGE ON SCHEMA public TO appuser`);
  await adminPool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, content_items, itinerary_stops, media_assets, itinerary_stop_photos TO appuser`,
  );
  await adminPool.query(
    `INSERT INTO tenants (id, slug, name) VALUES ($1,'tenant-a','Tenant A'), ($2,'tenant-b','Tenant B')`,
    [TENANT_A, TENANT_B],
  );

  const appUri = `postgresql://appuser:app_pw@${pg.getHost()}:${pg.getPort()}/${pg.getDatabase()}`;
  ({ db, pool: appPool } = createDb(appUri));

  const endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
  const s3 = new S3Client({
    endpoint,
    region: "us-east-1",
    credentials: { accessKeyId: "minio", secretAccessKey: "minio12345" },
    forcePathStyle: true,
  });
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  storage = new S3Storage({
    endpoint,
    region: "us-east-1",
    accessKeyId: "minio",
    secretAccessKey: "minio12345",
    bucket: BUCKET,
    forcePathStyle: true,
  });

  itineraryId = await saveItinerary(db, TENANT_A, itinerary);
}, 240_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await Promise.all([pg?.stop(), minio?.stop()]);
});

describe("photo auto-organization (place/date)", () => {
  it("organizes a 06-Apr photo near Kyoto into the Kyoto stop, with variants stored", async () => {
    const photo = await makeJpegWithExif({ takenOn: "2026-04-06", geo: { lat: 35.02, lng: 135.78 } });
    const { assetId, stopId } = await attachPhotoToItinerary({ db, storage }, {
      tenantId: TENANT_A,
      itineraryId,
      buffer: photo,
    });

    expect(stopId).toBe(await stopIdByPlace("Kyoto"));

    const asset = await withTenant(db, TENANT_A, (tx) => getMediaAsset(tx, assetId));
    expect(asset?.takenOn).toBe("2026-04-06");
    expect(asset?.lat).toBeCloseTo(35.02, 2);
    expect(asset?.variants.thumb).toContain("thumb.jpg");

    // Every rendition is really in object storage.
    for (const key of [asset!.storageKey, asset!.variants.thumb, asset!.variants.web]) {
      expect((await storage.get(key)).byteLength).toBeGreaterThan(0);
    }
  });

  it("organizes a 02-Apr photo into the Tokyo stop", async () => {
    const photo = await makeJpegWithExif({ takenOn: "2026-04-02", geo: { lat: 35.67, lng: 139.7 } });
    const { stopId } = await attachPhotoToItinerary({ db, storage }, { tenantId: TENANT_A, itineraryId, buffer: photo });
    expect(stopId).toBe(await stopIdByPlace("Tokyo"));
  });

  it("stores a photo without EXIF but leaves it unorganized", async () => {
    const { assetId, stopId } = await attachPhotoToItinerary({ db, storage }, {
      tenantId: TENANT_A,
      itineraryId,
      buffer: await makePlainJpeg(),
    });
    expect(stopId).toBeNull();
    const asset = await withTenant(db, TENANT_A, (tx) => getMediaAsset(tx, assetId));
    expect(asset?.takenOn).toBeNull();
    expect(asset?.lat).toBeNull();
  });

  it("does not leak assets or links across tenants (RLS)", async () => {
    const photo = await makeJpegWithExif({ takenOn: "2026-04-06", geo: { lat: 35.02, lng: 135.78 } });
    const { assetId } = await attachPhotoToItinerary({ db, storage }, { tenantId: TENANT_A, itineraryId, buffer: photo });

    const fromB = await withTenant(db, TENANT_B, (tx) => getMediaAsset(tx, assetId));
    expect(fromB).toBeNull();

    const linksFromB = await withTenant(db, TENANT_B, (tx) =>
      tx.select().from(itineraryStopPhotos).where(eq(itineraryStopPhotos.assetId, assetId)),
    );
    expect(linksFromB).toHaveLength(0);

    const assetsFromB = await withTenant(db, TENANT_B, (tx) => tx.select().from(mediaAssets));
    expect(assetsFromB).toHaveLength(0);
  });
});
