# ADR-0024 — CRM custom-trip pipeline (lead → AI proposal → human gate → deposit → deliver) + NotificationPort (WhatsApp/mail stubbed)

Stato: **Accepted** (2026-05-31). Fase 3 — Monetizzazione & servizi, Slice 3 (chiude la Fase 3).

## Contesto
La Fase 3 monetizza con **due motion** (PRODUCT, *Vendita viaggi — due motion*).
Dopo il motore **"Programmato"** OUTBOUND ([ADR-0023](0023-commerce-trips-departures-payment-port.md))
arriva l'altra metà: **"Su misura"** — **INBOUND, one-to-one**: *richiesta →
proposta AI → trattativa → acconto → conferma*, con l'itinerario **consegnato nel
portale cliente**. È la **pipeline CRM**.

Il compasso operativo (ADR-0020): **INBOUND = ogni richiesta passa dall'umano**.
L'AI **prepara** la proposta/offerta; l'umano **approva PRIMA** che esca verso il
cliente. Questo è il vincolo di prodotto che lo slice deve *rendere strutturale*,
non un controllo cosmetico.

Nota regolatoria (IT/UE, PRODUCT, invariata da ADR-0023): il software gestisce
**workflow/CRM/proposta/pagamento/consegna**, **non** inventory/GDS.

## Decisione
1. **Modulo `modules/crm`** (bounded context), tenant-scoped + RLS come ogni altro
   modulo. Cross-modulo solo via **barrel**: legge la **brand voice** da
   `modules/settings` (`getTenantSettings`) e riusa il **`PaymentPort`** dal barrel
   `modules/commerce`. Confini imposti dall'arch-test.
2. **Una tabella** `leads` tenant-scoped (RLS `ENABLE`+`FORCE` + policy
   `tenant_isolation`, in `APP_RW_TABLES` per il ruolo runtime `app_rw`, DEBT-005;
   guardia di grant in `runtime-rls.integration.test.ts`). Colonne chiave:
   `request` (la richiesta inbound), `status` (macchina a stati), `proposal` (bozza
   AI, null finché non redatta), `deposit_cents`/`currency` (l'offerta),
   `payment_ref`, `portal_token` (link al portale cliente, **unique**), più i
   timestamp di pipeline (`approved_at`/`sent_at`/`confirmed_at`/`delivered_at`).
3. **Macchina a stati del lead** (`lead-state.ts`, come la publication state machine
   ADR-0004 e la booking ADR-0023): `received → ai_drafted → human_approved → sent
   → deposit_pending → confirmed → delivered`; `reject` riporta una bozza a
   `received` (revisione/ri-bozza); `cancel → cancelled` dai non-terminali;
   `delivered`/`cancelled` terminali.
4. **Il cancello human-in-the-loop è STRUTTURALE**, non un flag. L'instradamento al
   cliente vive **fra due transizioni**: `approve` (ai_drafted → human_approved)
   *registra l'approvazione umana*, **poi** la proposta è instradata via
   `NotificationPort`, **poi** `markSent` (human_approved → sent). Poiché
   `markSent` è raggiungibile **solo** da `human_approved` e l'unico punto che
   chiama `notify(proposal)` è `approveAndSend`, **nulla raggiunge il cliente senza
   un'approvazione**. Lo prova la macchina a stati (unit: da `ai_drafted` non esiste
   `markSent`) e il journey (lo stub di notifica resta vuoto dopo la bozza).
5. **AI propone (LLM al confine, come Fase 1)**: la bozza passa per il
   **`LLM`/`LlmClient`** già esistente — stub deterministico in test/CI, Anthropic
   reale dietro `ANTHROPIC_API_KEY` in prod. Il system prompt è costruito dalla
   **brand voice del tenant letta dalle Settings** (non dalla costante hard-coded) →
   **paga DEBT-010 su questo percorso**. La chiamata LLM è **fuori** da ogni
   transazione DB (come l'acconto in ADR-0023).
6. **Acconto: riuso del `PaymentPort` di ADR-0023** — stessa porta, stesso stub
   deterministico (`pi_stub_<leadId>`), stesso flusso a tre passi senza tenere una
   transazione DB aperta sulla rete (`sent → deposit_pending` → `collectDeposit` →
   `deposit_pending → confirmed`). Stripe live resta **DEBT-011**.
7. **NotificationPort — porta al confine** per le notifiche **outbound** al cliente
   (WhatsApp/mail), come `EmailPort`/`PaymentPort`. `notify({leadId, channel, to,
   kind: "proposal"|"itinerary", body}) → {ref, status}`. In dev/CI uno **stub
   deterministico** che **registra** ogni messaggio (per asserire il cancello) e
   restituisce un `ref` funzione pura del lead+kind (`<wa|mail>_stub_<kind>_<leadId>`).
   **Niente WhatsApp Business reale, niente SMTP reale, niente rete.** Il router
   reale (WhatsApp Business API + la gamba mail su `EmailPort`) è **DEBT-012**.
8. **Consegna: portale cliente tokenizzato** — `GET /portal/:token` (lookup nel
   contesto del tenant founder, n=1, come il redirector affiliati / il confirm
   newsletter). È la **metà di lettura del cancello**: l'itinerario è rivelato
   **solo** a `delivered`; prima il cliente vede solo lo stato. Un portale ricco è
   follow-up.
9. **UI**: superficie sottile `/crm` nella toolbox dell'hub (ADR-0020/0021) — la
   inbox delle richieste: apri richiesta → Bozza AI → **Approva e invia** /
   **Rifiuta** (il cancello) → Versa acconto → Consegna itinerario; mostra il link
   al portale a consegna avvenuta. Il motore (stati, gate, pagamento, instradamento)
   sta nell'API.

## Conseguenze
- **Positive**: il journey ROADMAP *un lead percorre la pipeline (richiesta →
  proposta AI → acconto → conferma) e l'itinerario è consegnato nel portale cliente*
  è verde a HTTP+integration; il **cancello** è asserito a tre livelli (macchina a
  stati, journey HTTP, integration come ruolo runtime); isolamento RLS provato;
  determinismo di LLM/pagamento/notifica asserito; nessun sistema esterno reale
  toccato. **Chiude la Fase 3**. Riusa per intero la ricetta tabelle+RLS+grant,
  la meccanica macchina-a-stati e il `PaymentPort`. **Paga DEBT-010** sul percorso
  proposta.
- **Costi/limiti**: WhatsApp/mail sono **stubbed** (**DEBT-012**); l'acconto reale
  resta **DEBT-011**; il portale è una lettura minima (no auth cliente oltre al
  token, no thread di trattativa ricco); `deposit_cents` dell'offerta è fornito al
  passo di bozza (un preventivo AI strutturato è follow-up). Risoluzione tenant
  ancora stub n=1 (tenant #2). La **trattativa** (PRODUCT) è qui un singolo giro
  bozza→approva con `reject`→ri-bozza, non un multi-round con storico messaggi.

## Alternative scartate
- **Inviare al cliente all'`approve` in un colpo solo** (un'unica transizione
  ai_drafted→sent): collasserebbe il cancello in un dettaglio implementativo;
  tenere `human_approved` come stato esplicito con l'instradamento *fra* le due
  transizioni rende il gate verificabile e auditabile (`approved_at`).
- **WhatsApp/SMTP reale (o Mailhog) in CI**: rete/credenziali/non-determinismo,
  contrario al pattern porte-al-confine. Rinviato a DEBT-012 (la gamba mail può
  delegare all'`EmailPort` già esistente).
- **`proposal` come tabella separata `proposals`**: una sola bozza viva per lead in
  questo slice → una colonna basta ed evita join; lo storico multi-proposta è
  lavoro della trattativa multi-round (follow-up).
- **Portale che rivela la proposta a `sent`**: indebolirebbe la semantica di
  consegna; rivelare l'itinerario solo a `delivered` tiene il cancello netto.
