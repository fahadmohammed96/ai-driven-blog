import { z } from "zod";

/**
 * Commerce (Fase 3 — monetizzazione, motion "Programmato"). A **Trip** is a
 * sellable product built on an existing Itinerary (price + deposit + theme); a
 * **Departure** is a scheduled instance of a Trip (date + seat capacity, with a
 * waitlist when full); a **Booking** is a customer's seat on a Departure, driven
 * by a state machine (reserved → deposit_pending → confirmed, or waitlisted when
 * the Departure is full). The deposit ("acconto") is collected through a
 * PaymentPort — Stripe in test-mode behind config, a deterministic stub in tests.
 *
 * Regulatory note (PRODUCT): the software models the *workflow / payment /
 * delivery*, NOT travel inventory/GDS.
 */

/** ISO-4217 currency, lowercased (defaults to eur). */
export const currencySchema = z
  .string()
  .regex(/^[a-z]{3}$/, "currency must be a 3-letter ISO-4217 code")
  .default("eur");

/** A calendar date `YYYY-MM-DD` (the Departure's scheduled day). */
const departureDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

/**
 * Create a Trip from an existing Itinerary content item. `priceCents` and
 * `depositCents` are integer minor units; the deposit cannot exceed the price.
 */
export const createTripSchema = z
  .object({
    itineraryId: z.string().uuid(),
    title: z.string().min(1).max(200),
    theme: z.string().min(1).max(64).optional(),
    priceCents: z.number().int().positive(),
    depositCents: z.number().int().positive(),
    // `currencySchema` carries `.default("eur")`, so an absent key resolves to eur.
    currency: currencySchema,
  })
  .refine((d) => d.depositCents <= d.priceCents, {
    message: "deposit cannot exceed the trip price",
    path: ["depositCents"],
  });
export type CreateTrip = z.infer<typeof createTripSchema>;

/** Launch (schedule) a Departure of a Trip: a date and a seat capacity. */
export const launchDepartureSchema = z.object({
  departureDate: departureDateSchema,
  seats: z.number().int().positive().max(10_000),
});
export type LaunchDeparture = z.infer<typeof launchDepartureSchema>;

/** Book a seat on a Departure (one seat per booking). */
export const bookSeatSchema = z.object({
  customerEmail: z.string().email(),
  customerName: z.string().min(1).max(200).optional(),
});
export type BookSeat = z.infer<typeof bookSeatSchema>;

/** The booking lifecycle states (state machine in the commerce module). */
export const bookingStatusSchema = z.enum([
  "reserved",
  "deposit_pending",
  "confirmed",
  "waitlisted",
  "cancelled",
]);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

/** A Departure as returned by the read endpoints, with live seat usage. */
export interface DepartureView {
  id: string;
  tripId: string;
  departureDate: string;
  seats: number;
  /** Active seats taken (reserved + deposit_pending + confirmed). */
  booked: number;
  /** Seats still free (`max(0, seats - booked)`). */
  available: number;
  /** People currently on the waitlist. */
  waitlisted: number;
  status: string;
}

/** A Trip as returned by the read endpoints, with its scheduled departures. */
export interface TripView {
  id: string;
  itineraryId: string;
  title: string;
  theme: string | null;
  priceCents: number;
  depositCents: number;
  currency: string;
  createdAt: string;
  departures: DepartureView[];
}

/** A Booking as returned by the read/booking endpoints. */
export interface BookingView {
  id: string;
  departureId: string;
  customerEmail: string;
  customerName: string | null;
  status: BookingStatus;
  depositCents: number;
  currency: string;
  /** The PaymentPort reference once a deposit has been collected. */
  paymentRef: string | null;
  createdAt: string;
  confirmedAt: string | null;
}
