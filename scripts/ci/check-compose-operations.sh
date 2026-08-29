#!/usr/bin/env bash
# The single VPS must not inherit Docker's unbounded json-file logging default.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose="$repo_root/docker-compose.yml"
deployment="$repo_root/docs/operations/deployment.md"

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

printf 'compose-operations guard: bounded logs cover %s services and deployment health fails closed\n' "$service_count"
