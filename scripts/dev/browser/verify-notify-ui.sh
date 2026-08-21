#!/usr/bin/env bash
# The notification feature, driven the way a person drives it.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }

set -a
# shellcheck disable=SC1091
. ./.env
set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"

export NOTIFY_SCENARIO="$(cd backend && npx tsx scripts/seed-notify-scenario.ts | tail -1)"
id() { node -e "process.stdout.write(JSON.parse(process.env.NOTIFY_SCENARIO).$1)"; }

# **Two sessions for any identity that both drives pages and reads the API.** The
# app refreshes on load and rotates the cookie; a second consumer of the same one
# is what TD-4.13 revokes a session for.
# **One page cookie per Admin page-phase.** The app refreshes on load and
# rotates the cookie, so returning to a screen with the same one renders a
# logged-out shell — an empty table, which reads as "the occurrence is gone".
export ADMIN_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export ADMIN_COOKIE_2="$(bash scripts/dev/issue-dev-session.sh)"
export ADMIN_COOKIE_3="$(bash scripts/dev/issue-dev-session.sh)"
export ADMIN_COOKIE_4="$(bash scripts/dev/issue-dev-session.sh)"
export ADMIN_COOKIE_5="$(bash scripts/dev/issue-dev-session.sh)"
export ADMIN_COOKIE_6="$(bash scripts/dev/issue-dev-session.sh)"
export ADMIN_COOKIE_7="$(bash scripts/dev/issue-dev-session.sh)"
export ADMIN_COOKIE_8="$(bash scripts/dev/issue-dev-session.sh)"
export ADMIN_COOKIE_9="$(bash scripts/dev/issue-dev-session.sh)"
export ADMIN_GRADE_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export ADMIN_EVENT_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export ADMIN_REPUB_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export ADMIN_REPUB2_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export ADMIN_API_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export A_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentA)")"
export A2_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentA)")"
export A3_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentA)")"
export A4_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentA)")"
export A5_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentA)")"
export A6_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentA)")"
export A7_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentA)")"
export A8_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentA)")"
export A9_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentA)")"
export A10_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentA)")"
export A11_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentA)")"
export A12_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentA)")"
export B_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentB)")"
export B2_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentB)")"
export C_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentC)")"
export AMINA_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id amina)")"
export NADIA_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id nadia)")"
export SAFA_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id safa)")"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  (cd backend && npx tsx scripts/seed-notify-scenario.ts --clean) >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9251 --remote-allow-origins='*' \
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
  curl -sf http://127.0.0.1:9251/json/list >/dev/null 2>&1 && { CHROME_READY=1; break; }
  sleep 0.5
done
if [[ "$CHROME_READY" != "1" ]]; then
  echo "FAIL: Chrome never opened its debug port on 9251"
  exit 1
fi

PORT=9251 node scripts/dev/browser/verify-notify-ui.mjs
