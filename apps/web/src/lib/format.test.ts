import { describe, it, expect } from "vitest";
import { slugify } from "./format";

describe("slugify", () => {
  it("lowercases, trims and dashes", () => {
    expect(slugify("  Hello World! ")).toBe("hello-world");
  });

  it("collapses repeated separators", () => {
    expect(slugify("a---b__c")).toBe("a-b-c");
  });
});
