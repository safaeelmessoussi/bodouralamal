#!/usr/bin/env bash
# R92 — one occurrence, two branches, driven through the real screens.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }

set -a
# shellcheck disable=SC1091
. ./.env
set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"

export R92_SCENARIO="$(cd backend && npx tsx scripts/seed-r92-scenario.ts | tail -1)"
id() { node -e "process.stdout.write(JSON.parse(process.env.R92_SCENARIO).$1)"; }

# One session per identity per PHASE — the app rotates the refresh cookie on
# load, and reusing it for an API mint is what TD-4.13 revokes a session for.
export ADMIN_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export A_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentA)")"
export B_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentB)")"
export C_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentC)")"
export AMINA_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id amina)")"
export SAFA_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id safa)")"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  (cd backend && npx tsx scripts/seed-r92-scenario.ts --clean) >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9249 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!

for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:9249/json/list >/dev/null 2>&1 && break
  sleep 0.3
done

PORT=9249 node scripts/dev/browser/verify-cross-branch.mjs
