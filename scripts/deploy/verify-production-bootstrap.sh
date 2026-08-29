#!/usr/bin/env bash
# Disposable repository-side proof of the Production bootstrap and readiness
# boundary. This is NOT a Staging or Production deployment: it uses synthetic
# credentials, a one-day self-signed certificate and uniquely named volumes.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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

cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  set +e
  if [[ "$rc" -ne 0 ]]; then
    "${compose[@]}" ps -a >&2
    "${compose[@]}" logs --no-color --tail 120 api nginx db minio >&2
  fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1
  docker image rm "$api_image" "$web_image" >/dev/null 2>&1
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
"${compose[@]}" build api nginx
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
assert_sql "SELECT count(*) FROM \"user\" WHERE pre_provisioned_email = 'production-bootstrap@example.invalid';" '1' 'bootstrap Super Admin'
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
      'user_branch_role', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM user_branch_role t)
    );"
}

before_seed="$(seed_snapshot)"
[[ -n "$before_seed" ]] || fail 'the first seed snapshot is empty'
"${compose[@]}" run --rm api npm run seed:production
after_seed="$(seed_snapshot)"
[[ "$after_seed" == "$before_seed" ]] || fail 'the second Production seed changed initialized data'

policy_output="$(
  "${compose[@]}" run --rm --no-deps --entrypoint /bin/sh minio-init -c \
    'mc anonymous get local/public; mc anonymous get local/private; mc anonymous get local/recordings-staging'
)"
grep -Fq 'download' <<<"$policy_output" || fail 'public bucket is not anonymous-download'
[[ "$(grep -Fc 'private' <<<"$policy_output")" -eq 2 ]] ||
  fail 'private and recording-staging buckets are not anonymous-deny'

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

status="$("${curl_https[@]}" --output "$response_body" --write-out '%{http_code}' "$https_url/healthz")"
[[ "$status" == '200' ]] || fail "whole-application HTTPS health returned $status"
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

"${compose[@]}" stop minio
degraded=''
for _ in $(seq 1 30); do
  status="$("${curl_https[@]}" --output "$response_body" --write-out '%{http_code}' "$https_url/healthz" || true)"
  if [[ "$status" == '503' ]]; then
    degraded='yes'
    break
  fi
  sleep 1
done
[[ "$degraded" == 'yes' ]] || fail 'MinIO loss did not produce HTTPS 503 readiness'
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
recovered=''
for _ in $(seq 1 60); do
  status="$("${curl_https[@]}" --output "$response_body" --write-out '%{http_code}' "$https_url/healthz" || true)"
  if [[ "$status" == '200' ]]; then
    recovered='yes'
    break
  fi
  sleep 1
done
[[ "$recovered" == 'yes' ]] || fail 'readiness did not recover after MinIO restart'

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

printf 'Production bootstrap drill: migrations, idempotent seed, clean inventory, TLS/Nginx, workers and fail-closed readiness passed\n'
