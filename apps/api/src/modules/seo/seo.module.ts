import { Module } from "@nestjs/common";
// Depend on other modules via their public barrels, never their internals.
import { TenancyModule } from "../tenancy";
import { SeoController } from "./seo.controller";

/**
 * SEO module (Slice S1): registers the SEO Agent's entrypoint. The agent + tools
 * are plain classes wired inside the controller (same pattern as the Writer
 * staging controller); the module just exposes `POST /seo/suggest` and pulls in
 * the tenant context. DB/LLM come from the global `InfraModule`.
 */
@Module({
  imports: [TenancyModule],
  controllers: [SeoController],
})
export class SeoModule {}
