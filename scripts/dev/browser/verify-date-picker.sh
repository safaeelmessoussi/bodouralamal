#!/usr/bin/env bash
# The one Arabic date picker, on the real screens: public DOB, AcademicPeriod
# (R122), the online assessment builder (R124), and a physical exam's
# scheduling date (R58). See the .mjs for the properties and why a browser.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }

set -a
# shellcheck disable=SC1091
. ./.env
set +a

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
}
trap cleanup EXIT

# One cookie per admin page-phase: the app refreshes on load and rotates the
# refresh cookie, so reusing one across three separate admin screens would
# render a logged-out shell on the second and third (TD-4.13).
ADMIN_1="$(bash scripts/dev/issue-dev-session.sh)"
ADMIN_2="$(bash scripts/dev/issue-dev-session.sh)"
ADMIN_3="$(bash scripts/dev/issue-dev-session.sh)"

# **§4.1b — the DOB field lives behind the onboarding token gate, not on a bare
# `/register`.** The token arrives at `#onboarding_token=…` (never the query
# string, never sent to the server as anything but a header) and is what
# `noTokenTitle`'s error page exists to refuse the absence of. Minted, never
# reused: nothing here submits the form, so no applicant row is ever created
# and no cleanup is owed.
STAMP="$(date +%s)"
ONBOARDING_TOKEN="$(bash scripts/dev/issue-dev-onboarding.sh "date-picker-verify-${STAMP}@example.com" "date-picker-verify-${STAMP}")"

export DATE_PICKER_SCENARIO="$(node -e "
console.log(JSON.stringify({
  adminCookie1: process.argv[1], adminCookie2: process.argv[2], adminCookie3: process.argv[3],
  onboardingToken: process.argv[4],
}));
" "$ADMIN_1" "$ADMIN_2" "$ADMIN_3" "$ONBOARDING_TOKEN")"

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9254 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!

CHROME_READY=0
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9254/json/list >/dev/null 2>&1 && { CHROME_READY=1; break; }
  sleep 0.5
done
[[ "$CHROME_READY" == "1" ]] || { echo "FAIL: Chrome never opened its debug port on 9254"; exit 1; }

PORT=9254 node scripts/dev/browser/verify-date-picker.mjs
