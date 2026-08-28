[Documentation](../README.md) › [Architecture](README.md) › **Background jobs**

# Background jobs

**pg-boss** — a Postgres-backed job queue running inside the API container.

## Why not Redis

Two reasons, and the second is the interesting one.

**Container budget.** On a 4 GB VPS already running PostgreSQL, MinIO, Node, and Nginx, a
Redis container is a real cost in memory and in operational surface — another thing to
back up, monitor, and secure.

**Transactional enqueue.** Because the queue *is* a Postgres table, a job can be enqueued
**inside the same transaction as the mutation that triggers it**. With an external broker
that is impossible: you either commit the mutation and hope the enqueue lands, or enqueue
first and hope the commit does. Both are broken states, and both are common bugs.

## Transactional enqueue

> Wherever a mutation triggers a job, the enqueue is **a database insert through the same
> transaction client**. A committed mutation with a lost job, and a job for an uncommitted
> mutation, are **both prohibited states**.

Which means:

```ts
// ✅  the insert joins the transaction
await prisma.$transaction(async (tx) => {
  await rosterRepo.enrol(tx, …);
  await jobsRepo.enqueue(tx, 'consent.reevaluate', { session_id });
});

// ❌  boss.send() uses its own connection and sits OUTSIDE the transaction
await prisma.$transaction(async (tx) => {
  await rosterRepo.enrol(tx, …);
});
await boss.send('consent.reevaluate', { session_id });   // prohibited here
```

Job rows are inserted through a dedicated `JobsRepository` using pg-boss's documented job
table format. The repository copies retry, expiry, retention and policy values from the
registered queue row; inserting only `name` and `data` would silently bypass TD-7's retry
contract. A singleton key deduplicates pending `created`/`retry` work while permitting one
follow-up to be committed behind an active full recompute. This is **one of only two places
raw SQL is permitted** in application code — the other being `SELECT … FOR UPDATE` row locks.

`boss.send()` is not banned outright; it is banned **for job-triggering mutations**, which
is where the atomicity matters.

## The catalog

Every job gets five attempts total — the initial execution plus at most four retries with
exponential backoff — then dead-letters with an Admin-visible failure. Singleton keys prevent
duplicate concurrent runs.

| Job | Trigger | Idempotency |
|---|---|---|
| `consent.reevaluate` | Roster/Teaching-Group change · consent change · recording import/replacement · Session-content link · R92 occurrence-audience change | Singleton per session (Revision 43 — the gate's subject is a session's resolved audience, BR-2); **full recompute**, so re-running is harmless |
| `session.materialize` | Course-schedule create or edit · **nightly cron** | Singleton per schedule. Turns a recurring schedule into dated occurrences over a rolling horizon. See below |
| `content.bucket-migrate` | Visibility change · consent forcing · exact old-public-key retirement after replacement/deletion | The consent arm pins the source key; copy–verify–delete and exact retirement are idempotent across replacement, deletion and ambiguous delete responses |
| `backup.replicate` | Nightly cron | `pg_dump` + `restic` push to the second Moroccan location. Failure raises a **critical** Admin-visible alert |
| `content.quarantine-purge` | Exact replacement/deletion obligation; deliberate R59.1 purge | Moves one immutable old key to quarantine or retires the two exact possible leftovers. The automatic daily `purge_after` scan remains unscheduled pending the R59.4 Owner decision |
| `upload.gc` | Daily cron | Deletes browser/server-finalization staging **strictly older than 48 h** in bounded durable pages — never younger, and never provider recording staging |
| `token.purge` | Daily cron | Removes consumed onboarding tokens past their horizon **and refresh tokens past expiry**. Refresh generations are discovered in bounded batches, then deleted in one transaction per `RefreshSession` while holding the same stable row refresh/logout use; a live successor is therefore never detached from logout's serialization boundary. An empty anchor is removed with its last token |
| `ratelimit.purge` | Daily cron | Removes counters for elapsed windows. **Housekeeping only** — the quota decision is synchronous and never depends on this job |
| `audit.purge` | Daily cron | The single sanctioned deletion path for audit rows. See below |
| `session-recording-ingest` | A **verified** provider completion callback (R99) | Singleton per recording. Turns a provider staging object into an `EducationalContent` + `SessionContent`. See below |

Post-MVP additions (`import.csv`, `export.csv`, `grade.recalculate`) join with their
features.

> **DOCUMENT OWNER ACTION REQUIRED — R111 catalog reconciliation.** The ratified R111 design
> requires a durable, idempotent pg-boss de-identification after the three-day restoration
> window, but TD-7 contains no account-purge row and the implementation has no such handler.
> The interface must not pretend a scheduler exists: manual `?permanent=true` works, while an
> untouched soft-deleted account remains recoverable and identifiable past `purge_after`.
> Add the queue's normative name, trigger, payload and singleton rule to TD-7 before it is
> implemented; registering an invented queue would violate §20.

## Runtime worker health

`GET /healthz` keeps **queue infrastructure** and **application workers** as two
different components. The `pgboss` schema proves that durable enqueue storage exists; it
does not prove that this API process started a runner. The worker component is ready only
after runner initialization completed and every handler in the implementation's worker
catalog registered successfully.

The readiness expectation is derived from the same catalog the runner loops over — there is
no second list of queue names in the health controller. pg-boss's live worker registry then
provides the ongoing signal: every expected handler must remain active and must either have
polled within 15 seconds or be processing a job. The bounded startup grace uses the same
window, so an initial empty fetch does not make an ordinary deployment flap; a long recording
ingestion is not called stale merely because its handler is busy.

Before any worker registers or readiness can become green, startup reconciles the TD-7 retry
policy on every implemented queue and scans live recording-linked Sessions in bounded UUID
batches. Each batch inserts the ordinary singleton reevaluation obligations transactionally.
The scan is repeatable and does not rewrite content or guess consent; it closes rollout and
backlog gaps left by older trigger coverage. Queue policy updates change retry/backoff only,
so pg-boss retention, expiry and deletion horizons—and historical jobs—remain intact.

This runtime catalog is deliberately not the same thing as TD-7 release completeness.
`consent.reevaluate`, the consent-forced arm of `content.bucket-migrate`, bounded `upload.gc`,
and the exact-operation arm of `content.quarantine-purge` have real handlers and are therefore
part of readiness. Readiness for the last queue means committed replacement/deletion/manual
purge obligations can drain; it does **not** claim that automatic age-based destruction is
enabled. Other TD-7 jobs whose implementations have not landed remain release-readiness gaps;
health neither implements them nor invents running handlers for them.

### Storage lifecycle jobs — bounded sweep versus exact obligation

`upload.gc` is the age-based collector. Each execution lists at most 250 objects under one of
the fixed staging scopes, deletes only `LastModified < cutoff`, and enqueues the next opaque
continuation transactionally. Retrying a page is safe because delete is idempotent. A provider
recording never enters these prefixes and retains its R100 exact job instead.

`content.quarantine-purge` currently accepts only two explicit operations. A replacement or
soft deletion transaction enqueues `quarantine_retired_object` with its old bucket/key before
the row can point elsewhere. A deliberate Super Admin permanent deletion enqueues
`manual_permanent_delete` before the record and Trash locator disappear. Both validate the
canonical `content/{content_id}/…` coordinate; the first copies to its deterministic
quarantine key before deleting the old canonical object, while the second idempotently deletes
both possible leftovers. After a quarantine move, the worker rechecks whether the content row
still exists; if a concurrent permanent purge already committed, it immediately retires both
old coordinates so a late stale quarantine job cannot recreate retained bytes. Storage
exceptions escape the handler and consume the ordinary TD-7 retry budget. No scheduler or
handler selects `Trash.purge_after`.

`backup.replicate` is still one of those gaps. The executable
[backup/restore tooling](../operations/runbooks.md#creating-and-restoring-a-full-recovery-point)
now produces a coherent encrypted recovery point and has passed a destructive disposable
restore, but it is host-scoped because coherence requires draining the in-process workers and
cleanly stopping data volumes. Giving the API Docker-socket authority merely to make the TD-7
row look implemented would be a root-equivalent privilege escalation. The queue, nightly
automation and critical alert remain release blockers; runtime readiness does not count them.

> **`session-recording-ingest` was implemented before it was specified, and that sequence is
> worth keeping visible.** R99 authorised the ingestion pipeline in terms (R99.13, R99.14) and
> specified the TD-2, TD-3, TD-8 and TD-13 additions it needed, but **named no queue** — while
> §20 rule 1 forbids every in-memory substitute for durable work, so there was no compliant way
> to build R99.13 *without* one. C2 built it and **reported the omission instead of inventing a
> normative row for itself**; the Document Owner ratified it as **SRS Revision 100**
> (2026-08-21), which adds the row and nothing else.
>
> It is therefore normative now, and this page **cites** TD-7 rather than standing in for it.
> The reason the history is recorded rather than tidied away: a specification that appears never
> to have been incomplete teaches the next implementer to guess instead of to report.

### `session-recording-ingest` — provider `completed` is not Bodour «متاح»

The sentence the whole job exists to make true (R99.13):

> A recording is finished when the object exists in the platform's own storage and an
> `EducationalContent` row references it — **not when the provider says it has one.**

**Why it is a job and not part of the callback.** A صوت وصورة lesson is up to 500 MB (TD-9).
Copying that inside the webhook handler holds the request open for as long as the copy takes,
and **a provider that times out retries** — so one slow import becomes several concurrent ones,
which is the failure mode most likely to produce duplicate content. The handler writes one row
and inserts one job.

**The order is the design.** Each step protects against a specific way of producing a broken
library item:

1. **Already ingested?** → skip verification, copying and database writes, then finish the
   exact staging cleanup recorded on that `SessionRecording`.
   `session_recording.educational_content_id` is `UNIQUE`, and it is the durable idempotency
   anchor for both the ingest and a post-commit cleanup retry.
2. **Verify the actual bytes**, never the provider's metadata — exists, non-empty, within
   TD-9's cap, magic bytes matching, **and the media family the class asked for**. An OGG
   delivered for a صوت وصورة class is a perfectly valid OGG and is refused anyway, because
   R99.7 forbids silently downgrading the lesson.
3. **Copy server-side into the content bucket.** `CopyObject` runs *inside* MinIO, so half a
   gigabyte never passes through a container pinned at 768 MB (TD-13).
4. **One transaction**: allocate the R75.6 name under `SELECT … FOR UPDATE` on the occurrence,
   create the `EducationalContent` (`origin = session_recording`), create the `SessionContent`
   link, set `educational_content_id`, write the audit row.
5. **Then sweep staging.** A cleanup failure never undoes valid content: the relation is
   already committed, so «متاح» remains true. The worker throws the cleanup failure to
   pg-boss instead of swallowing it; the same durable job retries, lands on step 1, and
   addresses only that recording's stored staging bucket/key. S3 `DeleteObject` treats an
   already-missing key as success, so a worker killed after the delete but before job
   completion converges safely on the next attempt.

This is **not `upload.gc`**. The ingest job first attempts immediate cleanup and retains its
own durable obligation only when that exact post-commit delete fails. `upload.gc` is the
separate age-based collector for initiated browser uploads that never completed; neither is
a general scan of the recording bucket.

**Availability is derived, never stored.** *«متاح»* is exactly
`educational_content_id IS NOT NULL`. An `available` status value would be a second fact that
can disagree with the object it describes, and R99.14 is explicit that a content item whose
object is absent is worse than an honest failure — it is discoverable, downloadable and empty.

**A failed import is recoverable and says so.** `ingestion_failure_reason` is a column of its
own, separate from the provider's `failure_reason`: *the provider could not record* and *the
platform could not accept what it recorded* have different remedies, and only the second is
fixed by trying again. Nothing is deleted on failure — the staging object is deliberately kept
so a corrected one can be retried — and no content row is created.

**The durable key is deterministic.** Its hash segment is derived from the recording id rather
than random, so a job that copied the object and then died finds *its own* object on retry
instead of minting a second key and orphaning the first. The object is copied only if it is not
already there, so the key is still written exactly once (§20 rule 15).

**A cleanup failure is not an ingestion failure.** It does not populate
`ingestion_failure_reason`, because the canonical object, content row and relation already
exist. Repeated storage failure remains on the existing pg-boss job under TD-7's retry budget
and terminal failed-job observability; it never creates a second worker or an in-memory retry.

### `session.materialize` — eager, and the reason is correctness

Sessions are generated ahead of time rather than computed when the calendar is
read. That is not a caching decision:

> Conflict detection runs against materialized sessions, not against recurrence
> rules. Comparing rules cannot see that a weekly and a biweekly-alternating
> Tuesday 15:00 collide **only on alternate weeks**.

A lazily-derived calendar could not answer the one question scheduling has to
answer, so the rows exist.

**Three guarantees, each one a rule a later change could quietly break:**

1. **Idempotent** per `(schedule, date)`, enforced by a unique index. Re-running,
   retrying, or running twice concurrently creates nothing.
2. **Never rewrites work.** A session someone has individually changed, or that
   carries educational work — attendance, grades, recordings, notes, homework,
   attached content — or that has been cancelled or held, is left exactly as it
   is **and reported back**, because a silent skip and a silent overwrite are
   equally bad answers to *"what did my edit just do"*. **The protection is
   date-independent**: a recording attached to next Tuesday's class is as much
   someone's labour as one attached to last Tuesday's.

   **The rule is semantic, not a list of features** (Revision 43.6): *a session
   is protected whenever it holds data created by a user or an administrator
   whose loss or silent modification would change historical truth.* Attendance,
   grades, evaluations, certificates and messaging are **instances** of that
   rule, not clauses of it — an implementer asks *"would losing this
   misrepresent what happened?"*, not *"is my feature on the list?"*.

   **One mechanism, extended by contribution.** `policies/session-protection.ts`
   is the single authority every scheduling operation asks, and a module
   contributes its condition **knowing nothing about scheduling**:

   ```ts
   registerSessionProtectionRule({
     code: 'HAS_ATTENDANCE',
     describes: 'attendance has been recorded for this session',
     evaluate: (tx, sessions) => /* one query for all of them */,
   });
   ```

   Two properties are required and are not negotiable: rules are **evaluated in
   bulk**, so protection never becomes a per-session query; and the **built-ins
   are always present** rather than registered at boot, because a protection you
   can switch off by forgetting a bootstrap call is not a protection. Rules may
   only *add* protection — there is no un-protect, or one module could overrule
   another's safeguard.

   *(The deletion path carried its own private copy of this test until Revision
   43.5 unified it — which is exactly the failure the registry now prevents.)*

   Overwriting a protected session is possible only by **naming it explicitly**.
   There is no blanket "regenerate all" option and no flag on the edit: an option
   that can be defaulted true is not a confirmation.
3. **Never regenerates the past.** Generation starts at today, so a schedule
   edited in November does not resurrect September.
4. **Snapshots the teaching assignment** (Revision 43.4). Room and staff are
   written onto each occurrence rather than re-derived at read time, so a class
   that has already been taught keeps the people who actually taught it when the
   schedule later changes hands. A schedule edit re-syncs only **future,
   un-overridden** occurrences; re-aligning one that has already happened is a
   separate, audited administrator action.

**The horizon is the end of the current academic year**, extended by the nightly
run. Bounded deliberately: an unbounded horizon would generate rows for a
schedule that may be discontinued next term.

**Schedule writes materialize inside their own transaction**, so the calendar is
never briefly empty and the conflict check just performed is not against a state
that never existed. The job exists to advance the horizon and to reconcile.

### `consent.reevaluate` — full recompute, deliberately

It recomputes the complete current audience of every Session linked to the same recording,
rather than applying a delta. Audience resolution is the canonical R43/R92 rule: entire
Level at the occurrence's audience branches, Administrative Group, or Teaching Group. The
union is strict: one linked Session containing one beneficiary without an effective latest
`media_release` grant forces the recording. Absence is no consent; an empty audience does not
engage the gate.

The inverse student-to-Session trigger follows retained live occurrences even after their
recurring schedule is soft-deleted, and it applies R92 occurrence audience branches rather
than falling back to the schedule branch. Changing those R92 branches enqueues in the same
transaction as the audience update.

The complete shared-recording Session graph is discovered first, then its rows are locked once
in global UUID order before audiences are resolved. Link/replacement/deletion writers take the
same anchors; if the graph grows during acquisition, the worker retries rather than taking a
late lower-order lock. Recording rows are then locked in UUID order. A concurrent mutation is
therefore included or commits a follow-up. The worker can only move toward safety: it sets
`consent_forced_private`, writes the system `content.visibility_change` audit, and enqueues an
exact-source physical transition in one transaction. It never automatically clears a forced
state after a later grant; BR-3 reserves that decision to an Admin with justification.

For a public item, `consent_forced_private = true` immediately removes it from application
library/session reads and from Nginx's stable public origin. `visibility = public` and
`storage_bucket = public` still honestly represent the network-internal source while physical
work is pending. `content.bucket-migrate`, carrying the exact source key, then:

1. hashes the immutable canonical source;
2. server-side copies it to the private bucket with that SHA-256 as server metadata;
3. hashes the destination and requires identical bytes and size;
4. under a content row lock, re-reads the version/key/forced state;
5. deletes the public source; and only then commits `visibility = private`, the private
   bucket coordinate and mandatory system audit.

A delete failure rolls the database transition back and TD-7 retries. If deletion succeeded
but the database commit did not, the private object's server-written digest makes recovery
provable even though the source is gone. Duplicate work is idempotent, and a stale snapshot
cannot overwrite a replacement or a deletion. This worker implements only consent-forced
public → private movement; it is not general visibility editing or bucket housekeeping.

Replacement and deletion also commit exact-key retirement obligations in this same queue.
Replacement can publish a new canonical key only with the monotonic flag already set, queues
the new key's migration, and retires the old key into private quarantine. A stale migration
whose row now names another key becomes that same retirement operation. A missing source is
success, which is what makes a retry after an ambiguous successful delete converge without
guessing or touching the replacement key.

Rows committed before B-01 used the older three-column repository insert and therefore lack
per-job retry/expiry policy. They are not bulk-rewritten. When such a row becomes active, the
worker first commits one correctly configured full-recompute follow-up under the same
singleton key; many legacy duplicates therefore converge on one pending recovery obligation,
and an old one-shot failure cannot strand safeguarding.

### `audit.purge` — the one that needed three attempts

Retention deletes audit rows matching **BOTH** an **enumerated action-type allowlist** **AND**
the 12-month age horizon:

```
auth.login · auth.login_denied · auth.identity_bound
auth.refresh · auth.logout · auth.token_revoked
```

Extending that list requires a specification revision.

**Age-only deletion is prohibited. So is prefix matching.** An earlier version selected
`auth.*` rows older than the horizon; the Document Owner required an explicit allowlist
rather than age alone, and review found that **a glob is not an allowlist** — `auth.*` would
silently sweep in any future action beginning with `auth.` (post-MVP local authentication
adds several) without anyone having decided it was purgeable.

Every other action type — including the indefinitely-retained security events
`consent_gate.override`, `grade.passfail_override`, `settings.change`, and
`trash.manual_restore` — must survive the job untouched, and **a test asserts exactly that
rather than trusting the query.**

This job is also what makes the storage projection real rather than aspirational. Access
tokens live one hour, so every active session writes a refresh audit row roughly hourly:
roughly **800–900k authentication rows a year** at launch scale. Those rows are **bounded
rather than cumulative** precisely because this job collects them. Without it, per-refresh
auditing grows without limit.

## Why some things are deliberately *not* jobs

**Quran coverage recalculation is synchronous.** Creating, editing, or deleting a log
recomputes that Surah's coverage **in the same request**, and the guardrails forbid moving
it into a job.

The reason is correctness, not responsiveness: coverage drives level completion. A deferred
recalculation leaves a window in which a student appears to have completed a level they have
not, and a teacher correcting a mis-logged range would not see the correction.

**Per-user quota enforcement is synchronous.** A job queue is asynchronous; a quota decision
must be synchronous and transactional with the request it gates. Routing it through pg-boss
is explicitly prohibited.

## What is prohibited as a substitute

> Never replace these with in-memory queues, `setImmediate`, unawaited promises, or ad-hoc
> timers. **Job state must survive container restarts.**

Nor in-process mutexes or advisory-lock improvisations for concurrency control — pg-boss
singleton keys are the mechanism for background work.

## When the workers are down

Because enqueues are database inserts inside application transactions, they **keep
succeeding** while workers are down. Jobs are **delayed, never lost**, and drain on restart.

A queue-lag alarm past ten minutes surfaces on the Admin dashboard.

> [Resilience](../operations/resilience.md#degraded-operation)

---

**Next:** [Calendar and Hijri](calendar-and-hijri.md) · **Related:**
[Backend](backend.md#transactions), [Storage](storage.md#consent-gating)
