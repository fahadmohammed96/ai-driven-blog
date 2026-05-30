# TECH_DEBT — registro del debito tecnico

Regola (vedi DEVELOPMENT.md §6): **niente debito silenzioso.** Ogni scorciatoia consapevole va qui, con un **trigger di rientro**. Nel codice, un `// TODO(debt): <ID>` linka la voce. A fine fase, il **debt-gate** paga ciò che è scaduto.

Stato: `OPEN` · `PAYING` · `PAID`.

| ID | Debito | Perché l'abbiamo preso | Rischio/costo | Trigger di rientro | Stato |
|----|--------|------------------------|---------------|--------------------|-------|
| DEBT-001 | Repo dentro **OneDrive** (`...\OneDrive\Desktop\...`) | Procedere subito col setup senza spostare la cartella | Sync/lock dei file, performance scarsa, conflitti con Docker/WSL2 | **Prima di scrivere codice vero** (inizio Fase 0, task scaffold) | **PAID** |
| DEBT-002 | Migrazioni DB **a mano** (SQL in `apps/api/drizzle/*.sql`); drizzle-kit non ancora cablato | Evitare pairing di versioni drizzle-kit/orm e gestione journal mentre lo schema è minimo | Possibile drift tra `schema.ts` e SQL (mitigato: le query Drizzle nei test falliscono se divergono) | **Prima di Fase 1 (content)** o quando lo schema cresce | **PAID** |
| DEBT-003 | **Branch protection** non attiva su `main` (la CI non blocca davvero il merge) | Richiede admin GitHub/API non disponibili da qui (gh non installato, nessun token) | Una PR rossa resta tecnicamente mergeabile finché non si abilita la protezione del branch | **Prima del primo collaboratore** — *in attesa: l'utente la abilita a mano (GitHub → Settings → Branches → require check `CI`)* | **PAID** |
| DEBT-004 | Layer HTTP Nest (controller/guard) non coperto da test **automatici** in CI; coperto da unit test sulla logica (`AuthService`) + e2e manuale | Testare DI/HTTP di Nest in Vitest richiede un transform (es. swc) per i decorator metadata — rimandato | Regressioni nel wiring HTTP non intercettate dalla CI | **Prima di aggiungere altri endpoint** / prima del multi-utente | **PAID** |
| DEBT-005 | **A runtime l'app si connette come superuser** Postgres (`blogs`) → la RLS è *bypassata a runtime* (è enforce solo nei test, via ruolo `NOSUPERUSER`) | n=1 dogfooding: la compose espone solo il superuser; creare un ruolo app dedicato + grant è lavoro di hardening non necessario finché il tenant è uno | Se arrivasse un tenant #2 senza hardening, niente isolamento reale a runtime (i dati sono comunque marcati `tenant_id` e l'isolamento è provato nei test) | **Prima del tenant #2** — ruolo app `NOSUPERUSER` + `GRANT` mirati + connection string dedicata (coerente con ADR-0002) | **PAID** |
| DEBT-006 | **Contract test del canale = validazione parziale** dall'OpenAPI (campi richiesti + security Bearer derivati dallo spec), non l'intero schema via runtime (Prism/openapi-backend) | Spin-up di un runtime OpenAPI completo è infrastruttura extra non necessaria col primo connettore; i campi/obblighi chiave bastano a verificare l'aderenza del connector | Un drift di tipo/forma non sui campi `required` potrebbe non essere intercettato dal contract test | **Al secondo connettore** o prima del go-live integrazioni → adottare un validatore OpenAPI runtime | **OPEN** |
| DEBT-007 | **Email = solo adapter SMTP** (Mailhog dev / relay): l'adapter provider API (SES/Postmark) di ADR-0018 non è implementato | Il test di accettazione è verso Mailhog (SMTP) e n=1 non invia ancora a volumi; il provider-port è già la cucitura giusta | In prod a volumi, SMTP "fai-da-te" ha deliverability/reputation peggiori di un provider | **Prima del primo invio di produzione a volumi** → implementare `EmailPort` su provider API | **OPEN** |
| DEBT-008 | **Nessun flusso di onboarding OAuth** del canale + gestione `CONNECTOR_SECRET_KEY`: il connector presume credenziali già nello store cifrato | Il contract test prova OAuth/refresh/rate-limit/cifratura senza bisogno della UI di "connetti canale"; nessun canale reale collegato in dogfooding | Collegare un canale reale richiede il consent-flow OAuth + provisioning sicuro della chiave master | **Prima di collegare un canale reale** → connect-flow OAuth + key management | **OPEN** |

> **DEBT-001 → PAID (2026-05-29):** repo spostato da OneDrive a `C:\progetti-ai\blogs-manager` (NTFS, non sincronizzato) → risolti sync/lock. Caveat: è un path **Windows nativo, non WSL2**, quindi l'I/O Docker/file-watch può restare meno fluido che in WSL2 → scelta registrata in **ADR-0011** (Windows nativo, WSL2 rimandato).

> **DEBT-002 → PAID (2026-05-29):** `schema.ts` è ora la **fonte tipata unica** (incl. `content_embeddings` con colonna `vector(256)`); `rag.ts` usa query Drizzle tipizzate (niente cast raw); **drizzle-kit cablato** (`drizzle.config.ts`, script `db:generate/migrate/check`, snapshot in `drizzle/meta/`). Il baseline `0000_init.sql` è generato da drizzle-kit e rifinito a mano per estensione pgvector + RLS (vedi `apps/api/drizzle/README.md`).

> **DEBT-004 → PAID (2026-05-29):** aggiunto **swc** a Vitest (`vitest.http.config.ts` + `unplugin-swc`) per i decorator metadata di Nest; nuovo test automatico `auth.http.test.ts` che boota l'app Nest e verifica `/auth/login` + `/auth/me` (200/401) via supertest. Gira in CI (step `test:http`).

> **DEBT-003 → PAID (2026-05-29):** branch protection attiva su `main` (ruleset): richiesto il check **CI**, *require branches up to date*, *block force pushes*. Un commit che non passa la CI non può finire su `main` (va prima validato su un altro ref → PR). **Registro debito azzerato.**

> **DEBT-005 → PAID (2026-05-30):** pagato **in anticipo** rispetto al trigger (su richiesta, per ripartire puliti). Il bootstrap, su connessione **admin** (`DATABASE_ADMIN_URL`), provisiona un ruolo app **`app_rw` `NOSUPERUSER`** con `GRANT` mirati (`ensureAppRole` in `platform/db/bootstrap.ts`); l'app gira come `app_rw` (`DATABASE_URL`) → **RLS enforced a runtime**. Provato da `runtime-rls.integration.test.ts` (isolamento cross-tenant + grant sull'intera catena Fase 1) e dal boot reale dell'app (journey verde, 0 warning "bypass"). Realizza l'hardening previsto da **ADR-0002**. **Registro debito di nuovo azzerato.**

---

## Come aggiungere una voce
1. Nuova riga con `DEBT-00N`, descrizione, *perché*, rischio, **trigger** concreto (mai "dopo").
2. `// TODO(debt): DEBT-00N` nel punto del codice interessato.
3. Quando il trigger scatta → `PAYING` → risolto → `PAID` (mantieni la riga per storia).
