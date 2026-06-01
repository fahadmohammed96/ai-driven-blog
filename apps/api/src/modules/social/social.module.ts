import { Module } from "@nestjs/common";
import { TenancyModule } from "../tenancy";
import { SocialController } from "./social.controller";
import { SocialAgentController } from "./social-agent.controller";

/**
 * Distribution (Fase 2): repurpose articles onto social channels, plus the
 * Social Agent staging entrypoint (Slice S2, `POST /social/suggest`).
 */
@Module({
  imports: [TenancyModule],
  controllers: [SocialController, SocialAgentController],
})
export class SocialModule {}
