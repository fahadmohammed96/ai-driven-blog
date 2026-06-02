import {
  pgTable,
  uuid,
  text,
  timestamp,
  vector,
  jsonb,
  integer,
  doublePrecision,
  numeric,
  date,
  unique,
} from "drizzle-orm/pg-core";
import type { Block, ChannelPost, SeoProposal, TenantSettings } from "@blogs/contracts";

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
  // SEO Agent annotation (Slice S1): the approved `SeoProposal` (title, meta,
  // slug, primary keyword, internal links, readability) — NON-BLOCKING, it
  // enriches the item, it does NOT add a publication state. Nullable: an item
  // has no SEO annotation until a `seo_suggestions` proposal is approved. Covered
  // by the table's existing tenant RLS policy (no extra grant — table-level
  // GRANT on content_items already covers new columns).
  seoProposal: jsonb("seo_proposal").$type<SeoProposal>(),
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

/**
 * CRM custom-trip pipeline (Fase 3, motion "Su misura" — INBOUND/one-to-one). A
 * **Lead** is an inbound custom-trip request driven by the lead state machine
 * (`received → ai_drafted → human_approved → sent → deposit_pending → confirmed →
 * delivered`). `proposal` is the AI-drafted offer (null until drafted, and never
 * sent until a human approves — the inbound gate). `depositCents`/`currency` carry
 * the offered deposit; `paymentRef` is the PaymentPort reference once the deposit
 * is collected. `portalToken` is the unguessable token for the client-portal read
 * view (`/portal/:token`). Tenant-scoped by RLS.
 */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    customerEmail: text("customer_email").notNull(),
    customerName: text("customer_name"),
    channel: text("channel").notNull().default("email"),
    request: text("request").notNull(),
    status: text("status").notNull().default("received"),
    proposal: text("proposal"),
    depositCents: integer("deposit_cents"),
    currency: text("currency").notNull().default("eur"),
    paymentRef: text("payment_ref"),
    portalToken: text("portal_token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [unique("leads_portal_token_unique").on(t.portalToken)],
);

/**
 * Unified analytics (Fase 4, slice 1): one cross-channel metric data point.
 * Each row is `(source, channel, metric, value, period)` optionally tied to a
 * content item — written by the analytics ingestion from **internal** sources we
 * already own (affiliate clicks, subscribers, channel-posts, content) and from
 * **external** sources stubbed at the boundary (GA4, Search Console). Ingestion
 * replaces a source's rows on each run (idempotent snapshot). Tenant-scoped by RLS.
 */
export const metricSnapshots = pgTable(
  "metric_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    source: text("source").notNull(),
    channel: text("channel"),
    metric: text("metric").notNull(),
    value: doublePrecision("value").notNull(),
    period: text("period").notNull().default("all"),
    contentItemId: uuid("content_item_id").references(() => contentItems.id),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Ingest is "replace-per-source" (delete-then-insert). This unique key makes a
  // duplicate (source, channel, metric, period) for a tenant physically
  // impossible, so even overlapping/concurrent ingests stay idempotent — the
  // service upserts on it. NULLS NOT DISTINCT so a null channel can't slip a
  // second row past the constraint.
  (t) => [
    unique("metric_snapshots_tenant_source_channel_metric_period_unique")
      .on(t.tenantId, t.source, t.channel, t.metric, t.period)
      .nullsNotDistinct(),
  ],
);

/**
 * AI metering (Slice R1-B): one row per LLM round-trip — the audit trail behind
 * the per-tenant budget circuit-breaker. `MeteringService.record` writes it
 * synchronously (the spend is on the DB before the next step/sub-agent), and
 * `monthlySpendUsd` re-reads `SUM(cost_usd)` for the current month to feed
 * `BudgetGuard`. `cost_usd` is derived app-side from `pricePerToken(tier)` and
 * the usage (DEBT-016: prices hardcoded). `run_id` is nullable and joins toward
 * `ai_agent_runs` once that table lands (A1-core) — no FK yet, the table doesn't
 * exist. Tenant-scoped by RLS.
 */
export const aiUsageEvents = pgTable("ai_usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  // Nullable FK toward ai_agent_runs (A1-core); left unconstrained until that
  // table exists, so a single-shot (non-run) call can record with run_id NULL.
  // TODO(debt): DEBT-019 — add the FK once ai_agent_runs lands (A1-core).
  runId: uuid("run_id"),
  agentName: text("agent_name").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * AI agent audit (Slice A1-core) — one row per `AgentRunner` run: the audit
 * trail behind every proposal and the anchor for idempotent replay. The runner
 * writes it BEST-EFFORT after the loop (`auditRecorded=false` + a structured log
 * if the write fails, but the proposal is still returned). `task_id` is the
 * deterministic idempotency key — a second run with the same `task_id` returns
 * the stored proposal WITHOUT calling the LLM again. `tool_calls_json` is the
 * ReAct tool trace; `usage_json` is the run-result envelope (status + payload +
 * rationale + cost + aggregate token usage + truncated), which lets the replay
 * reconstruct the exact `Proposal` (the full `agent_proposals` staging table
 * lands in T1). `agent_definition_version` snapshots the producing config
 * (critica #12). Tenant-scoped by RLS. No TTL/archive yet — DEBT-021.
 */
export const aiAgentRuns = pgTable(
  "ai_agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    agentName: text("agent_name").notNull(),
    taskId: text("task_id").notNull(),
    steps: integer("steps").notNull(),
    toolCallsJson: jsonb("tool_calls_json").notNull().default([]),
    usageJson: jsonb("usage_json").notNull(),
    agentDefinitionVersion: text("agent_definition_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Idempotency anchor: at most one run ROW per (tenant, task). The runner
  // checks this key before spending on the LLM; the unique constraint makes a
  // duplicate ROW impossible even under a concurrent retry — it guards the audit
  // row, NOT the LLM spend (a concurrent pre-write delivery can double-call the
  // model before either row lands; that pre-insert reservation is DEBT-021).
  (t) => [unique("ai_agent_runs_tenant_task_unique").on(t.tenantId, t.taskId)],
);

/**
 * Agent proposal staging (Slice T1) — the staging queue of EVERY agent's
 * `Proposal<T>` (the Writer first). The architectural invariant of ADR-0020 made
 * structural: an agent run never touches published state, it lands a row here
 * (`status='pending'`) and a human gate consumes it. On approve, the payload is
 * injected into the existing Phase-1 publication state machine (a new
 * `content_items` draft → review) and the row is marked `approved`; reject just
 * marks it `rejected`. `run_id` joins toward `ai_agent_runs` (the ReAct
 * tool-trace = the agent's "reasoning" surfaced in the UI); it is NOT a DB FK —
 * the run audit is best-effort (a proposal can ship with `auditRecorded=false`),
 * so a constraint would couple the gate to the audit write (continues DEBT-021).
 * `agent_definition_version` snapshots the producing config (critica #12);
 * `research_context` carries the Researcher's transparency brief when present
 * (critica #14). Tenant-scoped by RLS. See DEBT-025 for what is still deferred.
 */
export const agentProposals = pgTable("agent_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  agentName: text("agent_name").notNull(),
  runId: uuid("run_id").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  rationale: text("rationale").notNull(),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6 }).notNull(),
  tokensUsed: jsonb("tokens_used").notNull(),
  status: text("status").notNull().default("pending"),
  agentDefinitionVersion: text("agent_definition_version").notNull(),
  researchContext: jsonb("research_context"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});

export const contentEmbeddings = pgTable("content_embeddings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 256 }).notNull(),
});
