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
[[ "$(grep -rF --include='*.sh' "$digest" "$backup_dir" | wc -l)" -eq 1 ]] ||
  fail 'restic must have one immutable, shared image digest'
grep -Fq 'backup_assert_production_repository "$repository"' "$create" ||
  fail 'Production backup must require an SFTP repository'
grep -Fq 'backup_assert_fixture_repository "$repository"' "$create" ||
  fail 'fixture drills must refuse an external repository'
grep -Fq "RESTORE_TO_EMPTY_PRODUCTION_VOLUMES" "$restore" ||
  fail 'Production restore must require its exact destructive confirmation'
grep -Fq 'restore target volume is not empty' "$restore" ||
  fail 'restore must fail closed on a non-empty volume'
grep -Fq 'pg_dump --username' "$create" ||
  fail 'the recovery point must contain a portable PostgreSQL dump'
writer_stop="$(grep -nF 'stop --timeout "$stop_timeout" "${writer_services[@]}"' "$create" | cut -d: -f1)"
storage_stop="$(grep -nF 'stop --timeout "$stop_timeout" "${services_before_db[@]}"' "$create" | cut -d: -f1)"
repository_probe="$(grep -nF 'snapshots --no-lock' "$create" | cut -d: -f1)"
[[ -n "$writer_stop" && -n "$storage_stop" && "$writer_stop" -lt "$storage_stop" ]] ||
  fail 'application writers must drain before storage is stopped'
[[ -n "$repository_probe" && "$repository_probe" -lt "$writer_stop" ]] ||
  fail 'the encrypted repository must be reachable before application writers stop'
grep -Fq '"${compose[@]}" start "${running_services[@]}"' "$create" ||
  fail 'backup cleanup must restart the exact existing containers'
if grep -Fq '"${compose[@]}" up -d "${running_services[@]}"' "$create"; then
  fail 'backup cleanup must not reconcile/recreate Production containers'
fi
grep -Fq 'exec -T db pg_restore --username app --dbname bodour_logical_restore' \
  "$backup_dir/verify-backup-restore.sh" ||
  fail 'the disposable drill must execute the portable PostgreSQL restore'

if grep -rnE --include='*.sh' 'docker\.sock|--privileged' "$backup_dir" | grep -q .; then
  fail 'backup tooling must not grant a container Docker-host authority'
fi
# ── Rotation: two generations, pruned only after a verified new backup ─────
#
# **This guard was inverted, not deleted** (R133). It used to fail if ANY
# forget/prune existed at all — *«no destructive retention policy exists until
# the Owner sets one»* — which was right while none was set. The Owner set one on
# 2026-09-05, so the property to protect is no longer *absence*: it is that the
# policy is exactly two generations and that the prune runs strictly AFTER the
# repository check.
#
# The ordering is the safety property. Pruning before verification, or pruning
# unconditionally, is how a bad night costs the association its last good backup.
check_line="$(grep -nF '"$RESTIC_IMAGE" --repo "$restic_repository" check' "$create" | cut -d: -f1)"
forget_line="$(grep -nF '"$RESTIC_IMAGE" --repo "$restic_repository" forget' "$create" | cut -d: -f1)"
[[ -n "$check_line" && -n "$forget_line" && "$check_line" -lt "$forget_line" ]] ||
  fail 'the repository check must succeed BEFORE the oldest generation is pruned'
grep -Fq -- '--keep-last "$BACKUP_KEEP_GENERATIONS" --prune' "$create" ||
  fail 'rotation must keep exactly the shared generation count, and reclaim the space'
grep -Fq 'readonly BACKUP_KEEP_GENERATIONS=2' "$common" ||
  fail 'R133 fixes the retained generations at two'
grep -Fq -- '--host "$project" --tag bodour \' "$create" ||
  fail 'forget must be scoped to this project, or it discards another history'

"$create" --help >/dev/null
"$restore" --help >/dev/null
printf 'backup-tooling guard: pinned encryption, residency and empty-target boundaries verified\n'
