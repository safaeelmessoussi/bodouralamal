#!/usr/bin/env bash
# §6 — header sorting clicked in a real browser. See the .mjs.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }
[[ -f .env ]] || { echo "FAIL: .env missing (TD-13)." >&2; exit 1; }
set -a; . ./.env; set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"
export SUPER_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
WORK="$(mktemp -d)"
cleanup() { [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true; rm -rf "$WORK" 2>/dev/null || true; }
trap cleanup EXIT
"$CHROME" --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9251 \
  --remote-allow-origins='*' --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:9251/json/list >/dev/null 2>&1 && break; sleep 0.5; done
PORT=9251 node scripts/dev/browser/verify-sorting-headers.mjs
