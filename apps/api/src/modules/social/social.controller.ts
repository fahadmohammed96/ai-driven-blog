import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
} from "@nestjs/common";
import { repurposeRequestSchema, type ChannelPost } from "@blogs/contracts";
import { DB } from "../../platform/tokens";
import type { Db } from "../../platform/db/client";
import { TenancyService } from "../tenancy";
import { ContentNotFoundError } from "../content";
import { ChannelRequiresImageError } from "./repurpose";
import { repurposeArticle, getChannelPosts, NotAnArticleError } from "./distribution";

interface ChannelPostView {
  id: string;
  channel: string;
  status: string;
  payload: ChannelPost;
}

/** Distribution surface: project a published article onto social channels. */
@Controller("articles")
export class SocialController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tenancy: TenancyService,
  ) {}

  private get tenantId(): string {
    return this.tenancy.current().tenantId;
  }

  private link(id: string): string | undefined {
    const base = process.env.PUBLIC_BLOG_URL?.replace(/\/$/, "");
    return base ? `${base}/articles/${id}` : undefined;
  }

  @Post(":id/repurpose")
  async repurpose(
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<{ posts: ChannelPostView[] }> {
    const parsed = repurposeRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());

    const link = this.link(id);
    try {
      const rows = await repurposeArticle(this.db, this.tenantId, id, parsed.data.channels, {
        ...(link ? { link } : {}),
      });
      return { posts: rows.map(toView) };
    } catch (err) {
      if (err instanceof ContentNotFoundError) throw new NotFoundException();
      if (err instanceof NotAnArticleError) throw new BadRequestException(err.message);
      if (err instanceof ChannelRequiresImageError)
        throw new UnprocessableEntityException(err.message);
      throw err;
    }
  }

  @Get(":id/posts")
  async list(@Param("id") id: string): Promise<{ posts: ChannelPostView[] }> {
    const rows = await getChannelPosts(this.db, this.tenantId, id);
    return { posts: rows.map(toView) };
  }
}

function toView(row: {
  id: string;
  channel: string;
  status: string;
  payload: ChannelPost;
}): ChannelPostView {
  return { id: row.id, channel: row.channel, status: row.status, payload: row.payload };
}
