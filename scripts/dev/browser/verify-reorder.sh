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

for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:9223/json/list >/dev/null 2>&1 && break
  sleep 0.3
done

node scripts/dev/browser/verify-reorder.mjs
