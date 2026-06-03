import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { HealthService } from "./health.service";
import { InfraModule } from "./infra.module";
import { TenancyModule } from "./modules/tenancy";
import { ContentModule } from "./modules/content";
import { AuthModule } from "./modules/auth";
import { SocialModule } from "./modules/social";
import { SeoModule } from "./modules/seo";
import { EmailModule } from "./modules/email";
import { SettingsModule } from "./modules/settings";
import { MonetizationModule } from "./modules/monetization";
import { CommerceModule } from "./modules/commerce";
import { CrmModule } from "./modules/crm";
import { AnalyticsModule } from "./modules/analytics";
import { FeedbackModule } from "./modules/feedback";
import { OnboardingModule } from "./modules/onboarding";
import { ChannelsModule } from "./modules/channels";
import { OrchestratorModule } from "./modules/orchestrator/orchestrator.module";
import { TravelModule } from "./verticals/travel/travel.module";

@Module({
  imports: [
    InfraModule,
    TenancyModule,
    ContentModule,
    AuthModule,
    SocialModule,
    SeoModule,
    EmailModule,
    SettingsModule,
    MonetizationModule,
    CommerceModule,
    CrmModule,
    AnalyticsModule,
    FeedbackModule,
    OnboardingModule,
    ChannelsModule,
    OrchestratorModule,
    TravelModule,
  ],
  controllers: [AppController],
  providers: [HealthService],
})
export class AppModule {}
