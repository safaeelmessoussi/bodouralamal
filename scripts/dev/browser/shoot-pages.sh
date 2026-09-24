#!/usr/bin/env bash
# design.mmd §13 — renders the key surfaces at 390 px and 1366 px into PNGs so a
# styling change is looked at before it ships. Public pages always; the signed-in
# ones when the dev scenario and a dev session can be issued.
#
#   bash scripts/dev/browser/shoot-pages.sh [out-dir]   (default: scratch/shots)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
OUT="${1:-scratch/shots}"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine; nothing was rendered"; exit 0; }

export SCENARIO="$(bash scripts/dev/seed-dev-scenario.sh 2>/dev/null | tail -1 || true)"
export DEV_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh 2>/dev/null || true)"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  bash scripts/dev/seed-dev-scenario.sh --clean >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --remote-debugging-port=9241 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9241/json/list >/dev/null 2>&1 && break
  sleep 0.5
done

node scripts/dev/browser/shoot-pages.mjs 9241 "$OUT"
echo "shots in $OUT"
