# Fase 2.5 — UI distribuzione + E2E · handoff

> **Record point-in-time (2026-05-30).** Cosa è stato costruito nella Fase 2.5 e come è stato verificato.
> Questo file è **storia, non si tiene in sync**: per lo stato corrente vedi [ROADMAP](ROADMAP.md) ·
> [PRODUCT](PRODUCT.md) · [CLAUDE.md](../CLAUDE.md); per il *perché* delle scelte gli [ADR](adr/README.md).

## Obiettivo
Portare la distribuzione (il *motore* è pronto e verde dalla Fase 2) sotto il principio **"l'umano conferma"**,
con journey **E2E**. Scelta di scope: **verificabile ora** con connettori/email **stub o Mailhog** al confine
(come l'LLM in Fase 1) — niente sistemi esterni reali. Diviso in **due slice sottili**.

## Slice 1 — Gate di approvazione (human-in-the-loop) · PR #3 (`97f3d99`)
Il cuore "l'AI propone, l'umano conferma": i post ri-adattati non "escono" finché un umano non li approva.
- **Backend**: `approval.ts` — transizione pura `nextPostStatus` (`draft → approved/rejected`, **idempotente**,
  con guardia); `social.repo` (`getChannelPostById`/`setChannelPostStatus`); `distribution.setPostApproval`
  (RLS-scoped) + `ChannelPostNotFoundError`; endpoint **`POST /articles/:id/posts/:postId/{approve,reject}`**.
- **UI** `apps/web/app/studio`: sezione **"5. Distribuzione"** — *Genera post social* (instagram+x, niente immagine
  obbligatoria) → lista per canale → **Approva** (stato `draft`/`approved` visibile, bottone disabilitato a verde).
- **Test**: `approval.test.ts` (4 unit) · `social.http.test.ts` esteso (approve idempotente, 404, **409** su
  transizione illegale) · **E2E** `studio.spec.ts` esteso: *itinerario → foto → articolo → pubblica → repurpose → approva*.
- **Accettazione**: E2E verde in CI ✓.

## Slice 2 — UI newsletter · PR #4 (`1eafa1c`)
- **UI** `apps/web/app/newsletter`: pagina nuova — **iscrizione double opt-in** (GDPR: email + tema → conferma via
  email) + **invio segmentato** per tema (oggetto/HTML → "Inviata a N"). Il **backend newsletter esisteva già**
  (Fase 2): questo slice è **UI + E2E**, senza toccare il dominio.
- **Test**: **E2E** `newsletter.spec.ts` — *subscribe (UI) → estrae il token di conferma da **Mailhog** (cleanup
  quoted-printable) → conferma → invio segmentato → esito*. Filtra l'email per indirizzo univoco per robustezza.
- **Accettazione**: E2E verde in CI ✓.

## Decisioni (ADR)
**Nessun ADR nuovo.** La 2.5 *realizza* il principio "l'umano conferma" sopra le decisioni di Fase 2
(ADR-0017 repurposing, 0018 email/opt-in, 0019 integration gateway): è UI + E2E, non nuove scelte architetturali.

## Debito tecnico
**Nessuna voce nuova.** Resta **fuori scope** (su **DEBT-008**, trigger *primo canale reale*): il **consent-flow
OAuth per collegare un canale reale** — qui i connettori sono stub al confine. Invariati DEBT-006/007 (Fase 2).

## Verifica a fine fase
- **Locale**: typecheck · lint · build · unit · http (slice 1) **verdi**.
- **CI**: **E2E browser** di entrambi gli slice **verdi**; **`main` verde** dopo i due merge (squash).
- Caselle ROADMAP Fase 2.5 spuntate **a verde** (red→green per ogni slice). PR #3 e #4 mergiate; **0 PR aperte**.
