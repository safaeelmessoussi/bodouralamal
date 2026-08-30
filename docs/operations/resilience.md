[Documentation](../README.md) › [Operations](README.md) › **Resilience**

# Resilience

Backup, restore, and what the platform does while a dependency is down.

## Backup

| | Target |
|---|---|
| **What** | Nightly `pg_dump`, plus Docker volume backups |
| **Where** | Replicated **offsite to a second Moroccan location** via `restic` over SSH |
| **RPO** | **≤ 24 hours** (nightly) |
| **RTO** | **< 1 hour** |
| **Proof** | A **documented, periodically tested restore procedure** — a launch requirement |

Both locations are inside Morocco, because backups are personal data and
[`BR-18`](../reference/business-rules.md#br-18) makes no exception for them.

The required steady state is a nightly run, a critical Admin-visible failure signal, and Owner
escalation after two consecutive failures. **That scheduler/alert is not implemented yet.** TD-7
names `backup.replicate` as a pg-boss job, while the coherent recovery operation must stop
Compose services and read host volumes; granting the API Docker-host authority is rejected.
The Document Owner must reconcile the execution boundary before launch. The host-scoped tool is
ready and fails before writer outage when its encrypted target/credential preflight is invalid;
an unmonitored cron entry is not represented here as the missing job.

> Running without offsite backup is an accepted emergency state measured in **days, not
> weeks**.

### The restore target is asserted against real size

The RTO is not aspirational arithmetic. It is asserted against a database carrying the
projected audit footprint — **~0.6–0.7 GB at launch, ~3–3.75 GB at ceiling** — and the
12-month authentication-row retention is what keeps that figure flat instead of growing
every year.

A retention policy that is not enforced by a job would make the RTO drift quietly upward,
which is one of the reasons the purge job exists at all.

### Drill it, do not trust it

An untested backup is a belief, not a backup. The restore drill is:

- a **launch requirement**, before go-live, and
- repeated **periodically** thereafter.

## Degraded operation

The system **never fabricates success.** A failed dependency yields `503` on the affected
operations and a proper error state in the interface — never a blank screen, never silent
data loss.

| Dependency down | Blast radius | Behaviour |
|---|---|---|
| **Google OAuth** | New logins and registrations only | **Active sessions are unaffected** — token refresh is local and never calls Google. Code exchange, ID-token verification, or signing-certificate retrieval failure all fail closed; `/login` shows a friendly "temporarily unavailable" state with retry. Provider certificates are cached according to Google's response. No queuing of registrations |
| **MinIO** | Uploads, downloads, previews, bucket migrations | Those return `503`; content pages render their error state with retry. **Everything else — scheduling, grading, Quran, approvals — continues fully.** Migration jobs retry; the database row remains the source of truth, so **no window of wrong exposure opens** |
| **PostgreSQL** | Everything | Total API outage. Health returns `503`; Nginx serves the static client shell and maps API failures to a friendly maintenance interstitial — **never a raw 502 page.** There is no read-only or cached mode |
| **Job workers** (database up, workers down) | Background latency only | Health returns `503` with `queue: ok`, `jobs: down`, and a stable runner reason. **Enqueues keep succeeding** — they are database inserts inside application transactions. Jobs are **delayed, never lost**, and drain on restart. Queue-lag alarm past 10 minutes |
| **Backup target** | Backup redundancy only | Critical alert; production continues; nightly retry |
| **Let's Encrypt renewal** | Future TLS validity | Alert at **21 days remaining** |

### Two rows worth dwelling on

**Google being down does not log anyone out.** Refresh is entirely local — it validates a
hashed token against our own database and never calls Google. That is a direct consequence of
the session design, and it means an OAuth outage costs the association *new sign-ins*, not
*every active session*.

**Workers being down loses nothing.** Because enqueues are database inserts that join the
triggering transaction, a dead worker is a latency problem rather than a correctness problem.
Consent re-evaluations and bucket migrations queue up and drain on restart. This is the
single strongest argument for the Postgres-backed queue over an external broker
([why](../architecture/background-jobs.md#why-not-redis)).

## Timeout discipline

Every outbound call carries an **explicit 5-second timeout** and **no automatic in-request
retry beyond one**.

> Retry belongs to the user action or the job layer, not hidden loops that stack latency.

## Shutdown and restart

SIGTERM makes the API stop accepting HTTP and background work together, then drains both. pg-boss
gets a bounded 105 seconds to finish an active handler or durably return it to retry; the Compose
API service gets 120 seconds before Docker may send SIGKILL, leaving 15 seconds for request close,
database-pool disconnect and process exit. A process-local latch makes repeated SIGTERM/SIGINT
signals no-ops after the first and prevents two competing drains.

The repository-side Production drill asserts the resolved two-minute container budget and
exercises both sides of the worker boundary: work inserted while the API is stopped remains
`created` and drains after start, while a handler observed `active` during SIGTERM completes before
the restart. It also restarts PostgreSQL and Nginx independently, performs a full-stack stop/start,
and force-recreates every long-running container over unchanged PostgreSQL/MinIO volumes. After
each data-boundary phase it rechecks the exact Production seed, migration history, a private object,
and durable job terminal states; ordinary API startup is also asserted not to migrate or seed.

The remaining host row in the readiness ledger is intentionally narrower: a real host reboot,
resource and disk pressure, supported replacement object store, and realistic-volume RTO still
need to be observed on the selected VPS.

## Concurrency failures are expected, not exceptional

Worth listing under resilience because the temptation is to treat them as errors:

| Situation | Result |
|---|---|
| Two admins edit one record | First save wins; the second gets `409 VERSION_CONFLICT`, reloads, re-applies |
| Two admins approve one registration | First commits; the second gets `409 STATE_CONFLICT`, which the UI treats as "already handled, refreshing" |
| Two concurrent enrolments at capacity − 1 | A row lock admits **exactly one** |
| Two tabs refresh simultaneously | Exactly one rotation; the loser is absorbed by the grace window and **nobody is logged out** |
| Refresh races current-session logout | Both lock the stable `RefreshSession` row. Logout first refuses rotation; rotation first is followed by a second locked issuance check, so logout in that gap makes refresh return `401`. If issuance locks first, the access token is issued before logout and logout waits. No live successor survives; other sessions use disjoint rows |
| `token.purge` races refresh/logout at expiry | Purge locks the same session anchor before deleting generations and removes the anchor only with the last token. A deleted predecessor cannot hide a newly inserted successor from logout |

> **Concurrency conflicts are never surfaced as 500s**, and escalating the isolation level to
> paper over a missing lock is prohibited.

## What has no fallback, deliberately

**There is no read-only mode.** If PostgreSQL is down the platform is down. Building a
degraded read path would mean a second data source that must be kept consistent — a
permanent correctness cost against a single-VPS availability target of 99 % monthly.

**There is no offline mode.** Users are on unreliable connections, which is addressed by
keeping payloads small and retries clear, not by building a sync engine.

**A Hijri month that is not recorded renders nothing.** The absence of data is not a failure
state to be filled with a computed guess — it is the correct answer.

---

**Next:** [Runbooks](runbooks.md) · **Related:**
[Observability](observability.md),
[Background jobs](../architecture/background-jobs.md#when-the-workers-are-down)
