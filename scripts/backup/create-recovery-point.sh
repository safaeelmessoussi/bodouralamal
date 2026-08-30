#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/backup/common.sh
source "$repo_root/scripts/backup/common.sh"

project='bodour'
repository=''
password_file=''
ssh_dir=''
database_service='db'
database_user='app'
database_name='bodour'
stop_timeout='120'
allow_fixtures=false
compose_files=()
volume_names=()
config_files=()
required_services=()
writer_services=()

usage() {
  cat <<'USAGE'
Usage: create-recovery-point.sh --repository <absolute-path|user@host:/path>
       --password-file <root-only-file> [options]

Options:
  --project <compose-project>       Default: bodour
  --compose-file <path>             Repeatable; default: docker-compose.yml
  --volume <logical-compose-name>   Repeatable; defaults to all four data volumes
  --config-file <path>              Repeatable encrypted config input
  --required-service <name>         Repeatable; defaults to api, db, minio
  --writer-service <name>           Stop/drain before storage; default: api
  --ssh-dir <path>                  Required for an SFTP repository
  --database-service <name>         Default: db
  --database-user <name>            Default: app
  --database-name <name>            Default: bodour
  --stop-timeout <seconds>          Default: 120
  --allow-fixtures                   Local disposable drills only; forbids SFTP
USAGE
}

while (($#)); do
  case "$1" in
    --project) project="${2:-}"; shift 2 ;;
    --repository) repository="${2:-}"; shift 2 ;;
    --password-file) password_file="${2:-}"; shift 2 ;;
    --ssh-dir) ssh_dir="${2:-}"; shift 2 ;;
    --compose-file) compose_files+=("${2:-}"); shift 2 ;;
    --volume) volume_names+=("${2:-}"); shift 2 ;;
    --config-file) config_files+=("${2:-}"); shift 2 ;;
    --required-service) required_services+=("${2:-}"); shift 2 ;;
    --writer-service) writer_services+=("${2:-}"); shift 2 ;;
    --database-service) database_service="${2:-}"; shift 2 ;;
    --database-user) database_user="${2:-}"; shift 2 ;;
    --database-name) database_name="${2:-}"; shift 2 ;;
    --stop-timeout) stop_timeout="${2:-}"; shift 2 ;;
    --allow-fixtures) allow_fixtures=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; backup_die "unknown argument: $1" ;;
  esac
done

backup_require_command docker
backup_require_command git
[[ "$stop_timeout" =~ ^[1-9][0-9]*$ ]] || backup_die '--stop-timeout must be a positive integer'
[[ -n "$repository" ]] || backup_die '--repository is required'
[[ -n "$password_file" ]] || backup_die '--password-file is required'
backup_require_secret_file "$password_file"
repository="$(backup_normalize_repository "$repository")"

if $allow_fixtures; then
  backup_assert_fixture_repository "$repository"
else
  backup_assert_production_repository "$repository"
  [[ -d "$ssh_dir" ]] || backup_die '--ssh-dir is required for the Production SFTP target'
  [[ -f "$ssh_dir/known_hosts" ]] ||
    backup_die 'the SSH directory must pin the backup host in known_hosts'
fi

((${#compose_files[@]})) || compose_files+=("$repo_root/docker-compose.yml")
((${#volume_names[@]})) || volume_names+=(db-data minio-data certbot-conf certbot-www)
((${#config_files[@]})) || config_files+=("$repo_root/.env" "$repo_root/infra.env")
((${#required_services[@]})) || required_services+=(api db minio)
((${#writer_services[@]})) || writer_services+=(api)

compose=(docker compose --project-name "$project")
for file in "${compose_files[@]}"; do
  [[ -f "$file" ]] || backup_die "compose file does not exist: $file"
  compose+=(--file "$file")
done

mapfile -t running_services < <("${compose[@]}" ps --services --status running)
((${#running_services[@]})) || backup_die 'no running compose services were found'
for required in "${required_services[@]}"; do
  printf '%s\n' "${running_services[@]}" | grep -Fxq "$required" ||
    backup_die "required service is not running: $required"
done

declare -A actual_volumes=()
for logical in "${volume_names[@]}"; do
  actual_volumes["$logical"]="$(backup_resolve_volume "$project" "$logical")"
done

# Prove the encrypted repository and credentials before taking any service out
# of rotation. A dead remote target must fail the operation without creating an
# avoidable application outage.
restic_base=(docker run --rm
  --env RESTIC_PASSWORD_FILE=/run/secrets/restic-password
  --volume "$password_file:/run/secrets/restic-password:ro")
restic_repository="$repository"
if backup_is_sftp_repository "$repository"; then
  restic_base+=(--volume "$ssh_dir:/root/.ssh:ro")
else
  mkdir -p "$repository"
  restic_base+=(--volume "$repository:/repository")
  restic_repository='/repository'
fi
if ! "${restic_base[@]}" "$RESTIC_IMAGE" \
  --repo "$restic_repository" snapshots --no-lock >/dev/null 2>&1; then
  "${restic_base[@]}" "$RESTIC_IMAGE" --repo "$restic_repository" init
fi

umask 077
workdir="$(mktemp -d /tmp/bodour-backup.XXXXXXXX)"
snapshot_dir="$workdir/snapshot"
mkdir -p "$snapshot_dir/config"
restarted=false

restart_services() {
  $restarted && return 0
  # Start the exact containers that were running before the snapshot. `up -d`
  # is a reconciliation command: with a missing release/tier overlay it can
  # recreate Production from a different image or configuration.
  "${compose[@]}" start "${running_services[@]}"
  restarted=true
}

cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  if ! restart_services; then
    printf 'backup: CRITICAL — failed to restore the pre-backup service set\n' >&2
    rc=1
  fi
  backup_safe_remove_workdir "$workdir"
  exit "$rc"
}
trap cleanup EXIT INT TERM

# Drain application writers while storage remains available. Stopping MinIO in
# the same Compose call as the API would sever a worker mid-copy instead of
# letting the API's SIGTERM handler drain pg-boss first.
"${compose[@]}" stop --timeout "$stop_timeout" "${writer_services[@]}"
for writer in "${writer_services[@]}"; do
  if "${compose[@]}" ps --services --status running | grep -Fxq "$writer"; then
    backup_die "writer service remained active after quiescing: $writer"
  fi
done

# With all writers drained, stop every remaining reader/data service except
# PostgreSQL. No content move can now race the object-volume snapshot.
services_before_db=()
for service in "${running_services[@]}"; do
  [[ "$service" == "$database_service" ]] && continue
  skip=false
  for writer in "${writer_services[@]}"; do
    [[ "$service" == "$writer" ]] && skip=true
  done
  $skip || services_before_db+=("$service")
done
((${#services_before_db[@]})) &&
  "${compose[@]}" stop --timeout "$stop_timeout" "${services_before_db[@]}"

remaining="$("${compose[@]}" ps --services --status running)"
[[ "$remaining" == "$database_service" ]] ||
  backup_die 'services other than PostgreSQL remained active after quiescing'

# The portable logical dump and the raw, cleanly-shut-down volume belong to the
# same write-quiesced point. The dump is also the forward-migration rollback
# artifact; the volume is the fastest same-version disaster restore.
"${compose[@]}" exec -T "$database_service" \
  pg_dump --username "$database_user" --dbname "$database_name" \
  --format=custom --no-owner --no-privileges > "$snapshot_dir/postgres.dump"
(
  cd "$snapshot_dir"
  sha256sum postgres.dump > postgres.dump.sha256
)

"${compose[@]}" stop --timeout "$stop_timeout" "$database_service"
[[ -z "$("${compose[@]}" ps --services --status running)" ]] ||
  backup_die 'the compose project is not fully quiesced'

for config_file in "${config_files[@]}"; do
  [[ -f "$config_file" ]] || backup_die "required recovery config is missing: $config_file"
  install -m 600 "$config_file" "$snapshot_dir/config/$(basename "$config_file")"
done

recovery_point="$(date -u +'%Y%m%dT%H%M%SZ')"
commit="$(git -C "$repo_root" rev-parse HEAD)"
{
  printf 'format=bodour-recovery-point-v1\n'
  printf 'created_at=%s\n' "$recovery_point"
  printf 'git_commit=%s\n' "$commit"
  printf 'compose_project=%s\n' "$project"
  printf 'database=%s\n' "$database_name"
  printf 'volumes=%s\n' "$(IFS=,; printf '%s' "${volume_names[*]}")"
} > "$snapshot_dir/manifest.env"

restic_backup=("${restic_base[@]}" --volume "$snapshot_dir:/snapshot:ro")
backup_paths=(/snapshot)
for logical in "${volume_names[@]}"; do
  restic_backup+=(--volume "${actual_volumes[$logical]}:/volumes/$logical:ro")
  backup_paths+=("/volumes/$logical")
done

"${restic_backup[@]}" "$RESTIC_IMAGE" --repo "$restic_repository" backup \
  --host "$project" --tag bodour --tag "recovery-point:$recovery_point" \
  "${backup_paths[@]}"

# Data services return before the repository verification. A slow remote check
# must not extend the write outage after the immutable snapshot is complete.
restart_services
"${restic_base[@]}" "$RESTIC_IMAGE" --repo "$restic_repository" check

printf 'backup: recovery point %s complete and verified\n' "$recovery_point"
printf 'backup: retention is intentionally unchanged; no forget/prune policy is configured\n'
