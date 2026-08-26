#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runner="$repo_root/backend/src/jobs/runner.ts"
jobs="$repo_root/backend/src/repositories/jobs.repository.ts"
lifecycle="$repo_root/backend/src/services/storage-lifecycle.service.ts"
trash="$repo_root/backend/src/services/trash.service.ts"

fail() {
  printf 'storage-lifecycle guard: %s\n' "$1" >&2
  exit 1
}

for queue in content.quarantine-purge upload.gc; do
  grep -Fq "'$queue'" "$runner" || fail "$queue is absent from the worker catalog"
  grep -Fq "'$queue'" "$jobs" || fail "$queue is absent from transactional enqueue names"
done

grep -Fq 'await boss.schedule(QUEUES.uploadGc, DAILY_AT_0330);' "$runner" ||
  fail 'upload.gc is not scheduled daily'
if rg -n 'boss\.schedule\(QUEUES\.contentQuarantinePurge' "$runner" | grep -q .; then
  fail 'automatic quarantine destruction was enabled without the Owner decision'
fi

[[ "$(grep -Fc "prefix: 'staging/content/'" "$lifecycle")" -eq 2 ]] ||
  fail 'upload.gc must cover public/private browser staging exactly'
[[ "$(grep -Fc "prefix: 'staging/server-finalization/'" "$lifecycle")" -eq 1 ]] ||
  fail 'upload.gc must cover private server-finalization staging exactly'
grep -Fq 'export const UPLOAD_GC_MIN_AGE_MS = 48 * 60 * 60 * 1_000;' "$lifecycle" ||
  fail 'the strict 48-hour threshold drifted'
grep -Fq 'object.lastModified.getTime() >= cutoff.getTime()' "$lifecycle" ||
  fail 'the 48-hour boundary is not retained'

grep -Fq 'await enqueueContentStorageRetirement(tx' "$trash" ||
  fail 'manual content purge does not transactionally preserve storage retirement'
grep -Fq "operation: 'quarantine_retired_object'" "$repo_root/backend/src/services/content.service.ts" ||
  fail 'replacement/deletion no longer commit an exact quarantine transition'

printf 'storage-lifecycle guard: durable exact retirement and bounded 48-hour GC verified\n'
