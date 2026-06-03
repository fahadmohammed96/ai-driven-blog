/**
 * DI token for the settings module's encrypted secret store. It is the platform
 * `DbCredentialStore` (AES-256-GCM, RLS), injected so tests can swap a store with
 * a known master secret. The settings PUT uses it to seal a tenant's BYOK key.
 */
export const SETTINGS_CREDENTIAL_STORE = Symbol("SETTINGS_CREDENTIAL_STORE");
