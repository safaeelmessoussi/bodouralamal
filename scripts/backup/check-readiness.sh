#!/usr/bin/env bash
# Read-only host checks. A failed/missing probe is never rendered healthy.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_root/scripts/backup/common.sh"
project='bodour'
repository=''
password_file=''
minimum_free_gib=''
compose_files=()
while (($#)); do
  case "$1" in
    --project) project="$2"; shift 2 ;;
    --repository) repository="$2"; shift 2 ;;
    --password-file) password_file="$2"; shift 2 ;;
    --minimum-free-gib) minimum_free_gib="$2"; shift 2 ;;
    --compose-file) compose_files+=("$2"); shift 2 ;;
    *) backup_die 'invalid operator-check argument' ;;
  esac
done
backup_validate_project "$project"
backup_require_secret_file "$password_file"
repository="$(backup_normalize_repository "$repository")"
backup_assert_fixture_repository "$repository" # same-VPS only, never contacts an external target
issues=0
if ! (backup_require_space "$repository" "$minimum_free_gib" 0); then issues=1; fi
status_file="${repository}.${project}.status"
state="$(backup_status_value "$status_file" state)"
success="$(backup_status_value "$status_file" last_success)"
failures="$(backup_status_value "$status_file" consecutive_failures)"
snapshot_id="$(backup_status_value "$status_file" snapshot_id)"
if [[ "$state" != ok ]]; then
  printf 'operator-check: BACKUP_NOT_OK (failed, absent or interrupted); inspect the host service journal\n'
  issues=1
fi
if [[ "$failures" =~ ^[0-9]+$ && "$failures" -ge 2 ]]; then
  printf 'operator-check: ESCALATE_OWNER consecutive_failures=%s\n' "$failures"
fi
# Monthly policy: after the previous calendar month expires, a missing fresh
# point is visible immediately, including if the timer was never installed.
if [[ ! "$success" =~ ^[0-9]+$ ]] || [[ "$success" -gt "$(date -u +%s)" ]] ||
   [[ "$(date -u -d "@$success" +%Y-%m)" != "$(date -u +%Y-%m)" ]]; then
  printf 'operator-check: BACKUP_DUE_OR_NEVER_VERIFIED\n'; issues=1
fi
if ! backup_docker_run 30s --env RESTIC_PASSWORD_FILE=/key \
  --volume "$password_file:/key:ro" --volume "$repository:/repository" "$RESTIC_IMAGE" \
  --repo /repository snapshots --no-lock --json --host "$project" --tag bodour |
  python3 "$repo_root/scripts/backup/recovery-metadata.py" select "$project" "$snapshot_id" >/dev/null; then
  printf 'operator-check: VERIFIED_SNAPSHOT_UNAVAILABLE\n'; issues=1
fi
((${#compose_files[@]})) || compose_files+=("$repo_root/docker-compose.yml")
compose=(docker compose --project-name "$project")
for file in "${compose_files[@]}"; do compose+=(--file "$file"); done
if ! health="$(timeout 20s "${compose[@]}" exec -T api node -e '
  fetch("http://127.0.0.1:3000/healthz", { signal: AbortSignal.timeout(10000) })
    .then(async r => process.stdout.write(await r.text())).catch(() => process.exit(1));' 2>/dev/null)"; then
  printf 'operator-check: HEALTH_PROBE_FAILED\n'; issues=1; health='{}'
fi
if ! backlog="$(timeout 20s "${compose[@]}" exec -T \
  -e PGOPTIONS='-c default_transaction_read_only=on -c lock_timeout=3000 -c statement_timeout=10000' \
  db psql -X -v ON_ERROR_STOP=1 -U app -d bodour -Atc "
    SELECT json_build_object(
      'retirements_pending', count(*) FILTER (WHERE completed_at IS NULL),
      'retirements_failed', count(*) FILTER (WHERE completed_at IS NULL AND last_error_code IS NOT NULL),
      'retirements_late', count(*) FILTER (WHERE completed_at IS NULL AND next_attempt_at < now() - interval '10 minutes'),
      'copy_unknown', count(*) FILTER (WHERE completed_at IS NULL AND NOT copy_settled),
      'failed_jobs', (SELECT count(*) FROM pgboss.job WHERE state = 'failed'),
      'late_jobs', (SELECT count(*) FROM pgboss.job WHERE state IN ('created','retry') AND start_after < now() - interval '10 minutes')
    ) FROM storage_retirement;" 2>/dev/null)"; then
  printf 'operator-check: BACKLOG_PROBE_FAILED\n'; issues=1; backlog='{}'
fi
if ! printf '{"health":%s,"backlog":%s}' "$health" "$backlog" |
  python3 "$repo_root/scripts/backup/operational-summary.py"; then issues=1; fi
[[ "$issues" == 0 ]] && printf 'operator-check: BACKUP_DISK_PLATFORM_OK (same-VPS only; no total-host-loss recovery)\n'
exit "$issues"
