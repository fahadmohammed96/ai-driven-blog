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
- [ ] **Slice 2 — UI newsletter**: gestione iscritti/segmenti + trigger dell'invio segmentato. **Accettazione:** E2E che invia a un segmento (Mailhog) e ne mostra l'esito.

> **Fuori da questo task** (resta su **DEBT-008**, trigger *primo canale reale*): il consent-flow **OAuth per collegare un canale reale**. Qui i connettori sono stub al confine.

## Fase 3 — Monetizzazione & servizi
- [ ] **Hub affiliazioni** + **redirector `/go/`** + tracking click. **Accettazione:** un click passa dal redirector e viene contato per link/articolo/canale.
- [ ] **Commerce: `Trip` + `Departure` + booking a posti** (waitlist) + Stripe (test mode). **Accettazione:** journey *lancio partenza → prenoto posto → acconto → conferma* verde.
- [ ] **Pipeline su misura** (CRM: richiesta → proposta AI → acconto → conferma) + **instradamento WhatsApp/mail**. **Accettazione:** un lead percorre la pipeline; itinerario consegnato nel portale cliente.

## Fase 4 — Intelligenza
- [ ] **Analytics unificata** (ingest GA4 + Search Console + social + email + affiliate). **Accettazione:** un'unica dashboard mostra le metriche cross-canale.
- [ ] **Loop di feedback**: le metriche adattano le proposte AI del ciclo dopo. **Accettazione:** test che, dati certi risultati, le proposte cambiano di conseguenza.
- [ ] **Hardening multi-tenant** (verso tenant #2) + valutazione **Graphify**. **Accettazione:** onboarding di un secondo tenant isolato; debito multi-tenant pagato.
