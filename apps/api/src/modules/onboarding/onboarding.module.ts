import { Module } from "@nestjs/common";
import { InfraModule } from "../../infra.module";
import { AuthModule } from "../auth";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingService } from "./onboarding.service";

/**
 * Tenant onboarding (Phase 4.3). Depends on InfraModule (the runtime `DB`) and
 * the auth module (founder JWT) via their public barrels — never their
 * internals. The privileged admin connection is created on demand inside the
 * service (mirrors `main.ts`), so no extra global wiring is needed.
 */
@Module({
  imports: [InfraModule, AuthModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
