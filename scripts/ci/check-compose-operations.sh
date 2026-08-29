#!/usr/bin/env bash
# The single VPS must not inherit Docker's unbounded json-file logging default.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose="$repo_root/docker-compose.yml"
deployment="$repo_root/docs/operations/deployment.md"
workflow="$repo_root/.github/workflows/ci.yml"
integration_runner="$repo_root/scripts/ci/test-integration.sh"
integration_overlay="$repo_root/scripts/ci/fixtures/docker-compose.integration.yml"

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

printf 'compose-operations guard: bounded logs, fail-closed health and isolated CI stack verified\n'
