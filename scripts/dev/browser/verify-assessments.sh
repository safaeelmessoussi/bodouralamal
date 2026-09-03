#!/usr/bin/env bash
# بناء الاختبارات and the beneficiary's paper, on the real pages. See the .mjs.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }
set -a; . ./.env; set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"
WORK="$(mktemp -d)"

cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  (cd backend && npx tsx scripts/seed-assessment-scenario.ts --clean) >/dev/null 2>&1 || true
}
trap cleanup EXIT

# **Every row it needs, it makes** (P1.2), by its own tag, and `--clean` removes
# exactly those. It sweeps no namespace a concurrent suite could share.
export SCENARIO="$(cd backend && npx tsx scripts/seed-assessment-scenario.ts | tail -1)"
pick() { node -e "process.stdout.write(JSON.parse(process.env.SCENARIO).$1)"; }
TEACHER_ID="$(pick teacher)"; STUDENT_ID="$(pick student)"
LEVEL_ID="$(pick levelId)"; SUBJECT_ID="$(pick subjectId)"
YEAR_ID="$(pick academicYearId)"; WHEN="$(pick date)"

# The paper itself is created through the API by the harness, using the
# super-admin session below — the builder's own write path. The browser half then
# verifies the SCREENS, rather than re-driving a form whose failure would be
# ambiguous with the student flow.
export SUPER_API_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export LEVEL_ID SUBJECT_ID YEAR_ID WHEN
export TEACHER_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$TEACHER_ID")"
export STUDENT_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$STUDENT_ID")"

"$CHROME" --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9257 \
  --remote-allow-origins='*' --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:9257/json/list >/dev/null 2>&1 && break; sleep 0.5; done
PORT=9257 node scripts/dev/browser/verify-assessments.mjs
