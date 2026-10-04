#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker run --rm --network cardano-x402-demo_default -v "$PWD/scripts:/scripts:ro" python:3.13-slim python /scripts/smoke.py
