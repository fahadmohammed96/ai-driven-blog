import { asc, eq } from "drizzle-orm";
import type { Itinerary, ItineraryStop } from "@blogs/contracts";
import type { Db } from "../../platform/db/client";
import { withTenant, type Tx } from "../../platform/db/tenant";
import { itineraryStops } from "../../platform/db/schema";
// Cross-module composition via the content module's public barrel.
import { insertContentItem, getContentItem, updateContentItem } from "../../modules/content";
import { itineraryToBlocks } from "./itinerary";

type StopRow = typeof itineraryStops.$inferSelect;

async function insertStops(
  tx: Tx,
  tenantId: string,
  contentItemId: string,
  stops: ItineraryStop[],
): Promise<void> {
  await tx.insert(itineraryStops).values(
    stops.map((s, i) => ({
      tenantId,
      contentItemId,
      position: i,
      place: s.place,
      lat: s.geo?.lat ?? null,
      lng: s.geo?.lng ?? null,
      startDate: s.startDate,
      endDate: s.endDate,
      notes: s.notes ?? null,
    })),
  );
}

function rowToStop(r: StopRow): ItineraryStop {
  const stop: ItineraryStop = {
    place: r.place,
    startDate: r.startDate,
    endDate: r.endDate,
  };
  if (r.lat !== null && r.lng !== null) stop.geo = { lat: r.lat, lng: r.lng };
  if (r.notes !== null) stop.notes = r.notes;
  return stop;
}

/**
 * Persist an itinerary: one content_item (type=itinerary, blocks = serialized
 * itinerary) plus its ordered itinerary_stops. Returns the content item id.
 */
export async function saveItinerary(
  db: Db,
  tenantId: string,
  itinerary: Itinerary,
): Promise<string> {
  return withTenant(db, tenantId, async (tx) => {
    const row = await insertContentItem(tx, {
      tenantId,
      type: "itinerary",
      title: itinerary.title,
      blocks: itineraryToBlocks(itinerary),
    });
    await insertStops(tx, tenantId, row.id, itinerary.stops);
    return row.id;
  });
}

/** Reconstruct an itinerary from its content item + stops (RLS-scoped). */
export async function loadItinerary(
  db: Db,
  tenantId: string,
  id: string,
): Promise<Itinerary | null> {
  return withTenant(db, tenantId, async (tx) => {
    const item = await getContentItem(tx, id);
    if (!item || item.type !== "itinerary") return null;
    const stops = await tx
      .select()
      .from(itineraryStops)
      .where(eq(itineraryStops.contentItemId, id))
      .orderBy(asc(itineraryStops.position));
    return { title: item.title, stops: stops.map(rowToStop) };
  });
}

/** Replace an itinerary's title, stops and serialized blocks in place. */
export async function updateItinerary(
  db: Db,
  tenantId: string,
  id: string,
  itinerary: Itinerary,
): Promise<void> {
  await withTenant(db, tenantId, async (tx) => {
    await updateContentItem(tx, id, {
      title: itinerary.title,
      blocks: itineraryToBlocks(itinerary),
    });
    await tx.delete(itineraryStops).where(eq(itineraryStops.contentItemId, id));
    await insertStops(tx, tenantId, id, itinerary.stops);
  });
}
