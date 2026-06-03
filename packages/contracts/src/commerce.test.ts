import { describe, it, expect } from "vitest";
import {
  createTripSchema,
  launchDepartureSchema,
  bookSeatSchema,
  bookingStatusSchema,
} from "./commerce";

describe("commerce contracts", () => {
  it("validates a Trip: positive price/deposit, deposit ≤ price, currency defaults to eur", () => {
    const ok = createTripSchema.safeParse({
      itineraryId: "11111111-1111-1111-1111-111111111111",
      title: "Giappone autunno",
      priceCents: 150_000,
      depositCents: 30_000,
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.currency).toBe("eur");

    // A deposit larger than the price is rejected.
    expect(
      createTripSchema.safeParse({
        itineraryId: "11111111-1111-1111-1111-111111111111",
        title: "Bad",
        priceCents: 10_000,
        depositCents: 20_000,
      }).success,
    ).toBe(false);

    // A non-uuid itinerary id is rejected.
    expect(
      createTripSchema.safeParse({ itineraryId: "nope", title: "X", priceCents: 100, depositCents: 50 })
        .success,
    ).toBe(false);
  });

  it("validates a Departure: ISO date + a positive seat count", () => {
    expect(launchDepartureSchema.safeParse({ departureDate: "2026-10-01", seats: 12 }).success).toBe(true);
    expect(launchDepartureSchema.safeParse({ departureDate: "01-10-2026", seats: 12 }).success).toBe(false);
    expect(launchDepartureSchema.safeParse({ departureDate: "2026-10-01", seats: 0 }).success).toBe(false);
  });

  it("validates a booking request and the booking status enum", () => {
    expect(bookSeatSchema.safeParse({ customerEmail: "a@b.com", customerName: "Ada" }).success).toBe(true);
    expect(bookSeatSchema.safeParse({ customerEmail: "not-an-email" }).success).toBe(false);
    expect(bookingStatusSchema.safeParse("waitlisted").success).toBe(true);
    expect(bookingStatusSchema.safeParse("paid").success).toBe(false);
  });
});
