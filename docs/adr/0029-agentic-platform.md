# 0029 — Piattaforma agentica (agenti tool-calling, propose-only, cost-controlled)

**Stato:** Accepted (build in corso, 8/16 slice sigillate su `feat/agentic-platform`)
**Data decisione:** 2026-06-01
**Estende/aggiorna:** ADR-0003 (stack), ADR-0016 (autenticità), uso single-shot dell'LLM in `platform/ai/pipeline.ts`.
**Implementa:** il modello operativo "agenzia AI propose→approva" (ADR-0020, *in revisione, non ancora committato*).

## Contesto
Fino alla Fase 4 l'AI del prodotto era **un singolo punto LLM single-shot** (`generateDraft` / `pipeline.ts`): un prompt, una risposta, nessuno strumento, nessun controllo di costo strutturale. Il modello operativo approvato (ADR-0020) ridefinisce la piattaforma come **agenzia di specialisti AI** che colmano le lacune dell'utente. Serviva quindi un'infrastruttura per agenti **tool-calling** che fosse: (a) **cost-controlled** (un LLM in loop può divergere in spesa); (b) **propose-only** (l'AI propone, l'umano conferma — riusa i gate di Fase 1/2.5/CRM); (c) a **confine di modulo** (l'arch-test vieta a `platform/ai` di importare `modules/*`/`verticals/*`); (d) **testabile a costo zero in CI** (niente chiamate LLM reali nei test).

## Decisione
Costruire l'infrastruttura agentica **slice-by-slice**, in 16 slice (8 fatte). Le decisioni sotto-componenti:

1. **`LlmPort` + model tiering** *(R1-A, `a8b7aab`)* — porta LLM generica; `ModelTier` `fast|balanced|powerful` → Haiku/Sonnet/Opus 4.x; tabella prezzi + `estimateWorstCaseUsd(def) = maxSteps × maxTokens × prezzo-output × 1.3` (alimenta il breaker). `ToolDefinition` con `stubArgs()` → stub deterministico = **costo zero in CI**.
2. **Metering + circuit-breaker a 2 livelli** *(R1-B, `6c3310c`)* — `ai_usage_events` (RLS, tenant-scoped); `MeteringService.record/monthlySpendUsd`; `TwoLevelBudgetGuard` (**L2** spesa-mese ≥ cap valutato per primo, poi **L1** stima-peggior-caso > residuo); `MeteredLlmAdapter` (decorator: `check` prima, `record` dopo); `budgetUsdMonthly` default **$50** in `TenantSettings`.
3. **`AgentRunner`** *(A1-core, `87889b6`)* — loop ReAct **limitato** (`maxSteps`), **idempotente** per `task_id`, budget L1 pre-loop, **gate di uscita pluggable** (max 1 iterazione extra), audit best-effort in `ai_agent_runs` (RLS). Envelope **`Proposal<T>`** propose-only (`payload/rationale/cost/tokensUsed/requiresHumanGate/truncated/auditRecorded/agentDefinitionVersion`). `AgentDefinition` + `AgentRegistry` con **hash-versione stabile** (`v1-<hex>`). `ToolRegistry.dispatch` valida I/O, tronca a `maxOutputTokens`, ctx tenant-scoped, tool terminale `final`.
4. **Writer agentico** *(A1-writer, `731f962`)* — `WriterAgent` su `AgentRunner`; **`generateDraft` diventa thin-wrapper** (comportamento Fase 1 **identico**, stub incluso). Tool reali (`retrieveContext` platform-pure su RAG; `getBrandVoice/getItinerary/getMediaForStop` via **accessor iniettati** → confine `platform↔moduli` rispettato senza import: il caller adatta i dati reali). `scoreAuthenticity` riusa la `measureAuthenticity` pura come **gate di uscita** del runner (non come tool).
5. **BYOK per-tenant** *(R1-C, `40c39da`)* — `ProviderRegistry.getClient(tenantId)`: se esiste credenziale `llm_anthropic` (cifrata AES-256-GCM, riusa l'Integration Gateway di ADR-0019) → `AnthropicLlmAdapter`; altrimenti **chiave-piattaforma** (stub a costo zero in test). La scelta è guidata dall'**esistenza della credenziale**, non da `settings`; `aiProvider` resta metadata.
6. **Feedback loop** *(A2, `7e33340`)* — tool `getFeedbackSignal` (accessor iniettato sulla dashboard analytics) offerto **per-run e condizionale**; il draft si adatta al segnale (canale top); la pre-iniezione del segnale attende l'Orchestratore.
7. **Staging + coda proposte** *(T1, `6ef3a59`)* — tabella `agent_proposals` (RLS); `AgentProposalStore` (`persist` idempotente / `listPending` / `approve` instrada per `type` / `reject`); `POST /agent-proposals/generate` = entrypoint agentico; `approve` **guida la macchina a stati di pubblicazione esistente (ADR-0015)**, non la duplica. UI "Code proposte": costo stimato + budget residuo + ragionamento agente + versione definizione.
8. **Settings agentici** *(T2, `71217d2`)* — UI budget / BYOK / autonomia / `auditPolicy`. `auditPolicy` `obbligatorio|best-effort` (default **obbligatorio**) → sotto `obbligatorio` le proposte senza audit registrato sono **nascoste**. La key BYOK è **sealed** AES-256-GCM (mai persistita in `tenant_settings`, mai restituita da GET). Flag autonomia `auto-within-limits` client-side (manopola spenta di default).

## Conseguenze
- **Costo sotto controllo** su quattro leve: tiering, prompt-caching, stub deterministico in CI, breaker a 2 livelli. **Propose-only** preserva il gate umano (riusa la macchina a stati di ADR-0015).
- Il confine `platform/ai` → niente import di `modules/*`/`verticals/*`: gli agenti ricevono **accessor iniettati**, è il caller (controller travel/media) ad adattare i dati reali. Pattern di `generateDraft` **generalizzato**.
- **DEBT aperti** (vedi TECH_DEBT 016-026): BYOK non cablato nella DI live (DEBT-023/025); controller travel non ancora migrato all'agente (DEBT-025); TTL/retention di `ai_agent_runs`/`ai_usage_events` (DEBT-021); `AgentRegistry` statico, niente storia versioni (DEBT-020); engine di autonomia dietro flag = lavoro futuro (slice O3).

## Alternative scartate
- **Autonomia attiva da subito** → scartata: scelto **propose-only** + flag di autonomia spento (rischio reputazionale/fiducia in fase dogfooding).
- **Un solo modello per tutto** → scartata: scelto **tiering** (la maggior parte dei passi non richiede Opus; risparmio reale).
- **Chiave LLM unica di piattaforma** → scartata: scelto **BYOK per-tenant** con fallback piattaforma (sostenibilità costi multi-tenant).
- **Sink diretto della bozza** (come Fase 1) → scartata per il path agentico: scelto **staging `agent_proposals`** (coda + audit + gate espliciti).
- **Framework di agenti esterno** (LangChain & co.) → scartata: runner minimale interno (confini, testabilità, zero dipendenze pesanti — coerente con ADR-0007).

## Slice rimanenti (8): S1 SEO · S2 Social · S3 Email · X1 Researcher · O1 Analyst · O2 Inbound · O0 pg-boss · O3 Orchestratore (autonomia dietro flag).
