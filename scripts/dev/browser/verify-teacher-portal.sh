#!/usr/bin/env bash
# The مؤطِّرة's portal (R106) — her menu as it renders, and the server behind it.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }
[[ -f .env ]] || { echo "FAIL: .env missing (TD-13)." >&2; exit 1; }
set -a; . ./.env; set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"

# A REAL teacher — minted as she already is, never widened.
TEACHER_ID="${TEACHER_USER_ID:-$(psql "$DATABASE_URL" -Atc "
  SELECT u.id FROM \"user\" u
  JOIN user_branch_role ubr ON ubr.user_id = u.id
  JOIN role r ON r.id = ubr.role_id
  WHERE u.account_status = 'active' AND u.deleted_at IS NULL
  GROUP BY u.id
  HAVING bool_or(r.name = 'teacher')
     AND NOT bool_or(r.name IN ('admin','super_admin'))
  LIMIT 1")}"
[[ -n "$TEACHER_ID" ]] || { echo "SKIP: no teacher-only user in this database"; exit 0; }

ADMIN_ID="$(psql "$DATABASE_URL" -Atc "
  SELECT u.id FROM \"user\" u
  JOIN user_branch_role ubr ON ubr.user_id = u.id
  JOIN role r ON r.id = ubr.role_id
  WHERE u.account_status = 'active'
  GROUP BY u.id
  HAVING bool_or(r.name = 'admin') AND NOT bool_or(r.name = 'super_admin')
  LIMIT 1")"

# Two sessions per identity: R101 rotates the refresh token, so the browser
# spends its cookie on the first page load and the API probes need their own.
export TEACHER_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$TEACHER_ID")"
export TEACHER_API_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$TEACHER_ID")"
[[ -n "$ADMIN_ID" ]] && export ADMIN_API_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$ADMIN_ID")"

WORK="$(mktemp -d)"
cleanup() { [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true; rm -rf "$WORK" 2>/dev/null || true; }
trap cleanup EXIT
"$CHROME" --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9249 \
  --remote-allow-origins='*' --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:9249/json/list >/dev/null 2>&1 && break; sleep 0.5; done

PORT=9249 node scripts/dev/browser/verify-teacher-portal.mjs
