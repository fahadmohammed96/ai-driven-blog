import { channelSchema, type Channel, type ChannelPost } from "@blogs/contracts";
import type { ToolDefinition } from "../../../../platform/ai/tools";
import { repurpose, ChannelRequiresImageError, type ArticleContent } from "../../repurpose";
import { schema, isObject } from "./schema";

/**
 * `projectToSocial` — wraps the DETERMINISTIC channel projectors (ADR-0017,
 * `repurpose`) as a tool (agentic-plan §4, Slice S2). `side: 'draft'`: it shapes
 * channel-adapted posts but persists nothing (the human gate inserts them on
 * approval). The article is bound at construction so the tool input stays the
 * channel list; a channel that needs an image but has none is skipped (the
 * projector would otherwise throw), so the tool always returns a valid set.
 */

export const PROJECT_TO_SOCIAL_TOOL_ID = "projectToSocial";

export interface ProjectToSocialInput {
  channels: Channel[];
}

/** Project each requested channel deterministically, skipping the unbuildable ones. */
export function projectChannels(article: ArticleContent, channels: Channel[]): ChannelPost[] {
  const out: ChannelPost[] = [];
  for (const channel of channels) {
    try {
      out.push(...repurpose(article, [channel]));
    } catch (err) {
      // A visual-first channel with no image can't be built — skip it, don't fail.
      if (err instanceof ChannelRequiresImageError) continue;
      throw err;
    }
  }
  return out;
}

function isInput(v: unknown): v is ProjectToSocialInput {
  return (
    isObject(v) &&
    Array.isArray(v.channels) &&
    v.channels.every((c) => channelSchema.safeParse(c).success)
  );
}

function isOutput(v: unknown): v is { posts: ChannelPost[] } {
  return isObject(v) && Array.isArray(v.posts);
}

export function createProjectToSocialTool(
  article: ArticleContent,
): ToolDefinition<ProjectToSocialInput, { posts: ChannelPost[] }> {
  return {
    id: PROJECT_TO_SOCIAL_TOOL_ID,
    description:
      "Proietta l'articolo nei post adattati per i canali richiesti (proiettori deterministici, nessuna pubblicazione).",
    inputSchema: schema("projectToSocial input", isInput),
    outputSchema: schema("projectToSocial output", isOutput),
    tenantScoped: false,
    side: "draft",
    maxOutputTokens: 2_000,
    stubArgs: () => ({ channels: ["instagram"] }),
    execute: async (input) => ({ posts: projectChannels(article, input.channels) }),
  };
}
