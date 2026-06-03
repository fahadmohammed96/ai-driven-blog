import { themeSchema, type Theme } from "@blogs/contracts";
import type { ToolDefinition } from "../../../../platform/ai/tools";
import { schema, isObject } from "./schema";

/**
 * `getSegmentProfile` — the size of a theme's segment (confirmed opt-in
 * subscribers) so the LLM knows the audience it is writing the subject for
 * (agentic-plan §4, Slice S3). The read of `subscribers`/`subscriptions` is the
 * INJECTED accessor's job, under the tenant's RLS scope (reuses
 * `confirmedSegmentForTheme`); the tool stays pure and unit-testable.
 */

export const GET_SEGMENT_PROFILE_TOOL_ID = "getSegmentProfile";

/** A theme's segment profile: how many confirmed subscribers will receive it. */
export interface SegmentProfile {
  theme: Theme;
  size: number;
}

/** Injected at the boundary: how many confirmed subscribers are in a theme's segment. */
export type SegmentProfileAccessor = (tenantId: string, theme: Theme) => Promise<number>;

/**
 * Default accessor when the caller wires none (unit tests / no DB): an unknown
 * segment size (0). The real accessor reads `confirmedSegmentForTheme`.
 */
export const STUB_SEGMENT_PROFILE: SegmentProfileAccessor = async () => 0;

export interface GetSegmentProfileInput {
  theme: Theme;
}

function isInput(v: unknown): v is GetSegmentProfileInput {
  return isObject(v) && themeSchema.safeParse(v.theme).success;
}

function isOutput(v: unknown): v is SegmentProfile {
  return isObject(v) && typeof v.theme === "string" && typeof v.size === "number";
}

export function createGetSegmentProfileTool(
  acc: SegmentProfileAccessor,
): ToolDefinition<GetSegmentProfileInput, SegmentProfile> {
  return {
    id: GET_SEGMENT_PROFILE_TOOL_ID,
    description:
      "Restituisce la dimensione del segmento di un tema (iscritti confermati che lo riceveranno).",
    inputSchema: schema("getSegmentProfile input", isInput),
    outputSchema: schema("getSegmentProfile output", isOutput),
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 200,
    stubArgs: () => ({ theme: "viaggi" }),
    execute: async (input, ctx) => ({ theme: input.theme, size: await acc(ctx.tenantId, input.theme) }),
  };
}
