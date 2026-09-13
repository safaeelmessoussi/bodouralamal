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
source_project=''
expected_repository_id=''
allow_fixtures=false
production_confirmation=''
compose_files=()
volume_names=()
recovered_config_dir=''

usage() {
  cat <<'USAGE'
Usage: restore-recovery-point.sh --repository <absolute-local-path>
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
  --source-project <name>           Default: target project; explicit for a fresh differently named host
  --repository-id <64-hex-ID>       Required operator-pinned repository identity
  --ssh-dir <path>                  Legacy argument; current same-VPS policy rejects SFTP
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
    --source-project) source_project="${2:-}"; shift 2 ;;
    --repository-id) expected_repository_id="${2:-}"; shift 2 ;;
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
backup_require_command python3
backup_require_command flock
source_project="${source_project:-$project}"
backup_validate_project "$project"
backup_validate_project "$source_project"
[[ "$expected_repository_id" =~ ^[0-9a-f]{64}$ ]] || backup_die '--repository-id must pin the expected full repository ID'
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
fi
backup_lock_repository "$repository"

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
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

restic_docker=(backup_docker_run 1800s
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

# Resolve an exact ID from project-filtered metadata. Even an explicitly supplied
# ID must belong to that source project; never pass generic `latest` to restore.
repository_id="$("${restic_docker[@]}" "$RESTIC_IMAGE" --repo "$restic_repository" cat config | backup_repository_id)"
[[ "$repository_id" == "$expected_repository_id" ]] || backup_die 'repository identity differs from the operator pin'
selected_snapshot="$("${restic_docker[@]}" "$RESTIC_IMAGE" --repo "$restic_repository" \
  snapshots --json --host "$source_project" --tag bodour |
  python3 "$repo_root/scripts/backup/recovery-metadata.py" select "$source_project" "$snapshot")"
"${restic_docker[@]}" "$RESTIC_IMAGE" --repo "$restic_repository" dump \
  "$selected_snapshot" /snapshot/manifest.env > "$workdir/manifest.env"
mapfile -t data_images < <("${compose[@]}" config --format json | python3 -c \
  'import json,sys; s=json.load(sys.stdin)["services"]; print(s["db"]["image"]); print(s["minio"]["image"])')
[[ "${#data_images[@]}" == 2 ]] || backup_die 'cannot resolve target data images'
database_image_id="$(docker image inspect --format '{{.Id}}' "${data_images[0]}")"
storage_image_id="$(docker image inspect --format '{{.Id}}' "${data_images[1]}")"
python3 "$repo_root/scripts/backup/recovery-metadata.py" manifest "$source_project" \
  "$(IFS=,; printf '%s' "${volume_names[*]}")" "$database_image_id" "$storage_image_id" "$repository_id" < "$workdir/manifest.env"

# Only matched metadata authorizes creating empty targets. No image pull, wipe,
# service start or target-data write occurs before this identity check.
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
restic_docker+=(--volume "$recovered_snapshot:/restore-root/snapshot")
for logical in "${volume_names[@]}"; do
  restic_docker+=(--volume "${actual_volumes[$logical]}:/restore-root/volumes/$logical")
done

"${restic_docker[@]}" "$RESTIC_IMAGE" --repo "$restic_repository" restore \
  "$selected_snapshot" --verify --target /restore-root

[[ -f "$recovered_snapshot/manifest.env" ]] ||
  backup_die 'snapshot is missing the recovery-point manifest'
grep -Fxq 'format=bodour-recovery-point-v1' "$recovered_snapshot/manifest.env" ||
  backup_die 'snapshot recovery-point format is unsupported'
cmp -s "$workdir/manifest.env" "$recovered_snapshot/manifest.env" || backup_die 'restored manifest differs from the selected snapshot'
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
