# ADR-0028 — Graphify (code knowledge-graph) evaluation

Status: Accepted (decision: **defer**) — 2026-06-01

## Context

The roadmap's final item pairs multi-tenant hardening with a **Graphify
evaluation**. Per DEVELOPMENT.md §9, the question is whether to adopt a **code
knowledge-graph** ("Graphify"-style: index the repo into a graph of
files/symbols/imports/call-edges, queryable by humans and AI agents) to fight
**context rot** now that the codebase spans ~12 bounded contexts
(`modules/{content,media,social,email,settings,monetization,commerce,crm,
analytics,feedback,onboarding,auth,tenancy}` + `verticals/travel` + `platform/*`).

"Context rot" here = the agent/human progressively losing an accurate mental map
of the system as it grows, leading to wrong assumptions, duplicated code, and
boundary violations.

## What the codebase already does against context rot

1. **Hard module boundaries** — `arch/boundaries.test.ts` fails the build if a
   module reaches into another's internals; every cross-module dependency goes
   through a public barrel (`index.ts`). The import graph is therefore *small,
   explicit, and enforced* rather than emergent.
2. **Externalised, versioned context** — ADRs (decisions + rationale), PRODUCT.md
   (current truth), ROADMAP.md (phase→task), TECH_DEBT.md (every shortcut + a
   re-entry trigger), and per-slice design notes. Each slice re-externalises its
   context so the next inherits it. This is a *curated* knowledge layer that a
   generic graph cannot synthesise.
3. **Vertical slices at context boundaries** — one slice = one module = one task,
   keeping the working set that any agent must hold at once intentionally small.
4. **A test pyramid as a behavioural map** — unit/arch · HTTP · integration(RLS)
   describe what each surface does and guard it.

## Decision — **defer adoption; revisit at concrete triggers**

A standing Graphify-style knowledge graph is **not justified now**:

- The dominant context-rot risks (boundary erosion, stale "current truth") are
  already addressed by the arch-test and the curated docs — controls a generic
  graph would *duplicate but not replace*, while adding an index to keep in sync
  (its own rot risk).
- At n≈12 modules with enforced barrels, on-demand tools (ripgrep, the barrels,
  the type-checker, `arch/boundaries.test.ts`) already answer "who depends on
  what" cheaply and *accurately*. A persisted graph mainly pays off past the
  point where ad-hoc search stops scaling or where many contributors navigate
  unfamiliar code.
- Cost/benefit: build+maintain a graph pipeline vs. marginal navigation gain for
  a single dogfooding operator.

**Revisit when any of these triggers fire:**

1. **People scale** — a second engineer regularly works in unfamiliar modules.
2. **Module scale** — modules/verticals exceed ~20, or cross-module call depth
   makes barrels insufficient to reason about blast radius.
3. **Agent scale** — autonomous agents (DEBT-014 autonomy engine) start making
   multi-module changes and measurably regress from missing whole-repo context;
   a graph fed to the agent would then earn its keep.
4. **A second vertical** beyond travel, multiplying the surface an agent must map.

If adopted, prefer a tool that **derives** the graph from source on demand and is
checked in CI for staleness, rather than a hand-maintained store — and feed it the
*existing* curated layer (ADRs, boundaries) rather than replacing it.

## Consequences

- No code or dependency added now; the existing arch-test + ADR/doc discipline
  remains the context-rot defence (and is reinforced this slice by the executable
  multi-tenant audit).
- The decision is cheap to reverse: the triggers above are observable, and the
  enforced barrels mean a graph could be generated later without refactoring.
