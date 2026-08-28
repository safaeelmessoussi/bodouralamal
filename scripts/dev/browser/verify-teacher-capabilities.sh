#!/usr/bin/env bash
# A مؤطِّرة edits her own المواد/الفئات — and still holds no authority by it.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }
set -a; . ./.env; set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"
# The harness owns its people — never whichever development Teacher comes first.
export R82_SCENARIO="$(cd backend && npx tsx scripts/seed-r82-scenario.ts | tail -1)"
TEACHER_ID="$(node -e "process.stdout.write(JSON.parse(process.env.R82_SCENARIO).teacher)")"
export TEACHER_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$TEACHER_ID")"
# Two sessions: R101 rotates, so the browser spends the first on page loads.
export TEACHER_API_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$TEACHER_ID")"
WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  (cd backend && npx tsx scripts/seed-r82-scenario.ts --clean) >/dev/null 2>&1 || true
}
trap cleanup EXIT
"$CHROME" --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9256 \
  --remote-allow-origins='*' --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:9256/json/list >/dev/null 2>&1 && break; sleep 0.5; done
PORT=9256 node scripts/dev/browser/verify-teacher-capabilities.mjs
