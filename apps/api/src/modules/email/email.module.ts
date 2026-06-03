import { Module } from "@nestjs/common";
import { TenancyModule } from "../tenancy";
import { NewsletterController } from "./newsletter.controller";
import { EmailAgentController } from "./email-agent.controller";

/**
 * Email/newsletter (Fase 2): double opt-in + segmented sends, plus the Email
 * Agent staging entrypoint + distribution gate (Slice S3,
 * `POST /email/suggest` · `POST /email/proposals/:id/approve`).
 */
@Module({
  imports: [TenancyModule],
  controllers: [NewsletterController, EmailAgentController],
})
export class EmailModule {}
