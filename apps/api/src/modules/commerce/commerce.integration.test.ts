import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { ensureAppRole, isRlsBypassed } from "../../platform/db/bootstrap";
import { insertContentItem } from "../content";
import { StubPaymentClient } from "./payment.stub";
import { bookSeat, payDeposit } from "./commerce.service";
import {
  getBooking,
  insertDeparture,
  insertTrip,
  listTrips,
  usageForDepartures,
} from "./commerce.repo";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let adminDb: Db;
let appDb: Db;
const payment = new StubPaymentClient();

async function seedDeparture(tenant: string, seats: number): Promise<{ tripId: string; departureId: string }> {
  return withTenant(appDb, tenant, async (tx) => {
    const itinerary = await insertContentItem(tx, {
      tenantId: tenant,
      type: "itinerary",
      title: "Trip base",
      blocks: [],
    });
    const trip = await insertTrip(tx, {
      tenantId: tenant,
      itineraryId: itinerary.id,
      title: "Programmato",
      priceCents: 120_000,
      depositCents: 25_000,
      currency: "eur",
    });
    const dep = await insertDeparture(tx, {
      tenantId: tenant,
      tripId: trip.id,
      departureDate: "2026-09-15",
      seats,
    });
    return { tripId: trip.id, departureId: dep.id };
  });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  ({ db: adminDb, pool: adminPool } = createDb(container.getConnectionUri()));
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
  await adminPool.query(
    `INSERT INTO tenants (id, slug, name) VALUES ($1,'tenant-a','A'), ($2,'tenant-b','B')`,
    [TENANT_A, TENANT_B],
  );

  // Connect as the real least-privilege runtime role (DEBT-005), so this proves
  // the grants the commerce flow needs at runtime + that RLS is enforced.
  await ensureAppRole(adminDb, "app_rw", "app_rw");
  ({ db: appDb, pool: appPool } = createDb(
    `postgresql://app_rw:app_rw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
  ));
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await container?.stop();
});

describe("commerce trips/departures/bookings — runtime RLS via the app role", () => {
  it("connects as a role that does NOT bypass RLS", async () => {
    expect(await isRlsBypassed(appDb)).toBe(false);
  });

  it("books → deposits → confirms, and waitlists once a single-seat departure is full", async () => {
    const { departureId } = await seedDeparture(TENANT_A, 1);

    const first = await bookSeat(
      { db: appDb, payment },
      { tenantId: TENANT_A, departureId, customerEmail: "ada@a.com" },
    );
    expect(first.status).toBe("reserved");

    const confirmed = await payDeposit({ db: appDb, payment }, { tenantId: TENANT_A, bookingId: first.id });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.paymentRef).toBe(`pi_stub_${first.id}`);
    expect(confirmed.confirmedAt).not.toBeNull();

    // The seat is taken → the next booking is waitlisted.
    const second = await bookSeat(
      { db: appDb, payment },
      { tenantId: TENANT_A, departureId, customerEmail: "bob@a.com" },
    );
    expect(second.status).toBe("waitlisted");

    const usage = await withTenant(appDb, TENANT_A, (tx) => usageForDepartures(tx, [departureId]));
    expect(usage.get(departureId)).toEqual({ booked: 1, waitlisted: 1 });

    // Idempotent confirm: paying again keeps it confirmed with the same ref.
    const again = await payDeposit({ db: appDb, payment }, { tenantId: TENANT_A, bookingId: first.id });
    expect(again.status).toBe("confirmed");
    expect(again.paymentRef).toBe(`pi_stub_${first.id}`);
  });

  it("isolates trips/departures/bookings per tenant (RLS): B sees none of A's", async () => {
    await seedDeparture(TENANT_A, 3);

    const seenByB = await withTenant(appDb, TENANT_B, (tx) => listTrips(tx));
    expect(seenByB).toHaveLength(0);

    // B booking against A's departure id fails (the departure is invisible → not found).
    const { departureId: aDep } = await seedDeparture(TENANT_A, 2);
    await expect(
      bookSeat({ db: appDb, payment }, { tenantId: TENANT_B, departureId: aDep, customerEmail: "x@b.com" }),
    ).rejects.toThrow();

    // A's own booking is unaffected and visible to A.
    const aBooking = await bookSeat(
      { db: appDb, payment },
      { tenantId: TENANT_A, departureId: aDep, customerEmail: "a-real@a.com" },
    );
    const reread = await withTenant(appDb, TENANT_A, (tx) => getBooking(tx, aBooking.id));
    expect(reread?.id).toBe(aBooking.id);
    // …and B cannot read that booking row.
    const bView = await withTenant(appDb, TENANT_B, (tx) => getBooking(tx, aBooking.id));
    expect(bView).toBeNull();
  });
});
