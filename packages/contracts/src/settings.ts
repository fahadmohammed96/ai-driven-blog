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

export const tenantSettingsSchema = z.object({
  brandVoice: brandVoiceSchema,
  specialistAutonomy: specialistAutonomySchema,
  channels: z.array(channelSettingSchema),
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
  };
}
