#!/usr/bin/env bash
# R132 — a beneficiary claims her own account, end to end in a real browser.
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
export ONBOARDING_EMAIL="smc-verify-${STAMP}@example.com"
export ONBOARDING_SUBJECT="smc-subject-${STAMP}"
export ONBOARDING_TOKEN="$(bash scripts/dev/issue-dev-onboarding.sh "$ONBOARDING_EMAIL" "$ONBOARDING_SUBJECT")"
export ADMIN_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export REFERENCE_CODE="BA-V${STAMP: -4}"

sql() { docker compose exec -T db psql -U app -d bodour -tAc "$1"; }

# The scenario's own beneficiary: a login-less record, twenty years old, with a
# reference code — exactly the person this feature exists for. Created here
# rather than reused from the seed so the run owns everything it touches.
BENEFICIARY_ID="$(sql "
  INSERT INTO \"user\" (id, sex, name_arabic, account_status, is_beneficiary, reference_code, birth_date, created_at, updated_at)
  VALUES (gen_random_uuid(), 'female', '[smc-verify] مستفيدة بالغة', 'active', true, '${REFERENCE_CODE}',
          (CURRENT_DATE - INTERVAL '20 years')::date, now(), now())
  RETURNING id;" | head -1 | tr -d '\r ')"
[[ -n "$BENEFICIARY_ID" ]] || { echo "FAIL: could not create the scenario beneficiary" >&2; exit 1; }

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  # Ordered by dependency, and each failure is reported rather than swallowed —
  # a cleanup that hides its own errors leaves rows for the next run to trip on.
  for stmt in \
    "DELETE FROM audit_log WHERE target_id IN (SELECT id::text::uuid FROM self_managed_claim WHERE beneficiary_id = '${BENEFICIARY_ID}');" \
    "DELETE FROM self_managed_claim WHERE beneficiary_id = '${BENEFICIARY_ID}';" \
    "DELETE FROM user_identity WHERE user_id = '${BENEFICIARY_ID}' OR email = '${ONBOARDING_EMAIL}';" \
    "DELETE FROM normalized_email_lock WHERE email = '${ONBOARDING_EMAIL}';" \
    "DELETE FROM audit_log WHERE target_id = '${BENEFICIARY_ID}' OR actor_user_id = '${BENEFICIARY_ID}';" \
    "DELETE FROM \"user\" WHERE id = '${BENEFICIARY_ID}';"
  do
    sql "$stmt" >/dev/null || echo "cleanup FAILED: $stmt" >&2
  done
  left="$(sql "SELECT count(*) FROM \"user\" WHERE id = '${BENEFICIARY_ID}';" 2>/dev/null | tr -d '\r ' || echo '?')"
  [[ "$left" == "0" ]] || echo "cleanup LEFT A BENEFICIARY BEHIND: ${BENEFICIARY_ID}" >&2
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9243 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9243/json/list >/dev/null 2>&1 && break
  sleep 0.5
done

PORT=9243 node scripts/dev/browser/verify-self-managed-claim.mjs
STATUS=$?

# ── What the journey actually wrote, asserted from the database ───────────
echo
echo "-- a PENDING claim, and NOTHING bound --"
sql "
SELECT 'claims='   || (SELECT count(*) FROM self_managed_claim WHERE beneficiary_id = '${BENEFICIARY_ID}')
    || ' pending=' || (SELECT count(*) FROM self_managed_claim WHERE beneficiary_id = '${BENEFICIARY_ID}' AND status = 'pending')
    || ' identities=' || (SELECT count(*) FROM user_identity WHERE user_id = '${BENEFICIARY_ID}')
    || ' users_with_that_email=' || (SELECT count(*) FROM user_identity WHERE email = '${ONBOARDING_EMAIL}');"

exit "$STATUS"
