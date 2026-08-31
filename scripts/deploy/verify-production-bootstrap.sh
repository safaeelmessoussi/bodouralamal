#!/usr/bin/env bash
# Disposable repository-side proof of the Production bootstrap and readiness
# boundary. This is NOT a Staging or Production deployment: it uses synthetic
# credentials, a one-day self-signed certificate and uniquely named volumes.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/backup/common.sh
source "$repo_root/scripts/backup/common.sh"
overlay="$repo_root/scripts/deploy/fixtures/docker-compose.production-drill.yml"
project="bodour-production-drill-$$"
domain="production-drill.invalid"
http_port="${BODOUR_PRODUCTION_DRILL_HTTP_PORT:-58084}"
https_port="${BODOUR_PRODUCTION_DRILL_HTTPS_PORT:-58443}"
drill_root="$(mktemp -d /tmp/bodour-production-bootstrap.XXXXXX)"
conf_dir="$drill_root/conf.d"
letsencrypt_dir="$drill_root/letsencrypt"
cert_dir="$letsencrypt_dir/live/$domain"
www_dir="$drill_root/www"
api_image="bodour-production-drill-api:$project"
web_image="bodour-production-drill-web:$project"
chrome_pid=''
browser_log="$drill_root/browser-smoke.log"
release_commit="$(git -C "$repo_root" rev-parse HEAD)"
backup_repository="$drill_root/repository"
backup_password_file="$drill_root/restic-password"
recovery_config="$drill_root/recovery.env"
recovered_config="$drill_root/recovered-config"

export BODOUR_PRODUCTION_DRILL_HTTP_PORT="$http_port"
export BODOUR_PRODUCTION_DRILL_HTTPS_PORT="$https_port"
export BODOUR_PRODUCTION_DRILL_CONF_DIR="$conf_dir"
export BODOUR_PRODUCTION_DRILL_LETSENCRYPT_DIR="$letsencrypt_dir"
export BODOUR_PRODUCTION_DRILL_WWW_DIR="$www_dir"
export BODOUR_PRODUCTION_DRILL_API_IMAGE="$api_image"
export BODOUR_PRODUCTION_DRILL_WEB_IMAGE="$web_image"
# Base Compose expands these before overlay merging. Explicit synthetic values
# keep an operator's repository .env out of this drill.
export MINIO_ACCESS_KEY='production-drill-access-key'
export MINIO_SECRET_KEY='production-drill-secret-password'
export RECORDING_STAGING_BUCKET='recordings-staging'
export TZ='Africa/Casablanca'

compose=(
  docker compose
  --project-name "$project"
  --file "$repo_root/docker-compose.yml"
  --file "$overlay"
  --file "$repo_root/docker-compose.production.yml"
)

fail() {
  printf 'Production bootstrap drill: FAIL — %s\n' "$1" >&2
  exit 1
}

[[ "$release_commit" =~ ^[0-9a-f]{40}$ ]] || fail 'repository HEAD is not an exact commit'

cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  set +e
  if [[ -n "$chrome_pid" ]] && kill -0 "$chrome_pid" 2>/dev/null; then
    kill "$chrome_pid" 2>/dev/null
    wait "$chrome_pid" 2>/dev/null
  fi
  if [[ "$rc" -ne 0 ]]; then
    "${compose[@]}" ps -a >&2
    "${compose[@]}" logs --no-color --tail 120 api nginx db minio >&2
    if [[ -s "$browser_log" ]]; then
      printf '\nProduction browser smoke assertions (repeated after service diagnostics):\n' >&2
      tail -n 80 "$browser_log" >&2
    fi
  fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1
  docker image rm "$api_image" "$web_image" >/dev/null 2>&1
  if [[ -d "$backup_repository" ]]; then
    # The pinned restic container writes its repository as root. Empty only the
    # validated drill-owned directory through that image before removing the
    # enclosing user-owned temporary tree.
    docker run --rm --entrypoint /bin/sh --volume "$backup_repository:/repository" \
      "$RESTIC_IMAGE" -c 'find /repository -mindepth 1 -delete' >/dev/null 2>&1 || true
  fi
  case "$drill_root" in
    /tmp/bodour-production-bootstrap.*) rm -rf -- "$drill_root" ;;
    *) printf 'Refusing to remove unexpected drill path: %s\n' "$drill_root" >&2 ;;
  esac
  exit "$rc"
}
trap cleanup EXIT INT TERM

mkdir -p "$conf_dir" "$cert_dir" "$www_dir"
install -m 0644 "$repo_root/nginx/conf.d/default.conf" "$conf_dir/default.conf"
sed "s/__DOMAIN__/$domain/g" \
  "$repo_root/nginx/conf.d/tls.conf.example" >"$conf_dir/tls.conf"
openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
  -subj "/CN=$domain" \
  -addext "subjectAltName=DNS:$domain" \
  -keyout "$cert_dir/privkey.pem" \
  -out "$cert_dir/fullchain.pem" >/dev/null 2>&1

"${compose[@]}" config --quiet
stop_grace="$("${compose[@]}" config --format json | node -e '
  let source = "";
  process.stdin.on("data", (chunk) => { source += chunk; });
  process.stdin.on("end", () => {
    const config = JSON.parse(source);
    process.stdout.write(String(config.services?.api?.stop_grace_period ?? ""));
  });
')"
[[ "$stop_grace" == '2m0s' ]] ||
  fail "the API stop grace period is not 2 minutes (found ${stop_grace:-<empty>})"
docker build --label "org.opencontainers.image.revision=$release_commit" \
  --tag "$api_image" "$repo_root/backend"
docker build --label "org.opencontainers.image.revision=$release_commit" \
  --tag "$web_image" "$repo_root/frontend"
api_image_id="$(docker image inspect --format '{{.Id}}' "$api_image")"
web_image_id="$(docker image inspect --format '{{.Id}}' "$web_image")"
[[ -n "$api_image_id" && -n "$web_image_id" ]] || fail 'built image identity is missing'
"${compose[@]}" up --no-build -d --wait db minio
"${compose[@]}" run --rm --no-deps minio-init
"${compose[@]}" run --rm api npx prisma migrate deploy
"${compose[@]}" run --rm api npm run seed:production

sql() {
  "${compose[@]}" exec -T db psql -U app -d bodour -tAc "$1" | tr -d '[:space:]'
}

assert_sql() {
  local query="$1"
  local expected="$2"
  local label="$3"
  local actual
  actual="$(sql "$query")"
  [[ "$actual" == "$expected" ]] ||
    fail "$label: expected $expected, found ${actual:-<empty>}"
}

enqueue_queue_job() {
  local queue="$1"
  sql "
    WITH inserted AS (
      INSERT INTO pgboss.job (
        name, data, expire_seconds, deletion_seconds, keep_until,
        retry_limit, retry_delay, retry_backoff, retry_delay_max,
        policy, dead_letter, heartbeat_seconds
      )
      SELECT
        q.name, '{}'::jsonb, q.expire_seconds, q.deletion_seconds,
        now() + q.retention_seconds * interval '1 second',
        q.retry_limit, q.retry_delay, q.retry_backoff, q.retry_delay_max,
        q.policy, q.dead_letter, q.heartbeat_seconds
      FROM pgboss.queue q
      WHERE q.name = '$queue'
      RETURNING id
    )
    SELECT id FROM inserted;"
}

job_state() {
  local job_id="$1"
  sql "SELECT state::text FROM pgboss.job WHERE id = '$job_id'::uuid;"
}

wait_for_job_state() {
  local job_id="$1" expected="$2" attempts="$3" label="$4" current=''
  for _ in $(seq 1 "$attempts"); do
    current="$(job_state "$job_id")"
    [[ "$current" == "$expected" ]] && return 0
    sleep 0.25
  done
  fail "$label did not reach $expected (found ${current:-missing})"
}

assert_sql 'SELECT count(*) FROM role;' '5' 'role catalogue'
assert_sql 'SELECT count(*) FROM category WHERE deleted_at IS NULL;' '3' 'Category baseline'
assert_sql 'SELECT count(*) FROM level WHERE deleted_at IS NULL;' '21' 'Level baseline'
assert_sql 'SELECT count(*) FROM subject WHERE deleted_at IS NULL;' '8' 'Subject baseline'
assert_sql 'SELECT count(*) FROM quran_surah;' '114' 'Surah catalogue'
assert_sql 'SELECT count(*) FROM scheduling_type WHERE deleted_at IS NULL;' '6' 'scheduling-type baseline'
assert_sql 'SELECT count(*) FROM academic_year WHERE is_current;' '1' 'current academic year'
assert_sql "SELECT count(*) FROM subject WHERE deleted_at IS NULL AND tracks_quran_progress AND name = 'حفظ القرآن';" '1' 'memorisation marker'
assert_sql "SELECT count(*) FROM subject WHERE deleted_at IS NULL AND name IN ('القرآن الكريم', 'محو الأمية');" '0' 'superseded Subject names'
assert_sql 'SELECT count(*) FROM "user";' '1' 'bootstrap account count'
assert_sql "SELECT count(*) FROM \"user\" WHERE pre_provisioned_email = 'safae.elmessoussi@gmail.com' AND first_name_arabic = 'صفاء' AND last_name_arabic = 'المسوسي' AND name_arabic = 'صفاء المسوسي' AND sex = 'female' AND account_status = 'active' AND deleted_at IS NULL;" '1' 'approved bootstrap identity'
assert_sql "SELECT count(*) FROM platform_owner WHERE singleton_key = 'platform';" '1' 'Platform Owner singleton'
assert_sql "SELECT count(*) FROM platform_owner po JOIN user_branch_role ubr ON ubr.user_id = po.owner_user_id JOIN role r ON r.id = ubr.role_id WHERE po.singleton_key = 'platform' AND r.name = 'super_admin' AND ubr.branch_id IS NULL AND ubr.user_status = 'active' AND ubr.deleted_at IS NULL;" '1' 'Platform Owner global Super Admin authority'
assert_sql "SELECT count(*) FROM platform_owner po JOIN framing_preference fp ON fp.user_id = po.owner_user_id WHERE fp.mode = 'both' AND fp.all_branches AND NOT EXISTS (SELECT 1 FROM framing_preference_branch fpb WHERE fpb.user_id = fp.user_id) AND NOT EXISTS (SELECT 1 FROM teacher_availability ta WHERE ta.user_id = fp.user_id);" '1' 'Platform Owner framing without fabricated schedule'
assert_sql 'SELECT count(*) FROM user_identity;' '0' 'bound identities on a fresh install'
assert_sql 'SELECT count(*) FROM user_branch_role;' '1' 'bootstrap role assignment'
assert_sql 'SELECT count(*) FROM partner;' '0' 'Owner-managed partners'
assert_sql 'SELECT count(*) FROM branch;' '0' 'Production branches'
assert_sql 'SELECT count(*) FROM room;' '0' 'Production rooms'
assert_sql 'SELECT count(*) FROM administrative_group;' '0' 'Production groups'
assert_sql 'SELECT count(*) FROM enrollment;' '0' 'Production enrolments'
assert_sql 'SELECT count(*) FROM recurring_course_schedule;' '0' 'Production schedules'
assert_sql 'SELECT count(*) FROM session;' '0' 'Production sessions'
assert_sql 'SELECT count(*) FROM event;' '0' 'Production events'
assert_sql 'SELECT count(*) FROM exam;' '0' 'Production exams'
assert_sql 'SELECT count(*) FROM educational_content;' '0' 'Production content'
assert_sql "SELECT count(*) FROM \"user\" WHERE name_arabic LIKE '%[تجريبي]%' OR name_arabic LIKE '%[dev-session]%';" '0' 'fixture/dev-session accounts'

seed_snapshot() {
  sql "
    SELECT jsonb_build_object(
      'role', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM role t),
      'category', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM category t),
      'level', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM level t),
      'subject', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM subject t),
      'partner', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM partner t),
      'scheduling_type', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM scheduling_type t),
      'academic_year', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM academic_year t),
      'quran_surah', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.surah_id) FROM quran_surah t),
      'system_setting', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.key) FROM system_setting t),
      'user', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM \"user\" t),
      'user_branch_role', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM user_branch_role t),
      'platform_owner', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.singleton_key) FROM platform_owner t),
      'framing_preference', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.user_id) FROM framing_preference t),
      'framing_preference_branch', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.user_id, t.branch_id) FROM framing_preference_branch t),
      'teacher_availability', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM teacher_availability t)
    );"
}

migration_digest() {
  sql "
    SELECT md5(COALESCE(
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id)::text FROM \"_prisma_migrations\" t),
      '[]'
    ));"
}

before_seed="$(seed_snapshot)"
[[ -n "$before_seed" ]] || fail 'the first seed snapshot is empty'
"${compose[@]}" run --rm api npm run seed:production
after_seed="$(seed_snapshot)"
[[ "$after_seed" == "$before_seed" ]] || fail 'the second Production seed changed initialized data'
restart_seed_snapshot="$after_seed"
migration_snapshot="$(migration_digest)"
[[ -n "$migration_snapshot" ]] || fail 'migration-history snapshot is empty'

policy_output="$(
  "${compose[@]}" run --rm --no-deps --entrypoint /bin/sh minio-init -c \
    'mc anonymous get local/public; mc anonymous get local/private; mc anonymous get local/recordings-staging'
)"
grep -Fq 'download' <<<"$policy_output" || fail 'public bucket is not anonymous-download'
[[ "$(grep -Fc 'private' <<<"$policy_output")" -eq 2 ]] ||
  fail 'private and recording-staging buckets are not anonymous-deny'

canary_key='restart-drill/persistence-canary.txt'
canary_value='bodour-production-restart-canary-v1'
printf '%s' "$canary_value" |
  "${compose[@]}" run --rm -T --no-deps --entrypoint /bin/sh minio-init \
    -c "mc pipe local/private/$canary_key >/dev/null"

minio_container="$("${compose[@]}" ps -q minio)"
[[ -n "$minio_container" ]] || fail 'the MinIO container is missing'
port_bindings="$(docker inspect --format '{{json .HostConfig.PortBindings}}' "$minio_container")"
[[ "$port_bindings" == '{}' || "$port_bindings" == 'null' ]] ||
  fail "MinIO has an external host binding: $port_bindings"

"${compose[@]}" up --no-build -d --wait --wait-timeout 150 api nginx

https_url="https://$domain:$https_port"
curl_https=(curl --noproxy '*' --insecure --resolve "$domain:$https_port:127.0.0.1" --silent --show-error --max-time 15)
response_body="$drill_root/response.json"
headers="$drill_root/headers.txt"
nginx_config="$drill_root/nginx-T.txt"

wait_for_https_status() {
  local expected="$1" attempts="$2" label="$3" current=''
  for _ in $(seq 1 "$attempts"); do
    current="$("${curl_https[@]}" --output "$response_body" --write-out '%{http_code}' "$https_url/healthz" || true)"
    if [[ "$current" == "$expected" ]]; then
      status="$current"
      return 0
    fi
    sleep 1
  done
  fail "$label did not reach HTTPS $expected (found ${current:-connection-failed})"
}

assert_canary() {
  local actual
  actual="$("${compose[@]}" run --rm -T --no-deps --entrypoint /bin/sh minio-init \
    -c "mc cat local/private/$canary_key")"
  [[ "$actual" == "$canary_value" ]] || fail 'private object did not survive restart/recreation'
}

assert_persistent_state() {
  [[ "$(seed_snapshot)" == "$restart_seed_snapshot" ]] ||
    fail 'initialized Production data changed across restart/recreation'
  [[ "$(migration_digest)" == "$migration_snapshot" ]] ||
    fail 'migration history changed across restart/recreation'
  assert_canary
}

container_id() {
  local service="$1" id
  id="$("${compose[@]}" ps -q "$service")"
  [[ -n "$id" ]] || fail "container is missing: $service"
  printf '%s' "$id"
}

assert_release_identity() {
  [[ "$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$api_image")" == "$release_commit" ]] ||
    fail 'API image revision label does not match repository HEAD'
  [[ "$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$web_image")" == "$release_commit" ]] ||
    fail 'web image revision label does not match repository HEAD'
  [[ "$(docker inspect --format '{{.Image}}' "$(container_id api)")" == "$api_image_id" ]] ||
    fail 'running API container does not use the proved image identity'
  [[ "$(docker inspect --format '{{.Image}}' "$(container_id nginx)")" == "$web_image_id" ]] ||
    fail 'running Nginx container does not use the proved image identity'
}

status="$("${curl_https[@]}" --output "$response_body" --write-out '%{http_code}' "$https_url/healthz")"
[[ "$status" == '200' ]] || fail "whole-application HTTPS health returned $status"
assert_release_identity
node --input-type=module -e '
  import fs from "node:fs";
  const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const components = body.components ?? {};
  if (body.status !== "ok" || !["database", "storage", "queue", "jobs"].every((key) => components[key] === "ok")) {
    throw new Error(`unexpected health payload: ${JSON.stringify(body)}`);
  }
  if (body.details?.jobs?.state !== "ok") throw new Error("worker catalog is not ready");
' "$response_body"

[[ "$("${compose[@]}" exec -T api printenv NODE_ENV | tr -d '\r\n')" == 'production' ]] ||
  fail 'the running API is not in Production mode'

"${curl_https[@]}" --head "$https_url/" >"$headers"
grep -Fiq 'strict-transport-security: max-age=31536000; includeSubDomains' "$headers" ||
  fail 'HSTS is absent on the TLS application response'
grep -Fiq "content-security-policy: default-src 'self'" "$headers" ||
  fail 'the application CSP is absent on the TLS response'

status="$(curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code}' \
  --max-time 15 -H "Host: $domain" "http://127.0.0.1:$http_port/healthz")"
[[ "$status" == '301' ]] || fail "plain HTTP did not redirect to TLS (status $status)"

status="$("${curl_https[@]}" --output "$response_body" --write-out '%{http_code}' "$https_url/api/v1/me")"
[[ "$status" == '401' ]] || fail "anonymous API boundary returned $status instead of 401"
grep -Fq '"error"' "$response_body" || fail 'anonymous API refusal is not a TD-3.8 envelope'

for public_root in '/storage/public' '/storage/public/' '/storage/public?list-type=2'; do
  status="$("${curl_https[@]}" --output /dev/null --write-out '%{http_code}' "$https_url$public_root")"
  [[ "$status" == '403' ]] || fail "public bucket root $public_root returned $status"
done

"${compose[@]}" exec -T nginx nginx -T >"$nginx_config" 2>&1
grep -Fq "server_name $domain;" "$nginx_config" || fail 'generated Production TLS server is not loaded'
grep -Fq 'proxy_set_header Host              $http_host;' "$nginx_config" ||
  fail 'loaded storage proxy no longer preserves the exact SigV4 Host header'
grep -Fq 'location = /storage/public' "$nginx_config" ||
  fail 'loaded Nginx config lacks the public bucket-root denial'

# A curl-green edge can still ship a broken bundle, CSP, anonymous session
# bootstrap or branded route. Drive the built SPA in an isolated Chrome profile
# against this exact TLS origin. No session is minted: authenticated Staging E2E
# remains a separate Google-OAuth/external-credential gate.
chrome="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$chrome" ]] || fail 'Chrome/Chromium is required for the Production browser smoke'
chrome_profile="$drill_root/chrome-profile"
mkdir -p "$chrome_profile"
"$chrome" --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --disable-background-networking --disable-component-update --no-proxy-server \
  --ignore-certificate-errors --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=0 --user-data-dir="$chrome_profile" \
  --host-resolver-rules="MAP $domain 127.0.0.1" about:blank >/dev/null 2>&1 &
chrome_pid=$!
devtools_port_file="$chrome_profile/DevToolsActivePort"
for _ in $(seq 1 80); do
  [[ -s "$devtools_port_file" ]] && break
  kill -0 "$chrome_pid" 2>/dev/null || fail 'Chrome exited before exposing its debug port'
  sleep 0.25
done
[[ -s "$devtools_port_file" ]] || fail 'Chrome did not expose its debug port'
devtools_port="$(sed -n '1p' "$devtools_port_file")"
[[ "$devtools_port" =~ ^[0-9]+$ ]] || fail 'Chrome exposed an invalid debug port'
PORT="$devtools_port" APP_BASE="$https_url" \
  node "$repo_root/scripts/deploy/verify-production-browser.mjs" | tee "$browser_log"
kill "$chrome_pid" 2>/dev/null || true
wait "$chrome_pid" 2>/dev/null || true
chrome_pid=''

"${compose[@]}" stop minio
wait_for_https_status 503 30 'MinIO loss readiness'
grep -Fq '"storage":"down"' "$response_body" || fail 'degraded health did not identify storage'

api_container="$("${compose[@]}" ps -q api)"
[[ -n "$api_container" ]] || fail 'the API container is missing during degradation'
docker_unhealthy=''
for _ in $(seq 1 45); do
  health_state="$(docker inspect --format '{{.State.Health.Status}}' "$api_container")"
  if [[ "$health_state" == 'unhealthy' ]]; then
    docker_unhealthy='yes'
    break
  fi
  sleep 2
done
[[ "$docker_unhealthy" == 'yes' ]] || fail 'Docker health remained green while /healthz returned 503'

"${compose[@]}" up --no-build -d --wait --wait-timeout 90 minio
wait_for_https_status 200 60 'MinIO restart readiness'

docker_healthy=''
for _ in $(seq 1 45); do
  health_state="$(docker inspect --format '{{.State.Health.Status}}' "$api_container")"
  if [[ "$health_state" == 'healthy' ]]; then
    docker_healthy='yes'
    break
  fi
  sleep 2
done
[[ "$docker_healthy" == 'yes' ]] || fail 'Docker health did not recover after MinIO restart'

# Worker-down durability: a correctly configured queue row inserted while the
# API is stopped must remain created, then complete after the same container is
# started and the full worker catalogue becomes ready again.
"${compose[@]}" stop --timeout 120 api
if "${compose[@]}" ps --services --status running | grep -Fxq api; then
  fail 'API remained running after the explicit stop'
fi
queued_job_id="$(enqueue_queue_job 'session.materialize')"
[[ "$queued_job_id" =~ ^[0-9a-f-]{36}$ ]] || fail 'worker-down job was not durably inserted'
[[ "$(job_state "$queued_job_id")" == 'created' ]] ||
  fail 'worker-down job did not remain pending while the API was stopped'
"${compose[@]}" up --no-build -d --wait --wait-timeout 150 api
wait_for_job_state "$queued_job_id" completed 120 'worker-down durable job'
wait_for_https_status 200 60 'API start after queued work'

# In-flight graceful restart: hold the exact table used by token.purge long
# enough for pg-boss to mark the job active, signal the API, then release below
# PostgreSQL's ten-second statement timeout. The handler must finish before the
# container restarts rather than being severed or losing its durable row.
"${compose[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U app -d bodour \
  -c 'BEGIN; LOCK TABLE consumed_token IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(9); COMMIT;' \
  >/dev/null &
lock_pid=$!
lock_acquired=''
for _ in $(seq 1 40); do
  if [[ "$(sql "SELECT count(*) FROM pg_locks WHERE relation = 'consumed_token'::regclass AND mode = 'AccessExclusiveLock' AND granted;")" == '1' ]]; then
    lock_acquired='yes'
    break
  fi
  sleep 0.1
done
[[ "$lock_acquired" == 'yes' ]] || fail 'could not establish the in-flight job lock fixture'

active_job_id="$(enqueue_queue_job 'token.purge')"
[[ "$active_job_id" =~ ^[0-9a-f-]{36}$ ]] || fail 'in-flight job was not durably inserted'
wait_for_job_state "$active_job_id" active 32 'locked in-flight job'
"${compose[@]}" restart api >/dev/null &
restart_pid=$!
wait "$lock_pid" || fail 'in-flight lock fixture failed'
wait "$restart_pid" || fail 'API restart failed while draining an active job'
wait_for_job_state "$active_job_id" completed 120 'gracefully drained job'
wait_for_https_status 200 90 'API readiness after graceful in-flight restart'

# Data-service restart issues no API restart command. Whether its pools reconnect
# in-process or the configured service restart policy replaces the process, the
# API and every worker must converge to healthy while database and object state
# remain byte-for-byte authoritative.
"${compose[@]}" restart db
"${compose[@]}" up --no-build -d --wait --wait-timeout 90 db
wait_for_https_status 200 120 'PostgreSQL restart recovery'
assert_persistent_state

# The edge itself may restart independently. Connection failures during the
# restart are expected; the same TLS health route must recover without touching
# the application/data containers.
"${compose[@]}" restart nginx
wait_for_https_status 200 60 'Nginx restart recovery'

# Host-like stop/start: no process remains running, then the exact existing
# containers start against the same named volumes. Neither migrations nor seeds
# are invoked anywhere in this phase.
"${compose[@]}" stop --timeout 120
[[ -z "$("${compose[@]}" ps --services --status running)" ]] ||
  fail 'services remained running after the full stack stop'
"${compose[@]}" up --no-build -d --wait --wait-timeout 150 db minio api nginx
wait_for_https_status 200 90 'full stack start recovery'
assert_persistent_state
[[ "$(job_state "$queued_job_id")" == 'completed' ]] ||
  fail 'completed worker-down job regressed after full stack start'
[[ "$(job_state "$active_job_id")" == 'completed' ]] ||
  fail 'completed in-flight job regressed after full stack start'

# Upgrade-like recreation replaces every runtime container while retaining the
# two stateful named volumes. The drill overlay deliberately bind-mounts its
# disposable TLS/ACME fixture, so the base file's certbot volumes are not part
# of this resolved four-service graph. This catches accidental anonymous
# storage, ephemeral DB state, stale bind mounts, and startup commands that
# silently seed/migrate.
before_api="$(container_id api)"
before_db="$(container_id db)"
before_minio="$(container_id minio)"
before_nginx="$(container_id nginx)"
before_volumes="$(for volume in db-data minio-data; do
  "${compose[@]}" config --volumes | grep -Fxq "$volume" || fail "logical volume is missing: $volume"
  docker volume inspect --format '{{.Name}}|{{.CreatedAt}}' "${project}_$volume"
done)"

"${compose[@]}" up --no-build -d --force-recreate --wait --wait-timeout 150 \
  db minio api nginx
after_api="$(container_id api)"
after_db="$(container_id db)"
after_minio="$(container_id minio)"
after_nginx="$(container_id nginx)"
[[ "$after_api" != "$before_api" && "$after_db" != "$before_db" &&
   "$after_minio" != "$before_minio" && "$after_nginx" != "$before_nginx" ]] ||
  fail 'force-recreate did not replace every long-running application container'
after_volumes="$(for volume in db-data minio-data; do
  docker volume inspect --format '{{.Name}}|{{.CreatedAt}}' "${project}_$volume"
done)"
[[ "$after_volumes" == "$before_volumes" ]] || fail 'named volume identity changed during recreation'
[[ "$(docker inspect --format '{{json .Config.Cmd}}' "$after_api")" == '["node","dist/src/index.js"]' ]] ||
  fail 'API container startup command may run migration/seed work'
wait_for_https_status 200 90 'force-recreate recovery'
assert_persistent_state
assert_release_identity
[[ "$(job_state "$queued_job_id")" == 'completed' && "$(job_state "$active_job_id")" == 'completed' ]] ||
  fail 'durable job terminal state changed during recreation'

# Recovery/rollback integration: the focused backup drill already proves the
# portable pg_dump in a second clean database and wrong-password fail-before-
# outage behavior. This phase proves the other boundary: a recovery point from
# the actual Production-mode graph restores into empty volumes, boots the exact
# same release images, becomes healthy, and rolls back later DB/object writes.
mkdir -p "$backup_repository"
umask 077
printf 'production-drill-restic-password-with-sufficient-entropy\n' > "$backup_password_file"
printf 'NODE_ENV=production\nrelease_commit=%s\n' "$release_commit" > "$recovery_config"

sql "
  CREATE TABLE production_recovery_drill (
    id integer PRIMARY KEY,
    value text NOT NULL
  );
  INSERT INTO production_recovery_drill (id, value)
  VALUES (1, 'state-at-recovery-point');"

running_container_ids() {
  for service in api db minio nginx; do
    printf '%s=%s\n' "$service" "$(container_id "$service")"
  done
}

before_recovery_ids="$(running_container_ids)"
"$repo_root/scripts/backup/create-recovery-point.sh" \
  --allow-fixtures \
  --project "$project" \
  --compose-file "$repo_root/docker-compose.yml" \
  --compose-file "$overlay" \
  --compose-file "$repo_root/docker-compose.production.yml" \
  --repository "$backup_repository" \
  --password-file "$backup_password_file" \
  --database-user app \
  --database-name bodour \
  --stop-timeout 120 \
  --volume db-data \
  --volume minio-data \
  --config-file "$recovery_config"

[[ "$(running_container_ids)" == "$before_recovery_ids" ]] ||
  fail 'recovery-point creation replaced a Production-mode container'
wait_for_https_status 200 90 'recovery-point restart readiness'
assert_release_identity

# Make both durable stores newer than the recovery point. Restoring the snapshot
# must remove these later values rather than merely proving that old data exists.
sql "UPDATE production_recovery_drill SET value = 'state-after-recovery-point' WHERE id = 1;"
printf 'object-after-recovery-point' |
  "${compose[@]}" run --rm -T --no-deps --entrypoint /bin/sh minio-init \
    -c "mc pipe local/private/$canary_key >/dev/null"
assert_sql "SELECT value FROM production_recovery_drill WHERE id = 1;" \
  'state-after-recovery-point' 'post-recovery-point database mutation'

"${compose[@]}" down --volumes --remove-orphans
"$repo_root/scripts/backup/restore-recovery-point.sh" \
  --allow-fixtures \
  --project "$project" \
  --compose-file "$repo_root/docker-compose.yml" \
  --compose-file "$overlay" \
  --compose-file "$repo_root/docker-compose.production.yml" \
  --repository "$backup_repository" \
  --password-file "$backup_password_file" \
  --recovered-config-dir "$recovered_config" \
  --volume db-data \
  --volume minio-data

grep -Fxq 'format=bodour-recovery-point-v1' "$recovered_config/manifest.env" ||
  fail 'restored recovery-point format is wrong'
grep -Fxq "git_commit=$release_commit" "$recovered_config/manifest.env" ||
  fail 'restored recovery point does not name the exact source commit'
cmp -s "$recovery_config" "$recovered_config/$(basename "$recovery_config")" ||
  fail 'restored recovery configuration differs from the encrypted snapshot'

"${compose[@]}" up --no-build -d --wait --wait-timeout 150 db minio api nginx
wait_for_https_status 200 90 'post-restore application readiness'
assert_release_identity
assert_persistent_state
assert_sql "SELECT value FROM production_recovery_drill WHERE id = 1;" \
  'state-at-recovery-point' 'database rollback state'
[[ "$(migration_digest)" == "$migration_snapshot" ]] ||
  fail 'ordinary post-restore startup changed migration history'

printf 'Production bootstrap drill: bootstrap, failure recovery, exact-release restart/recreation and healthy recovery-point rollback passed\n'
