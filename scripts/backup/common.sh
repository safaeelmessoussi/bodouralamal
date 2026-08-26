#!/usr/bin/env bash

# Shared mechanics for the host-scoped backup tools. This file is sourced;
# callers own `set -euo pipefail` so command failures cannot be hidden.

readonly RESTIC_IMAGE='restic/restic@sha256:39d9072fb5651c80d75c7a811612eb60b4c06b32ffe87c2e9f3c7222e1797e76'

backup_die() {
  printf 'backup: %s\n' "$1" >&2
  exit 1
}

backup_require_command() {
  command -v "$1" >/dev/null 2>&1 || backup_die "required command is missing: $1"
}

backup_require_secret_file() {
  local path="$1"
  [[ -f "$path" && -r "$path" ]] || backup_die "password file is not readable: $path"
  local mode
  mode="$(stat -c '%a' "$path")"
  (( (8#$mode & 077) == 0 )) ||
    backup_die "password file must not be readable by group/other: $path"
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
  backup_is_sftp_repository "$repository" ||
    backup_die 'Production recovery points must use the configured offsite SFTP repository'
}

backup_safe_remove_workdir() {
  local workdir="$1"
  [[ "$workdir" == /tmp/bodour-backup.* || "$workdir" == /tmp/bodour-restore.* ]] ||
    backup_die "refusing to remove unexpected work directory: $workdir"
  rm -rf -- "$workdir"
}
