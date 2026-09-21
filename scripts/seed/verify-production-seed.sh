#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose_file="$repo_root/scripts/seed/fixtures/docker-compose.yml"
project="bodour-production-seed-drill-$$"
# **Below the ephemeral range, deliberately** (2026-09-20). These defaulted to
# 55437 and 59004, inside Linux's 32768–60999, where any outbound connection may
# be handed the same number: a browser's long-lived connection from local port
# 59004 made this drill fail twice with «address already in use» on a port
# nothing was listening on. Still overridable, for a machine that needs it.
db_port="${PRODUCTION_SEED_DB_PORT:-25437}"
api_port="${PRODUCTION_SEED_API_PORT:-18082}"
minio_port="${PRODUCTION_SEED_MINIO_PORT:-29004}"
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
# The fixture's `minio` service extends docker-compose.yml's own definition,
# whose `${MINIO_ACCESS_KEY}`/`${MINIO_SECRET_KEY}` substitution must resolve
# before Compose brings that service up — export these ahead of the first
# `docker compose` call, not only ahead of the later host-side process env.
export MINIO_ACCESS_KEY='production-seed-fixture'
export MINIO_SECRET_KEY='production-seed-fixture-secret'
docker compose --project-name "$project" --file "$compose_file" up -d --wait db minio
# The exact shared initializer Production's one-shot container runs, executed
# from the backend so its AWS SDK resolves from the existing dependency tree.
# This drill builds no API image, and no S3-client image is needed: the MinIO
# `mc` image this used to pull cannot be pulled on a clean runner.
(
  cd "$repo_root/backend"
  MINIO_ENDPOINT="http://127.0.0.1:${minio_port}" \
    node --input-type=module < <(sed "s|'./policy.mjs'|'../scripts/storage/policy.mjs'|" "$repo_root/scripts/storage/initialize.mjs")
)

export DATABASE_URL="postgresql://app:production-seed-drill-password@127.0.0.1:${db_port}/bodour"
export GOOGLE_CLIENT_ID='production-seed-fixture'
export GOOGLE_CLIENT_SECRET='production-seed-fixture'
export JWT_SIGNING_KEY='production-seed-fixture-signing-key-with-more-than-thirty-two-bytes'
export ONBOARDING_TOKEN_KEY='production-seed-fixture-onboarding-key-with-more-than-thirty-two-bytes'
export EMAIL_LOCK_KEY='email-lock-isolated-fixture-key-at-least-32-bytes'
export MINIO_ENDPOINT="http://127.0.0.1:${minio_port}"
export PUBLIC_BASE_URL="http://127.0.0.1:${api_port}"
# The drill reaches MinIO directly only through the server-side endpoint above.
# Browser-facing capability URLs must retain the same-origin /storage shape the
# real Nginx deployment owns; a direct MinIO origin is invalid in every tier.
export STORAGE_BASE_URL="${PUBLIC_BASE_URL}/storage"
export SUPER_ADMIN_EMAIL='safae.elmessoussi@gmail.com'
export SUPER_ADMIN_SEX='female'
export NODE_ENV='test'
export TZ='Africa/Casablanca'
export PRODUCTION_SEED_DESTRUCTIVE_FIXTURE='1'
export PORT="$api_port"

(
  cd "$repo_root/backend"
  npx prisma migrate deploy
)

# **The fresh-install path, run and asserted BEFORE any test can mask it.**
#
# This is the exact scenario the defect lived in: `migrate deploy` inserts نشاط
# on its own, and the seed then has to reconcile the other five rather than read
# one row as "already initialized". Running the real entry point here — and
# checking the DATABASE rather than a test's expectations — means the catalogue
# is proved on the true deployment sequence, and proved even when an unrelated
# assertion later in this drill fails.
(
  cd "$repo_root/backend"
  npx tsx prisma/seed/production.ts
)

# **The catalogue is asserted against the DATABASE, not only inside vitest.**
#
# The defect this guards shipped precisely because nothing looked: the seed's
# own guard read one row as "already initialized" and skipped five, and a fresh
# installation ended up offering a single scheduling type on which no class
# could be scheduled. A SQL assertion here fails the drill even if the vitest
# file's status is muddied by an unrelated failure — which is the situation this
# check exists for.
psql_seed() {
  docker compose --project-name "$project" --file "$compose_file" \
    exec -T db psql -U app -d bodour -tAc "$1"
}
missing="$(psql_seed "
  SELECT string_agg(t.name, ', ')
    FROM (VALUES ('حصة'),('اختبار'),('محاضرة'),('حفل'),('عطلة'),('نشاط')) AS t(name)
   WHERE NOT EXISTS (SELECT 1 FROM scheduling_type s WHERE s.name = t.name);" | tr -d '[:space:]')"
if [[ -n "$missing" ]]; then
  echo "FAIL: the seeded scheduling-type catalogue is incomplete (SRS R110.2/110.9)." >&2
  echo "      missing: $missing" >&2
  exit 1
fi
kinds="$(psql_seed "
  SELECT count(DISTINCT structural_kind) FROM scheduling_type WHERE deleted_at IS NULL;" | tr -d '[:space:]')"
if [[ "$kinds" != "4" ]]; then
  echo "FAIL: expected all four structural kinds live after the seed; found $kinds." >&2
  exit 1
fi
echo "OK: scheduling-type catalogue complete — six canonical rows, four structural kinds."

owner_profile="$(psql_seed "
  SELECT count(*)
    FROM platform_owner po
    JOIN \"user\" u ON u.id = po.owner_user_id
    JOIN user_branch_role ubr ON ubr.user_id = u.id
    JOIN role r ON r.id = ubr.role_id
    JOIN framing_preference fp ON fp.user_id = u.id
   WHERE po.singleton_key = 'platform'
     AND u.pre_provisioned_email = 'safae.elmessoussi@gmail.com'
     AND u.first_name_arabic = 'صفاء'
     AND u.last_name_arabic = 'المسوسي'
     AND u.name_arabic = 'صفاء المسوسي'
     AND u.sex = 'female'
     AND u.account_status = 'active'
     AND u.deleted_at IS NULL
     AND r.name = 'super_admin'
     AND ubr.branch_id IS NULL
     AND ubr.user_status = 'active'
     AND ubr.deleted_at IS NULL
     AND fp.mode = 'both'
     AND fp.all_branches
     AND NOT EXISTS (SELECT 1 FROM framing_preference_branch fpb WHERE fpb.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM teacher_availability ta WHERE ta.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM user_identity ui WHERE ui.user_id = u.id);" | tr -d '[:space:]')"
if [[ "$owner_profile" != "1" ]]; then
  echo "FAIL: approved Platform Owner identity/authority/framing bootstrap is incomplete." >&2
  exit 1
fi
echo "OK: one unbound approved Platform Owner with global authority and both/all-branch framing."

(
  cd "$repo_root/backend"
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
    scripts/seed-r92-scenario.ts \
    scripts/seed-role-requests-scenario.ts
  do
    npx tsx "$fixture" >/dev/null
    npx tsx "$fixture" --clean >/dev/null
  done
)

printf 'production seed drill: R107 fresh seed, idempotency, authorization, HTTP fixtures and scenario seeds passed\n'
