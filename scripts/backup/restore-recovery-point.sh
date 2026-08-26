#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/backup/common.sh
source "$repo_root/scripts/backup/common.sh"

project='bodour'
repository=''
password_file=''
ssh_dir=''
snapshot='latest'
allow_fixtures=false
production_confirmation=''
compose_files=()
volume_names=()
recovered_config_dir=''

usage() {
  cat <<'USAGE'
Usage: restore-recovery-point.sh --repository <absolute-path|user@host:/path>
       --password-file <root-only-file> --recovered-config-dir <empty-dir>
       [options]

The target compose project must be stopped and every target volume must be empty.
Production additionally requires:
  --confirm-production-restore RESTORE_TO_EMPTY_PRODUCTION_VOLUMES

Options:
  --project <compose-project>       Default: bodour
  --compose-file <path>             Repeatable; default: docker-compose.yml
  --volume <logical-compose-name>   Repeatable; defaults to all four data volumes
  --snapshot <id|latest>            Default: latest
  --ssh-dir <path>                  Required for an SFTP repository
  --allow-fixtures                   Local disposable drills only; forbids SFTP
USAGE
}

while (($#)); do
  case "$1" in
    --project) project="${2:-}"; shift 2 ;;
    --repository) repository="${2:-}"; shift 2 ;;
    --password-file) password_file="${2:-}"; shift 2 ;;
    --ssh-dir) ssh_dir="${2:-}"; shift 2 ;;
    --snapshot) snapshot="${2:-}"; shift 2 ;;
    --compose-file) compose_files+=("${2:-}"); shift 2 ;;
    --volume) volume_names+=("${2:-}"); shift 2 ;;
    --recovered-config-dir) recovered_config_dir="${2:-}"; shift 2 ;;
    --confirm-production-restore) production_confirmation="${2:-}"; shift 2 ;;
    --allow-fixtures) allow_fixtures=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; backup_die "unknown argument: $1" ;;
  esac
done

backup_require_command docker
[[ -n "$repository" ]] || backup_die '--repository is required'
[[ -n "$password_file" ]] || backup_die '--password-file is required'
[[ -n "$recovered_config_dir" ]] || backup_die '--recovered-config-dir is required'
backup_require_secret_file "$password_file"
repository="$(backup_normalize_repository "$repository")"

if $allow_fixtures; then
  backup_assert_fixture_repository "$repository"
else
  backup_assert_production_repository "$repository"
  [[ "$production_confirmation" == 'RESTORE_TO_EMPTY_PRODUCTION_VOLUMES' ]] ||
    backup_die 'the exact Production restore confirmation is required'
  [[ -d "$ssh_dir" && -f "$ssh_dir/known_hosts" ]] ||
    backup_die 'a pinned SSH directory is required for Production restore'
fi

((${#compose_files[@]})) || compose_files+=("$repo_root/docker-compose.yml")
((${#volume_names[@]})) || volume_names+=(db-data minio-data certbot-conf certbot-www)

compose=(docker compose --project-name "$project")
for file in "${compose_files[@]}"; do
  [[ -f "$file" ]] || backup_die "compose file does not exist: $file"
  compose+=(--file "$file")
done

[[ -z "$("${compose[@]}" ps --services --status running)" ]] ||
  backup_die 'restore target has running services; stop it before restoring'
[[ ! -e "$recovered_config_dir" ]] ||
  backup_die 'recovered config destination must not already exist'

# `create` materializes named empty volumes without starting any data process.
"${compose[@]}" create >/dev/null

declare -A actual_volumes=()
for logical in "${volume_names[@]}"; do
  actual="$(backup_resolve_volume "$project" "$logical")"
  actual_volumes["$logical"]="$actual"
  if ! docker run --rm --entrypoint /bin/sh \
    --volume "$actual:/check:ro" "$RESTIC_IMAGE" \
    -c 'test -z "$(find /check -mindepth 1 -print -quit)"'; then
    backup_die "restore target volume is not empty: $project/$logical"
  fi
done

umask 077
workdir="$(mktemp -d /tmp/bodour-restore.XXXXXXXX)"
recovered_snapshot="$workdir/snapshot"
mkdir -p "$recovered_snapshot"
cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  backup_safe_remove_workdir "$workdir"
  exit "$rc"
}
trap cleanup EXIT INT TERM

restic_docker=(docker run --rm
  --env RESTIC_PASSWORD_FILE=/run/secrets/restic-password
  --volume "$password_file:/run/secrets/restic-password:ro")
restic_repository="$repository"
if backup_is_sftp_repository "$repository"; then
  restic_docker+=(--volume "$ssh_dir:/root/.ssh:ro")
else
  # Restic's read operation still creates a short-lived repository lock.
  # Mounting read-only makes a correct password/snapshot look unavailable.
  restic_docker+=(--volume "$repository:/repository")
  restic_repository='/repository'
fi
restic_docker+=(--volume "$recovered_snapshot:/restore-root/snapshot")
for logical in "${volume_names[@]}"; do
  restic_docker+=(--volume "${actual_volumes[$logical]}:/restore-root/volumes/$logical")
done

"${restic_docker[@]}" "$RESTIC_IMAGE" --repo "$restic_repository" restore \
  "$snapshot" --tag bodour --target /restore-root

[[ -f "$recovered_snapshot/manifest.env" ]] ||
  backup_die 'snapshot is missing the recovery-point manifest'
grep -Fxq 'format=bodour-recovery-point-v1' "$recovered_snapshot/manifest.env" ||
  backup_die 'snapshot recovery-point format is unsupported'
(
  cd "$recovered_snapshot"
  sha256sum --check postgres.dump.sha256
)

install -d -m 700 "$recovered_config_dir"
for config in "$recovered_snapshot"/config/*; do
  [[ -f "$config" ]] || continue
  install -m 600 "$config" "$recovered_config_dir/$(basename "$config")"
done
install -m 600 "$recovered_snapshot/postgres.dump" "$recovered_config_dir/postgres.dump"
install -m 600 "$recovered_snapshot/postgres.dump.sha256" \
  "$recovered_config_dir/postgres.dump.sha256"
install -m 600 "$recovered_snapshot/manifest.env" "$recovered_config_dir/manifest.env"

printf 'restore: recovery point restored into empty volumes for project %s\n' "$project"
printf 'restore: dump, manifest and configuration written to %s for operator comparison\n' "$recovered_config_dir"
printf 'restore: services remain stopped; verify configuration, then start and run health/storage checks\n'
