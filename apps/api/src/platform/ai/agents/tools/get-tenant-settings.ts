import type { ToolDefinition } from "../../tools";
import { schema, isObject } from "./schema";

/**
 * `getTenantSettings` — the slice of tenant settings the Orchestrator needs:
 * the enabled channels (to pick a slot's channel) and the EXISTING per-specialist
 * autonomy levels (read by the autonomy SEAM — see `orchestrator-agent.ts`). The
 * kernel must not import `modules/settings`, so the caller injects an accessor.
 *
 * The autonomy levels already exist in `packages/contracts/src/settings.ts`
 * (`SPECIALISTS`/`autonomyLevelSchema`, a T2 stub with no engine). The seam READS
 * them; it does not create them (founder "seam only" decision, DEBT-041).
 */

export const GET_TENANT_SETTINGS_TOOL_ID = "getTenantSettings";

export interface OrchestratorTenantSettings {
  /** Channel ids the tenant has enabled. */
  channels: string[];
  /** Per-specialist autonomy level (all `manual` today — T2 stub, no engine). */
  specialistAutonomy: Record<string, string>;
}

export type GetTenantSettingsAccessor = (
  tenantId: string,
) => Promise<OrchestratorTenantSettings>;

/** No input — the runner injects `tenantId` (tenantScoped). */
export type GetTenantSettingsInput = Record<string, never>;

function isOutput(v: unknown): v is OrchestratorTenantSettings {
  return (
    isObject(v) &&
    Array.isArray((v as { channels?: unknown }).channels) &&
    isObject((v as { specialistAutonomy?: unknown }).specialistAutonomy)
  );
}

export function createGetTenantSettingsTool(
  acc: GetTenantSettingsAccessor,
): ToolDefinition<GetTenantSettingsInput, OrchestratorTenantSettings> {
  return {
    id: GET_TENANT_SETTINGS_TOOL_ID,
    description:
      "Restituisce i canali abilitati del tenant e il livello di autonomia per specialista (oggi sempre 'manual').",
    inputSchema: schema("getTenantSettings input", (v): v is GetTenantSettingsInput => isObject(v)),
    outputSchema: schema("getTenantSettings output", isOutput),
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 1_000,
    stubArgs: () => ({}),
    execute: (_input, ctx) => acc(ctx.tenantId),
  };
}
