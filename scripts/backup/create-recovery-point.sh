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
minimum_free_gib=''
monthly=false
recording_check='npm run --silent ops:active-recordings'
skip_recording_check=false

usage() {
  cat <<'USAGE'
Usage: create-recovery-point.sh --repository <absolute-local-path>
       --password-file <root-only-file> [options]

Options:
  --project <compose-project>       Default: bodour
  --compose-file <path>             Repeatable; default: docker-compose.yml
  --volume <logical-compose-name>   Repeatable; defaults to all four data volumes
  --config-file <path>              Repeatable encrypted config input
  --required-service <name>         Repeatable; defaults to api, db, minio
  --writer-service <name>           Stop/drain before storage; default: api
  --ssh-dir <path>                  Legacy argument; current same-VPS policy rejects SFTP
  --database-service <name>         Default: db
  --database-user <name>            Default: app
  --database-name <name>            Default: bodour
  --stop-timeout <seconds>          Default: 120
  --minimum-free-gib <GiB>          Required reserve after estimated working space
  --monthly                        Skip only a still-present verified success this UTC month
  --allow-fixtures                   Local disposable drills only; forbids SFTP
  --recording-check <command>       Run inside the first writer service before it stops;
                                    exit 3 = a class is being recorded, postpone.
                                    Default: npm run --silent ops:active-recordings
  --skip-recording-check            Fixture drills whose writer is not the platform API
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
    --minimum-free-gib) minimum_free_gib="${2:-}"; shift 2 ;;
    --monthly) monthly=true; shift ;;
    --allow-fixtures) allow_fixtures=true; shift ;;
    --recording-check) recording_check="${2:-}"; shift 2 ;;
    --skip-recording-check) skip_recording_check=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; backup_die "unknown argument: $1" ;;
  esac
done

backup_require_command docker
backup_require_command git
backup_require_command python3
backup_require_command flock
backup_validate_project "$project"
[[ "$stop_timeout" =~ ^[1-9][0-9]*$ ]] || backup_die '--stop-timeout must be a positive integer'
[[ -n "$repository" ]] || backup_die '--repository is required'
[[ -n "$password_file" ]] || backup_die '--password-file is required'
backup_require_secret_file "$password_file"
repository="$(backup_normalize_repository "$repository")"

if $allow_fixtures; then
  backup_assert_fixture_repository "$repository"
  minimum_free_gib="${minimum_free_gib:-1}"
else
  backup_assert_production_repository "$repository"
  $skip_recording_check && backup_die '--skip-recording-check is for fixture drills only'
fi
[[ -n "$recording_check" ]] || backup_die '--recording-check must name a command'
[[ "$minimum_free_gib" =~ ^[1-9][0-9]{0,5}$ ]] || backup_die '--minimum-free-gib is required'
backup_lock_repository "$repository"
status_file="${repository}.${project}.status"
last_success="$(backup_status_value "$status_file" last_success)"
last_snapshot="$(backup_status_value "$status_file" snapshot_id)"
failures="$(backup_status_value "$status_file" consecutive_failures)"
previous_state="$(backup_status_value "$status_file" state)"
[[ "$failures" =~ ^[0-9]+$ ]] || failures=0
phase='preflight'
workdir=''
quiesced=false
restarted=false
running_services=()
restart_services() {
  $quiesced || return 0
  $restarted && return 0
  timeout 180s "${compose[@]}" start "${running_services[@]}" || return 1
  restarted=true
}
cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  if ! restart_services; then
    printf 'backup: CRITICAL — failed to restore the pre-backup service set\n' >&2
    rc=1
  fi
  if [[ "$rc" -ne 0 ]]; then
    backup_write_status "$status_file" failed "$((failures + 1))" "$last_success" "$last_snapshot" "$phase"
    printf 'backup: CRITICAL — phase=%s consecutive_failures=%s; operator action required\n' "$phase" "$((failures + 1))" >&2
  fi
  [[ -z "$workdir" ]] || backup_safe_remove_workdir "$workdir"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
backup_write_status "$status_file" running "$failures" "$last_success" "$last_snapshot" "$phase"

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
  [[ "$logical" =~ ^[a-z0-9][a-z0-9_-]+$ ]] || backup_die 'invalid logical volume'
  actual_volumes["$logical"]="$(backup_resolve_volume "$project" "$logical")"
done

# Reserve a full new generation plus dump/repack headroom without assuming
# deduplication/compression. This is a conservative estimate, not a quota.
estimated_bytes=0
for logical in "${volume_names[@]}"; do
  used_kib="$(backup_docker_run 120s --entrypoint /bin/sh --volume "${actual_volumes[$logical]}:/measure:ro" \
    "$RESTIC_IMAGE" -c 'du -sk /measure' | cut -f1)"
  [[ "$used_kib" =~ ^[0-9]+$ ]] || backup_die 'cannot estimate source volume size'
  estimated_bytes=$((estimated_bytes + used_kib * 1024 * 2))
done
backup_require_space "$repository" "$minimum_free_gib" "$estimated_bytes"
backup_require_space /tmp "$minimum_free_gib" "$estimated_bytes"
declare -A config_basenames=()
for config_file in "${config_files[@]}"; do
  [[ -f "$config_file" ]] || backup_die 'required recovery configuration is missing'
  [[ "$(realpath "$config_file")" != "$(realpath "$password_file")" ]] || backup_die 'never include the backup key in its own snapshot'
  name="$(basename "$config_file")"
  [[ -z "${config_basenames[$name]:-}" ]] || backup_die 'recovery config basenames must be unique'
  config_basenames[$name]=1
done

# Prove the encrypted repository and credentials before taking any service out
# of rotation. A dead remote target must fail the operation without creating an
# avoidable application outage.
restic_base=(backup_docker_run 1800s
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
if [[ ! -f "$repository/config" ]]; then
  "${restic_base[@]}" "$RESTIC_IMAGE" --repo "$restic_repository" init
fi
snapshots="$("${restic_base[@]}" "$RESTIC_IMAGE" --repo "$restic_repository" snapshots --no-lock --json --host "$project" --tag bodour)"
repository_id="$("${restic_base[@]}" "$RESTIC_IMAGE" --repo "$restic_repository" cat config | backup_repository_id)"
if $monthly && [[ "$previous_state" == ok && "$last_success" =~ ^[0-9]+$ ]] && \
  [[ "$(date -u -d "@$last_success" +%Y-%m)" == "$(date -u +%Y-%m)" ]] && \
  printf '%s' "$snapshots" | python3 "$repo_root/scripts/backup/recovery-metadata.py" select "$project" "$last_snapshot" >/dev/null; then
  backup_write_status "$status_file" ok 0 "$last_success" "$last_snapshot" complete
  printf 'backup: this UTC month already has a verified recovery point; no new snapshot\n'
  exit 0
fi

# SRS Revision 167 §5 (Codex review, 2026-09-22) — the recorder holds a
# class's file locally until the class ends; stopping the API mid-class loses
# it, and no recovery point can bring that back. Ask the platform first,
# exactly as a deployment does: `ops:active-recordings` answers exit 0 (go) or
# exit 3 (names the recordings still open). A check that cannot answer is a
# refusal too — silence must never be read as «nothing is recording». The
# daily timer retries tomorrow; nothing has been stopped yet.
phase='recording-check'
if ! $skip_recording_check; then
  set +e
  recording_report="$(timeout --foreground 120s "${compose[@]}" exec -T "${writer_services[0]}" \
    sh -c "$recording_check" </dev/null 2>&1)"
  recording_rc=$?
  set -e
  case "$recording_rc" in
    0) ;;
    3) printf 'backup: RECORDING_ACTIVE — a class is being recorded; the recovery point is postponed: %s\n' \
         "$recording_report" >&2
       backup_die 'a class is being recorded; retry after it ends' ;;
    *) backup_die "the active-recording check did not answer (exit $recording_rc)" ;;
  esac
fi

umask 077
workdir="$(mktemp -d /tmp/bodour-backup.XXXXXXXX)"
snapshot_dir="$workdir/snapshot"
mkdir -p "$snapshot_dir/config"

# Drain application writers while storage remains available. Stopping MinIO in
# the same Compose call as the API would sever a worker mid-copy instead of
# letting the API's SIGTERM handler drain pg-boss first.
phase='quiesce'
quiesced=true
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
phase='dump'
timeout --foreground 1800s "${compose[@]}" exec -T -e PGOPTIONS='-c lock_timeout=15000 -c statement_timeout=1800000' "$database_service" \
  pg_dump --username "$database_user" --dbname "$database_name" \
  --format=custom --no-owner --no-privileges > "$snapshot_dir/postgres.dump"
timeout --foreground 60s "${compose[@]}" exec -T "$database_service" pg_restore --list < "$snapshot_dir/postgres.dump" >/dev/null
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
commit="$(git -c safe.directory="$repo_root" -C "$repo_root" rev-parse HEAD)"
{
  printf 'format=bodour-recovery-point-v1\n'
  printf 'created_at=%s\n' "$recovery_point"
  printf 'git_commit=%s\n' "$commit"
  printf 'compose_project=%s\n' "$project"
  printf 'database=%s\n' "$database_name"
  printf 'repository_id=%s\n' "$repository_id"
  printf 'database_image_id=%s\n' "$(docker inspect --format '{{.Image}}' "$("${compose[@]}" ps -aq "$database_service")")"
  printf 'storage_image_id=%s\n' "$(docker inspect --format '{{.Image}}' "$("${compose[@]}" ps -aq minio)")"
  printf 'volumes=%s\n' "$(IFS=,; printf '%s' "${volume_names[*]}")"
} > "$snapshot_dir/manifest.env"

restic_backup=("${restic_base[@]}" --volume "$snapshot_dir:/snapshot:ro")
backup_paths=(/snapshot)
for logical in "${volume_names[@]}"; do
  restic_backup+=(--volume "${actual_volumes[$logical]}:/volumes/$logical:ro")
  backup_paths+=("/volumes/$logical")
done

phase='create'
"${restic_backup[@]}" "$RESTIC_IMAGE" --repo "$restic_repository" backup --json \
  --host "$project" --tag bodour --tag "recovery-point:$recovery_point" \
  "${backup_paths[@]}" > "$workdir/created.json"
created_snapshot="$(python3 "$repo_root/scripts/backup/recovery-metadata.py" created < "$workdir/created.json")"

# Data services return before the repository verification. A slow remote check
# must not extend the write outage after the immutable snapshot is complete.
restart_services
phase='verify'
"${restic_base[@]}" "$RESTIC_IMAGE" --repo "$restic_repository" check --read-data

printf 'backup: recovery point %s complete and verified\n' "$recovery_point"

# ── Rotation: at most two generations, and ONLY after verification ──────────
#
# **Ordering is the whole safety property** (R133). `restic check` above has
# already succeeded — and `set -euo pipefail` means a failed backup or a failed
# check never reaches this line — so the oldest generation is discarded only
# once a verified replacement exists. Pruning first, or pruning unconditionally,
# is how a bad night costs the association its last good backup.
#
# **Scoped to this project's own snapshots** by host and tag. `forget` operates
# on whatever the filter selects, so an unscoped call in a shared repository
# would discard somebody else's history.
#
# `--prune` reclaims the space in the same pass; without it the data stays in the
# repository and "at most two generations" would be true of the index only.
phase='rotate'
"${restic_base[@]}" "$RESTIC_IMAGE" --repo "$restic_repository" forget \
  --host "$project" --tag bodour --group-by host \
  --keep-last "$BACKUP_KEEP_GENERATIONS" --prune

backup_write_status "$status_file" ok 0 "$(date -u +%s)" "$created_snapshot" complete

printf 'backup: rotation complete — at most %s generations retained\n' "$BACKUP_KEEP_GENERATIONS"
printf 'backup: a live deletion does NOT modify an existing generation; deleted data may remain in the older one until it rotates out\n'
