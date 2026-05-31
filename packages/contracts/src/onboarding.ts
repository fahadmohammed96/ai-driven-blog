import { z } from "zod";
import { tenantSettingsSchema, type TenantSettings } from "./settings";

/**
 * Tenant onboarding (multi-tenant hardening, Phase 4.3). The tenancy seam
 * (`tenant_id` + RLS) has existed since Phase 0; this is the real, validated
 * PATH to bring a new tenant into being — slug + display name + optional
 * baseline settings. Provisioning the tenancy root is privileged; the runtime
 * least-privilege role never creates tenants.
 */
export const provisionTenantInputSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be kebab-case (a-z, 0-9, -)"),
  name: z.string().min(1).max(200),
  settings: tenantSettingsSchema.partial().optional(),
});

export type ProvisionTenantInput = z.infer<typeof provisionTenantInputSchema>;

/** The result of onboarding: the new tenant id + its seeded baseline settings. */
export interface ProvisionedTenant {
  id: string;
  slug: string;
  name: string;
  settings: TenantSettings;
}
