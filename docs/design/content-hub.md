# Content-Hub UI — Design & IA spec

> Living design spec for the **product UI** of Blogs Manager (the content-hub).
> Grounds the slice plan in the *real* existing stack. Guiding model: **ADR-0020**
> ("AI agency: propose→approve; toolbox, not wizard") — distilled in
> `/home/utentefahmoh/bm-build/content-hub-brief.md`. ADR-0020 itself is
> intentionally **not committed** yet, so this doc records the decisions we build
> against without touching the ADR log / PRODUCT.md.
>
> Status: **slice 0** (foundations + app-shell + placeholders) done. Surfaces fill
> in over slices 1–4; slice 5 integrates.

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

### Surface 1 — Library (slice 1)
The home base for content. Lists every **ContentItem** (article, page, gallery,
itinerary…) with a **state badge** from the publish state machine
(`draft → proposed → review → approved → published`), filterable by type/state.
Each row links into the Block Editor.

- Reuses: `PublicationStatus` + `StateBadge`, the article read endpoint shape.
- **Gap (handoff):** there is no list/collection endpoint yet — `GET /articles`
  returns one item by id only. Slice 1 needs a list endpoint (or a thin
  read-model) in `modules/content`. Tracked as **DEBT-009**.

### Surface 2 — Block Editor (slice 2)
Edits a ContentItem on the **canonical block model** — an ordered list of
portable JSON blocks (`heading` / `paragraph` / `image` referencing a Media-DAM
asset by id), never HTML (`@blogs/contracts` `blockSchema`). Surfaces the
**authenticity meter** (`{ score, flags[] }`, as `/studio` already renders) as a
persistent companion, not a gate: AI brings craft, the human brings lived
experience + voice (E-E-A-T). Editing nudges the score up via the flags.

### Surface 3 — Proposal Queue (slice 3)
The propose→approve gesture made first-class: a queue of specialist proposals —
content drafts AND distribution (channel posts) — that the human **approves /
edits / rejects**. Reuses the publish state machine and the **Phase-2.5 approval
gate** (`POST /articles/:id/posts/:postId/approve|reject`, the same transitions
`/studio` step 5 already drives). The queue is the hub-native home of that gate.

### Surface 4 — Settings (slice 4)
Brand voice, **per-specialist autonomy knob** and channels.

- Autonomy knob = **stub**: `manual / semi-auto / auto-within-limits`, **default
  manual** for every specialist. Slice 4 persists the choice; wiring beyond
  persistence (an actual rules/automation engine) is later work — recorded as
  debt at that point, not now.

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
- Library list + filters (needs the list endpoint — DEBT-009).
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
