import {
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import type { Block } from "@blogs/contracts";
import { DB } from "../../platform/tokens";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { TenancyService } from "../tenancy";
import { getContentItem, publishThroughReview, ContentNotFoundError } from "./content.repo";
import { InvalidTransitionError } from "./state-machine";

interface ArticleView {
  id: string;
  type: string;
  status: string;
  title: string;
  blocks: Block[];
  publishedAt: Date | null;
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
}
