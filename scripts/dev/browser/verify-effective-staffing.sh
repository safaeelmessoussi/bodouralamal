#!/usr/bin/env bash
# R91 — effective-dated staffing, driven as Admin, Safa, Amina and an assistant.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }

set -a
# shellcheck disable=SC1091
. ./.env
set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"

export R91_SCENARIO="$(cd backend && npx tsx scripts/seed-r91-scenario.ts | tail -1)"
id() { node -e "process.stdout.write(JSON.parse(process.env.R91_SCENARIO).$1)"; }

# **One session per identity** — a second refresh against a rotated cookie is
# what TD-4.13's reuse detection revokes a session for.
export ADMIN_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export SAFA_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id safa)")"
export AMINA_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id amina)")"
export HELPER_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id helper)")"

# **A second session per identity, for the PAGE phase.** One refresh cookie has
# one consumer: `tokenFor` above rotates the cookie it uses, so loading the app
# with the same one afterwards renders a logged-out shell — which reads as a
# missing menu entry. The trap is recorded in `docs/development/testing.md`; it
# cost this harness two checks that were describing an unauthenticated page.
export SAFA_PAGE_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id safa)")"
export AMINA_PAGE_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id amina)")"
export HELPER_PAGE_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id helper)")"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  (cd backend && npx tsx scripts/seed-r91-scenario.ts --clean) >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9245 --remote-allow-origins='*' \
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
  curl -sf http://127.0.0.1:9245/json/list >/dev/null 2>&1 && { CHROME_READY=1; break; }
  sleep 0.5
done
if [[ "$CHROME_READY" != "1" ]]; then
  echo "FAIL: Chrome never opened its debug port on 9245"
  exit 1
fi

PORT=9245 node scripts/dev/browser/verify-effective-staffing.mjs
