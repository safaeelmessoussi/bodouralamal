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

for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:9237/json/list >/dev/null 2>&1 && break
  sleep 0.3
done

PORT=9237 node scripts/dev/browser/verify-notifications.mjs
