import { z } from "zod";
import { channelSchema, CHANNELS } from "./channel";

/**
 * Tenant settings (content-hub, slice 4) — the per-tenant configuration the
 * founder edits in the Settings surface. Three concerns:
 *  1. brand voice — the AI pipeline's voice (`platform/ai` BrandVoice shape),
 *  2. per-specialist autonomy — a STUB knob (persistence only, no engine yet),
 *  3. channels — which distribution channels the tenant uses.
 * Persisted tenant-scoped (RLS) in `tenant_settings`.
 */

/**
 * Brand voice: the same `{ tone, audience }` shape the AI pipeline already uses
 * (`platform/ai/pipeline.ts`). Settings let the founder view/edit it per tenant
 * instead of the hard-coded FOUNDER_VOICE constant.
 */
export const brandVoiceSchema = z.object({
  tone: z.string().max(2000),
  audience: z.string().max(2000),
});
export type BrandVoice = z.infer<typeof brandVoiceSchema>;

/**
 * Per-specialist autonomy level (ADR-0020 default = manual / review).
 * STUB: only the choice is persisted; a real automation/rules engine is later
 * work (record the debt at THAT point, not now — brief, founder 2026-05-31).
 */
export const autonomyLevelSchema = z.enum(["manual", "semi-auto", "auto-within-limits"]);
export type AutonomyLevel = z.infer<typeof autonomyLevelSchema>;
export const AUTONOMY_LEVELS = autonomyLevelSchema.options;

/** The AI specialists whose autonomy is configurable (the outbound staff). */
export const SPECIALISTS = ["writer", "seo", "social", "email"] as const;
export type Specialist = (typeof SPECIALISTS)[number];

export const specialistAutonomySchema = z.object({
  writer: autonomyLevelSchema,
  seo: autonomyLevelSchema,
  social: autonomyLevelSchema,
  email: autonomyLevelSchema,
});
export type SpecialistAutonomy = z.infer<typeof specialistAutonomySchema>;

/**
 * A distribution channel the tenant intends to use. `enabled` is the tenant's
 * intent; the real per-tenant OAuth/key onboarding is DEBT-008 (out of scope),
 * so this is a view/stub of channel state, not a live connection.
 */
export const channelSettingSchema = z.object({
  channel: channelSchema,
  enabled: z.boolean(),
});
export type ChannelSetting = z.infer<typeof channelSettingSchema>;

/**
 * Per-tenant AI provider selection (BYOK) — METADATA ONLY.
 *
 * The ACTUAL provider choice at runtime is driven by the *existence* of an
 * encrypted `llm_anthropic` credential in `connector_credentials`
 * (`platform/ai/provider-registry.ts`), NOT by reading this field — so the AI
 * kernel never depends on `modules/settings`. This is the founder-facing view of
 * that state: `connector: 'anthropic'` once a tenant key is provisioned, else
 * `'stub'`/platform-key. `credentialId` is an optional human-friendly pointer.
 * `.default()` so legacy settings rows (written before this field) still parse.
 */
export const aiProviderSchema = z.object({
  connector: z.enum(["anthropic", "stub"]),
  credentialId: z.string().optional(),
});
export type AiProviderSetting = z.infer<typeof aiProviderSchema>;
export const DEFAULT_AI_PROVIDER: AiProviderSetting = { connector: "stub" };

/**
 * Per-tenant monthly AI spend cap, in USD. This is the **hard cap** the R1-B
 * circuit-breaker enforces: spend is the running `SUM(cost_usd)` over
 * `ai_usage_events` for the current month, and a (sub-)run is refused once the
 * cap is reached (L2) or its worst-case estimate would exceed the remaining
 * headroom (L1) — see `platform/ai/budget-guard.ts`.
 *
 * AGGREGATION DECISION (agentic-plan §"Controlli di costo"): budget is enforced
 * at TWO levels. A future per-agent **rate-limit of runs** caps how often any one
 * specialist may fire; the per-tenant **hard cap** here is the invariant that
 * actually bounds total cost — an Orchestrator firing N sub-agents can never
 * spend N × the tenant cap, because the cap is re-read from the DB before every
 * sub-run. The per-agent knob shapes cadence; THIS number bounds the bill.
 * `.default()` so legacy settings rows (written before this field existed) still
 * parse — they inherit the default cap.
 */
export const DEFAULT_BUDGET_USD_MONTHLY = 50;

/**
 * How strict the agentic audit gate is (agentic-plan §"Audit"). Every agent run
 * writes its `ai_agent_runs` row BEST-EFFORT; a proposal can therefore ship with
 * `auditRecorded: false` (the write degraded). This knob decides what the human
 * gate does with such a proposal:
 *  - `obbligatorio` (default, ADR-0020 accountability): a proposal whose run was
 *    NOT audited is withheld from the review queue — no audit, no review.
 *  - `best-effort`: such a proposal is still shown (degraded, but visible).
 * `.default()` so legacy settings rows (written before this field) still parse —
 * they inherit the strict default.
 */
export const auditPolicySchema = z.enum(["obbligatorio", "best-effort"]);
export type AuditPolicy = z.infer<typeof auditPolicySchema>;
export const AUDIT_POLICIES = auditPolicySchema.options;
export const DEFAULT_AUDIT_POLICY: AuditPolicy = "obbligatorio";

export const tenantSettingsSchema = z.object({
  brandVoice: brandVoiceSchema,
  specialistAutonomy: specialistAutonomySchema,
  channels: z.array(channelSettingSchema),
  budgetUsdMonthly: z.number().nonnegative().default(DEFAULT_BUDGET_USD_MONTHLY),
  aiProvider: aiProviderSchema.default(DEFAULT_AI_PROVIDER),
  auditPolicy: auditPolicySchema.default(DEFAULT_AUDIT_POLICY),
});
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

/** Defaults applied when a tenant has no stored settings row yet (manual everywhere). */
export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  brandVoice: { tone: "", audience: "" },
  specialistAutonomy: {
    writer: "manual",
    seo: "manual",
    social: "manual",
    email: "manual",
  },
  channels: CHANNELS.map((channel) => ({ channel, enabled: false })),
  budgetUsdMonthly: DEFAULT_BUDGET_USD_MONTHLY,
  aiProvider: DEFAULT_AI_PROVIDER,
  auditPolicy: DEFAULT_AUDIT_POLICY,
};

/**
 * Fill missing pieces of a (possibly partial / legacy) settings value with the
 * defaults, so GET always returns a complete, valid {@link TenantSettings} and a
 * PUT body can omit fields. Deep-merges the three top-level concerns.
 */
export function withSettingsDefaults(partial?: unknown): TenantSettings {
  const p = (partial ?? {}) as Partial<TenantSettings>;
  return {
    brandVoice: { ...DEFAULT_TENANT_SETTINGS.brandVoice, ...(p.brandVoice ?? {}) },
    specialistAutonomy: {
      ...DEFAULT_TENANT_SETTINGS.specialistAutonomy,
      ...(p.specialistAutonomy ?? {}),
    },
    channels: p.channels ?? DEFAULT_TENANT_SETTINGS.channels,
    budgetUsdMonthly: p.budgetUsdMonthly ?? DEFAULT_TENANT_SETTINGS.budgetUsdMonthly,
    aiProvider: p.aiProvider ?? DEFAULT_TENANT_SETTINGS.aiProvider,
    auditPolicy: p.auditPolicy ?? DEFAULT_TENANT_SETTINGS.auditPolicy,
  };
}
