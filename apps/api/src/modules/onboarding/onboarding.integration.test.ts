import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createDb, type Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { ensureAppRole, isRlsBypassed } from "../../platform/db/bootstrap";
import { provisionTenant } from "./onboarding";
import {
  contentItems,
  itineraryStops,
  mediaAssets,
  itineraryStopPhotos,
  contentEmbeddings,
  channelPosts,
  subscribers,
  subscriptions,
  connectorCredentials,
  tenantSettings,
  affiliateLinks,
  affiliateClicks,
  trips,
  departures,
  bookings,
  leads,
  metricSnapshots,
  aiUsageEvents,
} from "../../platform/db/schema";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../drizzle");

/**
 * Every tenant-scoped table across ALL modules. This list IS the multi-tenant
 * audit surface (Phase 4.3): each one must have RLS enable+force + a tenant
 * policy AND be writable by the runtime `app_rw` role. `tenants` (the root) is
 * audited separately — read-only for `app_rw`, never insertable.
 */
const TENANT_TABLES = [
  "content_items",
  "itinerary_stops",
  "media_assets",
  "itinerary_stop_photos",
  "content_embeddings",
  "channel_posts",
  "subscribers",
  "subscriptions",
  "connector_credentials",
  "tenant_settings",
  "affiliate_links",
  "affiliate_clicks",
  "trips",
  "departures",
  "bookings",
  "leads",
  "metric_snapshots",
  "ai_usage_events",
] as const;

let container: StartedPostgreSqlContainer;
let adminPool: Pool;
let appPool: Pool;
let adminDb: Db;
let appDb: Db;

let n = 0;
const uniq = (p: string): string => `${p}-${Date.now()}-${n++}`;

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  ({ db: adminDb, pool: adminPool } = createDb(container.getConnectionUri()));

  // Schema as the superuser/admin connection, then the least-privilege app role.
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await adminPool.query(readFileSync(join(migrationsDir, f), "utf8"));
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

/**
 * Write exactly one representative row into every tenant-scoped table EXCEPT
 * tenant_settings (seeded by onboarding) — as the runtime `app_rw` role, under
 * `tenant`'s RLS scope. A missing grant or a missing RLS policy would throw here.
 */
async function seedSurface(tenant: string): Promise<void> {
  await withTenant(appDb, tenant, async (tx) => {
    const [ci] = await tx
      .insert(contentItems)
      .values({ tenantId: tenant, type: "article", title: "Surface" })
      .returning();
    const [stop] = await tx
      .insert(itineraryStops)
      .values({
        tenantId: tenant,
        contentItemId: ci!.id,
        position: 0,
        place: "Place",
        startDate: "2026-01-01",
        endDate: "2026-01-02",
      })
      .returning();
    const [asset] = await tx
      .insert(mediaAssets)
      .values({
        tenantId: tenant,
        contentItemId: ci!.id,
        storageKey: uniq("k"),
        variants: { thumb: "t.jpg", web: "w.jpg" },
      })
      .returning();
    await tx.insert(itineraryStopPhotos).values({ tenantId: tenant, stopId: stop!.id, assetId: asset!.id });
    await tx.insert(contentEmbeddings).values({ tenantId: tenant, content: "chunk", embedding: Array(256).fill(0) });
    await tx.insert(channelPosts).values({
      tenantId: tenant,
      contentItemId: ci!.id,
      channel: "instagram",
      payload: { channel: "instagram", caption: "x", hashtags: [] } as never,
    });
    const [sub] = await tx
      .insert(subscribers)
      .values({ tenantId: tenant, email: uniq("s") + "@example.com", confirmToken: uniq("tok") })
      .returning();
    await tx.insert(subscriptions).values({ tenantId: tenant, subscriberId: sub!.id, theme: "travel" });
    await tx.insert(connectorCredentials).values({
      tenantId: tenant,
      connector: "pinterest",
      accessToken: "sealed-a",
      refreshToken: "sealed-r",
      expiresAt: new Date(),
    });
    const [link] = await tx
      .insert(affiliateLinks)
      .values({ tenantId: tenant, code: uniq("code"), targetUrl: "https://example.com/x" })
      .returning();
    await tx.insert(affiliateClicks).values({ tenantId: tenant, linkId: link!.id, channel: "blog" });
    const [trip] = await tx
      .insert(trips)
      .values({ tenantId: tenant, itineraryId: ci!.id, title: "Trip", priceCents: 100_000, depositCents: 20_000 })
      .returning();
    const [dep] = await tx
      .insert(departures)
      .values({ tenantId: tenant, tripId: trip!.id, departureDate: "2026-05-01", seats: 4 })
      .returning();
    await tx
      .insert(bookings)
      .values({ tenantId: tenant, departureId: dep!.id, customerEmail: "c@example.com", depositCents: 20_000 });
    await tx
      .insert(leads)
      .values({ tenantId: tenant, customerEmail: "l@example.com", request: "Custom trip", portalToken: randomUUID() });
    await tx.insert(metricSnapshots).values({
      tenantId: tenant,
      source: "affiliate",
      channel: "blog",
      metric: "clicks",
      value: 1,
    });
    await tx.insert(aiUsageEvents).values({
      tenantId: tenant,
      agentName: "writer",
      model: "balanced",
      inputTokens: 100,
      outputTokens: 50,
      costUsd: "0.001050",
    });
  });
}

/** Count rows visible in `table` under `tenant`'s RLS scope, as the app role. */
async function countAs(tenant: string, table: string): Promise<number> {
  return withTenant(appDb, tenant, async (tx) => {
    const res = await tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from "${table}"`));
    return Number(res.rows[0]!.n);
  });
}

describe("tenant onboarding + cross-module isolation (Phase 4.3, as app_rw)", () => {
  it("runs as a least-privilege role that does NOT bypass RLS", async () => {
    expect(await isRlsBypassed(appDb)).toBe(false);
  });

  it("onboards tenant #2 via the real path: root by admin, baseline settings by runtime RLS", async () => {
    const t1 = await provisionTenant(adminDb, appDb, { slug: uniq("tenant-1"), name: "Tenant One" });
    const t2 = await provisionTenant(adminDb, appDb, {
      slug: uniq("tenant-2"),
      name: "Tenant Two",
      settings: { brandVoice: { tone: "bold", audience: "explorers" } },
    });

    expect(t1.id).not.toBe(t2.id);
    // Optional override merged onto the defaults.
    expect(t2.settings.brandVoice).toEqual({ tone: "bold", audience: "explorers" });
    expect(t2.settings.specialistAutonomy.writer).toBe("manual"); // default kept

    // Re-onboarding the same slug is idempotent (same id, settings untouched).
    const t2again = await provisionTenant(adminDb, appDb, { slug: t2.slug, name: "Tenant Two (renamed)" });
    expect(t2again.id).toBe(t2.id);

    // Baseline settings were seeded under the runtime role and are RLS-isolated.
    const s1 = await withTenant(appDb, t1.id, (tx) => tx.select().from(tenantSettings));
    const s2 = await withTenant(appDb, t2.id, (tx) => tx.select().from(tenantSettings));
    expect(s1).toHaveLength(1);
    expect(s2).toHaveLength(1);
    expect(s2[0]!.settings.brandVoice.tone).toBe("bold");
    // Tenant #1 never sees tenant #2's settings row.
    expect(s1.every((r) => r.tenantId === t1.id)).toBe(true);
  });

  it("AUDIT: every tenant-scoped table has RLS enable+force + a policy AND the app_rw grant", async () => {
    const gaps: string[] = [];
    for (const table of TENANT_TABLES) {
      const meta = await adminDb.execute<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = ${table}`);
      const row = meta.rows[0];
      if (!row) {
        gaps.push(`${table}: missing table`);
        continue;
      }
      if (!row.relrowsecurity) gaps.push(`${table}: RLS not enabled`);
      if (!row.relforcerowsecurity) gaps.push(`${table}: RLS not forced`);

      const pol = await adminDb.execute<{ n: number }>(
        sql`select count(*)::int as n from pg_policies where tablename = ${table}`,
      );
      if (Number(pol.rows[0]!.n) < 1) gaps.push(`${table}: no tenant policy`);

      for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const granted = await adminDb.execute<{ ok: boolean }>(
          sql`select has_table_privilege('app_rw', ${table}, ${priv}) as ok`,
        );
        if (!granted.rows[0]!.ok) gaps.push(`${table}: app_rw missing ${priv}`);
      }
    }
    expect(gaps, `multi-tenant audit gaps: ${gaps.join("; ")}`).toEqual([]);
  });

  it("AUDIT: the tenants root is read-only for app_rw — only privileged provisioning mints tenants", async () => {
    const canSelect = await adminDb.execute<{ ok: boolean }>(
      sql`select has_table_privilege('app_rw', 'tenants', 'SELECT') as ok`,
    );
    const canInsert = await adminDb.execute<{ ok: boolean }>(
      sql`select has_table_privilege('app_rw', 'tenants', 'INSERT') as ok`,
    );
    expect(canSelect.rows[0]!.ok).toBe(true);
    expect(canInsert.rows[0]!.ok).toBe(false);

    // And it actually fails at runtime as the app role.
    await expect(
      appDb.execute(sql`insert into tenants (slug, name) values (${uniq("nope")}, 'Nope')`),
    ).rejects.toThrow();
  });

  it("ACCEPTANCE: tenant #1 and tenant #2 are fully isolated across the whole data surface", async () => {
    const a = await provisionTenant(adminDb, appDb, { slug: uniq("iso-a"), name: "Iso A" });
    const b = await provisionTenant(adminDb, appDb, { slug: uniq("iso-b"), name: "Iso B" });

    // A representative write in EVERY module's table, per tenant, as app_rw.
    await seedSurface(a.id);
    await seedSurface(b.id);

    // Each tenant sees EXACTLY its own one row in every table (tenant_settings
    // from onboarding, the rest from seedSurface). A leak would show 2.
    for (const table of TENANT_TABLES) {
      expect(await countAs(a.id, table), `${table} visible to A`).toBe(1);
      expect(await countAs(b.id, table), `${table} visible to B`).toBe(1);
    }

    // Belt-and-suspenders: nothing A reads ever carries B's tenant_id.
    const aItems = await withTenant(appDb, a.id, (tx) => tx.select().from(contentItems));
    expect(aItems.every((r) => r.tenantId === a.id)).toBe(true);
    const bItems = await withTenant(appDb, b.id, (tx) => tx.select().from(contentItems));
    expect(bItems.every((r) => r.tenantId === b.id)).toBe(true);
  });
});
