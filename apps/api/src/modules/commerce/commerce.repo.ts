import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { BookingStatus } from "@blogs/contracts";
import type { Tx } from "../../platform/db/tenant";
import { bookings, departures, trips } from "../../platform/db/schema";
import { ACTIVE_BOOKING_STATUSES } from "./booking-state";

export type TripRow = typeof trips.$inferSelect;
export type DepartureRow = typeof departures.$inferSelect;
export type BookingRow = typeof bookings.$inferSelect;

// ─── Trips ────────────────────────────────────────────────────────────────

export interface NewTrip {
  tenantId: string;
  itineraryId: string;
  title: string;
  theme?: string | null;
  priceCents: number;
  depositCents: number;
  currency: string;
}

/** Insert a Trip (built on an itinerary content item) under the tenant context. */
export async function insertTrip(tx: Tx, input: NewTrip): Promise<TripRow> {
  const [row] = await tx
    .insert(trips)
    .values({
      tenantId: input.tenantId,
      itineraryId: input.itineraryId,
      title: input.title,
      theme: input.theme ?? null,
      priceCents: input.priceCents,
      depositCents: input.depositCents,
      currency: input.currency,
    })
    .returning();
  return row as TripRow;
}

/** Fetch a Trip by id (RLS returns null for other tenants). */
export async function getTrip(tx: Tx, id: string): Promise<TripRow | null> {
  const rows = await tx.select().from(trips).where(eq(trips.id, id));
  return rows[0] ?? null;
}

/** All of the tenant's Trips, newest first. */
export async function listTrips(tx: Tx): Promise<TripRow[]> {
  return tx.select().from(trips).orderBy(desc(trips.createdAt));
}

// ─── Departures ───────────────────────────────────────────────────────────

export interface NewDeparture {
  tenantId: string;
  tripId: string;
  departureDate: string;
  seats: number;
}

/** Schedule ("launch") a Departure of a Trip. */
export async function insertDeparture(tx: Tx, input: NewDeparture): Promise<DepartureRow> {
  const [row] = await tx
    .insert(departures)
    .values({
      tenantId: input.tenantId,
      tripId: input.tripId,
      departureDate: input.departureDate,
      seats: input.seats,
    })
    .returning();
  return row as DepartureRow;
}

/** Fetch a Departure by id (RLS-scoped). */
export async function getDeparture(tx: Tx, id: string): Promise<DepartureRow | null> {
  const rows = await tx.select().from(departures).where(eq(departures.id, id));
  return rows[0] ?? null;
}

/**
 * Fetch a Departure by id **for update** (row lock). Used when booking a seat so
 * concurrent reservations on the same Departure serialize and capacity can never
 * be oversold within a tenant transaction.
 */
export async function getDepartureForUpdate(tx: Tx, id: string): Promise<DepartureRow | null> {
  const rows = await tx.select().from(departures).where(eq(departures.id, id)).for("update");
  return rows[0] ?? null;
}

/** The tenant's Departures for a set of Trips, earliest date first. */
export async function listDeparturesForTrips(tx: Tx, tripIds: string[]): Promise<DepartureRow[]> {
  if (tripIds.length === 0) return [];
  return tx
    .select()
    .from(departures)
    .where(inArray(departures.tripId, tripIds))
    .orderBy(asc(departures.departureDate));
}

/** Seat usage for a Departure: active (seat-occupying) bookings and waitlist size. */
export interface DepartureUsage {
  booked: number;
  waitlisted: number;
}

const statusCount = (status: BookingStatus | BookingStatus[]) =>
  sql<number>`count(*) filter (where ${
    Array.isArray(status)
      ? inArray(bookings.status, status)
      : eq(bookings.status, status)
  })::int`;

/** Aggregate seat usage for every Departure in `departureIds` in one query. */
export async function usageForDepartures(
  tx: Tx,
  departureIds: string[],
): Promise<Map<string, DepartureUsage>> {
  const map = new Map<string, DepartureUsage>();
  if (departureIds.length === 0) return map;
  const rows = await tx
    .select({
      departureId: bookings.departureId,
      booked: statusCount(ACTIVE_BOOKING_STATUSES),
      waitlisted: statusCount("waitlisted"),
    })
    .from(bookings)
    .where(inArray(bookings.departureId, departureIds))
    .groupBy(bookings.departureId);
  for (const r of rows) map.set(r.departureId, { booked: r.booked, waitlisted: r.waitlisted });
  return map;
}

/** Count active (seat-occupying) bookings on one Departure. */
export async function countActiveBookings(tx: Tx, departureId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(bookings)
    .where(
      and(eq(bookings.departureId, departureId), inArray(bookings.status, ACTIVE_BOOKING_STATUSES)),
    );
  return row?.n ?? 0;
}

// ─── Bookings ─────────────────────────────────────────────────────────────

export interface NewBooking {
  tenantId: string;
  departureId: string;
  customerEmail: string;
  customerName?: string | null;
  status: BookingStatus;
  depositCents: number;
  currency: string;
}

/** Insert a booking with its decided initial status (reserved or waitlisted). */
export async function insertBooking(tx: Tx, input: NewBooking): Promise<BookingRow> {
  const [row] = await tx
    .insert(bookings)
    .values({
      tenantId: input.tenantId,
      departureId: input.departureId,
      customerEmail: input.customerEmail,
      customerName: input.customerName ?? null,
      status: input.status,
      depositCents: input.depositCents,
      currency: input.currency,
    })
    .returning();
  return row as BookingRow;
}

/** Fetch a booking by id (RLS-scoped). */
export async function getBooking(tx: Tx, id: string): Promise<BookingRow | null> {
  const rows = await tx.select().from(bookings).where(eq(bookings.id, id));
  return rows[0] ?? null;
}

/** Patch a booking's status/payment fields; bumps `updated_at`. Returns the row. */
export async function updateBooking(
  tx: Tx,
  id: string,
  patch: { status?: BookingStatus; paymentRef?: string | null; confirmedAt?: Date | null | SQL },
): Promise<BookingRow> {
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.paymentRef !== undefined) set.paymentRef = patch.paymentRef;
  if (patch.confirmedAt !== undefined) set.confirmedAt = patch.confirmedAt;
  const [row] = await tx.update(bookings).set(set).where(eq(bookings.id, id)).returning();
  return row as BookingRow;
}
