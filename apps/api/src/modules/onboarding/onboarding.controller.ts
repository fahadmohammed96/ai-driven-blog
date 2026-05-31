import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { provisionTenantInputSchema, type ProvisionedTenant } from "@blogs/contracts";
import { AuthService } from "../auth";
import { OnboardingService } from "./onboarding.service";

/**
 * Tenant onboarding endpoint (`POST /tenants`). Privileged: gated by the founder
 * JWT (the platform operator) — verified the same way `/auth/me` does, since the
 * codebase has no Nest guard. In the n=1 → n=2 model the founder is the
 * super-admin who onboards tenants; a finer admin-role scope is future work
 * (ADR-0027 / DEBT-015).
 */
@Controller("tenants")
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly auth: AuthService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
  ): Promise<ProvisionedTenant> {
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    if (!token) throw new UnauthorizedException("missing bearer token");
    this.auth.verify(token); // throws 401 on an invalid/expired token

    const parsed = provisionTenantInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.onboarding.onboard(parsed.data);
  }
}
