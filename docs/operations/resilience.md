[Documentation](../README.md) › [Operations](README.md) › **Resilience**

# Resilience

Backup, restore, and what the platform does while a dependency is down.

## Backup

| | Target |
|---|---|
| **What** | Monthly coherent `pg_dump` plus stopped PostgreSQL/SeaweedFS/TLS volumes and config; at most two generations after verified rotation (R133) |
| **Where** | Encrypted restic repository on the **same Moroccan Production VPS**, temporarily authorized by the Owner for the first couple of months (B8, 2026-09-12) |
| **RPO** | Last successful monthly point; **not ≤ 24 hours** |
| **RTO** | **< 1 hour target**, real-volume host drill still required |
| **Proof** | A **documented, periodically tested restore procedure** — a launch requirement |

Backup residency remains subject to [`BR-18`](../reference/business-rules.md#br-18).
The temporary same-VPS Owner decision supersedes the earlier offsite prerequisite, not
residency. **Total disk/VPS/provider loss is not recoverable from the sole same-host copy.**
Root compromise can destroy both copies. This is logical/application recovery, not full DR.

The [host schedule and operator procedure](recovery.md) implements daily retry of a monthly
backup, full-data verification before rotation, private status, and five-minute checks combining
backup/disk, worker health and durable storage-retirement backlog. Two consecutive failures
require operator escalation to the Owner. It does not implement dashboard alerts, external
notification delivery or `backup.replicate` inside pg-boss. TD-7/TD-14/TD-16 reconciliation
remains explicit; the API never receives Docker-host authority.

### The restore target is asserted against real size

Production RTO must be measured against a database carrying the
projected audit footprint — **~0.6–0.7 GB at launch, ~3–3.75 GB at ceiling** — and the
12-month authentication-row retention is what keeps that figure flat instead of growing
every year.

A retention policy that is not enforced by a job would make the RTO drift quietly upward,
which is one of the reasons the purge job exists at all.

### Drill it, do not trust it

An untested backup is a belief, not a backup. The restore drill is:

- a **launch requirement**, before go-live, and
- repeated **periodically** thereafter.

### Rotation: monthly, at most two generations (Revision 133)

**One backup a month, two generations alive.** The older one is pruned **only
after the new one has been written and verified** — `restic check --read-data` runs first,
and a failed backup or a failed check aborts before the prune, so a bad night can
never be the reason the last good generation disappears. The ordering is guarded
in `check-backup-tooling.sh`.

Two is deliberately small. It is enough to survive one corrupt latest generation
and no more, because **every extra generation is extra retention of data somebody
asked to have deleted**.

### There is NO deletion replay — and what that honestly means

A design existed for one between 2026-09-04 and 2026-09-05: after restoring an
older backup, re-apply every deletion recorded since the restore point, so the
restored system would not resurrect people who had left. **The Owner withdrew
it.** It was a subsystem whose only purpose was to compensate for a restore that
should be rare, and it added a ledger, a procedure and a place to be wrong.

The consequence is stated plainly rather than engineered around:

* **A live deletion does not modify an existing backup.** Nothing is rewritten,
  and no per-user pruning happens inside an archive that has already been taken.
* **Personal data deleted from the live system may remain in an older encrypted
  generation until rotation expires it** — at most two months, given one backup a
  month and two generations kept.
* **A restored backup represents the state at the instant it was taken.** It does
  not remember later deletions, and nothing claims it does. If a restore into
  production is ever actually performed, what to do about deletions made since is
  an operational decision taken then, with the current product state in view.

**This limit is told to the person before she confirms a deletion**, in her own
language, on the confirmation itself — which is the honest place for it.

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
| **Backup target** | Recovery capability | Critical host status/journal; production continues if preflight fails; daily retry of the monthly point, operator escalation after two failures |
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
It then takes a real encrypted recovery point from that Production-mode graph, writes later
database/object values, destroys both disposable volumes, restores into empty replacements and
requires the exact image IDs plus whole-platform health to return on the earlier values. The
recovery manifest must name repository HEAD, so a green restore cannot be detached from its code.

The remaining host row in the readiness ledger is intentionally narrower: a real host reboot,
resource and disk pressure, GHCR pull/public TLS, the B1 SeaweedFS store and temporary same-VPS
encrypted repository, and realistic-volume RTO still need to be observed on the selected VPS.

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
