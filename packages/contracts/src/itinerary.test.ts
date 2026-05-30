import { describe, it, expect } from "vitest";
import { itinerarySchema, itineraryStopSchema } from "./itinerary";

const stop = {
  place: "Tokyo",
  geo: { lat: 35.68, lng: 139.69 },
  startDate: "2026-04-01",
  endDate: "2026-04-04",
  notes: "Shibuya, ramen, templi",
};

describe("itineraryStopSchema", () => {
  it("accepts a well-formed stop", () => {
    expect(itineraryStopSchema.safeParse(stop).success).toBe(true);
  });

  it("rejects a reversed date span", () => {
    expect(
      itineraryStopSchema.safeParse({ ...stop, startDate: "2026-04-04", endDate: "2026-04-01" })
        .success,
    ).toBe(false);
  });

  it("rejects a malformed date", () => {
    expect(itineraryStopSchema.safeParse({ ...stop, startDate: "01/04/2026" }).success).toBe(false);
  });

  it("rejects an out-of-range latitude", () => {
    expect(
      itineraryStopSchema.safeParse({ ...stop, geo: { lat: 200, lng: 0 } }).success,
    ).toBe(false);
  });
});

describe("itinerarySchema", () => {
  it("accepts an itinerary with at least one stop", () => {
    expect(itinerarySchema.safeParse({ title: "Giappone", stops: [stop] }).success).toBe(true);
  });

  it("rejects an itinerary with no stops", () => {
    expect(itinerarySchema.safeParse({ title: "Vuoto", stops: [] }).success).toBe(false);
  });
});
