import { describe, it, expect } from "vitest";
import {
  ProviderRegistry,
  LLM_ANTHROPIC_CONNECTOR,
  createProviderRegistryFromEnv,
} from "./provider-registry";
import { StubLlmAdapter, type LlmRequest, type LlmResponse } from "./llm";
import { InMemoryCredentialStore, type CredentialStore } from "../integration";
import type { Db } from "../db/client";
import type { MeteringService } from "./metering";
import type { BudgetGuard } from "./budget-guard";

const TENANT = "11111111-1111-1111-1111-111111111111";

/** Wraps the API key into the reused `OAuthToken` envelope (accessToken = key). */
async function seedTenantKey(store: CredentialStore, tenantId: string, key: string) {
  await store.save(tenantId, LLM_ANTHROPIC_CONNECTOR, {
    accessToken: key,
    // No OAuth refresh/expiry for an LLM key; non-empty placeholder (DEBT-023).
    refreshToken: "byok-no-refresh",
    expiresAt: 0,
  });
}

describe("ProviderRegistry (per-tenant BYOK)", () => {
  it("uses the tenant's own key when an llm_anthropic credential exists", async () => {
    const store = new InMemoryCredentialStore();
    await seedTenantKey(store, TENANT, "sk-tenant-xyz");

    const seenKeys: string[] = [];
    const registry = new ProviderRegistry({
      store,
      anthropicFactory: (apiKey) => {
        seenKeys.push(apiKey);
        return new StubLlmAdapter();
      },
      platformFactory: () => {
        throw new Error("platform key must not be used when a tenant key exists");
      },
    });

    const port = await registry.getClient(TENANT);

    expect(seenKeys).toEqual(["sk-tenant-xyz"]);
    expect(typeof port.complete).toBe("function");
  });

  it("falls back to the platform port when the tenant has no llm_anthropic credential", async () => {
    const platform = new StubLlmAdapter();
    const registry = new ProviderRegistry({
      store: new InMemoryCredentialStore(),
      anthropicFactory: () => {
        throw new Error("tenant adapter must not be built without a credential");
      },
      platformFactory: () => platform,
    });

    const port = await registry.getClient(TENANT);

    expect(port).toBe(platform);
  });

  it("wraps the resolved port with metering+budget when both deps are supplied", async () => {
    const checks: string[] = [];
    const records: string[] = [];
    const budget: BudgetGuard = {
      check: async (tenantId) => {
        checks.push(tenantId);
      },
    };
    const metering: Pick<MeteringService, "record"> = {
      record: async (input) => {
        records.push(input.tenantId);
      },
    };

    const registry = new ProviderRegistry({
      store: new InMemoryCredentialStore(),
      platformFactory: () => new StubLlmAdapter({ content: "x" }),
      metering: metering as MeteringService,
      budget,
    });

    const port = await registry.getClient(TENANT);
    const req: LlmRequest = {
      tenantId: TENANT,
      agentId: "writer",
      runId: "run-1",
      model: "balanced",
      system: [{ text: "sys" }],
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 100,
    };
    const res: LlmResponse = await port.complete(req);

    expect(res.content).toBe("x");
    // The metered decorator ran budget.check (pre) and metering.record (post).
    expect(checks).toEqual([TENANT]);
    expect(records).toEqual([TENANT]);
  });
});

describe("createProviderRegistryFromEnv (DEBT-023 live wiring)", () => {
  it("boots keyless: no CONNECTOR_SECRET_KEY → platform fallback, DB never touched", async () => {
    const prevSecret = process.env.CONNECTOR_SECRET_KEY;
    const prevApiKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.CONNECTOR_SECRET_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      // A DB that throws on ANY access proves the keyless path never queries it.
      const db = new Proxy(
        {},
        {
          get() {
            throw new Error("DB must not be touched without a master secret");
          },
        },
      ) as unknown as Db;

      const registry = createProviderRegistryFromEnv(db);
      const port = await registry.getClient(TENANT);

      // No tenant key + no platform key → the zero-cost stub. CI stays free.
      expect(port).toBeInstanceOf(StubLlmAdapter);
    } finally {
      if (prevSecret !== undefined) process.env.CONNECTOR_SECRET_KEY = prevSecret;
      if (prevApiKey !== undefined) process.env.ANTHROPIC_API_KEY = prevApiKey;
    }
  });
});
