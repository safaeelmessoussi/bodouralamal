#!/usr/bin/env bash
# Drives the installed Chrome over the R75 recorder with a REAL MediaRecorder.
#
# `--use-fake-device-for-media-capture` supplies a synthetic microphone to
# getUserMedia; the MediaRecorder, the encoding, the container and the upload
# are all the real ones. `--use-fake-ui-for-media-stream` answers the permission
# prompt, which is the only part a headless browser cannot click — the
# permission is still requested exactly as it is in a person's browser.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine; the recorder was not verified"; exit 0; }

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
  --use-fake-device-for-media-capture --use-fake-ui-for-media-stream \
  --autoplay-policy=no-user-gesture-required \
  --remote-debugging-port=9236 --remote-allow-origins='*' \
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
  curl -sf http://127.0.0.1:9236/json/list >/dev/null 2>&1 && { CHROME_READY=1; break; }
  sleep 0.5
done
if [[ "$CHROME_READY" != "1" ]]; then
  echo "FAIL: Chrome never opened its debug port on 9236"
  exit 1
fi

PORT=9236 node scripts/dev/browser/verify-calendar-filters.mjs
