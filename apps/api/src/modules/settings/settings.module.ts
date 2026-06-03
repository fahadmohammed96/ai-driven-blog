import { Module } from "@nestjs/common";
// Depend on another module via its public barrel, never its internals.
import { TenancyModule } from "../tenancy";
import { DB } from "../../platform/tokens";
import type { Db } from "../../platform/db/client";
import {
  createCredentialStore,
  type CredentialStore,
  type OAuthToken,
} from "../../platform/integration";
import { SettingsController } from "./settings.controller";
import { SETTINGS_CREDENTIAL_STORE } from "./settings.tokens";

/**
 * BYOK key storage is OPTIONAL infrastructure: only a tenant that saves its own
 * Anthropic key touches it. So the module must BOOT even when CONNECTOR_SECRET_KEY
 * is absent (DO NO HARM — the live/e2e stack does not always set it). We build
 * the real encrypted store when the key is present, else a guard store that fails
 * loudly ONLY if someone actually tries to seal a BYOK key.
 */
class UnconfiguredCredentialStore implements CredentialStore {
  private fail(): never {
    throw new Error("CONNECTOR_SECRET_KEY is required to store a BYOK API key");
  }
  load(): Promise<OAuthToken | null> {
    return this.fail();
  }
  save(): Promise<void> {
    return this.fail();
  }
}

function settingsCredentialStore(db: Db): CredentialStore {
  return process.env.CONNECTOR_SECRET_KEY
    ? createCredentialStore(db)
    : new UnconfiguredCredentialStore();
}

@Module({
  imports: [TenancyModule],
  controllers: [SettingsController],
  providers: [
    {
      // The encrypted secret store backing BYOK key writes. DB is provided
      // globally by InfraModule.
      provide: SETTINGS_CREDENTIAL_STORE,
      useFactory: settingsCredentialStore,
      inject: [DB],
    },
  ],
})
export class SettingsModule {}
