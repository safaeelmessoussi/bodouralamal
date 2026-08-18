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
  --remote-debugging-port=9230 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!

for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:9230/json/list >/dev/null 2>&1 && break
  sleep 0.3
done

PORT=9230 node scripts/dev/browser/verify-public-calendar.mjs
