import { Module } from "@nestjs/common";
// Depend on another module via its public barrel, never its internals.
import { TenancyModule } from "../tenancy";
import { SettingsController } from "./settings.controller";

@Module({
  imports: [TenancyModule],
  controllers: [SettingsController],
})
export class SettingsModule {}
