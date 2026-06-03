import type { Theme } from "@blogs/contracts";
import type { Db } from "../../platform/db/client";
import { withTenant } from "../../platform/db/tenant";
import { getTenantSettings } from "../settings";
import { confirmedSegmentForTheme } from "./subscribers.repo";
import type { BrandVoiceAccessor } from "./agents/tools/get-brand-voice";
import type { SegmentProfileAccessor } from "./agents/tools/get-segment-profile";

/**
 * Real, RLS-scoped data accessors the email controller injects into the Email
 * Agent (the boundary seam — the agent itself stays pure). The brand voice comes
 * from `tenant_settings`; the segment size from `confirmedSegmentForTheme`
 * (`subscribers`/`subscriptions`), both read under the tenant's RLS scope.
 */
export function makeBrandVoiceAccessor(db: Db): BrandVoiceAccessor {
  return (tenantId) =>
    withTenant(db, tenantId, (tx) => getTenantSettings(tx)).then((s) => s.brandVoice);
}

export function makeSegmentProfileAccessor(db: Db): SegmentProfileAccessor {
  return (tenantId, theme: Theme) =>
    withTenant(db, tenantId, (tx) => confirmedSegmentForTheme(tx, theme)).then((s) => s.length);
}
