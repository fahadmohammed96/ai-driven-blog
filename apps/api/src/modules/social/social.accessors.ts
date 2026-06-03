import type { Channel } from "@blogs/contracts";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { getTenantSettings } from "../settings";
import type { BrandContextAccessor } from "./agents/social-agent";

/**
 * Real, RLS-scoped data accessor the social controller injects into the Social
 * Agent (the boundary seam — the agent itself stays pure). The brand voice and
 * the enabled channels both come from `tenant_settings`, read under the tenant's
 * RLS scope via `getTenantSettings`.
 */
export function makeBrandContextAccessor(db: Db): BrandContextAccessor {
  return async (tenantId) =>
    withTenant(db, tenantId, async (tx) => {
      const settings = await getTenantSettings(tx);
      const channels: Channel[] = settings.channels
        .filter((c) => c.enabled)
        .map((c) => c.channel);
      return { brandVoice: settings.brandVoice, channels };
    });
}
