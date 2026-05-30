# Blogs Manager — entry point (per agenti AI e umani)

> Hub SaaS **multi-tenant, AI-first** per gestire blog end-to-end (contenuti, social, email, CRM, monetizzazione).
> Primo verticale: **travel**. Primo utente: il fondatore stesso (**dogfooding**).
> Principio guida: **l'AI propone, l'umano conferma**.

## Stato attuale
- **Fase 0 — Fondamenta: COMPLETA.** Monorepo pnpm+Turborepo: `apps/api` (NestJS, `platform/modules/verticals` con confini da arch-test), `apps/web` (Next.js), `packages/{contracts,config}`. Inclusi: Postgres+Drizzle con **RLS** su `tenant_id`; pipeline **AI** (brand voice + RAG su pgvector); **auth** minimale (login fondatore, [ADR-0010](docs/adr/0010-auth.md)). Lint/typecheck/unit/integration(Docker)/E2E(Playwright) verdi; **CI** GitHub Actions su ogni PR.
- **Fase 1 — Il cuneo (dall'itinerario all'articolo): COMPLETA.** Vertical **travel**: tipo `Itinerary` → blocchi canonici; **Media-DAM** (upload S3/MinIO, varianti sharp, EXIF/geo via exifr, auto-organizzazione foto→tappa per data/luogo); **generazione articolo** nella brand voice con foto incastrate + **misuratore di autenticità**; **macchina a stati** di pubblicazione (bozza→…→pubblicato, publish idempotente); endpoint Nest + UI `/studio`; **E2E** *itinerario+foto→articolo pubblicato* verde in CI.
- **Fase 2 — Distribuzione: COMPLETA.** **Repurposing** (`modules/social`): articolo → post adattati per canale (Instagram/X/Pinterest) come **proiettori deterministici** sul modello a blocchi ([ADR-0017](docs/adr/README.md)), tabella `channel_posts` con RLS, endpoint `POST /articles/:id/repurpose`. **Newsletter** (`modules/email`): **double opt-in GDPR** (macchina a stati, token + audit `requested_at`/`confirmed_at`), liste/segmenti per **tema**, invio segmentato via **`EmailPort`/SMTP** ([ADR-0018](docs/adr/README.md)) provato verso **Mailhog reale** (Testcontainers). **Integration Gateway** (`platform/integration`): connector **Pinterest** con **OAuth2** (refresh su scadenza/401), **rate-limit token-bucket**, segreti per-tenant **cifrati** (AES-256-GCM) con RLS ([ADR-0019](docs/adr/README.md)); **contract test guidato da OpenAPI** verde. Tutti i livelli di test verdi (unit/arch · HTTP swc · integration Testcontainers).
- **Fase 2.5 — UI distribuzione + E2E: COMPLETA.** Distribuzione sotto *"l'umano conferma"* con journey E2E: **gate di approvazione** (UI `/studio` → repurpose → **approva/rifiuta** i post per canale prima che escano; transizione `draft→approved/rejected` idempotente + endpoint) e **UI newsletter** (`/newsletter`: iscrizione double opt-in + invio segmentato). Connettori/email **stub o Mailhog** al confine (niente sistemi reali); il consent-flow OAuth per canale reale resta su **DEBT-008**. **E2E** di entrambi gli slice verdi in CI.
- **Prossimo**: **Fase 3 — Monetizzazione & servizi** (hub affiliazioni + redirector `/go/`, commerce Trip/Departure + Stripe test, pipeline CRM su misura) (vedi ROADMAP).
- **Ambiente dev**: **WSL2/Linux** ([ADR-0012](docs/adr/0012-dev-env-wsl2.md)) — **migrazione fatta**: si lavora nel clone dentro il filesystem WSL (non in `/mnt/c`), Node via fnm + Docker Desktop (WSL integration). Il vecchio checkout Windows `C:\` resta solo come legacy.
- **Dev stack**: `docker/compose.yaml` (Postgres + MinIO + Mailhog) → `pnpm stack:up` · `stack:check` · `stack:down`.
- **Stack deciso**: TypeScript full-stack — NestJS · Next.js · Postgres + Drizzle · pg-boss.
- **Aperti**: hosting (al deploy).
- **Debito noto**: DEBT-001…005 **PAID**. Aperti dalla Fase 2, **non scaduti**: **DEBT-006** (contract test = validazione parziale da OpenAPI, no runtime Prism → al 2° connettore), **DEBT-007** (email solo SMTP, manca adapter provider API → prima del 1° invio di produzione), **DEBT-008** (manca onboarding OAuth + key management → prima di collegare un canale reale). Vedi [TECH_DEBT](docs/TECH_DEBT.md).

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
