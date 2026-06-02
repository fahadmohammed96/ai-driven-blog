import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { PgBoss } from "pg-boss";
import type { Db } from "./client";
import { tenants } from "./schema";

/** The dedicated, NON-tenant-scoped schema pg-boss owns (Slice O0, ADR-0030). */
export const PGBOSS_SCHEMA = "pgboss";

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
  "agent_proposals",
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

/** A baseline queue created admin-side so the runtime app role never runs DDL. */
export interface PgBossQueueSpec {
  name: string;
  /** Subset of pg-boss queue options we set on baseline queues (retry policy). */
  options?: { retryLimit?: number; retryDelay?: number; policy?: string };
}

/**
 * Install the pg-boss platform queue (Slice O0, ADR-0030) — ADMIN-SIDE ONLY.
 *
 * DESIGN CRUX (least-privilege): pg-boss needs DDL to create/migrate its schema
 * and (for partitioned queues) per-queue tables. The runtime app role is
 * `app_rw` NOSUPERUSER (DEBT-005) and CANNOT do DDL. So ALL pg-boss DDL happens
 * here, on the admin connection: we spin a throwaway PgBoss with `migrate:true`,
 * `start()` (which installs/migrates the `pgboss` schema as admin), create the
 * baseline queues (so `app_rw` never has to `CREATE` anything — non-partition
 * queues land in pg-boss's shared job table), then `stop()`. Idempotent: a second
 * run finds the schema present and the queue inserts are `ON CONFLICT DO NOTHING`.
 *
 * NOTE: pg-boss tables are infra, NOT tenant-scoped — they intentionally get NO
 * RLS / `tenant_id` (an explicit exception to the tenant-table rule); isolation
 * for the work they carry is enforced by the agent runner's per-tenant `taskId`
 * and the RLS already on `ai_agent_runs`.
 */
export async function ensurePgBoss(
  adminConnectionString: string,
  queues: PgBossQueueSpec[],
): Promise<void> {
  const boss = new PgBoss({
    connectionString: adminConnectionString,
    schema: PGBOSS_SCHEMA,
    // Admin context: DDL is allowed here and ONLY here.
    migrate: true,
    createSchema: true,
    // No background work on the installer instance — it just provisions and exits.
    supervise: false,
    schedule: false,
  });
  await boss.start();
  try {
    for (const q of queues) {
      await boss.createQueue(q.name, { ...(q.options ?? {}) });
    }
  } finally {
    await boss.stop({ graceful: false });
  }
}

/**
 * Grant the runtime app role (`app_rw`) the DML it needs on the pg-boss schema —
 * NEVER DDL. With the schema + baseline queues already provisioned admin-side
 * (see {@link ensurePgBoss}), the worker only ever sends/fetches/completes jobs,
 * which is SELECT/INSERT/UPDATE/DELETE on existing tables plus EXECUTE on
 * pg-boss's helper functions. Idempotent; run AFTER `ensurePgBoss` (schema must
 * exist) and AFTER the role exists (see {@link ensureAppRole}).
 */
export async function grantPgBossSchema(adminDb: Db, role: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`invalid app role name: ${role}`);
  await adminDb.execute(sql.raw(`GRANT USAGE ON SCHEMA ${PGBOSS_SCHEMA} TO ${role}`));
  await adminDb.execute(
    sql.raw(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${PGBOSS_SCHEMA} TO ${role}`,
    ),
  );
  await adminDb.execute(
    sql.raw(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${PGBOSS_SCHEMA} TO ${role}`),
  );
  await adminDb.execute(
    sql.raw(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${PGBOSS_SCHEMA} TO ${role}`),
  );
}
