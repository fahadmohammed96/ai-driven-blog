import { Injectable } from "@nestjs/common";
import { type NextProposal, nextProposalFrom } from "@blogs/contracts";
// Depend on the analytics module via its public barrel, never its internals.
import { AnalyticsService } from "../analytics";

/**
 * Feedback loop service (Fase 4, Slice 2). Closes the flywheel: reads the
 * unified analytics dashboard (Slice 1, RLS-scoped read-model) and turns its
 * cross-channel rollups into a deterministic signal that adapts the next
 * cycle's AI proposal. The derivation is pure (`@blogs/contracts` feedback) —
 * this service only orchestrates the read + the transform, tenant-scoped via
 * the analytics service's own `withTenant`.
 */
@Injectable()
export class FeedbackService {
  constructor(private readonly analytics: AnalyticsService) {}

  /** The next-cycle proposal adapted from the tenant's current metrics. */
  async nextProposal(tenantId: string): Promise<NextProposal> {
    const dashboard = await this.analytics.getDashboard(tenantId);
    return nextProposalFrom(dashboard);
  }
}
