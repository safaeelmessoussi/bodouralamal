#!/usr/bin/env bash
# The error experience, where only a browser can answer. See the .mjs.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }
WORK="$(mktemp -d)"
cleanup() { [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true; rm -rf "$WORK" 2>/dev/null || true; }
trap cleanup EXIT
"$CHROME" --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9245 \
  --remote-allow-origins='*' --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:9245/json/list >/dev/null 2>&1 && break; sleep 0.5; done
# **Which edge is this?** docker-compose.dev.yml substitutes permissive rate
# zones (auth 6000r/m against production's 10r/m) so the integration suite is
# not throttled. Under it a 25-request burst cannot trip the limiter, and a
# harness asserting 429 would be asserting something the environment has
# deliberately disabled. Detected here rather than guessed in the page, and the
# assertion adapts instead of failing for the wrong reason.
if docker compose ps --format '{{.Service}}' 2>/dev/null | grep -q '^nginx$' &&
   docker inspect "$(docker compose ps -q nginx 2>/dev/null)" 2>/dev/null |
     grep -q 'rate-limits.dev.conf'; then
  export EDGE_RATE_LIMITS=dev
else
  export EDGE_RATE_LIMITS=production
fi

PORT=9245 node scripts/dev/browser/verify-error-experience.mjs
