import type { GeoPoint } from "@blogs/contracts";

/** Minimal photo metadata used to auto-organize it. */
export interface PhotoMeta {
  /** Calendar date the photo was taken (YYYY-MM-DD), from EXIF. */
  takenOn?: string;
  geo?: GeoPoint;
}

/** A target segment to organize a photo into (e.g. an itinerary stop). */
export interface DatedPlace {
  startDate: string;
  endDate: string;
  geo?: GeoPoint;
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km between two points (haversine). */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Auto-organize a photo by **place and date**: pick the index of the segment
 * that best fits, or null if it cannot be placed.
 *
 * Date is primary (the photo's day falls within a segment's span); geo breaks
 * ties between date-overlapping segments and is the fallback when no date matches.
 * A photo with neither a usable date nor geo cannot be organized → null.
 */
function nearestAmong(g: GeoPoint, segments: DatedPlace[], idxs: number[]): number {
  let best = idxs[0]!;
  let bestKm = Infinity;
  for (const i of idxs) {
    const sg = segments[i]!.geo;
    if (!sg) continue;
    const km = haversineKm(g, sg);
    if (km < bestKm) {
      bestKm = km;
      best = i;
    }
  }
  return best;
}

export function matchPhotoToSegment(photo: PhotoMeta, segments: DatedPlace[]): number | null {
  if (segments.length === 0) return null;

  // 1) Date: segments whose span contains the photo's day (inclusive).
  const dateMatches: number[] = [];
  if (photo.takenOn) {
    const day = photo.takenOn;
    segments.forEach((s, i) => {
      if (s.startDate <= day && day <= s.endDate) dateMatches.push(i);
    });
  }
  if (dateMatches.length === 1) return dateMatches[0]!;
  if (dateMatches.length > 1) {
    // Tie among overlapping spans: nearest place, else earliest-starting.
    if (photo.geo) return nearestAmong(photo.geo, segments, dateMatches);
    return dateMatches.reduce(
      (best, i) => (segments[i]!.startDate < segments[best]!.startDate ? i : best),
      dateMatches[0]!,
    );
  }

  // 2) No date match: fall back to the nearest place that has geo.
  if (photo.geo) {
    const geoSegments = segments.map((_, i) => i).filter((i) => segments[i]!.geo);
    if (geoSegments.length > 0) return nearestAmong(photo.geo, segments, geoSegments);
  }

  // 3) Cannot be organized.
  return null;
}
