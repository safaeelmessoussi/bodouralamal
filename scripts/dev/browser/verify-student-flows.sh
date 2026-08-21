#!/usr/bin/env bash
# R84 — the calendar contract on every surface, asked as the right person.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }

set -a
# shellcheck disable=SC1091
. ./.env
set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"

export R82_SCENARIO="$(cd backend && npx tsx scripts/seed-r82-scenario.ts | tail -1)"
export ADMIN_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export STUDENT_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(node -e 'process.stdout.write(JSON.parse(process.env.R82_SCENARIO).concerned)')")"
export TEACHER_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(node -e 'process.stdout.write(JSON.parse(process.env.R82_SCENARIO).teacher)')")"
export UNRELATED_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(node -e 'process.stdout.write(JSON.parse(process.env.R82_SCENARIO).unrelated)')")"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  (cd backend && npx tsx scripts/seed-r82-scenario.ts --clean) >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9240 --remote-allow-origins='*' \
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
  curl -sf http://127.0.0.1:9240/json/list >/dev/null 2>&1 && { CHROME_READY=1; break; }
  sleep 0.5
done
if [[ "$CHROME_READY" != "1" ]]; then
  echo "FAIL: Chrome never opened its debug port on 9240"
  exit 1
fi

PORT=9240 node scripts/dev/browser/verify-student-flows.mjs
