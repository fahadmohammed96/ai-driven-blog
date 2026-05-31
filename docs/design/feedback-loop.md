# Design note — Loop di feedback (Fase 4, Slice 2)

> Stato corrente del loop che chiude il volano: analytics (Slice 1) → segnale →
> proposta del ciclo dopo. Decisioni e *perché* in
> [ADR-0026](../adr/0026-feedback-loop-signals-adapt-proposals.md).

## Catena: metriche → segnale → proposta
```
metric_snapshots (RLS)            (Slice 1)
   └─ AnalyticsService.getDashboard → byChannel rollup
        └─ deriveFeedbackSignal(dashboard)            [puro, contracts]
             • somma engagement per canale (cross-sorgente)
             • scarta 'unattributed'; ordina score desc, tie-break per nome
             • underperformer = canali sotto la media
        └─ buildContentProposal(signal)               [puro, contracts]
             • primary = top channel; deprioritize = underperformer; resto secondary
             • promptHint (→ generazione) + rationale ("perché questa proposta")
   └─ GET /feedback/proposal → { signal, proposal }    [modules/feedback]
```

## Cosa conta come "engagement"
`ENGAGEMENT_METRICS = clicks · sessions · users · impressions`. **Esclusi** di
proposito: `posts`/`items`/`published` (effort/inventario, non risposta del
pubblico) e `avg_position` (rango, non volume). Un canale con soli `posts` ha
score 0 → finisce tra gli underperformer (siamo attivi lì ma senza engagement
misurato). `unattributed` non è mai un canale da raccomandare.

## Deterministico vs stubbato
- **Deterministico (reale)**: la derivazione del segnale e la costruzione della
  proposta sono funzioni **pure** in `@blogs/contracts` — stesso dashboard ⇒
  stessa proposta. Lette via il read-model **RLS-scoped** di Slice 1 (nessuna
  tabella nuova). Funziona su dati interni **reali** o sugli stub esterni.
- **Stubbato al confine**: l'LLM. Il `promptHint` è intessuto in `buildPrompt`
  (`platform/ai`) — input reale che cambia l'istruzione — ma il client LLM resta
  lo stub deterministico in CI. L'accettazione è sul **piano/segnale**, non sul
  testo.

## Test (red → green)
- **unit (contracts)** `feedback.test.ts` (6): **l'accettazione chiave** — set A
  (pinterest performa) → proposta guida pinterest; set B (instagram performa,
  somma cross-sorgente) → la proposta cambia e guida instagram; più: ignora
  inventory/rank e `unattributed`, tie-break deterministico, proposta neutra
  senza metriche, purezza.
- **unit (api)** `pipeline.test.ts` (+1): il `feedbackHint` arriva davvero nel
  prompt dell'LLM (stub) quando presente, assente altrimenti.
- **HTTP** `feedback.http.test.ts` (4): seed metriche A → `GET /feedback/proposal`
  guida pinterest; seed B → guida instagram (loop adatta); **isolamento RLS** (le
  metriche di un altro tenant non plasmano la proposta); proposta neutra senza
  metriche.
- **integration** `feedback.integration.test.ts` (3, come ruolo runtime `app_rw`):
  A→X / B→Y e isolamento per-tenant, con la sola `SELECT` su `metric_snapshots`
  → prova che il loop gira sotto RLS least-privilege senza grant nuovi.
- **e2e** `feedback.spec.ts` (scritta test-first; la conductor esegue il gate):
  **before/after** — ingest baseline → il canale unico è **assente** dal piano →
  self-seed click su canale unico → ri-ingest → il canale **entra** nel piano
  ranked della proposta. Asserzione di *cambiamento* (le metriche cambiano → la
  proposta cambia), non di dominanza: nel sistema completo il baseline stub di
  GA4/SC (`organic` ~21k = sessions+users+clicks+impressions) resta correttamente
  il canale **primario** — pochi click freschi non devono (e non dovrebbero)
  scavalcare migliaia di sessioni organiche; il loop che li classifica sotto
  `organic` è il comportamento corretto.

## Superficie `/analytics` — card "Prossimo ciclo — cosa propone l'AI"
Riusa `Card`/tokens. Mostra canale primario (badge), `rationale`, e l'emphasis
per canale (`primario`/`secondario`/`deprioritizzato` + score). Enhancement soft:
se `GET /feedback/proposal` fallisce, la dashboard resta visibile.

## Limiti noti (non silenziosi)
- **DEBT-014**: l'endpoint di generazione live non auto-inietta ancora il
  `feedbackHint` (bridge presente + testato; auto-iniezione legata al motore di
  autonomia, coerente con DEBT-010).
- Segnale **volume-based** su bucket unico `all` (niente trend/finestre temporali
  — la colonna `period` di Slice 1 lo abiliterà). "Underperformer = sotto la
  media" è una soglia semplice e spiegabile, raffinabile in seguito.
- ADR-0020 intatto: il loop cambia **cosa** si propone, non il cancello umano.
