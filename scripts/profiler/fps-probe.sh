#!/usr/bin/env bash
# Turnkey NFR-1 composed-Scene ~60fps profiler — build, serve, probe, tear down in one
# step. Drives the real bundled `tc-my-home` Scene (?card=my-home) in HEADED Chromium and
# measures sustained rAF cadence under validated CPU throttles. This is the instrumented
# counterpart to the human procedure in docs/profiler-checklist-nfr1.md.
#
# HONEST scope: an in-browser read on THIS workstation (CPU-throttle emulation of a slow
# CPU, dev display) — strong supporting evidence, NOT the physical kiosk. See
# scripts/profiler/README.md and docs/audit-r6-suite.md §AC3.
#
# Usage: npm run profile:nfr1                          # 1x,4x,6x · ~10s steady-state each
#        RATES=1,6 DURATION_MS=15000 npm run profile:nfr1
#
# Needs a real display — headed Chromium for true vsync, so NOT a headless CI box (by
# design: AC3 is a [PROFILER]-class read, never a CI assertion).
set -euo pipefail
cd "$(dirname "$0")/../.."

PORT=4173
URL_PATH="/demo/index.html"
STARTED_SERVER=0

cleanup() {
  # Only tear down a server WE started — never one the user already had on :$PORT.
  if [[ "$STARTED_SERVER" == "1" ]]; then
    PIDS="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$PIDS" ]]; then
      echo "==> stopping demo server on :$PORT"
      # shellcheck disable=SC2086
      kill $PIDS 2>/dev/null || true
    fi
  fi
}
trap cleanup EXIT

echo "==> build (dist/tesla-card.js — the demo imports it)"
npm run build

if lsof -iTCP:"$PORT" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  echo "==> reusing server already listening on :$PORT"
else
  echo "==> starting demo server on :$PORT"
  npm run serve:demo >/dev/null 2>&1 &
  STARTED_SERVER=1
fi

printf '==> waiting for http://127.0.0.1:%s%s ' "$PORT" "$URL_PATH"
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT$URL_PATH" >/dev/null 2>&1; then
    echo "ready"
    break
  fi
  sleep 0.5
  printf '.'
done
if ! curl -fsS "http://127.0.0.1:$PORT$URL_PATH" >/dev/null 2>&1; then
  echo "" >&2
  echo "FAILED — demo server did not come up on :$PORT" >&2
  exit 1
fi

echo "==> profiling the resting Scene (headed Chromium + CDP) — a browser window will open"
node scripts/profiler/fps-probe.mjs

echo "✅ Profiler run complete — artifacts in scripts/profiler/out/ (gitignored)"
