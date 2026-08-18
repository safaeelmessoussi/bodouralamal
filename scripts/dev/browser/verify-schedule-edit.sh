#!/usr/bin/env bash
# Drives the installed Chrome over «تعديل العنصر» on the real scheduling screen.
# See verify-schedule-edit.mjs for the defect it exists for.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine; the edit flow was not verified"; exit 0; }

export SCENARIO="$(bash scripts/dev/seed-dev-scenario.sh | tail -1)"
export DEV_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  bash scripts/dev/seed-dev-scenario.sh --clean >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9225 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!

for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:9225/json/list >/dev/null 2>&1 && break
  sleep 0.3
done

PORT=9225 node scripts/dev/browser/verify-schedule-edit.mjs
