# ADR-0022 — Affiliate hub + redirector `/go/` + tracking click

Stato: **Accepted** (2026-05-31). Fase 3 — Monetizzazione, Slice 1.

## Contesto
La Fase 3 apre la **monetizzazione**. Il primo cuneo è l'**hub affiliazioni**: il
fondatore crea link tracciati da inserire in articoli/post; un **redirector**
pubblico `GET /go/:code` conta il click e reindirizza al partner. ROADMAP,
accettazione: *"un click passa dal redirector e viene contato per
link/articolo/canale"*.

DEVELOPMENT.md già prevede il redirector come possibile **servizio satellite**
("solo sotto pressione"). A n=1, in dogfooding, non c'è ancora quella pressione.

## Decisione
1. **Modulo `modules/monetization`** (bounded context), tenant-scoped + RLS come
   ogni altro modulo. Due controller: `AffiliateController` (`/affiliates`: CRUD
   minimale + letture conteggi) e `RedirectorController` (`/go/:code`).
2. **Redirector co-locato nel monolite**, non un servizio separato: niente
   pressione che giustifichi un satellite ora (DEVELOPMENT.md §1). Resta
   **reversibile** — è un controller isolato dietro il proprio modulo, estraibile
   quando il volume lo richiederà.
3. **Due tabelle** tenant-scoped (RLS `FORCE` + policy `tenant_isolation`, come le
   altre): `affiliate_links` (target, `code` **unico per tenant**, associazione
   facoltativa ad articolo + canale) e `affiliate_clicks` (un record per click).
   Entrambe nel grant del ruolo runtime `app_rw` (`APP_RW_TABLES`, DEBT-005).
4. **Snapshot sul click**: `affiliate_clicks` denormalizza `content_item_id` e
   `channel` dal link **al momento del click**. Così i conteggi per articolo/canale
   restano corretti anche se in seguito il link viene ri-puntato; e l'aggregazione
   è una semplice `GROUP BY` senza join storici.
5. **Redirect veloce**: il path del click è **due statement leggeri** (risolvi per
   `code` → `INSERT` del click) nella stessa transazione tenant, poi `302` verso il
   target. Nessun lavoro pesante in linea; se servirà analytics ricca, andrà su
   coda (pg-boss) — non ora.
6. **Risoluzione tenant del click pubblico = lo stub di tenancy n=1** (come il
   link pubblico di *conferma newsletter*, che già risolve il token nel contesto
   del tenant fondatore). Il redirector gira nel contesto del tenant corrente, e
   la RLS garantisce che un tenant possa risolvere/contare **solo i propri** link.
   La risoluzione cross-tenant di un click realmente anonimo (dominio→tenant) è
   lavoro del **tenant #2**, non di questo slice — stessa frontiera dello stub di
   `TenancyService`.

## Conseguenze
- ✅ Acceptance verde: un click attraversa `/go/:code`, viene registrato e contato
  **per link / articolo / canale** (HTTP + integration RLS verdi; E2E scritta
  test-first).
- ✅ Isolamento provato a runtime come ruolo `app_rw` `NOSUPERUSER`
  (`affiliate.integration.test.ts` + guardia di grant in
  `runtime-rls.integration.test.ts`).
- ✅ `code` unico **per tenant** → due tenant possono riusare lo stesso slug in
  modo indipendente.
- ⏳ **Redirector satellite** e **risoluzione tenant del click anonimo**: rinviati
  finché non c'è pressione di volume / tenant #2 (coerente con DEVELOPMENT.md e lo
  stub di tenancy). Nessun debito *scaduto* introdotto.

## Alternative scartate
- **Servizio redirector separato subito**: over-engineering a n=1; il monolite
  modulare lo ospita e resta reversibile.
- **Conteggio derivato solo dal link (niente snapshot)**: un link ri-puntato
  falserebbe i conteggi storici per articolo/canale.
- **Fire-and-forget del click prima del 302**: a n=1 l'`INSERT` sincrono è
  trascurabile e rende il conteggio deterministico (necessario per l'acceptance);
  l'asincronia su coda è un'ottimizzazione futura sotto carico.

Collegati: [[0020]] (modello operativo), [[0002]] (tenancy/RLS), DEBT-005 (ruolo
runtime least-privilege).
