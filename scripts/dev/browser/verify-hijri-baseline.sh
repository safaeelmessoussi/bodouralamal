#!/usr/bin/env bash
# التقويم الهجري prefill + never-overwrite. See the .mjs for the scenario.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }
set -a; . ./.env; set +a
export DEV_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export HIJRI_TEST_YEAR=1588
WORK="$(mktemp -d)"
PSQL() { docker compose exec -T db psql -U app -d bodour -tAc "$1"; }
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  # Its own year, removed. 1588 AH resolves to no real date anybody uses.
  # Its own year AND anything this harness derived, whichever year the page was
  # showing. Scoping the teardown to the test year alone once left twelve rows
  # in a REAL year when the year control did not take.
  PSQL "DELETE FROM hijri_month_start WHERE hijri_year = ${HIJRI_TEST_YEAR}
        OR source = 'umm_al_qura_icu';" >/dev/null 2>&1 || true
}
trap cleanup EXIT
PSQL "DELETE FROM hijri_month_start WHERE hijri_year = ${HIJRI_TEST_YEAR};" >/dev/null
"$CHROME" --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9255 \
  --remote-allow-origins='*' --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:9255/json/list >/dev/null 2>&1 && break; sleep 0.5; done
PORT=9255 node scripts/dev/browser/verify-hijri-baseline.mjs
