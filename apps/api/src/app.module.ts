import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { HealthService } from "./health.service";
import { TenancyModule } from "./modules/tenancy";
import { ContentModule } from "./modules/content";
import { AuthModule } from "./modules/auth";

@Module({
  imports: [TenancyModule, ContentModule, AuthModule],
  controllers: [AppController],
  providers: [HealthService],
})
export class AppModule {}
