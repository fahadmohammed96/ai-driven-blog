# Migrazioni (drizzle-kit)

`src/platform/db/schema.ts` è la **fonte tipata unica** delle tabelle.
Genera le migrazioni con:

    pnpm --filter @blogs/api db:generate

## Baseline `0000_init.sql` — nota
Il baseline è generato da drizzle-kit e poi **rifinito a mano** per due cose che
drizzle-kit non emette dal solo schema:
1. `CREATE EXTENSION vector` — deve precedere la tabella `content_embeddings`;
2. **RLS** (`ENABLE`/`FORCE ROW LEVEL SECURITY` + policy `tenant_isolation` basata su
   `current_setting('app.current_tenant')`) su `content_items` e `content_embeddings` — vedi ADR-0002.

Lo snapshot drizzle-kit (`meta/`) traccia **solo le tabelle**: quando aggiungi una nuova
tabella tenant-scoped, ricòrdati di aggiungere RLS + policy nella migrazione generata.
