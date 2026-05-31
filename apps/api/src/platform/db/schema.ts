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
  unique,
} from "drizzle-orm/pg-core";
import type { Block, ChannelPost, TenantSettings } from "@blogs/contracts";

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

/**
 * Distribution (Fase 2): a channel-adapted projection of a source article,
 * tenant-scoped. `payload` is the validated ChannelPost for that channel.
 */
export const channelPosts = pgTable("channel_posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  contentItemId: uuid("content_item_id")
    .notNull()
    .references(() => contentItems.id),
  channel: text("channel").notNull(),
  status: text("status").notNull().default("draft"),
  payload: jsonb("payload").$type<ChannelPost>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Newsletter (Fase 2): a subscriber under GDPR double opt-in. `requestedAt` is
 * the consent request, `confirmedAt` the explicit confirmation (audit trail).
 * `confirmToken` validates the confirmation link. Tenant-scoped by RLS.
 */
export const subscribers = pgTable(
  "subscribers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    email: text("email").notNull(),
    status: text("status").notNull().default("pending"),
    confirmToken: text("confirm_token").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("subscribers_tenant_email_unique").on(t.tenantId, t.email)],
);

/** A subscriber's opt-in to a theme (segmentation key). Tenant-scoped by RLS. */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    subscriberId: uuid("subscriber_id")
      .notNull()
      .references(() => subscribers.id),
    theme: text("theme").notNull(),
  },
  (t) => [unique("subscriptions_subscriber_theme_unique").on(t.subscriberId, t.theme)],
);

/**
 * Integration Gateway (Fase 2): a connector's OAuth token set, tenant-scoped.
 * `accessToken`/`refreshToken` are stored **sealed** (AES-256-GCM); RLS isolates
 * per tenant (PRODUCT: per-tenant secrets encrypted).
 */
export const connectorCredentials = pgTable(
  "connector_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    connector: text("connector").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("connector_credentials_tenant_connector_unique").on(t.tenantId, t.connector)],
);

/**
 * Tenant settings (content-hub, slice 4): one row per tenant holding the
 * founder's configuration — brand voice, per-specialist autonomy (STUB), and
 * channels — as a validated JSONB blob. Tenant-scoped by RLS; `tenant_id` is the
 * primary key (exactly one settings row per tenant, upserted on save).
 */
export const tenantSettings = pgTable("tenant_settings", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  settings: jsonb("settings").$type<TenantSettings>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Affiliate hub (Fase 3): a trackable outbound link, tenant-scoped by RLS. The
 * `/go/:code` redirector resolves a link by its short `code` (unique per tenant),
 * optionally associated with an article (`contentItemId`) and a placement
 * (`channel`). `targetUrl` is where the click is 302-redirected.
 */
export const affiliateLinks = pgTable(
  "affiliate_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    code: text("code").notNull(),
    targetUrl: text("target_url").notNull(),
    contentItemId: uuid("content_item_id").references(() => contentItems.id),
    channel: text("channel"),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("affiliate_links_tenant_code_unique").on(t.tenantId, t.code)],
);

/**
 * Affiliate hub (Fase 3): one recorded click through the redirector. The link's
 * associations (`contentItemId`, `channel`) are **snapshotted** at click time so
 * counts segment per article / per channel even if the link is later re-pointed.
 * Tenant-scoped by RLS.
 */
export const affiliateClicks = pgTable("affiliate_clicks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  linkId: uuid("link_id")
    .notNull()
    .references(() => affiliateLinks.id),
  contentItemId: uuid("content_item_id").references(() => contentItems.id),
  channel: text("channel"),
  clickedAt: timestamp("clicked_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Commerce (Fase 3, motion "Programmato"): a sellable **Trip** built on an
 * existing Itinerary content item. Price/deposit are integer minor units;
 * `currency` is ISO-4217. Tenant-scoped by RLS.
 */
export const trips = pgTable("trips", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  itineraryId: uuid("itinerary_id")
    .notNull()
    .references(() => contentItems.id),
  title: text("title").notNull(),
  theme: text("theme"),
  priceCents: integer("price_cents").notNull(),
  depositCents: integer("deposit_cents").notNull(),
  currency: text("currency").notNull().default("eur"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Commerce: a scheduled **Departure** of a Trip — a date plus a seat capacity.
 * The waitlist is derived (bookings with status `waitlisted`). Tenant-scoped.
 */
export const departures = pgTable("departures", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  tripId: uuid("trip_id")
    .notNull()
    .references(() => trips.id),
  departureDate: date("departure_date", { mode: "string" }).notNull(),
  seats: integer("seats").notNull(),
  status: text("status").notNull().default("scheduled"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Commerce: a **Booking** — a customer's seat on a Departure, driven by the
 * booking state machine (`reserved → deposit_pending → confirmed`, or
 * `waitlisted` when the Departure is full). `depositCents`/`currency` are
 * snapshotted from the Trip at booking time; `paymentRef` is the PaymentPort
 * reference once the deposit is collected. Tenant-scoped by RLS.
 */
export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  departureId: uuid("departure_id")
    .notNull()
    .references(() => departures.id),
  customerEmail: text("customer_email").notNull(),
  customerName: text("customer_name"),
  status: text("status").notNull().default("reserved"),
  depositCents: integer("deposit_cents").notNull(),
  currency: text("currency").notNull().default("eur"),
  paymentRef: text("payment_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
});

export const contentEmbeddings = pgTable("content_embeddings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 256 }).notNull(),
});
