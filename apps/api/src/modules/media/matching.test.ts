import { describe, it, expect } from "vitest";
import { matchPhotoToSegment, haversineKm, type DatedPlace } from "./matching";

const tokyo = { lat: 35.68, lng: 139.69 };
const kyoto = { lat: 35.01, lng: 135.77 };

const stops: DatedPlace[] = [
  { startDate: "2026-04-01", endDate: "2026-04-04", geo: tokyo },
  { startDate: "2026-04-05", endDate: "2026-04-07", geo: kyoto },
];

describe("haversineKm", () => {
  it("measures the Tokyo–Kyoto distance (~365 km)", () => {
    const d = haversineKm(tokyo, kyoto);
    expect(d).toBeGreaterThan(350);
    expect(d).toBeLessThan(380);
  });
});

describe("matchPhotoToSegment", () => {
  it("organizes by date when the photo's day falls in one stop's span", () => {
    expect(matchPhotoToSegment({ takenOn: "2026-04-06" }, stops)).toBe(1);
    expect(matchPhotoToSegment({ takenOn: "2026-04-02" }, stops)).toBe(0);
  });

  it("treats the date span as inclusive at both ends", () => {
    expect(matchPhotoToSegment({ takenOn: "2026-04-04" }, stops)).toBe(0);
    expect(matchPhotoToSegment({ takenOn: "2026-04-05" }, stops)).toBe(1);
  });

  it("breaks date overlaps by nearest place (geo)", () => {
    const overlapping: DatedPlace[] = [
      { startDate: "2026-04-01", endDate: "2026-04-10", geo: tokyo }, // base
      { startDate: "2026-04-06", endDate: "2026-04-06", geo: kyoto }, // day trip
    ];
    expect(matchPhotoToSegment({ takenOn: "2026-04-06", geo: { lat: 35.02, lng: 135.78 } }, overlapping)).toBe(1);
    expect(matchPhotoToSegment({ takenOn: "2026-04-06", geo: { lat: 35.67, lng: 139.7 } }, overlapping)).toBe(0);
  });

  it("falls back to nearest place when no date matches", () => {
    expect(matchPhotoToSegment({ takenOn: "2026-05-01", geo: { lat: 35.02, lng: 135.78 } }, stops)).toBe(1);
    expect(matchPhotoToSegment({ geo: { lat: 35.67, lng: 139.7 } }, stops)).toBe(0);
  });

  it("returns null when the photo has neither a matching date nor any geo", () => {
    expect(matchPhotoToSegment({}, stops)).toBeNull();
    expect(matchPhotoToSegment({ takenOn: "2026-05-01" }, stops)).toBeNull();
  });

  it("picks the earliest-starting span when dates overlap and there is no photo geo", () => {
    const overlapping: DatedPlace[] = [
      { startDate: "2026-04-01", endDate: "2026-04-10", geo: tokyo },
      { startDate: "2026-04-06", endDate: "2026-04-06", geo: kyoto },
    ];
    expect(matchPhotoToSegment({ takenOn: "2026-04-06" }, overlapping)).toBe(0);
  });
});
