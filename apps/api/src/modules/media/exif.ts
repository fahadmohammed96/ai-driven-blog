import exifr from "exifr";
import type { PhotoMeta } from "./matching";

/** Normalize an EXIF DateTimeOriginal (Date or "YYYY:MM:DD …" string) to YYYY-MM-DD. */
function toIsoDate(value: unknown): string | undefined {
  if (typeof value === "string") {
    const d = value.slice(0, 10).replace(/:/g, "-");
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // exifr builds the Date from the EXIF local-time components, so the local
    // getters recover the exact calendar day (no timezone drift).
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return undefined;
}

/**
 * Extract the bits we organize photos by: the day it was taken (EXIF
 * DateTimeOriginal) and where (EXIF GPS). Missing/absent EXIF yields an empty
 * meta — the photo simply can't be auto-organized.
 */
export async function extractPhotoMeta(buffer: Buffer): Promise<PhotoMeta> {
  const meta: PhotoMeta = {};
  const parsed = await exifr
    .parse(buffer, { tiff: true, exif: true, gps: true })
    .catch(() => null);
  if (!parsed) return meta;

  const takenOn = toIsoDate(parsed.DateTimeOriginal);
  if (takenOn) meta.takenOn = takenOn;

  if (typeof parsed.latitude === "number" && typeof parsed.longitude === "number") {
    meta.geo = { lat: parsed.latitude, lng: parsed.longitude };
  }
  return meta;
}
