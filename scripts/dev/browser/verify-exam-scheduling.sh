#!/usr/bin/env bash
# R136 frontend-completion — content-only exam creation, the ?kind=exam&new=1
# and ?source=&mode= scheduler prefills, and authored/bare physical scheduling,
# on the real pages. See verify-exam-scheduling.mjs.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }
set -a; . ./.env; set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"
WORK="$(mktemp -d)"

cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  # **Every row this run made, it made through `seed-assessment-scenario.ts`'s
  # own `[asmguard]` tag** (P1.2) — including the exams the harness itself
  # authored and scheduled, which share the same title prefix, so the
  # script's existing `wipe()` sweeps exactly those and nothing else.
  (cd backend && npx tsx scripts/seed-assessment-scenario.ts --clean) >/dev/null 2>&1 || true
}
trap cleanup EXIT

export SCENARIO="$(cd backend && npx tsx scripts/seed-assessment-scenario.ts | tail -1)"
export SUPER_API_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"

"$CHROME" --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9262 \
  --remote-allow-origins='*' --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!

CHROME_READY=0
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9262/json/list >/dev/null 2>&1 && { CHROME_READY=1; break; }
  sleep 0.5
done
if [[ "$CHROME_READY" != "1" ]]; then
  echo "FAIL: Chrome never opened its debug port on 9262"
  exit 1
fi

PORT=9262 node scripts/dev/browser/verify-exam-scheduling.mjs
