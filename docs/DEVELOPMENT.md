# DEVELOPMENT — come si lavora

Nato da due timori: **context rot tra i task** e **test "solo empirici"**. Leva unica per entrambi: **slice verticali sottili, a confine di modulo, ognuna ancorata a un test**.

## 1. Topologia & layout
- **Monolite modulare + plugin** (i vertical pack sono plugin). Confini di modulo **imposti dal tooling**: un modulo parla agli altri solo via contratto, non importa gli interni. *Convenzione*: ogni modulo espone un barrel `index.ts`; i cross-import passano **solo** dal barrel; un **arch-test** (`apps/api/src/arch/boundaries.test.ts`) fallisce sulle violazioni.
- Servizi **satellite solo sotto pressione** (worker pool, redirector affiliati `/go/`, connettori ballerini).
- **Monorepo** con FE/BE separati:
```
apps/
  api/    backend (NestJS) — src/{platform, modules, verticals}
  web/    frontend (Next.js)
packages/ condivisi: contracts (Zod), config, ui
docs/     fonti di verità
docker/   Dockerfile(s) + compose
```

## 2. Context rot — esternalizza la verità, limita il contesto
- Verità nei doc del repo, mai nella chat: **ADR** (decisioni+perché) + **CLAUDE.md** radice e (in futuro) per-modulo.
- **Slice sottili**, pochi moduli per task.
- **A fine task**: aggiorna doc/ADR rilevanti *prima di chiudere* (la DoD lo impone).

## 3. Test reali, non empirici
> Un test è reale **solo se può FALLIRE quando rompi il codice**. Se rompi la funzione e resta verde, è finto.
- **Acceptance criteria PRIMA del codice** (Given/When/Then), su esiti osservabili (DB, eventi, output) — non su dettagli interni/conteggi di chiamate.
- **Dipendenze reali dove conta**: Testcontainers (Postgres/Redis veri → SQL, **RLS**, code); API esterne via Stripe test mode / sandbox / **contract test** da OpenAPI (no mock fatti a mano).
- **E2E (Playwright)** sui journey critici, automatici in CI (non click manuali).
- **Mutation testing (Stryker)** = prova che i test sono reali (coverage = eseguito; mutation = verificato).
- **Anti-flaky**: un E2E ballerino va in quarantena e si sistema subito.

## 4. TDD — col bisturi
- **Default sul cuore di dominio**, **doppio-loop**: ATDD esterno (acceptance) + unit TDD interno dove la logica è ricca (prezzi, posti/waitlist, macchine a stati, trasformazioni di contenuto).
- **NO test-first** su spike / UI / integrazioni da scoprire → spike, poi lock con test.
- **Classicista + dipendenze reali**; mock solo ai confini veri.
- Divisione: **l'umano possiede l'acceptance test (la specifica), l'agente lo fa passare**; la mutation fa da revisore.

## 5. Definition of Done
Un task è DONE solo se:
1. l'**acceptance test** esisteva *rosso* prima ed è ora *verde* (mostrare il red→green);
2. unit/integration verdi; **CI verde** (lint + typecheck + test);
3. niente nuovo debito **silenzioso** → eventuali scorciatoie in `TECH_DEBT.md`;
4. **doc/ADR aggiornati** se cambiano stato o decisioni;
5. la casella in `ROADMAP.md` è spuntata.

## 6. Debito tecnico (regola anti-accumulo)
Distinguiamo debito *spericolato* (sciatteria — bloccato dai gate sopra) da *prudente/deliberato* (scorciatoia consapevole — ammessa **se tracciata**).
1. **Debito visibile, mai silenzioso**: ogni scorciatoia in `TECH_DEBT.md` nello stesso commit, con `// TODO(debt):` nel codice che linka l'entry.
2. **Ogni debito ha un TRIGGER di rientro** (es. "prima del tenant #2", "prima del launch"), non un vago "dopo".
3. **Debt-gate tra le fasi**: a fine fase si paga il debito *scaduto* prima di aprire la successiva.
4. **Boy-scout bounded**: pulizia opportunistica piccola sì; refactor grossi = task a sé.
5. **Debito ≠ bug** (i bug si fixano, non sono opzionali).

## 7. Stack (TypeScript full-stack)
| Area | Scelta | Note |
|---|---|---|
| Backend | **NestJS** | moduli = bounded context + vertical pack; DI; guard per tenancy/RBAC |
| Frontend | **Next.js/React** | SSR/ISR per blog pubblico (SEO) |
| Data | **Postgres + pgvector**, ORM **Drizzle** | Drizzle comodo per RLS (Prisma alternativa) |
| Coda | **pg-boss** | su Postgres, niente Redis all'inizio → BullMQ/Redis sotto pressione |
| Contratti | **Zod** in `packages/contracts` | type-safety FE↔BE |
| Test | **Vitest · Testcontainers · Playwright · Stryker** | |
| Media/DAM | **sharp + exifr** | resize/format + EXIF-geo |
| AI | **Anthropic TS SDK** + pgvector | prompt caching; Vercel AI SDK opzionale lato FE |
| Monorepo | **pnpm + Turborepo** | |
| Auth | **DA DECIDERE (ADR)** | self-hosted TS con org (es. Better Auth, dati in Postgres → RLS) vs gestito (es. Clerk). Per ora minimale (n=1) |
| Hosting | **al deploy** | probabile: container host (Fly/Railway/Render) + Vercel per web |

**Reversibilità** ("migriamo se serve"): coda pg-boss→BullMQ *facile* · ORM *media* · framework *difficile*.

## 8. Ambiente & CI
- **Docker** per isolare dev + test. `docker-compose`: **Postgres + MinIO (S3) + Mailhog (email)** (Redis solo quando si passa a BullMQ). App su host per hot-reload veloce; in container per CI/prod. **Docker ≠ microservizi**: il monolite è un container.
- **E2E full-stack**: Playwright avvia web→API; l'**API in dev/E2E** fa **auto-migrate + seed tenant + ensure-bucket** al boot con `DB_AUTO_MIGRATE=1` (vedi `apps/api/src/main.ts`). L'**LLM è fittizio al confine** nei test (e `StubLlmClient` se manca `ANTHROPIC_API_KEY`) → niente chiamate reali/pagate in CI.
- **CI = punto di imposizione**: merge bloccato se rosso. Per PR: lint + typecheck + build + unit + **HTTP (swc+Testcontainers)** + integration (Testcontainers) + **E2E full-stack** (porta su lo stack). Di notte: E2E completi + mutation.

## 9. Tooling futuro
- **Graphify** (`safishamsi/graphify`): knowledge graph del codebase contro il context rot. **Non ora** (greenfield) → adottare in fase 1/2 quando il codice cresce. Complemento, non sostituto, di ADR/CLAUDE.md.
