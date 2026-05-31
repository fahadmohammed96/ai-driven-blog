# ADR-0026 — Loop di feedback: le metriche analytics adattano le proposte AI (segnale deterministico, LLM stubbato)

Stato: **Accepted** (2026-06-01). Fase 4 — Intelligenza, Slice 2.

## Contesto
La ROADMAP (Fase 4) chiede il **loop di feedback**: *date certe metriche, le
proposte AI del ciclo dopo cambiano di conseguenza* — l'accettazione è un test in
cui metriche A producono la proposta X e metriche B (risultati diversi) la
cambiano in Y. È il **volano** del prodotto (PRODUCT — *AI Orchestration; il
flywheel*): l'analytics unificata (Slice 1, [ADR-0025](0025-unified-analytics-source-port.md))
deve **retroagire** su cosa l'agenzia AI propone.

Vincoli della casa, ereditati da ogni fase:
- **L'AI propone, l'umano conferma** ([ADR-0020]): il loop può cambiare **cosa**
  si propone, **mai** il cancello di approvazione.
- **Niente non-determinismo in CI**: l'LLM è uno **stub al confine**; un test di
  accettazione non può dipendere dal testo generato. L'accettazione deve essere
  sugli **input/piano** che cambiano, non sull'output dell'LLM.
- **Confini di modulo** (arch-test): un modulo parla agli altri solo via barrel.

## Decisione
1. **Segnale deterministico derivato dai rollup** (`@blogs/contracts/feedback`):
   funzioni **pure** `deriveFeedbackSignal(dashboard)` → `FeedbackSignal` e
   `buildContentProposal(signal)` → `ContentProposal`. Il segnale somma, **per
   canale e cross-sorgente**, solo le metriche di **engagement**
   (`clicks`/`sessions`/`users`/`impressions` — non `posts`/`items`/`published`
   che sono *effort/inventario*, né `avg_position` che è un *rango*), scarta
   `unattributed`, ordina i canali in modo deterministico (score desc, pareggio
   per nome canale), e marca *underperformer* i canali **sotto la media**. La
   proposta è il piano: canale **primario**, *secondari*, *deprioritizzati*, più
   un `promptHint` e una `rationale` ("perché questa proposta") che **citano** il
   segnale. Pure → stesso dashboard ⇒ stessa proposta ⇒ testabile in CI oggi.
2. **Nessuna tabella nuova**: il loop legge il read-model RLS-scoped già esistente
   (`metric_snapshots` via `AnalyticsService.getDashboard`), come suggerito
   dall'handoff di Slice 1. Funziona indistintamente su dati **interni reali** o
   sugli **stub esterni** (GA4/SC, DEBT-013).
3. **Modulo `modules/feedback`** (bounded context), tenant-scoped + RLS. Inietta
   `AnalyticsService` **dal barrel** di `modules/analytics` (che ora la esporta) —
   nessun import di interni, confini intatti. `GET /feedback/proposal` ritorna
   `{ signal, proposal }`. Il modulo orchestra soltanto *read + transform pura*.
4. **Bridge verso la generazione (stubbata)**: `platform/ai` `buildPrompt`/
   `generateDraft` accettano un `feedbackHint` opzionale che viene **intessuto nel
   prompt** ("Indicazione dai dati (loop di feedback): …"). Dimostra — e prova con
   un test — che il segnale derivato dalle metriche è un **input reale** che
   cambia l'istruzione data all'LLM; l'LLM resta stub al confine.
5. **Superficie leggera**: la card *"Prossimo ciclo — cosa propone l'AI"* su
   `/analytics` mostra canale primario + rationale + emphasis. L'umano vede il
   *perché* e poi conferma (ADR-0020 intatto).

## Conseguenze
- **+**: accettazione netta e deterministica (A→X, B→Y) sia a livello puro
  (contracts) sia HTTP/integration (attraverso RLS, anche come ruolo runtime
  `app_rw`); niente nuova superficie di RLS/grant; loop CI-testabile **oggi** su
  dati reali o stub.
- **−** (tracciato, non silenzioso — **DEBT-014**): l'endpoint di generazione live
  (`verticals/travel/itineraries.controller.ts`) **non** estrae ancora il
  `feedbackHint` da `FeedbackService` (passa solo `voice`); il bridge esiste ed è
  testato, l'auto-iniezione al call-site è il follow-up, legato al **motore di
  autonomia** (oggi stub in Settings) e coerente con DEBT-010 (stessa via di
  generazione). Il segnale di engagement è volutamente **volume-based** e su un
  unico bucket `all` (niente trend/finestre temporali — la colonna `period` di
  Slice 1 lo abiliterà in seguito): scelta semplice e spiegabile, non un limite
  nascosto.

## Alternative scartate
- *Mettere il segnale in una nuova tabella*: inutile — i rollup bastano; evita
  RLS/grant nuovi (rule 13).
- *Far decidere all'LLM cosa proporre*: romperebbe il determinismo del test e la
  regola "niente LLM reale in CI". Il segnale **deterministico** guida il piano;
  l'LLM (stub) ne riceve solo l'hint.
- *Cambiare il cancello di approvazione in base alle metriche*: vietato da
  ADR-0020 — il loop cambia **cosa** si propone, non **chi** conferma.

[ADR-0020]: 0020-operating-model.md
