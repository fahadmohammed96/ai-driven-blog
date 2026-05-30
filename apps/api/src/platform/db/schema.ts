import {
  pgTable,
  uuid,
  text,
  timestamp,
  vector,
  jsonb,
  integer,
  doublePrecision,
  date,
} from "drizzle-orm/pg-core";
import type { Block } from "@blogs/contracts";

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

export const contentItems = pgTable("content_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  // Canonical content type: 'article' | 'itinerary' (+ future verticals).
  type: text("type").notNull(),
  // Publication lifecycle state (state machine in the content module).
  status: text("status").notNull().default("draft"),
  title: text("title").notNull(),
  // Canonical block model (ADR-0004): portable JSON, not HTML.
  blocks: jsonb("blocks").$type<Block[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Set once, when the item first reaches 'published' (idempotent publish).
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

/** Travel vertical: the structured stops of an itinerary content item. */
export const itineraryStops = pgTable("itinerary_stops", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  contentItemId: uuid("content_item_id")
    .notNull()
    .references(() => contentItems.id),
  position: integer("position").notNull(),
  place: text("place").notNull(),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  notes: text("notes"),
});

/** Media-DAM: an uploaded asset (original + derived variants), tenant-scoped. */
export const mediaAssets = pgTable("media_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  contentItemId: uuid("content_item_id")
    .notNull()
    .references(() => contentItems.id),
  storageKey: text("storage_key").notNull(),
  variants: jsonb("variants").$type<{ thumb: string; web: string }>().notNull(),
  takenOn: date("taken_on", { mode: "string" }),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Travel link: which itinerary stop a media asset was auto-organized into.
 * Lives in the travel domain (a foundation has no FK into a vertical's table).
 */
export const itineraryStopPhotos = pgTable("itinerary_stop_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  stopId: uuid("stop_id")
    .notNull()
    .references(() => itineraryStops.id),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => mediaAssets.id)
    .unique(),
});

export const contentEmbeddings = pgTable("content_embeddings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 256 }).notNull(),
});
