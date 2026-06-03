import { sql } from "drizzle-orm";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { tenantSettings } from "../../platform/db/schema";
import {
  DEFAULT_TENANT_SETTINGS,
  type ProvisionTenantInput,
  type ProvisionedTenant,
  type TenantSettings,
} from "@blogs/contracts";

/**
 * Onboard a new tenant (multi-tenant hardening, Phase 4.3).
 *
 * Two-step, two-privilege flow that mirrors how isolation actually works:
 *  1. The `tenants` row — the tenancy ROOT — is written on the privileged
 *     ADMIN connection. `tenants` has no tenant RLS policy and the runtime
 *     role (`app_rw`) has no INSERT on it, so only privileged provisioning can
 *     mint a tenant. Idempotent on `slug` (re-onboarding refreshes the name).
 *  2. The baseline `tenant_settings` are seeded through the RUNTIME role
 *     (`appDb`) inside the new tenant's RLS scope (`withTenant`). This proves
 *     the freshly-minted tenant is immediately usable under least-privilege
 *     RLS — the same code path every request takes — not just by a superuser.
 */
export async function provisionTenant(
  adminDb: Db,
  appDb: Db,
  input: ProvisionTenantInput,
): Promise<ProvisionedTenant> {
  const settings: TenantSettings = { ...DEFAULT_TENANT_SETTINGS, ...(input.settings ?? {}) };

  // 1) Tenancy root — privileged write on the admin connection.
  const rows = await adminDb.execute<{ id: string }>(
    sql`insert into tenants (slug, name) values (${input.slug}, ${input.name})
        on conflict (slug) do update set name = excluded.name
        returning id`,
  );
  const id = rows.rows[0]?.id;
  if (!id) throw new Error("provisionTenant: failed to create tenant");

  // 2) Baseline settings — seeded as the new tenant via the runtime role (RLS).
  await withTenant(appDb, id, async (tx) => {
    await tx
      .insert(tenantSettings)
      .values({ tenantId: id, settings })
      .onConflictDoNothing({ target: tenantSettings.tenantId });
  });

  return { id, slug: input.slug, name: input.name, settings };
}
