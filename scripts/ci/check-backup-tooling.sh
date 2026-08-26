#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
backup_dir="$repo_root/scripts/backup"
create="$backup_dir/create-recovery-point.sh"
restore="$backup_dir/restore-recovery-point.sh"
common="$backup_dir/common.sh"

fail() {
  printf 'backup-tooling guard: %s\n' "$1" >&2
  exit 1
}

bash -n "$common" "$create" "$restore" "$backup_dir/verify-backup-restore.sh"

digest='restic/restic@sha256:39d9072fb5651c80d75c7a811612eb60b4c06b32ffe87c2e9f3c7222e1797e76'
[[ "$(rg -F "$digest" "$backup_dir" --glob '*.sh' | wc -l)" -eq 1 ]] ||
  fail 'restic must have one immutable, shared image digest'
rg -Fq 'backup_assert_production_repository "$repository"' "$create" ||
  fail 'Production backup must require an SFTP repository'
rg -Fq 'backup_assert_fixture_repository "$repository"' "$create" ||
  fail 'fixture drills must refuse an external repository'
rg -Fq "RESTORE_TO_EMPTY_PRODUCTION_VOLUMES" "$restore" ||
  fail 'Production restore must require its exact destructive confirmation'
rg -Fq 'restore target volume is not empty' "$restore" ||
  fail 'restore must fail closed on a non-empty volume'
rg -Fq 'pg_dump --username' "$create" ||
  fail 'the recovery point must contain a portable PostgreSQL dump'
writer_stop="$(grep -nF 'stop --timeout "$stop_timeout" "${writer_services[@]}"' "$create" | cut -d: -f1)"
storage_stop="$(grep -nF 'stop --timeout "$stop_timeout" "${services_before_db[@]}"' "$create" | cut -d: -f1)"
[[ -n "$writer_stop" && -n "$storage_stop" && "$writer_stop" -lt "$storage_stop" ]] ||
  fail 'application writers must drain before storage is stopped'

if rg -n 'docker\.sock|--privileged' "$backup_dir" --glob '*.sh' | grep -q .; then
  fail 'backup tooling must not grant a container Docker-host authority'
fi
if rg -n '"\$RESTIC_IMAGE".*\b(forget|prune)\b' "$backup_dir" --glob '*.sh' | grep -q .; then
  fail 'no destructive retention policy exists until the Owner sets one'
fi

"$create" --help >/dev/null
"$restore" --help >/dev/null
printf 'backup-tooling guard: pinned encryption, residency and empty-target boundaries verified\n'
