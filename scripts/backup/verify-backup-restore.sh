#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/backup/common.sh
source "$repo_root/scripts/backup/common.sh"
compose_file="$repo_root/scripts/backup/fixtures/docker-compose.yml"
project="bodour-backup-drill-$$"
export MINIO_ACCESS_KEY='backup-drill-access'
export MINIO_SECRET_KEY='backup-drill-secret-password'
export BACKUP_DRILL_MINIO_PORT="${BACKUP_DRILL_MINIO_PORT:-59006}"
export MINIO_ENDPOINT="http://127.0.0.1:${BACKUP_DRILL_MINIO_PORT}"
workdir="$(mktemp -d /tmp/bodour-backup-drill.XXXXXXXX)"
repository="$workdir/repository"
password_file="$workdir/restic-password"
recovered_config="$workdir/recovered-config"
fixture_config="$workdir/fixture.env"
wrong_password_file="$workdir/wrong-restic-password"
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
printf 'deliberately-wrong-restic-password\n' > "$wrong_password_file"
printf 'NODE_ENV=test\n' > "$fixture_config"
mkdir -p "$repository"

container_ids() {
  for service in api db minio; do
    printf '%s=%s\n' "$service" \
      "$(docker compose --project-name "$project" --file "$compose_file" ps -q "$service")"
  done
}

docker compose --project-name "$project" --file "$compose_file" up -d --wait

# The exact shared initializer, then one canary object, both from the host
# through the fixture's loopback port with the backend's own S3 SDK.
(
  cd "$repo_root/backend"
  node --input-type=module < <(sed "s|'./policy.mjs'|'../scripts/storage/policy.mjs'|" "$repo_root/scripts/storage/initialize.mjs")
)
node "$repo_root/scripts/backup/fixtures/object-probe.mjs" put private drill/object.txt 'object-at-recovery-point'

before_ids="$(container_ids)"
create_args=(--allow-fixtures --project "$project" --compose-file "$compose_file"
  --repository "$repository" --password-file "$password_file" --database-user app
  --database-name bodour --stop-timeout 3 --volume db-data --volume minio-data
  --config-file "$fixture_config")
create_point() { bash "$repo_root/scripts/backup/create-recovery-point.sh" "${create_args[@]}" "$@"; }

# R167 §5 — a class being recorded postpones the recovery point BEFORE any
# service stops: the fixture's writer answers as the platform would (exit 3),
# every container stays exactly as it was, and the status says why.
if create_point --recording-check 'exit 3' >"$workdir/recording-refusal.log" 2>&1; then
  backup_die 'an active recording unexpectedly did not postpone the recovery point'
fi
grep -q 'RECORDING_ACTIVE' "$workdir/recording-refusal.log"
[[ "$(backup_status_value "${repository}.${project}.status" state)" == failed ]]
[[ "$(backup_status_value "${repository}.${project}.status" phase)" == recording-check ]]
[[ "$(container_ids)" == "$before_ids" ]]
# …and a check that cannot answer is a refusal too, never read as «nothing is recording».
if create_point --recording-check 'exit 7' >"$workdir/recording-silence.log" 2>&1; then
  backup_die 'an unanswered recording check unexpectedly passed'
fi
grep -q 'did not answer' "$workdir/recording-silence.log"
[[ "$(container_ids)" == "$before_ids" ]]

# The fixture's writer is not the platform API: the real check cannot run
# there, and the drill says so explicitly (Production refuses this flag).
create_args+=(--skip-recording-check)
"$repo_root/scripts/backup/create-recovery-point.sh" \
  --allow-fixtures \
  --skip-recording-check \
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

after_ids="$(container_ids)"
[[ "$after_ids" == "$before_ids" ]] ||
  { printf 'backup drill: recovery-point creation recreated a running container\n' >&2; exit 1; }
restic_run=(docker run --rm --env RESTIC_PASSWORD_FILE=/key --volume "$password_file:/key:ro"
  --volume "$repository:/repository" "$RESTIC_IMAGE" --repo /repository)
repository_id="$("${restic_run[@]}" cat config | backup_repository_id)"
own_snapshots() { "${restic_run[@]}" snapshots --json --host "$project" --tag bodour; }
own_count() { own_snapshots | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))'; }
if create_point --minimum-free-gib 999999 >"$workdir/disk-failure.log" 2>&1; then
  backup_die 'impossible disk floor unexpectedly passed'
fi
grep -q 'DISK_LOW' "$workdir/disk-failure.log"
[[ "$(backup_status_value "${repository}.${project}.status" state)" == failed ]]
[[ "$(container_ids)" == "$before_ids" ]]
# A second invocation must refuse the host lock, not race verification/pruning.
(
  exec 8>"${repository}.operation.lock"
  flock -n 8
  if create_point >"$workdir/lock-failure.log" 2>&1; then exit 1; fi
  grep -q 'another backup/restore operation' "$workdir/lock-failure.log"
)

# Repository failure is an operational alert, not an application outage. The
# probe occurs before the writer stop, so a wrong password against the existing
# encrypted repository must leave every exact container running and unchanged.
if "$repo_root/scripts/backup/create-recovery-point.sh" \
  --allow-fixtures \
  --skip-recording-check \
  --project "$project" \
  --compose-file "$compose_file" \
  --repository "$repository" \
  --password-file "$wrong_password_file" \
  --database-user app \
  --database-name bodour \
  --stop-timeout 3 \
  --volume db-data \
  --volume minio-data \
  --config-file "$fixture_config" >"$workdir/expected-repository-failure.log" 2>&1; then
  printf 'backup drill: wrong repository credential unexpectedly succeeded\n' >&2
  exit 1
fi
[[ -s "$workdir/expected-repository-failure.log" ]] ||
  { printf 'backup drill: repository failure was not visible\n' >&2; exit 1; }
[[ "$(container_ids)" == "$before_ids" ]] ||
  { printf 'backup drill: repository preflight failure stopped or recreated a service\n' >&2; exit 1; }
[[ "$(backup_status_value "${repository}.${project}.status" consecutive_failures)" == 2 ]]

# Legacy path sets must not evade the two-generation cap. A foreign project's
# newer snapshot must survive rotation and must never become our restore source.
restic_input=(docker run --rm --env RESTIC_PASSWORD_FILE=/key --volume "$password_file:/key:ro"
  --volume "$repository:/repository" --volume "$fixture_config:/different-path:ro"
  "$RESTIC_IMAGE" --repo /repository)
"${restic_input[@]}" backup --host "$project" --tag bodour /different-path >/dev/null
"${restic_input[@]}" backup --host "${project}-foreign" --tag bodour /different-path >/dev/null
[[ "$(own_count)" == 2 ]]
before_failure="$(own_snapshots | python3 -c 'import json,sys; print("\n".join(sorted(r["id"] for r in json.load(sys.stdin))))')"
# Corrupt ONE pack in this disposable repository, preserving its bytes privately
# for repair. A new successful write is insufficient: full read-data must fail,
# all previous snapshots must remain, and services must already be restarted.
# A DATA pack, located exactly — never "whichever pack is listed first". The
# next backup loads its parent snapshot's TREES, so a truncated tree pack fails
# earlier, in `create`, and proves nothing about verification. Pack names are
# content hashes, so the old first-listed choice made this step a coin flip.
# Both filters read their whole input: an early exit would SIGPIPE restic and
# fail the pipeline under `pipefail`.
data_blob="$("${restic_run[@]}" list blobs | awk '$1 == "data" && !seen { print $2; seen = 1 }')"
[[ "$data_blob" =~ ^[0-9a-f]{64}$ ]]
pack_id="$("${restic_run[@]}" find --blob "$data_blob" --show-pack-id |
  awk '/^Object belongs to pack [0-9a-f]+$/ && !seen { print $5; seen = 1 }')"
[[ "$pack_id" =~ ^[0-9a-f]{64}$ ]]
pack="/repository/data/${pack_id:0:2}/$pack_id"
docker run --rm --entrypoint /bin/sh --volume "$repository:/repository" --volume "$workdir:/work" \
  "$RESTIC_IMAGE" -c 'cp "$1" /work/saved-pack; truncate -s 0 "$1"' sh "$pack"
if create_point >"$workdir/corrupt-failure.log" 2>&1; then
  backup_die 'corrupt encrypted pack unexpectedly passed full verification'
fi
[[ "$(backup_status_value "${repository}.${project}.status" phase)" == verify ]]
[[ "$(own_count)" == 3 ]]
after_failure="$(own_snapshots | python3 -c 'import json,sys; print("\n".join(sorted(r["id"] for r in json.load(sys.stdin))))')"
while IFS= read -r id; do grep -Fxq "$id" <<< "$after_failure"; done <<< "$before_failure"
[[ "$(container_ids)" == "$before_ids" ]]
docker run --rm --entrypoint /bin/sh --volume "$repository:/repository" --volume "$workdir:/work" \
  "$RESTIC_IMAGE" -c 'cp /work/saved-pack "$1"' sh "$pack"
create_point
[[ "$(own_count)" == 2 ]]
verified_snapshot="$(backup_status_value "${repository}.${project}.status" snapshot_id)"
create_point --monthly
[[ "$(own_count)" == 2 ]]
[[ "$(backup_status_value "${repository}.${project}.status" snapshot_id)" == "$verified_snapshot" ]]
"${restic_input[@]}" backup --host "${project}-foreign" --tag bodour /different-path >/dev/null
foreign_snapshot="$("${restic_run[@]}" snapshots --json --host "${project}-foreign" |
  python3 "$repo_root/scripts/backup/recovery-metadata.py" select "${project}-foreign" latest)"
printf 'backup drill: disk/lock/credential refusal, visible failures, full-data corruption refusal, verify-before-prune, two-generation cap and monthly skip PASS\n'

# Simulate total loss of both named data volumes. These are uniquely named
# disposable fixtures and are removed by the trap even if an assertion fails.
docker compose --project-name "$project" --file "$compose_file" \
  down --volumes --remove-orphans

restore_args=(--allow-fixtures --project "$project" --compose-file "$compose_file"
  --repository "$repository" --password-file "$password_file" --recovered-config-dir "$recovered_config"
  --volume db-data --volume minio-data)
for kind in repository snapshot; do
  refusal_args=(--repository-id "$repository_id" --snapshot "$foreign_snapshot")
  [[ "$kind" != repository ]] || refusal_args=(--repository-id "$(printf '0%.0s' {1..64})")
  if bash "$repo_root/scripts/backup/restore-recovery-point.sh" "${restore_args[@]}" "${refusal_args[@]}" >"$workdir/refuse-$kind.log" 2>&1; then
    backup_die 'foreign repository/snapshot unexpectedly authorized restore'
  fi
  [[ -z "$(docker volume ls --filter "label=com.docker.compose.project=$project" -q)" ]]
  [[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$project")" ]]
done

"$repo_root/scripts/backup/restore-recovery-point.sh" \
  --allow-fixtures \
  --project "$project" \
  --compose-file "$compose_file" \
  --repository "$repository" \
  --password-file "$password_file" \
  --recovered-config-dir "$recovered_config" \
  --repository-id "$repository_id" \
  --volume db-data \
  --volume minio-data
[[ "$("${restic_run[@]}" snapshots --json --host "${project}-foreign" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')" == 2 ]]
printf 'backup drill: exact repository/project selection and foreign-snapshot refusal before target creation PASS\n'

docker compose --project-name "$project" --file "$compose_file" up -d --wait --wait-timeout 90 db minio

database_value="$(docker compose --project-name "$project" --file "$compose_file" \
  exec -T db psql -U app -d bodour -Atc 'SELECT value FROM backup_drill WHERE id = 1')"
[[ "$database_value" == 'database-at-recovery-point' ]] ||
  { printf 'backup drill: PostgreSQL recovery mismatch\n' >&2; exit 1; }

object_value="$(node "$repo_root/scripts/backup/fixtures/object-probe.mjs" get private drill/object.txt)"
[[ "$object_value" == 'object-at-recovery-point' ]] ||
  { printf 'backup drill: object recovery mismatch\n' >&2; exit 1; }

[[ -f "$recovered_config/fixture.env" ]] ||
  { printf 'backup drill: encrypted recovery config was not restored\n' >&2; exit 1; }
docker run --rm --volume "$recovered_config:/recovery:ro" postgres:18.4 \
  pg_restore --list /recovery/postgres.dump >/dev/null

# The raw volume is the fast same-version disaster path. Independently restore
# the portable dump into a clean database so the forward-migration rollback
# artifact is proven executable rather than merely catalog-readable.
docker compose --project-name "$project" --file "$compose_file" \
  exec -T db createdb --username app bodour_logical_restore
docker compose --project-name "$project" --file "$compose_file" \
  exec -T db pg_restore --username app --dbname bodour_logical_restore \
    --no-owner --no-privileges < "$recovered_config/postgres.dump"
logical_value="$(docker compose --project-name "$project" --file "$compose_file" \
  exec -T db psql -U app -d bodour_logical_restore -Atc \
    'SELECT value FROM backup_drill WHERE id = 1')"
[[ "$logical_value" == 'database-at-recovery-point' ]] ||
  { printf 'backup drill: logical PostgreSQL restore mismatch\n' >&2; exit 1; }

elapsed="$(( $(date +%s) - started_at ))"
(( elapsed < 3600 )) ||
  { printf 'backup drill: RTO exceeded (%ss)\n' "$elapsed" >&2; exit 1; }

printf 'backup drill: raw + logical PostgreSQL, object volume and config restored in %ss (< 1 h RTO)\n' "$elapsed"
