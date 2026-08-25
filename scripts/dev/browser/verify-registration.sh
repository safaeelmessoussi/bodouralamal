#!/usr/bin/env bash
# The registration journey, in a real browser. See the .mjs for why it exists.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }

set -a
# shellcheck disable=SC1091
. ./.env
set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"

# A fresh synthetic identity per run (§15.2 reserved domain), so the run is
# repeatable and leaves one identifiable applicant rather than colliding.
STAMP="$(date +%s)"
export ONBOARDING_EMAIL="reg-verify-${STAMP}@example.com"
export ONBOARDING_TOKEN="$(bash scripts/dev/issue-dev-onboarding.sh "$ONBOARDING_EMAIL" "dev-subject-${STAMP}")"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  # The run creates a REAL pending applicant. A SELF-registration binds the
  # identity and leaves `pre_provisioned_email` NULL — that column belongs to
  # staff pre-provisioning — so the applicant is reachable only through the
  # identity.
  #
  # **The owner id is resolved into a variable FIRST**, before anything is
  # deleted. Keying each statement off a live sub-select made the order
  # load-bearing and the cleanup silently order-dependent: one quoting slip in
  # the `"user"` delete left an applicant behind while the identity that
  # identified it was already gone, and `|| true` hid the failure. Errors are
  # reported now rather than swallowed.
  local sql="docker compose exec -T db psql -U app -d bodour -tAc"
  # `user` is a reserved word, so the table needs its quotes — held in a
  # single-quoted variable so no shell layer can strip or mangle them. Inlining
  # them cost two runs and left an applicant behind each time.
  local USER_TBL='"user"' 
  OWNER_ID="$($sql "SELECT user_id FROM user_identity WHERE email = '${ONBOARDING_EMAIL}';" 2>/dev/null | tr -d '\r ' || true)"

  $sql "DELETE FROM normalized_email_lock WHERE email = '${ONBOARDING_EMAIL}';" >/dev/null || echo "cleanup: lock delete failed" >&2
  $sql "DELETE FROM user_identity WHERE email = '${ONBOARDING_EMAIL}';" >/dev/null || echo "cleanup: identity delete failed" >&2

  if [[ -n "${OWNER_ID:-}" ]]; then
    for stmt in \
      "DELETE FROM audit_log WHERE target_id = '${OWNER_ID}' OR actor_user_id = '${OWNER_ID}';" \
      "DELETE FROM user_branch_role WHERE user_id = '${OWNER_ID}';" \
      "DELETE FROM consent_record WHERE student_id = '${OWNER_ID}';" \
      "DELETE FROM enrollment WHERE student_id = '${OWNER_ID}';" \
      "DELETE FROM ${USER_TBL} WHERE id = '${OWNER_ID}';"
    do
      $sql "$stmt" >/dev/null || echo "cleanup FAILED: $stmt" >&2
    done
    # Prove it, rather than assume it — the whole reason this block was rewritten.
    left="$($sql "SELECT count(*) FROM ${USER_TBL} WHERE id = '${OWNER_ID}';" 2>/dev/null | tr -d '\r ' || echo '?')"
    [[ "$left" == "0" ]] || echo "cleanup LEFT AN APPLICANT BEHIND: ${OWNER_ID}" >&2
  fi
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9241 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!

for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9241/json/list >/dev/null 2>&1 && break
  sleep 0.5
done

PORT=9241 node scripts/dev/browser/verify-registration.mjs
STATUS=$?

# ── The records the journey created, asserted from the database ───────────
echo
echo "-- exactly the intended records, and no duplicates --"
docker compose exec -T db psql -U app -d bodour -c "
WITH owner AS (SELECT user_id FROM user_identity WHERE email = '${ONBOARDING_EMAIL}')
SELECT (SELECT count(*) FROM \"user\" u JOIN owner o ON o.user_id = u.id)          AS users,
       (SELECT count(*) FROM user_identity WHERE email = '${ONBOARDING_EMAIL}')     AS identities,
       (SELECT count(*) FROM normalized_email_lock WHERE email = '${ONBOARDING_EMAIL}') AS email_locks,
       (SELECT u.account_status::text FROM \"user\" u JOIN owner o ON o.user_id = u.id LIMIT 1) AS state;"

exit "$STATUS"
