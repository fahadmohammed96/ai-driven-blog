import { BadRequestException, Body, Controller, Get, Inject, Put } from "@nestjs/common";
import {
  type TenantSettings,
  tenantSettingsSchema,
  withSettingsDefaults,
} from "@blogs/contracts";
import { DB } from "../../platform/tokens";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { TenancyService } from "../tenancy";
import { getTenantSettings, upsertTenantSettings } from "./settings.repo";

/**
 * Tenant settings surface (content-hub, slice 4): the founder's per-tenant
 * configuration — brand voice, per-specialist autonomy (STUB), channels. Behind
 * the tenancy guard + RLS (`withTenant`), so a tenant can never read or write
 * another tenant's settings. GET returns defaults when no row exists yet.
 */
@Controller("settings")
export class SettingsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tenancy: TenancyService,
  ) {}

  private get tenantId(): string {
    return this.tenancy.current().tenantId;
  }

  @Get()
  get(): Promise<TenantSettings> {
    return withTenant(this.db, this.tenantId, (tx) => getTenantSettings(tx));
  }

  @Put()
  async put(@Body() body: unknown): Promise<TenantSettings> {
    // Fill any omitted fields with defaults, then validate the whole shape.
    const parsed = tenantSettingsSchema.safeParse(withSettingsDefaults(body));
    if (!parsed.success) throw new BadRequestException("invalid settings payload");
    // RLS WITH CHECK binds the write to the current tenant — no cross-tenant write.
    return withTenant(this.db, this.tenantId, (tx) =>
      upsertTenantSettings(tx, this.tenantId, parsed.data),
    );
  }
}
