#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/backup/common.sh
source "$repo_root/scripts/backup/common.sh"
compose_file="$repo_root/scripts/backup/fixtures/docker-compose.yml"
project='bodour-backup-drill'
workdir="$(mktemp -d /tmp/bodour-backup-drill.XXXXXXXX)"
repository="$workdir/repository"
password_file="$workdir/restic-password"
recovered_config="$workdir/recovered-config"
fixture_config="$workdir/fixture.env"
started_at="$(date +%s)"

cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  docker compose --project-name "$project" --file "$compose_file" \
    down --volumes --remove-orphans >/dev/null 2>&1 || true
  if [[ "$workdir" == /tmp/bodour-backup-drill.* ]]; then
    # The restic container reads Docker volumes as root, so its local test
    # repository is root-owned. Remove only this validated disposable path
    # through the same pinned image, then remove the empty directory as user.
    docker run --rm --entrypoint /bin/sh --volume "$workdir:/work" \
      "$RESTIC_IMAGE" \
      -c 'find /work -mindepth 1 -delete' >/dev/null 2>&1 || true
    rmdir "$workdir" >/dev/null 2>&1 || true
  fi
  exit "$rc"
}
trap cleanup EXIT INT TERM

umask 077
printf 'fixture-restic-password-with-sufficient-entropy\n' > "$password_file"
printf 'NODE_ENV=test\n' > "$fixture_config"
mkdir -p "$repository"

docker compose --project-name "$project" --file "$compose_file" up -d

"$repo_root/scripts/backup/create-recovery-point.sh" \
  --allow-fixtures \
  --project "$project" \
  --compose-file "$compose_file" \
  --repository "$repository" \
  --password-file "$password_file" \
  --database-user app \
  --database-name bodour \
  --stop-timeout 3 \
  --volume db-data \
  --volume minio-data \
  --config-file "$fixture_config"

# Simulate total loss of both named data volumes. These are uniquely named
# disposable fixtures and are removed by the trap even if an assertion fails.
docker compose --project-name "$project" --file "$compose_file" \
  down --volumes --remove-orphans

"$repo_root/scripts/backup/restore-recovery-point.sh" \
  --allow-fixtures \
  --project "$project" \
  --compose-file "$compose_file" \
  --repository "$repository" \
  --password-file "$password_file" \
  --recovered-config-dir "$recovered_config" \
  --volume db-data \
  --volume minio-data

docker compose --project-name "$project" --file "$compose_file" up -d db minio

database_value="$(docker compose --project-name "$project" --file "$compose_file" \
  exec -T db psql -U app -d bodour -Atc 'SELECT value FROM backup_drill WHERE id = 1')"
[[ "$database_value" == 'database-at-recovery-point' ]] ||
  { printf 'backup drill: PostgreSQL recovery mismatch\n' >&2; exit 1; }

object_value="$(docker compose --project-name "$project" --file "$compose_file" \
  run --rm --no-deps --entrypoint /bin/sh minio-init \
  -c 'mc cat local/private/drill/object.txt')"
[[ "$object_value" == 'object-at-recovery-point' ]] ||
  { printf 'backup drill: object recovery mismatch\n' >&2; exit 1; }

[[ -f "$recovered_config/fixture.env" ]] ||
  { printf 'backup drill: encrypted recovery config was not restored\n' >&2; exit 1; }
docker run --rm --volume "$recovered_config:/recovery:ro" postgres:18.4 \
  pg_restore --list /recovery/postgres.dump >/dev/null

elapsed="$(( $(date +%s) - started_at ))"
(( elapsed < 3600 )) ||
  { printf 'backup drill: RTO exceeded (%ss)\n' "$elapsed" >&2; exit 1; }

printf 'backup drill: PostgreSQL + object volume + config restored in %ss (< 1 h RTO)\n' "$elapsed"
