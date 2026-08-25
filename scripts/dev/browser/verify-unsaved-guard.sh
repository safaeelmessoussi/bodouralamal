#!/usr/bin/env bash
# Unsaved-changes protection, both halves. See the .mjs for the scenario.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }
set -a; . ./.env; set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"
export DEV_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
WORK="$(mktemp -d)"
cleanup() { [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true; rm -rf "$WORK" 2>/dev/null || true; }
trap cleanup EXIT
"$CHROME" --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9243 \
  --remote-allow-origins='*' --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:9243/json/list >/dev/null 2>&1 && break; sleep 0.5; done
PORT=9243 node scripts/dev/browser/verify-unsaved-guard.mjs
