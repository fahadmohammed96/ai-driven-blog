# ADR-0012 — Ambiente dev = WSL2 (Linux)

Stato: **Accepted** (2026-05-29). **Supersede [ADR-0011](README.md)** (Windows nativo).

## Contesto
[[0011]] aveva scelto **Windows nativo** (`C:\`) rimandando WSL2 (reversibilità alta, trigger "se l'I/O Docker/file-watch diventa doloroso"). In Fase 0 lo sviluppo su Windows nativo è andato bene (install/build/test/Docker rapidi), ma il progetto è **Docker-heavy** e **CI/prod sono Linux**. Conviene allineare l'ambiente dev a Linux **ora** che il repo è piccolo (relocazione economica). WSL2 è già installato sulla macchina e Docker usa il backend WSL2.

## Decisione
Ambiente dev = **WSL2 con distro Linux (Ubuntu)**.
- Il repo vive nel **filesystem WSL** (`~/ai-driven-blog`), **non** in `/mnt/c/...` (bind-mount lento).
- Toolchain dentro Ubuntu: **Node 24** (via `fnm`), **pnpm** (via `corepack`), git.
- Docker Desktop con **WSL integration** abilitata sulla distro.
- Setup automatizzato: [`scripts/setup-wsl.sh`](../../scripts/setup-wsl.sh).

## Conseguenze
- (+) Dev allineato a **prod/CI** (Linux): meno sorprese cross-OS (EOL, path, dipendenze native); I/O bind-mount e file-watch (`next dev`, `tsc -w`) più veloci.
- (+) Reversibilità **media**: tutto è in git; tornare a Windows = ri-clonare.
- (−) Setup iniziale una-tantum (install distro, clone, auth GitHub in WSL via PAT o Git Credential Manager condiviso).
- Il checkout Windows `C:\progetti-ai\blogs-manager` resta come *legacy* finché la migrazione non è confermata.

## Alternative scartate
- **Restare su Windows nativo** ([[0011]]): funzionava, ma disallineato da Linux CI/prod; rimandare rende la migrazione più costosa col crescere del repo.
- **VM Linux piena / dev container remoto**: più pesante di WSL2 per un singolo dev su questa macchina.
