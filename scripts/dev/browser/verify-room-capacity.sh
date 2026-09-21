#!/usr/bin/env bash
# SRS Revision 169 §3 — room capacity on the real rooms dialog. See the .mjs.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine; room capacity was not verified"; exit 0; }

set -a
# shellcheck disable=SC1091
. ./.env
set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"
export MINIO_ENDPOINT="${MINIO_ENDPOINT//\/\/minio:9000/\/\/127.0.0.1:9001}"

scenario() { (cd backend && timeout 120s npx tsx scripts/seed-role-requests-scenario.ts "$@"); }
export SCENARIO="$(scenario | tail -1)"
export SUPER_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  if ! scenario --clean >/dev/null 2>&1; then
    echo "WARNING: seed-role-requests-scenario --clean FAILED — [r168-roles] rows were left behind." >&2
  fi
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9269 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
READY=0
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9269/json/list >/dev/null 2>&1 && { READY=1; break; }
  sleep 0.5
done
[[ "$READY" == "1" ]] || { echo "FAIL: Chrome never opened its debug port on 9269"; exit 1; }

PORT=9269 node scripts/dev/browser/verify-room-capacity.mjs
