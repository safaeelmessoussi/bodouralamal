#!/usr/bin/env bash
# **The recorder-kill drill** (SRS Revision 168 §2) — DEV STACK ONLY.
#
# A مؤطِّرة enters a real online class in a real browser and presses «بدء
# التسجيل»; the recorder uploads a few ten-second safety segments; then the
# recorder's container is KILLED outright (SIGKILL — how a host reboot or an
# out-of-memory kill ends it: no final file, no goodbye), brought back, and the
# reconciler is run until the recording has been assembled from its segments and
# imported into the library.
#
# It proves the chain nothing else can: that the recorder really uploads
# segments WHILE recording, that the final file really is lost, that ffmpeg in
# the API image really joins them, and that the library really receives it.
#
# Then the rest of the story: the classroom SAYS the recorder stopped, she
# presses «بدء التسجيل» again, and the second part of the class is recorded the
# ordinary way — so nothing before the crash is lost, and nothing after it.
#
# It waits the platform's REAL rules — there is deliberately no switch that moves
# the reconciler's clock, because such a switch would ship to Production and
# could assemble a class that is still being recorded. So it takes about a
# quarter of an hour: ninety silent seconds before «بدء التسجيل» is believed,
# ten silent minutes before the segments are assembled.
#
#   RECORD_SECONDS   how long to record before the kill   (default 45)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }

dc() { docker compose -f docker-compose.yml -f docker-compose.dev.yml "$@"; }

set -a; . ./.env; set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"
[[ -n "${LIVEKIT_URL:-}" ]] || { echo "SKIP: no LIVEKIT_* settings in .env"; exit 0; }
dc ps livekit-egress 2>/dev/null | grep -q "Up" || { echo "FAIL: the recorder (livekit-egress) is not running"; exit 1; }

export SCENARIO="$(cd backend && npx tsx scripts/seed-online-join-scenario.ts | tail -1)"
id() { node -e "process.stdout.write(String(JSON.parse(process.env.SCENARIO).$1))"; }

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  # The recorder must be running again whatever happened here.
  dc up -d livekit-egress >/dev/null 2>&1 || echo "WARNING: could not restart livekit-egress" >&2
  if ! (cd backend && npx tsx scripts/seed-online-join-scenario.ts --clean) >/dev/null 2>&1; then
    echo "WARNING: seed-online-join-scenario --clean FAILED — scenario rows were left behind." >&2
  fi
}
trap cleanup EXIT

export TEACHER_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id hind)")"
export SESSION_ID="$(id seerahToday)"
export RECORD_SECONDS="${RECORD_SECONDS:-45}"

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --use-fake-ui-for-media-stream --use-fake-device-for-media-stream \
  --autoplay-policy=no-user-gesture-required \
  --remote-debugging-port=9257 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
CHROME_READY=0
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9257/json/list >/dev/null 2>&1 && { CHROME_READY=1; break; }
  sleep 0.5
done
[[ "$CHROME_READY" == "1" ]] || { echo "FAIL: Chrome never opened its debug port on 9257"; exit 1; }

PORT=9257 node scripts/dev/browser/verify-recorder-crash.mjs
