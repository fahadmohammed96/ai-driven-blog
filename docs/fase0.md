# Fase 0 — Fondamenta · handoff

> **Record point-in-time (2026-05-29).** Cosa è stato costruito nella Fase 0 e come è stato verificato.
> Questo file è **storia, non si tiene in sync**: per lo stato corrente vedi [ROADMAP](ROADMAP.md) ·
> [PRODUCT](PRODUCT.md) · [CLAUDE.md](../CLAUDE.md); per il *perché* delle scelte gli [ADR](adr/README.md).

## Obiettivo
Scheletro del progetto: qualità, ambiente e fondamenta pronte per costruire il dominio. Nessun valore
utente ancora — solo le "rotaie" (monorepo, confini, dati, CI, AI minima, auth minima).

## Cosa è stato costruito

### Monorepo & tooling
- **pnpm + Turborepo** (ADR-0003). Workspace: `apps/api` (NestJS), `apps/web` (Next.js),
  `packages/contracts` (Zod, type-safety FE↔BE), `packages/config` (tsconfig base).
- TypeScript **strict** (incl. `noUncheckedIndexedAccess`), ESLint flat config, **Vitest**.

### Backend NestJS — confini di modulo *imposti*
- Struttura `src/{platform, modules, verticals}`: `platform` = shared kernel (clock, db, ai);
  `modules` = bounded context (tenancy, content, auth); `verticals` = vertical pack (vuoto in Fase 0).
- **arch-test** [`src/arch/boundaries.test.ts`]: un modulo importa un altro **solo via barrel pubblico**
  (`index.ts`), mai gli interni → il test fallisce sulle violazioni (ADR-0001).

### Dati: Postgres + Drizzle + RLS (ADR-0002)
- `platform/db/schema.ts` = **fonte tipata unica** (`tenants`, `content_items`, `content_embeddings`
  con colonna `vector(256)`).
- Migrazioni **drizzle-kit** in `apps/api/drizzle` (baseline `0000_init.sql`, rifinito a mano per
  `CREATE EXTENSION vector` + RLS).
- **Multi-tenancy = Row-Level Security** su `tenant_id` via `current_setting('app.current_tenant')`,
  con `FORCE ROW LEVEL SECURITY`.
- Integration test (Testcontainers) [`platform/db/tenant-rls.integration.test.ts`]: un ruolo
  `NOSUPERUSER` non vede i dati di un altro tenant; **deny-by-default** senza contesto.

### Dev stack (Docker)
- `docker/compose.yaml`: **Postgres (pgvector) + MinIO (S3) + Mailhog**. Script `stack:up/check/down`.

### Pipeline AI minima
- **Anthropic TS SDK** [`platform/ai/llm.ts`] con prompt caching della brand voice.
- Brand voice + `buildPrompt` [`platform/ai/pipeline.ts`].
- **RAG su pgvector**: `embedder.ts` (hashing deterministico L2-normalizzato), `rag.ts`
  (`storeChunk`/`retrieveSimilar` con distanza coseno `<=>`).
- Test: unit [`pipeline.test.ts`] + integration [`ai-pipeline.integration.test.ts`] (pgvector reale,
  LLM **fittizio al confine**).

### Auth minimale (n=1, ADR-0010)
- Login del fondatore: **scrypt** [`modules/auth/password.ts`] + **JWT** [`auth.service.ts`].
- Test: unit [`auth.service.test.ts`] + HTTP [`auth.http.test.ts`] (swc + supertest, boota l'app Nest).

### CI (punto di imposizione)
- `.github/workflows/ci.yml`: **lint + typecheck + build + unit + HTTP (swc) + integration
  (Testcontainers) + E2E smoke (Playwright)**. Merge bloccato se rosso.

## Decisioni prese (ADR 0001–0012)
0001 monolite modulare · 0002 RLS multi-tenant · 0003 stack TS full-stack · 0004 CMS ibrido + modello
a blocchi · 0005 core orizzontale + vertical pack · 0006 integrazioni native sequenziate · 0007 workflow
dev (TDD doppio-loop, test reali) · 0008 servizi viaggio via partner operator · 0009 coda pg-boss ·
0010 auth self-hosted · 0011 dev Windows nativo *(superseded)* · 0012 dev = WSL2.

## Debito tecnico (tutto rientrato)
- **DEBT-001** repo in OneDrive → spostato su path non sincronizzato · **PAID**
- **DEBT-002** migrazioni a mano → drizzle-kit cablato, `schema.ts` fonte unica · **PAID**
- **DEBT-003** branch protection su `main` → ruleset attivo (check CI richiesto) · **PAID**
- **DEBT-004** layer HTTP Nest non testato in CI → swc + `auth.http.test.ts` · **PAID**

## Verifica a fine fase
Lint · typecheck · build · unit · integration (Docker/Testcontainers) · E2E (Playwright) **verdi**;
CI verde su ogni PR. Tutte le caselle Fase 0 della ROADMAP spuntate a test verde (red→green).
