import type { CredentialStore } from "../integration";
import {
  AnthropicLlmAdapter,
  MeteredLlmAdapter,
  createLlmPortFromEnv,
  type LlmPort,
} from "./llm";
import type { MeteringService } from "./metering";
import type { BudgetGuard } from "./budget-guard";

/**
 * ProviderRegistry — the single source of every agent's {@link LlmPort} (BYOK,
 * agentic-plan §2). It resolves the port PER TENANT: if the tenant has provided
 * its own Anthropic API key it is used; otherwise the platform key (env) backs
 * the call, and in keyless environments (CI/E2E) that is the zero-cost stub.
 *
 * PROVIDER CHOICE IS DRIVEN BY THE CREDENTIAL, NOT BY SETTINGS. The decision is
 * the *existence* of an encrypted `llm_anthropic` credential in
 * `connector_credentials` — looked up through the platform `DbCredentialStore`
 * (both `platform/*`, so the boundary holds; the AI kernel never imports
 * `modules/settings`). `TenantSettings.aiProvider` is only founder-facing
 * metadata that mirrors this state.
 *
 * KEY STORAGE REUSE: the BYOK key reuses the existing AES-256-GCM,
 * RLS-scoped, unique-per-(tenant,connector) `connector_credentials` table — no
 * new table, no migration. The key rides in the `accessToken` slot of the
 * reused `OAuthToken` envelope; `refreshToken`/`expiresAt` are unused for an LLM
 * key (it does not rotate via the OAuth flow). DEBT-023 tracks giving BYOK keys
 * a first-class envelope + a provisioning/onboarding flow.
 */

/**
 * The connector key under which a tenant's Anthropic API key is sealed.
 * TODO(debt): DEBT-023 — the key rides the reused `OAuthToken.accessToken` slot
 * and there is no provisioning/onboarding flow yet.
 */
export const LLM_ANTHROPIC_CONNECTOR = "llm_anthropic";

export interface ProviderRegistryDeps {
  /** Per-tenant encrypted secret store (platform `DbCredentialStore`). */
  store: CredentialStore;
  /**
   * Builds the per-tenant Anthropic port from a decrypted API key. Injectable so
   * tests can assert the exact key without a real network call; defaults to the
   * real `AnthropicLlmAdapter`.
   */
  anthropicFactory?: (apiKey: string) => LlmPort;
  /**
   * Platform-key fallback port. Defaults to the env factory: the real Anthropic
   * port when `ANTHROPIC_API_KEY` is set, else the zero-cost stub (CI/E2E).
   */
  platformFactory?: () => LlmPort;
  /**
   * When BOTH are supplied, every resolved port is wrapped with the R1-B
   * metering+budget decorator (budget checked pre-call, usage metered post-call),
   * so per-tenant cost controls apply whether the key is the tenant's or the
   * platform's. Omitted in unit/arch contexts that have no DB to meter against.
   */
  metering?: MeteringService;
  budget?: BudgetGuard;
}

export class ProviderRegistry {
  private readonly store: CredentialStore;
  private readonly anthropicFactory: (apiKey: string) => LlmPort;
  private readonly platformFactory: () => LlmPort;
  private readonly metering?: MeteringService;
  private readonly budget?: BudgetGuard;

  constructor(deps: ProviderRegistryDeps) {
    this.store = deps.store;
    this.anthropicFactory =
      deps.anthropicFactory ?? ((apiKey) => new AnthropicLlmAdapter({ apiKey }));
    this.platformFactory = deps.platformFactory ?? (() => createLlmPortFromEnv());
    if (deps.metering) this.metering = deps.metering;
    if (deps.budget) this.budget = deps.budget;
  }

  /** Resolve the LlmPort for a tenant: own key if present, else platform key. */
  async getClient(tenantId: string): Promise<LlmPort> {
    const credential = await this.store.load(tenantId, LLM_ANTHROPIC_CONNECTOR);
    const base = credential
      ? this.anthropicFactory(credential.accessToken)
      : this.platformFactory();
    return this.metering && this.budget
      ? new MeteredLlmAdapter(base, { metering: this.metering, budget: this.budget })
      : base;
  }
}
