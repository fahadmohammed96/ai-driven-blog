import { describe, it, expect } from "vitest";
import { publicationStatusSchema, PUBLICATION_STATUSES } from "./publication";

describe("publicationStatusSchema", () => {
  it("accepts the five lifecycle states", () => {
    for (const s of ["draft", "proposed", "review", "approved", "published"]) {
      expect(publicationStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects an unknown state", () => {
    expect(publicationStatusSchema.safeParse("archived").success).toBe(false);
  });

  it("exposes the states in lifecycle order", () => {
    expect(PUBLICATION_STATUSES).toEqual(["draft", "proposed", "review", "approved", "published"]);
  });
});
