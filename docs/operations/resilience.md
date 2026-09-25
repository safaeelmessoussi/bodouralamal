[Documentation](../README.md) › [Operations](README.md) › **Resilience**

# Resilience

Backup, restore, and what the platform does while a dependency is down.

## Backup

| | Target |
|---|---|
| **What** | Monthly coherent `pg_dump` plus stopped PostgreSQL/SeaweedFS/TLS volumes and config; at most two generations after verified rotation (R133) |
| **Where** | Encrypted restic repository on the **same Moroccan Production VPS**, temporarily authorised for the first couple of months (B8, 2026-09-12) |
| **RPO** | Last successful monthly point; **not ≤ 24 hours** |
| **RTO** | **< 1 hour target**; real-volume host drill still required |
| **Proof** | A **documented, periodically tested restore procedure** — a launch requirement |

- Residency stays under [`BR-18`](../reference/business-rules.md#br-18); the same-VPS decision supersedes the offsite prerequisite, not residency. **Total disk/VPS/provider loss is not recoverable from the sole same-host copy**; root compromise can destroy both copies. Logical/application recovery, not full DR.
- The [host schedule and operator procedure](recovery.md): daily retry of a monthly backup, full-data verification before rotation, private status, five-minute checks (backup/disk, worker health, storage-retirement backlog); two consecutive failures escalate to the Owner. No dashboard alerts, external notification or `backup.replicate` in pg-boss; TD-7/TD-14/TD-16 reconciliation remains explicit; the API never gets Docker-host authority.
- Production RTO must be measured against the projected audit footprint — **~0.6–0.7 GB at launch, ~3–3.75 GB at ceiling**; the 12-month authentication-row retention (enforced by the purge job) keeps it flat.
- An untested backup is a belief: the restore drill is a **launch requirement** and is repeated **periodically**.
- **One backup a month, two generations alive** (R133): the older is pruned **only after the new one is written and verified** — `restic check --read-data` first; a failed backup or check aborts before prune; ordering guarded in `check-backup-tooling.sh`. Two is deliberately small: enough to survive one corrupt latest generation, and **every extra generation retains data somebody asked to delete**.

### There is NO deletion replay — and what that honestly means

A replay design (re-apply deletions recorded since the restore point) existed 2026-09-04 to 2026-09-05; **the Owner withdrew it** — a subsystem, ledger and procedure to compensate for a restore that should be rare. Consequences:
- **A live deletion does not modify an existing backup**; no per-user pruning inside a taken archive.
- **Personal data deleted live may remain in an older encrypted generation until rotation expires it** — at most two months.
- **A restored backup is the state at the instant it was taken**; what to do about later deletions is an operational decision taken then.
- **The person is told this on the deletion confirmation itself**, in her own language.

## Degraded operation

The system **never fabricates success**: a failed dependency yields `503` on affected operations and a proper error state — never a blank screen, never silent loss.

| Dependency down | Blast radius | Behaviour |
|---|---|---|
| **Google OAuth** | New logins and registrations only | **Active sessions unaffected** — refresh is local and never calls Google. Code exchange, ID-token verification or certificate retrieval failure fail closed; `/login` shows "temporarily unavailable" with retry; certificates cached per Google's response; no queued registrations |
| **MinIO** | Uploads, downloads, previews, bucket migrations | `503`; content pages render their error state with retry. **Scheduling, grading, Quran, approvals continue fully.** Migration jobs retry; the database row is the source of truth, so **no window of wrong exposure opens** |
| **PostgreSQL** | Everything | Total API outage; health `503`; Nginx serves the static shell and maps API failures to a maintenance interstitial — **never a raw 502**. No read-only or cached mode |
| **Job workers** (database up) | Background latency only | Health `503` with `queue: ok`, `jobs: down`, stable runner reason. **Enqueues keep succeeding** (database inserts inside application transactions); jobs **delayed, never lost**, drain on restart; queue-lag alarm past 10 minutes |
| **Backup target** | Recovery capability | Critical host status/journal; production continues if preflight fails; daily retry, escalation after two failures |
| **Let's Encrypt renewal** | Future TLS validity | Alert at **21 days remaining** |

- **Google down logs nobody out**: refresh validates a hashed token against our own database; an OAuth outage costs *new sign-ins*, not active sessions.
- **Workers down loses nothing**: enqueues join the triggering transaction, so a dead worker is latency, not correctness — the strongest argument for the Postgres-backed queue ([why not Redis](../architecture/background-jobs.md#why-not-redis)).

## Timeout discipline

Every outbound call: **explicit 5-second timeout**, **no in-request retry beyond one**; retry belongs to the user action or the job layer.

## Shutdown and restart

- SIGTERM stops HTTP and background intake together, then drains both: pg-boss gets 105 seconds to finish an active handler or return it to retry; the Compose API service gets 120 seconds before SIGKILL, leaving 15 seconds for request close, pool disconnect and exit. A process-local latch makes repeated SIGTERM/SIGINT no-ops.
- The Production drill asserts the two-minute container budget and both worker-boundary sides (work inserted while stopped stays `created` and drains; a handler `active` at SIGTERM completes before restart); restarts PostgreSQL and Nginx independently; full-stack stop/start; force-recreates every long-running container over unchanged volumes; rechecks Production seed, migration history, a private object and job terminal states after each phase; asserts startup neither migrates nor seeds; then takes a real encrypted recovery point, writes later values, destroys both volumes, restores into empty replacements and requires exact image IDs plus whole-platform health on the earlier values. The manifest must name repository HEAD.
- Still to observe on the selected VPS: real reboot, resource/disk pressure, GHCR pull/public TLS, the B1 SeaweedFS store and same-VPS repository, realistic-volume RTO.

## Concurrency failures are expected, not exceptional

| Situation | Result |
|---|---|
| Two admins edit one record | First save wins; second gets `409 VERSION_CONFLICT`, reloads, re-applies |
| Two admins approve one registration | First commits; second gets `409 STATE_CONFLICT` ("already handled, refreshing") |
| Two concurrent enrolments at capacity − 1 | A row lock admits **exactly one** |
| Two tabs refresh simultaneously | Exactly one rotation; the loser is absorbed by the grace window, **nobody is logged out** |
| Refresh races current-session logout | Both lock the stable `RefreshSession` row. Logout first refuses rotation; rotation first is followed by a second locked issuance check, so logout in that gap makes refresh `401`; if issuance locks first, the token issues and logout waits. No live successor survives; other sessions use disjoint rows |
| `token.purge` races refresh/logout at expiry | Purge locks the same session anchor before deleting generations and removes the anchor only with the last token; a deleted predecessor cannot hide a new successor from logout |

**Concurrency conflicts are never 500s**; escalating isolation level to paper over a missing lock is prohibited.

## What has no fallback, deliberately

- **No read-only mode**: PostgreSQL down = platform down; a degraded read path is a second data source to keep consistent, against a 99 % monthly single-VPS target.
- **No offline mode**: unreliable connections are met with small payloads and clear retries, not a sync engine.
- **An unrecorded Hijri month renders nothing**: absence of data is the correct answer, not a gap to fill with a computed guess.

---

**Next:** [Runbooks](runbooks.md) · **Related:** [Observability](observability.md), [Background jobs](../architecture/background-jobs.md#when-the-workers-are-down)
