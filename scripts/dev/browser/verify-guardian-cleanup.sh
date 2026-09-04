#!/usr/bin/env bash
# R131 §4.3 — guardian-only cleanup, end to end in a real browser.
# See the .mjs for why this exists at this layer.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }

[[ -f .env ]] || { echo "FAIL: .env missing (TD-13)." >&2; exit 1; }
set -a
# shellcheck disable=SC1091
. ./.env
set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"

STAMP="$(date +%s)"
export ADMIN_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
# **One distinctive TOKEN per account, not a distinctive sentence.** §14.2's
# Users table renders the name in parts across columns, so `innerText` puts a tab
# inside any multi-word name and a whole-name match can never succeed. The token
# is what survives that, and it is why these names look the way they do.
export SPENT_NAME="[gc-verify] وليةمنتهية${STAMP}"
export BUSY_NAME="[gc-verify] وليةقائمة${STAMP}"
CHILD_NAME="[gc-verify] طفلة ${STAMP}"

sql() { docker compose exec -T db psql -U app -d bodour -tAc "$1"; }

mkuser() {  # name, is_beneficiary
  sql "
    INSERT INTO \"user\" (id, sex, name_arabic, account_status, is_beneficiary, created_at, updated_at)
    VALUES (gen_random_uuid(), 'female', '$1', 'active', $2, now(), now())
    RETURNING id;" | head -1 | tr -d '\r '
}

# Two guardians that differ in exactly one fact — whether a live link remains.
# The pair is the point: one must close and one must be refused, and a run that
# only proved the first would pass just as well if the guard did nothing.
SPENT_ID="$(mkuser "$SPENT_NAME" false)"
BUSY_ID="$(mkuser "$BUSY_NAME" false)"
CHILD_ID="$(mkuser "$CHILD_NAME" true)"
for id in "$SPENT_ID" "$BUSY_ID" "$CHILD_ID"; do
  [[ -n "$id" ]] || { echo "FAIL: could not create the scenario accounts" >&2; exit 1; }
done

# The spent guardian's only link is withdrawn; the busy one's is live.
sql "INSERT INTO family_link (id, parent_id, student_id, status, decided_at, deleted_at, created_at)
     VALUES (gen_random_uuid(), '${SPENT_ID}', '${CHILD_ID}', 'rejected', now(), now(), now());" >/dev/null
sql "INSERT INTO family_link (id, parent_id, student_id, status, decided_at, created_at)
     VALUES (gen_random_uuid(), '${BUSY_ID}', '${CHILD_ID}', 'approved', now(), now());" >/dev/null

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  # Ordered by dependency, and each failure is reported rather than swallowed —
  # a cleanup that hides its own errors leaves rows for the next run to trip on.
  for stmt in \
    "DELETE FROM family_link WHERE parent_id IN ('${SPENT_ID}','${BUSY_ID}') OR student_id = '${CHILD_ID}';" \
    "DELETE FROM trash WHERE target_id IN ('${SPENT_ID}','${BUSY_ID}','${CHILD_ID}') OR deleted_by IN ('${SPENT_ID}','${BUSY_ID}','${CHILD_ID}');" \
    "DELETE FROM refresh_token WHERE user_id IN ('${SPENT_ID}','${BUSY_ID}','${CHILD_ID}');" \
    "DELETE FROM refresh_session WHERE user_id IN ('${SPENT_ID}','${BUSY_ID}','${CHILD_ID}');" \
    "DELETE FROM notification WHERE user_id IN ('${SPENT_ID}','${BUSY_ID}','${CHILD_ID}') OR subject_user_id IN ('${SPENT_ID}','${BUSY_ID}','${CHILD_ID}');" \
    "DELETE FROM audit_log WHERE target_id IN ('${SPENT_ID}','${BUSY_ID}','${CHILD_ID}') OR actor_user_id IN ('${SPENT_ID}','${BUSY_ID}','${CHILD_ID}');" \
    "DELETE FROM \"user\" WHERE id IN ('${SPENT_ID}','${BUSY_ID}','${CHILD_ID}');"
  do
    sql "$stmt" >/dev/null || echo "cleanup FAILED: $stmt" >&2
  done
  left="$(sql "SELECT count(*) FROM \"user\" WHERE name_arabic LIKE '[gc-verify]%';" 2>/dev/null | tr -d '\r ' || echo '?')"
  [[ "$left" == "0" ]] || echo "cleanup LEFT ${left} ACCOUNT(S) BEHIND" >&2
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9244 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9244/json/list >/dev/null 2>&1 && break
  sleep 0.5
done

PORT=9244 node scripts/dev/browser/verify-guardian-cleanup.mjs
STATUS=$?

# ── What the journey actually wrote, asserted from the database ───────────
echo
echo "-- the spent guardian CLOSED, the busy one UNTOUCHED, the child intact --"
sql "
SELECT 'spent_closed='  || (SELECT count(*) FROM \"user\" WHERE id = '${SPENT_ID}' AND deleted_at IS NOT NULL)
    || ' busy_closed='  || (SELECT count(*) FROM \"user\" WHERE id = '${BUSY_ID}'  AND deleted_at IS NOT NULL)
    || ' child_live='   || (SELECT count(*) FROM \"user\" WHERE id = '${CHILD_ID}' AND deleted_at IS NULL)
    || ' decisions='    || (SELECT count(*) FROM audit_log WHERE action_type = 'user.close_guardian_only' AND target_id = '${SPENT_ID}');"

exit "$STATUS"
