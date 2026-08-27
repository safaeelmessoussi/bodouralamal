#!/usr/bin/env bash
# NEW C's owed proof: طلبات الانضمام actually reorders.
#
# The queue holds pending registrations and a healthy development database has
# none, so this seeds three tagged applicants of its own and removes exactly
# those on the way out. Nothing pre-existing is read or written (P1.2).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine; sorting was not verified"; exit 0; }

set -a; . ./.env; set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"

(cd backend && npx tsx ../scripts/dev/browser/approvals-fixture.ts >/dev/null)
export DEV_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  (cd backend && npx tsx ../scripts/dev/browser/approvals-fixture.ts --clean >/dev/null 2>&1) || true
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9228 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!

CHROME_READY=0
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9228/json/list >/dev/null 2>&1 && { CHROME_READY=1; break; }
  sleep 0.5
done
if [[ "$CHROME_READY" != "1" ]]; then
  echo "FAIL: Chrome never opened its debug port on 9228"
  exit 1
fi

PORT=9228 node scripts/dev/browser/verify-approvals-sorting.mjs
