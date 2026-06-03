import { eq, sql } from "drizzle-orm";
import type { MetricInput } from "@blogs/contracts";
import {
  affiliateClicks,
  channelPosts,
  contentItems,
  subscribers,
} from "../../platform/db/schema";
import type { AnalyticsSourcePort, SourceContext } from "./source.port";

// All four read models query the shared platform schema directly (the same
// tenant-scoped tables their owning modules use) — they never reach into another
// module's internals, so module boundaries stay intact. RLS (bound by withTenant)
// scopes every aggregation to the current tenant.

const countInt = sql<number>`count(*)::int`;

/**
 * Affiliate (3.1): outbound clicks per placement channel, read from the
 * snapshotted `affiliate_clicks`. A click with no channel is bucketed as
 * `unattributed` so it still appears in the cross-channel rollup.
 */
export class AffiliateSource implements AnalyticsSourcePort {
  readonly source = "affiliate";
  readonly kind = "internal" as const;

  async collect({ tx }: SourceContext): Promise<MetricInput[]> {
    const rows = await tx
      .select({
        channel: sql<string>`coalesce(${affiliateClicks.channel}, 'unattributed')`,
        clicks: countInt,
      })
      .from(affiliateClicks)
      .groupBy(sql`coalesce(${affiliateClicks.channel}, 'unattributed')`);
    return rows.map((r) => ({
      source: this.source,
      channel: r.channel,
      metric: "clicks",
      value: r.clicks,
      period: "all",
      contentItemId: null,
    }));
  }
}

/**
 * Email/newsletter (Fase 2.5): confirmed vs pending subscribers (double opt-in),
 * on the `newsletter` channel.
 */
export class EmailSource implements AnalyticsSourcePort {
  readonly source = "email";
  readonly kind = "internal" as const;

  async collect({ tx }: SourceContext): Promise<MetricInput[]> {
    const rows = await tx
      .select({ status: subscribers.status, n: countInt })
      .from(subscribers)
      .groupBy(subscribers.status);
    const by = new Map(rows.map((r) => [r.status, r.n]));
    return [
      { metric: "subscribers", value: by.get("confirmed") ?? 0 },
      { metric: "pending_subscribers", value: by.get("pending") ?? 0 },
    ].map((m) => ({
      source: this.source,
      channel: "newsletter",
      metric: m.metric,
      value: m.value,
      period: "all",
      contentItemId: null,
    }));
  }
}

/**
 * Social (Fase 2): channel-adapted posts per channel, read from `channel_posts`
 * (the deterministic projections of articles, ADR-0017).
 */
export class SocialSource implements AnalyticsSourcePort {
  readonly source = "social";
  readonly kind = "internal" as const;

  async collect({ tx }: SourceContext): Promise<MetricInput[]> {
    const rows = await tx
      .select({ channel: channelPosts.channel, posts: countInt })
      .from(channelPosts)
      .groupBy(channelPosts.channel);
    return rows.map((r) => ({
      source: this.source,
      channel: r.channel,
      metric: "posts",
      value: r.posts,
      period: "all",
      contentItemId: null,
    }));
  }
}

/**
 * Content (Fase 1): published articles vs total content items, attributed to the
 * `blog` channel.
 */
export class ContentSource implements AnalyticsSourcePort {
  readonly source = "content";
  readonly kind = "internal" as const;

  async collect({ tx }: SourceContext): Promise<MetricInput[]> {
    const [{ published = 0 } = {}] = await tx
      .select({ published: countInt })
      .from(contentItems)
      .where(eq(contentItems.status, "published"));
    const [{ total = 0 } = {}] = await tx
      .select({ total: countInt })
      .from(contentItems);
    return [
      { metric: "published", value: published },
      { metric: "items", value: total },
    ].map((m) => ({
      source: this.source,
      channel: "blog",
      metric: m.metric,
      value: m.value,
      period: "all",
      contentItemId: null,
    }));
  }
}

/** The four internal read-model sources, in dashboard order. */
export function internalSources(): AnalyticsSourcePort[] {
  return [new AffiliateSource(), new EmailSource(), new SocialSource(), new ContentSource()];
}
