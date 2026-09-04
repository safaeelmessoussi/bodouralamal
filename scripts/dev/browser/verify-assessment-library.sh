#!/usr/bin/env bash
# «اختبار أنشأتُه يجب ألا يختفي» — the assessment library, on the real screens.
#
# **The fixture is the integration journey itself**, run with `JOURNEY_KEEP=1`
# so its rows survive the suite. A seed script of its own would be a second
# implementation of the same eleven steps, and this repository's standing rule
# is that the copy which drifts still passes its own tests.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }

set -a
# shellcheck disable=SC1091
. ./.env
set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"

# **Cleanup runs whatever happens.** An abandoned `[journey]` branch would reach
# the association's PUBLIC homepage, which is a defect this project has already
# shipped once.
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "${WORK:-}" 2>/dev/null || true
  (cd backend && npx vitest run --config vitest.integration.config.ts \
      src/controllers/journey.integration.test.ts) >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "→ building the journey through the real routes…"
( cd backend && JOURNEY_KEEP=1 npx vitest run --config vitest.integration.config.ts \
    src/controllers/journey.integration.test.ts ) >/dev/null 2>&1 \
  || { echo "FAIL: the journey did not complete; the browser phase would prove nothing"; exit 1; }

JOURNEY_IDS="$(cd backend && npx tsx scripts/journey-fixture-ids.ts 2>/dev/null | tail -1)"
[[ -n "$JOURNEY_IDS" ]] || { echo "FAIL: could not resolve the journey fixture"; exit 1; }
export JOURNEY_IDS
id() { node -e 'process.stdout.write(JSON.parse(process.env.JOURNEY_IDS)[process.argv[1]])' "$1"; }

# One cookie per identity per page-phase: the app refreshes on load and rotates
# the refresh cookie, so reusing one renders a logged-out shell (TD-4.13).
# One cookie per page-phase: the app refreshes on load and rotates the refresh
# cookie, so reusing one renders a logged-out shell (TD-4.13) — which on this
# screen would read as "the library is empty", the exact defect under test.
ADMIN_COOKIES=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  ADMIN_COOKIES="$ADMIN_COOKIES $(bash scripts/dev/issue-dev-session.sh)"
done

export LIBRARY_SCENARIO="$(node -e "
const s = JSON.parse(process.env.JOURNEY_IDS);
const c = process.argv.slice(1);
console.log(JSON.stringify({
  examId: s.examId,
  adminCookie: c[0], adminCookie2: c[1], adminCookie3: c[2], adminCookie4: c[3],
  adminCookie5: c[4], adminCookie6: c[5], adminCookie7: c[6], adminCookie8: c[7],
  adminCookie9: c[8], adminCookie10: c[9],
}));
" $ADMIN_COOKIES)"

WORK="$(mktemp -d)"
"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9253 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!

CHROME_READY=0
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9253/json/list >/dev/null 2>&1 && { CHROME_READY=1; break; }
  sleep 0.5
done
[[ "$CHROME_READY" == "1" ]] || { echo "FAIL: Chrome never opened its debug port on 9253"; exit 1; }

PORT=9253 node scripts/dev/browser/verify-assessment-library.mjs
