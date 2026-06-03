import type { MetricInput } from "@blogs/contracts";
import type { AnalyticsSourcePort } from "./source.port";

/**
 * GA4 (Google Analytics 4) — stubbed at the boundary. Returns deterministic
 * traffic fixtures (sessions + users per acquisition channel) so the unified
 * dashboard renders a realistic cross-channel picture without any live API, keys,
 * or network. The dashboard labels these rows as stubbed. Mirrors the
 * PaymentPort/NotificationPort stubs of Fase 3.
 *
 * TODO(debt): DEBT-013 — a real GA4 Data API adapter (OAuth2 + property id +
 * key management, coherent with DEBT-008) is not implemented; when built it must
 * fetch OUTSIDE the write transaction (see ADR-0025). Founder follow-up.
 */
export class Ga4SourceStub implements AnalyticsSourcePort {
  readonly source = "ga4";
  readonly kind = "external" as const;

  // Deterministic per-channel traffic — same shape a GA4 acquisition report gives.
  private static readonly FIXTURES: { channel: string; sessions: number; users: number }[] = [
    { channel: "organic", sessions: 1240, users: 980 },
    { channel: "pinterest", sessions: 860, users: 712 },
    { channel: "instagram", sessions: 410, users: 365 },
    { channel: "newsletter", sessions: 220, users: 190 },
    { channel: "direct", sessions: 175, users: 150 },
  ];

  // The stub ignores the SourceContext (no DB, no live API) — see the port docs.
  async collect(): Promise<MetricInput[]> {
    return Ga4SourceStub.FIXTURES.flatMap((f) => [
      { source: this.source, channel: f.channel, metric: "sessions", value: f.sessions, period: "all", contentItemId: null },
      { source: this.source, channel: f.channel, metric: "users", value: f.users, period: "all", contentItemId: null },
    ]);
  }
}

/**
 * Google Search Console — stubbed at the boundary. Returns deterministic organic
 * search fixtures (impressions, clicks, average position) on the `organic`
 * channel. Same boundary-stub discipline as {@link Ga4SourceStub}.
 *
 * TODO(debt): DEBT-013 — a real Search Console API adapter (OAuth2 + site
 * verification + key management) is not implemented; founder follow-up (ADR-0025).
 */
export class SearchConsoleSourceStub implements AnalyticsSourcePort {
  readonly source = "search_console";
  readonly kind = "external" as const;

  async collect(): Promise<MetricInput[]> {
    const row = { channel: "organic" as const };
    return [
      { source: this.source, channel: row.channel, metric: "impressions", value: 18450, period: "all", contentItemId: null },
      { source: this.source, channel: row.channel, metric: "clicks", value: 612, period: "all", contentItemId: null },
      // Average position is a non-count double — the model carries it natively.
      { source: this.source, channel: row.channel, metric: "avg_position", value: 14.2, period: "all", contentItemId: null },
    ];
  }
}

/**
 * Build the external sources from env. Always returns the deterministic stubs for
 * now (live GA4/GSC = DEBT-013 — founder follow-up). Mirrors `createPaymentFromEnv`
 * / `createNotificationFromEnv`: the boundary stays a stub until a real adapter
 * is wired behind config.
 */
export function createExternalSources(): AnalyticsSourcePort[] {
  return [new Ga4SourceStub(), new SearchConsoleSourceStub()];
}
