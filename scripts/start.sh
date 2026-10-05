#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
case "${1:-java}" in
  java) docker compose up -d --build ;;
  js) docker compose -f compose.yaml -f compose.javascript.yaml up -d --build ;;
  *) echo "Usage: $0 [java|js]" >&2; exit 1 ;;
esac
echo 'Demo: http://localhost:5174'
echo 'Tutorial: http://localhost:5174/tutorial.html'
echo 'Allow the facilitator to become ready, then run ./scripts/check.sh.'
