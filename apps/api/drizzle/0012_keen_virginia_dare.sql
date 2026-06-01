-- De-duplicate any rows a pre-constraint (racy) ingest may have left, keeping the
-- newest per (tenant_id, source, channel, metric, period); a NULL channel is one
-- bucket (matches NULLS NOT DISTINCT). Without this the ADD CONSTRAINT below would
-- fail on a DB that already accumulated duplicates.
DELETE FROM "metric_snapshots" a
USING "metric_snapshots" b
WHERE a.ctid < b.ctid
  AND a."tenant_id" = b."tenant_id"
  AND a."source" = b."source"
  AND a."metric" = b."metric"
  AND a."period" = b."period"
  AND a."channel" IS NOT DISTINCT FROM b."channel";
--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_tenant_source_channel_metric_period_unique" UNIQUE NULLS NOT DISTINCT("tenant_id","source","channel","metric","period");