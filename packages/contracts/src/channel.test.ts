import { describe, it, expect } from "vitest";
import {
  CHANNELS,
  CHANNEL_LIMITS,
  channelPostSchema,
  pinterestPinSchema,
  xThreadPostSchema,
} from "./channel";

describe("channel contracts", () => {
  it("enumerates the supported channels", () => {
    expect(CHANNELS).toEqual(["instagram", "x", "pinterest"]);
  });

  it("rejects a tweet over the per-tweet limit", () => {
    const tooLong = "a".repeat(CHANNEL_LIMITS.x.tweet + 1);
    expect(xThreadPostSchema.safeParse({ channel: "x", tweets: [tooLong] }).success).toBe(false);
  });

  it("requires an image asset on a pinterest pin", () => {
    const parsed = pinterestPinSchema.safeParse({
      channel: "pinterest",
      title: "Tokyo",
      description: "Una settimana in Giappone",
    });
    expect(parsed.success).toBe(false);
  });

  it("discriminates posts by channel", () => {
    const post = channelPostSchema.parse({
      channel: "instagram",
      caption: "Un viaggio indimenticabile",
      hashtags: ["#viaggio"],
    });
    expect(post.channel).toBe("instagram");
  });
});
