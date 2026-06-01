import type { ToolDefinition } from "../../tools";
import { renderSystemPrompt, type BrandVoice } from "../../prompt";
import { schema, isObject } from "./schema";

/**
 * `getBrandVoice` — the brand voice + rendered system prompt for the tenant
 * (agentic-plan §4). The voice lives in `tenant_settings` (a MODULE), so the
 * accessor is injected at the boundary by the caller (settings/controller); the
 * tool itself only renders, keeping `platform/ai` free of any `modules/*` import.
 */

export const GET_BRAND_VOICE_TOOL_ID = "getBrandVoice";

export type GetBrandVoiceAccessor = (tenantId: string) => Promise<BrandVoice>;

export type GetBrandVoiceInput = Record<string, never>;

export interface GetBrandVoiceOutput {
  tone: string;
  audience: string;
  systemPrompt: string;
}

function isOutput(v: unknown): v is GetBrandVoiceOutput {
  return (
    isObject(v) &&
    typeof v.tone === "string" &&
    typeof v.audience === "string" &&
    typeof v.systemPrompt === "string"
  );
}

export function createGetBrandVoiceTool(
  acc: GetBrandVoiceAccessor,
): ToolDefinition<GetBrandVoiceInput, GetBrandVoiceOutput> {
  return {
    id: GET_BRAND_VOICE_TOOL_ID,
    description:
      "Restituisce tono, pubblico e prompt di sistema della brand voice del tenant.",
    inputSchema: schema("getBrandVoice input", (v): v is GetBrandVoiceInput => isObject(v)),
    outputSchema: schema("getBrandVoice output", isOutput),
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 500,
    stubArgs: () => ({}),
    execute: async (_input, ctx) => {
      const voice = await acc(ctx.tenantId);
      return {
        tone: voice.tone,
        audience: voice.audience,
        systemPrompt: renderSystemPrompt(voice),
      };
    },
  };
}
