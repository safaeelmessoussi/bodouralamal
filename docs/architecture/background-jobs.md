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
  await jobsRepo.enqueue(tx, 'consent.reevaluate', { group_id });
});

// ❌  boss.send() uses its own connection and sits OUTSIDE the transaction
await prisma.$transaction(async (tx) => {
  await rosterRepo.enrol(tx, …);
});
await boss.send('consent.reevaluate', { group_id });   // prohibited here
```

Job rows are inserted through a dedicated `JobsRepository` using pg-boss's documented job
table format. This is **one of only two places raw SQL is permitted** in application code —
the other being `SELECT … FOR UPDATE` row locks.

`boss.send()` is not banned outright; it is banned **for job-triggering mutations**, which
is where the atomicity matters.

## The catalog

Every job retries with exponential backoff, five attempts maximum, then dead-letters with an
Admin-visible failure. Singleton keys prevent duplicate concurrent runs.

| Job | Trigger | Idempotency |
|---|---|---|
| `consent.reevaluate` | Roster change · split-group membership change · consent change · upload | Singleton per session (Revision 43 — the gate's subject is a session's resolved audience, BR-2); **full recompute**, so re-running is harmless |
| `session.materialize` | Course-schedule create or edit · **nightly cron** | Singleton per schedule. Turns a recurring schedule into dated occurrences over a rolling horizon. See below |
| `content.bucket-migrate` | Visibility change · consent forcing | Copy–verify–delete; skipped if already in the target bucket |
| `backup.replicate` | Nightly cron | `pg_dump` + `restic` push to the second Moroccan location. Failure raises a **critical** Admin-visible alert |
| `content.quarantine-purge` | Daily cron | Permanently removes storage objects past the 90-day trash window |
| `upload.gc` | Daily cron | Deletes initiated-but-never-completed uploads **strictly older than 48 h** — never younger, or a slow upload in progress would be reaped |
| `token.purge` | Daily cron | Removes consumed onboarding tokens past their horizon **and refresh tokens past expiry**, so a table gaining a row per refresh does not grow unbounded |
| `ratelimit.purge` | Daily cron | Removes counters for elapsed windows. **Housekeeping only** — the quota decision is synchronous and never depends on this job |
| `audit.purge` | Daily cron | The single sanctioned deletion path for audit rows. See below |

Post-MVP additions (`import.csv`, `export.csv`, `grade.recalculate`) join with their
features.

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

It recomputes the group's entire consent state rather than applying a delta. That makes it
**idempotent**, safe to run twice, and safe to run after a missed event — properties worth
far more here than the efficiency a delta would buy on groups of a few dozen students.

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
