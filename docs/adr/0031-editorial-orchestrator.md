# ADR-0031 — Editorial Orchestrator (orchestrazione flat-centralizzata) + seam del motore di autonomia

- **Stato:** Accettata
- **Data:** 2026-06-02
- **Contesto slice:** Piattaforma agentica — Slice **O3** (ultima, 16/16). Dipende da A1-writer, S1, S2/S3, O1, T1, O0 ([ADR-0029](0029-agentic-platform.md), [ADR-0030](0030-pgboss-platform-worker.md)). Realizza il modello operativo [ADR-0020](0020-operating-model.md) ("l'AI propone, l'umano conferma").

## Contesto

Gli specialisti agentici (Writer, SEO, Social, Email, Analyst, Inbound) propongono ciascuno una `Proposal<T>` dentro un gate umano. Mancava il **regista**: un agente che, dato un orizzonte temporale, produca un **piano editoriale** (calendario di slot, priorità, note per specialista) coordinando gli altri. Tre tensioni da risolvere:

1. **Topologia di orchestrazione.** Un orchestratore può chiamare gli altri agenti in molti modi (gerarchie annidate, agenti che si chiamano a vicenda, code di messaggi). Servono fermabilità, auditabilità e un budget isolato per (tenant, agente).
2. **Confine architetturale (CRUX 1).** L'orchestratore generico vive in `platform/ai/agents` (kernel). Il kernel **non deve importare `modules/*`** (i sub-agenti concreti `SeoAgent`/`AnalystAgent` vivono nei moduli). Va trovato un modo per comporli senza violare il layering.
3. **Autonomia.** ADR-0020 prevede un futuro **motore di autonomia** (policy a 3 assi agente × cliente × azione + tetti) che esegua automaticamente il piano. La decisione del fondatore è **"seam only"**: costruire il *punto d'innesto*, non il motore — senza erodere il propose-only.

## Decisione

### 1. Orchestrazione FLAT e CENTRALIZZATA
L'`OrchestratorAgent` (`platform/ai/agents/orchestrator-agent.ts`) gira sul `AgentRunner` esistente (loop ReAct limitato, `maxSteps=10`, tier `balanced`) e chiama gli altri agenti **come tool** (`runWriter`/`runSeo`/`runAnalyst`). **Nessuna gerarchia, nessun loop annidato, nessun agente che ne chiama un altro fuori dall'orchestratore.** Un loop flat è fermabile (`maxSteps`/`maxContextTokens`), auditabile (`ai_agent_runs`) e con budget isolato per sub-agente.

### 2. Sub-agenti INIETTATI + binding al composition-root (CRUX 1)
- I tool `run-{writer,seo,analyst}` sono **generici**: portano solo la *shape* e ricevono un **dispatch iniettato**; non importano i sub-agenti. I tool deterministici di contesto (`getContentCalendar`/`listTrips`/`getTenantSettings`) ricevono **accessor iniettati**. Il kernel non nomina mai un modulo.
- Il **binding ai sub-agenti concreti** avviene al **composition-root** (`modules/orchestrator/orchestrator.controller.ts`), un modulo che importa **solo i barrel pubblici** (`modules/seo`, `modules/analytics`, `modules/commerce`, `modules/content`, `modules/settings`); il Writer è già in `platform/ai/agents`. Aggiunto l'export `AnalystAgent` al barrel `modules/analytics` (cambio legittimo). `boundaries.test` + `ai-index.arch.test` restano verdi (l'orchestratore **non** è esportato dal barrel `platform/ai/index.ts`).

### 3. Budget per OGNI sub-agente via re-read del DB (CRUX 2)
Ogni sub-agente costruisce il **proprio `AgentRunner`** con la `TwoLevelBudgetGuard` **condivisa**, che **rilegge `SUM(cost_usd)` dal DB prima di OGNI sub-run**. Un orchestratore che scatena N sub-agenti **non può spendere N × il tetto**: dopo che il 1° sub-agente porta lo spend oltre il cap, il 2° viene rifiutato (`BudgetExceededError`).

### 4. Isolamento dei fallimenti → `agentNotes`
Un sub-agente che **lancia** (errore applicativo o `BudgetExceededError`) è **catturato** dall'orchestratore e registrato in `EditorialPlan.agentNotes` (keyed by agentId string); **l'eccezione non si propaga** e il piano esce comunque (parziale). `maxSteps` raggiunto → piano parziale `truncated:true`. Seed deterministico (`slots` non vuoti da calendario/viaggi/canali) → piano valido anche con stub LLM (CI a costo zero).

### 5. `approve(editorial_plan)` = ACKNOWLEDGE-ONLY
Il ramo `editorial_plan` del gate unificato (`agent-proposal-store.ts`) è **acknowledge-only** (specchio di `approveAnalystInsight`): ritorna `{id, status:'approved'}`, **nessun `content_item` creato, default `content_draft` non raggiunto, nulla pubblicato o auto-eseguito**. Il piano è SEMPRE stagiato `pending`.

### 6. Seam del motore di autonomia (motore = deferred)
L'unico punto d'innesto del futuro motore è un **ramo documentato** nell'orchestratore: una costante `AUTONOMY_ENGINE_ENABLED` (oggi `false`) e un branch che **legge** i livelli `specialistAutonomy` esistenti (`packages/contracts/src/settings.ts` — stub T2, nessun engine). Con il motore acceso, esso auto-dispatcherebbe gli slot ai relativi specialisti (dentro il budget) invece di stagiarli; oggi assente → **propose-only preservato**. Il seam **legge** le manopole, **non le crea** (nessun campo nuovo in `TenantSettings`, nessun "orchestrator" in `SPECIALISTS`). Il motore vero (+ il gate slot-per-slot + la lettura attiva dei livelli) = **DEBT-041**.

## Conseguenze

- **Positive:** un solo loop fermabile e auditabile; budget per-tenant garantito anche sotto fan-out; fallimenti di un sub-agente non abbattono il piano; confine kernel↔moduli rispettato (injection + composition-root); propose-only **strutturale** (acknowledge-only + seam spento); estensibilità invariata (aggiungere un sub-agente orchestrato = un dispatch al composition-root).
- **Negative / debito:** il motore di autonomia è **non costruito** (DEBT-041); Social/Email **non** sono ancora orchestrati (il piano coordina Writer/SEO/Analyst); il sub-run SEO opera sul contenuto più recente del tenant (accessor calendario parziale); l'endpoint baseline è **sincrono** (i piani schedulati/Batch passeranno per pg-boss, O0).

## Alternative scartate

- **Orchestrazione gerarchica/annidata** (sub-orchestratori, agenti che si chiamano a vicenda): budget e stop non isolabili, audit opaco. Scartata a favore del flat.
- **Motore di autonomia acceso ora:** viola la decisione del fondatore "seam only" e il propose-only di ADR-0020. Deferred a DEBT-041.
- **Orchestratore che pubblica / auto-esegue gli slot:** rompe l'invariante "il runtime non tocca lo stato pubblicato". L'orchestratore **propone**, non pubblica.
- **`OrchestratorAgent` che importa i sub-agenti dai moduli:** viola il layering kernel→feature. Scartata a favore di injection + binding al composition-root.
- **Aggiungere "orchestrator" a `SPECIALISTS` / un campo autonomia nuovo a `TenantSettings`:** fuori scope (trappola deep-equal dei test settings) e non necessario — il seam riusa le manopole esistenti.
