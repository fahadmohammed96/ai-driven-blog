import { randomUUID } from "node:crypto";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import type { StoragePort } from "./storage";
import { extractPhotoMeta } from "./exif";
import { makeVariants } from "./variants";
import { insertMediaAsset } from "./media.repo";
import type { PhotoMeta } from "./matching";

export interface MediaDeps {
  db: Db;
  storage: StoragePort;
}

export interface IngestPhotoInput {
  tenantId: string;
  /** The content item (article/itinerary) this photo belongs to. */
  contentItemId: string;
  buffer: Buffer;
}

export interface IngestResult {
  id: string;
  meta: PhotoMeta;
  storageKey: string;
}

/**
 * Ingest one photo: read EXIF (date/geo), derive variants (sharp), upload all
 * renditions to storage, and persist a tenant-scoped media asset. Returns the
 * asset id and extracted meta so callers can auto-organize it.
 */
export async function ingestPhoto(deps: MediaDeps, input: IngestPhotoInput): Promise<IngestResult> {
  const id = randomUUID();
  const [meta, variants] = await Promise.all([
    extractPhotoMeta(input.buffer),
    makeVariants(input.buffer),
  ]);

  const base = `${input.tenantId}/${id}`;
  const storageKey = `${base}/original.jpg`;
  const thumbKey = `${base}/thumb.jpg`;
  const webKey = `${base}/web.jpg`;

  await Promise.all([
    deps.storage.put(storageKey, input.buffer, "image/jpeg"),
    deps.storage.put(thumbKey, variants.thumb, "image/jpeg"),
    deps.storage.put(webKey, variants.web, "image/jpeg"),
  ]);

  await withTenant(deps.db, input.tenantId, (tx) =>
    insertMediaAsset(tx, {
      id,
      tenantId: input.tenantId,
      contentItemId: input.contentItemId,
      storageKey,
      variants: { thumb: thumbKey, web: webKey },
      takenOn: meta.takenOn,
      lat: meta.geo?.lat,
      lng: meta.geo?.lng,
    }),
  );

  return { id, meta, storageKey };
}
