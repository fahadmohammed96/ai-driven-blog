import { sql } from "drizzle-orm";
import { type TenantSettings, withSettingsDefaults } from "@blogs/contracts";
import { tenantSettings } from "../../platform/db/schema";
import type { Tx } from "../../platform/db/tenant";

/**
 * Read the current tenant's stored settings (RLS scopes to the tenant context),
 * merged with defaults so the result is always a complete {@link TenantSettings}.
 * A tenant with no row yet gets the defaults (manual autonomy everywhere).
 */
export async function getTenantSettings(tx: Tx): Promise<TenantSettings> {
  const rows = await tx.select().from(tenantSettings);
  return withSettingsDefaults(rows[0]?.settings);
}

/**
 * Upsert the current tenant's settings (one row per tenant, keyed by tenant_id).
 * The caller passes the validated, defaults-filled value; RLS WITH CHECK ensures
 * `tenantId` matches the current tenant context, so a cross-tenant write fails.
 * Returns the persisted value.
 */
export async function upsertTenantSettings(
  tx: Tx,
  tenantId: string,
  settings: TenantSettings,
): Promise<TenantSettings> {
  await tx
    .insert(tenantSettings)
    .values({ tenantId, settings, updatedAt: sql`now()` })
    .onConflictDoUpdate({
      target: tenantSettings.tenantId,
      set: { settings, updatedAt: sql`now()` },
    });
  return settings;
}
