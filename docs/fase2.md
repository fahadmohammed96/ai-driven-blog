# Fase 2 — Distribuzione · handoff

> **Record point-in-time (2026-05-30).** Cosa è stato costruito nella Fase 2 e come è stato verificato.
> Questo file è **storia, non si tiene in sync**: per lo stato corrente vedi [ROADMAP](ROADMAP.md) ·
> [PRODUCT](PRODUCT.md) · [CLAUDE.md](../CLAUDE.md); per il *perché* delle scelte gli [ADR](adr/README.md).
> *Nota di stato:* verifica locale **verde** (sotto); il **commit + PR Fase 2 → CI** è il passo di chiusura da finalizzare.

## Obiettivo
Portare il contenuto **fuori** dal blog: dall'articolo pubblicato ai canali — repurposing social/**Pinterest**,
**newsletter** segmentata, e una **foundation riusabile per i connettori** di canale.

## Architettura introdotta
- **`apps/api/src/modules/social`**: repurposing articolo → output per canale + persistenza `channel_posts`.
- **`apps/api/src/modules/email`**: newsletter, double opt-in (GDPR), `EmailPort` + adapter SMTP, subscribers/segmenti.
- **`apps/api/src/platform/integration`** (foundation generica): connector gateway — OAuth2, rate-limit, segreti cifrati.
- **`packages/contracts`**: `channel.ts` (output di canale) + `newsletter.ts` (subscriber/segmento/opt-in).
- **Migrazioni** `0004`–`0006`: `channel_posts`, `subscribers`/`subscriptions`, `connector_credentials` — tutte tenant-scoped con **RLS** (coerenti con DEBT-005: enforce a runtime via ruolo app).
- **Wiring**: `SocialModule` + `EmailModule` registrati in `app.module.ts`.

## I 3 task (acceptance test, red→green)

### 1 · Repurposing articolo → social / Pinterest · ADR-0017
- **social**: `repurpose.ts` = **proiettori deterministici** sul modello canonico a blocchi (caption Instagram /
  thread X numerato ≤280 / pin Pinterest), limiti per-canale imposti; `distribution.ts`, `social.controller.ts`,
  `social.repo.ts` (`channel_posts`).
- **Perché deterministici**: output testabile e falsificabile **senza dipendere dall'LLM** (l'eventuale "AI-polish"
  resta arricchimento futuro opzionale) — realizza ADR-0004 (un modello, molti renderer).
- **Test**: `repurpose.test.ts` (unit) · `repurpose.integration.test.ts` (RLS) · `social.http.test.ts`.
- **Accettazione**: da un articolo genera N output adattati per canale ✓.

### 2 · Newsletter + liste/segmenti + double opt-in (GDPR) · ADR-0018
- **email**: `newsletter.ts`, `optin-state.ts` (**macchina a stati double opt-in**: token + `requested_at`/
  `confirmed_at` come audit), `optin.ts`, `render.ts`, `subscribers.repo.ts`; **`email.port.ts`** (`EmailPort`) con
  adapter **`smtp.ts`** (Mailhog in dev/test → API provider in prod, vedi DEBT-007); `newsletter.controller.ts`.
- **Test**: `optin-state.test.ts`, `render.test.ts` (unit) · `newsletter.integration.test.ts` (**Mailhog reale via
  Testcontainers**: consegna **solo ai confermati** del tema mirato) · `newsletter.http.test.ts`.
- **Accettazione**: invio segmentato per tema verso Mailhog in test; double opt-in tracciato ✓.

### 3 · Connettori canali (Integration Gateway) · ADR-0019
- **platform/integration**: `connector.ts` (port), `oauth.ts` (**OAuth2** con refresh su scadenza/401),
  `token-bucket.ts` (**rate-limit** clock-injected), `crypto.ts` (**AES-256-GCM**), `credentials.repo.ts`
  (**segreti per-tenant cifrati**, RLS); primo connector **`pinterest.ts`** + `pinterest.openapi.json` +
  `pinterest.contract.test.ts` (**contract test guidato da OpenAPI**, niente mock a mano).
- **Test**: `crypto.test.ts`, `token-bucket.test.ts`, `pinterest.contract.test.ts` (unit) ·
  `credentials.integration.test.ts` (round-trip cifrato, update-in-place, **isolamento RLS** per tenant).
- **Accettazione**: contract test verde verso il canale ✓.

## Decisioni prese (ADR 0017–0019)
- **0017** Repurposing = proiettori deterministici sul modello a blocchi (limiti per-canale; AI-polish futuro).
- **0018** Email via provider-port (`EmailPort`): SMTP in dev/test (Mailhog) → API provider in prod; double opt-in GDPR.
- **0019** Integration Gateway: OAuth2 + rate-limit token-bucket + segreti per-tenant cifrati (AES-256-GCM) con RLS;
  primo connector Pinterest; contract test guidato da OpenAPI.

## Debito tecnico nuovo (tracciato, non scaduto)
- **DEBT-006** contract test = validazione **parziale** dall'OpenAPI (campi `required` + security), non runtime completo →
  trigger: **al secondo connettore** / prima del go-live integrazioni. `OPEN`
- **DEBT-007** email = solo adapter **SMTP** (manca l'adapter provider API SES/Postmark di ADR-0018) →
  trigger: **prima del primo invio di produzione a volumi**. `OPEN`
- **DEBT-008** nessun **flusso onboarding OAuth** del canale + gestione `CONNECTOR_SECRET_KEY` (il connector presume
  credenziali già nello store cifrato) → trigger: **prima di collegare un canale reale**. `OPEN`

## Verifica a fine fase (locale, verde)
- **typecheck** ✓ · **lint** ✓
- **unit**: api **72** · contracts **26** · web **2** (incl. `pinterest.contract.test`)
- **integration** (Testcontainers): **10 file / 32 test** ✓ — incl. `repurpose` (RLS), `credentials` (cifratura + RLS),
  `newsletter` (Mailhog reale: double opt-in + segmentazione)
- **http** (swc + supertest): **4 file / 10 test** ✓ — `social`, `newsletter`, + journey Fase 1
- **Non ancora fatto**: niente UI `apps/web` per la distribuzione e nessun **E2E** di Fase 2 (fuori dai criteri di
  accettazione *dichiarati*, che sono API/test-level); **commit + PR → CI** da finalizzare.
