# Monetization — design note (Fase 3)

> Living design note for the **monetization** vertical. Slice 1 (this doc) is the
> **affiliate hub + `/go/` redirector + click tracking**. Slices 2–3 (commerce
> Trip/Departure + Stripe; custom CRM pipeline) extend this note when built.
> Decisions log: [ADR-0022](../adr/0022-affiliate-hub-redirector.md).

## 1. Slice 1 — Affiliate hub (BUILT)

The founder creates **tracked outbound links** to paste into articles / social /
newsletter; a public **redirector** counts each click and forwards to the
partner. ROADMAP acceptance: *a click passes through the redirector and is
counted per link / article / channel.*

### Backend — `modules/monetization` (tenant-scoped + RLS)

- **`AffiliateController` (`/affiliates`)**
  - `POST /affiliates` — create a link `{ code, targetUrl, contentItemId?,
    channel?, label? }`. `code` is a URL-safe slug, **unique per tenant**
    (duplicate → `409`); invalid payload → `400`.
  - `GET /affiliates` — list the tenant's links, each with its total `clicks`
    (LEFT JOIN so zero-click links still appear).
  - `GET /affiliates/stats` — click counts aggregated three ways:
    `{ byLink[], byArticle[], byChannel[] }`. Declared before any `:param` route.
  - `PATCH /affiliates/:id` — edit `targetUrl` / `contentItemId` / `channel` /
    `label` (never `code` — it's the stable public key); missing/foreign → `404`.
- **`RedirectorController` (`/go/:code`)**
  - `GET /go/:code` — resolve the link by `code` in the tenant context, record a
    click, then **`302`** to `targetUrl`. Unknown code → `404`. The click path is
    two lightweight statements (resolve → insert) in one tenant transaction, so
    the redirect stays fast.

### Data — two RLS tables (migration `0008`, `APP_RW_TABLES` grant)

| Table | Holds | Notes |
|---|---|---|
| `affiliate_links` | id, tenant_id, **code** (unique per tenant), target_url, content_item_id?, channel?, label?, timestamps | RLS `FORCE` + `tenant_isolation` policy |
| `affiliate_clicks` | id, tenant_id, link_id, **content_item_id?**, **channel?**, clicked_at | associations **snapshotted from the link at click time** |

**Why snapshot on the click:** per-article / per-channel counts stay correct even
if a link is later re-pointed, and aggregation is a plain `GROUP BY` (no historical
joins). See ADR-0022.

### Tenancy of a public click (n=1)

The redirector resolves in the **founder tenant context** — exactly like the
public **newsletter confirm** link already does — so RLS still scopes it: a tenant
can only redirect/count **its own** links. Resolving a truly anonymous click
(domain → tenant) is **tenant-#2** work, the same frontier as the `TenancyService`
stub; not this slice. No expired debt introduced.

### Frontend — Affiliate surface (`/affiliates`, in the hub toolbox)

A 5th independent surface in the content-hub toolbox (`surfaces.ts` →
`nav-affiliates`). Reuses `PageHeader` / `Card` + tokens + the `fetch` pattern
(inline styles, no new framework). Create a link via a form; the list shows each
link's `/go/:code`, its target, channel, and **live click count**
(`affiliate-clicks`). Pasteable redirector URL is rendered per row.

### Tests (red → green)

- **HTTP** (`affiliate.http.test.ts`): create (clicks 0) → `/go/:code` `302` +
  `Location` → counts increment; counts segment per link / article / channel;
  `404` unknown, `409` duplicate, `400` invalid, `PATCH` edit + `404`; **RLS** —
  the founder can't see/redirect/count another tenant's link.
- **Integration** (`affiliate.integration.test.ts`, as the `app_rw` NOSUPERUSER
  role): record clicks + aggregate counts; **RLS isolation** (tenant B can't
  resolve/count A's link); per-tenant-unique `code`. Plus a grant guard in
  `runtime-rls.integration.test.ts`.
- **E2E** (`affiliates.spec.ts`, test-first; conductor runs it): create a link in
  the surface → click through `/go/:code` (302 to target) → the surface count
  increments; unknown code 404s.

## 2. Next (not in slice 1)

- **Slice 2 — Commerce**: `Trip` + `Departure` + booking/waitlist (seats) +
  **Stripe in test mode / stubbed at the boundary**. Journey: *launch departure →
  book seat → deposit → confirm*. New tenant-scoped tables (same RLS + grant
  recipe as here).
- **Slice 3 — Custom CRM pipeline**: lead → AI proposal → deposit → confirm, with
  WhatsApp/mail routing; itinerary delivered in a client portal.
- **Phase 4** folds affiliate clicks into the **unified analytics** ingest.
