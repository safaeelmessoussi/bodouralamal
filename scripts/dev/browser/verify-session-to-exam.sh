#!/usr/bin/env bash
# R269 — «تعديل الحصة» → النوع: اختبار, through the real screens: the مؤطِّرة
# changes today's online class into an exam from «حصص الجدول», the calendar
# shows the exam with the class's own «دخول الحصة», and «إرجاعها حصة» changes
# it back. Seeds the tagged R98 scenario and removes it on exit. `SHOTS=<dir>`.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }

set -a
# shellcheck disable=SC1091
. ./.env
set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"

export R98_SCENARIO="$(cd backend && npx tsx scripts/seed-online-join-scenario.ts | tail -1)"
id() { node -e "process.stdout.write(JSON.parse(process.env.R98_SCENARIO).$1)"; }
# One cookie per navigation (TD-4.13 revokes a refresh cookie with two consumers).
export SAFA_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id safa)")"
export SAFA_COOKIE_2="$(bash scripts/dev/issue-dev-session.sh "$(id safa)")"
export STUDENT_A_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentA)")"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  (cd backend && npx tsx scripts/seed-online-join-scenario.ts --clean) >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9255 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9255/json/list >/dev/null 2>&1 && break
  sleep 0.5
done

PORT=9255 node scripts/dev/browser/verify-session-to-exam.mjs
