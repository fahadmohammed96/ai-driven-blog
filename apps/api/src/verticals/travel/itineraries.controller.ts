import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { itinerarySchema } from "@blogs/contracts";
import { DB, STORAGE, LLM } from "../../platform/tokens";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import type { StoragePort } from "../../modules/media";
import type { LlmClient } from "../../platform/ai/llm";
import { type BrandVoice } from "../../platform/ai/pipeline";
import { TenancyService } from "../../modules/tenancy";
import { insertContentItem } from "../../modules/content";
import { saveItinerary, loadItinerary } from "./itinerary.repo";
import { attachPhotoToItinerary, loadItineraryPhotos } from "./itinerary-photos";
import { assembleArticleFromItinerary, type ArticleDraft } from "./article";

interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

// Founder's default brand voice (per-tenant voice config comes with multi-user).
const FOUNDER_VOICE: BrandVoice = {
  tone: "personale e curioso",
  audience: "viaggiatori indipendenti",
};

@Controller("itineraries")
export class ItinerariesController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: StoragePort,
    @Inject(LLM) private readonly llm: LlmClient,
    private readonly tenancy: TenancyService,
  ) {}

  private get tenantId(): string {
    return this.tenancy.current().tenantId;
  }

  @Post()
  async create(@Body() body: unknown): Promise<{ id: string }> {
    const parsed = itinerarySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const id = await saveItinerary(this.db, this.tenantId, parsed.data);
    return { id };
  }

  @Post(":id/photos")
  @UseInterceptors(FileInterceptor("file"))
  async addPhoto(
    @Param("id") id: string,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<{ assetId: string; stopId: string | null }> {
    if (!file?.buffer?.length) throw new BadRequestException("missing file");
    return attachPhotoToItinerary(
      { db: this.db, storage: this.storage },
      { tenantId: this.tenantId, itineraryId: id, buffer: file.buffer },
    );
  }

  @Post(":id/article")
  async generateArticle(
    @Param("id") id: string,
    @Body() body: { userNotes?: string } | undefined,
  ): Promise<{ articleId: string } & Pick<ArticleDraft, "blocks" | "authenticity">> {
    const itinerary = await loadItinerary(this.db, this.tenantId, id);
    if (!itinerary) throw new BadRequestException("itinerary not found");
    const photos = await loadItineraryPhotos(this.db, this.tenantId, id);

    const draft = await assembleArticleFromItinerary(
      { llm: this.llm },
      {
        itinerary,
        voice: FOUNDER_VOICE,
        photos,
        ...(body?.userNotes ? { userNotes: body.userNotes } : {}),
      },
    );

    const article = await withTenant(this.db, this.tenantId, (tx) =>
      insertContentItem(tx, {
        tenantId: this.tenantId,
        type: "article",
        title: itinerary.title,
        blocks: draft.blocks,
      }),
    );

    return { articleId: article.id, blocks: draft.blocks, authenticity: draft.authenticity };
  }
}
