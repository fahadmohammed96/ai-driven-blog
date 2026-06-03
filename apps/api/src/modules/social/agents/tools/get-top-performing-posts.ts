import { channelSchema, type Channel } from "@blogs/contracts";
import type { ToolDefinition } from "../../../../platform/ai/tools";
import { schema, isObject } from "./schema";

/**
 * `getTopPerformingPosts` — past high-performing posts for a channel, so the LLM
 * can mimic what already resonated (agentic-plan §4, Slice S2). The ranking
 * signal would come from `channel_posts` joined to `metric_snapshots`; that join
 * is the INJECTED accessor's job, under the tenant's RLS scope.
 *
 * TODO(debt): DEBT-030 — no engagement source is wired to `channel_posts` yet
 * (`metric_snapshots` carries no `channel_post_id`), so the default accessor is a
 * deterministic empty stub. Trigger: when per-post engagement metrics land.
 */

export const GET_TOP_PERFORMING_POSTS_TOOL_ID = "getTopPerformingPosts";

const DEFAULT_LIMIT = 3;

/** A past post surfaced as an exemplar (text the model can learn the cadence from). */
export interface TopPerformingPost {
  channel: Channel;
  excerpt: string;
}

/** Injected at the boundary: rank the tenant's past posts for a channel (RLS-scoped). */
export type TopPerformingPostsAccessor = (
  tenantId: string,
  channel: Channel,
  limit: number,
) => Promise<TopPerformingPost[]>;

/**
 * The deterministic stub accessor (DEBT-030): no engagement source is wired, so
 * it returns no exemplars. Swapped for the real ranking accessor when metrics
 * are joinable to `channel_posts`.
 */
export const STUB_TOP_PERFORMING_POSTS: TopPerformingPostsAccessor = async () => [];

export interface GetTopPerformingPostsInput {
  channel: Channel;
  limit?: number;
}

function isInput(v: unknown): v is GetTopPerformingPostsInput {
  return (
    isObject(v) &&
    channelSchema.safeParse(v.channel).success &&
    (v.limit === undefined || typeof v.limit === "number")
  );
}

function isOutput(v: unknown): v is { posts: TopPerformingPost[] } {
  return (
    isObject(v) &&
    Array.isArray(v.posts) &&
    v.posts.every(
      (p) => isObject(p) && typeof p.channel === "string" && typeof p.excerpt === "string",
    )
  );
}

export function createGetTopPerformingPostsTool(
  acc: TopPerformingPostsAccessor = STUB_TOP_PERFORMING_POSTS,
): ToolDefinition<GetTopPerformingPostsInput, { posts: TopPerformingPost[] }> {
  return {
    id: GET_TOP_PERFORMING_POSTS_TOOL_ID,
    description:
      "Restituisce i post passati con il miglior engagement per il canale (esempi di stile). Stub finché non ci sono metriche per-post.",
    inputSchema: schema("getTopPerformingPosts input", isInput),
    outputSchema: schema("getTopPerformingPosts output", isOutput),
    tenantScoped: true,
    side: "read",
    maxOutputTokens: 800,
    stubArgs: () => ({ channel: "instagram", limit: DEFAULT_LIMIT }),
    execute: async (input, ctx) => ({
      posts: await acc(ctx.tenantId, input.channel, input.limit ?? DEFAULT_LIMIT),
    }),
  };
}
