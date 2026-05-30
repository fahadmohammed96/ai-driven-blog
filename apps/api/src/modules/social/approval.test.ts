import { describe, it, expect } from "vitest";
import { nextPostStatus, InvalidPostTransitionError } from "./approval";

describe("channel-post approval (human-in-the-loop gate)", () => {
  it("approves a draft post", () => {
    expect(nextPostStatus("draft", "approve")).toBe("approved");
  });

  it("rejects a draft post", () => {
    expect(nextPostStatus("draft", "reject")).toBe("rejected");
  });

  it("is idempotent on re-approve / re-reject", () => {
    expect(nextPostStatus("approved", "approve")).toBe("approved");
    expect(nextPostStatus("rejected", "reject")).toBe("rejected");
  });

  it("refuses to approve a rejected post (and vice versa)", () => {
    expect(() => nextPostStatus("rejected", "approve")).toThrow(InvalidPostTransitionError);
    expect(() => nextPostStatus("approved", "reject")).toThrow(InvalidPostTransitionError);
  });
});
