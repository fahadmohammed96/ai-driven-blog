import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { withTenant } from "../db/tenant";
import { connectorCredentials } from "../db/schema";
import { sealSecret, openSecret } from "./crypto";
import type { CredentialStore, OAuthToken } from "./oauth";

/**
 * Postgres-backed CredentialStore: token sets are sealed (AES-256-GCM) at rest
 * and isolated per tenant by RLS (every access goes through `withTenant`).
 */
export class DbCredentialStore implements CredentialStore {
  constructor(
    private readonly db: Db,
    private readonly masterSecret: string,
  ) {}

  async load(tenantId: string, connector: string): Promise<OAuthToken | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(connectorCredentials)
        .where(eq(connectorCredentials.connector, connector));
      const row = rows[0];
      if (!row) return null;
      return {
        accessToken: openSecret(row.accessToken, this.masterSecret),
        refreshToken: openSecret(row.refreshToken, this.masterSecret),
        expiresAt: row.expiresAt.getTime(),
      };
    });
  }

  async save(tenantId: string, connector: string, token: OAuthToken): Promise<void> {
    const values = {
      tenantId,
      connector,
      accessToken: sealSecret(token.accessToken, this.masterSecret),
      refreshToken: sealSecret(token.refreshToken, this.masterSecret),
      expiresAt: new Date(token.expiresAt),
    };
    await withTenant(this.db, tenantId, (tx) =>
      tx
        .insert(connectorCredentials)
        .values(values)
        .onConflictDoUpdate({
          target: [connectorCredentials.tenantId, connectorCredentials.connector],
          set: {
            accessToken: values.accessToken,
            refreshToken: values.refreshToken,
            expiresAt: values.expiresAt,
            updatedAt: sql`now()`,
          },
        }),
    );
  }

  /** Remove a tenant's credential for a connector (RLS-scoped). Idempotent. */
  async delete(tenantId: string, connector: string): Promise<void> {
    await withTenant(this.db, tenantId, (tx) =>
      tx.delete(connectorCredentials).where(eq(connectorCredentials.connector, connector)),
    );
  }
}

/**
 * Build a DB credential store from env (CONNECTOR_SECRET_KEY seals the tokens).
 * TODO(debt): DEBT-008 — there is no OAuth connect/onboarding flow nor secure
 * provisioning of the master key yet; the store assumes credentials already exist.
 */
export function createCredentialStore(db: Db): DbCredentialStore {
  const secret = process.env.CONNECTOR_SECRET_KEY;
  if (!secret) throw new Error("CONNECTOR_SECRET_KEY is required to seal connector credentials");
  return new DbCredentialStore(db, secret);
}
