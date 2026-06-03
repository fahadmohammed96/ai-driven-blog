import { describe, it, expect } from "vitest";
import {
  ACTIVE_BOOKING_STATUSES,
  InvalidBookingTransitionError,
  nextBookingStatus,
} from "./booking-state";

describe("booking state machine", () => {
  it("runs the deposit path: reserved → deposit_pending → confirmed", () => {
    expect(nextBookingStatus("reserved", "requestDeposit")).toBe("deposit_pending");
    expect(nextBookingStatus("deposit_pending", "confirmPayment")).toBe("confirmed");
  });

  it("promotes a waitlisted booking to reserved", () => {
    expect(nextBookingStatus("waitlisted", "promote")).toBe("reserved");
  });

  it("allows cancelling from any non-terminal state", () => {
    expect(nextBookingStatus("reserved", "cancel")).toBe("cancelled");
    expect(nextBookingStatus("deposit_pending", "cancel")).toBe("cancelled");
    expect(nextBookingStatus("waitlisted", "cancel")).toBe("cancelled");
  });

  it("rejects illegal transitions", () => {
    // Can't confirm a payment that was never requested.
    expect(() => nextBookingStatus("reserved", "confirmPayment")).toThrow(InvalidBookingTransitionError);
    // Can't take a deposit on a waitlisted seat (it isn't reserved yet).
    expect(() => nextBookingStatus("waitlisted", "requestDeposit")).toThrow(InvalidBookingTransitionError);
    // Terminal states have no transitions.
    expect(() => nextBookingStatus("confirmed", "cancel")).toThrow(InvalidBookingTransitionError);
    expect(() => nextBookingStatus("cancelled", "promote")).toThrow(InvalidBookingTransitionError);
  });

  it("counts only seat-occupying statuses against capacity (waitlisted/cancelled free)", () => {
    expect(ACTIVE_BOOKING_STATUSES).toContain("reserved");
    expect(ACTIVE_BOOKING_STATUSES).toContain("deposit_pending");
    expect(ACTIVE_BOOKING_STATUSES).toContain("confirmed");
    expect(ACTIVE_BOOKING_STATUSES).not.toContain("waitlisted");
    expect(ACTIVE_BOOKING_STATUSES).not.toContain("cancelled");
  });
});
