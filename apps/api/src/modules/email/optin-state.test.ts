import { describe, it, expect } from "vitest";
import { nextSubscriberStatus, InvalidOptinTransitionError } from "./optin-state";

describe("double opt-in state machine", () => {
  it("confirms a pending subscriber", () => {
    expect(nextSubscriberStatus("pending", "confirm")).toBe("confirmed");
  });

  it("treats confirming an already-confirmed subscriber as idempotent", () => {
    expect(nextSubscriberStatus("confirmed", "confirm")).toBe("confirmed");
  });

  it("unsubscribes a confirmed subscriber", () => {
    expect(nextSubscriberStatus("confirmed", "unsubscribe")).toBe("unsubscribed");
  });

  it("lets an unsubscribed person resubscribe (back to pending — re-confirm needed)", () => {
    expect(nextSubscriberStatus("unsubscribed", "resubscribe")).toBe("pending");
  });

  it("refuses to confirm an unsubscribed subscriber without resubscribing", () => {
    expect(() => nextSubscriberStatus("unsubscribed", "confirm")).toThrow(InvalidOptinTransitionError);
  });

  it("refuses to resubscribe someone who is merely pending", () => {
    expect(() => nextSubscriberStatus("pending", "resubscribe")).toThrow(InvalidOptinTransitionError);
  });
});
