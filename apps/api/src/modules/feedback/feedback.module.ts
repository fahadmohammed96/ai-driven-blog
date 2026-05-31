import { Module } from "@nestjs/common";
// Depend on other modules via their public barrels, never their internals.
import { TenancyModule } from "../tenancy";
import { AnalyticsModule } from "../analytics";
import { FeedbackController } from "./feedback.controller";
import { FeedbackService } from "./feedback.service";

/**
 * Feedback loop (Fase 4, Slice 2): analytics metrics adapt the next cycle's AI
 * proposals. Reads the analytics dashboard read-model (via AnalyticsModule's
 * exported service) and serves the adapted proposal. No new table — the loop
 * works off the existing `metric_snapshots` rollups (real internal + stubbed
 * external), so it is CI-testable today. Tenant-scoped (RLS) like every module.
 */
@Module({
  imports: [TenancyModule, AnalyticsModule],
  controllers: [FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
