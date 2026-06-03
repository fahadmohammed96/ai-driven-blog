import "reflect-metadata";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import type { BookingView, DepartureView, TripView } from "@blogs/contracts";
import { DB, PAYMENT } from "../../platform/tokens";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { TenancyService } from "../tenancy";
import { insertContentItem } from "../content";
import { CommerceController } from "./commerce.controller";
import { StubPaymentClient } from "./payment.stub";
import { insertDeparture, insertTrip } from "./commerce.repo";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT = "44444444-4444-4444-4444-444444444444";
const OTHER = "99999999-9999-9999-9999-999999999999";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let db: Db;
let app: INestApplication;

async function seedItinerary(tenant: string, title: string): Promise<string> {
  const row = await withTenant(db, tenant, (tx) =>
    insertContentItem(tx, { tenantId: tenant, type: "itinerary", title, blocks: [] }),
  );
  return row.id;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  adminPool = new Pool({ connectionString: container.getConnectionUri() });
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
  await adminPool.query(`CREATE ROLE appuser LOGIN PASSWORD 'app_pw' NOSUPERUSER`);
  await adminPool.query(`GRANT USAGE ON SCHEMA public TO appuser`);
  await adminPool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, content_items, trips, departures, bookings TO appuser`,
  );
  await adminPool.query(
    `INSERT INTO tenants (id, slug, name) VALUES ($1,'founder','Founder'), ($2,'other','Other')`,
    [TENANT, OTHER],
  );

  ({ db, pool: appPool } = createDb(
    `postgresql://appuser:app_pw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));

  process.env.FOUNDER_TENANT_ID = TENANT;
  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController],
    providers: [
      TenancyService,
      { provide: DB, useValue: db },
      { provide: PAYMENT, useValue: new StubPaymentClient() },
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("commerce: launch departure → book → deposit → confirm (waitlist when full)", () => {
  it("runs the full Programmato journey end to end (seats=1 → second booking waitlisted)", async () => {
    const server = app.getHttpServer();
    const itineraryId = await seedItinerary(TENANT, "Giappone autunno");

    // Launch a Trip on the itinerary.
    const tripRes = await request(server)
      .post("/trips")
      .send({ itineraryId, title: "Giappone in autunno", theme: "natura", priceCents: 150_000, depositCents: 30_000 })
      .expect(201);
    const trip = tripRes.body as TripView;
    expect(trip.currency).toBe("eur");
    expect(trip.depositCents).toBe(30_000);

    // Launch a Departure with a single seat.
    const depRes = await request(server)
      .post(`/trips/${trip.id}/departures`)
      .send({ departureDate: "2026-10-12", seats: 1 })
      .expect(201);
    const departure = depRes.body as DepartureView;
    expect(departure.seats).toBe(1);
    expect(departure.booked).toBe(0);
    expect(departure.available).toBe(1);

    // Book the only seat → reserved.
    const bookRes = await request(server)
      .post(`/departures/${departure.id}/bookings`)
      .send({ customerEmail: "ada@example.com", customerName: "Ada" })
      .expect(201);
    const booking = bookRes.body as BookingView;
    expect(booking.status).toBe("reserved");
    expect(booking.depositCents).toBe(30_000);
    expect(booking.paymentRef).toBeNull();
    expect(booking.confirmedAt).toBeNull();

    // Pay the deposit (stub) → confirmed, with a deterministic payment ref.
    const depositRes = await request(server).post(`/bookings/${booking.id}/deposit`).expect(200);
    const confirmed = depositRes.body as BookingView;
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.paymentRef).toBe(`pi_stub_${booking.id}`);
    expect(confirmed.confirmedAt).not.toBeNull();

    // The seat is now taken: a confirmed booking occupies capacity.
    const full = (await request(server).get(`/departures/${departure.id}`).expect(200))
      .body as DepartureView;
    expect(full.booked).toBe(1);
    expect(full.available).toBe(0);

    // A second booking on the full departure → waitlisted.
    const wlRes = await request(server)
      .post(`/departures/${departure.id}/bookings`)
      .send({ customerEmail: "bob@example.com" })
      .expect(201);
    expect((wlRes.body as BookingView).status).toBe("waitlisted");

    // Usage reflects 1 booked + 1 waitlisted.
    const usage = (await request(server).get(`/departures/${departure.id}`).expect(200))
      .body as DepartureView;
    expect(usage.booked).toBe(1);
    expect(usage.available).toBe(0);
    expect(usage.waitlisted).toBe(1);

    // Paying the deposit again is idempotent: still confirmed, same payment ref.
    const again = (await request(server).post(`/bookings/${booking.id}/deposit`).expect(200))
      .body as BookingView;
    expect(again.status).toBe("confirmed");
    expect(again.paymentRef).toBe(`pi_stub_${booking.id}`);
  });

  it("400s a Trip built on a non-itinerary content item", async () => {
    const server = app.getHttpServer();
    const article = await withTenant(db, TENANT, (tx) =>
      insertContentItem(tx, { tenantId: TENANT, type: "article", title: "Not a trip", blocks: [] }),
    );
    await request(server)
      .post("/trips")
      .send({ itineraryId: article.id, title: "X", priceCents: 100, depositCents: 50 })
      .expect(400);
  });

  it("404s a booking on an unknown departure and a deposit on an unknown booking", async () => {
    const server = app.getHttpServer();
    const missing = "66666666-6666-6666-6666-666666666666";
    await request(server)
      .post(`/departures/${missing}/bookings`)
      .send({ customerEmail: "x@y.com" })
      .expect(404);
    await request(server).post(`/bookings/${missing}/deposit`).expect(404);
  });

  it("RLS: cannot see or operate on another tenant's trips/departures", async () => {
    const server = app.getHttpServer();
    // Seed a full trip+departure directly under OTHER's tenant context.
    const otherItinerary = await seedItinerary(OTHER, "Other's trip");
    const { otherDepId } = await withTenant(db, OTHER, async (tx) => {
      const t = await insertTrip(tx, {
        tenantId: OTHER,
        itineraryId: otherItinerary,
        title: "Secret",
        priceCents: 99_900,
        depositCents: 10_000,
        currency: "eur",
      });
      const d = await insertDeparture(tx, {
        tenantId: OTHER,
        tripId: t.id,
        departureDate: "2026-12-01",
        seats: 5,
      });
      return { otherDepId: d.id };
    });

    // The founder never lists OTHER's trip…
    const list = (await request(server).get("/trips").expect(200)).body as { trips: TripView[] };
    expect(list.trips.some((t) => t.title === "Secret")).toBe(false);

    // …and cannot read or book OTHER's departure → 404 under RLS.
    await request(server).get(`/departures/${otherDepId}`).expect(404);
    await request(server)
      .post(`/departures/${otherDepId}/bookings`)
      .send({ customerEmail: "intruder@example.com" })
      .expect(404);
  });
});
