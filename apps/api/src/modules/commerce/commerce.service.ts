import { sql } from "drizzle-orm";
import type { BookingStatus } from "@blogs/contracts";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { nextBookingStatus } from "./booking-state";
import type { PaymentPort } from "./payment.port";
import {
  type BookingRow,
  countActiveBookings,
  getBooking,
  getDepartureForUpdate,
  getTrip,
  insertBooking,
  updateBooking,
} from "./commerce.repo";

export class DepartureNotFoundError extends Error {
  constructor() {
    super("departure not found");
    this.name = "DepartureNotFoundError";
  }
}
export class BookingNotFoundError extends Error {
  constructor() {
    super("booking not found");
    this.name = "BookingNotFoundError";
  }
}
export class DepositFailedError extends Error {
  constructor() {
    super("deposit could not be collected");
    this.name = "DepositFailedError";
  }
}

export interface CommerceDeps {
  db: Db;
  payment: PaymentPort;
}

export interface BookSeatInput {
  tenantId: string;
  departureId: string;
  customerEmail: string;
  customerName?: string;
}

/**
 * Book a seat on a Departure. The Departure row is locked (`FOR UPDATE`) so
 * concurrent bookings serialize: if active bookings already fill capacity the
 * new booking is **waitlisted**, otherwise it is **reserved**. The deposit amount
 * and currency are snapshotted from the parent Trip onto the booking.
 */
export async function bookSeat(deps: CommerceDeps, input: BookSeatInput): Promise<BookingRow> {
  return withTenant(deps.db, input.tenantId, async (tx) => {
    const departure = await getDepartureForUpdate(tx, input.departureId);
    if (!departure) throw new DepartureNotFoundError();
    const trip = await getTrip(tx, departure.tripId);
    if (!trip) throw new DepartureNotFoundError(); // a departure always has a trip (FK)

    const active = await countActiveBookings(tx, departure.id);
    const status = active >= departure.seats ? "waitlisted" : "reserved";

    return insertBooking(tx, {
      tenantId: input.tenantId,
      departureId: departure.id,
      customerEmail: input.customerEmail,
      customerName: input.customerName ?? null,
      status,
      depositCents: trip.depositCents,
      currency: trip.currency,
    });
  });
}

/**
 * Collect the deposit for a booking and confirm it. Modelled in three steps so a
 * DB transaction is never held across the (potentially networked) payment call:
 *
 *   1. `reserved → deposit_pending` (idempotent: already-confirmed returns as-is;
 *      a waitlisted/cancelled booking is rejected by the state machine).
 *   2. `PaymentPort.collectDeposit` — the stub succeeds deterministically.
 *   3. `deposit_pending → confirmed`, recording the payment ref + confirmed time.
 *
 * A failed deposit leaves the booking in `deposit_pending` (retryable).
 */
export async function payDeposit(
  deps: CommerceDeps,
  input: { tenantId: string; bookingId: string },
): Promise<BookingRow> {
  const { db, payment } = deps;

  // Step 1 — move to deposit_pending (or short-circuit if already confirmed).
  const pending = await withTenant(db, input.tenantId, async (tx) => {
    const booking = await getBooking(tx, input.bookingId);
    if (!booking) return { kind: "missing" as const };
    if (booking.status === "confirmed") return { kind: "already" as const, booking };
    const next = nextBookingStatus(booking.status as BookingStatus, "requestDeposit");
    const updated = await updateBooking(tx, input.bookingId, { status: next });
    return { kind: "pending" as const, booking: updated };
  });
  if (pending.kind === "missing") throw new BookingNotFoundError();
  if (pending.kind === "already") return pending.booking;

  // Step 2 — collect the deposit through the PaymentPort (no DB tx held here).
  const result = await payment.collectDeposit({
    bookingId: pending.booking.id,
    amountCents: pending.booking.depositCents,
    currency: pending.booking.currency,
    customerEmail: pending.booking.customerEmail,
  });
  if (result.status !== "succeeded") throw new DepositFailedError();

  // Step 3 — confirm (idempotent if a concurrent call already confirmed).
  return withTenant(db, input.tenantId, async (tx) => {
    const booking = await getBooking(tx, input.bookingId);
    if (!booking) throw new BookingNotFoundError();
    if (booking.status === "confirmed") return booking;
    const next = nextBookingStatus(booking.status as BookingStatus, "confirmPayment");
    return updateBooking(tx, input.bookingId, {
      status: next,
      paymentRef: result.paymentRef,
      confirmedAt: sql`now()`,
    });
  });
}
