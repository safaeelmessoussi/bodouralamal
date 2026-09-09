#!/usr/bin/env bash
# Drives the installed Chrome to measure the R138 item 8 sidebar toggle — the
# collapsed/overlay states — at mobile and desktop widths. See the .mjs.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CSS="$(ls -t frontend/dist/assets/*.css 2>/dev/null | head -1 || true)"
[[ -n "$CSS" ]] || { echo "FAIL: no built CSS — run: npm --prefix frontend run build"; exit 1; }

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine; nav toggle geometry not measured"; exit 0; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true' EXIT
sed "s|APP_CSS|file://$PWD/$CSS|" scripts/dev/browser/nav-toggle-harness.html > "$WORK/harness.html"

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9223 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!

CHROME_READY=0
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9223/json/list >/dev/null 2>&1 && { CHROME_READY=1; break; }
  sleep 0.5
done
if [[ "$CHROME_READY" != "1" ]]; then
  echo "FAIL: Chrome never opened its debug port on 9223"
  exit 1
fi

node scripts/dev/browser/verify-nav-toggle-geometry.mjs "file://$WORK/harness.html"
