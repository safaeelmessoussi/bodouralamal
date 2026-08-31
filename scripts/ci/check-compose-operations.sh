#!/usr/bin/env bash
# The single VPS must not inherit Docker's unbounded json-file logging default.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose="$repo_root/docker-compose.yml"
development_overlay="$repo_root/docker-compose.dev.yml"
deployment="$repo_root/docs/operations/deployment.md"
workflow="$repo_root/.github/workflows/ci.yml"
integration_runner="$repo_root/scripts/ci/test-integration.sh"
integration_overlay="$repo_root/scripts/ci/fixtures/docker-compose.integration.yml"
production_drill="$repo_root/scripts/deploy/verify-production-bootstrap.sh"
production_drill_overlay="$repo_root/scripts/deploy/fixtures/docker-compose.production-drill.yml"
job_runner="$repo_root/backend/src/jobs/runner.ts"

fail() {
  printf 'compose-operations guard: %s\n' "$1" >&2
  exit 1
}

grep -Fq 'x-bounded-local-logging: &bounded-local-logging' "$compose" ||
  fail 'the shared bounded logging policy is missing'
grep -Fq 'driver: local' "$compose" ||
  fail 'services must use Docker local logging rather than unbounded json-file'
grep -Fq 'max-size: "10m"' "$compose" ||
  fail 'the per-file logging ceiling is missing'
grep -Fq 'max-file: "5"' "$compose" ||
  fail 'the rotated-file ceiling is missing'

service_count="$({
  awk '
    /^services:$/ { in_services = 1; next }
    in_services && /^[^[:space:]]/ { exit }
    in_services && /^  [[:alnum:]_-]+:$/ { count += 1 }
    END { print count + 0 }
  ' "$compose"
})"
logging_count="$(grep -Ec '^    logging: \*bounded-local-logging$' "$compose")"

[[ "$service_count" -gt 0 ]] || fail 'no base Compose services were found'
[[ "$logging_count" -eq "$service_count" ]] ||
  fail "every base service must use bounded logging ($logging_count/$service_count do)"

# The base edge exposes 80/443 for release tiers. Local Development deliberately
# runs the HTTP-only Nginx server, so inheriting 443 creates a TCP listener whose
# upstream container port has no listener: browsers see ERR_CONNECTION_CLOSED
# before an HTTP request exists. The development overlay must replace the release
# list with exactly one loopback-bound HTTP mapping; Staging/Production continue
# to resolve exclusively from their release overlays.
mapfile -t development_edge_ports < <(
  awk '
    /^  nginx:$/ { in_nginx = 1; next }
    in_nginx && /^  [[:alnum:]_-]+:$/ { exit }
    in_nginx && /^    ports: !override$/ { in_ports = 1; next }
    in_ports && /^      - / { print; next }
    in_ports && /^    [[:alnum:]_-]+:/ { exit }
  ' "$development_overlay"
)
[[ "${#development_edge_ports[@]}" -eq 1 &&
   "${development_edge_ports[0]}" == '      - "127.0.0.1:80:80"' ]] ||
  fail 'the Local Nginx edge must publish exactly 127.0.0.1:80:80 and no TLS port'

grep -Fq 'test: ["CMD", "curl", "-fsS", "--max-time", "12", "http://127.0.0.1:3000/healthz"]' "$compose" ||
  fail 'the API container must report whole-application readiness to Docker'
grep -Fq 'curl --fail-with-body --silent --show-error --max-time 15 https://<domain>/healthz' "$deployment" ||
  fail 'the deployment health probe must fail on HTTP 503 and bound its wait'

grep -Fq 'run: bash scripts/ci/test-integration.sh' "$workflow" ||
  fail 'hosted CI must run the disposable real-stack integration gate'
awk '
  /^  integration:/ { inside = 1 }
  /^  frontend:/ { inside = 0 }
  inside && /run: npx prisma generate/ { found = 1 }
  END { exit found ? 0 : 1 }
' "$workflow" ||
  fail 'the integration clean-checkout job must generate the Prisma client'
grep -Fq 'bash "$repo_root/scripts/test/run-integration-suite.sh" "$@"' "$integration_runner" ||
  fail 'CI must use the same all-table isolation runner as Local Development'
grep -Fq 'down --volumes --remove-orphans' "$integration_runner" ||
  fail 'the CI stack must destroy its disposable volumes on every exit'
[[ "$(grep -Fc 'env_file: !reset []' "$integration_overlay")" -eq 2 ]] ||
  fail 'the CI overlay must not read operator-owned app/database env files'
grep -Fq 'ports: !override' "$integration_overlay" ||
  fail 'the CI edge must replace Production ports rather than append to them'
[[ "$(grep -Ec '^      - "127\.0\.0\.1:\$\{BODOUR_INTEGRATION_' "$integration_overlay")" -eq 3 ]] ||
  fail 'every CI host port must bind loopback only'

# The hosted integration job runs in the fixture-permitting test tier. A
# separate destructive-but-disposable drill must prove that the real image also
# bootstraps with the stricter Production environment and TLS edge.
[[ -x "$production_drill" && -f "$production_drill_overlay" ]] ||
  fail 'the disposable Production bootstrap drill is missing or not executable'
[[ "$(grep -Fc 'env_file: !reset []' "$production_drill_overlay")" -eq 2 ]] ||
  fail 'the Production drill must not read operator-owned app/database env files'
grep -Fq 'NODE_ENV: production' "$production_drill_overlay" ||
  fail 'the Production drill must exercise the Production runtime tier'
grep -Fq 'stop_grace_period: 2m' "$compose" ||
  fail 'the API must outlive its bounded pg-boss graceful-drain budget'
grep -Fq 'export const JOB_SHUTDOWN_TIMEOUT_MS = 105_000;' "$job_runner" ||
  fail 'pg-boss must retain a bounded drain budget below Docker termination'
grep -Fq 'timeout: JOB_SHUTDOWN_TIMEOUT_MS' "$job_runner" ||
  fail 'pg-boss shutdown must apply the bounded drain budget'
grep -Fq "[[ \"\$stop_grace\" == '2m0s' ]]" "$production_drill" ||
  fail 'the Production drill must prove the resolved API stop budget'
[[ "$(grep -Ec '^      - "127\.0\.0\.1:\$\{BODOUR_PRODUCTION_DRILL_' "$production_drill_overlay")" -eq 2 ]] ||
  fail 'the Production drill may publish only its loopback HTTP/TLS edge'
[[ "$(grep -Fc 'run --rm api npx prisma migrate deploy' "$production_drill")" -eq 1 ]] ||
  fail 'the Production drill must migrate exactly once; restarts must never invoke it'
[[ "$(grep -Fc 'run --rm api npm run seed:production' "$production_drill")" -eq 2 ]] ||
  fail 'the Production drill must execute and compare the real seed twice'
if grep -Fq 'seed:fixtures' "$production_drill"; then
  fail 'the Production drill must never load fixture data'
fi
grep -Fq "docker inspect --format '{{json .HostConfig.PortBindings}}'" "$production_drill" ||
  fail 'the Production drill must prove MinIO has no host binding'
grep -Fq '"${compose[@]}" stop minio' "$production_drill" ||
  fail 'the Production drill must exercise real storage degradation'
grep -Fq "wait_for_https_status 503 30 'MinIO loss readiness'" "$production_drill" ||
  fail 'the Production drill must require degraded readiness to return 503'
grep -Fq "[[ \"\$health_state\" == 'unhealthy' ]]" "$production_drill" ||
  fail 'the Production drill must require Docker health to fail with readiness'
grep -Fq 'stop --timeout 120 api' "$production_drill" ||
  fail 'the Production drill must enqueue durable work while the API worker is stopped'
grep -Fq "enqueue_queue_job 'session.materialize'" "$production_drill" ||
  fail 'the Production drill must prove a pending job drains on worker restart'
grep -Fq "enqueue_queue_job 'token.purge'" "$production_drill" ||
  fail 'the Production drill must exercise a real in-flight handler during API restart'
grep -Fq "wait_for_job_state \"\$active_job_id\" active" "$production_drill" ||
  fail 'the in-flight restart proof must observe the job active before signalling'
grep -Fq 'restart db' "$production_drill" ||
  fail 'the Production drill must exercise PostgreSQL restart recovery'
grep -Fq 'restart nginx' "$production_drill" ||
  fail 'the Production drill must exercise Nginx restart recovery'
grep -Fq 'stop --timeout 120' "$production_drill" ||
  fail 'the Production drill must exercise a host-like full stack stop'
grep -Fq 'd --force-recreate --wait --wait-timeout 150' "$production_drill" ||
  fail 'the Production drill must recreate runtime containers over retained volumes'
grep -Fq 'named volume identity changed during recreation' "$production_drill" ||
  fail 'the Production drill must preserve exact persistent volume identity'
grep -Fq 'API container startup command may run migration/seed work' "$production_drill" ||
  fail 'the Production drill must prove normal API startup does not migrate or seed'
grep -Fq 'assert_persistent_state' "$production_drill" ||
  fail 'restart/recreate phases must verify database, migration and object persistence'
[[ "$(grep -Fc 'org.opencontainers.image.revision=$release_commit' "$production_drill")" -eq 2 ]] ||
  fail 'the Production drill must label both local candidate images with exact repository HEAD'
grep -Fq 'assert_release_identity' "$production_drill" ||
  fail 'the Production drill must pin running containers to the proved image identities'
grep -Fq 'scripts/backup/create-recovery-point.sh' "$production_drill" ||
  fail 'the Production-mode graph must create a real encrypted recovery point'
grep -Fq 'scripts/backup/restore-recovery-point.sh' "$production_drill" ||
  fail 'the Production-mode graph must restore that recovery point into empty volumes'
grep -Fq "wait_for_https_status 200 90 'post-restore application readiness'" "$production_drill" ||
  fail 'the restored Production-mode application must pass whole-platform readiness'
grep -Fq "'state-at-recovery-point' 'database rollback state'" "$production_drill" ||
  fail 'the recovery drill must prove later database state is rolled back'
grep -Fq 'restored recovery point does not name the exact source commit' "$production_drill" ||
  fail 'the recovery manifest must preserve exact release provenance'
grep -Fq 'verify-production-browser.mjs' "$production_drill" ||
  fail 'the Production drill must execute the real built application in a browser'
grep -Fq -- '--host-resolver-rules="MAP $domain 127.0.0.1"' "$production_drill" ||
  fail 'the Production browser must resolve the exact TLS hostname to the isolated loopback edge'
grep -Fq 'the real Production auth zone rate-limits browser traffic' \
  "$repo_root/scripts/deploy/verify-production-browser.mjs" ||
  fail 'the Production browser must exercise the real auth rate-limit zone'
grep -Fq 'Production browser smoke assertions (repeated after service diagnostics)' \
  "$production_drill" ||
  fail 'a failing Production browser smoke must leave its assertion evidence visible'
if grep -Fq 'issue-dev-session' "$repo_root/scripts/deploy/verify-production-browser.mjs"; then
  fail 'the Production browser smoke must not bypass Google OAuth with a development issuer'
fi
grep -Fq 'down --volumes --remove-orphans' "$production_drill" ||
  fail 'the Production drill must destroy its isolated volumes on every exit'

printf 'compose-operations guard: bounded logs, fail-closed health and isolated CI/Production drills verified\n'
