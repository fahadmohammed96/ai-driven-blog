import { Module } from "@nestjs/common";
// Depend on other modules via their public barrels, never their internals.
import { TenancyModule } from "../tenancy";
import { ContentModule } from "../content";
import { CommerceController } from "./commerce.controller";

/**
 * Commerce (Fase 3, motion "Programmato"): Trips/Departures + the booking →
 * deposit → confirm flow (waitlist when full). The PaymentPort (`PAYMENT` token)
 * is provided globally by InfraModule. Tenant-scoped (RLS) like every module.
 */
@Module({
  imports: [TenancyModule, ContentModule],
  controllers: [CommerceController],
})
export class CommerceModule {}
