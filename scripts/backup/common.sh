#!/usr/bin/env bash

# Shared mechanics for the host-scoped backup tools. This file is sourced;
# callers own `set -euo pipefail` so command failures cannot be hidden.

readonly RESTIC_IMAGE='restic/restic@sha256:39d9072fb5651c80d75c7a811612eb60b4c06b32ffe87c2e9f3c7222e1797e76'

# **How many monthly generations are kept** (Owner decision, 2026-09-05 — R133).
#
# One backup a month, at most two generations alive. The older one is pruned
# **only after the new one has been written and verified**, so a failed or
# unusable backup can never be the reason the last good one disappears.
#
# Two is deliberately small. It is enough to survive a corrupt latest generation
# and no more: personal data deleted from the live system stays inside an older
# encrypted generation until rotation expires it, so every extra generation is
# extra retention of data somebody asked to have deleted.
readonly BACKUP_KEEP_GENERATIONS=2

backup_die() {
  printf 'backup: %s\n' "$1" >&2
  exit 1
}

backup_require_command() {
  command -v "$1" >/dev/null 2>&1 || backup_die "required command is missing: $1"
}

# Docker client termination alone does not prove its container stopped. Bound
# each utility call and remove ONLY that invocation's uniquely named container
# before a caller can restart writers or release the host operation lock.
backup_docker_run() (
  local seconds="$1"; shift
  local name="bodour-recovery-tool-$(cat /proc/sys/kernel/random/uuid)"
  finish() {
    local rc=$?
    trap - EXIT INT TERM
    if ! timeout 30s docker rm -f "$name" >/dev/null 2>&1; then
      if ! timeout 10s docker container inspect "$name" >/dev/null 2>&1; then :
      else printf 'backup: utility container did not terminate: %s\n' "$name" >&2; rc=1; fi
    fi
    exit "$rc"
  }
  trap finish EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  timeout --foreground "$seconds" docker run --name "$name" --rm "$@"
)

backup_require_secret_file() {
  local path="$1"
  [[ -f "$path" && ! -L "$path" && -r "$path" ]] || backup_die 'password must be a readable regular non-symlink file'
  local mode
  mode="$(stat -c '%a' "$path")"
  (( (8#$mode & 077) == 0 )) ||
    backup_die "password file must not be readable by group/other: $path"
  [[ "$(stat -c '%u' "$path")" == "$(id -u)" ]] || backup_die 'password must belong to the invoking operator'
  [[ "$(wc -c < "$path")" -ge 32 ]] || backup_die 'backup password must contain at least 32 bytes'
}

backup_normalize_repository() {
  local repository="$1"
  if [[ "$repository" == /* ]]; then
    realpath -m "$repository"
  elif [[ "$repository" == sftp:* ]]; then
    printf '%s\n' "$repository"
  elif [[ "$repository" == *@*:* ]]; then
    printf 'sftp:%s\n' "$repository"
  else
    backup_die 'repository must be an absolute local path or an SFTP target'
  fi
}

backup_is_sftp_repository() {
  [[ "$1" == sftp:* ]]
}

backup_resolve_volume() {
  local project="$1"
  local logical="$2"
  local names
  names="$(docker volume ls \
    --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.volume=$logical" \
    --format '{{.Name}}')"
  [[ -n "$names" ]] || backup_die "compose volume does not exist: $project/$logical"
  [[ "$(printf '%s\n' "$names" | wc -l)" -eq 1 ]] ||
    backup_die "compose volume is ambiguous: $project/$logical"
  printf '%s\n' "$names"
}

backup_assert_fixture_repository() {
  local repository="$1"
  if backup_is_sftp_repository "$repository"; then
    backup_die 'fixture drills may use only a local repository; external fixture replication is prohibited'
  fi
}

backup_assert_production_repository() {
  local repository="$1"
  [[ "$repository" == /var/lib/bodour-backups/* && "$repository" != /var/lib/bodour-backups/ ]] ||
    backup_die 'temporary same-VPS Production repository must be below /var/lib/bodour-backups'
  [[ "$(id -u)" == 0 ]] || backup_die 'Production host recovery must run as root'
}

backup_validate_project() {
  [[ "$1" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || backup_die 'invalid Compose project identity'
}

# Same-VPS operations serialize across creation, verification, rotation and restore.
# Restic also keeps its own repository locks; never forcibly remove either lock.
backup_lock_repository() {
  local repository="$1"
  [[ ! -L "$repository" ]] || backup_die 'repository must not be a symlink'
  umask 077
  mkdir -p "$repository"
  local mode
  mode="$(stat -c '%a' "$repository")"
  (( (8#$mode & 077) == 0 )) || backup_die 'repository directory must be private (0700)'
  [[ "$(stat -c '%u' "$repository")" == "$(id -u)" ]] || backup_die 'repository directory must belong to the operator'
  [[ ! -L "${repository}.operation.lock" ]] || backup_die 'unsafe repository lock path'
  exec 9>"${repository}.operation.lock"
  flock -n 9 || backup_die 'another backup/restore operation holds this repository'
}

backup_repository_id() {
  python3 -c 'import json,re,sys; value=json.load(sys.stdin)["id"]; assert re.fullmatch("[0-9a-f]{64}", value); print(value)'
}

backup_free_bytes() {
  df --output=avail -B1 "$1" | tail -1 | tr -d '[:space:]'
}

backup_require_space() {
  local path="$1" minimum_gib="$2" estimated_bytes="$3"
  [[ "$minimum_gib" =~ ^[1-9][0-9]{0,5}$ && "$estimated_bytes" =~ ^[0-9]+$ ]] ||
    backup_die 'a positive explicit disk floor and valid size estimate are required'
  local available required
  available="$(backup_free_bytes "$path")"
  required=$((minimum_gib * 1073741824 + estimated_bytes))
  [[ "$available" =~ ^[0-9]+$ && "$available" -ge "$required" ]] ||
    backup_die 'DISK_LOW: insufficient free bytes for the configured floor plus estimated working space'
}

backup_status_value() {
  local file="$1" key="$2"
  [[ -f "$file" ]] && sed -n "s/^${key}=//p" "$file" || true
}

backup_write_status() {
  local path="$1" state="$2" failures="$3" success="$4" snapshot_id="$5" phase="$6"
  umask 077
  {
    printf 'state=%s\nconsecutive_failures=%s\nlast_success=%s\nsnapshot_id=%s\nphase=%s\n' \
      "$state" "$failures" "$success" "$snapshot_id" "$phase"
    printf 'last_attempt=%s\n' "$(date -u +%s)"
  } > "${path}.tmp"
  mv -f -- "${path}.tmp" "$path"
}

backup_safe_remove_workdir() {
  local workdir="$1"
  [[ "$workdir" == /tmp/bodour-backup.* || "$workdir" == /tmp/bodour-restore.* ]] ||
    backup_die "refusing to remove unexpected work directory: $workdir"
  rm -rf -- "$workdir"
}
