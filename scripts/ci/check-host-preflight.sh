#!/usr/bin/env bash
# The clean-host runbook must retain an executable, fail-closed preflight. This
# is a source guard plus direct unit checks for the parsers shared by the host
# entry point; actual Docker/DNS/GHCR checks run only on the target VPS.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
preflight="$repo_root/scripts/deploy/preflight-host.sh"
deployment="$repo_root/docs/operations/deployment.md"
readiness="$repo_root/docs/operations/deployment-readiness.md"
fixture="$repo_root/scripts/ci/fixtures/docker-compose.host-preflight.yml"

[[ -x "$preflight" ]] || fail 'the host preflight is missing or not executable'
bash -n "$preflight"
# shellcheck source=scripts/deploy/preflight-host.sh
source "$preflight"

# Sourcing the production entry point intentionally exposes only its pure
# parser helpers; restore this guard's own diagnostic after the source.
fail() {
  printf 'host-preflight guard: %s\n' "$1" >&2
  exit 1
}

version_at_least 2.24.4 2.24.4 || fail 'minimum Compose version must accept itself'
version_at_least 2.25.0 2.24.4 || fail 'newer Compose versions must be accepted'
version_at_least 5.5.0 2.24.4 || fail 'Compose v5 must remain accepted'
if version_at_least 2.24.3 2.24.4; then
  fail 'older Compose versions must be refused'
fi
valid_domain bodouralamal.com || fail 'valid domain parser regression'
if valid_domain 'https://bodouralamal.com/path'; then
  fail 'domain parser must refuse URLs and paths'
fi
valid_public_ipv4 196.70.1.1 || fail 'globally routed IPv4 parser regression'
if valid_public_ipv4 127.0.0.1 || valid_public_ipv4 10.0.0.1; then
  fail 'loopback/private addresses must not pass as the public host coordinate'
fi

release='ffffffffffffffffffffffffffffffffffffffff'
resolved="$({
  MINIO_ACCESS_KEY=preflight-access \
  MINIO_SECRET_KEY=preflight-secret-password \
  BODOUR_RELEASE_TAG="$release" \
    docker compose \
      --file "$repo_root/docker-compose.yml" \
      --file "$repo_root/docker-compose.release.yml" \
      --file "$repo_root/docker-compose.production.yml" \
      --file "$fixture" \
      --profile production config --format json
})"
printf '%s' "$resolved" |
  validate_resolved_compose production preflight.invalid "$release" production fresh ||
  fail 'the real release graph no longer satisfies host preflight'

# Prove the semantic validator can fail on the bypass it exists to prevent:
# one host-published API port must be rejected even when every other field is valid.
if printf '%s' "$resolved" |
  python3 -c 'import json,sys; value=json.load(sys.stdin); value["services"]["api"]["ports"]=[{"published":"3000","target":3000,"protocol":"tcp"}]; json.dump(value,sys.stdout)' |
  validate_resolved_compose production preflight.invalid "$release" production fresh 2>/dev/null; then
  fail 'resolved-topology validator did not reject a host-published API port'
fi
unset resolved

resolved="$({
  MINIO_ACCESS_KEY=preflight-access \
  MINIO_SECRET_KEY=preflight-secret-password \
  BODOUR_RELEASE_TAG="$release" \
    docker compose \
      --file "$repo_root/docker-compose.yml" \
      --file "$repo_root/docker-compose.release.yml" \
      --file "$repo_root/docker-compose.staging.yml" \
      --file "$fixture" \
      --profile production config --format json
})"
printf '%s' "$resolved" |
  validate_resolved_compose staging preflight.invalid "$release" development fresh ||
  fail 'the real Staging release graph no longer satisfies host preflight'
unset resolved

for invariant in \
  "MIN_COMPOSE_VERSION='2.24.4'" \
  "EXPECTED_CHECKOUT='/opt/bodour'" \
  "22.04|24.04" \
  "host architecture must be x86_64/amd64" \
  "host has a pending required reboot" \
  "Docker must use a local Unix socket, never a TCP daemon" \
  "rootless Docker is outside the backed-up/reboot-tested deployment topology" \
  "SSH password login must be disabled" \
  "host firewall is not active" \
  "automatic Ubuntu security-update timer must be enabled" \
  "host clock is not NTP-synchronized" \
  "host timezone must be Etc/UTC" \
  "host journal SystemMaxUse must be 500M" \
  "must have mode 600" \
  "Docker data root must be on persistent host storage" \
  "approved floor is" \
  "partial persistent-volume set requires recovery review before deployment" \
  "fresh deployment requires SUPER_ADMIN_EMAIL" \
  "DNS A record does not resolve exclusively to the approved public IPv4" \
  "must not publish an unverified AAAA record" \
  "Docker credential configuration has no GHCR authority" \
  "resolved application images do not match the approved commit" \
  "non-edge service publishes host ports" \
  "Nginx must publish exactly TCP 80 and 443" \
  "persistent volume catalogue differs from the recovery-point contract" \
  "docker manifest inspect"; do
  grep -Fq "$invariant" "$preflight" || fail "preflight lost invariant: $invariant"
done

grep -Fq 'bash scripts/deploy/preflight-host.sh "$DEPLOYMENT_TIER" "$DOMAIN" "$EXPECTED_PUBLIC_IPV4" "$MINIMUM_FREE_GIB"' "$deployment" ||
  fail 'deployment pipeline does not invoke the host preflight'
grep -Fq 'OWNER INPUT REQUIRED — PRIMARY DISK CAPACITY' "$readiness" ||
  fail 'readiness ledger must not invent a Production content-storage capacity'

printf 'host-preflight guard: executable clean-host boundary verified\n'
