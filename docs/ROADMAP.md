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
- [ ] **CI** (lint + typecheck + unit + integration + E2E smoke; merge bloccato se rosso). **Accettazione:** una PR con un test rosso non è mergeabile.
- [ ] **Pipeline AI minima** (Anthropic SDK + brand voice + RAG su pgvector). **Accettazione:** dato un brief, genera una bozza nello stile configurato (test su esito osservabile).
- [ ] **ADR auth** + scelta. **Accettazione:** ADR scritto; auth minimale funzionante (login del fondatore).

## Fase 1 — Il cuneo: dall'itinerario all'articolo
*Obiettivo: il valore #1 per il fondatore.*

- [ ] **Vertical travel: tipo `Itinerary`** (tappe, luoghi, date, geo) sul modello canonico. **Accettazione:** si crea/edita un itinerario e si serializza in blocchi.
- [ ] **Media/DAM**: upload diretto a storage, varianti (sharp), EXIF/geo (exifr), aggancio foto→tappe. **Accettazione:** una foto caricata si auto-organizza per luogo/data.
- [ ] **Generazione articolo** da itinerario + note + foto, nella voce dell'utente. **Accettazione:** dato un itinerario reale, produce una bozza con le foto incastrate; **misuratore di autenticità** segnala dove aggiungere esperienza.
- [ ] **Macchina a stati di pubblicazione** (bozza→proposta→revisione→approvato→pubblicato). **Accettazione:** un articolo percorre gli stati; la pubblicazione è idempotente.
- [ ] **E2E**: *itinerario + foto → articolo pubblicato*. **Accettazione:** journey verde in CI.

## Fase 2 — Distribuzione
- [ ] **Repurposing** articolo → post social / **pin Pinterest**. **Accettazione:** da un articolo genera N output adattati per canale.
- [ ] **Newsletter** + liste/segmenti per **tema** + double opt-in (GDPR). **Accettazione:** invio segmentato verso Mailhog in test; double opt-in tracciato.
- [ ] **Connettori canali** (Integration Gateway) con OAuth/refresh + rate-limit. **Accettazione:** contract test verde verso il/i canale/i.

## Fase 3 — Monetizzazione & servizi
- [ ] **Hub affiliazioni** + **redirector `/go/`** + tracking click. **Accettazione:** un click passa dal redirector e viene contato per link/articolo/canale.
- [ ] **Commerce: `Trip` + `Departure` + booking a posti** (waitlist) + Stripe (test mode). **Accettazione:** journey *lancio partenza → prenoto posto → acconto → conferma* verde.
- [ ] **Pipeline su misura** (CRM: richiesta → proposta AI → acconto → conferma) + **instradamento WhatsApp/mail**. **Accettazione:** un lead percorre la pipeline; itinerario consegnato nel portale cliente.

## Fase 4 — Intelligenza
- [ ] **Analytics unificata** (ingest GA4 + Search Console + social + email + affiliate). **Accettazione:** un'unica dashboard mostra le metriche cross-canale.
- [ ] **Loop di feedback**: le metriche adattano le proposte AI del ciclo dopo. **Accettazione:** test che, dati certi risultati, le proposte cambiano di conseguenza.
- [ ] **Hardening multi-tenant** (verso tenant #2) + valutazione **Graphify**. **Accettazione:** onboarding di un secondo tenant isolato; debito multi-tenant pagato.
