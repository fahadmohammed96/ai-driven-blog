import { sql } from "drizzle-orm";
import type { Db } from "./client";

/** A Drizzle transaction handle (same query surface as Db), as passed by `db.transaction`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Run `fn` inside a transaction bound to a tenant: sets `app.current_tenant`
 * (transaction-local) so Postgres RLS scopes every statement to that tenant.
 * This is the single seam through which tenant-scoped repos touch the DB.
 */
export async function withTenant<T>(
  db: Db,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_tenant', ${tenantId}, true)`);
    return fn(tx);
  });
}
