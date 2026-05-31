import type { MetricInput, MetricSourceKind } from "@blogs/contracts";
import type { Tx } from "../../platform/db/tenant";

/** Nest DI token for the registered list of analytics source adapters. */
export const ANALYTICS_SOURCES = Symbol("ANALYTICS_SOURCES");

/**
 * The context handed to a source when it collects metrics: the tenant-scoped
 * transaction (RLS already bound) and the tenant id. **Internal** sources read
 * the tenant's existing tables through `tx`; **external** (stubbed) sources
 * ignore `tx` and return deterministic fixtures.
 */
export interface SourceContext {
  tx: Tx;
  tenantId: string;
}

/**
 * A unified, per-source ingestion seam (Fase 4, ADR-0025). Every metric source —
 * the internal read models (affiliate/email/social/content) and the external
 * third-party adapters (GA4, Search Console) — implements the same port, so the
 * ingestion service treats them uniformly. External sources are stubbed at the
 * boundary today (deterministic fixtures, no live API/keys/network) exactly like
 * the EmailPort/PaymentPort/NotificationPort of earlier phases; a live adapter is
 * a founder follow-up (DEBT) and, when built, must fetch OUTSIDE the write tx.
 */
export interface AnalyticsSourcePort {
  /** Stable source key (also the discriminator in {@link METRIC_SOURCES}). */
  readonly source: string;
  /** internal = read from our own DB; external = stubbed third-party API. */
  readonly kind: MetricSourceKind;
  /** Produce this source's current metric data points for the tenant. */
  collect(ctx: SourceContext): Promise<MetricInput[]>;
}
