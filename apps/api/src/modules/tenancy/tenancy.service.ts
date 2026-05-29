import { Injectable } from "@nestjs/common";

export interface TenantContext {
  tenantId: string;
}

/**
 * Stub: in the real system the tenant is resolved from the request (JWT/host).
 * Kept tenant-aware from day 1 (ADR-0002), hardened at tenant #2.
 */
@Injectable()
export class TenancyService {
  current(): TenantContext {
    return { tenantId: "00000000-0000-0000-0000-000000000000" };
  }
}
