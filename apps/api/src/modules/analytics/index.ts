// Public surface of the analytics module.
export { AnalyticsModule } from "./analytics.module";
export { AnalyticsService } from "./analytics.service";
export {
  ANALYTICS_SOURCES,
  type AnalyticsSourcePort,
  type SourceContext,
} from "./source.port";
export { createAnalyticsSources } from "./sources";
export { internalSources } from "./internal-sources";
export {
  Ga4SourceStub,
  SearchConsoleSourceStub,
  createExternalSources,
} from "./external-sources";
export {
  replaceSnapshotsForSource,
  listSnapshots,
  lastIngestedAt,
  type MetricSnapshotRow,
} from "./analytics.repo";
