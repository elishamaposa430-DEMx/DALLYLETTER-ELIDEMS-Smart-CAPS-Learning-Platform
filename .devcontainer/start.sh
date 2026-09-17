#!/usr/bin/env bash
set -euo pipefail

cd /workspaces/${localWorkspaceFolderBasename:-$(basename "$(pwd)")}

if [ ! -f .env ]; then
  cp .env.example .env
fi

if grep -q "postgresql://postgres:postgres@localhost:5432/dallyletter" .env; then
  sed -i "s#postgresql://postgres:postgres@localhost:5432/dallyletter#postgresql://postgres:postgres@postgres:5432/dallyletter#" .env
fi

if [ -f package.json ]; then
  corepack enable
  pnpm install --frozen-lockfile || pnpm install
fi

if [ -f "lib/db/package.json" ]; then
  pnpm --filter @workspace/db run push || true
fi

printf '\nStarting app...\n'

if [ -f package.json ]; then
  (pnpm dev > /tmp/dallyletter-codespace.log 2>&1) &
  echo "App startup launched in background."
fi
