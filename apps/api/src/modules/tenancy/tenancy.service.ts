import { Injectable } from "@nestjs/common";

export interface TenantContext {
  tenantId: string;
}

/** The single dogfooding tenant (n=1) until tenant #2 brings real resolution. */
export const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Stub: in the real system the tenant is resolved from the request (JWT/host).
 * Kept tenant-aware from day 1 (ADR-0002), hardened at tenant #2.
 */
@Injectable()
export class TenancyService {
  current(): TenantContext {
    return { tenantId: process.env.FOUNDER_TENANT_ID ?? DEFAULT_TENANT_ID };
  }
}
