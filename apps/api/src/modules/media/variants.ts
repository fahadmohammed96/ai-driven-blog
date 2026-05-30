import sharp from "sharp";

export interface PhotoVariants {
  /** ~320px-wide preview. */
  thumb: Buffer;
  /** ~1024px-wide in-article render. */
  web: Buffer;
}

export const THUMB_WIDTH = 320;
export const WEB_WIDTH = 1024;

/** Produce downscaled JPEG variants (never upscales beyond the source width). */
export async function makeVariants(buffer: Buffer): Promise<PhotoVariants> {
  const [thumb, web] = await Promise.all([
    sharp(buffer).resize({ width: THUMB_WIDTH, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer(),
    sharp(buffer).resize({ width: WEB_WIDTH, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer(),
  ]);
  return { thumb, web };
}
