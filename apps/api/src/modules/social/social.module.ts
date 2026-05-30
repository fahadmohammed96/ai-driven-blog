import { Module } from "@nestjs/common";
import { TenancyModule } from "../tenancy";
import { SocialController } from "./social.controller";

/** Distribution (Fase 2): repurpose articles onto social channels. */
@Module({
  imports: [TenancyModule],
  controllers: [SocialController],
})
export class SocialModule {}
