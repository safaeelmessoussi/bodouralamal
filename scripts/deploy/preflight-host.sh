#!/usr/bin/env bash
# Read-only clean-host gate for the exact Staging/Production release pipeline.
# It deliberately provisions nothing: host hardening and secret installation
# remain explicit operator actions whose result this script can inspect.
set -euo pipefail

MIN_COMPOSE_VERSION='2.24.4'
MIN_MEMORY_KIB=3700000
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
  python3 -c '
import json
import sys
from urllib.parse import unquote, urlparse

tier, domain, release, expected_node_env, deployment_state = sys.argv[1:]
model = json.load(sys.stdin)
services = model.get("services", {})
expected_services = {"api", "certbot", "db", "minio", "minio-init", "nginx"}
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
    "ONBOARDING_TOKEN_KEY", "MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY",
    "PUBLIC_BASE_URL", "STORAGE_BASE_URL",
)
if any(not api_env.get(name) for name in required):
    raise SystemExit("one or more required application settings are empty")
if tier == "production" and not api_env.get("BACKUP_TARGET_SSH"):
    raise SystemExit("Production backup target is empty")
if deployment_state == "fresh":
    if not api_env.get("SUPER_ADMIN_EMAIL"):
        raise SystemExit("fresh deployment requires SUPER_ADMIN_EMAIL")
    if api_env.get("SUPER_ADMIN_SEX") not in {"female", "male"}:
        raise SystemExit("fresh deployment requires valid SUPER_ADMIN_SEX")
if api_env.get("NODE_ENV") != expected_node_env:
    raise SystemExit("resolved runtime tier is wrong")
if api_env["PUBLIC_BASE_URL"] != f"https://{domain}":
    raise SystemExit("PUBLIC_BASE_URL does not equal the approved HTTPS origin")
if api_env["STORAGE_BASE_URL"] != f"https://{domain}/storage":
    raise SystemExit("STORAGE_BASE_URL is not the exact same-origin storage path")
if api_env["MINIO_ENDPOINT"] != "http://minio:9000":
    raise SystemExit("MINIO_ENDPOINT must remain internal-only")
if minio.get("environment", {}).get("MINIO_ROOT_USER") != api_env["MINIO_ACCESS_KEY"] or \
   minio.get("environment", {}).get("MINIO_ROOT_PASSWORD") != api_env["MINIO_SECRET_KEY"]:
    raise SystemExit("MinIO bootstrap credentials do not match application credentials")
expected_mc_host = "http://{}:{}@minio:9000".format(
    api_env["MINIO_ACCESS_KEY"], api_env["MINIO_SECRET_KEY"]
)
if minio_init.get("environment", {}).get("MC_HOST_local") != expected_mc_host:
    raise SystemExit("MinIO policy initializer credentials do not match application credentials")
if api_env["JWT_SIGNING_KEY"] == api_env["ONBOARDING_TOKEN_KEY"]:
    raise SystemExit("access and onboarding signing keys must be distinct")

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

for name, service in services.items():
    ports = service.get("ports", [])
    if name != "nginx" and ports:
        raise SystemExit(f"non-edge service publishes host ports: {name}")
edge_ports = {(str(item.get("published")), item.get("target"), item.get("protocol")) for item in nginx.get("ports", [])}
if edge_ports != {("80", 80, "tcp"), ("443", 443, "tcp")}:
    raise SystemExit("Nginx must publish exactly TCP 80 and 443")

for name, service in services.items():
    logging = service.get("logging", {})
    if logging.get("driver") != "local" or logging.get("options") != {"max-file": "5", "max-size": "10m"}:
        raise SystemExit(f"service lacks the bounded log policy: {name}")
for name in ("api", "certbot", "db", "minio", "nginx"):
    if services[name].get("restart") != "unless-stopped":
        raise SystemExit(f"long-running service lacks reboot recovery: {name}")
if set(model.get("volumes", {})) != {"db-data", "minio-data", "certbot-conf", "certbot-www"}:
    raise SystemExit("persistent volume catalogue differs from the recovery-point contract")
' "$tier" "$domain" "$release" "$expected_node_env" "$deployment_state"
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

  require_private_file "$HOME/.docker/config.json"
  python3 -c '
import json
import sys
with open(sys.argv[1], encoding="utf-8") as stream:
    config = json.load(stream)
known = "ghcr.io" in config.get("auths", {}) or "ghcr.io" in config.get("credHelpers", {})
raise SystemExit(0 if known else 1)
' "$HOME/.docker/config.json" || fail 'Docker credential configuration has no GHCR authority'

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

  for volume in bodour_db-data bodour_minio-data bodour_certbot-conf bodour_certbot-www; do
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

  if [[ "$tier" == 'production' ]]; then
    compose=(docker compose -f docker-compose.yml -f docker-compose.release.yml -f docker-compose.production.yml)
  else
    compose=(docker compose -f docker-compose.yml -f docker-compose.release.yml -f docker-compose.staging.yml)
  fi

  local resolved_json
  resolved_json="$("${compose[@]}" --profile production config --format json)" ||
    fail 'release Compose model does not resolve with the installed secret files'
  if ! printf '%s' "$resolved_json" |
    validate_resolved_compose "$tier" "$domain" "$release_tag" "$expected_node_env" "$deployment_state"; then
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
