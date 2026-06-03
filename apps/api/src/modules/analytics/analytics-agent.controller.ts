import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Inject,
  Post,
} from "@nestjs/common";
import { DB, LLM } from "../../platform/tokens";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { createProviderRegistryFromEnv } from "../../platform/ai/provider-registry";
import { PostgresMeteringService } from "../../platform/ai/metering";
import { TwoLevelBudgetGuard, BudgetExceededError } from "../../platform/ai/budget-guard";
import { PostgresAgentRunStore } from "../../platform/ai/agent-run-store";
import { TenancyService } from "../tenancy";
import { getTenantSettings } from "../settings";
import { PostgresAgentProposalStore } from "../content";
import { AnalyticsService } from "./analytics.service";
import { AnalystAgent, type AnalystMode } from "./agents/analyst-agent";

/**
 * Analyst Agent entrypoint (Slice O1). Runs the Analyst against the tenant's
 * cross-channel metrics and STAGES its `Proposal<PerformanceReport>` in
 * `agent_proposals` (`pending`). Approval flows through the existing
 * `/agent-proposals/:id/approve` gate, whose `analyst_insight` branch is
 * ACKNOWLEDGE-ONLY — nothing is published or mutated, the report is input for the
 * future Orchestrator (O3).
 *
 * Wiring mirrors the SEO/Social staging entrypoints: a BYOK-aware metered port
 * (per-tenant key → platform key → zero-cost stub) + the run-audit store + the
 * two-level budget guard. The dashboard accessor is the in-module
 * `AnalyticsService.getDashboard` (RLS-scoped via `withTenant`).
 */
@Controller("analytics/agent")
export class AnalyticsAgentController {
  private readonly proposals: PostgresAgentProposalStore;
  private readonly agent: AnalystAgent;

  constructor(
    @Inject(DB) private readonly db: Db,
    // Legacy LLM token injected only to keep DI order stable (as in the SEO/Social
    // staging controllers); the agentic path builds its own metered port below.
    @Inject(LLM) _legacyLlm: unknown,
    private readonly analytics: AnalyticsService,
    private readonly tenancy: TenancyService,
  ) {
    this.proposals = new PostgresAgentProposalStore(db);
    const metering = new PostgresMeteringService(db);
    const budget = new TwoLevelBudgetGuard({
      metering,
      resolveBudgetUsd: (tenantId) =>
        withTenant(db, tenantId, (tx) => getTenantSettings(tx)).then((s) => s.budgetUsdMonthly),
    });
    const provider = createProviderRegistryFromEnv(db, { metering, budget });
    this.agent = new AnalystAgent({
      provider,
      accessors: { dashboard: (tenantId) => this.analytics.getDashboard(tenantId) },
      store: new PostgresAgentRunStore(db),
      budget,
    });
  }

  private get tenantId(): string {
    return this.tenancy.current().tenantId;
  }

  @Post("analyze")
  @HttpCode(201)
  async analyze(
    @Body() body: { periodDays?: unknown; mode?: unknown } | undefined,
  ): Promise<{ id: string; status: string }> {
    const periodDays = parsePeriodDays(body?.periodDays);
    const mode = parseMode(body?.mode);
    const tenantId = this.tenantId;
    try {
      const proposal = await this.agent.run({ periodDays, mode }, { tenantId });
      await this.proposals.persist(proposal);
      return { id: proposal.id, status: proposal.status };
    } catch (err) {
      if (err instanceof BudgetExceededError) throw new ConflictException(err.message);
      throw err;
    }
  }
}

const DEFAULT_PERIOD_DAYS = 30;

/** A positive integer window; defaults to 30, rejects non-positive / non-finite. */
function parsePeriodDays(value: unknown): number {
  if (value === undefined) return DEFAULT_PERIOD_DAYS;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestException("periodDays must be a positive integer");
  }
  return value;
}

/** Sync vs batch; defaults to sync (same schema today, DEBT-037). */
function parseMode(value: unknown): AnalystMode {
  if (value === undefined) return "sync";
  if (value !== "sync" && value !== "batch") {
    throw new BadRequestException("mode must be 'sync' or 'batch'");
  }
  return value;
}
