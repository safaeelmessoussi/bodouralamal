#!/usr/bin/env bash
# R99 C2 — a class is recorded, imported, and PLAYED by a beneficiary.
#
# C1's harness (`verify-livekit-join.sh`) proves capture: a real room, a real
# Egress job, a real file in the staging bucket. This one starts where that ends
# and proves the half R99.13 and R99.14 are about — **the object becomes a بذور
# الأمل library item, and somebody who is allowed to can actually play it.**
#
# **No paid account is ever contacted.** `livekit` and `livekit-egress` are
# dev-overlay containers with a fixed key pair (docker-compose.dev.yml).
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
  echo "  docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d redis livekit livekit-egress"
  exit 1
fi

# **Egress is a SEPARATE service and the import cannot happen without it.** A
# missing worker leaves every recording stuck at `starting` and every check
# below timing out — a failure that reads as a broken feature rather than a
# missing container, which is exactly the confusion worth spending three lines
# to prevent.
if ! docker compose -f docker-compose.yml -f docker-compose.dev.yml ps livekit-egress 2>/dev/null | grep -q "Up"; then
  echo "FAIL: the Egress worker is not running — run:"
  echo "  docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d redis livekit livekit-egress"
  exit 1
fi

export R99_SCENARIO="$(cd backend && npx tsx scripts/seed-online-join-scenario.ts | tail -1)"
id() { node -e "process.stdout.write(JSON.parse(process.env.R99_SCENARIO).$1)"; }

# **One session per identity per CONSUMER** (TD-4.13). A refresh cookie used by
# two consumers is revoked, and the symptom is «ليست لديك صلاحية» on a LATER
# navigation — an authorization failure of the harness wearing the costume of a
# failure of the feature. So the fetch bearers and the browser cookies are minted
# separately, and each browser navigation gets its own.
for who in safa amina hind; do
  upper="$(echo "$who" | tr '[:lower:]' '[:upper:]')"
  export "${upper}_API_COOKIE=$(bash scripts/dev/issue-dev-session.sh "$(id "$who")")"
done
export STUDENTA_API_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentA)")"
export STUDENTB_API_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentB)")"
export STUDENTC_API_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentC)")"

export HIND_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id hind)")"
export SAFA_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id safa)")"
export STUDENT_A_COOKIE="$(bash scripts/dev/issue-dev-session.sh "$(id studentA)")"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  # Rows AND the objects the import created — the wipe removes both, so a dev
  # bucket does not grow by a lesson every run.
  (cd backend && npx tsx scripts/seed-online-join-scenario.ts --clean) >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Fake devices and no permission prompt: a headless browser has no microphone,
# and a dialog nobody can click would make every join time out. The tracks are
# synthetic; the connection, the room, the Egress job and the file are real.
"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --use-fake-ui-for-media-stream --use-fake-device-for-media-stream \
  --autoplay-policy=no-user-gesture-required \
  --remote-debugging-port=9253 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!

CHROME_READY=0
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9253/json/list >/dev/null 2>&1 && { CHROME_READY=1; break; }
  sleep 0.5
done
if [[ "$CHROME_READY" != "1" ]]; then
  echo "FAIL: Chrome never opened its debug port on 9253"
  exit 1
fi

PORT=9253 node scripts/dev/browser/verify-livekit-ingest.mjs
NODE_STATUS=$?

# ── R99.13 — staging is swept, and the DURABLE object is elsewhere ─────────
#
# The whole clause in one measurement: after a successful import the provider's
# object is gone and the content bucket holds the lesson. Checked from outside
# the application, because "the service says it cleaned up" is the claim, not
# the evidence.
echo
echo "-- the staging bucket, for THIS run's two occurrences --"

# **Scoped to this run's session ids, deliberately.** `verify-livekit-join`
# writes to the same bucket and DELIBERATELY preserves its artefacts — rows are
# wiped, bytes are evidence — so an unscoped count would report another
# harness's evidence as this one's sweep failure. That is exactly the trap
# testing.md names: a probe that identifies a row by what it renders rather than
# by its id will one day match a different row.
SEERAH="$(node -e "process.stdout.write(JSON.parse(process.env.R99_SCENARIO).seerahToday)")"
TAFSEER="$(node -e "process.stdout.write(JSON.parse(process.env.R99_SCENARIO).tafseerToday)")"

STAGING="$(docker run --rm --network bodour_default \
  -e MC_HOST_local="http://${MINIO_ACCESS_KEY}:${MINIO_SECRET_KEY}@minio:9000" \
  minio/mc:latest ls --recursive local/"${RECORDING_STAGING_BUCKET:-recordings-staging}" 2>/dev/null || true)"
MINE="$(printf "%s\n" "$STAGING" | grep -E "session-recordings/($SEERAH|$TAFSEER)/" || true)"
echo "${MINE:-(nothing left under either occurrence)}"

# The MEDIA object is the platform's to sweep. The `EG_*.json` beside it is the
# provider's own manifest, written where the platform never asked for anything —
# deleting it would mean guessing at a vendor's file layout, which is precisely
# the coupling the provider seam exists to prevent (R97.9). It is left alone.
LEFTOVER="$(printf "%s\n" "$MINE" | grep -cE "[.](mp4|ogg)$" || true)"

if [[ "$LEFTOVER" -eq 0 ]]; then
  echo "PASS  both imported recordings were swept from staging — provider output is temporary (R99.13)"
else
  echo "FAIL  $LEFTOVER media object(s) survived a SUCCESSFUL import"
  NODE_STATUS=1
fi

exit "$NODE_STATUS"
