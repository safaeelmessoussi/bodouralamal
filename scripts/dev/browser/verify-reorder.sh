#!/usr/bin/env bash
# Drives the installed Chrome over the real admin screens to verify R76's
# sorting and manual ordering. See verify-reorder.mjs for what it asserts and
# why the session it uses is a real one rather than a bypass.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine; R76 surfaces not measured"; exit 0; }

DEV_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export DEV_REFRESH_COOKIE

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true' EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9223 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!

# Wait for Chrome, and fail loudly if it never opens the port.
#
# This was 30 x 0.3s = 9 seconds. The dev overlay now also runs an Egress
# worker with its own headless Chrome, and under that contention a harness
# could reach connect() before the port existed, throw an unhelpful JSON
# error, and be recorded by a sweep as NO RESULT — indistinguishable from a
# harness that genuinely proved nothing.
CHROME_READY=0
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9223/json/list >/dev/null 2>&1 && { CHROME_READY=1; break; }
  sleep 0.5
done
if [[ "$CHROME_READY" != "1" ]]; then
  echo "FAIL: Chrome never opened its debug port on 9223"
  exit 1
fi

node scripts/dev/browser/verify-reorder.mjs
