import { BadRequestException, Body, Controller, Get, Inject, Put } from "@nestjs/common";
import {
  type TenantSettings,
  tenantSettingsSchema,
  withSettingsDefaults,
} from "@blogs/contracts";
import { DB } from "../../platform/tokens";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import type { CredentialStore } from "../../platform/integration";
import { LLM_ANTHROPIC_CONNECTOR } from "../../platform/ai/provider-registry";
import { TenancyService } from "../tenancy";
import { SETTINGS_CREDENTIAL_STORE } from "./settings.tokens";
import { getTenantSettings, upsertTenantSettings } from "./settings.repo";

/**
 * Tenant settings surface — the founder's per-tenant configuration: brand voice,
 * per-specialist autonomy, channels, the monthly AI budget cap, the AI provider
 * (BYOK), and the audit policy. Behind the tenancy guard + RLS (`withTenant`), so
 * a tenant can never read or write another tenant's settings. GET returns
 * defaults when no row exists yet.
 *
 * BYOK (Slice T2): the PUT body may carry a write-only `apiKey`. When present it
 * is sealed (AES-256-GCM, RLS) as the tenant's `llm_anthropic` credential via the
 * platform `DbCredentialStore` — the same store `ProviderRegistry` reads to build
 * the per-tenant Anthropic port. The plaintext key is NEVER stored in
 * `tenant_settings` nor returned by GET; `aiProvider.connector` is mirrored to
 * `'anthropic'` so the UI can render "configurata" without touching the secret.
 * The credential (not the field) is the runtime source of truth — see DEBT-026.
 */
@Controller("settings")
export class SettingsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SETTINGS_CREDENTIAL_STORE) private readonly credentials: CredentialStore,
    private readonly tenancy: TenancyService,
  ) {}

  private get tenantId(): string {
    return this.tenancy.current().tenantId;
  }

  @Get()
  get(): Promise<TenantSettings> {
    return withTenant(this.db, this.tenantId, (tx) => getTenantSettings(tx));
  }

  @Put()
  async put(@Body() body: unknown): Promise<TenantSettings> {
    // Pull the write-only BYOK key off the raw body BEFORE validation: the
    // settings schema strips it, so it can never be persisted in tenant_settings.
    const apiKey = extractApiKey(body);
    // Fill any omitted fields with defaults, then validate the whole shape.
    const parsed = tenantSettingsSchema.safeParse(withSettingsDefaults(body));
    if (!parsed.success) throw new BadRequestException("invalid settings payload");
    const settings = parsed.data;

    if (apiKey) {
      // Seal the tenant's own Anthropic key (reuses the encrypted, RLS-scoped
      // connector_credentials table; the key rides the accessToken slot, DEBT-023).
      await this.credentials.save(this.tenantId, LLM_ANTHROPIC_CONNECTOR, {
        accessToken: apiKey,
        // An LLM key has no OAuth refresh/expiry; a non-empty placeholder keeps
        // the reused envelope sealable (empty → malformed ciphertext). DEBT-023.
        refreshToken: "byok-no-refresh",
        expiresAt: 0,
      });
      // Mirror runtime state into the founder-facing metadata so GET can show the
      // key is configured without ever reading the secret back.
      // TODO(debt): DEBT-026 — the credential (not this field) is the source of
      // truth; a credential created/deleted outside this surface won't sync it.
      settings.aiProvider = { connector: "anthropic" };
    }

    // RLS WITH CHECK binds the write to the current tenant — no cross-tenant write.
    return withTenant(this.db, this.tenantId, (tx) =>
      upsertTenantSettings(tx, this.tenantId, settings),
    );
  }
}

/** Read an optional, non-empty write-only `apiKey` off a raw PUT body. */
function extractApiKey(body: unknown): string | null {
  const raw = (body ?? {}) as Record<string, unknown>;
  const v = raw.apiKey;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
