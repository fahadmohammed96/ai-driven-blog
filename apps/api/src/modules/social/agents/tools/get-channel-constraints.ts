import { CHANNEL_LIMITS, channelSchema, type Channel } from "@blogs/contracts";
import type { ToolDefinition } from "../../../../platform/ai/tools";
import { schema, isObject } from "./schema";

/**
 * `getChannelConstraints` — the hard per-channel platform limits the LLM must
 * stay within when it rewrites a caption (agentic-plan §4, Slice S2). A STATIC
 * registry (`CHANNEL_LIMITS`), no LLM and no DB: a pure deterministic lookup, so
 * the model never invents limits and the loop stays zero-cost (cost control §5).
 */

export const GET_CHANNEL_CONSTRAINTS_TOOL_ID = "getChannelConstraints";

export interface GetChannelConstraintsInput {
  channel: Channel;
}

/** The flat limit shape exposed to the model (a subset of `CHANNEL_LIMITS`). */
export interface ChannelConstraints {
  channel: Channel;
  /** Max caption/description characters for the channel's primary text field. */
  maxChars: number;
  /** Max hashtags (0 when the channel has no hashtag field). */
  maxHashtags: number;
}

/** Pure: the platform constraints for a channel (used by the tool AND the agent). */
export function channelConstraints(channel: Channel): ChannelConstraints {
  switch (channel) {
    case "instagram":
      return {
        channel,
        maxChars: CHANNEL_LIMITS.instagram.caption,
        maxHashtags: CHANNEL_LIMITS.instagram.hashtags,
      };
    case "x":
      return { channel, maxChars: CHANNEL_LIMITS.x.tweet, maxHashtags: 0 };
    case "pinterest":
      return { channel, maxChars: CHANNEL_LIMITS.pinterest.description, maxHashtags: 0 };
  }
}

function isInput(v: unknown): v is GetChannelConstraintsInput {
  return isObject(v) && channelSchema.safeParse(v.channel).success;
}

function isOutput(v: unknown): v is ChannelConstraints {
  return (
    isObject(v) &&
    typeof v.channel === "string" &&
    typeof v.maxChars === "number" &&
    typeof v.maxHashtags === "number"
  );
}

export function createGetChannelConstraintsTool(): ToolDefinition<
  GetChannelConstraintsInput,
  ChannelConstraints
> {
  return {
    id: GET_CHANNEL_CONSTRAINTS_TOOL_ID,
    description:
      "Restituisce i vincoli di piattaforma per un canale (caratteri max, hashtag max). Statico e deterministico.",
    inputSchema: schema("getChannelConstraints input", isInput),
    outputSchema: schema("getChannelConstraints output", isOutput),
    tenantScoped: false,
    side: "read",
    maxOutputTokens: 200,
    stubArgs: () => ({ channel: "instagram" }),
    execute: async (input) => channelConstraints(input.channel),
  };
}
