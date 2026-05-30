import { describe, it, expect } from "vitest";
import { extractPhotoMeta } from "./exif";
import { makeJpegWithExif, makePlainJpeg } from "./photo.fixtures";

describe("extractPhotoMeta", () => {
  it("reads the capture date and GPS from a real JPEG", async () => {
    const jpeg = await makeJpegWithExif({
      takenOn: "2026-04-06",
      geo: { lat: 35.0116, lng: 135.7681 },
    });
    const meta = await extractPhotoMeta(jpeg);
    expect(meta.takenOn).toBe("2026-04-06");
    expect(meta.geo?.lat).toBeCloseTo(35.0116, 3);
    expect(meta.geo?.lng).toBeCloseTo(135.7681, 3);
  });

  it("reads the date when GPS is absent", async () => {
    const jpeg = await makeJpegWithExif({ takenOn: "2026-04-06" });
    const meta = await extractPhotoMeta(jpeg);
    expect(meta.takenOn).toBe("2026-04-06");
    expect(meta.geo).toBeUndefined();
  });

  it("returns an empty meta for a JPEG without EXIF", async () => {
    const meta = await extractPhotoMeta(await makePlainJpeg());
    expect(meta).toEqual({});
  });
});
