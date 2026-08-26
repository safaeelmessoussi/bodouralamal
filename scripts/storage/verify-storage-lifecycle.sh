#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose_file="$repo_root/scripts/storage/fixtures/docker-compose.yml"
project="bodour-storage-lifecycle-drill-$$"
db_port="${STORAGE_LIFECYCLE_DB_PORT:-55436}"
minio_port="${STORAGE_LIFECYCLE_MINIO_PORT:-59003}"

cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  docker compose --project-name "$project" --file "$compose_file" \
    down --volumes --remove-orphans >/dev/null 2>&1 || true
  exit "$rc"
}
trap cleanup EXIT INT TERM

export STORAGE_LIFECYCLE_DB_PORT="$db_port"
export STORAGE_LIFECYCLE_MINIO_PORT="$minio_port"
docker compose --project-name "$project" --file "$compose_file" up -d \
  --wait db minio
docker compose --project-name "$project" --file "$compose_file" run --rm minio-init

export DATABASE_URL="postgresql://app:lifecycle-drill-password@127.0.0.1:${db_port}/bodour"
export GOOGLE_CLIENT_ID='storage-lifecycle-fixture'
export GOOGLE_CLIENT_SECRET='storage-lifecycle-fixture'
export JWT_SIGNING_KEY='storage-lifecycle-fixture-signing-key-with-more-than-thirty-two-bytes'
export ONBOARDING_TOKEN_KEY='storage-lifecycle-fixture-onboarding-key-with-more-than-thirty-two-bytes'
export MINIO_ENDPOINT="http://127.0.0.1:${minio_port}"
export MINIO_ACCESS_KEY='lifecycle-drill-access'
export MINIO_SECRET_KEY='lifecycle-drill-secret-password'
export PUBLIC_BASE_URL='http://127.0.0.1:18080'
export STORAGE_BASE_URL="http://127.0.0.1:${minio_port}"
export NODE_ENV='test'
export TZ='Africa/Casablanca'
export STORAGE_LIFECYCLE_DESTRUCTIVE_FIXTURE='1'

(
  cd "$repo_root/backend"
  npx prisma migrate deploy
  npx vitest run --config vitest.integration.config.ts \
    src/services/storage-lifecycle.integration.test.ts
)

printf 'storage lifecycle drill: exact retirement, retry and bounded staging GC passed\n'
