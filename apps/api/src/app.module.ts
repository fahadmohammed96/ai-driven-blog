import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { HealthService } from "./health.service";
import { InfraModule } from "./infra.module";
import { TenancyModule } from "./modules/tenancy";
import { ContentModule } from "./modules/content";
import { AuthModule } from "./modules/auth";
import { SocialModule } from "./modules/social";
import { EmailModule } from "./modules/email";
import { TravelModule } from "./verticals/travel/travel.module";

@Module({
  imports: [
    InfraModule,
    TenancyModule,
    ContentModule,
    AuthModule,
    SocialModule,
    EmailModule,
    TravelModule,
  ],
  controllers: [AppController],
  providers: [HealthService],
})
export class AppModule {}
