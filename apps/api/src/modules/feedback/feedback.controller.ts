import { Controller, Get } from "@nestjs/common";
import type { NextProposal } from "@blogs/contracts";
import { TenancyService } from "../tenancy";
import { FeedbackService } from "./feedback.service";

/**
 * Feedback loop surface (Fase 4, Slice 2). `GET /feedback/proposal` returns the
 * next-cycle AI proposal adapted from the tenant's analytics metrics — the
 * derived signal + the proposal plan (ranked channel emphasis), the prompt-hint
 * fed into generation, and the human-facing "why this proposal" rationale.
 * Tenant-scoped behind the tenancy guard + RLS (via AnalyticsService): a tenant
 * only ever sees a proposal shaped by its own metrics. ADR-0020 stays intact —
 * the loop changes WHAT is proposed, never the human approval gate.
 */
@Controller("feedback")
export class FeedbackController {
  constructor(
    private readonly feedback: FeedbackService,
    private readonly tenancy: TenancyService,
  ) {}

  @Get("proposal")
  proposal(): Promise<NextProposal> {
    return this.feedback.nextProposal(this.tenancy.current().tenantId);
  }
}
