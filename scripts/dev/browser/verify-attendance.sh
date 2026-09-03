#!/usr/bin/env bash
# الحضور on the real pages. See the .mjs for the five properties.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }
set -a; . ./.env; set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"
export DEV_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export ATTENDANCE_TAG='[attguard]'
WORK="$(mktemp -d)"
PSQL() { docker compose exec -T db psql -U app -d bodour -tAc "$1"; }

cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  (cd backend && npx tsx scripts/seed-attendance-scenario.ts --clean) >/dev/null 2>&1 || true
}
trap cleanup EXIT

# **Every row it needs, it makes** (P1.2), by exact ids it then removes — never
# by sweeping a namespace a concurrent suite could share.
export ATTENDANCE_SCENARIO="$(cd backend && npx tsx scripts/seed-attendance-scenario.ts | tail -1)"
export ATTENDANCE_MONTH="$(node -e 'process.stdout.write(JSON.parse(process.env.ATTENDANCE_SCENARIO).month)')"

"$CHROME" --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9255 \
  --remote-allow-origins='*' --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:9255/json/list >/dev/null 2>&1 && break; sleep 0.5; done
PORT=9255 node scripts/dev/browser/verify-attendance.mjs
