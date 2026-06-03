import type { AnalyticsSourcePort } from "./source.port";
import { internalSources } from "./internal-sources";
import { createExternalSources } from "./external-sources";

/**
 * The registered analytics sources, in dashboard order: the internal read models
 * (affiliate/email/social/content) followed by the external stubbed adapters
 * (GA4, Search Console). This is the value behind the `ANALYTICS_SOURCES` token.
 */
export function createAnalyticsSources(): AnalyticsSourcePort[] {
  return [...internalSources(), ...createExternalSources()];
}
