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

export const contentEmbeddings = pgTable("content_embeddings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 256 }).notNull(),
});
