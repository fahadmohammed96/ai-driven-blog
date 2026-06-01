import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client";
import { tenants } from "./schema";

/** Apply pending migrations (idempotent; tracked by drizzle's journal table). */
export async function ensureSchema(db: Db, migrationsFolder: string): Promise<void> {
  await migrate(db, { migrationsFolder });
}

/** Seed the founder tenant if absent (n=1 dogfooding; no RLS on tenants). */
export async function ensureTenant(
  db: Db,
  id: string,
  slug: string,
  name: string,
): Promise<void> {
  await db
    .insert(tenants)
    .values({ id, slug, name })
    .onConflictDoNothing({ target: tenants.id });
}

/** True when the connected role bypasses RLS (superuser) — used to warn in dev. */
export async function isRlsBypassed(db: Db): Promise<boolean> {
  const rows = await db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(
    sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
  );
  const r = rows.rows[0];
  return Boolean(r?.rolsuper || r?.rolbypassrls);
}

/** Tables the runtime app role may touch: tenants is read-only, the rest full DML. */
const APP_READONLY_TABLES = ["tenants"];
const APP_RW_TABLES = [
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
  "ai_agent_runs",
];

/**
 * Provision a least-privilege NOSUPERUSER role for the app's runtime connection
 * so Postgres RLS is actually enforced at runtime (DEBT-005). Idempotent; must
 * run on a superuser/admin connection, after the schema exists.
 */
export async function ensureAppRole(adminDb: Db, role: string, password: string): Promise<void> {
  // Role/password are interpolated into DDL (not parameterizable): validate hard.
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`invalid app role name: ${role}`);
  if (/['\\]/.test(password)) throw new Error("app role password must not contain quotes or backslashes");

  await adminDb.execute(
    sql.raw(
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
          CREATE ROLE ${role} LOGIN NOSUPERUSER;
        END IF;
      END $$;`,
    ),
  );
  await adminDb.execute(sql.raw(`ALTER ROLE ${role} WITH LOGIN NOSUPERUSER PASSWORD '${password}'`));
  await adminDb.execute(sql.raw(`GRANT USAGE ON SCHEMA public TO ${role}`));
  await adminDb.execute(sql.raw(`GRANT SELECT ON ${APP_READONLY_TABLES.join(", ")} TO ${role}`));
  await adminDb.execute(
    sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${APP_RW_TABLES.join(", ")} TO ${role}`),
  );
}
