import { describe, it, expect } from "vitest";
import { healthStatus } from "./health";

describe("healthStatus", () => {
  it("returns ok with the given timestamp in ISO form", () => {
    const res = healthStatus(new Date("2026-01-01T00:00:00.000Z"));
    expect(res.status).toBe("ok");
    expect(res.ts).toBe("2026-01-01T00:00:00.000Z");
  });
});
