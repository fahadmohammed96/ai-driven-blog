import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import {
  type AffiliateLinkView,
  type AffiliateStats,
  createAffiliateLinkSchema,
  updateAffiliateLinkSchema,
} from "@blogs/contracts";
import { DB } from "../../platform/tokens";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { TenancyService } from "../tenancy";
import {
  type AffiliateLinkWithClicks,
  countClicksByArticle,
  countClicksByChannel,
  countClicksByLink,
  DuplicateCodeError,
  getAffiliateLink,
  insertAffiliateLink,
  listLinksWithClicks,
  updateAffiliateLink,
} from "./affiliate.repo";

/**
 * Affiliate hub surface (Fase 3): the founder creates/edits trackable outbound
 * links and reads click counts. Tenant-scoped behind the tenancy guard + RLS
 * (`withTenant`), so a tenant can never see or touch another tenant's links or
 * counts. The public `/go/:code` redirector lives in {@link RedirectorController}.
 */
@Controller("affiliates")
export class AffiliateController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tenancy: TenancyService,
  ) {}

  private get tenantId(): string {
    return this.tenancy.current().tenantId;
  }

  private view(row: AffiliateLinkWithClicks): AffiliateLinkView {
    return {
      id: row.id,
      code: row.code,
      targetUrl: row.targetUrl,
      contentItemId: row.contentItemId,
      channel: row.channel,
      label: row.label,
      createdAt: row.createdAt.toISOString(),
      clicks: row.clicks,
    };
  }

  @Get()
  async list(): Promise<{ links: AffiliateLinkView[] }> {
    const rows = await withTenant(this.db, this.tenantId, (tx) => listLinksWithClicks(tx));
    return { links: rows.map((r) => this.view(r)) };
  }

  // Aggregated click counts three ways. Declared before any `:param` GET so the
  // literal segment wins the route match.
  @Get("stats")
  stats(): Promise<AffiliateStats> {
    return withTenant(this.db, this.tenantId, async (tx) => ({
      byLink: await countClicksByLink(tx),
      byArticle: await countClicksByArticle(tx),
      byChannel: await countClicksByChannel(tx),
    }));
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown): Promise<AffiliateLinkView> {
    const parsed = createAffiliateLinkSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    try {
      const row = await withTenant(this.db, this.tenantId, (tx) =>
        insertAffiliateLink(tx, { tenantId: this.tenantId, ...parsed.data }),
      );
      // A freshly created link has no clicks yet.
      return {
        id: row.id,
        code: row.code,
        targetUrl: row.targetUrl,
        contentItemId: row.contentItemId,
        channel: row.channel,
        label: row.label,
        createdAt: row.createdAt.toISOString(),
        clicks: 0,
      };
    } catch (err) {
      if (err instanceof DuplicateCodeError) throw new ConflictException(err.message);
      throw err;
    }
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: unknown): Promise<AffiliateLinkView> {
    const parsed = updateAffiliateLinkSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());

    // One tenant-scoped transaction: existence (RLS-gated) → update → re-read the
    // list row (so the response carries the live click count). A missing/foreign
    // item is invisible under RLS → 404.
    const row = await withTenant(this.db, this.tenantId, async (tx) => {
      const existing = await getAffiliateLink(tx, id);
      if (!existing) return null;
      await updateAffiliateLink(tx, id, parsed.data);
      const rows = await listLinksWithClicks(tx);
      return rows.find((r) => r.id === id) ?? null;
    });
    if (!row) throw new NotFoundException();
    return this.view(row);
  }
}
