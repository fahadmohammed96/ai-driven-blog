# ADR-0027 — Tenant onboarding path + multi-tenant hardening (Phase 4.3)

Status: Accepted — 2026-06-01

## Context

The data model has been tenant-aware since Phase 0 (ADR-0002): every business
table carries `tenant_id`, with Postgres **RLS** `ENABLE`+`FORCE` and a
`tenant_isolation` policy keyed on `current_setting('app.current_tenant')`. Since
2026-05-30 the runtime connects as a least-privilege `app_rw` (`NOSUPERUSER`)
role so RLS is enforced **at runtime**, not only in tests (DEBT-005, PAID).

What was missing for a real second tenant:

1. **An onboarding path.** Only the founder tenant was ever seeded (`ensureTenant`
   in `main.ts` bootstrap). There was no validated way to bring a *new* tenant
   into being with its baseline configuration.
2. **A whole-surface isolation guarantee.** Each module had its own RLS
   integration test, but nothing asserted, in one place, that *every*
   tenant-scoped table across *all* modules is isolated AND reachable by the
   runtime role — the exact gap that broke slice 4 (a missing `tenant_settings`
   grant, caught only by e2e).

## Decision

**Onboarding is a real, tested, two-privilege path** (`modules/onboarding`):

- `provisionTenant(adminDb, appDb, input)` —
  1. writes the `tenants` **root** row on the **admin** (superuser) connection,
     idempotent on `slug`. The runtime `app_rw` role has *no* INSERT on
     `tenants`, so only privileged provisioning can mint a tenant;
  2. seeds the baseline `tenant_settings` through the **runtime** `app_rw` role
     inside the new tenant's RLS scope (`withTenant`) — proving the freshly-minted
     tenant is immediately usable under least-privilege RLS, the same path every
     request takes.
- `OnboardingService` wraps it, building a short-lived admin connection from
  `DATABASE_ADMIN_URL` (mirrors `main.ts`), and injecting the runtime `DB`.
- `POST /tenants` (`OnboardingController`) exposes it, **gated by the founder JWT**
  (the platform operator), verified the way `/auth/me` already does.

**The audit is executable, not prose.** `onboarding.integration.test.ts` runs as
`app_rw` and asserts, for every one of the 17 tenant-scoped tables, that RLS is
`ENABLE`+`FORCE` with a policy AND that `app_rw` holds `SELECT/INSERT/UPDATE/DELETE`;
that `tenants` is read-only for `app_rw`; and — the **acceptance** — that after
onboarding tenant #2, a representative write in *every* module's table for two
tenants leaves each tenant seeing exactly its own row and never the other's.

## Consequences

- The roadmap acceptance — *onboard an isolated second tenant; the multi-tenant
  debt is paid* — is met and **guarded by a test** that fails if any future table
  is added without RLS + grant (the slice-4 failure mode becomes impossible to
  miss).
- Tenant provisioning is correctly modelled as a **privileged** operation
  (admin connection), distinct from the least-privilege request path.
- **Out of scope / remaining (DEBT-015):** request-time tenant *resolution*.
  `TenancyService.current()` still returns the founder tenant from
  `FOUNDER_TENANT_ID`; a logged-in user is not yet mapped to a tenant. Data
  isolation is fully hardened and proven, but a second tenant cannot yet *log in*
  and have requests auto-scoped. That — plus a dedicated admin role for the
  onboarding endpoint, vs. reusing the founder JWT — is the next increment.
  Recorded in TECH_DEBT as **DEBT-015** with a concrete trigger.
