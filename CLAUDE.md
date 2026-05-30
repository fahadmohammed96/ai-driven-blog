# Blogs Manager — entry point (per agenti AI e umani)

> Hub SaaS **multi-tenant, AI-first** per gestire blog end-to-end (contenuti, social, email, CRM, monetizzazione).
> Primo verticale: **travel**. Primo utente: il fondatore stesso (**dogfooding**).
> Principio guida: **l'AI propone, l'umano conferma**.

## Stato attuale
- **Fase 0 — Fondamenta: COMPLETA.** Monorepo pnpm+Turborepo: `apps/api` (NestJS, `platform/modules/verticals` con confini da arch-test), `apps/web` (Next.js), `packages/{contracts,config}`. Inclusi: Postgres+Drizzle con **RLS** su `tenant_id`; pipeline **AI** (brand voice + RAG su pgvector); **auth** minimale (login fondatore, [ADR-0010](docs/adr/0010-auth.md)). Lint/typecheck/unit/integration(Docker)/E2E(Playwright) verdi; **CI** GitHub Actions su ogni PR.
- **Fase 1 — Il cuneo (dall'itinerario all'articolo): COMPLETA.** Vertical **travel**: tipo `Itinerary` → blocchi canonici; **Media-DAM** (upload S3/MinIO, varianti sharp, EXIF/geo via exifr, auto-organizzazione foto→tappa per data/luogo); **generazione articolo** nella brand voice con foto incastrate + **misuratore di autenticità**; **macchina a stati** di pubblicazione (bozza→…→pubblicato, publish idempotente); endpoint Nest + UI `/studio`; **E2E** *itinerario+foto→articolo pubblicato* verde in CI.
- **Prossimo**: **Fase 2 — Distribuzione** (repurposing → social/Pinterest, newsletter, connettori) (vedi ROADMAP).
- **Ambiente dev**: target **WSL2/Linux** ([ADR-0012](docs/adr/0012-dev-env-wsl2.md)) — esegui `scripts/setup-wsl.sh` dentro Ubuntu (clone nel FS WSL). Il checkout Windows `C:\` è legacy finché non migrato.
- **Dev stack**: `docker/compose.yaml` (Postgres + MinIO + Mailhog) → `pnpm stack:up` · `stack:check` · `stack:down`.
- **Stack deciso**: TypeScript full-stack — NestJS · Next.js · Postgres + Drizzle · pg-boss.
- **Aperti**: hosting (al deploy).
- **Debito noto**: **DEBT-005 `OPEN`** — a runtime l'app si connette come superuser → **RLS bypassata a runtime** (enforce nei test); trigger di rientro: **tenant #2**. DEBT-001/002/003/004 **PAID** (vedi [TECH_DEBT](docs/TECH_DEBT.md)).

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
