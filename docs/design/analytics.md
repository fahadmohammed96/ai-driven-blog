# Design note — Analytics unificata (Fase 4, Slice 1)

> Stato corrente dell'analytics cross-canale. Decisioni e *perché* in
> [ADR-0025](../adr/0025-unified-analytics-source-port.md). Questo slice **apre la
> Fase 4** (Intelligenza); lo Slice 2 (loop di feedback) leggerà queste read-model.

## Modello unico (`metric_snapshots`)
Una riga = un punto-metrica cross-canale: `(source, channel?, metric, value,
period, content_item_id?)` + `captured_at`. `value` è `double precision` (conteggi
ma anche la *posizione media* di Search Console). `period` è un'etichetta (`all`
per lo snapshot corrente) — **forward-looking** per la serie storica. Tenant-scoped
da RLS (`ENABLE`+`FORCE` + `tenant_isolation`), in `APP_RW_TABLES` per `app_rw`.

## Le sorgenti — un port comune (`AnalyticsSourcePort`)
`{ source, kind: "internal"|"external", collect(ctx) → MetricInput[] }`. Tutte le
sorgenti implementano lo stesso seam; il service le orchestra in modo uniforme.

| Sorgente | kind | Dato | Da dove |
|---|---|---|---|
| `affiliate` | **internal (reale)** | `clicks` per canale (`unattributed` se null) | `affiliate_clicks` (3.1) |
| `email` | **internal (reale)** | `subscribers` (confermati) · `pending_subscribers` | `subscribers` (Fase 2.5) |
| `social` | **internal (reale)** | `posts` per canale | `channel_posts` (Fase 2) |
| `content` | **internal (reale)** | `published` · `items` (totali) | `content_items` (Fase 1) |
| `ga4` | **external (stub)** | `sessions`/`users` per canale acquisizione | `Ga4SourceStub` (fixture) |
| `search_console` | **external (stub)** | `impressions`/`clicks`/`avg_position` su `organic` | `SearchConsoleSourceStub` (fixture) |

Le **interne** leggono direttamente le tabelle del **platform schema condiviso**
(niente import degli interni di altri moduli → confini intatti). Le **esterne**
sono **stub deterministici al confine** (niente API/chiavi/rete) — `createExternalSources()`
rispecchia `createPaymentFromEnv`/`createNotificationFromEnv`. Live = **DEBT-013**.

## Ingest + dashboard
- `POST /analytics/ingest` → esegue tutte le sorgenti; per ciascuna
  `replaceSnapshotsForSource` **cancella+reinserisce** (RLS-scoped) → **idempotente**
  (rieseguire non raddoppia, niente righe stub duplicate). Ritorna `{ingested, bySource[{source,kind,count}]}`.
- `GET /analytics` → `{ rows, bySource, byChannel, ingestedAt }`. `rows` = modello
  piatto; `bySource` somma le metriche per sorgente; `byChannel` raggruppa ogni
  `(source, metric, value)` sotto il canale (cross-sorgente — es. `organic` porta
  GA4 **e** Search Console). La dashboard **etichetta** `external` come *stub*.

## Superficie `/analytics`
8ª della toolbox (indipendente). Riusa `PageHeader`/`Card`/tokens + `fetch`. Card
di rollup per-sorgente con badge **reale/stub**, tabella cross-canale piatta;
bottone "Aggiorna metriche" → ingest → reload.

## Test (red → green)
- **unit** `external-sources.test.ts` (3): stub deterministici, ben formati,
  `kind=external`, `avg_position` come double.
- **HTTP** `analytics.http.test.ts` (3): ingest reale+stub in una dashboard; click
  affiliato reale sul canale seedato; GA4/SC stub etichettati; rollup cross-canale;
  **idempotenza**; **isolamento RLS** (la dashboard del founder non vede l'altro
  tenant; il replace del founder non cancella le righe altrui).
- **integration** `analytics.integration.test.ts` (3, come ruolo runtime `app_rw`):
  ingest+dashboard, grant provati, isolamento per-tenant. + guardia grant in
  `runtime-rls.integration.test.ts`.
- **e2e** `analytics.spec.ts` (scritta test-first; conductor esegue il gate):
  self-seed click affiliato → `/analytics` → aggiorna → metrica reale + stub
  GA4/SC etichettati.

## Limiti noti (non silenziosi)
- **GA4/Search Console = fixture** (DEBT-013) finché non si cablano gli adapter
  reali (OAuth2 + key management, coerente con DEBT-008).
- Gli stub esterni girano **dentro** la write-tx di ingest (innocuo: sincroni e
  deterministici); l'adapter reale dovrà fare il fetch **fuori** dalla tx
  (DEBT-013 + `TODO(debt)` sugli stub).
- Snapshot corrente "tutto = `all`": niente trend storico in questo slice (la
  colonna `period` lo abiliterà).
- Le API social (oltre il conteggio `channel_posts`) non sono una sorgente esterna
  in questo slice — si agganceranno a DEBT-007/008 quando si collega un canale reale.
