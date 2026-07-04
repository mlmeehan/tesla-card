#!/usr/bin/env bash
# Mirror the CI quality gate locally before pushing — runs the exact commands CI
# runs (validate.yml `build` job + test.yml `lint`/`test` jobs), in order.
# `CI=1` makes Playwright match CI behaviour (retries:2, workers:2, forbidOnly).
#
# Usage: npm run ci:local   (or ./scripts/ci-local.sh)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> npm ci"
npm ci

echo "==> typecheck (bundle)"
npm run typecheck

echo "==> typecheck:e2e"
npm run typecheck:e2e

echo "==> lint (structural gates: no-bare-hass.states + no-cycle + trade-dress + import-allowlist + no-network-egress)"
npm run lint

echo "==> test:census (test-count / e2e-spec-file inventory vs tests/test-census.json)"
npm run test:census

echo "==> build + bundle-exists check"
npm run build
test -s dist/tesla-card.js
echo "    dist/tesla-card.js OK"

echo "==> e2e (CI mode)"
CI=1 npm run test:e2e

echo "✅ Local CI gate passed"
