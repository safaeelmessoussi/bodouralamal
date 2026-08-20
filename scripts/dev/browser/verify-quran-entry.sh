#!/usr/bin/env bash
# Section C — إدخال الحفظ driven through the real screens, as nine identities.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }

set -a
# shellcheck disable=SC1091
. ./.env
set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"

export QURAN_SCENARIO="$(cd backend && npx tsx scripts/seed-quran-scenario.ts | tail -1)"
id() { node -e "process.stdout.write(JSON.parse(process.env.QURAN_SCENARIO).$1)"; }

# One session per identity — the app rotates the refresh cookie on load, and
# reusing one for a second mint is what TD-4.13 revokes a session for.
export ADMIN_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export HAFSA_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id hafsa)")"
export SALMA_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id salma)")"
export NAWAL_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id nawal)")"
export HOUDA_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id houda)")"
export SAMIRA_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id samira)")"
export LATIFA_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id latifa)")"
export RAJAA_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id rajaa)")"
export SAFA_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id safa)")"
export AMINA_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id amina)")"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  (cd backend && npx tsx scripts/seed-quran-scenario.ts --clean) >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9251 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!

for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:9251/json/list >/dev/null 2>&1 && break
  sleep 0.3
done

PORT=9251 node scripts/dev/browser/verify-quran-entry.mjs
