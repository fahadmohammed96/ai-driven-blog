import {
  BadRequestException,
  Body,
  ConflictException,
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
import {
  repurposeArticle,
  getChannelPosts,
  setPostApproval,
  NotAnArticleError,
  ChannelPostNotFoundError,
} from "./distribution";
import { InvalidPostTransitionError, type PostAction } from "./approval";

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

  @Post(":id/posts/:postId/approve")
  approve(@Param("postId") postId: string): Promise<{ post: ChannelPostView }> {
    return this.settle(postId, "approve");
  }

  @Post(":id/posts/:postId/reject")
  reject(@Param("postId") postId: string): Promise<{ post: ChannelPostView }> {
    return this.settle(postId, "reject");
  }

  /** Human-in-the-loop gate: approve/reject a repurposed post before it can go out. */
  private async settle(postId: string, action: PostAction): Promise<{ post: ChannelPostView }> {
    try {
      const row = await setPostApproval(this.db, this.tenantId, postId, action);
      return { post: toView(row) };
    } catch (err) {
      if (err instanceof ChannelPostNotFoundError) throw new NotFoundException();
      if (err instanceof InvalidPostTransitionError) throw new ConflictException(err.message);
      throw err;
    }
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
