# Design note — Commerce "Programmato" (Fase 3, Slice 2)

> Stato corrente del motore commerce one-to-many (OUTBOUND). Decisioni e *perché*
> in [ADR-0023](../adr/0023-commerce-trips-departures-payment-port.md). Il motore
> CRM "Su misura" (INBOUND, one-to-one) è lo Slice 3 — non qui.

## Modello
- **Trip** = prodotto costruito su un **Itinerary** esistente (`itinerary_id` →
  `content_items` type `itinerary`) + `price_cents` + `deposit_cents` + `currency`
  (+ `theme?`).
- **Departure** = istanza programmata di un Trip: `departure_date` + `seats`
  (capienza). La **waitlist è derivata** (bookings `waitlisted`), non una colonna.
- **Booking** = un posto su una Departure (uno posto = una prenotazione).
  `deposit_cents`/`currency` sono **snapshottati** dal Trip alla prenotazione, così
  l'importo dell'acconto è stabile anche se il prezzo del Trip cambia dopo.

## Macchina a stati della prenotazione
```
                 (capienza piena?)
   ──reserve──►  reserved ──requestDeposit──► deposit_pending ──confirmPayment──► confirmed
        │            │                              │
        │ (piena)    └──────────cancel──────────────┴──cancel──► cancelled
        ▼
   waitlisted ──promote──► reserved
        └──────cancel─────► cancelled
```
- Lo **stato iniziale** (reserved vs waitlisted) lo decide la **capienza** in fase
  di prenotazione, non la macchina. La macchina governa le transizioni successive.
- `ACTIVE_BOOKING_STATUSES` = `reserved | deposit_pending | confirmed` → sono i
  posti che **occupano** capienza. `waitlisted`/`cancelled` non contano.
- **Senza oversell**: la prenotazione blocca la riga Departure (`SELECT … FOR
  UPDATE`) nella transazione tenant, conta gli attivi e decide reserved/waitlisted.

## PaymentPort (acconto)
- Porta al confine come `EmailPort`: `collectDeposit({bookingId, amountCents,
  currency, customerEmail}) → {paymentRef, status}`.
- **Stub deterministico** (dev/CI): acconto positivo ⇒ `succeeded`; `paymentRef =
  pi_stub_<bookingId>` (funzione pura ⇒ idempotente, asseribile). Niente rete/chiavi.
- **Acconto → conferma in 3 passi** (no transazione DB aperta sulla rete):
  `reserved→deposit_pending` · `collectDeposit` · `deposit_pending→confirmed`
  (con `payment_ref`+`confirmed_at`). Idempotente: ripagare un booking confermato
  ritorna lo stato confermato e lo stesso `paymentRef`.

### Cosa servirebbe per Stripe **live** (DEBT-011)
- Un `StripePaymentClient implements PaymentPort` dietro `STRIPE_SECRET_KEY`
  (test-mode), che crea un **PaymentIntent** e ritorna `client_secret`.
- Conferma **guidata da webhook** (`payment_intent.succeeded`) invece dello stub
  sincrono → endpoint webhook + verifica firma + idempotency-key.
- Gestione di esiti reali: fallimenti, 3DS/SCA, ricevute, rimborsi/cancellazioni.
- Provisioning sicuro della chiave (coerente con DEBT-008 sul key management).

## API
- `POST /trips` (da un itinerary; 400 se l'id non è un itinerary del tenant).
- `GET /trips` → trip + departures con uso posti (`booked/available/waitlisted`).
- `POST /trips/:tripId/departures` → lancia una partenza (data + posti).
- `GET /departures/:id` → partenza con uso posti.
- `POST /departures/:id/bookings` → prenota (reserved o waitlisted se piena).
- `POST /bookings/:id/deposit` → versa l'acconto (stub) e conferma; idempotente.

## UI
- Superficie sottile `/trips` nella toolbox hub: elenca partenze + uso posti, e
  guida book → acconto → conferma (waitlist se pieno). Motore nell'API. E2E
  `trips.spec.ts` scritta test-first (la conductor esegue il gate E2E).

## Limiti noti / follow-up
- **Stripe stubbed** → incasso/ricevute/webhook/rimborsi assenti (**DEBT-011**).
- **Promozione automatica dalla waitlist** quando un posto si libera (o l'acconto
  scade): `promote` è nella macchina ma non cablato a un trigger/scadenza → quando
  servirà la gestione attiva della waitlist.
- Tenant resolution = stub n=1 (tenant #2). Un posto = una prenotazione (no party).
