import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { themeSchema } from "@blogs/contracts";
import { DB, EMAIL, LLM } from "../../platform/tokens";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { createProviderRegistryFromEnv } from "../../platform/ai/provider-registry";
import { PostgresMeteringService } from "../../platform/ai/metering";
import { TwoLevelBudgetGuard, BudgetExceededError } from "../../platform/ai/budget-guard";
import { PostgresAgentRunStore } from "../../platform/ai/agent-run-store";
import { TenancyService } from "../tenancy";
import { getTenantSettings } from "../settings";
import {
  getContentItem,
  PostgresAgentProposalStore,
  ProposalNotFoundError,
  ProposalNotPendingError,
  ContentNotFoundError,
} from "../content";
import type { EmailPort } from "./email.port";
import { EmailAgent } from "./agents/email-agent";
import { makeBrandVoiceAccessor, makeSegmentProfileAccessor } from "./email.accessors";
import { makeEmailDraftSink } from "./email-draft-sink";

/**
 * Email Agent entrypoint (Slice S3). `POST /email/suggest` runs the Email Agent
 * against a published article + theme and STAGES its `Proposal<EmailDraft>` in
 * `agent_proposals` (`pending`). `POST /email/proposals/:id/approve` is the
 * Phase-2.5 distribution gate: the human approval sends the draft to the theme's
 * confirmed-opt-in segment (via the injected `EmailDraftSink` → the existing
 * `sendNewsletterToSegment`). Nothing is sent without approval, and re-approving
 * never sends twice (the store's `selectPending` gate is idempotent).
 *
 * The sink is wired HERE (email module) and injected into the store, so
 * `modules/content` never imports `modules/email` (no barrel cycle, DEBT-031c).
 * Wiring otherwise mirrors the SEO/Social staging entrypoints: a metered
 * `metered(stub|anthropic)` port with the platform key + the run-audit store.
 */
@Controller("email")
export class EmailAgentController {
  private readonly proposals: PostgresAgentProposalStore;
  private readonly agent: EmailAgent;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EMAIL) private readonly email: EmailPort,
    // Legacy LLM token injected only to keep DI order stable (as in the SEO/Social
    // staging controllers); the agentic path builds its own metered port below.
    @Inject(LLM) _legacyLlm: unknown,
    private readonly tenancy: TenancyService,
  ) {
    this.proposals = new PostgresAgentProposalStore(db, {
      emailSink: makeEmailDraftSink({
        db,
        email: this.email,
        unsubscribeBaseUrl: this.base("/newsletter/unsubscribe"),
      }),
    });
    const metering = new PostgresMeteringService(db);
    const budget = new TwoLevelBudgetGuard({
      metering,
      resolveBudgetUsd: (tenantId) =>
        withTenant(db, tenantId, (tx) => getTenantSettings(tx)).then((s) => s.budgetUsdMonthly),
    });
    // BYOK-aware metered port source (DEBT-023/025): per-tenant key → platform key
    // → zero-cost stub (CI/E2E). Same metered composition, now tenant-aware.
    const provider = createProviderRegistryFromEnv(db, { metering, budget });
    this.agent = new EmailAgent({
      provider,
      accessors: {
        brandVoice: makeBrandVoiceAccessor(db),
        segmentProfile: makeSegmentProfileAccessor(db),
      },
      store: new PostgresAgentRunStore(db),
      budget,
    });
  }

  private get tenantId(): string {
    return this.tenancy.current().tenantId;
  }

  private base(path: string): string {
    const root = (process.env.PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
    return `${root}${path}`;
  }

  private link(id: string): string | undefined {
    const base = process.env.PUBLIC_BLOG_URL?.replace(/\/$/, "");
    return base ? `${base}/articles/${id}` : undefined;
  }

  @Post("suggest")
  @HttpCode(201)
  async suggest(
    @Body() body: { contentItemId?: unknown; theme?: unknown } | undefined,
  ): Promise<{ id: string; status: string }> {
    const contentItemId = body?.contentItemId;
    if (typeof contentItemId !== "string" || !contentItemId.trim()) {
      throw new BadRequestException("contentItemId is required");
    }
    const parsedTheme = themeSchema.safeParse(body?.theme);
    if (!parsedTheme.success) throw new BadRequestException("theme is required");

    const tenantId = this.tenantId;
    const item = await withTenant(this.db, tenantId, (tx) => getContentItem(tx, contentItemId));
    if (!item) throw new NotFoundException();
    if (item.type !== "article") throw new BadRequestException("content item is not an article");

    const link = this.link(contentItemId);
    const article = {
      title: item.title,
      blocks: item.blocks,
      ...(link ? { link } : {}),
    };
    try {
      const proposal = await this.agent.run(
        { contentItemId, article, theme: parsedTheme.data },
        { tenantId },
      );
      await this.proposals.persist(proposal);
      return { id: proposal.id, status: proposal.status };
    } catch (err) {
      if (err instanceof BudgetExceededError) throw new ConflictException(err.message);
      throw err;
    }
  }

  @Post("proposals/:id/approve")
  @HttpCode(200)
  async approve(@Param("id") id: string): Promise<{ id: string; status: string }> {
    try {
      const item = await this.proposals.approve(this.tenantId, id);
      return { id: item.id, status: item.status };
    } catch (err) {
      throw mapError(err);
    }
  }

  @Post("proposals/:id/reject")
  @HttpCode(200)
  async reject(@Param("id") id: string): Promise<{ ok: true }> {
    try {
      await this.proposals.reject(this.tenantId, id);
      return { ok: true };
    } catch (err) {
      throw mapError(err);
    }
  }
}

function mapError(err: unknown): Error {
  if (err instanceof ProposalNotFoundError) return new NotFoundException();
  if (err instanceof ProposalNotPendingError) return new ConflictException(err.message);
  if (err instanceof ContentNotFoundError) return new NotFoundException();
  return err as Error;
}
