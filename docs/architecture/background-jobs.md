[Documentation](../README.md) › [Architecture](README.md) › **Background jobs**

# Background jobs

**pg-boss**, a Postgres-backed job queue running inside the API container.

## Why not Redis

- Container budget: a 4 GB VPS already runs PostgreSQL, MinIO, Node and Nginx.
- Transactional enqueue: the queue is a Postgres table, so a job joins the mutation's transaction; an external broker cannot.

## Transactional enqueue

- A job-triggering mutation enqueues through the same transaction client (`jobsRepo.enqueue(tx, name, data)`); a committed mutation with a lost job and a job for an uncommitted mutation are both prohibited states.
- `boss.send()` uses its own connection, outside the transaction: banned for job-triggering mutations, not outright.
- `JobsRepository` inserts pg-boss's documented job-table format, copying retry, expiry, retention and policy from the registered queue row (only `name` + `data` would bypass TD-7's retry contract); a singleton key deduplicates pending `created`/`retry` work while permitting one follow-up behind an active full recompute.
- One of only two places raw SQL is permitted in application code; the other is `SELECT … FOR UPDATE`.

## The catalog

Five attempts (initial + four retries, exponential backoff), then dead-letter with an Admin-visible failure; singleton keys prevent duplicate concurrent runs.

| Job | Trigger | Schedule | Idempotency |
|---|---|---|---|
| `consent.reevaluate` | roster/Teaching-Group change · consent change · recording import/replacement · Session-content link · R92 occurrence-audience change · recording metadata correction | on demand | singleton per session (R43; the gate's subject is a session's resolved audience, BR-2); full recompute |
| `session.materialize` | course-schedule create/edit | nightly cron | singleton per schedule; unique `(schedule, date)` |
| `content.bucket-migrate` | visibility change · consent forcing (pre-R170 only) · exact old-public-key retirement after replacement/deletion · recording metadata correction (public read safeguard, even with no bucket move) | on demand | consent arm pins the source key; copy–verify–delete and exact retirement idempotent; missing source is success |
| `backup.replicate` | TD-7 legacy reference, **not registered** | none | B8 execution is the [monthly same-VPS host procedure](../operations/recovery.md); Document Owner must reconcile TD-7 wording; no phantom worker or nightly/offsite claim |
| `content.quarantine-purge` | exact replacement/deletion obligation · deliberate R59.1 purge | daily reconciliation | executes one `StorageRetirement`; the daily run retries existing records only; Trash retention stays with `trash.retention-purge` |
| `upload.gc` | — | daily cron | deletes browser/server-finalization staging strictly older than 48 h in bounded pages; never provider recording staging |
| `content.quarantine-sweep` | — | daily cron (R170 §10) | deletes `quarantine/<content id>/…` in both buckets strictly older than 90 days and owed to nobody |
| `token.purge` | — | daily cron | consumed onboarding tokens past horizon and expired refresh tokens; bounded batches, one transaction per `RefreshSession` under the row lock refresh/logout use; an empty anchor goes with its last token |
| `ratelimit.purge` | — | daily cron | counters for elapsed windows; housekeeping only, the quota decision is synchronous |
| `audit.purge` | — | daily cron | the single sanctioned audit-row deletion path |
| `trash.retention-purge` | — | daily cron | `purgeExpiredEntries` + exact-generation User de-identification (R133/B2); restore refuses an expired User window before the sweep; not an account-purge queue |
| application / rejected-registration retention | — | daily cron | in `jobs/runner.ts` |
| `session-recording-ingest` | verified provider completion callback (R99, ratified R100) | on demand | singleton per recording; `session_recording.educational_content_id` UNIQUE |
| `session-recording-reconcile` | — | every 15 minutes (R167 §5), no zone | deletes nothing; re-queues indefinitely |

- Post-MVP (`import.csv`, `export.csv`, `grade.recalculate`) join with their features.
- All nine daily crons pass `tz: config.TZ` (`Africa/Casablanca`); pg-boss otherwise defaults to UTC. B8's host backup timer is deliberately UTC.

## Runtime worker health

- `GET /healthz` separates queue infrastructure (`pgboss` schema exists) from application workers (runner initialised, every handler in the runner's catalog registered; no second list in the health controller); pg-boss's live worker registry then requires every handler active and polled within 15 s or processing; startup grace uses the same window.
- Before readiness, startup reconciles the TD-7 retry policy on every queue (retry/backoff only; retention, expiry, deletion horizons and history intact) and scans live recording-linked Sessions in bounded UUID batches, inserting singleton reevaluation obligations transactionally; repeatable, guesses no consent.
- Readiness ≠ TD-7 completeness: `consent.reevaluate`, the consent arm of `content.bucket-migrate`, `upload.gc` and the exact arm of `content.quarantine-purge` have handlers; the last means committed obligations can drain, not that age-based destruction is enabled; unimplemented TD-7 jobs stay release gaps, health invents no handlers.
- Shutdown: SIGTERM closes the HTTP listener and stops pg-boss polling concurrently; handlers get 105 s, then pg-boss returns unfinished work to retry; Compose grants 120 s before SIGKILL (15 s for HTTP close, pool disconnect, exit), not Docker's 10 s default.
- `backup.replicate` stays a gap: the [backup/restore tooling](../operations/runbooks.md#creating-and-restoring-a-full-recovery-point) is host-scoped (needs drained workers and stopped volumes); Docker-socket authority for the API would be root-equivalent; queue, nightly automation and critical alert remain release blockers.

### Storage lifecycle jobs — bounded sweep versus exact obligation

- B5: `StorageRetirement` is the authoritative record for exact work; pg-boss is execution/wakeup only; domain mutations create both transactionally before losing a locator; no FK to a purgeable Content row; payloads carry structural IDs, never the raw key.
- Completion clears the locator, keeps digest, operation and timestamps; an error keeps the locator, increments attempts, records a fixed code (never the object-store message); `COPY_OUTCOME_UNKNOWN` stays pending for reconciliation; positive copy settlement is persisted before deletion ([storage](storage.md#exact-retirement-authority-b4b5)); a timer never stands in for evidence.
- Startup imports legacy exact-key jobs in UUID pages and re-enqueues due unresolved records before readiness; five attempts exhaust the pg-boss job but the domain record survives for later reconciliation; deleting pg-boss history erases nothing; expired pre-upgrade jobs cannot be rebuilt from hashed audit coordinates; historical orphans need a separately authorised investigation.
- Each wakeup locks its row first; page entries use separate transactions; no locks accumulate across unrelated content.
- `upload.gc`: lists ≤250 objects under one fixed staging scope, deletes only `LastModified < cutoff`, enqueues the next continuation transactionally; delete is idempotent; provider recordings never enter these prefixes (they keep their R100 exact job).
- `content.quarantine-sweep` (R170 §10, closing R59.4): the same loop with another profile (`sweepPage`, `storage-lifecycle.service.ts`): `quarantine/` in both buckets, 90 days, plus `quarantinedObjectIsOwed` (a Trash entry or unfinished `StorageRetirement` retains the object); keys not `quarantine/<uuid>/…` are never touched. It destroys a REPLACED file's old object; a deleted item's goes with its Trash entry via `trash.retention-purge`; the seven-day Trash window (R133) is untouched.
- Quarantine worker: replacement/soft-deletion records `quarantine_retired_object` (old bucket/key) and enqueues only the retirement ID; Super Admin permanent deletion records `manual_permanent_delete`; both validate the canonical `content/{content_id}/…` coordinate; the first copies to its deterministic quarantine key then deletes the canonical object, the second deletes both possible leftovers. Content lock before retirement-row lock; canonical coordinate rechecked; live canonical bytes never deleted; after a committed permanent purge both old coordinates are retired; storage exceptions consume the TD-7 budget; no storage handler selects `Trash.purge_after`.

### `session-recording-ingest` — provider `completed` is not Bodour «متاح»

R99.13: a recording is finished when the object exists in the platform's storage and an `EducationalContent` row references it. R99 named no queue; C2 built it and reported the omission; R100 (2026-08-21) added the TD-7 row.

- A job, not the callback: up to 500 MB (TD-9), and a provider that times out retries, producing concurrent duplicates; the handler writes one row and inserts one job.
- Order: (1) already ingested → skip to the exact staging cleanup recorded on the `SessionRecording`; (2) verify the bytes, never metadata: exists, non-empty, within TD-9's cap, magic bytes, and the media family the class asked for (an OGG for a صوت وصورة class is refused, R99.7); (3) server-side `CopyObject` inside MinIO (container pinned at 768 MB, TD-13); (4) one transaction: R75.6 name under `SELECT … FOR UPDATE` on the occurrence, `EducationalContent` (`origin = session_recording`), `SessionContent`, `educational_content_id`, audit row; (5) sweep staging: a failure is thrown to pg-boss, the retry lands on step 1 and deletes only that recording's stored bucket/key; `DeleteObject` on a missing key is success.
- Not `upload.gc`: the ingest keeps a durable cleanup obligation only when the post-commit delete fails.
- «متاح» is exactly `educational_content_id IS NOT NULL`; no stored `available` status (R99.14: an empty discoverable item is worse than a failure).
- `ingestion_failure_reason` is its own column, separate from the provider's `failure_reason`; on failure nothing is deleted and no content row is created.
- The durable key's hash segment derives from the recording id; copy only if absent; written exactly once (§20 rule 15).
- A cleanup failure is not an ingestion failure: it does not populate `ingestion_failure_reason`; it stays on the same pg-boss job under TD-7's budget, never a second worker or in-memory retry.

### `session-recording-reconcile` — a recording is never left to a delivery that may not happen

R167 §5; `services/session-recording-reconcile.service.ts`.

| Hand-off | Lost when | Reconciler |
|---|---|---|
| provider completion callback | API restarting when the class ended; row stuck `processing` | after a three-minute grace, `OnlineClassProvider.reportRecording` → `applyProviderReport` (the verified-callback door) |
| provider has no answer (forgets, down, TD-13 unconfigured) | — | the staged object is the fact (one atomic PUT after finalising): marked `completed`, import queued |
| import job | four retries exhausted against a defect (R166 §4); a fix healed nothing until `ops:requeue-recordings` | every `completed` recording without `educational_content_id` is re-queued every run; the singleton key collapses onto a waiting job |

- Positively unknown to the provider after 24 h with nothing staged → `failed`; an unreachable provider concludes nothing; deletes nothing (`upload.gc` does not name the recording staging bucket).
- Recorder dying mid-class (R168 §2; [provider page](../development/online-class-provider.md#a-recorder-that-dies-mid-class-loses-nothing-recorded-r168-2)): a live recording whose ten-second safety segments have been silent ten minutes is retired (provider asked to stop, row → `processing`, segments kept; the provider's «active» is not trusted; only a recording with ≥1 segment is judged by silence). On a later pass a retired or provider-failed recording with no final file is assembled by `ffmpeg` into its own `output_key`, marked `completed` + `recovered_from_segments`, import enqueued in the same transaction: the one exit from `failed`/`aborted`; a failed assembly writes `ingestion_failure_reason`, keeps segments, retries.
- Deployment asks `npm run ops:active-recordings` first ([pipeline](../operations/deployment.md#the-pipeline)); a recovered recording lacks at most its last ten seconds.

### `session.materialize` — eager, and the reason is correctness

Conflict detection runs against materialised rows, not recurrence rules ([calendar](calendar-and-hijri.md#scheduling-is-schedule-driven)).

1. Idempotent per `(schedule, date)`, unique index.
2. Never rewrites work: an individually changed, cancelled or held session, or one carrying attendance, grades, recordings, notes, homework or attached content, is left as is and reported back, whatever its date. The rule is semantic (R43.6): protected whenever it holds user/administrator data whose loss would change historical truth. `policies/session-protection.ts` is the single authority; modules contribute `registerSessionProtectionRule({ code, describes, evaluate })`, evaluated in bulk; built-ins are always present, not registered at boot; rules only add protection. Overwriting a protected session requires naming it explicitly; no «regenerate all», no defaultable flag.
3. Never regenerates the past once there is one: generation starts at Morocco's today; a schedule that has never produced an occurrence starts at its own first date (R172 §2; `expandSchedule` applies `anchor_date` to every pattern, R55).
4. Snapshots room and staff onto each occurrence (R43.4); an edit re-syncs only future un-overridden occurrences; re-aligning a past one is a separate audited action.

- Horizon: end of the current academic year, extended nightly.
- Schedule writes materialise inside their own transaction; the job advances the horizon and reconciles.

### `consent.reevaluate` — full recompute, deliberately

- Recomputes the complete current audience of every Session linked to the same recording (R43/R92: entire Level at the occurrence's audience branches, Administrative Group, or Teaching Group); strict union; absence is no consent; an empty audience does not engage the gate.
- The student→Session trigger follows retained live occurrences after schedule soft-delete and uses R92 occurrence branches; changing them enqueues in the same transaction.
- The shared-recording Session graph is locked once in global UUID order, then recording rows; writers take the same anchors; a grown graph retries.
- R170 §3 (2026-09-21): writes `media_consent_missing` on every recording of the graph in both directions (`true` when a resolved-audience student lacks an effective `media_release` grant), audited as `content.consent_warning`; forces nothing, moves no bytes, enqueues no migration; the warning shows on «مكتبة المحتوى» and the class dialog. `consent_forced_private` is retired (never written); the consent arm of `content.bucket-migrate` closes pre-R170 obligations with `withdrawn_r170`.
- Pre-B-01 rows lack per-job retry policy and are not bulk-rewritten; on activation the worker first commits one correctly configured follow-up under the same singleton key.

### `audit.purge` — the one that needed three attempts

- Deletes rows matching BOTH the allowlist `auth.login · auth.login_denied · auth.identity_bound · auth.refresh · auth.logout · auth.token_revoked` AND the 12-month horizon; extending the list needs a specification revision.
- Age-only deletion and prefix matching (`auth.*`) are prohibited: a glob is not an allowlist.
- `consent_gate.override`, `grade.passfail_override`, `settings.change`, `trash.manual_restore` and every other type survive; a test asserts it.
- Bounds ~800–900k authentication rows/year.

## Why some things are deliberately *not* jobs

- Quran coverage recalculation is synchronous: coverage drives level completion.
- Per-user quota enforcement is synchronous and transactional with the request; pg-boss is prohibited for it.

## What is prohibited as a substitute

In-memory queues, `setImmediate`, unawaited promises, ad-hoc timers, in-process mutexes and advisory-lock improvisations; job state must survive container restarts; singleton keys are the concurrency mechanism.

## When the workers are down

- Enqueues are database inserts inside application transactions, so they keep succeeding; jobs are delayed, never lost, and drain on restart.
- A queue-lag alarm past ten minutes surfaces on the Admin dashboard ([resilience](../operations/resilience.md#degraded-operation)).

---

**Next:** [Calendar and Hijri](calendar-and-hijri.md) · **Related:** [Backend](backend.md#transactions), [Storage](storage.md#consent-gating)
