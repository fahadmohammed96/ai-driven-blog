import { Controller, Get, Inject, NotFoundException, Param, Redirect } from "@nestjs/common";
import { DB } from "../../platform/tokens";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { TenancyService } from "../tenancy";
import { getAffiliateLinkByCode, recordClick } from "./affiliate.repo";

/**
 * The affiliate redirector (`GET /go/:code`). Resolves a link by its short code,
 * records one click (link · article · channel · timestamp) and 302-redirects to
 * the target URL. Unknown code → 404. The lookup runs in the founder tenant
 * context (n=1 dogfooding, like the newsletter confirm link) so RLS still scopes
 * it — a tenant can only redirect/count its own links. Kept to two lightweight
 * statements so the redirect stays fast.
 */
@Controller("go")
export class RedirectorController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tenancy: TenancyService,
  ) {}

  private get tenantId(): string {
    return this.tenancy.current().tenantId;
  }

  @Get(":code")
  @Redirect()
  async go(@Param("code") code: string): Promise<{ url: string; statusCode: number }> {
    const link = await withTenant(this.db, this.tenantId, async (tx) => {
      const found = await getAffiliateLinkByCode(tx, code);
      if (!found) return null;
      await recordClick(tx, found);
      return found;
    });
    if (!link) throw new NotFoundException();
    return { url: link.targetUrl, statusCode: 302 };
  }
}
