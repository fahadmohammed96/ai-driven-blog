import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
} from "@nestjs/common";
import { subscribeRequestSchema, sendNewsletterRequestSchema } from "@blogs/contracts";
import { DB, EMAIL } from "../../platform/tokens";
import type { Db } from "../../platform/db/client";
import { TenancyService } from "../tenancy";
import type { EmailPort } from "./email.port";
import { subscribe, confirm, unsubscribe, InvalidConfirmTokenError } from "./optin";
import { sendNewsletterToSegment } from "./newsletter";
import { InvalidOptinTransitionError } from "./optin-state";

/** Newsletter surface: double opt-in subscribe/confirm + segmented send. */
@Controller("newsletter")
export class NewsletterController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EMAIL) private readonly email: EmailPort,
    private readonly tenancy: TenancyService,
  ) {}

  private get tenantId(): string {
    return this.tenancy.current().tenantId;
  }

  private base(path: string): string {
    const root = (process.env.PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
    return `${root}${path}`;
  }

  @Post("subscribe")
  @HttpCode(202)
  async subscribe(@Body() body: unknown): Promise<{ status: string; alreadyConfirmed: boolean }> {
    const parsed = subscribeRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return subscribe(
      { db: this.db, email: this.email },
      {
        tenantId: this.tenantId,
        email: parsed.data.email,
        themes: parsed.data.themes,
        confirmBaseUrl: this.base("/newsletter/confirm"),
      },
    );
  }

  @Get("confirm")
  async confirm(@Query("token") token: string): Promise<{ email: string; status: string }> {
    return this.applyToken(() => confirm({ db: this.db }, { tenantId: this.tenantId, token }));
  }

  @Get("unsubscribe")
  async unsubscribe(@Query("token") token: string): Promise<{ email: string; status: string }> {
    return this.applyToken(() => unsubscribe({ db: this.db }, { tenantId: this.tenantId, token }));
  }

  @Post("send")
  @HttpCode(200)
  async send(@Body() body: unknown): Promise<{ recipients: string[]; sent: number }> {
    const parsed = sendNewsletterRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const { recipients } = await sendNewsletterToSegment(
      { db: this.db, email: this.email },
      {
        tenantId: this.tenantId,
        theme: parsed.data.theme,
        subject: parsed.data.subject,
        html: parsed.data.html,
        unsubscribeBaseUrl: this.base("/newsletter/unsubscribe"),
      },
    );
    return { recipients, sent: recipients.length };
  }

  private async applyToken<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof InvalidConfirmTokenError) throw new BadRequestException(err.message);
      if (err instanceof InvalidOptinTransitionError) throw new ConflictException(err.message);
      throw err;
    }
  }
}
