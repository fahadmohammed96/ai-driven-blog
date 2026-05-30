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
