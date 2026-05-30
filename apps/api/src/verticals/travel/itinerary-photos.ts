import { asc, eq } from "drizzle-orm";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { itineraryStops, itineraryStopPhotos } from "../../platform/db/schema";
// Compose the Media-DAM via its public barrel.
import { ingestPhoto, matchPhotoToSegment, type MediaDeps, type DatedPlace } from "../../modules/media";
import type { ArticlePhoto } from "./article";

export interface AttachPhotoInput {
  tenantId: string;
  itineraryId: string;
  buffer: Buffer;
}

export interface AttachPhotoResult {
  assetId: string;
  /** The stop the photo was auto-organized into, or null if it couldn't be placed. */
  stopId: string | null;
}

/**
 * Attach a photo to an itinerary and auto-organize it by place/date: ingest it
 * through the DAM, then match its EXIF (date/geo) against the itinerary's stops
 * and record the link.
 */
export async function attachPhotoToItinerary(
  deps: MediaDeps,
  input: AttachPhotoInput,
): Promise<AttachPhotoResult> {
  const ingest = await ingestPhoto(deps, {
    tenantId: input.tenantId,
    contentItemId: input.itineraryId,
    buffer: input.buffer,
  });

  return withTenant(deps.db, input.tenantId, async (tx) => {
    const stops = await tx
      .select()
      .from(itineraryStops)
      .where(eq(itineraryStops.contentItemId, input.itineraryId))
      .orderBy(asc(itineraryStops.position));

    const segments: DatedPlace[] = stops.map((s) => ({
      startDate: s.startDate,
      endDate: s.endDate,
      ...(s.lat !== null && s.lng !== null ? { geo: { lat: s.lat, lng: s.lng } } : {}),
    }));

    const idx = matchPhotoToSegment(ingest.meta, segments);
    if (idx === null) return { assetId: ingest.id, stopId: null };

    const stopId = stops[idx]!.id;
    await tx
      .insert(itineraryStopPhotos)
      .values({ tenantId: input.tenantId, stopId, assetId: ingest.id });
    return { assetId: ingest.id, stopId };
  });
}

/**
 * Load an itinerary's organized photos as article inputs: each linked asset
 * paired with the index of the stop it belongs to (the order articles render in).
 */
export async function loadItineraryPhotos(
  db: Db,
  tenantId: string,
  itineraryId: string,
): Promise<ArticlePhoto[]> {
  return withTenant(db, tenantId, async (tx) => {
    const stops = await tx
      .select({ id: itineraryStops.id })
      .from(itineraryStops)
      .where(eq(itineraryStops.contentItemId, itineraryId))
      .orderBy(asc(itineraryStops.position));
    const indexByStop = new Map(stops.map((s, i) => [s.id, i]));

    const links = await tx
      .select({ assetId: itineraryStopPhotos.assetId, stopId: itineraryStopPhotos.stopId })
      .from(itineraryStopPhotos)
      .innerJoin(itineraryStops, eq(itineraryStopPhotos.stopId, itineraryStops.id))
      .where(eq(itineraryStops.contentItemId, itineraryId));

    return links.flatMap((l) => {
      const stopIndex = indexByStop.get(l.stopId);
      return stopIndex === undefined ? [] : [{ assetId: l.assetId, stopIndex }];
    });
  });
}
