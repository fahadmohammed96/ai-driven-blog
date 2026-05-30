import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { makeVariants, THUMB_WIDTH, WEB_WIDTH } from "./variants";
import { makePlainJpeg } from "./photo.fixtures";

describe("makeVariants", () => {
  it("downscales a large photo into thumb + web JPEGs", async () => {
    const source = await makePlainJpeg(2400, 1600);
    const { thumb, web } = await makeVariants(source);

    const thumbMeta = await sharp(thumb).metadata();
    const webMeta = await sharp(web).metadata();

    expect(thumbMeta.format).toBe("jpeg");
    expect(thumbMeta.width).toBe(THUMB_WIDTH);
    expect(webMeta.width).toBe(WEB_WIDTH);
    // Smaller render is meaningfully smaller on disk.
    expect(thumb.byteLength).toBeLessThan(web.byteLength);
  });

  it("does not upscale a photo smaller than the target widths", async () => {
    const small = await makePlainJpeg(200, 150);
    const { thumb, web } = await makeVariants(small);
    expect((await sharp(thumb).metadata()).width).toBe(200);
    expect((await sharp(web).metadata()).width).toBe(200);
  });
});
