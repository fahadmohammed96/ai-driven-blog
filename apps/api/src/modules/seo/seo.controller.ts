import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
} from "@nestjs/common";
import type { Block } from "@blogs/contracts";
import { DB, LLM } from "../../platform/tokens";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { createLlmPortFromEnv } from "../../platform/ai/llm";
import { PostgresMeteringService } from "../../platform/ai/metering";
import { TwoLevelBudgetGuard, BudgetExceededError } from "../../platform/ai/budget-guard";
import { PostgresAgentRunStore } from "../../platform/ai/agent-run-store";
import { TenancyService } from "../tenancy";
import { getTenantSettings } from "../settings";
import { getContentItem, PostgresAgentProposalStore } from "../content";
import { SeoAgent } from "./agents/seo-agent";
import {
  makeInternalLinkCandidatesAccessor,
  makeExistingContentAccessor,
} from "./seo.accessors";

/**
 * SEO Agent entrypoint (Slice S1). Runs the SEO Agent against a content item's
 * draft and STAGES its `Proposal<SeoProposal>` in `agent_proposals` (`pending`).
 * Approval flows through the existing `/agent-proposals/:id/approve` gate, which
 * annotates `content_items.seo_proposal` — NON-BLOCKING, nothing is published.
 *
 * Wiring mirrors the Writer staging entrypoint (`agent-proposals.controller.ts`):
 * a metered `metered(stub|anthropic)` port with the platform key + the run-audit
 * store. BYOK via `ProviderRegistry` on this path is deferred (continues
 * DEBT-023/025).
 */
@Controller("seo")
export class SeoController {
  private readonly proposals: PostgresAgentProposalStore;
  private readonly agent: SeoAgent;

  constructor(
    @Inject(DB) private readonly db: Db,
    // Legacy LLM token injected only to keep DI order stable (as in the Writer
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
    const llm = createLlmPortFromEnv({ metering, budget });
    this.agent = new SeoAgent({
      llm,
      accessors: {
        internalLinkCandidates: makeInternalLinkCandidatesAccessor(db),
        existingContent: makeExistingContentAccessor(db),
      },
      store: new PostgresAgentRunStore(db),
      budget,
    });
  }

  private get tenantId(): string {
    return this.tenancy.current().tenantId;
  }

  @Post("suggest")
  @HttpCode(201)
  async suggest(
    @Body() body: { contentItemId?: unknown } | undefined,
  ): Promise<{ id: string; status: string }> {
    const contentItemId = body?.contentItemId;
    if (typeof contentItemId !== "string" || !contentItemId.trim()) {
      throw new BadRequestException("contentItemId is required");
    }
    const tenantId = this.tenantId;
    const item = await withTenant(this.db, tenantId, (tx) => getContentItem(tx, contentItemId));
    if (!item) throw new NotFoundException();
    const draft = blocksToText(item.blocks);
    try {
      const proposal = await this.agent.run(
        { contentItemId, draft, title: item.title },
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

/** Flatten a content item's canonical blocks into the plain text the agent reads. */
function blocksToText(blocks: Block[]): string {
  return blocks
    .map((b) => (typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : ""))
    .filter(Boolean)
    .join("\n\n");
}
