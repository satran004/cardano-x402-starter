#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then
  if [ -f "$HOME/keys" ]; then python3 scripts/import-key.py
  else cp .env.example .env; chmod 600 .env; echo 'Set BLOCKFROST_PROJECT_ID and PAY_TO in .env, then run setup again.'; exit 1
  fi
fi
docker run --rm -v "$PWD:/workspace" -w /workspace/frontend node:22-bookworm-slim npm ci --no-audit --no-fund
if ! python3 -c 'from pathlib import Path; import re; s=Path(".env").read_text(); assert re.search(r"^PAY_TO=addr_test1(?!replace_me)[a-z0-9]+$",s,re.M)' 2>/dev/null; then
  docker run --rm -v "$PWD:/workspace" -w /workspace node:22-bookworm-slim node scripts/merchant.mjs
fi
echo 'Setup complete. Run ./scripts/start.sh to build and start the demo.'
