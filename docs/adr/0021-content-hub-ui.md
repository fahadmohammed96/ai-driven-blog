# ADR-0021 — La UI di prodotto: content-hub (toolbox)

Stato: **Accepted** (2026-05-31).

## Contesto
Il backend è pronto e verde fino alla Fase 2.5 (contenuti + blocchi canonici,
Media/DAM, pipeline AI, macchina a stati di pubblicazione, repurposing/social,
newsletter, connettori). Mancava la **UI di prodotto**: finora esistevano solo
`/studio` (un wizard lineare) e `/newsletter`, nati come *walking skeleton* per
tenere verdi le journey E2E. Il modello operativo deciso in [[0020]] ("l'agenzia
AI **propone**, l'umano **conferma**; **cassetta degli attrezzi, non procedura
guidata**") richiede una superficie di prodotto coerente con quel principio.
[[0020]] è il modello guida ma è **intenzionalmente non committato** in questa
build (decisione del fondatore 2026-05-31): per questo lo stato corrente non
viene scritto in `PRODUCT.md`/`adr/README.md`, ma le decisioni di realizzazione
vivono qui e in `docs/design/content-hub.md`.

## Decisione
Costruire la UI di prodotto come **content-hub**: un app-shell con una **toolbox
nav persistente** e **quattro superfici indipendenti**, raggiungibili in
qualsiasi ordine (nessun "avanti/indietro", nessuno stepper):

1. **Library** — elenco/filtri dei ContentItem con i badge di stato.
2. **Block Editor** — modifica sul modello a blocchi canonico + **misuratore di
   autenticità** (contrappeso informativo, mai un cancello).
3. **Proposal Queue** — il gesto universale propose→approve/edit/reject sulla
   **macchina a stati di pubblicazione esistente** (`draft→proposed→review→
   approved→published`), nessuno stato nuovo inventato.
4. **Settings** — brand voice, **autonomia per specialista (stub, default
   manuale)**, canali; tenant-scoped e persistiti (`tenant_settings`, RLS).

Principi vincolanti della realizzazione:
- **Reuse, non reinvenzione.** Si riusano gli endpoint/contratti reali, la
  macchina a stati, il misuratore di autenticità (`platform/ai`), la convenzione
  di stile esistente (inline-style + token, niente Tailwind/CSS-modules/UI lib) e
  i pattern fetch dei surface legacy. **Nessun nuovo framework introdotto.**
- **Un solo gesto, un solo badge ovunque** (`StateBadge`) → il modello
  propose→approve è apprendibile una volta sola.
- **Toolbox, non wizard** ([[0020]]): superfici indipendenti; il chaining è
  opt-in al momento, nessun rules engine.
- **Confini di modulo rispettati**: i nuovi endpoint stanno in `modules/content`
  e nel nuovo `modules/settings`; gli arch-test restano verdi.
- **Walking skeleton legacy intatti**: `/studio` + `/newsletter` restano verdi.
- **Slice verticali sottili, test-first** (un acceptance test per slice;
  red→green), una superficie per slice; lo slice 5 integra (hub coerente +
  journey cross-surface + docs).

## Conseguenze
- (+) Una superficie di prodotto coerente che incarna [[0020]]; il founder può
  fare dogfooding del flusso reale propose→approve end-to-end.
- (+) Costo di manutenzione basso: nessuna nuova dipendenza UI; i token sono la
  fonte unica per spaziatura/colore/tipografia.
- (+) Reversibilità alta sui dettagli: le superfici compongono primitive, non
  stili ad-hoc; cablare `@blogs/contracts` nel web (oggi i tipi sono *mirrored*)
  è uno step pulito successivo.
- (−) **Vincolo di harness (WSL):** `pnpm e2e`/Playwright **si blocca** in questo
  setup (lo step webServer va in hang). Mitigazione adottata: le spec E2E sono
  scritte **test-first** (codificano i criteri di accettazione) ma **la conductor
  esegue il gate E2E** separatamente; gli slice sono verificati in locale sulle
  **suite veloci** (typecheck · lint · unit/arch · HTTP swc · integration
  Testcontainers). Questo è un fatto operativo, non architetturale.
- (−) Alcuni anelli restano aperti come follow-up espliciti (registrati, non
  silenziosi): la generazione legge ancora la costante `FOUNDER_VOICE` invece
  delle Settings (**DEBT-010**); l'autonomia è uno stub (motore reale → debito *a
  quel punto*); l'onboarding OAuth canale reale è **DEBT-008**.

## Alternative scartate
- **Estendere il wizard `/studio`** come prodotto: contraddice [[0020]]
  (procedura guidata vs toolbox) e accoppia fasi che devono essere indipendenti.
  Tenuto solo come walking skeleton E2E.
- **Introdurre una UI library / design system esterno** (Tailwind, MUI…):
  overhead e dipendenza non necessari a n=1; i token + poche primitive bastano e
  mantengono la coerenza con i surface esistenti.
- **Una nuova macchina a stati per le proposte**: riusata quella di
  pubblicazione esistente — "approve" collassa `proposed→review→approved` in un
  solo gesto umano; nessuno stato nuovo.
