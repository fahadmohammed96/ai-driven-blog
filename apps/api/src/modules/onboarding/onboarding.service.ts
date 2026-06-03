import { Inject, Injectable } from "@nestjs/common";
import type { ProvisionTenantInput, ProvisionedTenant } from "@blogs/contracts";
import { DB } from "../../platform/tokens";
import { createDb, type Db } from "../../platform/db/client";
import { provisionTenant } from "./onboarding";

/** Admin (superuser) connection string — mirrors `main.ts` autoBootstrap. */
function adminUrl(): string {
  return (
    process.env.DATABASE_ADMIN_URL ??
    process.env.DATABASE_URL ??
    "postgresql://blogs:blogs@localhost:5432/blogs"
  );
}

/**
 * Onboarding service: brings a new tenant into being. The tenancy root is
 * written on a short-lived ADMIN connection (privileged, like `main.ts`'s
 * bootstrap); the baseline settings are seeded through the injected runtime
 * role (`DB`, the least-privilege `app_rw`) under the new tenant's RLS scope.
 */
@Injectable()
export class OnboardingService {
  constructor(@Inject(DB) private readonly appDb: Db) {}

  async onboard(input: ProvisionTenantInput): Promise<ProvisionedTenant> {
    const { db: adminDb, pool } = createDb(adminUrl());
    try {
      return await provisionTenant(adminDb, this.appDb, input);
    } finally {
      await pool.end();
    }
  }
}
