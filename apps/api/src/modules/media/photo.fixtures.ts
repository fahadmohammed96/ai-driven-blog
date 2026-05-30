import sharp from "sharp";

/** Test-only helpers that synthesize JPEGs (with/without EXIF) in memory. */

/** Decimal degrees -> EXIF rational "deg/1 min/1 secHundredths/100". */
function toDms(decimal: number): string {
  const abs = Math.abs(decimal);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const secHundredths = Math.round((minFloat - min) * 60 * 100);
  return `${deg}/1 ${min}/1 ${secHundredths}/100`;
}

export interface ExifFixture {
  takenOn?: string; // YYYY-MM-DD
  geo?: { lat: number; lng: number };
  width?: number;
  height?: number;
}

export async function makeJpegWithExif(f: ExifFixture): Promise<Buffer> {
  const exif: Record<string, Record<string, string>> = {
    IFD0: { ImageDescription: "fixture" },
  };
  if (f.takenOn) {
    exif.IFD2 = { DateTimeOriginal: `${f.takenOn.replace(/-/g, ":")} 10:30:00` };
  }
  if (f.geo) {
    exif.IFD3 = {
      GPSLatitudeRef: f.geo.lat >= 0 ? "N" : "S",
      GPSLatitude: toDms(f.geo.lat),
      GPSLongitudeRef: f.geo.lng >= 0 ? "E" : "W",
      GPSLongitude: toDms(f.geo.lng),
    };
  }
  return sharp({
    create: {
      width: f.width ?? 1600,
      height: f.height ?? 1200,
      channels: 3,
      background: { r: 30, g: 90, b: 160 },
    },
  })
    .jpeg()
    .withExif(exif)
    .toBuffer();
}

/** A plain JPEG with no EXIF metadata at all. */
export async function makePlainJpeg(width = 1600, height = 1200): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 60, b: 60 } },
  })
    .jpeg()
    .toBuffer();
}
