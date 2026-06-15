#!/usr/bin/env bash
# Local burn-in — repeat the whole E2E suite to surface flakiness, exactly as the
# CI `burn-in` job does (one server session via --repeat-each, retries forced off
# so a single non-deterministic failure fails the run).
#
# Usage: npm run test:e2e:burn-in        # 10 iterations (default)
#        ./scripts/burn-in.sh 20         # custom iteration count
set -euo pipefail
cd "$(dirname "$0")/.."

COUNT="${1:-10}"
case "$COUNT" in ''|*[!0-9]*) echo "iterations must be a positive integer" >&2; exit 2 ;; esac

echo "🔥 Burn-in: repeating every test ${COUNT}x with retries disabled"
CI=1 npx playwright test --repeat-each="$COUNT" --retries=0
echo "✅ Burn-in clean — no flaky tests detected"
