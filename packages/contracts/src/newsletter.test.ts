import { describe, it, expect } from "vitest";
import { subscribeRequestSchema, themeSchema, subscriberStatusSchema } from "./newsletter";

describe("newsletter contracts", () => {
  it("enumerates the double opt-in lifecycle states", () => {
    expect(subscriberStatusSchema.options).toEqual(["pending", "confirmed", "unsubscribed"]);
  });

  it("rejects a subscribe request without a valid email", () => {
    expect(subscribeRequestSchema.safeParse({ email: "nope", themes: ["party"] }).success).toBe(false);
  });

  it("requires at least one theme", () => {
    expect(subscribeRequestSchema.safeParse({ email: "a@b.com", themes: [] }).success).toBe(false);
  });

  it("rejects a non-slug theme", () => {
    expect(themeSchema.safeParse("Party Night").success).toBe(false);
    expect(themeSchema.safeParse("party").success).toBe(true);
  });
});
