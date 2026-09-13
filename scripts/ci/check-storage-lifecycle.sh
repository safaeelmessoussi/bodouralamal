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

grep -Fq 'const dailyOptions = { tz: config.TZ };' "$runner" ||
  fail 'daily storage jobs must use the configured timezone explicitly'
grep -Fq 'await boss.schedule(QUEUES.uploadGc, DAILY_AT_0330, {}, dailyOptions);' "$runner" ||
  fail 'upload.gc is not scheduled daily'
scheduled=$(grep -E 'boss\.schedule\(QUEUES\.contentQuarantinePurge' "$runner" || true)
[[ "$scheduled" == "    await boss.schedule(QUEUES.contentQuarantinePurge, DAILY_AT_0330, { operation: 'reconcile' }, dailyOptions);" ]] ||
  fail 'the quarantine cron may only reconcile existing exact obligations, never authorize age-based destruction'
grep -Fq "durable?.operation === 'reconcile'" "$runner" || fail 'reconciliation handler missing'
grep -Fq 'await reconcileRetirements(prisma);' "$runner" || fail 'durable backlog is not reconciled'
grep -Fq 'model StorageRetirement {' "$repo_root/backend/prisma/schema.prisma" || fail 'durable retirement authority missing'

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
