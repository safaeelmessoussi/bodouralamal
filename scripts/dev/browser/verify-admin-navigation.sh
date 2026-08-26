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

# **A REAL Admin, not a widened Super Admin.** `issue-dev-session.ts` mints for
# a named user exactly as they already are — the whole point of its uuid form —
# so this verifies the authorisation an Admin actually holds. Widening a session
# here would verify a session nobody has.
ADMIN_ID="${ADMIN_USER_ID:-$(psql "$DATABASE_URL" -Atc "
  SELECT u.id FROM \"user\" u
  JOIN user_branch_role ubr ON ubr.user_id = u.id
  JOIN role r ON r.id = ubr.role_id
  WHERE u.account_status = 'active'
  GROUP BY u.id
  HAVING bool_or(r.name = 'admin') AND NOT bool_or(r.name = 'super_admin')
  LIMIT 1")}"
[[ -n "$ADMIN_ID" ]] || { echo "SKIP: no Admin-without-Super-Admin user in this database"; exit 0; }

export SUPER_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export ADMIN_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$ADMIN_ID")"
# A second pair, for the direct-API half: R101 rotates the refresh token on use,
# so the browser spends the two above on its first page load.
export SUPER_API_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export ADMIN_API_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$ADMIN_ID")"

WORK="$(mktemp -d)"
cleanup() { [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true; rm -rf "$WORK" 2>/dev/null || true; }
trap cleanup EXIT
"$CHROME" --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9247 \
  --remote-allow-origins='*' --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:9247/json/list >/dev/null 2>&1 && break; sleep 0.5; done

PORT=9247 node scripts/dev/browser/verify-admin-navigation.mjs
