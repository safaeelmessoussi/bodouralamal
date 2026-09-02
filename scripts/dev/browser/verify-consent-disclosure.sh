#!/usr/bin/env bash
# The registration consent disclosure, in a real browser. See the .mjs for why.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }

set -a
# shellcheck disable=SC1091
. ./.env
set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"

# The form renders only from an onboarding token (§4.1b). A fresh synthetic
# identity per run, from the §15.2 reserved domain — and **nothing is
# submitted**, so no applicant is created and there is nothing to clean up.
STAMP="$(date +%s)"
export ONBOARDING_TOKEN="$(bash scripts/dev/issue-dev-onboarding.sh "consent-disclosure-${STAMP}@example.com" "dev-subject-${STAMP}")"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
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

PORT=9247 node scripts/dev/browser/verify-consent-disclosure.mjs
