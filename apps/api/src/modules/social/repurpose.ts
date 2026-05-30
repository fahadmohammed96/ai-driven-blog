import type {
  Block,
  Channel,
  ChannelPost,
  ImageBlock,
  ParagraphBlock,
} from "@blogs/contracts";
import { CHANNEL_LIMITS } from "@blogs/contracts";

/** The source an article is repurposed from (canonical block model + its URL). */
export interface ArticleContent {
  title: string;
  blocks: Block[];
  /** Canonical published URL, woven into pins as the outbound link. */
  link?: string;
}

/** A channel that is visual-first (e.g. Pinterest) cannot be built without an image. */
export class ChannelRequiresImageError extends Error {
  constructor(public readonly channel: Channel) {
    super(`channel '${channel}' requires an image but the article has none`);
    this.name = "ChannelRequiresImageError";
  }
}

export function articleParagraphs(blocks: Block[]): string[] {
  return blocks
    .filter((b): b is ParagraphBlock => b.type === "paragraph")
    .map((b) => b.text.trim())
    .filter(Boolean);
}

export function firstImageAssetId(blocks: Block[]): string | null {
  const img = blocks.find((b): b is ImageBlock => b.type === "image");
  return img ? img.assetId : null;
}

// Italian + English function words that make poor hashtags.
const STOPWORDS = new Set([
  "una", "uno", "del", "della", "delle", "dei", "degli", "gli", "che", "con",
  "per", "tra", "fra", "the", "and", "with", "from", "your", "this", "that",
]);

/** Hashtags from free text: drop short/stopwords, dedup, lowercase, #-prefix. */
export function deriveHashtags(text: string, max: number): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const word = raw.trim();
    if (word.length < 4 || STOPWORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    tags.push(`#${word}`);
    if (tags.length >= max) break;
  }
  return tags;
}

/** Truncate to `limit` chars on a word boundary, never producing an empty string. */
export function truncateWords(text: string, limit: number): string {
  const t = text.trim();
  if (t.length <= limit) return t;
  const slice = t.slice(0, limit);
  const cut = slice.lastIndexOf(" ");
  return (cut > 0 ? slice.slice(0, cut) : slice).trimEnd();
}

/** Greedily wrap words into pieces no longer than `lim` (hard-splitting long words). */
function wrapWords(words: string[], lim: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (let w of words) {
    while (w.length > lim) {
      if (cur) { out.push(cur); cur = ""; }
      out.push(w.slice(0, lim));
      w = w.slice(lim);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= lim) cur += ` ${w}`;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Project text into an X/Twitter thread. Fits in one tweet → returned as-is;
 * otherwise wrapped into `i/N`-numbered tweets, each within `limit`.
 */
export function toThread(text: string, limit: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const single = wrapWords(words, limit);
  if (single.length <= 1) return single;
  // Re-wrap with room reserved for the "NN/NN " prefix, then number.
  const reserve = 8;
  const pieces = wrapWords(words, limit - reserve);
  const n = pieces.length;
  return pieces.map((p, i) => `${i + 1}/${n} ${p}`);
}

/** Project a canonical article into a single channel-adapted post. */
export function projectToChannel(article: ArticleContent, channel: Channel): ChannelPost {
  const paragraphs = articleParagraphs(article.blocks);
  const body = paragraphs.join("\n\n");
  const lead = paragraphs[0] ?? article.title;
  const hashtags = deriveHashtags(article.title, CHANNEL_LIMITS.instagram.hashtags);

  switch (channel) {
    case "instagram":
      return {
        channel,
        caption: truncateWords(`${article.title}\n\n${body}`, CHANNEL_LIMITS.instagram.caption),
        hashtags,
      };
    case "x":
      return {
        channel,
        tweets: toThread(`${article.title}. ${body}`, CHANNEL_LIMITS.x.tweet),
      };
    case "pinterest": {
      const imageAssetId = firstImageAssetId(article.blocks);
      if (!imageAssetId) throw new ChannelRequiresImageError("pinterest");
      return {
        channel,
        title: truncateWords(article.title, CHANNEL_LIMITS.pinterest.title),
        description: truncateWords(lead, CHANNEL_LIMITS.pinterest.description),
        imageAssetId,
        ...(article.link ? { link: article.link } : {}),
      };
    }
  }
}

/** Repurpose one article into adapted posts for the requested channels. */
export function repurpose(article: ArticleContent, channels: Channel[]): ChannelPost[] {
  return channels.map((c) => projectToChannel(article, c));
}
