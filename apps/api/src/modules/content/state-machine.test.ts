import { describe, it, expect } from "vitest";
import type { PublicationStatus } from "@blogs/contracts";
import { nextStatus, InvalidTransitionError } from "./state-machine";

describe("publication state machine", () => {
  it("walks the full happy path draft → published", () => {
    let s: PublicationStatus = "draft";
    s = nextStatus(s, "propose");
    expect(s).toBe("proposed");
    s = nextStatus(s, "startReview");
    expect(s).toBe("review");
    s = nextStatus(s, "approve");
    expect(s).toBe("approved");
    s = nextStatus(s, "publish");
    expect(s).toBe("published");
  });

  it("treats publish as idempotent once published", () => {
    expect(nextStatus("published", "publish")).toBe("published");
  });

  it("sends an item back to draft on requestChanges", () => {
    expect(nextStatus("review", "requestChanges")).toBe("draft");
    expect(nextStatus("approved", "requestChanges")).toBe("draft");
  });

  it("rejects publishing before approval", () => {
    for (const s of ["draft", "proposed", "review"] as const) {
      expect(() => nextStatus(s, "publish")).toThrow(InvalidTransitionError);
    }
  });

  it("rejects reviving a published item", () => {
    expect(() => nextStatus("published", "propose")).toThrow(InvalidTransitionError);
    expect(() => nextStatus("draft", "approve")).toThrow(InvalidTransitionError);
  });
});
