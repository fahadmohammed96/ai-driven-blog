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
  Query,
} from "@nestjs/common";
import type { Block, PublicationStatus } from "@blogs/contracts";
import { blocksSchema } from "@blogs/contracts";
import { measureAuthenticity, type AuthenticityReport } from "../../platform/ai/authenticity";
import { DB } from "../../platform/tokens";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { TenancyService } from "../tenancy";
import {
  getContentItem,
  listContentItems,
  updateContentItem,
  publishThroughReview,
  applyTransition,
  decideContentItem,
  ContentNotFoundError,
  type ContentItemRow,
  type ContentListFilters,
  type ContentType,
} from "./content.repo";
import { InvalidTransitionError } from "./state-machine";

interface ArticleView {
  id: string;
  type: string;
  status: string;
  title: string;
  blocks: Block[];
  publishedAt: Date | null;
}

/** Result of a state-machine transition (propose/approve/reject). */
interface TransitionView {
  id: string;
  type: string;
  status: string;
  title: string;
}

/** Lightweight list row for the Library surface (no blocks payload). */
interface ContentListItemView {
  id: string;
  type: string;
  status: string;
  title: string;
  publishedAt: Date | null;
  updatedAt: Date;
}

@Controller("articles")
export class ArticlesController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tenancy: TenancyService,
  ) {}

  private get tenantId(): string {
    return this.tenancy.current().tenantId;
  }

  @Get()
  async list(
    @Query("type") type?: string,
    @Query("status") status?: string,
  ): Promise<{ items: ContentListItemView[] }> {
    const filters: ContentListFilters = {};
    if (type) filters.type = type as ContentType;
    if (status) filters.status = status as PublicationStatus;
    const rows = await withTenant(this.db, this.tenantId, (tx) => listContentItems(tx, filters));
    return {
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        title: r.title,
        publishedAt: r.publishedAt,
        updatedAt: r.updatedAt,
      })),
    };
  }

  @Get(":id")
  async get(@Param("id") id: string): Promise<ArticleView> {
    const item = await withTenant(this.db, this.tenantId, (tx) => getContentItem(tx, id));
    if (!item) throw new NotFoundException();
    return {
      id: item.id,
      type: item.type,
      status: item.status,
      title: item.title,
      blocks: item.blocks,
      publishedAt: item.publishedAt,
    };
  }

  // The authenticity meter for a stored item: computed on demand from its
  // canonical blocks with the Fase-1 measurer (platform/ai) that the studio
  // already uses. Informational only — it never gates anything.
  @Get(":id/authenticity")
  async authenticity(@Param("id") id: string): Promise<AuthenticityReport> {
    const item = await withTenant(this.db, this.tenantId, (tx) => getContentItem(tx, id));
    if (!item) throw new NotFoundException();
    return measureAuthenticity(item.blocks);
  }

  @Patch(":id")
  async patch(
    @Param("id") id: string,
    @Body() body: { title?: unknown; blocks?: unknown },
  ): Promise<ArticleView> {
    const patch: { title?: string; blocks?: Block[] } = {};

    if (body?.title !== undefined) {
      if (typeof body.title !== "string") {
        throw new BadRequestException("title must be a string");
      }
      patch.title = body.title;
    }

    if (body?.blocks !== undefined) {
      const parsed = blocksSchema.safeParse(body.blocks);
      if (!parsed.success) {
        throw new BadRequestException("invalid blocks payload");
      }
      patch.blocks = parsed.data;
    }

    // One tenant-scoped transaction: existence (RLS-gated) → update → re-read.
    // RLS makes another tenant's item invisible here, so the write can never
    // cross the tenant boundary; a missing/foreign item surfaces as 404.
    const item = await withTenant(this.db, this.tenantId, async (tx) => {
      const existing = await getContentItem(tx, id);
      if (!existing) return null;
      await updateContentItem(tx, id, patch);
      return getContentItem(tx, id);
    });
    if (!item) throw new NotFoundException();

    return {
      id: item.id,
      type: item.type,
      status: item.status,
      title: item.title,
      blocks: item.blocks,
      publishedAt: item.publishedAt,
    };
  }

  @Post(":id/publish")
  @HttpCode(200)
  async publish(@Param("id") id: string): Promise<{ id: string; status: string; publishedAt: Date | null }> {
    try {
      const item = await publishThroughReview(this.db, this.tenantId, id);
      return { id: item.id, status: item.status, publishedAt: item.publishedAt };
    } catch (err) {
      if (err instanceof ContentNotFoundError) throw new NotFoundException();
      if (err instanceof InvalidTransitionError) throw new ConflictException(err.message);
      throw err;
    }
  }

  // The universal propose→approve gesture over the publish state machine
  // (slice 3 — Proposal Queue). `propose` is the specialist offering work for
  // review (draft→proposed); `approve`/`reject` are the human's decision on an
  // item awaiting review. Each is idempotent on its terminal state and rejects
  // illegal source states with 409; a missing/foreign item is 404 (RLS).
  @Post(":id/propose")
  @HttpCode(200)
  propose(@Param("id") id: string): Promise<TransitionView> {
    return this.transition(() => applyTransition(this.db, this.tenantId, id, "propose"));
  }

  @Post(":id/approve")
  @HttpCode(200)
  approve(@Param("id") id: string): Promise<TransitionView> {
    return this.transition(() => decideContentItem(this.db, this.tenantId, id, "approve"));
  }

  @Post(":id/reject")
  @HttpCode(200)
  reject(@Param("id") id: string): Promise<TransitionView> {
    return this.transition(() => decideContentItem(this.db, this.tenantId, id, "reject"));
  }

  private async transition(run: () => Promise<ContentItemRow>): Promise<TransitionView> {
    try {
      const item = await run();
      return { id: item.id, type: item.type, status: item.status, title: item.title };
    } catch (err) {
      if (err instanceof ContentNotFoundError) throw new NotFoundException();
      if (err instanceof InvalidTransitionError) throw new ConflictException(err.message);
      throw err;
    }
  }
}
