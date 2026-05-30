import { Module } from "@nestjs/common";
import { TenancyModule } from "../tenancy";
import { NewsletterController } from "./newsletter.controller";

/** Email/newsletter (Fase 2): double opt-in + segmented sends. */
@Module({
  imports: [TenancyModule],
  controllers: [NewsletterController],
})
export class EmailModule {}
