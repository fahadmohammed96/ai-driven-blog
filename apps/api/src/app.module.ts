import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { HealthService } from "./health.service";
import { TenancyModule } from "./modules/tenancy";
import { ContentModule } from "./modules/content";

@Module({
  imports: [TenancyModule, ContentModule],
  controllers: [AppController],
  providers: [HealthService],
})
export class AppModule {}
