# ADR-0025 — Analytics unificata: modello a `metric_snapshots` + `AnalyticsSourcePort` (interne reali, GA4/Search Console stubbate)

Stato: **Accepted** (2026-05-31). Fase 4 — Intelligenza, Slice 1 (apre la Fase 4).

## Contesto
La Fase 4 ("Intelligenza") parte dall'**analytics unificata** (ROADMAP): *una
sola dashboard mostra le metriche cross-canale*. Il prodotto ha già **dati reali**
sparsi per i moduli — click di affiliazione (3.1), iscritti newsletter (Fase 2.5),
post per canale (Fase 2), contenuti pubblicati (Fase 1) — e dipende da **fonti
esterne** per il traffico (GA4, Google Search Console, e in futuro le API social).
PRODUCT (*Canali — ipotesi da validare con i dati*) chiede esplicitamente di
**confermare con l'analytics unificata** quali canali pesano.

Il vincolo della casa (ogni fase finora): **niente sistemi esterni reali in CI**.
LLM (Fase 1), Email/Mailhog (Fase 2), connector (Fase 2.5), Payment (3.2),
Notification (3.3) sono tutti **port con stub deterministico al confine**.
L'analytics deve seguire lo stesso compasso: le fonti **interne** si leggono dal
DB (sono già nostre), le fonti **esterne** si stubbano.

## Decisione
1. **Modulo `modules/analytics`** (bounded context read-heavy), tenant-scoped +
   RLS come ogni modulo. Le read-model interne leggono le tabelle del **platform
   schema condiviso** (`affiliate_clicks`, `subscribers`, `channel_posts`,
   `content_items`) — **non** gli interni di altri moduli, quindi i confini
   (arch-test) restano intatti.
2. **Un modello unico** `metric_snapshots` tenant-scoped: `(source, channel,
   metric, value, period, content_item_id?)`. `value` è `double precision` (regge
   i conteggi ma anche la *posizione media* di Search Console, 14.2). `period` è
   un'etichetta (`all` per lo snapshot corrente) — colonna **forward-looking** per
   la serie storica negli slice successivi. RLS `ENABLE`+`FORCE` + policy
   `tenant_isolation`; tabella in `APP_RW_TABLES` per il ruolo runtime `app_rw`
   (DEBT-005); guardia di grant in `runtime-rls.integration.test.ts` (insert **e**
   delete: l'ingest cancella+reinserisce).
3. **Un port per-sorgente** `AnalyticsSourcePort` — `{ source, kind, collect(ctx)
   → MetricInput[] }`, `kind ∈ {internal, external}`. Tutte le sorgenti
   implementano lo stesso seam, così il service le tratta in modo uniforme:
   - **interne (reali)**: `AffiliateSource` (click per canale), `EmailSource`
     (iscritti confermati/pending), `SocialSource` (post per canale),
     `ContentSource` (pubblicati/totali);
   - **esterne (stubbate al confine)**: `Ga4SourceStub` (sessioni/utenti per
     canale acquisizione) e `SearchConsoleSourceStub` (impressioni/click/posizione
     media su `organic`) → **fixture deterministiche, niente API/chiavi/rete**.
     `createExternalSources()` rispecchia `createPaymentFromEnv`/
     `createNotificationFromEnv`: il confine resta stub finché non si cabla un
     adapter reale (**DEBT-013**, follow-up del fondatore).
4. **Ingest idempotente per-sorgente**: `replaceSnapshotsForSource` cancella le
   righe di quella sorgente (RLS-scoped) e reinserisce quelle fresche → rieseguire
   l'ingest dà lo stesso risultato (niente doppi conteggi, niente righe stub
   duplicate). `POST /analytics/ingest` esegue tutte le sorgenti; `GET /analytics`
   serve la **dashboard unificata** (`rows` piatte + rollup `bySource` e
   `byChannel`). La dashboard **etichetta** le righe `external` come *stub* così un
   numero reale non si confonde mai con una fixture.
5. **Superficie hub `/analytics`** (8ª della toolbox, ADR-0020/0021), riusa
   `PageHeader`/`Card`/tokens + `fetch`; il bottone "Aggiorna metriche" lancia
   l'ingest e ricarica.

## Conseguenze
- **Positive**: una sola dashboard cross-canale con dati **reali** dove li
  abbiamo; le ipotesi-canali di PRODUCT diventano misurabili; il modello unico +
  il port rendono banale aggiungere una sorgente (interna o esterna) e — Slice 2 —
  far leggere queste read-model al *loop di feedback* (le metriche adattano le
  proposte AI). Il `period` è già pronto per la serie storica.
- **Negative / debito**: GA4 e Search Console sono **fixture** finché DEBT-013 non
  cabla gli adapter reali (OAuth2 + property/site id + key management, coerente con
  DEBT-008). **Limite noto (non silenzioso)**: oggi gli stub esterni girano
  *dentro* la write-tx di ingest — innocuo perché sincroni e deterministici, ma un
  adapter reale dovrà fare il **fetch fuori dalla tx** (registrato in DEBT-013 e in
  `TODO(debt)` sugli stub). Lo snapshot corrente è "tutto = `all`": niente trend
  storico in questo slice (la colonna `period` lo abiliterà).

## Alternative considerate
- **Una tabella per sorgente / viste materializzate**: più vicino allo storage di
  ogni modulo, ma niente modello cross-canale unico → la dashboard dovrebbe
  ri-unire tutto a query-time. Il modello `metric_snapshots` unico è la primitiva
  che PRODUCT chiede ("una sola dashboard").
- **Ingest event-driven (outbox al momento del click/iscrizione)**: più "live", ma
  accoppia ogni modulo all'analytics e moltiplica le scritture. Lo snapshot
  pull-based (ingest che ricalcola) è più semplice e idempotente per n=1; l'outbox
  resta un'opzione *sotto pressione* (DEVELOPMENT §1).
- **Sorgenti esterne reali subito**: viola il compasso "niente sistemi esterni in
  CI" e richiede OAuth/key management (DEBT-008). Stub al confine, live = DEBT.

> Nota: questo ADR **non** è loggato in `adr/README.md` da questo task (gestito
> altrove); la conductor lo registra.
