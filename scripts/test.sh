#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker run --rm -v "$PWD:/workspace" -w /workspace/resource-server -v x402-gradle-cache:/root/.gradle eclipse-temurin:21-jdk ./gradlew --no-daemon test
docker run --rm -v "$PWD:/workspace" -w /workspace/frontend node:22-bookworm-slim sh -c 'npm ci --no-audit --no-fund && npm test && npm run build'
