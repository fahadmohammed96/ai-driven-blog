import { eq } from "drizzle-orm";
import type { Tx } from "../../platform/db/tenant";
import { mediaAssets } from "../../platform/db/schema";

export type MediaAssetRow = typeof mediaAssets.$inferSelect;

export interface NewMediaAsset {
  id: string;
  tenantId: string;
  contentItemId: string;
  storageKey: string;
  variants: { thumb: string; web: string };
  takenOn?: string;
  lat?: number;
  lng?: number;
}

export async function insertMediaAsset(tx: Tx, input: NewMediaAsset): Promise<MediaAssetRow> {
  const [row] = await tx
    .insert(mediaAssets)
    .values({
      id: input.id,
      tenantId: input.tenantId,
      contentItemId: input.contentItemId,
      storageKey: input.storageKey,
      variants: input.variants,
      takenOn: input.takenOn ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
    })
    .returning();
  return row as MediaAssetRow;
}

export async function getMediaAsset(tx: Tx, id: string): Promise<MediaAssetRow | null> {
  const rows = await tx.select().from(mediaAssets).where(eq(mediaAssets.id, id));
  return rows[0] ?? null;
}
