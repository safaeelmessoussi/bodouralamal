#!/usr/bin/env bash
# The merged Teacher calendar/scheduling surface, and responsible=self.
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

export SAFA_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id safa)")"
export SAFA2_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id safa)")"
export SAFA_API_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id safa)")"
export AMINA_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id amina)")"
export AMINA2_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id amina)")"
export AMINA3_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id amina)")"
export SAFA3_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id safa)")"
export SAFA4_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id safa)")"
export NADIA_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id nadia)")"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  (cd backend && npx tsx scripts/seed-notify-scenario.ts --clean) >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9253 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!

for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:9253/json/list >/dev/null 2>&1 && break
  sleep 0.3
done

PORT=9253 node scripts/dev/browser/verify-teacher-scheduling.mjs
