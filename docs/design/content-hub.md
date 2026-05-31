# Content-Hub UI — Design & IA spec

> Living design spec for the **product UI** of Blogs Manager (the content-hub).
> Grounds the slice plan in the *real* existing stack. Guiding model: **ADR-0020**
> ("AI agency: propose→approve; toolbox, not wizard") — distilled in
> `/home/utentefahmoh/bm-build/content-hub-brief.md`. ADR-0020 itself is
> intentionally **not committed** yet, so this doc records the decisions we build
> against without touching the ADR log / PRODUCT.md.
>
> Status: **COMPLETE** — all 5 slices landed. Foundations + app-shell (slice 0),
> the four surfaces (slices 1–4) and the cross-surface integration + full hub
> journey (slice 5) are built and green on the fast suites; the conductor runs the
> e2e gate. See §9 (Integration) and §10 (Build summary).

## 1. What this is

The content-hub is the durable product surface. The current `/studio` (a linear
wizard) and `/newsletter` are throwaway **walking skeletons** that exist only to
keep the E2E journeys green — they are **kept working**, not extended, and their
journeys get reproduced inside the hub in later slices.

The hub replaces the wizard mental model with a **toolbox**: a staff of AI
specialists (writer, editor/planner, SEO, social manager, email marketer) that
**propose** work; the human **approves / edits / rejects**. One universal gesture
everywhere, backed by the existing publish state machine.

## 2. Information architecture

```
/                         home (kept) → link into the hub
(hub)  ── app-shell: persistent toolbox rail + active surface ──
  /hub                    entry / launcher (tiles for the 4 tools)
  /library                Surface 1 — all ContentItems + state badges
  /editor                 Surface 2 — canonical block editor + authenticity meter
  /proposals              Surface 3 — propose→approve/edit/reject queue
  /settings               Surface 4 — brand voice · autonomy knob (stub) · channels
/studio                   legacy walking skeleton (kept green, untouched)
/newsletter               legacy walking skeleton (kept green, untouched)
```

The 4 surfaces are **independent destinations** reachable in any order from a
stable nav. They are NOT steps in a sequence. The route group `(hub)` shares the
app-shell chrome without adding a URL segment; `/studio` and `/newsletter` sit
outside the group and are unaffected.

## 3. The 4 surfaces

### Surface 1 — Library (slice 1) — BUILT
The home base for content. Lists every **ContentItem** (article, page, gallery,
itinerary…) with a **state badge** from the publish state machine
(`draft → proposed → review → approved → published`), filterable by type/state.
Each row links into the Block Editor.

- Reuses: `PublicationStatus` + `StateBadge`, the `fetch`/`NEXT_PUBLIC_API_URL`
  client pattern, `PageHeader` + `Card`.
- **Data source (DEBT-009 PAID):** `GET /articles` is now a **list read-model**
  in `modules/content` — `{ items: [{ id, type, status, title, publishedAt,
  updatedAt }] }`, optional `?type=` / `?status=` filters, behind the tenant
  guard + RLS. The filter selects re-fetch with those query params.
- **Editor URL contract (for slice 2):** each row links to **`/editor?id=<id>`**
  (the ContentItem id). Slice 2's Block Editor reads `id` from the query string
  and loads that item via `GET /articles/:id`. This is the stable navigation
  contract between Library and Editor.

### Surface 2 — Block Editor (slice 2) — BUILT
Edits a ContentItem on the **canonical block model** — an ordered list of
portable JSON blocks (`heading` / `paragraph` / `image` referencing a Media-DAM
asset by id), never HTML (`@blogs/contracts` `blockSchema`). Surfaces the
**authenticity meter** (`{ score, flags[] }`, as `/studio` already renders) as a
persistent companion, not a gate: AI brings craft, the human brings lived
experience + voice (E-E-A-T). Editing nudges the score up via the flags.

- **Write path:** `PATCH /articles/:id` persists `title?` / `blocks?` behind the
  tenant guard + RLS (validates `blocks` against `blocksSchema`; cross-tenant →
  `404`), over the existing `updateContentItem` repo fn.
- **Meter source:** `GET /articles/:id/authenticity` reuses
  `platform/ai/measureAuthenticity` (the same measurer `/studio` uses) — no
  client-side duplication. Re-fetched after each save. The reusable
  `app/(hub)/AuthenticityMeter.tsx` renders `{ score, flags }`; it never blocks.

### Surface 3 — Proposal Queue (slice 3) — BUILT
The propose→approve gesture made first-class: a queue of the content items
**awaiting a human decision** — those in `proposed` / `review` — that the human
**approves / rejects / edits**. Approve/reject reuse the publish state machine
via a thin **content-item decision endpoint** (`POST /articles/:id/approve` walks
proposed→review→approved; `POST /articles/:id/reject` = requestChanges→draft;
`POST /articles/:id/propose` feeds the queue), all over `transitionContentItem`.
On a decision the item leaves the queue (re-fetch). **Edit** opens the slice-2
Block Editor (`/editor?id=<id>`). The Phase-2.5 channel-post approval gate
(`POST /articles/:id/posts/:postId/approve|reject`) remains available for the
distribution side and can be folded into the queue later.

### Surface 4 — Settings (slice 4) — BUILT
Brand voice, **per-specialist autonomy knob** and channels — tenant-scoped and
persisted. The page loads via `GET /settings`, edits brand voice (tone +
audience), the four autonomy selects, and the channel toggles, and saves via
`PUT /settings`. Persistence lives in a new `tenant_settings` table (one JSONB
row per tenant, **RLS** on `tenant_id`, runtime grants for the app role) behind
the tenancy guard; `GET` returns defaults (manual autonomy everywhere) when no
row exists yet. Settings shape (`@blogs/contracts` `TenantSettings`):
`{ brandVoice: { tone, audience }, specialistAutonomy: { writer, seo, social,
email }, channels: { channel, enabled }[] }`.

- **Brand voice reuses the AI pipeline's `{ tone, audience }`** shape
  (`platform/ai/pipeline.ts`) — Settings make it per-tenant editable instead of
  the hard-coded `FOUNDER_VOICE` constant.
- Autonomy knob = **stub**: `manual / semi-auto / auto-within-limits`, **default
  manual** for every specialist; the UI labels it as informational (takes effect
  in a later build). Slice 4 persists the choice; wiring beyond persistence (an
  actual rules/automation engine) is later work — recorded as debt at that
  point, not now.
- Channels are **intent only** (which channels to use); real per-tenant OAuth/key
  onboarding is **DEBT-008** (out of scope).

## 4. Navigation model — toolbox, not wizard

- A **persistent left rail** (`ToolboxNav`) lists Hub + the 4 surfaces; the
  active one is highlighted from the current path (`usePathname`, `aria-current`).
- No "next/back", no forced ordering, no progress stepper. The user opens any
  tool directly.
- **Chaining is opt-in and composable**, never forced: e.g. from a published
  article you *may* jump to "propose social posts", but nothing requires it. No
  permanent rules engine in this build — chaining is a per-moment action.

## 5. How propose→approve and the authenticity meter surface

- **Propose→approve** is the *same* state machine everywhere
  (`draft→proposed→review→approved→published`), visualised by one `StateBadge`
  component. Wherever an item appears (Library row, Proposal Queue card, Editor
  header) the badge reads identically, so the gesture is learnable once.
- **Authenticity meter** is a **counterweight, not a blocker**. It shows a score
  (0–100%) + actionable flags ("sezioni da arricchire"). It informs the human;
  it never prevents publishing. It lives in the Editor and is summarised on
  Library rows in later slices.
- **Automation compass:** outbound work (content/social/newsletter/SEO) =
  "approve the plan, then trust execution". Inbound (client mail/sales) is **out
  of scope** here (Phase-3 backend doesn't exist).

## 6. Visual & interaction principles

- **Reuse the existing convention:** inline `style={{}}` objects + the system
  font stack. There is **no Tailwind / CSS-modules / component library** in
  `apps/web`, and slice 0 introduces **none** — tokens are plain TS values.
- **Tokens are the single source of truth** (`src/ui/tokens.ts`): color, spacing,
  radius, typography, shadow. Surfaces compose primitives, not ad-hoc styles.
- **Calm, content-first, founder-as-first-user:** neutral surface, one accent
  (`#3b5bdb`) for "the human acts here", state-colored badges for the lifecycle.
- **Accessibility basics:** semantic landmarks (`<nav aria-label>`, `<main>`,
  heading-per-surface), `aria-current` on the active tool.
- **Testability:** stable `data-testid`s on the shell (`toolbox-nav`, `nav-*`)
  and each surface (`surface-*`, `surface-placeholder`) — the E2E smoke and later
  slices assert against these.

## 7. Component inventory

### Reused (from the existing app / contracts)
- **Inline-style + system-font convention** — from `/studio`, `/newsletter`.
- **`fetch` API client** — `process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000"`.
- **`@blogs/contracts` (as the source of truth for shapes)** — `PublicationStatus`,
  `blockSchema`/`Block`, `ChannelPost*`. NB: `apps/web` doesn't depend on the
  contracts package today (the legacy surfaces inline their types), so slice 0
  *mirrors* `PublicationStatus` locally in `src/ui/components.tsx`. A later slice
  can add the workspace dep and import directly.
- **Existing endpoints** — `GET /articles/:id`, `POST /articles/:id/publish`,
  `POST /articles/:id/repurpose`, `POST /articles/:id/posts/:postId/approve|reject`,
  newsletter `subscribe/confirm/send`.
- **`data-testid` E2E convention** — same testing approach as the legacy suites.

### New (slice 0 baseline — `apps/web/src/ui/` + `app/(hub)/`)
| Component | File | Purpose |
|---|---|---|
| Design tokens | `src/ui/tokens.ts` | color/space/radius/font/shadow + nav width |
| `PageHeader` | `src/ui/components.tsx` | surface title + subtitle |
| `Card` | `src/ui/components.tsx` | raised content container |
| `StateBadge` | `src/ui/components.tsx` | publish-state badge (maps `PublicationStatus`) |
| `SurfacePlaceholder` | `src/ui/components.tsx` | "coming in slice N" stub (asserted by smoke) |
| `HubLayout` | `app/(hub)/layout.tsx` | app-shell: rail + active surface |
| `ToolboxNav` | `app/(hub)/ToolboxNav.tsx` | persistent toolbox rail (client, active state) |
| `SURFACES` config | `app/(hub)/surfaces.ts` | single source of nav/surface metadata |
| 4 surface pages | `app/(hub)/{library,editor,proposals,settings}/page.tsx` | placeholders |
| Hub home | `app/(hub)/hub/page.tsx` | launcher tiles |

### To build in later slices
- ~~Library list + filters (needs the list endpoint — DEBT-009).~~ **Done (slice 1).**
- Block-editor canvas + authenticity-meter panel.
- Proposal cards + approve/edit/reject actions over the state machine.
- Settings forms: brand voice, autonomy stub, channels.

## 8. Decisions fixed for this build (assumptions, founder 2026-05-31)
- Per-specialist autonomy: **default manual**; Settings exposes the knob as a
  persistence-only **stub** (manual / semi-auto / auto-within-limits).
- Chaining: **opt-in at the moment**, no rules engine yet.
- Business priority: **content engine first**; Trip/Departure/CRM (travel-sales,
  inbound) are **out of scope** (Phase-3 backend absent).
- ADR-0020, `PRODUCT.md`, `docs/adr/README.md` are **not** modified in this build.

## 9. Integration (slice 5) — one coherent hub + the cross-surface journey

Slice 5 ties the four independent surfaces into a single product hub and proves
it with one end-to-end journey. No new product feature — integration, polish,
docs (see [ADR-0021](adr/0021-content-hub-ui.md)).

- **Hub home as a real landing** (`/hub`): states the operating model up front —
  *the AI agency proposes, the human confirms; toolbox, not wizard* — renders the
  publish lifecycle as `StateBadge`s (`draft→proposed→review→approved→published`),
  and lists the four tools as tiles that open directly in any order
  (`hub-operating-model`, `hub-lifecycle`, `tile-nav-*`).
- **Consistency pass:** every surface now exposes a `*-header` landmark
  (`library/editor/proposals/settings-header`); the same `StateBadge` renders the
  lifecycle wherever an item appears (hub, Library row, Editor header, Proposal
  card); the same `AuthenticityMeter` is the Editor's counterweight. Tidied the
  now-unused `slice` metadata off `surfaces.ts`.
- **Cross-surface flows** connect cleanly and were verified end-to-end: Library
  row → Editor (`/editor?id=`); Proposal **Edit** → the same Editor; Approve/
  Reject ride the real state machine; Settings reachable from the toolbox.
- **Legacy kept green:** `/studio` and `/newsletter` walking skeletons are
  untouched; their e2e specs remain.

### The full journey — `apps/web/e2e/hub-journey.spec.ts`
ONE journey, self-seeded via the API (a generated article + a proposed item),
exercising the hub as a toolbox (no forced order):

1. `/hub` orients the founder (operating model + toolbox nav visible).
2. **Library** (via nav): the seeded article shows with its `draft` badge.
3. **Editor** (via the Library row → `/editor?id=`): edit title + a block, save;
   the authenticity meter stays visible; the edit is verified persisted via API.
4. **Proposal Queue** (jumped to directly from the toolbox — independence): the
   seeded proposal shows `proposed`; **Approve** advances it through the real
   state machine and it leaves the queue (verified `approved` via API).
5. **Settings** (via nav): change the brand-voice tone, save, **reload**, assert
   it persisted.

The toolbox rail persists across every surface (app-shell chrome). Per the WSL
harness constraint, e2e is **written test-first here but run by the conductor**;
slice 5 is verified locally on the fast suites only.

### Operating-model mapping (ADR-0020 → the UI)
| ADR-0020 idea | Where it lives in the hub |
|---|---|
| Agency **proposes → human confirms** | Proposal Queue (approve/edit/reject) + the universal `StateBadge` everywhere |
| **Toolbox, not wizard** | persistent `ToolboxNav` + hub tiles; surfaces independent, navigable in any order; journey asserts no forced sequence |
| **Authenticity = counterweight** | `AuthenticityMeter` in the Editor (informational, never a gate) |
| **Automation compass** (outbound = approve-then-trust) | per-specialist **autonomy stub** in Settings (default manual) |
| Inbound (client mail/sales) | **out of scope** — Phase-3 backend absent |

## 10. Build summary & known follow-ups

**Built (slices 0–5):** the content-hub app-shell + toolbox nav; four surfaces —
**Library** (`GET /articles` list read-model), **Block Editor** (`PATCH
/articles/:id` + `GET /articles/:id/authenticity`), **Proposal Queue** (content
decision endpoints `propose/approve/reject` over the state machine), **Settings**
(`GET`/`PUT /settings` + `tenant_settings` RLS table); a reusable design system
(`src/ui`), `StateBadge`, `AuthenticityMeter`; per-surface e2e specs + the full
cross-surface journey. Reuse-over-reinvent throughout: no new framework, the same
inline-style + tokens convention as the legacy surfaces.

**Known follow-ups (not blocking; for the founder / Phase 3):**
- **Brand-voice loop** — the travel generator still reads the hard-coded
  `FOUNDER_VOICE` constant; Settings now persists the voice, so generation should
  read it from `getTenantSettings`. Recorded as **DEBT-010**.
- **Autonomy engine** — the per-specialist knob is a persistence-only stub; a real
  rules/automation engine is later work (record debt at *that* point per ADR-0020).
- **Distribution proposals** — channel-post approve/reject (Phase-2.5 gate) can be
  folded into the same Proposal Queue.
- **Channel onboarding** — real per-tenant OAuth/key onboarding is **DEBT-008**.
- **Contracts in the web app** — `apps/web` still mirrors `PublicationStatus` /
  settings types locally; a later slice can add the `@blogs/contracts` workspace
  dep and import directly.
