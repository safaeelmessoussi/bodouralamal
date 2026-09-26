#!/usr/bin/env bash
# Read-only clean-host gate for the exact Staging/Production release pipeline.
# It deliberately provisions nothing: host hardening and secret installation
# remain explicit operator actions whose result this script can inspect.
set -euo pipefail

MIN_COMPOSE_VERSION='2.24.4'
MIN_MEMORY_KIB=3700000
# **CPU floors, MEASURED — not the media vendor's default** (SRS Revision 164,
# `docs/development/online-class-provider.md`). One 720p room recording peaks at
# ~1.9 cores. Two cores therefore carry ONE recording with the rest of the stack
# slowed for its length — acceptable where the data is synthetic, and not where
# real beneficiaries are being served at the same moment.
MIN_CPUS_STAGING=2
MIN_CPUS_PRODUCTION=4
EXPECTED_CHECKOUT='/opt/bodour'

fail() {
  printf 'host-preflight: FAIL — %s\n' "$1" >&2
  exit 1
}

version_at_least() {
  local actual="${1#v}" required="${2#v}"
  [[ -n "$actual" && -n "$required" ]] || return 1
  [[ "$(printf '%s\n%s\n' "$required" "$actual" | sort -V | head -n 1)" == "$required" ]]
}

valid_domain() {
  local value="$1"
  [[ "$value" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]]
}

valid_public_ipv4() {
  python3 -c '
import ipaddress
import sys
try:
    address = ipaddress.ip_address(sys.argv[1])
except ValueError:
    raise SystemExit(1)
raise SystemExit(0 if address.version == 4 and address.is_global else 1)
' "$1"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is missing: $1"
}

require_private_file() {
  local path="$1" owner mode
  [[ -f "$path" && ! -L "$path" ]] || fail "$path must be a regular non-symlink file"
  owner="$(stat -c '%U' "$path")"
  mode="$(stat -c '%a' "$path")"
  [[ "$owner" == "$(id -un)" ]] || fail "$path must be owned by the deployment user"
  [[ "$mode" == '600' ]] || fail "$path must have mode 600 (found $mode)"
}

validate_resolved_compose() {
  local tier="$1" domain="$2" release="$3" expected_node_env="$4" deployment_state="$5"
  local expected_ipv4="$6"
  local storage_image
  storage_image="$(awk '/^    image: chrislusf\/seaweedfs:/ { print $2 }' "$(dirname "${BASH_SOURCE[0]}")/../../docker-compose.yml")"
  python3 -c '
import json
import sys
from urllib.parse import unquote, urlparse

tier, domain, release, expected_node_env, deployment_state, storage_image, expected_ipv4 = sys.argv[1:]
model = json.load(sys.stdin)
services = model.get("services", {})
expected_services = {
    "api", "certbot", "db", "minio", "minio-init", "nginx",
    # SRS Revision 164 — the self-hosted media stack, the same on every tier.
    "livekit", "livekit-egress", "redis",
}
if set(services) != expected_services:
    raise SystemExit("resolved service catalogue differs from the audited release topology")

api = services["api"]
nginx = services["nginx"]
db = services["db"]
minio = services["minio"]
minio_init = services["minio-init"]
api_env = api.get("environment", {})
db_env = db.get("environment", {})
required = (
    "DATABASE_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "JWT_SIGNING_KEY",
    "ONBOARDING_TOKEN_KEY", "EMAIL_LOCK_KEY", "MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY",
    "PUBLIC_BASE_URL", "STORAGE_BASE_URL",
    # SRS Revision 164 — online classes are part of every release tier.
    "LIVEKIT_URL", "LIVEKIT_API_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET",
)
if any(not api_env.get(name) for name in required):
    raise SystemExit("one or more required application settings are empty")
if tier == "production" and not api_env.get("BACKUP_TARGET_SSH"):
    raise SystemExit("Production backup target is empty")
if deployment_state == "fresh":
    if api_env.get("SUPER_ADMIN_EMAIL", "").strip().lower() != "safae.elmessoussi@gmail.com":
        raise SystemExit("fresh deployment requires the approved Platform Owner SUPER_ADMIN_EMAIL")
    if api_env.get("SUPER_ADMIN_SEX") != "female":
        raise SystemExit("fresh deployment requires the approved Platform Owner SUPER_ADMIN_SEX")
if api_env.get("NODE_ENV") != expected_node_env:
    raise SystemExit("resolved runtime tier is wrong")
if api_env["PUBLIC_BASE_URL"] != f"https://{domain}":
    raise SystemExit("PUBLIC_BASE_URL does not equal the approved HTTPS origin")
if api_env["STORAGE_BASE_URL"] != f"https://{domain}/storage":
    raise SystemExit("STORAGE_BASE_URL is not the exact same-origin storage path")
if api_env["MINIO_ENDPOINT"] != "http://minio:9000":
    raise SystemExit("MINIO_ENDPOINT must remain internal-only")
# One SeaweedFS model for every tier (Owner decision, 2026-09-20): these
# checks used to run only for tier == "production" while Staging kept real
# MinIO. There is no such split any more — the same pinned image, empty
# separately-named restore target, disabled auxiliary services and
# exact-image S3 initializer are required everywhere.
if not storage_image or minio.get("image") != storage_image:
    raise SystemExit("the accepted pinned object store is required")
if model.get("volumes", {}).get("minio-data", {}).get("name") != model.get("name", "") + "_seaweedfs-data":
    raise SystemExit("must not mount legacy MinIO data")
data_mounts = [mount for mount in minio.get("volumes", []) if mount.get("target") == "/data"]
if len(data_mounts) != 1 or data_mounts[0].get("source") != "minio-data" or \
   data_mounts[0].get("volume", {}).get("nocopy") is not True:
    raise SystemExit("storage requires an empty, separately named restore target")
command = " ".join(minio.get("command", []))
for flag in ("-master.telemetry=false", "-admin.ui=false", "-webdav=false", "-s3.port.iceberg=0", "-s3.port.lance=0", "-s3.iam=false"):
    if flag not in command:
        raise SystemExit("storage exposes an unsupported auxiliary service")
if minio.get("environment", {}).get("AWS_ACCESS_KEY_ID") != api_env["MINIO_ACCESS_KEY"] or \
   minio.get("environment", {}).get("AWS_SECRET_ACCESS_KEY") != api_env["MINIO_SECRET_KEY"]:
    raise SystemExit("object-store bootstrap credentials do not match application credentials")
init_env = minio_init.get("environment", {})
if any(init_env.get(key) != api_env[key] for key in ("MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY")):
    raise SystemExit("S3 initializer credentials do not match application credentials")
if minio_init.get("image") != api.get("image"):
    raise SystemExit("S3 initializer must use the exact accepted API image")
if api_env["JWT_SIGNING_KEY"] == api_env["ONBOARDING_TOKEN_KEY"]:
    raise SystemExit("access and onboarding signing keys must be distinct")
if len(api_env["EMAIL_LOCK_KEY"].encode()) < 32 or api_env["EMAIL_LOCK_KEY"] in (
    api_env["JWT_SIGNING_KEY"], api_env["ONBOARDING_TOKEN_KEY"]
):
    raise SystemExit("EMAIL_LOCK_KEY must be a dedicated key of at least 32 bytes")

database = urlparse(api_env["DATABASE_URL"])
if database.scheme not in {"postgres", "postgresql"} or (
    database.hostname, database.port, database.username, database.path
) != ("db", 5432, "app", "/bodour"):
    raise SystemExit("DATABASE_URL is outside the audited internal PostgreSQL coordinate")
if unquote(database.password or "") != db_env.get("POSTGRES_PASSWORD"):
    raise SystemExit("DATABASE_URL password does not match infra.env")

api_image = f"ghcr.io/safaeelmessoussi/bodouralamal-api:{release}"
web_image = f"ghcr.io/safaeelmessoussi/bodouralamal-web:{release}"
if api.get("image") != api_image or nginx.get("image") != web_image:
    raise SystemExit("resolved application images do not match the approved commit")

# **Exactly four host ports, and which service owns each** (SRS Revision 164).
# WebRTC media is UDP with a TCP fallback and cannot pass through a web proxy, so
# the media server owns two; the signalling port (7880) is proxied by Nginx as
# `/rtc` and must NEVER be published, and nothing else may publish anything.
livekit = services["livekit"]
for name, service in services.items():
    ports = service.get("ports", [])
    if name not in ("nginx", "livekit") and ports:
        raise SystemExit(f"non-edge service publishes host ports: {name}")
def published(service):
    return {(str(item.get("published")), item.get("target"), item.get("protocol")) for item in service.get("ports", [])}
if published(nginx) != {("80", 80, "tcp"), ("443", 443, "tcp")}:
    raise SystemExit("Nginx must publish exactly TCP 80 and 443")
if published(livekit) != {("7881", 7881, "tcp"), ("7882", 7882, "udp")}:
    raise SystemExit("the media server must publish exactly 7881/tcp and 7882/udp, and never its signalling port")
if any(item.get("host_ip") not in (None, "", "0.0.0.0") for item in livekit.get("ports", [])):
    raise SystemExit("release media ports must not be bound to loopback")

# The settings of the media stack, held to those of the application.
egress = services["livekit-egress"]
livekit_env = livekit.get("environment", {})
egress_env = egress.get("environment", {})
if api_env["LIVEKIT_URL"] != f"wss://{domain}":
    raise SystemExit("LIVEKIT_URL must be the same-origin wss:// address of this domain (signalling is proxied as /rtc)")
if api_env["LIVEKIT_API_URL"] != "http://livekit:7880":
    raise SystemExit("LIVEKIT_API_URL must remain the internal media-server address")
if len(api_env["LIVEKIT_API_SECRET"].encode()) < 32:
    raise SystemExit("LIVEKIT_API_SECRET must be at least 32 bytes")
if api_env["LIVEKIT_API_SECRET"] in (
    api_env["JWT_SIGNING_KEY"], api_env["ONBOARDING_TOKEN_KEY"], api_env["EMAIL_LOCK_KEY"], api_env["MINIO_SECRET_KEY"]
):
    raise SystemExit("LIVEKIT_API_SECRET must be a dedicated secret")
if livekit_env.get("LIVEKIT_KEYS") != "{}: {}".format(api_env["LIVEKIT_API_KEY"], api_env["LIVEKIT_API_SECRET"]):
    raise SystemExit("media-server key pair does not match the application key pair")
if any(egress_env.get(key) != api_env[key] for key in ("LIVEKIT_API_KEY", "LIVEKIT_API_SECRET")):
    raise SystemExit("recorder key pair does not match the application key pair")
# Stated, never discovered: asking a public STUN service for the address of this
# host would be the one third-party call in the whole media path.
if livekit_env.get("NODE_IP") != expected_ipv4:
    raise SystemExit("LIVEKIT_NODE_IP must be the approved public IPv4 of this host")
if "use_external_ip: false" not in livekit_env.get("LIVEKIT_CONFIG", ""):
    raise SystemExit("the media server must not discover its address through an external STUN service")
# With an empty list the media server hands every client the public STUN servers
# of Twilio and Google. The only entry allowed is on this host.
stun_block = []
for line in livekit_env.get("LIVEKIT_CONFIG", "").split("stun_servers:")[-1].splitlines()[1:]:
    if line.strip().startswith("- "):
        stun_block.append(line.strip()[2:].strip())
    elif line.strip() and not line.strip().startswith("#"):
        break
# Port 3478 on this host, where nothing listens - never the media port, which a
# plain STUN request spoils for the real connection of the same client (measured).
if stun_block != [f"{expected_ipv4}:3478"]:
    raise SystemExit("the media server must name only a dead port on this host as its STUN server, never a third party and never the media port")
if "udp_port: 7882" not in livekit_env.get("LIVEKIT_CONFIG", "") or "tcp_port: 7881" not in livekit_env.get("LIVEKIT_CONFIG", ""):
    raise SystemExit("the media server must use the single published UDP and TCP media ports")
for key in ("EGRESS_VIDEO_CPU_COST", "EGRESS_AUDIO_CPU_COST"):
    try:
        cost = float(egress_env.get(key, ""))
    except ValueError:
        raise SystemExit(f"{key} must be a number of CPU cores")
    if cost <= 0:
        raise SystemExit(f"{key} must be positive")

for name, service in services.items():
    logging = service.get("logging", {})
    if logging.get("driver") != "local" or logging.get("options") != {"max-file": "5", "max-size": "10m"}:
        raise SystemExit(f"service lacks the bounded log policy: {name}")
for name in ("api", "certbot", "db", "minio", "nginx", "livekit", "livekit-egress", "redis"):
    if services[name].get("restart") != "unless-stopped":
        raise SystemExit(f"long-running service lacks reboot recovery: {name}")
if set(model.get("volumes", {})) != {"db-data", "minio-data", "certbot-conf", "certbot-www"}:
    raise SystemExit("persistent volume catalogue differs from the recovery-point contract")
' "$tier" "$domain" "$release" "$expected_node_env" "$deployment_state" "$storage_image" "$expected_ipv4"
}

main() {
  if [[ "$#" -ne 4 ]]; then
    printf 'usage: BODOUR_RELEASE_TAG=<40-char-commit> %s <staging|production> <domain> <expected-public-ipv4> <minimum-free-GiB>\n' "$0" >&2
    exit 2
  fi

  local tier="$1" domain="$2" expected_ipv4="$3" minimum_free_gib="$4"
  local release_tag="${BODOUR_RELEASE_TAG:-}"
  local expected_node_env compose_version docker_endpoint docker_root docker_fs
  local memory_kib swap_kib available_bytes minimum_free_bytes available_gib repo_owner repo_mode
  local deployment_state existing_volume_count=0
  local -a compose resolved_a resolved_aaaa

  case "$tier" in
    staging) expected_node_env='development' ;;
    production) expected_node_env='production' ;;
    *) fail 'tier must be staging or production' ;;
  esac
  valid_domain "$domain" || fail 'domain must be a plain DNS name'
  valid_public_ipv4 "$expected_ipv4" || fail 'expected IPv4 must be a globally routable IPv4 address'
  [[ "$minimum_free_gib" =~ ^[1-9][0-9]*$ ]] ||
    fail 'minimum free disk must be an approved positive whole GiB value'
  [[ "$release_tag" =~ ^[0-9a-f]{40}$ ]] ||
    fail 'BODOUR_RELEASE_TAG must be the approved 40-character commit'

  for command in git docker python3 sort stat df findmnt dig sudo systemctl systemd-analyze timedatectl; do
    require_command "$command"
  done
  [[ -x /usr/sbin/sshd ]] || fail 'required SSH daemon is missing: /usr/sbin/sshd'

  # The published release images are built on linux/amd64. Ubuntu derivatives
  # are deliberately not treated as Ubuntu: Docker does not test them as such.
  # shellcheck disable=SC1091
  source /etc/os-release
  [[ "${ID:-}" == 'ubuntu' ]] || fail 'host must be Ubuntu Server'
  case "${VERSION_ID:-}" in
    22.04|24.04) ;;
    *) fail 'supported host releases are Ubuntu 22.04 LTS and 24.04 LTS' ;;
  esac
  [[ ! -e /var/run/reboot-required ]] || fail 'host has a pending required reboot'
  [[ "$(uname -m)" == 'x86_64' ]] || fail 'host architecture must be x86_64/amd64'
  [[ "$(id -u)" -ne 0 ]] || fail 'run as the dedicated non-root deployment user'
  id -nG | tr ' ' '\n' | grep -Fxq docker ||
    fail 'deployment user must belong to the root-equivalent docker group'

  local ssh_dir="$HOME/.ssh" ssh_effective journal_effective
  [[ -d "$ssh_dir" && ! -L "$ssh_dir" ]] || fail 'deployment user must have a real .ssh directory'
  [[ "$(stat -c '%U:%a' "$ssh_dir")" == "$(id -un):700" ]] ||
    fail 'deployment user .ssh directory must be owner-only mode 700'
  require_private_file "$ssh_dir/authorized_keys"
  # sshd -T reads root-only host keys and included configuration even though it
  # never starts a daemon. Keep those files private and grant only this
  # non-interactive inspection command to the deployment account.
  ssh_effective="$(sudo -n /usr/sbin/sshd -T -C "user=$(id -un),host=$domain,addr=127.0.0.1")" ||
    fail 'cannot inspect effective SSH daemon policy with non-interactive root authority'
  grep -Fxq 'permitrootlogin no' <<<"$ssh_effective" || fail 'SSH root login must be disabled'
  grep -Fxq 'passwordauthentication no' <<<"$ssh_effective" || fail 'SSH password login must be disabled'
  grep -Fxq 'kbdinteractiveauthentication no' <<<"$ssh_effective" ||
    fail 'SSH keyboard-interactive login must be disabled'
  grep -Fxq 'pubkeyauthentication yes' <<<"$ssh_effective" || fail 'SSH public-key login must be enabled'
  unset ssh_effective

  systemctl is-enabled --quiet docker || fail 'Docker must be enabled at boot'
  systemctl is-active --quiet docker || fail 'Docker daemon is not active'
  systemctl is-enabled --quiet containerd || fail 'containerd must be enabled at boot'
  systemctl is-active --quiet containerd || fail 'containerd is not active'
  systemctl is-enabled --quiet ssh || fail 'SSH daemon must be enabled at boot'
  systemctl is-active --quiet ssh || fail 'SSH daemon is not active'
  systemctl is-enabled --quiet ufw || fail 'host firewall must be enabled at boot'
  systemctl is-active --quiet ufw || fail 'host firewall is not active'
  systemctl is-enabled --quiet apt-daily-upgrade.timer ||
    fail 'automatic Ubuntu security-update timer must be enabled'

  docker_endpoint="$(docker context inspect --format '{{.Endpoints.docker.Host}}')" ||
    fail 'cannot inspect the active Docker context'
  [[ "$docker_endpoint" == unix://* ]] || fail 'Docker must use a local Unix socket, never a TCP daemon'
  [[ "$(docker info --format '{{.OSType}}')" == 'linux' ]] || fail 'Docker server must be Linux'
  [[ "$(docker info --format '{{.Architecture}}')" == 'x86_64' ]] ||
    fail 'Docker server architecture must be x86_64/amd64'
  if docker info --format '{{json .SecurityOptions}}' | grep -Fq 'rootless'; then
    fail 'rootless Docker is outside the backed-up/reboot-tested deployment topology'
  fi

  compose_version="$(docker compose version --short)" || fail 'Docker Compose plugin is unavailable'
  version_at_least "$compose_version" "$MIN_COMPOSE_VERSION" ||
    fail "Docker Compose $MIN_COMPOSE_VERSION or newer is required (found $compose_version)"

  # **The four-CPU floor is about RECORDING, so the tier is asked rather than
  # assumed** (R175 §1). `MIN_CPUS_PRODUCTION=4` stands: one 720p recording
  # measures 1.7–1.9 cores continuously (R164 §5), so a Production host that
  # records classes needs them. A tier that records NOTHING — the temporary
  # public-reading Production the Owner authorised on 2026-09-26 — declares it
  # with `BODOUR_TIER_RECORDS=no`, and the declaration is printed, not
  # swallowed: a host that cannot record must never be discovered to be one
  # while a class is waiting. Absent means it records, which is every ordinary
  # Production host.
  local cpus minimum_cpus records
  cpus="$(nproc)"
  records="${BODOUR_TIER_RECORDS:-yes}"
  [[ "$records" == 'yes' || "$records" == 'no' ]] ||
    fail 'BODOUR_TIER_RECORDS must be yes or no'
  if [[ "$tier" == production && "$records" == 'no' ]]; then
    minimum_cpus="$MIN_CPUS_STAGING"
    printf 'host-preflight: NOTE — this tier declares it records no online class (BODOUR_TIER_RECORDS=no); the %s-CPU recording floor is not applied and recording is NOT supported here\n' "$MIN_CPUS_PRODUCTION"
  elif [[ "$tier" == production ]]; then
    minimum_cpus="$MIN_CPUS_PRODUCTION"
  else
    minimum_cpus="$MIN_CPUS_STAGING"
  fi
  [[ "$cpus" =~ ^[0-9]+$ && "$cpus" -ge "$minimum_cpus" ]] ||
    fail "host has ${cpus:-unknown} CPU(s); a $tier host recording online classes needs at least $minimum_cpus"

  memory_kib="$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)"
  swap_kib="$(awk '/^SwapTotal:/ { print $2 }' /proc/meminfo)"
  [[ "$memory_kib" =~ ^[0-9]+$ && "$memory_kib" -ge "$MIN_MEMORY_KIB" ]] ||
    fail 'host must expose at least the usable memory of a 4 GB VPS'
  [[ "$swap_kib" =~ ^[0-9]+$ && "$swap_kib" -gt 0 ]] ||
    fail 'host must have swap allocated (the SRS does not authorize an invented size)'
  [[ "$(timedatectl show --property=NTPSynchronized --value)" == 'yes' ]] ||
    fail 'host clock is not NTP-synchronized'
  [[ "$(timedatectl show --property=Timezone --value)" == 'Etc/UTC' ]] ||
    fail 'host timezone must be Etc/UTC; application containers set Africa/Casablanca'
  journal_effective="$(systemd-analyze cat-config systemd/journald.conf)" ||
    fail 'cannot inspect host journal limits'
  [[ "$(awk -F= '/^SystemMaxUse=/ { value=$2 } END { print value }' <<<"$journal_effective")" == '500M' ]] ||
    fail 'host journal SystemMaxUse must be 500M'
  [[ "$(awk -F= '/^SystemKeepFree=/ { value=$2 } END { print value }' <<<"$journal_effective")" == '2G' ]] ||
    fail 'host journal SystemKeepFree must be 2G'
  [[ "$(awk -F= '/^RuntimeMaxUse=/ { value=$2 } END { print value }' <<<"$journal_effective")" == '100M' ]] ||
    fail 'host journal RuntimeMaxUse must be 100M'
  unset journal_effective

  local repo_root
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || fail 'run from the deployment checkout'
  [[ "$repo_root" == "$EXPECTED_CHECKOUT" ]] || fail "deployment checkout must be $EXPECTED_CHECKOUT"
  cd "$repo_root"
  repo_owner="$(stat -c '%U' "$repo_root")"
  repo_mode="$(stat -c '%a' "$repo_root")"
  [[ "$repo_owner" == "$(id -un)" ]] || fail 'deployment checkout must be owned by the deployment user'
  (( (8#$repo_mode & 8#022) == 0 )) || fail 'deployment checkout must not be group/world writable'
  [[ "$(git rev-parse HEAD)" == "$release_tag" ]] || fail 'checkout HEAD does not match BODOUR_RELEASE_TAG'
  ! git symbolic-ref -q HEAD >/dev/null || fail 'release checkout must be detached at the approved commit'
  [[ -z "$(git status --porcelain)" ]] || fail 'release checkout has tracked or untracked changes'
  require_private_file .env
  require_private_file infra.env

  # Public GHCR packages need no credential file. If a future/private package
  # requires one, protect it like every other operator secret; the manifest
  # probes below remain the authoritative proof that this account can read the
  # two exact artifacts.
  if [[ -e "$HOME/.docker/config.json" ]]; then
    require_private_file "$HOME/.docker/config.json"
  fi

  docker_root="$(docker info --format '{{.DockerRootDir}}')"
  [[ -d "$docker_root" ]] || fail 'Docker data root is not an accessible directory'
  docker_fs="$(findmnt --noheadings --output FSTYPE --target "$docker_root" | head -n 1)"
  case "$docker_fs" in
    tmpfs|overlay|overlayfs) fail 'Docker data root must be on persistent host storage' ;;
  esac
  available_bytes="$(df --block-size=1 --output=avail "$docker_root" | tail -n 1 | tr -d ' ')"
  minimum_free_bytes=$((minimum_free_gib * 1024 * 1024 * 1024))
  available_gib=$((available_bytes / 1024 / 1024 / 1024))
  [[ "$available_bytes" =~ ^[0-9]+$ && "$available_bytes" -ge "$minimum_free_bytes" ]] ||
    fail "Docker data filesystem has ${available_gib:-unknown} GiB free; approved floor is $minimum_free_gib GiB"

  # One SeaweedFS model for every tier (Owner decision, 2026-09-20): both
  # Staging and Production now expect the same physical volume name, and
  # neither tolerates a legacy real-MinIO volume left over from before that
  # decision — this pipeline does not perform an in-place cross-vendor
  # migration, so an operator must explicitly remove the old volume first.
  if docker volume inspect bodour_minio-data >/dev/null 2>&1; then
    fail 'legacy MinIO volume found; remove it explicitly before this pipeline runs (Owner-authorized migration, 2026-09-20)'
  fi
  for volume in bodour_db-data bodour_seaweedfs-data bodour_certbot-conf bodour_certbot-www; do
    if docker volume inspect "$volume" >/dev/null 2>&1; then
      existing_volume_count=$((existing_volume_count + 1))
    fi
  done
  case "$existing_volume_count" in
    0) deployment_state='fresh' ;;
    4) deployment_state='existing' ;;
    *) fail 'partial persistent-volume set requires recovery review before deployment' ;;
  esac

  mapfile -t resolved_a < <(dig +short "$domain" A | grep -E '^[0-9]+(\.[0-9]+){3}$' | sort -u)
  [[ "${#resolved_a[@]}" -eq 1 && "${resolved_a[0]}" == "$expected_ipv4" ]] ||
    fail 'DNS A record does not resolve exclusively to the approved public IPv4'
  mapfile -t resolved_aaaa < <(dig +short "$domain" AAAA | grep -E '^[0-9A-Fa-f:]+$' | sort -u)
  [[ "${#resolved_aaaa[@]}" -eq 0 ]] ||
    fail 'IPv4-only launch host must not publish an unverified AAAA record'

  # One SeaweedFS model for every tier (Owner decision, 2026-09-20):
  # docker-compose.yml already defines it, so there is no longer a separate
  # storage overlay for either tier to include or omit — Staging and
  # Production differ only by which single tier overlay sits beside the
  # shared release overlay.
  if [[ "$tier" == 'production' ]]; then
    compose=(docker compose -f docker-compose.yml -f docker-compose.release.yml -f docker-compose.production.yml)
  else
    compose=(docker compose -f docker-compose.yml -f docker-compose.release.yml -f docker-compose.staging.yml)
  fi

  local resolved_json
  resolved_json="$("${compose[@]}" --profile production config --format json)" ||
    fail 'release Compose model does not resolve with the installed secret files'
  if ! printf '%s' "$resolved_json" |
    validate_resolved_compose "$tier" "$domain" "$release_tag" "$expected_node_env" "$deployment_state" "$expected_ipv4"; then
    unset resolved_json
    fail 'resolved release configuration violates the audited deployment boundary'
  fi
  unset resolved_json

  docker manifest inspect "ghcr.io/safaeelmessoussi/bodouralamal-api:$release_tag" >/dev/null ||
    fail 'exact API image is unavailable or GHCR read authority is missing'
  docker manifest inspect "ghcr.io/safaeelmessoussi/bodouralamal-web:$release_tag" >/dev/null ||
    fail 'exact web image is unavailable or GHCR read authority is missing'

  printf 'host-preflight: PASS — %s is ready to run the exact %s deployment pipeline\n' "$domain" "$tier"
  printf 'host-preflight: NOTE — this is host/configuration evidence, not a deployment or backup/restore claim\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
