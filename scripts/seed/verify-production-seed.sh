#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose_file="$repo_root/scripts/seed/fixtures/docker-compose.yml"
project="bodour-production-seed-drill-$$"
db_port="${PRODUCTION_SEED_DB_PORT:-55437}"
api_port="${PRODUCTION_SEED_API_PORT:-18082}"
minio_port="${PRODUCTION_SEED_MINIO_PORT:-59004}"
api_pid=""
api_log="/tmp/${project}-api.log"

cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  if [[ -n "$api_pid" ]]; then
    kill "$api_pid" >/dev/null 2>&1 || true
    wait "$api_pid" >/dev/null 2>&1 || true
  fi
  docker compose --project-name "$project" --file "$compose_file" \
    down --volumes --remove-orphans >/dev/null 2>&1 || true
  exit "$rc"
}
trap cleanup EXIT INT TERM

export PRODUCTION_SEED_DB_PORT="$db_port"
export PRODUCTION_SEED_MINIO_PORT="$minio_port"
docker compose --project-name "$project" --file "$compose_file" up -d --wait db minio
docker compose --project-name "$project" --file "$compose_file" run --rm minio-init

export DATABASE_URL="postgresql://app:production-seed-drill-password@127.0.0.1:${db_port}/bodour"
export GOOGLE_CLIENT_ID='production-seed-fixture'
export GOOGLE_CLIENT_SECRET='production-seed-fixture'
export JWT_SIGNING_KEY='production-seed-fixture-signing-key-with-more-than-thirty-two-bytes'
export ONBOARDING_TOKEN_KEY='production-seed-fixture-onboarding-key-with-more-than-thirty-two-bytes'
export MINIO_ENDPOINT="http://127.0.0.1:${minio_port}"
export MINIO_ACCESS_KEY='production-seed-fixture'
export MINIO_SECRET_KEY='production-seed-fixture-secret'
export PUBLIC_BASE_URL="http://127.0.0.1:${api_port}"
export STORAGE_BASE_URL="http://127.0.0.1:${minio_port}"
export SUPER_ADMIN_EMAIL='production-seed-super-admin@example.com'
export SUPER_ADMIN_SEX='female'
export NODE_ENV='test'
export TZ='Africa/Casablanca'
export PRODUCTION_SEED_DESTRUCTIVE_FIXTURE='1'
export PORT="$api_port"

(
  cd "$repo_root/backend"
  npx prisma migrate deploy
  npx vitest run --config vitest.integration.config.ts \
    src/services/production-seed.integration.test.ts
)

# Booting the real application initializes the pg-boss schema and queue catalog
# used transactionally by schedule mutations. Keep it live for the HTTP phase,
# matching the normal integration topology rather than inventing queue tables.
(
  cd "$repo_root/backend"
  exec npx tsx src/index.ts >"$api_log" 2>&1
) &
api_pid=$!

for _ in $(seq 1 60); do
  if curl --silent --fail "${PUBLIC_BASE_URL}/healthz" >/dev/null; then
    break
  fi
  sleep 0.25
done
if ! curl --silent --fail "${PUBLIC_BASE_URL}/healthz" >/dev/null; then
  echo 'FAIL: disposable API did not become healthy' >&2
  sed -n '1,160p' "$api_log" >&2
  exit 1
fi

(
  cd "$repo_root/backend"
  npx vitest run --config vitest.integration.config.ts \
    src/services/quran.integration.test.ts \
    src/services/quran-entry.integration.test.ts \
    src/policies/roster-resolution.integration.test.ts \
    src/services/educational-organisation.integration.test.ts \
    src/services/course-schedule.integration.test.ts \
    src/services/trash.integration.test.ts \
    src/services/delivery.integration.test.ts \
    src/services/online-class.integration.test.ts \
    src/services/session-recording.integration.test.ts \
    src/services/session-recording-ingest.integration.test.ts
)

(
  cd "$repo_root/backend"
  npx vitest run --config vitest.integration.config.ts \
    src/controllers/effective-staffing.http.integration.test.ts \
    src/controllers/notification-targets.http.integration.test.ts \
    src/controllers/session-audience.http.integration.test.ts \
    src/controllers/teaching-group.http.integration.test.ts \
    src/controllers/teaching-profile.http.integration.test.ts \
    src/controllers/business-scenario.integration.test.ts \
    src/controllers/teaching-candidates.http.integration.test.ts

  for fixture in \
    scripts/seed-delivery-scenario.ts \
    scripts/seed-dev-scenario.ts \
    scripts/seed-notify-scenario.ts \
    scripts/seed-online-join-scenario.ts \
    scripts/seed-quran-scenario.ts \
    scripts/seed-r82-scenario.ts \
    scripts/seed-r91-scenario.ts \
    scripts/seed-r92-scenario.ts
  do
    npx tsx "$fixture" >/dev/null
    npx tsx "$fixture" --clean >/dev/null
  done
)

printf 'production seed drill: R107 fresh seed, idempotency, authorization, HTTP fixtures and scenario seeds passed\n'
