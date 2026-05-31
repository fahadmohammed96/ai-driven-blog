# Design note — Multi-tenant hardening + tenant #2 onboarding (Phase 4.3)

Closes Phase 4 and the roadmap. See [ADR-0027](../adr/0027-tenant-onboarding-and-multi-tenant-hardening.md)
(onboarding + hardening) and [ADR-0028](../adr/0028-graphify-evaluation.md) (Graphify: defer).

## The onboarding path

```
POST /tenants  (founder JWT)                 modules/onboarding
  └─ OnboardingController.create
       ├─ auth.verify(bearer)                 401 if missing/invalid
       ├─ provisionTenantInputSchema.safeParse  400 on bad slug/name
       └─ OnboardingService.onboard
            └─ provisionTenant(adminDb, appDb, input)
                 1. ADMIN conn:  insert into tenants (slug,name) … returning id   [privileged root]
                 2. app_rw conn: withTenant(id) → insert tenant_settings          [runtime RLS]
                 → { id, slug, name, settings }
```

Two privileges, on purpose: `app_rw` has **no INSERT on `tenants`**, so only the
admin path can mint a tenant; the baseline settings are written through the same
least-privilege role every request uses, proving the new tenant works under RLS
the instant it exists. Idempotent on `slug` (re-onboarding refreshes the name,
leaves settings intact).

## RLS + grant AUDIT — table by table (all green, as `app_rw`)

Every tenant-scoped table: RLS `ENABLE`+`FORCE` + `tenant_isolation` policy
(`tenant_id = current_setting('app.current_tenant')`) AND `app_rw`
`SELECT/INSERT/UPDATE/DELETE` (`APP_RW_TABLES` in `platform/db/bootstrap.ts`).

| Module | Table | RLS enable+force | policy | app_rw DML |
|---|---|---|---|---|
| content | content_items | ✓ | ✓ | ✓ |
| content (travel) | itinerary_stops | ✓ | ✓ | ✓ |
| media | media_assets | ✓ | ✓ | ✓ |
| media (travel) | itinerary_stop_photos | ✓ | ✓ | ✓ |
| content (RAG) | content_embeddings | ✓ | ✓ | ✓ |
| social | channel_posts | ✓ | ✓ | ✓ |
| email | subscribers | ✓ | ✓ | ✓ |
| email | subscriptions | ✓ | ✓ | ✓ |
| integration | connector_credentials | ✓ | ✓ | ✓ |
| settings | tenant_settings | ✓ | ✓ | ✓ |
| monetization | affiliate_links | ✓ | ✓ | ✓ |
| monetization | affiliate_clicks | ✓ | ✓ | ✓ |
| commerce | trips | ✓ | ✓ | ✓ |
| commerce | departures | ✓ | ✓ | ✓ |
| commerce | bookings | ✓ | ✓ | ✓ |
| crm | leads | ✓ | ✓ | ✓ |
| analytics | metric_snapshots | ✓ | ✓ | ✓ |
| (root) | **tenants** | n/a (root) | n/a | **SELECT only** — never INSERT |

The audit is **executable**: `onboarding.integration.test.ts` queries
`pg_class`/`pg_policies`/`has_table_privilege` for each row above and fails if any
cell regresses. It also asserts `app_rw` cannot `INSERT` into `tenants` (and that
the insert actually throws at runtime).

## Acceptance — cross-module isolation, as the least-privilege role

Onboard tenant A and tenant B; write one representative row into **every**
tenant-scoped table for each (as `app_rw`, via `withTenant`); then under each
tenant's scope every table shows **exactly its own one row** (settings from
onboarding, the rest from the seed) and never the other tenant's. A leak would
show 2. Belt-and-suspenders: nothing A reads ever carries B's `tenant_id`.

## DEBT-005 — confirmed PAID (reinforced)

The runtime is `app_rw` (`NOSUPERUSER`) → RLS enforced at runtime
(`isRlsBypassed(appDb) === false`, asserted here and in `runtime-rls`). The new
whole-surface audit + cross-tenant acceptance are additional standing evidence.

## Honest boundary — what remains (DEBT-015)

Data isolation is fully hardened and proven. **Request-time tenant resolution is
not yet built**: `TenancyService.current()` still returns `FOUNDER_TENANT_ID`, so
a second tenant cannot log in and have requests auto-scoped, and the onboarding
endpoint reuses the founder JWT rather than a dedicated admin role. That is the
next increment — recorded as **DEBT-015**, not hidden. It does not weaken the
isolation guarantee (which is enforced by RLS at the data layer regardless of how
the tenant id is chosen).
