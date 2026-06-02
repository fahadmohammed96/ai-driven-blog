# 0030 — pg-boss come coda lavori di piattaforma (baseline, least-privilege)

**Stato:** Accepted
**Data decisione:** 2026-06-02
**Estende/aggiorna:** ADR-0029 (piattaforma agentica — slice O0), ADR-0005/DEBT-005 (ruolo runtime `app_rw` NOSUPERUSER, RLS a runtime).
**Sblocca:** O3 (Editorial Orchestrator) — i piani schedulati e i Batch passano per pg-boss.

## Contesto
ADR-0029 ha previsto **pg-boss** come trasporto per il lavoro asincrono/non-interattivo dell'agenzia AI (newsletter mensile, SEO bulk, insight Analista schedulati, Batch API Anthropic), ma la libreria **non era mai stata installata né cablata**. La slice O0 posa la **baseline** della coda (enqueue / dequeue / retry / idempotenza), **isolata** dall'Orchestratore (O3, ancora da costruire): O0 fornisce solo il meccanismo generico, non i job applicativi.

Tre vincoli del repo plasmano la decisione:
1. **Least-privilege a runtime (DEBT-005):** l'app gira come `app_rw` **NOSUPERUSER** perché la RLS sia *enforced*. `app_rw` **non può fare DDL**. pg-boss però installa/migra il proprio schema e (per code partizionate) crea tabelle per-coda → **DDL**.
2. **pg-boss NON è tenant-scoped:** le sue tabelle sono **infra**, non dati del tenant → **niente RLS / `tenant_id`** su di esse (eccezione esplicita alla regola "ogni tabella tenant ha RLS"). L'isolamento del *lavoro* trasportato resta garantito a valle, dal runner (per-tenant) e dalla RLS già presente su `ai_agent_runs`.
3. **Consegna at-least-once:** pg-boss può consegnare lo stesso job due volte → serve **idempotenza** strutturale, non reinventata.

## Decisione
Cablare **pg-boss** (v12, schema dedicato `pgboss`) come coda di piattaforma, con la separazione netta **"admin installa, `app_rw` opera"**:

1. **Tutto il DDL è admin-side.** Nuovo step `ensurePgBoss(adminConnectionString, queues)` in `platform/db/bootstrap.ts` (fratello di `ensureSchema`/`ensureAppRole`): istanzia un `PgBoss` **admin** con `migrate:true`, `await boss.start()` (installa/migra lo schema `pgboss` come admin), crea le **code baseline** (`createQueue`, idempotente `ON CONFLICT DO NOTHING`; le code non-partizionate vivono nella tabella job condivisa → nessuna CREATE per-coda), `await boss.stop()`. Idempotente. Cablato in `main.ts::autoBootstrap` (blocco admin, dietro `DB_AUTO_MIGRATE=1`).
2. **`app_rw` riceve solo DML.** Nuovo step `grantPgBossSchema(adminDb, role)`: `GRANT USAGE` sullo schema + `SELECT/INSERT/UPDATE/DELETE ON ALL TABLES` + `USAGE,SELECT ON ALL SEQUENCES` + `EXECUTE ON ALL FUNCTIONS` dello schema `pgboss` → `app_rw`. Eseguito **dopo** `ensurePgBoss` (lo schema deve esistere) e **dopo** `ensureAppRole` (il ruolo deve esistere).
3. **Il worker di runtime gira come `app_rw` con DDL disabilitato.** `BatchWorker` (`platform/ai/batch-worker.ts`) incapsula pg-boss su connessione `DATABASE_URL` (app_rw), `schema:'pgboss'`, **`migrate:false`** (a `start()` fa solo `check()` dello schema, nessuna DDL), **`supervise:false`/`schedule:false`** (la manutenzione/partizioni di pg-boss richiede DDL → rimandata ad admin/hardening, DEBT-040). API generica `start/stop/enqueue/work` + `getJob`.
4. **Idempotenza at-least-once via `taskId` del runner.** L'handler baseline **agent-batch** (`makeAgentBatchHandler`) **propaga** un `taskId` stabile dal payload del job a `ctx.taskId` dell'`AgentRunner`. Una doppia consegna dello stesso payload → stesso `taskId` → `findByTaskId` → **replay** (stessa `Proposal`, **nessun** secondo costo LLM, **nessuna** seconda riga `ai_agent_runs`).
5. **Isolamento dal confine `platform/ai → modules/*`.** L'handler non importa i moduli: "quale agente girare" è risolto da un **resolver iniettato** (`agentId → AgentDefinition`) composto al composition root. O0 non costruisce logica di orchestrazione né i job specifici.
6. **Avvio worker flag-gated, default OFF.** In `main.ts` il `BatchWorker` parte **solo** se `WORKER_ENABLED=1` (e2e/dev **non** lo avviano → il gate e2e resta isolato e verde). Shutdown pulito su `SIGTERM`/`SIGINT` (`boss.stop()` + `app.close()`).

## Conseguenze
- **Least-privilege provato dai test** (integration come `app_rw`, Testcontainers): plumbing (enqueue→completed, risultato recuperabile), retry (handler che lancia → ritenta fino al limite → `failed` **senza** crash del worker), idempotenza (`taskId` → stesso run, LLM 1×, una sola riga `ai_agent_runs`). Un grant mancante = `permission denied` proprio qui (lezione DEBT-005/regola 13, ma su schema infra non-tenant).
- pg-boss è **trasporto, non oracolo**: non chiama l'LLM; l'handler agent-batch riusa il `MeteredLlmAdapter`/budget del runner → in CI stub LLM = **costo zero**.
- **DEBT aperti:** **DEBT-040** (la baseline NON posa i job applicativi reali — newsletter mensile, SEO bulk, analyst schedulato, Batch API Anthropic — né la manutenzione/retention/dead-letter/metriche di pgboss → trigger: prima slice che ne ha bisogno, R2 Batch / O3). O0 **sblocca** ma **non paga** **DEBT-019/DEBT-021** (FK `ai_usage_events.run_id → ai_agent_runs.id`, pre-insert run `pending`, retention `ai_agent_runs`): restano una slice di hardening dedicata.

## Alternative scartate
- **Lasciare pg-boss auto-migrare come `app_rw`** (`migrate:true` a runtime) → scartata: violerebbe DEBT-005 (DDL come ruolo NOSUPERUSER fallisce) e annacquerebbe il least-privilege. DDL **solo** admin-side.
- **Applicare RLS/`tenant_id` alle tabelle pg-boss** → scartata: sono infra, non dati del tenant; l'isolamento del lavoro è già garantito dal `taskId` per-tenant del runner e dalla RLS su `ai_agent_runs`. Aggiungere RLS qui sarebbe overhead errato e incompatibile con il modello a code di pg-boss.
- **BullMQ + Redis** → scartata: introdurrebbe un nuovo datastore (Redis) e una dipendenza operativa; pg-boss riusa **Postgres già presente** (transazionalità, backup, RLS sul resto) — coerente con lo stack deciso (ADR-0003) e con "zero dipendenze pesanti" (ADR-0007).
- **Cron in-process / `setInterval`** → scartata: niente durabilità, niente retry/at-least-once, niente coordinamento multi-istanza; inadatto a Batch e a piani schedulati.
- **Reinventare l'idempotenza nella coda** (singletonKey/dedup lato pg-boss) → scartata: l'idempotenza vive già nel runner (`taskId` → replay su `ai_agent_runs`); appoggiarsi a quella mantiene **una sola** sorgente di verità per "questo lavoro è già stato fatto".
