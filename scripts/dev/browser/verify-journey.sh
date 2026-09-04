#!/usr/bin/env bash
# The admission-to-achievement journey, on the real screens.
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
STUDENT_A="$(bash scripts/dev/issue-dev-session.sh "$(id student)")"
STUDENT_B="$(bash scripts/dev/issue-dev-session.sh "$(id student)")"
TEACHER_A="$(bash scripts/dev/issue-dev-session.sh "$(id teacher)")"
TEACHER_B="$(bash scripts/dev/issue-dev-session.sh "$(id teacher)")"
TEACHER_C="$(bash scripts/dev/issue-dev-session.sh "$(id teacher)")"
TEACHER_D="$(bash scripts/dev/issue-dev-session.sh "$(id teacher)")"
OTHER_A="$(bash scripts/dev/issue-dev-session.sh "$(id other)")"
OTHER_B="$(bash scripts/dev/issue-dev-session.sh "$(id other)")"

export JOURNEY_SCENARIO="$(node -e "
const s = JSON.parse(process.env.JOURNEY_IDS);
console.log(JSON.stringify({
  examId: s.examId,
  studentCookie: process.argv[1], studentCookie2: process.argv[2],
  teacherCookie: process.argv[3], teacherCookie2: process.argv[4],
  teacherCookie3: process.argv[7], teacherCookie4: process.argv[8],
  otherStudentCookie: process.argv[5], otherStudentCookie2: process.argv[6],
}));
" "$STUDENT_A" "$STUDENT_B" "$TEACHER_A" "$TEACHER_B" "$OTHER_A" "$OTHER_B" "$TEACHER_C" "$TEACHER_D")"

WORK="$(mktemp -d)"
"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9252 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!

CHROME_READY=0
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9252/json/list >/dev/null 2>&1 && { CHROME_READY=1; break; }
  sleep 0.5
done
[[ "$CHROME_READY" == "1" ]] || { echo "FAIL: Chrome never opened its debug port on 9252"; exit 1; }

PORT=9252 node scripts/dev/browser/verify-journey.mjs
