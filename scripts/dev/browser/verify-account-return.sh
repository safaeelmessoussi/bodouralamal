#!/usr/bin/env bash
# The returning former beneficiary, end to end in a real browser
# (Owner decision, 2026-09-04). See the .mjs for why this exists at this layer.
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
export ONBOARDING_EMAIL="ret-verify-${STAMP}@example.com"
export ONBOARDING_SUBJECT="ret-subject-${STAMP}"
export ONBOARDING_TOKEN="$(bash scripts/dev/issue-dev-onboarding.sh "$ONBOARDING_EMAIL" "$ONBOARDING_SUBJECT")"
export ADMIN_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export REFERENCE_CODE="BA-V${STAMP: -4}"

sql() { docker compose exec -T db psql -U app -d bodour -tAc "$1"; }

# The scenario's own archived beneficiary: CLOSED, with her reference code
# preserved exactly as Option A leaves it, and no birth date — which is why this
# flow cannot reuse R132's claim, and why the fixture models it that way.
SUBJECT_ID="$(sql "
  INSERT INTO \"user\" (id, sex, name_arabic, account_status, is_beneficiary, reference_code,
                       created_at, updated_at, deleted_at)
  VALUES (gen_random_uuid(), 'female', 'حساب محذوف', 'active', true, '${REFERENCE_CODE}',
          now(), now(), now())
  RETURNING id;" | head -1 | tr -d '\r ')"
[[ -n "$SUBJECT_ID" ]] || { echo "FAIL: could not create the archived beneficiary" >&2; exit 1; }

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  # Ordered by dependency, and each failure is reported rather than swallowed.
  for stmt in \
    "DELETE FROM audit_log WHERE target_id IN (SELECT id FROM account_return_request WHERE subject_id = '${SUBJECT_ID}');" \
    "DELETE FROM account_return_request WHERE subject_id = '${SUBJECT_ID}';" \
    "DELETE FROM self_managed_claim WHERE beneficiary_id = '${SUBJECT_ID}';" \
    "DELETE FROM user_identity WHERE user_id = '${SUBJECT_ID}' OR email = '${ONBOARDING_EMAIL}';" \
    "DELETE FROM normalized_email_lock WHERE email = '${ONBOARDING_EMAIL}';" \
    "DELETE FROM audit_log WHERE target_id = '${SUBJECT_ID}' OR actor_user_id = '${SUBJECT_ID}';" \
    "DELETE FROM \"user\" WHERE id = '${SUBJECT_ID}';"
  do
    sql "$stmt" >/dev/null || echo "cleanup FAILED: $stmt" >&2
  done
  left="$(sql "SELECT count(*) FROM \"user\" WHERE id = '${SUBJECT_ID}';" 2>/dev/null | tr -d '\r ' || echo '?')"
  [[ "$left" == "0" ]] || echo "cleanup LEFT THE SUBJECT BEHIND: ${SUBJECT_ID}" >&2
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9247 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9247/json/list >/dev/null 2>&1 && break
  sleep 0.5
done

PORT=9247 node scripts/dev/browser/verify-account-return.mjs
STATUS=$?

# ── What the journey actually wrote, asserted from the database ───────────
echo
echo "-- the SAME account reopened, one identity bound, no duplicate person --"
sql "
SELECT 'reopened='    || (SELECT count(*) FROM \"user\" WHERE id = '${SUBJECT_ID}' AND deleted_at IS NULL)
    || ' identities=' || (SELECT count(*) FROM user_identity WHERE user_id = '${SUBJECT_ID}')
    || ' code_kept='  || (SELECT count(*) FROM \"user\" WHERE id = '${SUBJECT_ID}' AND reference_code = '${REFERENCE_CODE}')
    || ' duplicates=' || (SELECT count(*) FROM user_identity WHERE email = '${ONBOARDING_EMAIL}')
    || ' self_managed=' || (SELECT count(*) FROM self_managed_claim WHERE beneficiary_id = '${SUBJECT_ID}' AND status = 'approved')
    || ' approved='   || (SELECT count(*) FROM account_return_request WHERE subject_id = '${SUBJECT_ID}' AND status = 'approved');"

exit "$STATUS"
