import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  UnprocessableEntityException,
} from "@nestjs/common";
import { channelSchema, type Channel } from "@blogs/contracts";
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
import { SocialAgent, NoProducibleChannelsError } from "./agents/social-agent";
import { NotAnArticleError } from "./distribution";
import type { ArticleContent } from "./repurpose";
import { makeBrandContextAccessor } from "./social.accessors";

/**
 * Social Agent entrypoint (Slice S2). Runs the Social Agent against a published
 * article and STAGES its `Proposal<ChannelPostMap>` in `agent_proposals`
 * (`pending`). Approval flows through the existing `/agent-proposals/:id/approve`
 * gate, which inserts the posts as `channel_posts` at `draft` — the Phase-2.5
 * per-post approval gate stays the final gate before anything goes out.
 *
 * Wiring mirrors the SEO staging entrypoint: a metered `metered(stub|anthropic)`
 * port with the platform key + the run-audit store. BYOK via `ProviderRegistry`
 * on this path is deferred (continues DEBT-023/025).
 */
@Controller("social")
export class SocialAgentController {
  private readonly proposals: PostgresAgentProposalStore;
  private readonly agent: SocialAgent;

  constructor(
    @Inject(DB) private readonly db: Db,
    // Legacy LLM token injected only to keep DI order stable (as in the SEO
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
    this.agent = new SocialAgent({
      llm,
      accessors: { brandContext: makeBrandContextAccessor(db) },
      store: new PostgresAgentRunStore(db),
      budget,
    });
  }

  private get tenantId(): string {
    return this.tenancy.current().tenantId;
  }

  private link(id: string): string | undefined {
    const base = process.env.PUBLIC_BLOG_URL?.replace(/\/$/, "");
    return base ? `${base}/articles/${id}` : undefined;
  }

  @Post("suggest")
  @HttpCode(201)
  async suggest(
    @Body() body: { contentItemId?: unknown; channels?: unknown } | undefined,
  ): Promise<{ id: string; status: string }> {
    const contentItemId = body?.contentItemId;
    if (typeof contentItemId !== "string" || !contentItemId.trim()) {
      throw new BadRequestException("contentItemId is required");
    }
    const channels = parseChannels(body?.channels);
    if (channels.length === 0) throw new BadRequestException("channels is required");

    const tenantId = this.tenantId;
    const item = await withTenant(this.db, tenantId, (tx) => getContentItem(tx, contentItemId));
    if (!item) throw new NotFoundException();
    if (item.type !== "article") throw new BadRequestException("content item is not an article");

    const link = this.link(contentItemId);
    const article: ArticleContent = {
      title: item.title,
      blocks: item.blocks,
      ...(link ? { link } : {}),
    };
    try {
      const proposal = await this.agent.run({ contentItemId, article, channels }, { tenantId });
      await this.proposals.persist(proposal);
      return { id: proposal.id, status: proposal.status };
    } catch (err) {
      if (err instanceof BudgetExceededError) throw new ConflictException(err.message);
      if (err instanceof NotAnArticleError) throw new BadRequestException(err.message);
      if (err instanceof NoProducibleChannelsError)
        throw new UnprocessableEntityException(err.message);
      throw err;
    }
  }
}

/** Validate the requested channels against the channel enum; drop anything else. */
function parseChannels(value: unknown): Channel[] {
  if (!Array.isArray(value)) return [];
  const out: Channel[] = [];
  for (const c of value) {
    const parsed = channelSchema.safeParse(c);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
