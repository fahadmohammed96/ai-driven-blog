#!/usr/bin/env bash
# Setup ambiente dev in WSL2 (ADR-0012). ESEGUIRE DENTRO una Ubuntu WSL2,
# NON da /mnt/c (l'I/O su quel path e' lento). Per lo piu' idempotente.
set -euo pipefail

echo ">> pacchetti base"
sudo apt-get update -y
sudo apt-get install -y curl unzip git ca-certificates

echo ">> Node 24 via fnm (user-scope, no sudo)"
if ! command -v fnm >/dev/null 2>&1; then
  curl -fsSL https://fnm.vercel.app/install | bash
fi
export PATH="$HOME/.local/share/fnm:$PATH"
eval "$(fnm env)"
fnm install 24
fnm default 24
fnm use 24

echo ">> pnpm via corepack"
corepack enable
corepack prepare pnpm@11.5.0 --activate

echo ">> clone del repo nel filesystem WSL (~/ai-driven-blog)"
cd "$HOME"
if [ ! -d ai-driven-blog ]; then
  git clone https://github.com/fahadmohammed96/ai-driven-blog.git
fi
cd ai-driven-blog

echo ">> dipendenze"
pnpm install

echo ">> sanity: build + unit test"
pnpm build
pnpm test

cat <<'NOTE'

OK. Passi finali manuali:
  - Docker Desktop -> Settings -> Resources -> WSL Integration -> abilita questa distro
  - poi:  pnpm stack:up && pnpm stack:check && pnpm stack:down
  - integration/e2e:  pnpm --filter @blogs/api test:integration  &&  pnpm --filter @blogs/web e2e

Nota: il clone di un repo PRIVATO puo' chiedere autenticazione GitHub.
Usa un Personal Access Token, oppure condividi il Git Credential Manager di Windows.
NOTE
