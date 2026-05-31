import { Module } from "@nestjs/common";
// Depend on another module via its public barrel, never its internals.
import { TenancyModule } from "../tenancy";
import { AffiliateController } from "./affiliate.controller";
import { RedirectorController } from "./redirector.controller";

/**
 * Monetization (Fase 3): the affiliate hub + the `/go/:code` redirector with
 * click tracking. Tenant-scoped (RLS) like every other module.
 */
@Module({
  imports: [TenancyModule],
  controllers: [AffiliateController, RedirectorController],
})
export class MonetizationModule {}
