#!/usr/bin/env bash
# R115's authenticated browser acceptance on a uniquely named disposable stack.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

chrome="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$chrome" ]] || { echo 'SKIP: no Chrome on this machine'; exit 0; }

project="bodour-r115-browser-$$"
db_port="${BODOUR_R115_BROWSER_DB_PORT:-55439}"
minio_port="${BODOUR_R115_BROWSER_MINIO_PORT:-59006}"
http_port="${BODOUR_R115_BROWSER_HTTP_PORT:-58084}"
debug_port="${BODOUR_R115_BROWSER_DEBUG_PORT:-9257}"
api_image="bodour-r115-browser-api:$project"
web_image="bodour-r115-browser-web:$project"
work="$(mktemp -d)"

export BODOUR_INTEGRATION_DB_PORT="$db_port"
export BODOUR_INTEGRATION_MINIO_PORT="$minio_port"
export BODOUR_INTEGRATION_HTTP_PORT="$http_port"
export BODOUR_INTEGRATION_API_IMAGE="$api_image"
export BODOUR_INTEGRATION_WEB_IMAGE="$web_image"
export DATABASE_URL="postgresql://app:integration-stack-password@127.0.0.1:${db_port}/bodour"
export GOOGLE_CLIENT_ID='integration-client-id.apps.example.com'
export GOOGLE_CLIENT_SECRET='integration-client-secret'
export JWT_SIGNING_KEY='integration-jwt-signing-key-with-more-than-thirty-two-bytes'
export ONBOARDING_TOKEN_KEY='integration-onboarding-key-with-more-than-thirty-two-bytes'
export MINIO_ENDPOINT="http://127.0.0.1:${minio_port}"
export MINIO_ACCESS_KEY='integration-access-key'
export MINIO_SECRET_KEY='integration-secret-password'
export PUBLIC_BASE_URL="http://127.0.0.1:${http_port}"
export STORAGE_BASE_URL="http://127.0.0.1:${http_port}/storage"
export SUPER_ADMIN_EMAIL='safae.elmessoussi@gmail.com'
export SUPER_ADMIN_SEX='female'
export NODE_ENV='test'
export BACKUP_TARGET_SSH=''
export LIVEKIT_URL='ws://online-class.integration.invalid'
export LIVEKIT_API_URL='http://online-class.integration.invalid'
export LIVEKIT_API_KEY='integration-livekit-key'
export LIVEKIT_API_SECRET='integration-livekit-secret'
export RECORDING_STAGING_BUCKET='recordings-staging'
export TZ='Africa/Casablanca'
export PORT='3000'
export LOG_LEVEL='info'

compose=(
  docker compose
  --project-name "$project"
  --file "$repo_root/docker-compose.yml"
  --file "$repo_root/scripts/ci/fixtures/docker-compose.integration.yml"
)

cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  [[ -n "${chrome_pid:-}" ]] && kill "$chrome_pid" >/dev/null 2>&1 || true
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  docker image rm "$api_image" "$web_image" >/dev/null 2>&1 || true
  rm -rf "$work" >/dev/null 2>&1 || true
  exit "$rc"
}
trap cleanup EXIT INT TERM

timeout 30s "${compose[@]}" config --quiet
timeout 300s "${compose[@]}" build api nginx
timeout 120s "${compose[@]}" up -d --wait db minio
timeout 60s "${compose[@]}" run --rm minio-init
timeout 180s "${compose[@]}" run --rm api npx prisma migrate deploy
timeout 120s "${compose[@]}" run --rm api npm run seed:production
timeout 120s "${compose[@]}" run --rm api npm run seed:fixtures
timeout 180s "${compose[@]}" up -d --wait --wait-timeout 120 api nginx
curl --fail-with-body --silent --show-error --max-time 15 "${PUBLIC_BASE_URL}/healthz" >/dev/null

export R115_BROWSER_FIXTURE="$(timeout 30s bash -c 'cd backend && npx tsx ../scripts/dev/browser/platform-owner-framing-fixture.ts')"
[[ -n "$R115_BROWSER_FIXTURE" ]] || { echo 'FAIL: R115 browser fixture returned no coordinates' >&2; exit 1; }
fixture_value() {
  node -e "process.stdout.write(String(JSON.parse(process.env.R115_BROWSER_FIXTURE)[process.argv[1]]))" "$1"
}
owner_id="$(fixture_value ownerId)"
applicant_email="$(fixture_value applicantEmail)"

export OWNER_REFRESH_COOKIE="$(timeout 30s bash -c "cd backend && npx tsx scripts/issue-dev-session.ts '$owner_id'")"
export OWNER_API_REFRESH_COOKIE="$(timeout 30s bash -c "cd backend && npx tsx scripts/issue-dev-session.ts '$owner_id'")"
export ONBOARDING_TOKEN="$(timeout 30s bash -c "cd backend && npx tsx scripts/issue-dev-onboarding.ts '$applicant_email' 'r115-browser-provider-subject'")"
export APP_BASE="$PUBLIC_BASE_URL"

"$chrome" --headless=new --disable-gpu --no-sandbox --disable-dev-shm-usage \
  --remote-debugging-port="$debug_port" --remote-allow-origins='*' \
  --user-data-dir="$work/profile" about:blank >/dev/null 2>&1 &
chrome_pid=$!

chrome_ready=0
for _ in $(seq 1 60); do
  curl --fail --silent --max-time 2 "http://127.0.0.1:${debug_port}/json/list" >/dev/null 2>&1 && {
    chrome_ready=1
    break
  }
  sleep 0.5
done
[[ "$chrome_ready" == '1' ]] || { echo "FAIL: Chrome did not open port ${debug_port}" >&2; exit 1; }

PORT="$debug_port" timeout 180s node scripts/dev/browser/verify-platform-owner-framing.mjs
timeout 30s bash -c 'cd backend && npx tsx ../scripts/dev/browser/platform-owner-framing-fixture.ts --verify'
printf 'R115/UAT browser gate: 23/23 real-browser assertions and 8/8 exact disposable database assertions passed\n'
