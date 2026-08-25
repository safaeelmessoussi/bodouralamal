[Documentation](../README.md) › [Operations](README.md) › **Observability**

# Observability

Deliberately minimal. There is no metrics stack, no tracing backend, no log aggregator — on a
single VPS at this scale those are containers to run and secure in exchange for very little.

What exists instead is designed to answer the three questions that actually get asked.

## The three questions

| Question | Answer |
|---|---|
| *Is it up?* | `GET /healthz` |
| *A user reported an error — what happened?* | The `request_id` in the error they saw, grepped in the logs |
| *Did something happen, and who did it?* | The audit log |

## Health

`GET /healthz` — public, unauthenticated, served at the origin root rather than under the
API prefix, so it is reachable exactly as the deployment step calls it.

It checks:

- **Database** connectivity
- **MinIO** reachability
- **pg-boss queue infrastructure** — whether the durable queue schema is available
- **Application workers** — whether this API process completed runner startup, registered
  its implemented worker catalog, and those workers remain active and fresh

Returns `200`, or **`503` with per-component detail** so a failure names which dependency is
down rather than reporting a generic outage.

The existing `components.database`, `components.storage`, and `components.jobs` fields remain
stable. `components.queue` separates infrastructure from workers, while `details.jobs` gives a
machine-readable reason and expected/registered/active counts. In particular,
`queue: "ok"` with `jobs: "down"` means enqueue storage exists but this process has no ready
runner — schema presence alone is never a worker heartbeat.

```json
{
  "status": "degraded",
  "components": {
    "database": "ok",
    "storage": "ok",
    "jobs": "down",
    "queue": "ok"
  },
  "details": {
    "jobs": {
      "state": "down",
      "reason": "startup_failed",
      "expected_workers": 5,
      "registered_workers": 0,
      "active_workers": 0
    }
  }
}
```

Worker reason codes distinguish `not_started`, `starting`, `startup_failed`, incomplete
registration, a missing/inactive/stale worker, shutdown, and an unavailable live-worker
registry. Names appear only for missing or stale workers and contain queue identifiers, never
payload data.

That per-component detail is what makes the [degraded-operation
matrix](resilience.md#degraded-operation) actionable — "MinIO is down" and "PostgreSQL is
down" have completely different blast radii.

## Logs

**Structured JSON**, with a `request_id` on every line.

That same id is propagated into:

- **every error envelope** returned to a client, and
- **every job record**

So a user reporting *"it said something went wrong, and there was a code b3f1…"* is
traceable end to end — through the request, into the job it enqueued, without ever asking who
the user was.

### No PII in logs

Not a guideline. The rule:

> **Log user ids, never names, phones, or emails. Never log request bodies on registration or
> consent endpoints. Never log a child-context header value beside identifying data.**

The population includes minors, the association is subject to Moroccan data-protection law,
and logs are the least-controlled surface in any system — they get copied into tickets,
pasted into chats, and shipped to third parties by accident.

A **log audit** is an explicit item on the deployment checklist.

### Verbosity

`LOG_LEVEL` defaults to `info`. **`debug` is prohibited in production**, where it would
otherwise be the fastest route to the rule above being violated.

## What is alerted

There is no alerting infrastructure. Failures surface where the people who can act on them
will see them:

| Condition | Surfaces as |
|---|---|
| A job exhausts its four retries (five total attempts) | Dead-lettered, with an **Admin-visible failure** |
| **Backup replication fails** | A **critical** Admin-visible alert. Two consecutive failures escalate to the owner |
| Job queue lag past 10 minutes | An alarm on the Admin dashboard |
| TLS renewal failing | Alert at **21 days remaining** — never discovered as a browser error |

**Backup failure is treated as critical** because running without offsite backup is *"an
accepted emergency state measured in days, not weeks."*

## The audit log as an operational tool

Distinct from logs, and worth knowing when debugging:

| | Logs | Audit log |
|---|---|---|
| For | Diagnosis | **Accountability** |
| Retention | Rotated | 12 months for authentication rows; **indefinite** for everything else |
| Contains PII | **Never** | User ids and action detail — never PII values |
| Deletable | Rotated freely | Only by one job, on an enumerated allowlist |

In the MVP there is **no audit browsing page** — reads happen through a documented SQL
runbook. Audit **writing** is fully mandatory; only the reading interface is deferred.

> [Runbooks](runbooks.md#reading-the-audit-log)

One deliberate design note that matters when reading it: `actor_user_id` is **nullable**, and
a null means **system-initiated**, not *attribution lost*. Two mandated actions genuinely have
no human actor — replay-detected session revocation, and the consent job's forced visibility
changes. The action type and detail carry the *why*.

## Timeouts

Every outbound call — Google, MinIO — carries an **explicit timeout, 5 seconds by default**,
and **no automatic in-request retries beyond one**.

> Retry belongs to the user action or the job layer, **not hidden loops that stack latency.**

A hidden retry inside a request turns a 5-second dependency stall into a 15-second one, and
the user has already left.

## What is deliberately absent

- **No metrics stack.** Latency targets are verified by load testing against ceiling-scale
  fixtures before launch, not continuously scraped.
- **No distributed tracing.** There is one service; the request id is sufficient.
- **No log aggregation.** One box, `docker compose logs`.
- **No uptime SaaS.** The realistic target is 99 % monthly on a single VPS, and the health
  endpoint is public for whatever external checker the association chooses.

Each of these becomes worth adding at a scale this platform is explicitly not built for. The
[binding guidance](../architecture/performance-and-scale.md#binding-guidance) against
premature infrastructure applies here as much as to caching layers.

---

**Next:** [Resilience](resilience.md) · **Related:**
[Security § auditing](../architecture/security.md#auditing-as-a-security-control),
[Background jobs](../architecture/background-jobs.md)
