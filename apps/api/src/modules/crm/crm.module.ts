import { Module } from "@nestjs/common";
// Depend on other modules via their public barrels, never their internals.
import { TenancyModule } from "../tenancy";
import { SettingsModule } from "../settings";
import { CrmController } from "./crm.controller";

/**
 * CRM custom-trip pipeline (Fase 3, motion "Su misura" — INBOUND/one-to-one). The
 * inbound lead → AI proposal → human approval (gate) → deposit → confirm → deliver
 * flow, with a tokenized client portal. The LLM (`LLM`), PaymentPort (`PAYMENT`)
 * and NotificationPort (`NOTIFICATION`) are provided globally by InfraModule.
 * Tenant-scoped (RLS) like every module.
 */
@Module({
  imports: [TenancyModule, SettingsModule],
  controllers: [CrmController],
})
export class CrmModule {}
