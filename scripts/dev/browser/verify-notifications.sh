#!/usr/bin/env bash
# R82 end to end, as three different people.
#
# Each population is only observable by ASKING as that person, so the harness
# mints a session for the administrator, the concerned beneficiary and an
# unrelated one — `issue-dev-session.sh <id>` grants a named user nothing beyond
# what they already hold, which is what makes a beneficiary's read a
# beneficiary's read.
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
echo "scenario: $R82_SCENARIO"

export ADMIN_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export CONCERNED_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(node -e 'process.stdout.write(JSON.parse(process.env.R82_SCENARIO).concerned)')")"
export UNRELATED_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(node -e 'process.stdout.write(JSON.parse(process.env.R82_SCENARIO).unrelated)')")"

# **A second session per identity, for the UI phase.**
#
# The API phase mints an access token in the page, which ROTATES the refresh
# cookie (TD-4.13). The app then cannot authenticate itself with the copy the
# harness set, and the dashboard sits at «جارٍ التحميل…» — the harness breaking
# the app and reading it as a missing feature. Each phase gets its own session.
export CONCERNED_UI_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(node -e 'process.stdout.write(JSON.parse(process.env.R82_SCENARIO).concerned)')")"
export ADMIN_UI_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export TEACHER_UI_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(node -e 'process.stdout.write(JSON.parse(process.env.R82_SCENARIO).teacher)')")"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  (cd backend && npx tsx scripts/seed-r82-scenario.ts --clean) >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9237 --remote-allow-origins='*' \
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
  curl -sf http://127.0.0.1:9237/json/list >/dev/null 2>&1 && { CHROME_READY=1; break; }
  sleep 0.5
done
if [[ "$CHROME_READY" != "1" ]]; then
  echo "FAIL: Chrome never opened its debug port on 9237"
  exit 1
fi

PORT=9237 node scripts/dev/browser/verify-notifications.mjs
