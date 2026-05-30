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

## `0001_*.sql` — content blocks + itinerary (Fase 1)
Colonne `content_items` (`type`/`status`/`blocks` jsonb/`updated_at`) + nuova tabella
`itinerary_stops`. Generato da drizzle-kit; **RLS + policy `tenant_isolation` su
`itinerary_stops` aggiunte a mano** in coda (come da nota sopra). `content_items` eredita
la policy già esistente (la policy vale per tutte le colonne, incl. le nuove).

## `0002_*.sql` — Media-DAM (Fase 1)
Tabelle `media_assets` (asset + varianti jsonb + `taken_on`/`lat`/`lng` da EXIF) e
`itinerary_stop_photos` (link tappa↔foto, dominio travel). Generato da drizzle-kit;
**RLS + policy `tenant_isolation` su entrambe aggiunte a mano** in coda.

## `0003_*.sql` — published_at (Fase 1)
Colonna `content_items.published_at` (nullable) per la macchina a stati di pubblicazione
(impostata **una sola volta** al primo `published` → publish idempotente). Nessuna RLS
aggiuntiva: la policy di `content_items` copre anche la nuova colonna.

## `0004_*.sql` — channel_posts (Fase 2 · repurposing)
Tabella `channel_posts` (proiezione adattata per canale di un articolo: `channel`,
`status`, `payload` jsonb). Generato da drizzle-kit; **RLS + policy `tenant_isolation`
aggiunte a mano** in coda.

## `0005_*.sql` — subscribers + subscriptions (Fase 2 · newsletter)
Tabelle `subscribers` (double opt-in: `status`, `confirm_token`, `requested_at`/
`confirmed_at`/`unsubscribed_at`; unique `(tenant_id,email)`) e `subscriptions`
(opt-in per tema; unique `(subscriber_id,theme)`). Generato da drizzle-kit; **RLS +
policy `tenant_isolation` su entrambe aggiunte a mano** in coda.

## `0006_*.sql` — connector_credentials (Fase 2 · Integration Gateway)
Tabella `connector_credentials` (token OAuth **cifrati** a riposo: `access_token`/
`refresh_token` sealed, `expires_at`; unique `(tenant_id,connector)`). Generato da
drizzle-kit; **RLS + policy `tenant_isolation` aggiunta a mano** in coda.
