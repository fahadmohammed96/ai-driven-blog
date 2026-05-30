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

/** Request body for repurposing an article onto one or more channels. */
export const repurposeRequestSchema = z.object({
  channels: z.array(channelSchema).min(1),
});
export type RepurposeRequest = z.infer<typeof repurposeRequestSchema>;
