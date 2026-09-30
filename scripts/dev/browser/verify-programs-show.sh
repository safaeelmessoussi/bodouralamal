#!/usr/bin/env bash
# «برامجنا التعليمية» — the full-screen show walked end to end (R185 §5), at a
# laptop's width and a phone's. Public page: no session, no scenario.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine; the show was not verified"; exit 0; }

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --remote-debugging-port=9235 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
CHROME_READY=0
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9235/json/list >/dev/null 2>&1 && { CHROME_READY=1; break; }
  sleep 0.5
done
if [[ "$CHROME_READY" != "1" ]]; then
  echo "FAIL: Chrome never opened its debug port on 9235"
  exit 1
fi

status=0
for width in 1366 390; do
  echo "── ${width} px"
  PORT=9235 WIDTH="$width" node scripts/dev/browser/verify-programs-show.mjs || status=1
done
exit $status
