import { Module } from "@nestjs/common";
// Depend on other modules via their public barrels, never their internals.
import { TenancyModule } from "../tenancy";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { ANALYTICS_SOURCES } from "./source.port";
import { createAnalyticsSources } from "./sources";

/**
 * Unified analytics (Fase 4, slice 1): ingest cross-channel metrics from internal
 * read models (affiliate/email/social/content — read straight from the shared
 * platform schema) and external stubbed adapters (GA4, Search Console), and serve
 * the dashboard rollup. The DB is provided globally by InfraModule; the source
 * registry is a module-local provider. Tenant-scoped (RLS) like every module.
 */
@Module({
  imports: [TenancyModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    { provide: ANALYTICS_SOURCES, useFactory: createAnalyticsSources },
  ],
  // Exported so the feedback module (Slice 2) can read the cross-channel
  // dashboard read-model through this service rather than the raw tables.
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
