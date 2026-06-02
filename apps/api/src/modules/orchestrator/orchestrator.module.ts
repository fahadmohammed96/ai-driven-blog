import { Module } from "@nestjs/common";
// Depend on other modules via their public barrels only (arch boundary). This
// module is the COMPOSITION ROOT for the Orchestrator (Slice O3, CRUX 1): it
// binds the concrete Writer/SEO/Analyst sub-agents — which the kernel
// `OrchestratorAgent` must not import — into the Orchestrator's injected dispatches.
import { TenancyModule } from "../tenancy";
import { OrchestratorController } from "./orchestrator.controller";

@Module({
  imports: [TenancyModule],
  controllers: [OrchestratorController],
})
export class OrchestratorModule {}
