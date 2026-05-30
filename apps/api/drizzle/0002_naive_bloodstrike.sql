CREATE TABLE "itinerary_stop_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stop_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "itinerary_stop_photos_asset_id_unique" UNIQUE("asset_id")
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"variants" jsonb NOT NULL,
	"taken_on" date,
	"lat" double precision,
	"lng" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "itinerary_stop_photos" ADD CONSTRAINT "itinerary_stop_photos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_stop_photos" ADD CONSTRAINT "itinerary_stop_photos_stop_id_itinerary_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."itinerary_stops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_stop_photos" ADD CONSTRAINT "itinerary_stop_photos_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media_assets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "media_assets"
	USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
	WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "itinerary_stop_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "itinerary_stop_photos" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "itinerary_stop_photos"
	USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
	WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);