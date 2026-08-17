#!/usr/bin/env bash
# Drives the installed Chrome to measure the shared page header at nine widths.
# See measure-page-header.mjs for why this is a script rather than a test.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CSS="$(ls -t frontend/dist/assets/*.css 2>/dev/null | head -1 || true)"
[[ -n "$CSS" ]] || { echo "FAIL: no built CSS — run: npm --prefix frontend run build"; exit 1; }

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine; header layout not measured"; exit 0; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true' EXIT
sed "s|APP_CSS|file://$PWD/$CSS|" scripts/dev/browser/header-harness.html > "$WORK/harness.html"

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9222 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!

for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:9222/json/list >/dev/null 2>&1 && break
  sleep 0.3
done

node scripts/dev/browser/measure-page-header.mjs "file://$WORK/harness.html"
