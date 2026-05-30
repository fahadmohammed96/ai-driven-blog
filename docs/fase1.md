# Fase 1 — Il cuneo: dall'itinerario all'articolo · handoff

> **Record point-in-time (2026-05-30).** Cosa è stato costruito nella Fase 1 e come è stato verificato.
> Questo file è **storia, non si tiene in sync**: per lo stato corrente vedi [ROADMAP](ROADMAP.md) ·
> [PRODUCT](PRODUCT.md) · [CLAUDE.md](../CLAUDE.md); per il *perché* delle scelte gli [ADR](adr/README.md).

## Obiettivo
Il **valore #1 per il fondatore**: partire da un itinerario di viaggio + foto e arrivare a un articolo
pubblicato, nella sua voce, con l'AI che propone e l'umano che conferma.

## Architettura introdotta
- **`packages/contracts`** (condiviso FE↔BE): modello a **blocchi** canonico + `Itinerary` + `PublicationStatus`.
- **`apps/api/src/modules/media`** (foundation generica): Media-DAM (storage, varianti, EXIF, matching).
- **`apps/api/src/modules/content`**: repo `content_items` + macchina a stati di pubblicazione.
- **`apps/api/src/verticals/travel`** (vertical pack): itinerario → blocchi, foto→tappa, articolo.
- **`apps/api/src/platform/ai`**: misuratore di autenticità (euristico).
- **DI/HTTP**: `InfraModule` (DB/Storage/LLM) + controller Nest + pagina `apps/web/app/studio`.
- **Migrazioni**: `0001` (content blocks + `itinerary_stops`), `0002` (Media-DAM), `0003` (`published_at`).
  RLS + policy aggiunte a mano per ogni nuova tabella tenant-scoped (vedi `drizzle/README.md`).

## I 5 task (acceptance test PRIMA del codice, red→green)

### 1 · Itinerary → blocchi canonici  · commit `e8cb1e0`
- **Contracts**: `blocks.ts` (discriminated union Zod: `heading`/`paragraph`/`image`), `itinerary.ts`
  (`Itinerary`/`ItineraryStop`: place, geo, date, notes).
- **Travel**: `itinerary.ts` → `itineraryToBlocks()` (puro); `itinerary.repo.ts` → `save/load/updateItinerary`
  tenant-scoped via `withTenant` (transazione che setta `app.current_tenant`).
- **Content**: `content.repo.ts` → `insertContentItem/getContentItem/updateContentItem` (type/status/blocks jsonb).
- **Test**: unit serializzazione [`itinerary.test.ts`] + integration persistenza/RLS/round-trip/edit
  [`itinerary.integration.test.ts`].

### 2 · Media/DAM: upload, varianti, EXIF/geo, foto→tappa  · commit `8626d2d`
- **modules/media**: `storage.ts` (port + adapter **S3/MinIO**, presign), `variants.ts` (**sharp** thumb/web),
  `exif.ts` (**exifr**: data+GPS), `matching.ts` (matcher generico **data/luogo**, haversine), `media.service.ts`
  (`ingestPhoto`: EXIF+varianti+upload+persist), `media.repo.ts`.
- **Travel**: `attachPhotoToItinerary` (ingest generico → match → link in `itinerary_stop_photos`).
- **Layering**: il DAM resta **generico** (nessun FK foundation→vertical); il link tappa↔foto è del vertical.
- **Test**: unit matcher [`matching.test.ts`]; unit EXIF/varianti con sharp+exifr reali in-memory
  [`exif.test.ts`, `variants.test.ts`]; integration end-to-end **MinIO+Postgres** [`itinerary-photos.integration.test.ts`]
  (foto datata 06-apr → tappa Kyoto, varianti su storage, isolamento RLS).

### 3 · Generazione articolo + misuratore di autenticità  · commit `4fd57d7`
- **platform/ai**: `authenticity.ts` → `measureAuthenticity(blocks)` — euristica in prima persona
  (**non** un AI-detector), segnala le sezioni generiche da arricchire (score + flag con suggerimento).
- **Travel**: `article.ts` → `assembleArticleFromItinerary` (titolo + sezione per tappa con prosa LLM in
  brand voice + RAG opzionale, **foto incastrate** nella tappa giusta); `loadItineraryPhotos`.
- **Test**: unit meter [`authenticity.test.ts`]; unit assemblaggio con LLM fittizio [`article.test.ts`];
  integration itinerario+foto reali [`article.integration.test.ts`].

### 4 · Macchina a stati di pubblicazione (idempotente)  · commit `6d046c1`
- **Contracts**: `publication.ts` → `PublicationStatus` (`draft→proposed→review→approved→published`).
- **Content**: `state-machine.ts` → `nextStatus` (transizioni pure, `InvalidTransitionError`, `requestChanges`→draft,
  **publish idempotente**); `content.repo.ts` → `transitionContentItem`/`applyTransition`/`publishContentItem`
  (`published_at` impostato **una sola volta**).
- **Test**: unit state machine [`state-machine.test.ts`]; integration lifecycle persistito + idempotenza +
  transizioni illegali + RLS [`publication.integration.test.ts`].

### 5 · E2E: itinerario + foto → articolo pubblicato  · commit `d9d01c1`
- **API (Nest)**: `ItinerariesController` (`POST /itineraries`, `/:id/photos` upload, `/:id/article`),
  `ArticlesController` (`/:id/publish`, `GET /:id`); `content.repo.publishThroughReview` (cammino atomico→published).
- **DI**: `InfraModule` (@Global) fornisce `DB`/`STORAGE`/`LLM` da env; `StubLlmClient` offline (niente chiamate
  reali/pagate in CI); `main.ts` auto-migrate+seed+ensure-bucket al boot (`DB_AUTO_MIGRATE=1`).
- **Web**: `app/studio/page.tsx` guida il flusso chiamando l'API.
- **E2E**: `apps/web/e2e/studio.spec.ts` (journey reale web→API→Postgres+MinIO); CI porta su lo stack.
- **Test**: HTTP journey con Testcontainers [`app.http.test.ts`] (paga anche il trigger DEBT-004 sui nuovi endpoint).

## DEBT-005 — RLS enforced a runtime  · commit `f2256d5`
Pagato **in anticipo** (per ripartire puliti). `ensureAppRole` (in `platform/db/bootstrap.ts`) provisiona un
ruolo **`app_rw` `NOSUPERUSER`** con `GRANT` mirati; il bootstrap gira su connessione **admin**
(`DATABASE_ADMIN_URL`), l'app gira come `app_rw` (`DATABASE_URL`) → **RLS attiva a runtime**, non solo nei test.
Provato da `runtime-rls.integration.test.ts` (no-bypass + isolamento cross-tenant + grant sull'intera catena) e
dal boot reale dell'app (journey verde, 0 warning "bypass"). Realizza l'hardening previsto da **ADR-0002**.

## Decisioni prese (ADR 0013–0016)
- **0013** modello a blocchi canonico concreto (Zod, in `contracts`).
- **0014** Media-DAM: storage S3-compatibile + sharp + exifr + matcher generico; DAM generico, link nel vertical.
- **0015** macchina a stati di pubblicazione con publish idempotente.
- **0016** misuratore di autenticità euristico (non AI-detector).

## Debito tecnico
DEBT-005 (RLS a runtime) → **PAID**. Registro **azzerato** (nessun debito aperto).

## Verifica a fine fase
**Tutto verde**: lint · typecheck · build · unit · HTTP (swc+Testcontainers) · integration (7 file) ·
**E2E full-stack** (journey *itinerario+foto→articolo pubblicato*). Debt-gate superato. Caselle ROADMAP
Fase 1 spuntate a test verde (red→green mostrato task per task).

## Commit della fase
`e8cb1e0` Itinerary+blocchi · `8626d2d` Media-DAM · `4fd57d7` articolo+autenticità ·
`6d046c1` state machine · `d9d01c1` E2E · `66146d8` chiusura doc/ADR · `f2256d5` DEBT-005 (RLS runtime).
