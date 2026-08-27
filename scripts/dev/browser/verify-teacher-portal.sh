#!/usr/bin/env bash
# The مؤطِّرة's portal (R106) — her menu as it renders, and the server behind it.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }
[[ -f .env ]] || { echo "FAIL: .env missing (TD-13)." >&2; exit 1; }
set -a; . ./.env; set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"

# The API half writes availability and mints refresh/audit state. Give it people
# the harness owns instead of mutating whichever development Teacher/Admin is
# returned first. The scenario cleaner removes all of those rows in the trap,
# even when Chrome or an assertion fails.
export R82_SCENARIO="$(cd backend && npx tsx scripts/seed-r82-scenario.ts | tail -1)"
scenario_id() { node -e "process.stdout.write(JSON.parse(process.env.R82_SCENARIO).$1)"; }
TEACHER_ID="$(scenario_id teacher)"
ADMIN_ID="$(scenario_id admin)"

# Two sessions per identity: R101 rotates the refresh token, so the browser
# spends its cookie on the first page load and the API probes need their own.
export TEACHER_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$TEACHER_ID")"
export TEACHER_API_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$TEACHER_ID")"
[[ -n "$ADMIN_ID" ]] && export ADMIN_API_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$ADMIN_ID")"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  (cd backend && npx tsx scripts/seed-r82-scenario.ts --clean) >/dev/null 2>&1 || true
}
trap cleanup EXIT
"$CHROME" --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9249 \
  --remote-allow-origins='*' --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:9249/json/list >/dev/null 2>&1 && break; sleep 0.5; done

PORT=9249 node scripts/dev/browser/verify-teacher-portal.mjs
