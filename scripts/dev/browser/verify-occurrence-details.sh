#!/usr/bin/env bash
# One occurrence-details dialog, opened from all four calendars.
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
id() { node -e "process.stdout.write(JSON.parse(process.env.R82_SCENARIO).$1)"; }

export ADMIN_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export TEACHER_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id teacher)")"
export STUDENT_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id concerned)")"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  (cd backend && npx tsx scripts/seed-r82-scenario.ts --clean) >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9255 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!

for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:9255/json/list >/dev/null 2>&1 && break
  sleep 0.3
done

PORT=9255 node scripts/dev/browser/verify-occurrence-details.mjs
