#!/usr/bin/env bash
# Landing-page and /auth/google behavior in both session states. See the .mjs
# for the properties and why a browser.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }

set -a
# shellcheck disable=SC1091
. ./.env
set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"

TAG="[auth-login-verify]"
WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  docker compose exec -T db psql -U app -d bodour -tAc "
    DELETE FROM refresh_token WHERE user_id IN (SELECT id FROM \"user\" WHERE name_arabic LIKE '${TAG}%');
    DELETE FROM user_branch_role WHERE user_id IN (SELECT id FROM \"user\" WHERE name_arabic LIKE '${TAG}%');
    DELETE FROM audit_log WHERE actor_user_id IN (SELECT id FROM \"user\" WHERE name_arabic LIKE '${TAG}%')
       OR target_id IN (SELECT id FROM \"user\" WHERE name_arabic LIKE '${TAG}%');
    DELETE FROM \"user\" WHERE name_arabic LIKE '${TAG}%';
  " >/dev/null 2>&1 || true
}
trap cleanup EXIT

# A real session per identity, minted through the service directly (issuing a
# session is not a business action under test here — the point is what
# /auth/google does with one that already exists).
SCENARIO_JSON="$(cd backend && npx tsx scripts/seed-auth-login-scenario.ts 2>/dev/null | tail -1)"
[[ -n "$SCENARIO_JSON" ]] || { echo "FAIL: could not mint the test sessions"; exit 1; }
export AUTH_SCENARIO="$SCENARIO_JSON"

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9255 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!

CHROME_READY=0
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9255/json/list >/dev/null 2>&1 && { CHROME_READY=1; break; }
  sleep 0.5
done
[[ "$CHROME_READY" == "1" ]] || { echo "FAIL: Chrome never opened its debug port on 9255"; exit 1; }

PORT=9255 node scripts/dev/browser/verify-authenticated-login.mjs
