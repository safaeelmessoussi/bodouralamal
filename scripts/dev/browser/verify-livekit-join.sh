#!/usr/bin/env bash
# R98 — entering a class عن بُعد, through the real screens, against a REAL
# local LiveKit server.
#
# **No paid account is ever contacted.** `livekit-server --dev` is a dev-overlay
# container with a fixed key pair (docker-compose.dev.yml); CI and every local
# run use it, so this harness consumes no cloud minutes.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }

set -a
# shellcheck disable=SC1091
. ./.env
set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"

if [[ -z "${LIVEKIT_URL:-}" ]]; then
  echo "SKIP: no LIVEKIT_* settings in .env — see docs/development/online-class-provider.md"
  exit 0
fi
if ! curl -sf "http://127.0.0.1:7880/" >/dev/null 2>&1; then
  echo "FAIL: no LiveKit at 127.0.0.1:7880 — run:"
  echo "  docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d livekit"
  exit 1
fi

export R98_SCENARIO="$(cd backend && npx tsx scripts/seed-online-join-scenario.ts | tail -1)"
id() { node -e "process.stdout.write(JSON.parse(process.env.R98_SCENARIO).$1)"; }

# **One session per identity per CONSUMER.** TD-4.13 revokes a refresh cookie
# with two consumers, and the symptom is not a clean 401 but «ليست لديك صلاحية»
# on a LATER navigation — which reads as an authorization bug in the feature
# under test. So the harness's own `fetch` bearers (`*_API_COOKIE`) are minted
# separately from the cookies the BROWSER holds.
for who in safa amina souad nadia hind rim; do
  upper="$(echo "$who" | tr '[:lower:]' '[:upper:]')"
  export "${upper}_API_COOKIE=$(bash scripts/dev/issue-dev-session.sh "$(id "$who")")"
done
export STUDENT_A_API_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentA)")"
export STUDENT_B_API_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentB)")"
export PARENT_API_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id parent)")"

# The BROWSER's own cookies — one per navigation, for the same reason.
export SAFA_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id safa)")"
export AMINA_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id amina)")"
export STUDENT_A_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentA)")"
export STUDENT_B_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentB)")"
export HIND_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id hind)")"
export PARENT_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id parent)")"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  (cd backend && npx tsx scripts/seed-online-join-scenario.ts --clean) >/dev/null 2>&1 || true
}
trap cleanup EXIT

# **Fake devices, and permission granted without a prompt.** A headless browser
# has no microphone, and a permission dialog nobody can click would make every
# join time out. The tracks are synthetic; the connection, the signalling and
# the room are real.
"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --use-fake-ui-for-media-stream --use-fake-device-for-media-stream \
  --autoplay-policy=no-user-gesture-required \
  --remote-debugging-port=9252 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!

for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:9252/json/list >/dev/null 2>&1 && break
  sleep 0.3
done

PORT=9252 node scripts/dev/browser/verify-livekit-join.mjs
