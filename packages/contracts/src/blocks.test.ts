import { describe, it, expect } from "vitest";
import { blockSchema, blocksSchema } from "./blocks";

const assetId = "11111111-1111-1111-1111-111111111111";

describe("blockSchema", () => {
  it("accepts a heading with a valid level", () => {
    expect(blockSchema.safeParse({ type: "heading", level: 2, text: "Tokyo" }).success).toBe(true);
  });

  it("rejects a heading with an out-of-range level", () => {
    expect(blockSchema.safeParse({ type: "heading", level: 4, text: "x" }).success).toBe(false);
  });

  it("accepts an image block referencing an asset", () => {
    expect(
      blockSchema.safeParse({ type: "image", assetId, alt: "ramen" }).success,
    ).toBe(true);
  });

  it("rejects an image block with a non-uuid asset", () => {
    expect(blockSchema.safeParse({ type: "image", assetId: "nope", alt: "x" }).success).toBe(false);
  });

  it("rejects an unknown block type", () => {
    expect(blockSchema.safeParse({ type: "video", url: "x" }).success).toBe(false);
  });

  it("validates an ordered list of blocks", () => {
    const ok = blocksSchema.safeParse([
      { type: "heading", level: 1, text: "Giappone" },
      { type: "paragraph", text: "Dieci giorni tra Tokyo e Kyoto." },
      { type: "image", assetId, alt: "ramen", caption: "Il miglior ramen" },
    ]);
    expect(ok.success).toBe(true);
  });
});
