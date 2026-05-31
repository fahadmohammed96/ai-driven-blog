import { describe, it, expect } from "vitest";
import {
  affiliateCodeSchema,
  createAffiliateLinkSchema,
  updateAffiliateLinkSchema,
} from "./affiliate";

describe("affiliate contracts", () => {
  it("accepts URL-safe lowercase codes and rejects others", () => {
    expect(affiliateCodeSchema.safeParse("hotel-tokyo-2026").success).toBe(true);
    expect(affiliateCodeSchema.safeParse("Bad Code").success).toBe(false);
    expect(affiliateCodeSchema.safeParse("UPPER").success).toBe(false);
    expect(affiliateCodeSchema.safeParse("").success).toBe(false);
  });

  it("validates a create payload: code + a real URL are required, associations optional", () => {
    expect(
      createAffiliateLinkSchema.safeParse({ code: "go-a", targetUrl: "https://example.com/a" }).success,
    ).toBe(true);
    expect(
      createAffiliateLinkSchema.safeParse({
        code: "go-b",
        targetUrl: "https://example.com/b",
        contentItemId: "11111111-1111-1111-1111-111111111111",
        channel: "blog",
        label: "Partner B",
      }).success,
    ).toBe(true);

    // A non-URL target is rejected.
    expect(createAffiliateLinkSchema.safeParse({ code: "go-c", targetUrl: "not-a-url" }).success).toBe(false);
    // A non-uuid article id is rejected.
    expect(
      createAffiliateLinkSchema.safeParse({
        code: "go-d",
        targetUrl: "https://example.com/d",
        contentItemId: "nope",
      }).success,
    ).toBe(false);
  });

  it("allows an update to clear an association with null but keeps code out of the shape", () => {
    const parsed = updateAffiliateLinkSchema.safeParse({
      targetUrl: "https://example.com/new",
      contentItemId: null,
      channel: null,
      label: null,
    });
    expect(parsed.success).toBe(true);
    // `code` is not an editable field — it is silently dropped, not honored.
    const withCode = updateAffiliateLinkSchema.parse({ code: "ignored", targetUrl: "https://example.com/z" });
    expect("code" in withCode).toBe(false);
  });
});
