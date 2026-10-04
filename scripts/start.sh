#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose up -d --build
echo 'Demo: http://localhost:5174'
echo 'Tutorial: http://localhost:5174/tutorial.html'
echo 'Allow the facilitator to become ready, then run ./scripts/check.sh.'
