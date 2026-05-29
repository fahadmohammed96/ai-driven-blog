# TECH_DEBT — registro del debito tecnico

Regola (vedi DEVELOPMENT.md §6): **niente debito silenzioso.** Ogni scorciatoia consapevole va qui, con un **trigger di rientro**. Nel codice, un `// TODO(debt): <ID>` linka la voce. A fine fase, il **debt-gate** paga ciò che è scaduto.

Stato: `OPEN` · `PAYING` · `PAID`.

| ID | Debito | Perché l'abbiamo preso | Rischio/costo | Trigger di rientro | Stato |
|----|--------|------------------------|---------------|--------------------|-------|
| DEBT-001 | Repo dentro **OneDrive** (`...\OneDrive\Desktop\...`) | Procedere subito col setup senza spostare la cartella | Sync/lock dei file, performance scarsa, conflitti con Docker/WSL2 | **Prima di scrivere codice vero** (inizio Fase 0, task scaffold) | **PAID** |
| DEBT-002 | Migrazioni DB **a mano** (SQL in `apps/api/drizzle/*.sql`); drizzle-kit non ancora cablato | Evitare pairing di versioni drizzle-kit/orm e gestione journal mentre lo schema è minimo | Possibile drift tra `schema.ts` e SQL (mitigato: le query Drizzle nei test falliscono se divergono) | **Prima di Fase 1 (content)** o quando lo schema cresce | OPEN |

> **DEBT-001 → PAID (2026-05-29):** repo spostato da OneDrive a `C:\progetti-ai\blogs-manager` (NTFS, non sincronizzato) → risolti sync/lock. Caveat: è un path **Windows nativo, non WSL2**, quindi l'I/O Docker/file-watch può restare meno fluido che in WSL2 → scelta registrata in **ADR-0011** (Windows nativo, WSL2 rimandato).

---

## Come aggiungere una voce
1. Nuova riga con `DEBT-00N`, descrizione, *perché*, rischio, **trigger** concreto (mai "dopo").
2. `// TODO(debt): DEBT-00N` nel punto del codice interessato.
3. Quando il trigger scatta → `PAYING` → risolto → `PAID` (mantieni la riga per storia).
