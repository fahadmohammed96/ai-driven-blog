import type { ToolDefinition } from "../../../../platform/ai/tools";
import { schema, isObject } from "./schema";

/**
 * `getBrandVoice` — the tenant's brand voice (tone + audience), so the LLM
 * rewrites captions IN VOICE (agentic-plan §4, Slice S2). The actual read of
 * `tenant_settings` is the INJECTED accessor's job (the boundary seam, under the
 * tenant's RLS scope), exactly like the Writer's `getBrandVoice` — the tool stays
 * pure and unit-testable with a fake.
 */

export const GET_BRAND_VOICE_TOOL_ID = "getBrandVoice";

export interface BrandVoiceView {
  tone: string;
  audience: string;
}

/** Injected at the boundary: read the tenant's brand voice (RLS-scoped). */
export type BrandVoiceAccessor = (tenantId: string) => Promise<BrandVoiceView>;

function isOutput(v: unknown): v is BrandVoiceView {
  return isObject(v) && typeof v.tone === "string" && typeof v.audience === "string";
}

export function createGetBrandVoiceTool(
  acc: BrandVoiceAccessor,
): ToolDefinition<Record<string, never>, BrandVoiceView> {
  return {
    id: GET_BRAND_VOICE_TOOL_ID,
    description:
      "Restituisce il brand voice del tenant (tono e pubblico) per scrivere caption coerenti.",
    inputSchema: schema("getBrandVoice input", (v): v is Record<string, never> => isObject(v)),
    outputSchema: schema("getBrandVoice output", isOutput),
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 500,
    stubArgs: () => ({}),
    execute: async (_input, ctx) => acc(ctx.tenantId),
  };
}
