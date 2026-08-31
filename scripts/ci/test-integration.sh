#!/usr/bin/env bash
# Complete disposable PostgreSQL/MinIO/pg-boss/Nginx integration gate for CI.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
overlay="$repo_root/scripts/ci/fixtures/docker-compose.integration.yml"
project="bodour-ci-integration-$$"
db_port="${BODOUR_INTEGRATION_DB_PORT:-55438}"
minio_port="${BODOUR_INTEGRATION_MINIO_PORT:-59005}"
http_port="${BODOUR_INTEGRATION_HTTP_PORT:-58083}"
api_image="bodour-integration-api:$project"
web_image="bodour-integration-web:$project"

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
  --file "$overlay"
)

cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  docker image rm "$api_image" "$web_image" >/dev/null 2>&1 || true
  exit "$rc"
}
trap cleanup EXIT INT TERM

"${compose[@]}" config --quiet
"${compose[@]}" build api nginx
"${compose[@]}" up -d --wait db minio
"${compose[@]}" run --rm minio-init
"${compose[@]}" run --rm api npx prisma migrate deploy
"${compose[@]}" run --rm api npm run seed:production
"${compose[@]}" run --rm api npm run seed:fixtures
"${compose[@]}" up -d --wait --wait-timeout 120 api nginx

curl --fail-with-body --silent --show-error --max-time 15 "${PUBLIC_BASE_URL}/healthz" >/dev/null
bash "$repo_root/scripts/test/run-integration-suite.sh" "$@"

printf 'CI integration gate: full disposable stack, assertions and all-table isolation passed\n'
