#!/usr/bin/env bash
# Drives the installed Chrome over SRS Revision 168 §1: one registration form,
# four roles, each decided on its own. See verify-role-requests.mjs for what only
# a browser can show.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine; the registration roles were not verified"; exit 0; }

set -a
# shellcheck disable=SC1091
. ./.env
set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"
export MINIO_ENDPOINT="${MINIO_ENDPOINT//\/\/minio:9000/\/\/127.0.0.1:9001}"

scenario() { (cd backend && timeout 120s npx tsx scripts/seed-role-requests-scenario.ts "$@"); }

export SCENARIO="$(scenario | tail -1)"
ADMIN_ID="$(node -e 'process.stdout.write(JSON.parse(process.env.SCENARIO).admin)')"

# A fresh synthetic identity per run (§15.2 reserved domain).
STAMP="$(date +%s)"
export ONBOARDING_EMAIL="roles-verify-${STAMP}@example.com"
EMAIL_LOCK_DIGEST="$(cd backend && timeout 30s node --import tsx --input-type=module -e 'import { emailLockDigest } from "./src/lib/email-lock.ts"; process.stdout.write(emailLockDigest(process.env.ONBOARDING_EMAIL));')"
[[ "$EMAIL_LOCK_DIGEST" =~ ^[0-9a-f]{64}$ ]] || { echo 'FAIL: invalid fixture email-lock coordinate' >&2; exit 1; }
export ONBOARDING_TOKEN="$(bash scripts/dev/issue-dev-onboarding.sh "$ONBOARDING_EMAIL" "dev-subject-roles-${STAMP}")"
export SUPER_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
# The Admin HERSELF, minted as she is — never a narrowed Super Admin token.
export ADMIN_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$ADMIN_ID")"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  # The applicant's e-mail lock is keyed by a digest, not by a tagged name, so it
  # is removed here; everything else is the scenario's own `--clean`.
  docker compose exec -T db psql -U app -d bodour -tAc \
    "DELETE FROM normalized_email_lock WHERE email_digest = '${EMAIL_LOCK_DIGEST}';" >/dev/null \
    || echo "WARNING: the applicant's e-mail lock was left behind (${ONBOARDING_EMAIL})." >&2
  # A failed cleanup is SAID, never swallowed: it leaves rows on a populated
  # Localhost that break the NEXT harness, far from the cause.
  if ! scenario --clean >/dev/null 2>&1; then
    echo "WARNING: seed-role-requests-scenario --clean FAILED — [r168-roles] rows were left behind." >&2
    echo "         Run: (cd backend && npx tsx scripts/seed-role-requests-scenario.ts --clean)" >&2
  fi
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9268 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!

CHROME_READY=0
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9268/json/list >/dev/null 2>&1 && { CHROME_READY=1; break; }
  sleep 0.5
done
if [[ "$CHROME_READY" != "1" ]]; then
  echo "FAIL: Chrome never opened its debug port on 9268"
  exit 1
fi

PORT=9268 node scripts/dev/browser/verify-role-requests.mjs
