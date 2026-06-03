# Design note — CRM "Su misura" (Fase 3, Slice 3)

> Stato corrente della pipeline CRM custom-trip one-to-one (INBOUND). Decisioni e
> *perché* in [ADR-0024](../adr/0024-crm-custom-trip-pipeline-notification-port.md).
> Il motore commerce "Programmato" (OUTBOUND, one-to-many) è lo Slice 2
> ([design](commerce.md)). Questo slice **chiude la Fase 3**.

## Modello
- **Lead** = una **richiesta su misura** inbound (`request` libero) di un cliente,
  guidata dalla macchina a stati. Una sola **proposal** viva per lead (colonna,
  null finché l'AI non la redige). `deposit_cents`/`currency` = l'offerta;
  `payment_ref` = riferimento del `PaymentPort` a incasso avvenuto; `portal_token`
  = link **unguessable** al portale cliente (`/portal/:token`, unique).

## Macchina a stati del lead (`lead-state.ts`)
```
  received ──draftProposal──► ai_drafted ──approve──► human_approved ──markSent──► sent
     ▲                            │                                                 │
     └────────reject──────────────┘                                       requestDeposit
                                  (cancel → cancelled da ogni non-terminale)         │
                                                                                     ▼
        delivered ◄──deliver── confirmed ◄──confirmPayment── deposit_pending ◄───────┘
```
- Happy path: `received → ai_drafted → human_approved → sent → deposit_pending →
  confirmed → delivered`. `reject` riporta una bozza a `received` (ri-bozza).
  `delivered`/`cancelled` terminali.

## Il cancello human-in-the-loop (INBOUND, ADR-0020)
**Strutturale, non un flag.** L'instradamento al cliente vive **fra** due
transizioni in `approveAndSend`:
1. `approve` (ai_drafted → human_approved) — registra l'**approvazione umana**
   (`approved_at`).
2. `NotificationPort.notify({kind:"proposal"})` — la proposta esce verso il cliente.
3. `markSent` (human_approved → sent) — `sent_at`.

Poiché `markSent` è raggiungibile **solo** da `human_approved`, e l'unico punto che
instrada la proposta è `approveAndSend`, **nulla raggiunge il cliente senza
approvazione**. Asserito su 3 livelli: unit (da `ai_drafted` non esiste `markSent`),
HTTP (lo stub di notifica è vuoto dopo la bozza, 1 messaggio dopo l'approvazione),
integration come ruolo runtime. La **metà di lettura** del cancello è il portale:
l'itinerario è rivelato **solo** a `delivered`.

## AI propone (LLM al confine, come Fase 1)
- `draftProposal(request, brandVoice)` → system prompt costruito dalla **brand voice
  del tenant letta dalle Settings** (`getTenantSettings`, non la costante
  `FOUNDER_VOICE`) → **paga DEBT-010 su questo percorso**.
- Passa per il `LLM`/`LlmClient`: **stub deterministico** in test/CI, Anthropic
  reale dietro `ANTHROPIC_API_KEY` in prod. La chiamata LLM è **fuori** da ogni
  transazione DB (3 passi: leggi voce → draft → persisti `ai_drafted`).

## NotificationPort (instradamento WhatsApp/mail) — stub
- Porta al confine come `EmailPort`/`PaymentPort`: `notify({leadId, channel, to,
  kind:"proposal"|"itinerary", body}) → {ref, status}`.
- **Stub deterministico** (dev/CI): **registra** ogni messaggio (`sent[]`, per
  asserire il cancello) e `ref = <wa|mail>_stub_<kind>_<leadId>` (funzione pura ⇒
  idempotente). Niente WhatsApp/SMTP reale, niente rete.
- **Live = DEBT-012** (router WhatsApp Business API + gamba mail su `EmailPort`),
  founder follow-up. Per `whatsapp` lo stub usa `customerEmail` come handle: un
  campo telefono dedicato è parte del follow-up.

## Acconto (riuso `PaymentPort`, ADR-0023)
- Stessa porta/stub deterministico (`pi_stub_<leadId>`); stesso flusso a 3 passi
  senza transazione DB aperta sulla rete: `sent→deposit_pending` · `collectDeposit`
  · `deposit_pending→confirmed` (`payment_ref`+`confirmed_at`). Stripe live =
  DEBT-011. La macchina a stati è il **gate autoritativo**: il controllo di
  presenza-acconto viene *dopo* la transizione (stato illegale ⇒ 409, non 400).

## Consegna — portale cliente tokenizzato
- `GET /portal/:token` (contesto tenant founder n=1, come il redirector affiliati):
  `{status, customerName, itinerary}`. `itinerary` è non-null **solo** a
  `delivered`. `deliverItinerary` instrada una notifica `kind:"itinerary"` e rende
  visibile l'itinerario. Idempotente: ri-consegnare non instrada un duplicato.

## Endpoint
`POST /leads` · `GET /leads` · `GET /leads/:id` · `POST /leads/:id/draft` ·
`POST /leads/:id/approve` · `POST /leads/:id/reject` · `POST /leads/:id/deposit` ·
`POST /leads/:id/deliver` · `GET /portal/:token` (pubblico/tokenizzato).

## Tabella + RLS/grant
`leads` (tenant-scoped): RLS `ENABLE`+`FORCE` + policy `tenant_isolation`
(migrazione `0010_*`), nome in `APP_RW_TABLES` (`bootstrap.ts`) per il ruolo
runtime `app_rw` (DEBT-005), guardia di grant in `runtime-rls.integration.test.ts`.

## UI
Superficie sottile `/crm` nella toolbox dell'hub: inbox richieste → Bozza AI →
**Approva e invia**/**Rifiuta** (il cancello) → Versa acconto → Consegna; link al
portale a consegna avvenuta. E2E `crm.spec.ts` scritta test-first (la conductor
esegue il gate E2E in WSL).

## Follow-up / limiti (non silenziosi)
- **DEBT-012** — WhatsApp/mail live (router reale). **DEBT-011** — Stripe live.
- **Trattativa multi-round** con storico messaggi: qui è un giro
  bozza→approva con `reject`→ri-bozza (non multi-proposta). Follow-up.
- **Preventivo AI strutturato**: `deposit_cents` è fornito al passo di bozza; un
  preventivo (voci/prezzo) generato dall'AI è follow-up.
- **Portale ricco** (auth cliente oltre il token, accept/decline, pagamento dal
  portale): follow-up. Risoluzione tenant ancora stub n=1 (tenant #2).
