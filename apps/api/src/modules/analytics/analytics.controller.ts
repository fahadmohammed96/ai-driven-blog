import { Controller, Get, HttpCode, Post } from "@nestjs/common";
import type { AnalyticsDashboard, IngestResult } from "@blogs/contracts";
import { TenancyService } from "../tenancy";
import { AnalyticsService } from "./analytics.service";

/**
 * Unified analytics surface (Fase 4, slice 1): one dashboard of cross-channel
 * metrics. `POST /analytics/ingest` runs ingestion across all sources (internal
 * real + external stubbed); `GET /analytics` serves the unified rollup. Both are
 * tenant-scoped behind the tenancy guard + RLS, so a tenant only ever sees its
 * own metrics.
 */
@Controller("analytics")
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly tenancy: TenancyService,
  ) {}

  private get tenantId(): string {
    return this.tenancy.current().tenantId;
  }

  @Post("ingest")
  @HttpCode(200)
  ingest(): Promise<IngestResult> {
    return this.analytics.ingestAll(this.tenantId);
  }

  @Get()
  dashboard(): Promise<AnalyticsDashboard> {
    return this.analytics.getDashboard(this.tenantId);
  }
}
