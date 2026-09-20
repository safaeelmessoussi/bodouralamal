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
# A globally routable documentation-style address the validator is handed as the
# host's approved public IPv4, and the media server as its NODE_IP.
public_ipv4='196.70.1.1'
# One SeaweedFS model for every tier (Owner decision, 2026-09-20):
# docker-compose.yml alone already defines it, so there is no longer a
# separate storage file for either tier's resolved graph to include or omit.
resolved="$({
  MINIO_ACCESS_KEY=preflight-access \
  MINIO_SECRET_KEY=preflight-secret-password \
  LIVEKIT_API_KEY=preflight-media-key \
  LIVEKIT_API_SECRET=preflight-media-secret-more-than-thirty-two-bytes \
  LIVEKIT_NODE_IP="$public_ipv4" \
  BODOUR_RELEASE_TAG="$release" \
    docker compose \
      --file "$repo_root/docker-compose.yml" \
      --file "$repo_root/docker-compose.release.yml" \
      --file "$repo_root/docker-compose.production.yml" \
      --file "$fixture" \
      --profile production config --format json
})"
printf '%s' "$resolved" |
  validate_resolved_compose production preflight.invalid "$release" production fresh "$public_ipv4" ||
  fail 'the real release graph no longer satisfies host preflight'

# Prove the semantic validator can fail on the bypass it exists to prevent:
# one host-published API port must be rejected even when every other field is valid.
if printf '%s' "$resolved" |
  python3 -c 'import json,sys; value=json.load(sys.stdin); value["services"]["api"]["ports"]=[{"published":"3000","target":3000,"protocol":"tcp"}]; json.dump(value,sys.stdout)' |
  validate_resolved_compose production preflight.invalid "$release" production fresh "$public_ipv4" 2>/dev/null; then
  fail 'resolved-topology validator did not reject a host-published API port'
fi
# **The media rule must be able to fail** (SRS Revision 164): exactly two media
# ports and never the signalling one, a stated public address, one key pair
# shared by the application, the media server and the recorder, and no STUN.
for mutation in signalling-port extra-port loopback node-ip keys stun third-party-stun no-stun-list url; do
  if printf '%s' "$resolved" |
    python3 -c 'import json,sys; value=json.load(sys.stdin); lk=value["services"]["livekit"]
m=sys.argv[1]
if m == "signalling-port": lk["ports"].append({"published":"7880","target":7880,"protocol":"tcp"})
elif m == "extra-port": value["services"]["redis"]["ports"]=[{"published":"6379","target":6379,"protocol":"tcp"}]
elif m == "loopback": lk["ports"][0]["host_ip"]="127.0.0.1"
elif m == "node-ip": lk["environment"]["NODE_IP"]="203.0.113.9"
elif m == "keys": value["services"]["livekit-egress"]["environment"]["LIVEKIT_API_SECRET"]="a-different-secret-than-the-application-holds"
elif m == "stun": lk["environment"]["LIVEKIT_CONFIG"]=lk["environment"]["LIVEKIT_CONFIG"].replace("use_external_ip: false","use_external_ip: true")
elif m == "third-party-stun": lk["environment"]["LIVEKIT_CONFIG"]=lk["environment"]["LIVEKIT_CONFIG"].replace(":7882\n", ":7882\n    - stun.l.google.com:19302\n", 1)
elif m == "no-stun-list": lk["environment"]["LIVEKIT_CONFIG"]=lk["environment"]["LIVEKIT_CONFIG"].replace("stun_servers:", "unused_key:")
else: value["services"]["api"]["environment"]["LIVEKIT_URL"]="wss://media.example.cloud"
json.dump(value,sys.stdout)' "$mutation" |
    validate_resolved_compose production preflight.invalid "$release" production fresh "$public_ipv4" 2>/dev/null; then
    fail "resolved-topology validator did not reject an unsafe media $mutation"
  fi
done
# Replacement storage must not be a tag-only substitution or reuse MinIO bytes.
for mutation in image volume copy; do
  if printf '%s' "$resolved" |
    python3 -c 'import json,sys; value=json.load(sys.stdin)
if sys.argv[1] == "image": value["services"]["minio"]["image"] = "chrislusf/seaweedfs:4.46@sha256:" + "0" * 64
elif sys.argv[1] == "volume": value["volumes"]["minio-data"]["name"] = "bodour_minio-data"
else:
    for mount in value["services"]["minio"]["volumes"]:
        if mount["target"] == "/data": mount["volume"]["nocopy"] = False
json.dump(value,sys.stdout)' "$mutation" |
    validate_resolved_compose production preflight.invalid "$release" production fresh "$public_ipv4" 2>/dev/null; then
    fail "resolved-topology validator did not reject unsafe storage $mutation"
  fi
done
node --test "$repo_root/scripts/storage/policy.test.mjs"
unset resolved

# The Staging graph is now validated by the exact same storage assertions as
# Production's above — same pinned image, same empty nocopy restore target,
# same exact-commit S3 initializer image — because both tiers share one
# SeaweedFS model; nothing here is Staging-specific any more except NODE_ENV.
resolved="$({
  MINIO_ACCESS_KEY=preflight-access \
  MINIO_SECRET_KEY=preflight-secret-password \
  LIVEKIT_API_KEY=preflight-media-key \
  LIVEKIT_API_SECRET=preflight-media-secret-more-than-thirty-two-bytes \
  LIVEKIT_NODE_IP="$public_ipv4" \
  BODOUR_RELEASE_TAG="$release" \
    docker compose \
      --file "$repo_root/docker-compose.yml" \
      --file "$repo_root/docker-compose.release.yml" \
      --file "$repo_root/docker-compose.staging.yml" \
      --file "$fixture" \
      --profile production config --format json
})"
printf '%s' "$resolved" |
  validate_resolved_compose staging preflight.invalid "$release" development fresh "$public_ipv4" ||
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
  "sudo -n /usr/sbin/sshd -T -C" \
  "cannot inspect effective SSH daemon policy with non-interactive root authority" \
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
  "fresh deployment requires the approved Platform Owner SUPER_ADMIN_EMAIL" \
  "DNS A record does not resolve exclusively to the approved public IPv4" \
  "must not publish an unverified AAAA record" \
  'if [[ -e "$HOME/.docker/config.json" ]]' \
  "resolved application images do not match the approved commit" \
  "non-edge service publishes host ports" \
  "Nginx must publish exactly TCP 80 and 443" \
  "the media server must publish exactly 7881/tcp and 7882/udp, and never its signalling port" \
  "LIVEKIT_NODE_IP must be the approved public IPv4 of this host" \
  "the media server must not discover its address through an external STUN service" \
  "the media server must name only its own media port as a STUN server, never a third party" \
  "MIN_CPUS_PRODUCTION=4" \
  "persistent volume catalogue differs from the recovery-point contract" \
  "docker manifest inspect"; do
  grep -Fq "$invariant" "$preflight" || fail "preflight lost invariant: $invariant"
done

grep -Fq 'bash scripts/deploy/preflight-host.sh "$DEPLOYMENT_TIER" "$DOMAIN" "$EXPECTED_PUBLIC_IPV4" "$MINIMUM_FREE_GIB"' "$deployment" ||
  fail 'deployment pipeline does not invoke the host preflight'
grep -Fq 'NOPASSWD: /usr/sbin/sshd -T -C *' "$deployment" ||
  fail 'deployment runbook does not provision the SSH-policy inspection authority'
grep -Fq 'OWNER INPUT REQUIRED — PRIMARY DISK CAPACITY' "$readiness" ||
  fail 'readiness ledger must not invent a Production content-storage capacity'

printf 'host-preflight guard: executable clean-host boundary verified\n'
