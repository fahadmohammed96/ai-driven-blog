# ADR — Architecture Decision Records

Le **decisioni** e il loro *perché* (la storia immutabile). Lo **stato corrente** sta in [PRODUCT.md](../PRODUCT.md) / [DEVELOPMENT.md](../DEVELOPMENT.md).

Questo file è il **log delle decisioni**: una riga per decisione è sufficiente. Quando una decisione richiede approfondimento, si "promuove" a file dedicato `NNNN-titolo.md` con: *Contesto → Decisione → Conseguenze → Alternative scartate*. Le ADR non si riscrivono: se cambiano, si aggiunge una nuova ADR che *supersede* la vecchia.

Stato: `Accepted` · `Proposed` · `Superseded`.

| ID | Decisione | Stato | Perché (sintesi) | Reversibilità |
|----|-----------|-------|------------------|---------------|
| 0001 | **Monolite modulare + plugin** (no microservizi al giorno 1; satelliti solo sotto pressione) | Accepted | Velocità per dev solo; isolamento via confini imposti + worker async; i microservizi rallentano il bug-fixing in solitaria | media |
| 0002 | **Multi-tenancy = Postgres RLS** su `tenant_id`; cucitura ora, hardening al tenant #2 | Accepted | Isolamento robusto senza over-engineering in fase dogfooding (n=1) | bassa |
| 0003 | **Stack = TypeScript full-stack** (NestJS · Next.js · Drizzle · pg-boss) | Accepted | Un linguaggio FE+BE, tipi condivisi, miglior supporto agenti AI, workload I/O-bound | framework: bassa |
| 0004 | **CMS ibrido + modello canonico a blocchi** (JSON portabile, non HTML); adapter (WordPress) adapter-ready | Accepted | L'AI ragiona su struttura; un solo modello per tutti i canali; round-trip esterni = mappatura | media |
| 0005 | **Core orizzontale + vertical pack** (per QUALSIASI blog; travel = #1) | Accepted | Profondità (travel/dogfooding) senza precludere la genericità; evita il "generic trap" | media |
| 0006 | **Integrazioni native, sequenziate** un canale alla volta (no aggregatori) | Accepted | Controllo + margine; email "native" = API provider (SES/Postmark), non SMTP proprio | media |
| 0007 | **Workflow dev**: TDD doppio-loop · test reali (Testcontainers/Playwright/mutation) · ADR+CLAUDE.md vs context rot · regola anti-debito | Accepted | Gestire i due rischi: context rot e test empirici | n/a |
| 0008 | **Servizi viaggio via partner operator/host agency** (no tour operator/GDS proprio al giorno 1) | Accepted | Esperienza "360" per il cliente senza il peso regolatorio (Codice del Turismo) e l'inventory; moat = curation+fiducia | alta |
| 0009 | **Coda = pg-boss** (su Postgres) prima di Redis/BullMQ | Accepted | Meno infra all'inizio; si passa a BullMQ sotto pressione | alta |
| 0010 | **Auth** = self-hosted TS, identità in Postgres (RLS-coerente); ora login minimale del fondatore (scrypt + JWT), libreria (es. Better Auth) al multi-utente — [dettaglio](0010-auth.md) | **Accepted** | No dipendenza/costo del gestito; identità in Postgres coerente con RLS/tenant; controllo | media |
| 0011 | **Ambiente dev = Windows nativo (`C:\`)**; WSL2 rimandato | **Superseded** (da 0012) | Uscita da OneDrive (DEBT-001) risolve sync/lock; per dogfooding n=1 il path NTFS nativo basta; il vantaggio WSL2 (I/O Docker/file-watch) si valuta se diventa doloroso | alta |
| 0012 | **Ambiente dev = WSL2 (Linux/Ubuntu)**; repo nel filesystem WSL, non in `/mnt/c` — [dettaglio](0012-dev-env-wsl2.md) | **Accepted** | Allinea dev a prod/CI Linux; I/O Docker/file-watch più veloci; relocazione economica ora che il repo è piccolo | media |
| 0013 | **Modello a blocchi canonico concreto** in `@blogs/contracts` (discriminated union Zod: heading/paragraph/image; itinerario serializzato a blocchi) | Accepted | Implementa ADR-0004: un solo modello tipizzato condiviso FE↔BE; l'AI ragiona sulla struttura, i renderer proiettano | media |
| 0014 | **Media-DAM**: storage **S3-compatibile** (MinIO in dev), varianti `sharp`, EXIF/geo `exifr`, matcher data/luogo generico; il DAM (foundation) resta **generico**, il link tappa↔foto vive nel vertical travel (no FK foundation→vertical) | Accepted | Auto-organizzazione foto senza accoppiare il core al travel; storage portabile (S3 in prod) | media |
| 0015 | **Macchina a stati di pubblicazione** (bozza→proposta→revisione→approvato→pubblicato; `requestChanges`→bozza) con **publish idempotente** (`published_at` impostato una sola volta) | Accepted | Human-in-the-loop esplicito e testabile; idempotenza → side-effect sicuri (PRODUCT) | media |
| 0016 | **Misuratore di autenticità = euristica** (segnali in prima persona/esperienziali), **non un AI-detector**: segnala le sezioni generiche da arricchire | Accepted | Spinge la E-E-A-T senza falsi positivi da "rilevatore AI"; trasparente e deterministico | alta |
