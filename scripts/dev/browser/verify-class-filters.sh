#!/usr/bin/env bash
# SRS Revision 163 §5 — a class is addressed through five «الكل» filters and no
# «نمط التدريس», on the real إضافة عنصر form. See verify-class-filters.mjs.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine; the class form was not verified"; exit 0; }
set -a; . ./.env; set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"

export SCENARIO="$(bash scripts/dev/seed-dev-scenario.sh | tail -1)"
export DEV_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export CLASS_TITLE="[dev-scenario] حصة بالمرشِّحات $$"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  # The scenario's own wipe removes every `[dev-scenario]`-titled schedule,
  # which is why the class this harness creates carries that prefix (P1.2).
  bash scripts/dev/seed-dev-scenario.sh --clean >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9267 \
  --remote-allow-origins='*' --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
CHROME_READY=0
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9267/json/list >/dev/null 2>&1 && { CHROME_READY=1; break; }
  sleep 0.5
done
[[ "$CHROME_READY" == "1" ]] || { echo "FAIL: Chrome never opened its debug port on 9267"; exit 1; }

PORT=9267 node scripts/dev/browser/verify-class-filters.mjs
