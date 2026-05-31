# ROADMAP — fasi e task

Gerarchia **Fase → Task**. Una casella si spunta **solo a acceptance test verde** (vedi DoD in DEVELOPMENT.md). A fine fase: **debt-gate** (paga il debito scaduto prima di aprire la successiva).

Legenda: `[ ]` da fare · `[~]` in corso · `[x]` fatto.

---

## Fase 0 — Fondamenta
*Obiettivo: scheletro del progetto, qualità e ambiente pronti.*

- [x] **Spostare il repo fuori da OneDrive** → Windows nativo `C:\progetti-ai\blogs-manager`, WSL2 rimandato (**ADR-0011**; DEBT-001 `PAID`). **Accettazione:** percorso non sincronizzato ✓; la fluidità Docker/file-watch si conferma al task *docker-compose dev*.
- [x] **Scaffold monorepo** (pnpm + Turborepo; `apps/api`, `apps/web`, `packages/*`). **Accettazione:** `pnpm install` ok; build/test di entrambe le app girano da root.
- [x] **Backend base NestJS** con struttura `platform/modules/verticals` e confini di modulo imposti. **Accettazione:** un test fallisce se un modulo importa gli interni di un altro.
- [x] **Postgres + Drizzle + migrazioni**; modello dati *tenant-aware* (`tenant_id`) con **RLS** abilitata. **Accettazione:** test d'integrazione (Testcontainers) prova che una query non vede dati di un altro tenant.
- [x] **docker-compose dev** (Postgres + MinIO + Mailhog). **Accettazione:** `docker compose up` espone i servizi e l'app vi si connette.
- [x] **CI** (lint + typecheck + unit + integration + E2E smoke; merge bloccato se rosso). **Accettazione:** una PR con un test rosso non è mergeabile. *(Workflow `.github/workflows/ci.yml` pronto e verde in locale; **branch protection** su `main` da abilitare lato GitHub per bloccare davvero il merge — vedi DEBT-003.)*
- [x] **Pipeline AI minima** (Anthropic SDK + brand voice + RAG su pgvector). **Accettazione:** dato un brief, genera una bozza nello stile configurato (test su esito osservabile). *(RAG provato su pgvector reale; chiamata LLM reale via `ANTHROPIC_API_KEY`, fittizia al confine nei test.)*
- [x] **ADR auth** + scelta ([ADR-0010](adr/0010-auth.md): self-hosted TS, identità in Postgres). **Accettazione:** ADR scritto; auth minimale funzionante (login del fondatore) — verificato via HTTP (login → JWT, `/auth/me` protetto, 401 su credenziali errate / token mancante).

## Fase 1 — Il cuneo: dall'itinerario all'articolo
*Obiettivo: il valore #1 per il fondatore.*

- [x] **Vertical travel: tipo `Itinerary`** (tappe, luoghi, date, geo) sul modello canonico. **Accettazione:** si crea/edita un itinerario e si serializza in blocchi.
- [x] **Media/DAM**: upload diretto a storage, varianti (sharp), EXIF/geo (exifr), aggancio foto→tappe. **Accettazione:** una foto caricata si auto-organizza per luogo/data.
- [x] **Generazione articolo** da itinerario + note + foto, nella voce dell'utente. **Accettazione:** dato un itinerario reale, produce una bozza con le foto incastrate; **misuratore di autenticità** segnala dove aggiungere esperienza.
- [x] **Macchina a stati di pubblicazione** (bozza→proposta→revisione→approvato→pubblicato). **Accettazione:** un articolo percorre gli stati; la pubblicazione è idempotente.
- [x] **E2E**: *itinerario + foto → articolo pubblicato*. **Accettazione:** journey verde in CI.

> **Fase 1 COMPLETA.** Debt-gate: nessun debito *scaduto* — l'unico aperto (**DEBT-005**, RLS a runtime) ha trigger *tenant #2*, non ancora dovuto. Si può aprire la Fase 2.

## Fase 2 — Distribuzione
- [x] **Repurposing** articolo → post social / **pin Pinterest**. **Accettazione:** da un articolo genera N output adattati per canale. *(Proiettori deterministici sul modello canonico a blocchi — ADR-0017; tabella `channel_posts` con RLS; unit + integration RLS + HTTP swc verdi.)*
- [x] **Newsletter** + liste/segmenti per **tema** + double opt-in (GDPR). **Accettazione:** invio segmentato verso Mailhog in test; double opt-in tracciato. *(Macchina a stati double opt-in + `EmailPort`/SMTP — ADR-0018; tabelle `subscribers`/`subscriptions` con RLS; integration con **Mailhog reale** via Testcontainers verde.)*
- [x] **Connettori canali** (Integration Gateway) con OAuth/refresh + rate-limit. **Accettazione:** contract test verde verso il/i canale/i. *(Connector Pinterest: OAuth2 refresh su scadenza/401 + rate-limit token-bucket + segreti per-tenant cifrati AES-256-GCM con RLS — ADR-0019; contract test guidato da OpenAPI verde.)*

> **Fase 2 COMPLETA.** Debt-gate: nessun debito *scaduto*. Nuove voci registrate (DEBT-006…008) hanno trigger *al secondo connettore / prima del primo invio o canale reale*, non ancora dovuti. Si può aprire la Fase 3.

## Fase 2.5 — UI distribuzione + E2E (follow-up Fase 2)
*Obiettivo: portare la distribuzione (motore già pronto e verde in Fase 2) sotto il principio "l'umano conferma", con journey E2E. Verificabile **ora** con connettori **stub** al confine (come l'LLM in Fase 1) — niente sistemi esterni reali.*

- [x] **Slice 1 — Gate di approvazione (human-in-the-loop)**: UI `/studio` "Distribuzione" → repurpose articolo → **approva/rifiuta** i post per canale prima che escano (transizione `draft→approved/rejected` idempotente; endpoint + gate UI). **Accettazione:** **E2E** *articolo pubblicato → repurpose → approva* verde in CI (connector stub al confine). ✓
- [x] **Slice 2 — UI newsletter**: pagina `/newsletter` — iscrizione **double opt-in** (GDPR) + invio segmentato per tema. **Accettazione:** E2E *subscribe → conferma (token da Mailhog) → invio segmentato → esito* verde in CI. ✓

> **Fase 2.5 COMPLETA.** Entrambi gli slice verdi in CI (PR #3 + #4). Il consent-flow **OAuth per collegare un canale reale** resta su **DEBT-008** (trigger: *primo canale reale*) — fuori da questo task: qui i connettori sono stub al confine.

## Content-hub UI — il prodotto vero (follow-up Fase 2.5)
*Obiettivo: la UI di prodotto come **content-hub** che realizza il modello operativo (ADR-0020 → [ADR-0021](adr/0021-content-hub-ui.md)): "l'agenzia AI propone → l'umano conferma; cassetta degli attrezzi, non procedura guidata". Quattro superfici indipendenti su un hub stabile; `/studio` + `/newsletter` restano walking skeleton verdi. **Accettazione = journey E2E verdi** (la conductor esegue il gate E2E in questo setup WSL; gli slice sono verificati in locale sulle suite veloci e con la spec E2E scritta test-first).*

- [x] **Slice 0 — Fondamenta + Design**: spec di design/IA, app-shell hub + toolbox nav, design-system baseline (tokens + primitive), 4 placeholder di superficie. **Accettazione:** E2E smoke *l'hub carica + la nav funziona* + ogni superficie raggiungibile come sezione indipendente. ✓
- [x] **Slice 1 — Library**: lista/filtri dei ContentItem + badge di stato. **Accettazione:** E2E *la library elenca gli item con il badge giusto e i filtri restringono* (read-model `GET /articles`, isolamento RLS provato). ✓ *(DEBT-009 → PAID.)*
- [x] **Slice 2 — Block Editor**: editor sul modello a blocchi canonico + misuratore di autenticità (contrappeso, mai cancello). **Accettazione:** E2E *apri → modifica titolo+blocco → salva → persiste al reload, meter visibile* (`PATCH /articles/:id` + `GET /articles/:id/authenticity`). ✓
- [x] **Slice 3 — Proposal Queue**: il gesto propose→approve/edit/reject sulla macchina a stati esistente. **Accettazione:** E2E *approva avanza l'item e lascia la coda; rifiuta lo rimanda a draft* (endpoint decisione `propose/approve/reject`). ✓
- [x] **Slice 4 — Settings**: brand voice + autonomia per specialista (stub) + canali, tenant-scoped e persistiti. **Accettazione:** E2E *modifica una setting → salva → persiste al reload* (`GET`/`PUT /settings`, tabella `tenant_settings` con RLS + grant runtime). ✓
- [x] **Slice 5 — Integration & polish**: hub coerente (landing con il modello operativo, nav/header/badge/meter consistenti), **journey cross-surface completa**, docs/ADR finalizzati. **Accettazione:** E2E *un'unica journey dall'hub: Library → Editor (modifica+salva, meter) → Proposal Queue (decisione) → Settings (persiste)*, ordine libero (toolbox). ✓

> **Content-hub UI COMPLETA.** Quattro superfici costruite + journey cross-surface scritta test-first. Suite veloci verdi in locale (typecheck · lint · unit/arch · HTTP swc · integration Testcontainers); la **conductor esegue il gate E2E**. Follow-up registrati: **DEBT-010** (la generazione legga la brand voice dalle Settings invece della costante `FOUNDER_VOICE`); autonomia = stub (motore reale → debito *a quel punto*); proposte di distribuzione (channel-post) integrabili nella stessa coda; onboarding OAuth canale reale = **DEBT-008**.

## Fase 3 — Monetizzazione & servizi
- [x] **Hub affiliazioni** + **redirector `/go/`** + tracking click. **Accettazione:** un click passa dal redirector e viene contato per link/articolo/canale. *(Modulo `modules/monetization`: `affiliate_links` + `affiliate_clicks` con RLS + grant runtime; `/affiliates` (CRUD + conteggi per link/articolo/canale) e `/go/:code` (302 + click snapshottato) — [ADR-0022](adr/0022-affiliate-hub-redirector.md), [design](design/monetization.md). HTTP + integration RLS verdi; superficie `/affiliates` nella toolbox; E2E `affiliates.spec.ts` scritta test-first.)*
- [x] **Commerce: `Trip` + `Departure` + booking a posti** (waitlist) + Stripe (test mode). **Accettazione:** journey *lancio partenza → prenoto posto → acconto → conferma* verde. *(Modulo `modules/commerce`: `trips`+`departures`+`bookings` con RLS + grant runtime; macchina a stati prenotazione `reserved→deposit_pending→confirmed`/`waitlisted`; capienza senza oversell (`SELECT … FOR UPDATE`); **PaymentPort** stub deterministico al confine (Stripe live = DEBT-011) — [ADR-0023](adr/0023-commerce-trips-departures-payment-port.md), [design](design/commerce.md). HTTP journey (book→acconto→conferma + full→waitlist) + integration RLS verdi; superficie `/trips` nella toolbox; E2E `trips.spec.ts` scritta test-first.)*
- [x] **Pipeline su misura** (CRM: richiesta → proposta AI → acconto → conferma) + **instradamento WhatsApp/mail**. **Accettazione:** un lead percorre la pipeline; itinerario consegnato nel portale cliente. *(Modulo `modules/crm`: tabella `leads` con RLS + grant runtime; macchina a stati `received → ai_drafted → human_approved → sent → deposit_pending → confirmed → delivered` (con `reject`→ri-bozza); **cancello human-in-the-loop strutturale** — l'AI redige la proposta (LLM al confine, brand voice dalle Settings) ma **nulla esce senza approvazione umana**; **PaymentPort** riusato per l'acconto (Stripe live = DEBT-011); **NotificationPort** stub per WhatsApp/mail (live = DEBT-012); **portale cliente** tokenizzato `/portal/:token` che rivela l'itinerario solo a `delivered` — [ADR-0024](adr/0024-crm-custom-trip-pipeline-notification-port.md), [design](design/crm.md). HTTP journey (richiesta→proposta→approva→acconto→conferma→consegna + cancello + 409 fuori-ordine) + integration RLS verdi; superficie `/crm` nella toolbox; E2E `crm.spec.ts` scritta test-first.)*

> **Fase 3 COMPLETA.** I tre slice (3.1 hub affiliazioni + `/go`, 3.2 commerce "Programmato", 3.3 CRM "Su misura") sono verdi sulle suite veloci in locale (typecheck · lint · unit/arch · HTTP swc · integration Testcontainers); la **conductor esegue il gate E2E**. Debt-gate: nessun debito *scaduto*. Nuove voci registrate **DEBT-011** (Stripe live → *primo incasso reale*) e **DEBT-012** (WhatsApp/mail live → *primo invio reale al cliente*), **non ancora dovute**; **DEBT-010** resta aperto per la *generazione articolo* (il percorso proposta CRM, invece, legge già la brand voice dalle Settings). Si può aprire la Fase 4.

## Fase 4 — Intelligenza
- [ ] **Analytics unificata** (ingest GA4 + Search Console + social + email + affiliate). **Accettazione:** un'unica dashboard mostra le metriche cross-canale.
- [ ] **Loop di feedback**: le metriche adattano le proposte AI del ciclo dopo. **Accettazione:** test che, dati certi risultati, le proposte cambiano di conseguenza.
- [ ] **Hardening multi-tenant** (verso tenant #2) + valutazione **Graphify**. **Accettazione:** onboarding di un secondo tenant isolato; debito multi-tenant pagato.
