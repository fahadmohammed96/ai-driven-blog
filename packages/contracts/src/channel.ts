import { z } from "zod";

/**
 * Distribution channels (Fase 2). An article in the canonical block model is
 * **projected** to channel-adapted outputs (ADR-0004: one model, many renderers).
 * Each channel has hard platform limits we never exceed.
 */
export const channelSchema = z.enum(["instagram", "x", "pinterest"]);
export type Channel = z.infer<typeof channelSchema>;
export const CHANNELS = channelSchema.options;

/** Platform constraints per channel (characters / counts). */
export const CHANNEL_LIMITS = {
  instagram: { caption: 2200, hashtags: 30 },
  x: { tweet: 280 },
  pinterest: { title: 100, description: 500 },
} as const;

export const instagramPostSchema = z.object({
  channel: z.literal("instagram"),
  caption: z.string().min(1).max(CHANNEL_LIMITS.instagram.caption),
  hashtags: z.array(z.string()).max(CHANNEL_LIMITS.instagram.hashtags),
});
export type InstagramPost = z.infer<typeof instagramPostSchema>;

/** X/Twitter: an ordered thread; each tweet within the per-tweet limit. */
export const xThreadPostSchema = z.object({
  channel: z.literal("x"),
  tweets: z.array(z.string().min(1).max(CHANNEL_LIMITS.x.tweet)).min(1),
});
export type XThreadPost = z.infer<typeof xThreadPostSchema>;

/** Pinterest pin: visual-first, so an image asset is mandatory. */
export const pinterestPinSchema = z.object({
  channel: z.literal("pinterest"),
  title: z.string().min(1).max(CHANNEL_LIMITS.pinterest.title),
  description: z.string().min(1).max(CHANNEL_LIMITS.pinterest.description),
  imageAssetId: z.string().uuid(),
  link: z.string().url().optional(),
});
export type PinterestPin = z.infer<typeof pinterestPinSchema>;

export const channelPostSchema = z.discriminatedUnion("channel", [
  instagramPostSchema,
  xThreadPostSchema,
  pinterestPinSchema,
]);
export type ChannelPost = z.infer<typeof channelPostSchema>;

/**
 * ChannelPostMap — the Social Agent's structured payload (agentic-plan Slice S2).
 * A content item projected to one channel-adapted {@link ChannelPost} per
 * requested channel. Each post self-identifies via its `channel` discriminator,
 * so `posts` is effectively a map keyed by channel (one entry per channel).
 *
 * It rides the common `Proposal<T>` envelope with `type: 'social_captions'`,
 * lands in `agent_proposals` staging (T1) and, on approval, is inserted as
 * `channel_posts` at status `draft` — the EXISTING Phase-2.5 per-post approval
 * gate (`setPostApproval`) stays the final gate before anything goes out. The
 * agent NEVER publishes (propose-only is structural).
 */
export const channelPostMapSchema = z.object({
  /** The content item these posts were projected from (the social subject). */
  contentItemId: z.string().uuid(),
  /** One channel-adapted post per requested channel (keyed by `post.channel`). */
  posts: z.array(channelPostSchema).min(1),
});
export type ChannelPostMap = z.infer<typeof channelPostMapSchema>;

/** Request body for repurposing an article onto one or more channels. */
export const repurposeRequestSchema = z.object({
  channels: z.array(channelSchema).min(1),
});
export type RepurposeRequest = z.infer<typeof repurposeRequestSchema>;
