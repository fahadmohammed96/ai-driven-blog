import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { HealthService } from "./health.service";
import { InfraModule } from "./infra.module";
import { TenancyModule } from "./modules/tenancy";
import { ContentModule } from "./modules/content";
import { AuthModule } from "./modules/auth";
import { SocialModule } from "./modules/social";
import { EmailModule } from "./modules/email";
import { SettingsModule } from "./modules/settings";
import { MonetizationModule } from "./modules/monetization";
import { CommerceModule } from "./modules/commerce";
import { CrmModule } from "./modules/crm";
import { AnalyticsModule } from "./modules/analytics";
import { FeedbackModule } from "./modules/feedback";
import { TravelModule } from "./verticals/travel/travel.module";

@Module({
  imports: [
    InfraModule,
    TenancyModule,
    ContentModule,
    AuthModule,
    SocialModule,
    EmailModule,
    SettingsModule,
    MonetizationModule,
    CommerceModule,
    CrmModule,
    AnalyticsModule,
    FeedbackModule,
    TravelModule,
  ],
  controllers: [AppController],
  providers: [HealthService],
})
export class AppModule {}
