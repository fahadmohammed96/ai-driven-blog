import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Inject,
  Post,
} from "@nestjs/common";
import { DB, LLM } from "../../../platform/tokens";
import type { Db } from "../../../platform/db/client";
import { withTenant } from "../../../platform/db/tenant";
import { createProviderRegistryFromEnv } from "../../../platform/ai/provider-registry";
import { PostgresMeteringService } from "../../../platform/ai/metering";
import { TwoLevelBudgetGuard, BudgetExceededError } from "../../../platform/ai/budget-guard";
import { PostgresAgentRunStore } from "../../../platform/ai/agent-run-store";
import { HashingEmbedder } from "../../../platform/ai/embedder";
import { retrieveSimilar } from "../../../platform/ai/rag";
import { TenancyService } from "../../tenancy";
import { getTenantSettings } from "../../settings";
import { PostgresAgentProposalStore } from "../../content";
import { listLeads } from "../crm.repo";
import { InboundAgent } from "./inbound-agent";

/**
 * Inbound Agent entrypoint (Slice O2). Runs the Inbound triage against a raw
 * inbound message and STAGES its `Proposal<InboundProposal>` in `agent_proposals`
 * (`pending`, type `lead_classification`). Approval flows through the existing
 * `/agent-proposals/:id/approve` gate, whose `lead_classification` branch is
 * ACKNOWLEDGE-ONLY / NO-SEND — nothing is sent and no lead is mutated; the report
 * guides the founder, who then acts via the EXISTING Fase-3 lead pipeline.
 *
 * Wiring mirrors the Analyst (O1) staging entrypoint: a BYOK-aware metered port
 * (per-tenant key → platform key → zero-cost stub) + the run-audit store + the
 * two-level budget guard. The accessors are the in-module lead reader + the
 * settings brand voice + the platform RAG, all RLS-scoped via `withTenant`.
 */
@Controller("crm/agent")
export class InboundAgentController {
  private readonly proposals: PostgresAgentProposalStore;
  private readonly agent: InboundAgent;

  constructor(
    @Inject(DB) private readonly db: Db,
    // Legacy LLM token injected only to keep DI order stable (as in the Analyst
    // staging controller); the agentic path builds its own metered port below.
    @Inject(LLM) _legacyLlm: unknown,
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
    const embedder = new HashingEmbedder();
    this.agent = new InboundAgent({
      provider,
      accessors: {
        leads: (tenantId) => withTenant(db, tenantId, (tx) => listLeads(tx)),
        brandVoice: (tenantId) =>
          withTenant(db, tenantId, (tx) => getTenantSettings(tx)).then((s) => s.brandVoice),
        rag: {
          embed: (text) => embedder.embed(text),
          retrieve: (tenantId, embedding, k) => retrieveSimilar(db, tenantId, embedding, k),
        },
      },
      store: new PostgresAgentRunStore(db),
      budget,
    });
  }

  private get tenantId(): string {
    return this.tenancy.current().tenantId;
  }

  @Post("classify")
  @HttpCode(201)
  async classify(
    @Body() body: { message?: unknown; leadId?: unknown } | undefined,
  ): Promise<{ id: string; status: string }> {
    const message = parseMessage(body?.message);
    const leadId = parseLeadId(body?.leadId);
    const tenantId = this.tenantId;
    try {
      const proposal = await this.agent.run(
        { message, ...(leadId !== undefined ? { leadId } : {}) },
        { tenantId },
      );
      await this.proposals.persist(proposal);
      return { id: proposal.id, status: proposal.status };
    } catch (err) {
      if (err instanceof BudgetExceededError) throw new ConflictException(err.message);
      throw err;
    }
  }
}

/** A non-empty inbound message; rejects missing/blank. */
function parseMessage(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException("message is required");
  }
  return value;
}

/** An optional lead id; rejects a non-string when present. */
function parseLeadId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException("leadId must be a non-empty string");
  }
  return value;
}
