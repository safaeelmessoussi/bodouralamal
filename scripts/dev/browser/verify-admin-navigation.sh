#!/usr/bin/env bash
# §14.1's back-office navigation (R105) — and the server-side boundary behind
# it, which is the half a menu check cannot see. See the .mjs.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }

[[ -f .env ]] || { echo "FAIL: .env missing (TD-13)." >&2; exit 1; }
set -a; . ./.env; set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"

# Exact scenario-owned identities and catalogue coordinates. Negative write
# probes must remain clean even when the authorization they test regresses.
export R82_SCENARIO="$(cd backend && npx tsx scripts/seed-r82-scenario.ts | tail -1)"
scenario_id() { node -e "process.stdout.write(JSON.parse(process.env.R82_SCENARIO).$1)"; }
ADMIN_ID="$(scenario_id admin)"
SUPER_ADMIN_ID="$(scenario_id superAdmin)"

export SUPER_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$SUPER_ADMIN_ID")"
export ADMIN_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$ADMIN_ID")"
# A second pair, for the direct-API half: R101 rotates the refresh token on use,
# so the browser spends the two above on its first page load.
export SUPER_API_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$SUPER_ADMIN_ID")"
export ADMIN_API_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$ADMIN_ID")"
# The browser lifecycle proof logs out and then signs in again. Rotation makes
# the original browser cookie single-use, so this is a separate real session,
# not a replay of an already-spent credential.
export ADMIN_RELOGIN_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$ADMIN_ID")"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  (cd backend && npx tsx scripts/seed-r82-scenario.ts --clean) >/dev/null 2>&1 || true
}
trap cleanup EXIT
"$CHROME" --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9247 \
  --remote-allow-origins='*' --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:9247/json/list >/dev/null 2>&1 && break; sleep 0.5; done

PORT=9247 node scripts/dev/browser/verify-admin-navigation.mjs
