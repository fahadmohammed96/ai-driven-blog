import type { BookingStatus } from "@blogs/contracts";

/**
 * Events that drive the booking lifecycle. Note that the *initial* status of a
 * new booking (reserved vs waitlisted) is decided by seat availability in the
 * service, not by this machine — this machine governs transitions of an existing
 * booking.
 */
export type BookingEvent = "requestDeposit" | "confirmPayment" | "cancel" | "promote";

export class InvalidBookingTransitionError extends Error {
  constructor(
    public readonly from: BookingStatus,
    public readonly event: BookingEvent,
  ) {
    super(`invalid booking transition: cannot '${event}' from '${from}'`);
    this.name = "InvalidBookingTransitionError";
  }
}

/**
 * Allowed transitions. The deposit path is `reserved → deposit_pending →
 * confirmed`. A `waitlisted` booking can be `promote`d to `reserved` when a seat
 * frees, or `cancel`led. `confirmed` and `cancelled` are terminal. Anything not
 * listed is rejected.
 */
const TRANSITIONS: Record<BookingStatus, Partial<Record<BookingEvent, BookingStatus>>> = {
  reserved: { requestDeposit: "deposit_pending", cancel: "cancelled" },
  deposit_pending: { confirmPayment: "confirmed", cancel: "cancelled" },
  waitlisted: { promote: "reserved", cancel: "cancelled" },
  confirmed: {},
  cancelled: {},
};

/** Compute the next status for an event, or throw on an illegal transition. */
export function nextBookingStatus(from: BookingStatus, event: BookingEvent): BookingStatus {
  const to = TRANSITIONS[from][event];
  if (to === undefined) throw new InvalidBookingTransitionError(from, event);
  return to;
}

/** Statuses that occupy a seat (count against a Departure's capacity). */
export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ["reserved", "deposit_pending", "confirmed"];
