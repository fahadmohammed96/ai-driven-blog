import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import {
  type BookingStatus,
  type BookingView,
  bookSeatSchema,
  createTripSchema,
  type DepartureView,
  launchDepartureSchema,
  type TripView,
} from "@blogs/contracts";
import { DB, PAYMENT } from "../../platform/tokens";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { TenancyService } from "../tenancy";
// Cross-module composition through the content module's public barrel.
import { getContentItem } from "../content";
import type { PaymentPort } from "./payment.port";
import {
  type BookingRow,
  type DepartureRow,
  getDeparture,
  getTrip,
  insertDeparture,
  insertTrip,
  listDeparturesForTrips,
  listTrips,
  type TripRow,
  usageForDepartures,
  type DepartureUsage,
} from "./commerce.repo";
import {
  bookSeat,
  BookingNotFoundError,
  DepartureNotFoundError,
  DepositFailedError,
  payDeposit,
} from "./commerce.service";

/**
 * Commerce surface (Fase 3, motion "Programmato"): launch Trips/Departures and
 * run the booking → deposit → confirm flow (waitlist when full). Tenant-scoped
 * behind the tenancy guard + RLS (`withTenant`). The deposit is collected through
 * an injected {@link PaymentPort} (Stripe test-mode behind config; a deterministic
 * stub in tests).
 */
@Controller()
export class CommerceController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PAYMENT) private readonly payment: PaymentPort,
    private readonly tenancy: TenancyService,
  ) {}

  private get tenantId(): string {
    return this.tenancy.current().tenantId;
  }

  private get deps() {
    return { db: this.db, payment: this.payment };
  }

  // ─── Trips ──────────────────────────────────────────────────────────────

  @Post("trips")
  @HttpCode(201)
  async createTrip(@Body() body: unknown): Promise<TripView> {
    const parsed = createTripSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());

    const trip = await withTenant(this.db, this.tenantId, async (tx) => {
      // The Trip must be built on one of the tenant's *itinerary* content items.
      const itinerary = await getContentItem(tx, parsed.data.itineraryId);
      if (!itinerary || itinerary.type !== "itinerary") return null;
      return insertTrip(tx, {
        tenantId: this.tenantId,
        itineraryId: parsed.data.itineraryId,
        title: parsed.data.title,
        theme: parsed.data.theme ?? null,
        priceCents: parsed.data.priceCents,
        depositCents: parsed.data.depositCents,
        currency: parsed.data.currency ?? "eur",
      });
    });
    if (!trip) throw new BadRequestException("itineraryId must reference an existing itinerary");
    return this.tripView(trip, []);
  }

  @Get("trips")
  async listTrips(): Promise<{ trips: TripView[] }> {
    const result = await withTenant(this.db, this.tenantId, async (tx) => {
      const tripRows = await listTrips(tx);
      const departureRows = await listDeparturesForTrips(
        tx,
        tripRows.map((t) => t.id),
      );
      const usage = await usageForDepartures(
        tx,
        departureRows.map((d) => d.id),
      );
      return { tripRows, departureRows, usage };
    });
    const byTrip = new Map<string, DepartureRow[]>();
    for (const d of result.departureRows) {
      const list = byTrip.get(d.tripId) ?? [];
      list.push(d);
      byTrip.set(d.tripId, list);
    }
    return {
      trips: result.tripRows.map((t) =>
        this.tripView(
          t,
          (byTrip.get(t.id) ?? []).map((d) => this.departureView(d, result.usage.get(d.id))),
        ),
      ),
    };
  }

  // ─── Departures ─────────────────────────────────────────────────────────

  @Post("trips/:tripId/departures")
  @HttpCode(201)
  async launchDeparture(
    @Param("tripId") tripId: string,
    @Body() body: unknown,
  ): Promise<DepartureView> {
    const parsed = launchDepartureSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());

    const departure = await withTenant(this.db, this.tenantId, async (tx) => {
      const trip = await getTrip(tx, tripId); // RLS-gated existence
      if (!trip) return null;
      return insertDeparture(tx, {
        tenantId: this.tenantId,
        tripId,
        departureDate: parsed.data.departureDate,
        seats: parsed.data.seats,
      });
    });
    if (!departure) throw new NotFoundException("trip not found");
    return this.departureView(departure, { booked: 0, waitlisted: 0 });
  }

  @Get("departures/:id")
  async getDeparture(@Param("id") id: string): Promise<DepartureView> {
    const result = await withTenant(this.db, this.tenantId, async (tx) => {
      const departure = await getDeparture(tx, id);
      if (!departure) return null;
      const usage = (await usageForDepartures(tx, [id])).get(id);
      return { departure, usage };
    });
    if (!result) throw new NotFoundException("departure not found");
    return this.departureView(result.departure, result.usage);
  }

  // ─── Bookings ───────────────────────────────────────────────────────────

  @Post("departures/:id/bookings")
  @HttpCode(201)
  async book(@Param("id") departureId: string, @Body() body: unknown): Promise<BookingView> {
    const parsed = bookSeatSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      const booking = await bookSeat(this.deps, {
        tenantId: this.tenantId,
        departureId,
        customerEmail: parsed.data.customerEmail,
        customerName: parsed.data.customerName,
      });
      return this.bookingView(booking);
    } catch (err) {
      if (err instanceof DepartureNotFoundError) throw new NotFoundException("departure not found");
      throw err;
    }
  }

  @Post("bookings/:id/deposit")
  @HttpCode(200)
  async deposit(@Param("id") bookingId: string): Promise<BookingView> {
    try {
      const booking = await payDeposit(this.deps, { tenantId: this.tenantId, bookingId });
      return this.bookingView(booking);
    } catch (err) {
      if (err instanceof BookingNotFoundError) throw new NotFoundException("booking not found");
      if (err instanceof DepositFailedError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  // ─── Views ──────────────────────────────────────────────────────────────

  private tripView(row: TripRow, departures: DepartureView[]): TripView {
    return {
      id: row.id,
      itineraryId: row.itineraryId,
      title: row.title,
      theme: row.theme,
      priceCents: row.priceCents,
      depositCents: row.depositCents,
      currency: row.currency,
      createdAt: row.createdAt.toISOString(),
      departures,
    };
  }

  private departureView(row: DepartureRow, usage: DepartureUsage | undefined): DepartureView {
    const booked = usage?.booked ?? 0;
    return {
      id: row.id,
      tripId: row.tripId,
      departureDate: row.departureDate,
      seats: row.seats,
      booked,
      available: Math.max(0, row.seats - booked),
      waitlisted: usage?.waitlisted ?? 0,
      status: row.status,
    };
  }

  private bookingView(row: BookingRow): BookingView {
    return {
      id: row.id,
      departureId: row.departureId,
      customerEmail: row.customerEmail,
      customerName: row.customerName,
      status: row.status as BookingStatus,
      depositCents: row.depositCents,
      currency: row.currency,
      paymentRef: row.paymentRef,
      createdAt: row.createdAt.toISOString(),
      confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    };
  }
}
