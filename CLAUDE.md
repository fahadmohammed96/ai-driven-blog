# Blogs Manager — entry point (per agenti AI e umani)

> Hub SaaS **multi-tenant, AI-first** per gestire blog end-to-end (contenuti, social, email, CRM, monetizzazione).
> Primo verticale: **travel**. Primo utente: il fondatore stesso (**dogfooding**).
> Principio guida: **l'AI propone, l'umano conferma**.

## Stato attuale
- **Fase: 0 — Fondamenta** (in corso). Monorepo pnpm+Turborepo: `apps/api` (NestJS; `platform/modules/verticals` con confini da arch-test; Postgres+Drizzle con **RLS** su `tenant_id`, e pipeline **AI** (brand voice + RAG su pgvector) — tutto provato da test Testcontainers), `apps/web` (Next.js), `packages/{contracts,config}`. Lint/typecheck/unit verdi da root; integration (Docker) + E2E (Playwright) verdi; **CI** GitHub Actions su ogni PR.
- **Dev stack**: `docker/compose.yaml` (Postgres + MinIO + Mailhog) → `pnpm stack:up` · `stack:check` · `stack:down`.
- **Stack deciso**: TypeScript full-stack — NestJS · Next.js · Postgres + Drizzle · pg-boss.
- **Aperti**: auth (ADR dedicato) · hosting (al deploy).

## Fonti di verità — LEGGI PRIMA DI LAVORARE
Questi documenti del repo sono **canonici** (versionati, condivisi). Non fidarti della chat.
- **[docs/PRODUCT.md](docs/PRODUCT.md)** — cosa costruiamo e perché · dominio + glossario · architettura (stato corrente).
- **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)** — come si lavora: regole, test, Definition of Done, debito tecnico, stack.
- **[docs/ROADMAP.md](docs/ROADMAP.md)** — fasi → task (checklist).
- **[docs/adr/](docs/adr/README.md)** — decisioni e *perché* (log immutabile).
- **[docs/TECH_DEBT.md](docs/TECH_DEBT.md)** — registro del debito tecnico.

## Regole d'oro (estratto — dettaglio in DEVELOPMENT.md)
1. **Slice verticali sottili**, a confine di modulo (= confine di contesto = confine di task).
2. **Acceptance test PRIMA del codice**; una casella della roadmap si spunta **solo a test verde** (red-green), mai "verificato a mano".
3. **Niente debito silenzioso**: ogni scorciatoia va in `TECH_DEBT.md` con un *trigger* di rientro.
4. **A fine task aggiorna i doc/ADR rilevanti** (ri-esternalizza il contesto → il task dopo eredita).
5. Le **decisioni** vanno negli ADR; lo **stato corrente** in PRODUCT/DEVELOPMENT (separa storia da verità attuale).
