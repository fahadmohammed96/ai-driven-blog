import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createDb, type Db } from "./client";
import { withTenant } from "./tenant";
import { ensureAppRole, isRlsBypassed } from "./bootstrap";
import { DEFAULT_TENANT_SETTINGS } from "@blogs/contracts";
import {
  contentItems,
  itineraryStops,
  mediaAssets,
  itineraryStopPhotos,
  tenantSettings,
  affiliateLinks,
  affiliateClicks,
  trips,
  departures,
  bookings,
  leads,
} from "./schema";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");
const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let adminDb: Db;
let appDb: Db;

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  ({ db: adminDb, pool: adminPool } = createDb(container.getConnectionUri()));

  // Schema as the superuser/admin connection.
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
  await adminPool.query(
    `INSERT INTO tenants (id, slug, name) VALUES ($1,'tenant-a','A'), ($2,'tenant-b','B')`,
    [TENANT_A, TENANT_B],
  );

  // Provision the runtime app role (the function under test), then connect as it.
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

describe("runtime RLS via the least-privilege app role (DEBT-005)", () => {
  it("connects as a role that does NOT bypass RLS", async () => {
    expect(await isRlsBypassed(appDb)).toBe(false);
  });

  it("enforces tenant isolation at runtime, as the app role", async () => {
    await withTenant(appDb, TENANT_A, (tx) =>
      tx.insert(contentItems).values({ tenantId: TENANT_A, type: "article", title: "A1" }),
    );

    const seenByA = await withTenant(appDb, TENANT_A, (tx) => tx.select().from(contentItems));
    expect(seenByA).toHaveLength(1);

    const seenByB = await withTenant(appDb, TENANT_B, (tx) => tx.select().from(contentItems));
    expect(seenByB).toHaveLength(0);
  });

  it("has sufficient grants to write every app table (full Fase 1 chain)", async () => {
    const linkCount = await withTenant(appDb, TENANT_A, async (tx) => {
      const [ci] = await tx
        .insert(contentItems)
        .values({ tenantId: TENANT_A, type: "itinerary", title: "Grants" })
        .returning();
      const [stop] = await tx
        .insert(itineraryStops)
        .values({
          tenantId: TENANT_A,
          contentItemId: ci!.id,
          position: 0,
          place: "Tokyo",
          startDate: "2026-04-01",
          endDate: "2026-04-02",
        })
        .returning();
      const [asset] = await tx
        .insert(mediaAssets)
        .values({
          id: randomUUID(),
          tenantId: TENANT_A,
          contentItemId: ci!.id,
          storageKey: "k/original.jpg",
          variants: { thumb: "t.jpg", web: "w.jpg" },
        })
        .returning();
      await tx
        .insert(itineraryStopPhotos)
        .values({ tenantId: TENANT_A, stopId: stop!.id, assetId: asset!.id });
      const links = await tx.select().from(itineraryStopPhotos);
      return links.length;
    });
    expect(linkCount).toBeGreaterThan(0);
  });

  // Regression guard: every tenant-scoped table the runtime touches must be in
  // bootstrap's APP_RW_TABLES, or the app role gets "permission denied" at
  // runtime (slice 4: tenant_settings was missing → settings GET 500 in e2e).
  it("can write+read tenant_settings as the app role (grant present)", async () => {
    const stored = await withTenant(appDb, TENANT_A, async (tx) => {
      await tx.insert(tenantSettings).values({
        tenantId: TENANT_A,
        settings: DEFAULT_TENANT_SETTINGS,
      });
      return tx.select().from(tenantSettings);
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.settings.specialistAutonomy.writer).toBe("manual");
  });

  // Same grant guard for the Fase-3 affiliate tables: the redirector inserts a
  // click row and the read endpoints select from both tables as the app role.
  it("can write+read affiliate_links and affiliate_clicks as the app role (grants present)", async () => {
    const clicks = await withTenant(appDb, TENANT_A, async (tx) => {
      const [link] = await tx
        .insert(affiliateLinks)
        .values({ tenantId: TENANT_A, code: "grant-check", targetUrl: "https://example.com/g" })
        .returning();
      await tx
        .insert(affiliateClicks)
        .values({ tenantId: TENANT_A, linkId: link!.id, channel: "blog" });
      return tx.select().from(affiliateClicks);
    });
    expect(clicks.length).toBeGreaterThan(0);
  });

  // Same grant guard for the Fase-3 commerce tables: the booking flow inserts
  // trips/departures/bookings and updates bookings as the app role.
  it("can write+read trips, departures and bookings as the app role (grants present)", async () => {
    const rows = await withTenant(appDb, TENANT_A, async (tx) => {
      const [ci] = await tx
        .insert(contentItems)
        .values({ tenantId: TENANT_A, type: "itinerary", title: "Commerce grant" })
        .returning();
      const [trip] = await tx
        .insert(trips)
        .values({
          tenantId: TENANT_A,
          itineraryId: ci!.id,
          title: "Grant trip",
          priceCents: 100_000,
          depositCents: 20_000,
        })
        .returning();
      const [dep] = await tx
        .insert(departures)
        .values({ tenantId: TENANT_A, tripId: trip!.id, departureDate: "2026-08-01", seats: 4 })
        .returning();
      const [booking] = await tx
        .insert(bookings)
        .values({
          tenantId: TENANT_A,
          departureId: dep!.id,
          customerEmail: "grant@a.com",
          status: "reserved",
          depositCents: 20_000,
        })
        .returning();
      await tx.update(bookings).set({ status: "confirmed" });
      return tx.select().from(bookings).where(eq(bookings.id, booking!.id));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("confirmed");
  });

  // Same grant guard for the Fase-3 CRM table: the custom-trip pipeline inserts a
  // lead and updates it through the pipeline (proposal/deposit/deliver) as the app
  // role. A missing grant = "permission denied for table leads" at runtime.
  it("can write+read leads as the app role (grant present)", async () => {
    const rows = await withTenant(appDb, TENANT_A, async (tx) => {
      const [lead] = await tx
        .insert(leads)
        .values({
          tenantId: TENANT_A,
          customerEmail: "lead@a.com",
          channel: "email",
          request: "Custom trip to Patagonia",
          portalToken: "grant-check-token",
        })
        .returning();
      await tx.update(leads).set({ status: "ai_drafted", proposal: "Bozza" }).where(eq(leads.id, lead!.id));
      return tx.select().from(leads).where(eq(leads.id, lead!.id));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("ai_drafted");
  });
});
