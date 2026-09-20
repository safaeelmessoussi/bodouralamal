#!/usr/bin/env bash
# Root-owned operator configuration, not application .env and never a secret in Git.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_root/scripts/backup/common.sh"
config_file='/etc/bodour-recovery.env'
backup_require_secret_file "$config_file"
[[ "$(id -u)" == 0 ]] || backup_die 'host schedule must run as root'
set -a
source "$config_file"
set +a
: "${BODOUR_RELEASE_TAG:?exact release required}" "${BACKUP_REPOSITORY:?}" "${BACKUP_PASSWORD_FILE:?}" "${BACKUP_MINIMUM_FREE_GIB:?}"
[[ "$BODOUR_RELEASE_TAG" =~ ^[0-9a-f]{40}$ && "$(git -c safe.directory="$repo_root" -C "$repo_root" rev-parse HEAD)" == "$BODOUR_RELEASE_TAG" ]] ||
  backup_die 'scheduled operation requires the configured exact release checkout'
[[ -z "$(git -c safe.directory="$repo_root" -C "$repo_root" status --porcelain --untracked-files=normal)" ]] || backup_die 'scheduled operation refuses a dirty release checkout'
args=(--project bodour --repository "$BACKUP_REPOSITORY" --password-file "$BACKUP_PASSWORD_FILE"
  --minimum-free-gib "$BACKUP_MINIMUM_FREE_GIB"
  --compose-file "$repo_root/docker-compose.yml" --compose-file "$repo_root/docker-compose.release.yml"
  --compose-file "$repo_root/docker-compose.production.yml")
case "${1:-}" in
  backup) exec bash "$repo_root/scripts/backup/create-recovery-point.sh" "${args[@]}" --monthly ;;
  monitor) exec bash "$repo_root/scripts/backup/check-readiness.sh" "${args[@]}" ;;
  *) backup_die 'expected backup or monitor' ;;
esac
