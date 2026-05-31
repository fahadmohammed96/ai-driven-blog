# ADR-0023 — Commerce: Trip/Departure + booking state machine + PaymentPort (Stripe stubbed)

Stato: **Accepted** (2026-05-31). Fase 3 — Monetizzazione & servizi, Slice 2.

## Contesto
La Fase 3 monetizza. Dopo l'hub affiliazioni ([ADR-0022](0022-affiliate-hub-redirector.md))
arriva il **motore commerce "Programmato"** (PRODUCT, *Vendita viaggi — due
motion*): catalogo → **prenota un posto** → **acconto** → **conferma**, con
**waitlist** quando la partenza è piena. È il punto in cui il motore
contenuti+newsletter+social *vende* i viaggi curati (il business B del flywheel).

Glossario (PRODUCT): **Trip** = Itinerary + date + capienza/posti + tema + prezzo;
**Departure** = istanza programmata di un Trip (data, posti, waitlist).

Nota regolatoria (IT/UE, PRODUCT): vendere viaggi che bundlano trasporto+alloggio
può rientrare nel Codice del Turismo. Il software early gestisce
**workflow/CRM/proposta/pagamento/consegna**, **non** inventory/GDS. Questo slice
modella esattamente questo: lo stato di una prenotazione e l'incasso dell'acconto,
non la disponibilità reale di posti aereo/hotel.

## Decisione
1. **Modulo `modules/commerce`** (bounded context), tenant-scoped + RLS come ogni
   altro modulo. Il Trip è **costruito su un Itinerary esistente** (`itinerary_id`
   → `content_items` di tipo `itinerary`); la composizione cross-modulo passa dal
   **barrel** di `modules/content` (`getContentItem`), mai dagli interni
   (arch-test). Commerce è dominio core generico: i nomi "Trip/Departure" sono del
   vertical travel, ma la meccanica prenotazione→acconto→conferma è riusabile.
2. **Tre tabelle** tenant-scoped (RLS `ENABLE`+`FORCE` + policy `tenant_isolation`,
   come le altre; tutte in `APP_RW_TABLES` per il ruolo runtime `app_rw`, DEBT-005):
   - `trips` (itinerary_id, title, theme?, price_cents, deposit_cents, currency).
   - `departures` (trip_id, departure_date, seats, status). La **waitlist è
     derivata** (bookings con stato `waitlisted`), non una colonna.
   - `bookings` (departure_id, customer_email/name?, status, deposit_cents +
     currency **snapshottati** dal Trip al momento della prenotazione, payment_ref,
     confirmed_at).
3. **Macchina a stati della prenotazione** (come la publication state machine,
   ADR-0004): `reserved → deposit_pending → confirmed`; `waitlisted` quando la
   partenza è piena (con `promote → reserved` quando un posto si libera);
   `cancel → cancelled` dai non-terminali. `confirmed`/`cancelled` sono terminali.
   Lo **stato iniziale** (reserved vs waitlisted) lo decide la **capienza**, non la
   macchina: la macchina governa le transizioni di una prenotazione esistente.
4. **Capienza senza oversell**: prenotando si **blocca la riga della Departure**
   (`SELECT … FOR UPDATE`) nella transazione tenant, si contano le prenotazioni
   *attive* (reserved+deposit_pending+confirmed) e si decide reserved vs waitlisted.
   Il lock serializza prenotazioni concorrenti sulla stessa partenza.
5. **PaymentPort (alias StripePort) — porta al confine**, come `EmailPort` (Fase 2)
   e i connector-stub (Fase 2.5). Il dominio dipende dalla porta
   (`collectDeposit(amount, currency, bookingId, email) → {paymentRef, status}`),
   non da Stripe. In test/CI uno **stub deterministico**: un acconto positivo
   **succeede** sempre e il `paymentRef` è funzione pura del booking
   (`pi_stub_<bookingId>`) → idempotente e asseribile. **Niente Stripe live, niente
   chiavi, niente rete.** Un adapter Stripe **test-mode** dietro `STRIPE_SECRET_KEY`
   è registrato come **DEBT-011** (PaymentIntent + conferma via webhook).
6. **Acconto → conferma in tre passi senza tenere una transazione DB aperta sulla
   rete**: (1) `reserved → deposit_pending` (idempotente: già `confirmed` ritorna
   così com'è); (2) `PaymentPort.collectDeposit` fuori da ogni transazione DB;
   (3) `deposit_pending → confirmed` con `payment_ref`+`confirmed_at`. Un acconto
   fallito lascia la prenotazione in `deposit_pending` (ritentabile). Rispecchia il
   mondo reale (Stripe: l'intent si crea, il webhook conferma).
7. **UI**: una superficie sottile `/trips` nella toolbox dell'hub
   (ADR-0020/0021) — elenca le partenze con l'uso posti e guida book → acconto →
   conferma (waitlist se pieno). Il motore (stati, capienza, pagamento) sta nell'API.

## Conseguenze
- **Positive**: il journey ROADMAP *lancio partenza → prenoto posto → acconto →
  conferma (waitlist se pieno)* è verde a livello HTTP+integration; isolamento RLS
  provato come ruolo runtime; determinismo del pagamento asserito; nessun sistema
  esterno reale toccato. Riusa per intero la ricetta tabelle+RLS+grant e la
  meccanica "macchina a stati" già consolidate.
- **Costi/limiti**: Stripe è **stubbed** → l'incasso reale, le ricevute, i webhook,
  i rimborsi non esistono ancora (**DEBT-011**). La **promozione automatica** dalla
  waitlist quando un posto si libera è modellata nella macchina (`promote`) ma non
  cablata a un trigger/scadenza acconto (note nel design). La risoluzione tenant
  resta lo stub n=1 (tenant #2). Un posto = una prenotazione (no party-size).

## Alternative scartate
- **Stripe test-mode reale in CI**: introduce rete/chiavi e non-determinismo;
  contrario al pattern porte-al-confine delle fasi precedenti. Rinviato a DEBT-011.
- **Waitlist come colonna/contatore sulla Departure**: ridondante e fonte di drift;
  derivarla dai `bookings.status` è l'unica fonte di verità.
- **Acconto dentro la transazione DB**: terrebbe un lock/connessione aperti sulla
  chiamata di rete del provider; il flusso a tre passi lo evita.
