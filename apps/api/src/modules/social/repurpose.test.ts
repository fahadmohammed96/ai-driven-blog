import { describe, it, expect } from "vitest";
import type { Block } from "@blogs/contracts";
import { CHANNEL_LIMITS, channelPostSchema } from "@blogs/contracts";
import {
  repurpose,
  projectToChannel,
  toThread,
  deriveHashtags,
  ChannelRequiresImageError,
} from "./repurpose";

const ASSET = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function article(blocks: Block[], title = "Una settimana in Giappone") {
  return { title, blocks };
}

const SAMPLE: Block[] = [
  { type: "heading", level: 1, text: "Una settimana in Giappone" },
  { type: "heading", level: 2, text: "Tokyo" },
  { type: "paragraph", text: "Ho camminato tra i vicoli di Shibuya al tramonto, sorpreso dal ritmo della città." },
  { type: "image", assetId: ASSET, alt: "Tokyo" },
  { type: "heading", level: 2, text: "Kyoto" },
  { type: "paragraph", text: "I templi silenziosi di Kyoto mi hanno costretto a rallentare e ascoltare." },
];

describe("repurpose (channel projectors)", () => {
  it("produces exactly one adapted post per requested channel, in order", () => {
    const posts = repurpose(article(SAMPLE), ["instagram", "x", "pinterest"]);
    expect(posts.map((p) => p.channel)).toEqual(["instagram", "x", "pinterest"]);
  });

  it("every produced post validates against the channel contract", () => {
    for (const channel of ["instagram", "x", "pinterest"] as const) {
      const post = projectToChannel(article(SAMPLE), channel);
      expect(channelPostSchema.safeParse(post).success).toBe(true);
    }
  });

  it("pinterest pin carries the article's first image asset", () => {
    const pin = projectToChannel(article(SAMPLE), "pinterest");
    if (pin.channel !== "pinterest") throw new Error("wrong channel");
    expect(pin.imageAssetId).toBe(ASSET);
    expect(pin.title.length).toBeLessThanOrEqual(CHANNEL_LIMITS.pinterest.title);
    expect(pin.description.length).toBeLessThanOrEqual(CHANNEL_LIMITS.pinterest.description);
  });

  it("refuses a pinterest pin when the article has no image", () => {
    const noImage = SAMPLE.filter((b) => b.type !== "image");
    expect(() => projectToChannel(article(noImage), "pinterest")).toThrow(ChannelRequiresImageError);
  });

  it("instagram caption stays within the limit and carries hashtags from the title", () => {
    const post = projectToChannel(article(SAMPLE), "instagram");
    if (post.channel !== "instagram") throw new Error("wrong channel");
    expect(post.caption.length).toBeLessThanOrEqual(CHANNEL_LIMITS.instagram.caption);
    expect(post.hashtags).toContain("#giappone");
  });

  it("splits a long article into a numbered X thread, each tweet within the limit", () => {
    const long = "Parola ".repeat(400).trim(); // ~2800 chars
    const tweets = toThread(long, CHANNEL_LIMITS.x.tweet);
    expect(tweets.length).toBeGreaterThan(1);
    for (const t of tweets) expect(t.length).toBeLessThanOrEqual(CHANNEL_LIMITS.x.tweet);
    expect(tweets[0]).toMatch(/^1\/\d+ /);
  });

  it("keeps a short text as a single un-numbered tweet", () => {
    expect(toThread("Ciao dal Giappone", CHANNEL_LIMITS.x.tweet)).toEqual(["Ciao dal Giappone"]);
  });

  it("derives hashtags: drops stopwords/short words, dedups, lowercases, #-prefixes", () => {
    const tags = deriveHashtags("Una settimana in Giappone tra Tokyo e Tokyo", 10);
    expect(tags).toContain("#giappone");
    expect(tags).toContain("#settimana");
    expect(tags).not.toContain("#in"); // stopword/short
    expect(tags.filter((t) => t === "#tokyo")).toHaveLength(1); // deduped
  });
});
