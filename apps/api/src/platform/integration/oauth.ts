import { AuthError } from "./connector";

/** An OAuth2 token set for a connector (epoch-ms expiry). */
export interface OAuthToken {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds at which the access token expires. */
  expiresAt: number;
}

/** True when the access token is expired or within `skewMs` of expiring. */
export function isTokenExpired(token: OAuthToken, now: number, skewMs = 30_000): boolean {
  return now + skewMs >= token.expiresAt;
}

/** The channel's token endpoint: exchanges a refresh token for a fresh token set. */
export interface TokenEndpoint {
  refresh(refreshToken: string): Promise<OAuthToken>;
}

/** Persists/loads a connector's token set, scoped to (tenant, connector). */
export interface CredentialStore {
  load(tenantId: string, connector: string): Promise<OAuthToken | null>;
  save(tenantId: string, connector: string, token: OAuthToken): Promise<void>;
}

/**
 * An OAuth2 refresh endpoint over HTTP (standard `grant_type=refresh_token`).
 * Throws AuthError on any non-2xx so the connector surfaces a clean failure.
 */
export function createHttpTokenEndpoint(
  tokenUrl: string,
  fetchImpl: typeof fetch = fetch,
): TokenEndpoint {
  return {
    async refresh(refreshToken: string): Promise<OAuthToken> {
      const res = await fetchImpl(tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
      });
      if (!res.ok) throw new AuthError(`token refresh failed: ${res.status}`);
      const json = (await res.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
      };
      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? refreshToken,
        expiresAt: Date.now() + json.expires_in * 1000,
      };
    },
  };
}

/**
 * Holds a connector's OAuth token valid: returns a non-expired access token,
 * transparently refreshing (and persisting) when it has expired, and exposing a
 * `forceRefresh` for when the channel rejects a token with 401.
 */
export class OAuthSession {
  private readonly now: () => number;

  constructor(
    private readonly deps: {
      store: CredentialStore;
      endpoint: TokenEndpoint;
      tenantId: string;
      connector: string;
      now?: () => number;
    },
  ) {
    this.now = deps.now ?? (() => Date.now());
  }

  async accessToken(): Promise<string> {
    const token = await this.requireToken();
    if (isTokenExpired(token, this.now())) return (await this.refreshAndSave(token)).accessToken;
    return token.accessToken;
  }

  /** Force a refresh (used after the channel returns 401 for a non-expired token). */
  async forceRefresh(): Promise<string> {
    return (await this.refreshAndSave(await this.requireToken())).accessToken;
  }

  private async requireToken(): Promise<OAuthToken> {
    const token = await this.deps.store.load(this.deps.tenantId, this.deps.connector);
    if (!token) throw new AuthError(`no credentials for connector '${this.deps.connector}'`);
    return token;
  }

  private async refreshAndSave(token: OAuthToken): Promise<OAuthToken> {
    const refreshed = await this.deps.endpoint.refresh(token.refreshToken);
    await this.deps.store.save(this.deps.tenantId, this.deps.connector, refreshed);
    return refreshed;
  }
}

/** Simple in-memory CredentialStore (the contract test; not for production). */
export class InMemoryCredentialStore implements CredentialStore {
  private readonly map = new Map<string, OAuthToken>();
  private key(tenantId: string, connector: string): string {
    return `${tenantId}:${connector}`;
  }
  async load(tenantId: string, connector: string): Promise<OAuthToken | null> {
    return this.map.get(this.key(tenantId, connector)) ?? null;
  }
  async save(tenantId: string, connector: string, token: OAuthToken): Promise<void> {
    this.map.set(this.key(tenantId, connector), token);
  }
}
