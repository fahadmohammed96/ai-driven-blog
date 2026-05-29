# PRODUCT — cosa costruiamo e perché

*Stato corrente del prodotto (non cronologia — per il "perché/quando" vedi [adr/](adr/README.md)).*

## Obiettivo
Togliere ai blogger il lavoro manuale e noioso, automatizzando i flussi editoriali e di marketing in **un unico hub**. L'AI fa l'impalcatura (scrittura, distribuzione), l'umano mette esperienza e voce. **L'AI propone, l'umano conferma** (con gradi di autonomia configurabili: manuale / semi-auto / auto entro limiti).

## Utente e strategia
- Primo utente = **il fondatore**, travel blogger → **dogfooding** (costruiamo prima per il suo blog, poi generalizziamo a SaaS).
- Conseguenza: la **multi-tenancy è nella visione ma non si costruisce al giorno 1** (teniamo il modello dati *tenant-aware* — `tenant_id`, cucitura pronta — e induriamo l'isolamento quando arriva il tenant #2).
- Profilo dell'utente: **ama** pianificare viaggi e **creare itinerari**; **non ama / non è bravo** a scrivere e a "il resto" (postare foto, newsletter, controllare affiliazioni). → divisione del lavoro: umano = sostanza/voce, AI = scrittura/distribuzione.

## I due business (flywheel)
Il blog è insieme **contenuti** e **servizi di viaggio**, e si alimentano a vicenda:

```
   CONTENUTI ──fiducia/audience──► alcuni lettori diventano CLIENTI
      ▲                                          │
      │                                          ▼
   i viaggi vissuti ◄──── SERVIZI (viaggi curati, itinerari su misura)
   diventano contenuti
            al centro di tutto: l' ITINERARIO
```

- **(A) Contenuti** → SEO/Pinterest/social → newsletter → affiliazione/ads.
- **(B) Servizi** → vendita di **viaggi propri curati** (solo o di gruppo, a tema) + **itinerari su misura**.
- L'**itinerario** è la chiave di volta: per l'utente è carburante editoriale, per i clienti è il prodotto.

## Glossario (linguaggio comune — usare SEMPRE questi termini)
- **ContentItem** — unità di contenuto canonica (article, page, gallery… ed estensioni verticali).
- **Modello canonico / blocchi** — il contenuto è una lista di **blocchi in JSON portabile** (non HTML). L'AI ragiona su questo; si renderizza poi a blog/IG/newsletter.
- **Itinerary** — tipo di contenuto del *vertical travel*: tappe, luoghi, date, geo.
- **Trip** — prodotto del *vertical travel* = Itinerary + date + capienza/posti + tema + prezzo.
- **Departure** — istanza programmata di un Trip (data, posti, waitlist).
- **Theme / Tema** — tassonomia trasversale (party, natura, cultura…) che lega contenuti ↔ trip ↔ segmenti.
- **Vertical Pack** — specializzazione plugin sul core generico (travel = vertical #1).
- **Connector** — adapter di un canale esterno nell'Integration Gateway.
- **Flywheel** — il ciclo contenuti↔servizi sopra.

## Architettura (stato corrente)
Principio: **core orizzontale (vale per QUALSIASI blog) + vertical pack** (travel è il primo). Il core non sa cos'è un "itinerario".

A strati:
- **Foundations**: Identity & Tenancy · Billing/Quote · Integration Gateway · Scheduler/Code/Worker · Media-DAM · Eventi/Outbox.
- **Domain core (generico)**: Content · Social/Canali · Email · CRM · Commerce · Monetizzazione/Affiliate · AI Orchestration · SEO · Analytics.
- **Vertical packs**: Travel (Itinerary, Trip, Departure/booking, geo/mappe, destinazioni).
- **App**: Dashboard · editor a blocchi · itinerary builder · portale cliente · analytics UI.

Scelte portanti (dettaglio negli ADR):
- **Monolite modulare** con confini di modulo **imposti**; servizi satellite solo *sotto pressione* (candidati: worker pool, redirector affiliati, connettori ballerini).
- **Multi-tenancy**: Postgres + **Row-Level Security** su `tenant_id`; segreti/token per-tenant cifrati.
- **CMS ibrido**: CMS proprio (scrive nel modello canonico) + adapter (es. WordPress) *adapter-ready* ora, costruiti dopo.
- **Tutto async + idempotente**; side-effect (publish/invii/chiamate esterne) su worker con retry/outbox/idempotency-key.
- **Human-in-the-loop = macchine a stati** (bozza→proposta AI→revisione→approvato→programmato→pubblicato). Stessa meccanica per contenuti, campagne e pipeline commerciale su misura.
- **AI**: brand voice per-tenant + RAG (pgvector) sui contenuti/itinerari dell'utente; **metering + budget cap** per tenant; **misuratore di autenticità/esperienza** (non "AI detector") per spingere la E-E-A-T.

### Vendita viaggi — due "motion"
- **Programmato** (one-to-many, OUTBOUND): catalogo → "prenota un posto" → acconto → conferma (waitlist se pieno). È dove il motore contenuti+newsletter+social *vende* i viaggi.
- **Su misura** (one-to-one, INBOUND): richiesta → proposta AI → trattativa → acconto → conferma. Usa la pipeline CRM.
- Nota regolatoria (IT/UE): vendere viaggi che bundlano trasporto+alloggio può rientrare nel **Codice del Turismo** → via standard = **partner operator/host agency** licenziato; internalizzare solo se i volumi lo giustificano. Il software early gestisce *workflow/CRM/proposta/pagamento/consegna*, **non** inventory/GDS.

## Canali (ipotesi da validare con i dati)
Per il **traffico al blog**: SEO + **Pinterest** (motore di ricerca visuale) pesano più di IG/TikTok (forti per brand/audience, deboli per i click in uscita). Da confermare con l'analytics unificata.
