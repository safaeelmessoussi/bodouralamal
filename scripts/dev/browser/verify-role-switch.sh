#!/usr/bin/env bash
# R273 — «الدور الحالي» opens the chosen role's dashboard. See the .mjs.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }

set -a
# shellcheck disable=SC1091
. ./.env
set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"

# The R98 scenario names the Super Admin it acts as (R267).
SCENARIO="$(cd backend && npx tsx scripts/seed-online-join-scenario.ts | tail -1)"
ADMIN_ID="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).admin)" "$SCENARIO")"
export ADMIN_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$ADMIN_ID")"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  (cd backend && npx tsx scripts/seed-online-join-scenario.ts --clean) >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9257 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9257/json/list >/dev/null 2>&1 && break
  sleep 0.5
done

PORT=9257 node scripts/dev/browser/verify-role-switch.mjs
