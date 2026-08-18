#!/usr/bin/env bash
# R81 — simple grading, driven through the real screens.
#
# The two exams are created through the API first, because the harness is here
# to verify the GRADING behaviour rather than to re-drive the scheduling form —
# and creating them by hand each run would make a failure ambiguous between the
# two features.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }

export DEV_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
set -a
# shellcheck disable=SC1091
. ./.env
set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"
export R81_EXAMS="$(cd backend && npx tsx scripts/seed-grading-exams.ts | tail -1)"
echo "exams: $R81_EXAMS"
# **Her own session, not an administrator's.** `issue-dev-session.sh <id>` mints
# for a named user without widening anything, which is exactly what reading a
# beneficiary's screen requires.
STUDENT_ID="$(node -e 'process.stdout.write(JSON.parse(process.env.R81_EXAMS).studentId)')"
export STUDENT_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$STUDENT_ID")"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  (cd backend && npx tsx scripts/seed-grading-exams.ts --clean) >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9235 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!

for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:9235/json/list >/dev/null 2>&1 && break
  sleep 0.3
done

PORT=9235 node scripts/dev/browser/verify-grading.mjs
