[Documentation](../README.md) › [Operations](README.md) › **Observability**

# Observability

Deliberately minimal: no metrics stack, tracing backend or log aggregator on a single VPS at this scale.

| Question | Answer |
|---|---|
| *Is it up?* | `GET /healthz` |
| *A user reported an error — what happened?* | The `request_id` in the error, grepped in the logs |
| *Did something happen, and who did it?* | The audit log |

## Health

- `GET /healthz`: public, unauthenticated, at the origin root (not under the API prefix). Checks **database** connectivity, **MinIO** reachability, **pg-boss queue infrastructure** (durable schema present) and **application workers** (runner startup completed, implemented catalog registered, workers active and fresh). Returns `200`, or **`503` with per-component detail**.
- The API container's Docker healthcheck is the same whole-application probe, so database/storage failure, missing queue schema, incomplete registration and stale workers show as `unhealthy` in `docker compose ps`; process liveness is never readiness. Deployment uses curl's fail-on-HTTP-error mode with a 15-second ceiling.
- `components.database`, `components.storage`, `components.jobs` are stable; `components.queue` separates infrastructure from workers; `details.jobs` gives a reason and expected/registered/active counts. `queue: "ok"` with `jobs: "down"` = enqueue storage exists but this process has no ready runner.
- `bash scripts/deploy/verify-production-bootstrap.sh` proves the boundary on the real Production-mode image and TLS edge: all four components green → stop its isolated MinIO → HTTPS `503` with `storage: "down"` and the API container `unhealthy` → restart storage → both recover; a worker-down job drains after restart and health returns only with the complete catalogue live; database, edge, full-stack and container-recreation recovery keep the contract. It publishes no DB/object port, destroys its own volumes, and first loads the app through the TLS edge in headless Chrome (anonymous shell, CSP, public catalogue read, refresh boundary, Production auth limiter).

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

- Reason codes: `not_started`, `starting`, `startup_failed`, incomplete registration, missing/inactive/stale worker, shutdown, unavailable live-worker registry. Names appear only for missing or stale workers and contain queue identifiers, never payload data.
- Per-component detail is what makes the [degraded-operation matrix](resilience.md#degraded-operation) actionable.

## Logs

- **Structured JSON**, `request_id` on every line, propagated into **every error envelope** and **every job record** — traceable end to end without asking who the user was.
- Every base-Compose service uses Docker's `local` driver, five files × 10 MB (50 MB per container). Applies when a container is created/recreated; a Compose change does not retrofit a running container.

### No PII in logs

> **Log user ids, never names, phones, or emails. Never log request bodies on registration or consent endpoints. Never log a child-context header value beside identifying data.**

- Minors in the population, Moroccan data-protection law, and logs as the least-controlled surface.
- The edge generates its own opaque request id; a public `X-Request-Id` is never preserved. Nginx's structured access record holds time, request id, method, status, bytes, timings — **no URI, no client address**. The application logs the matched Express route template (`/admin/users/:id`), never the coordinate; `<unmatched>` for unknown routes. Internal exception text is not logged (SQL, connection strings, filename-derived keys); the fixed failure stage plus `request_id` is the join.
- Nginx's error log cannot be JSON and echoes request coordinates even at `crit`; it is restricted to process/configuration `emerg`. Outcomes stay visible in the access record.
- `AuditLog` (indefinite retention) follows the same rule: its one repository write rejects nested detail that copies names, contacts, titles, labels, filenames or exact storage locators; domain target ids and non-reversible storage-coordinate ids carry attribution. Content workers still receive exact keys in governed job/domain rows; finalization retries derive the canonical key from the signed grant id and accepted SHA-256, with a read-only fallback for legacy rows.
- Not a blanket free-text sanitizer: TD-8 requires reasons, justifications and old/new setting values while TD-14 says never PII; TD-8 also asks identity email on auth rows and raw keys on content rows. Code follows the stricter no-redundant-PII boundary; the Document Owner reconciliations are in `TASKS.md`.
- A **log audit** is a deployment-checklist item.

### Verbosity

`LOG_LEVEL` defaults to `info`; **`debug` is prohibited in production**.

## Required alerts — two of four are on the Super Admin's screen (R169 §11)

«حالة النظام» (`/admin/operations`, `GET /admin/operations/status`, Super Admin only) is the TD-14/TD-16 surface **for the half the application can see**:

| Condition (TD-14/TD-16) | Surfaces as | State |
|---|---|---|
| A job exhausts its four retries (five attempts) | «مهام فشلت نهائيًا» — a count and the ten worst queues by name | **built** |
| Queue lag past 10 minutes | «مهام متأخرة أكثر من عشر دقائق» | **built** |
| Storage retirement failed, late or unknown copy outcome | «ملفات في انتظار الإزالة من التخزين» | **built** (the monitor's third number; not in TD-16's list) |
| **Backup replication fails** | host monitor only — `ESCALATE_OWNER` after two failures | **not on the screen**, and the screen says so |
| TLS renewal failing (alert at 21 days) | nothing | **not built** — no expiry check exists anywhere |

- **One definition:** the read runs the host monitor's SQL verbatim (`scripts/backup/check-readiness.sh`: same two tables, same ten-minute grace). **Counts only** — never payload, error text or storage key (TD-14); queue names are the platform's fixed vocabulary (`jobs/runner.ts`).
- Backup and TLS are absent because the restic repository and `/etc/letsencrypt` are deliberately NOT mounted into the API; the answer carries `host_checks: "not_visible_from_here"`. Surfacing them needs the host to publish status where the API may read (read-only mounted file, or a row the monitor writes) — an infrastructure decision recorded in TASKS.
- `retireUnownedSchedules` (`jobs/runner.ts`) unschedules any pg-boss cron not in `QUEUES` at start-up and removes that queue's never-started jobs (history left to retention); a removed queue's leftover schedule would otherwise show «late» forever.
- **A read, not a notification**: `Notification` stays restricted to Session, Event and Exam facts (R77–R93). B8's [host monitor](recovery.md#operator-signals-not-an-invented-dashboard) is the only thing that can notice the application itself being down.

## The audit log as an operational tool

| | Logs | Audit log |
|---|---|---|
| For | Diagnosis | **Accountability** |
| Retention | Rotated | 12 months for authentication rows; **indefinite** otherwise |
| Contains PII | **Never** | User ids and minimized detail; mandated free text is an explicit Owner-policy decision |
| Deletable | Rotated freely | Only by one job, on an enumerated allowlist |

- **No audit browsing page** in the MVP; reads via the [SQL runbook](runbooks.md#reading-the-audit-log). Writing is mandatory.
- `actor_user_id` is **nullable**; null = **system-initiated** (replay-detected revocation, the consent job's forced visibility changes), never attribution lost.

## Timeouts

Every outbound call (Google, MinIO) carries an **explicit timeout, 5 seconds by default**, and **no in-request retries beyond one**; retry belongs to the user action or the job layer.

## What is deliberately absent

- **No metrics stack** — latency verified by load testing at ceiling-scale fixtures before launch.
- **No distributed tracing** — one service; the request id suffices.
- **No log aggregation** — `docker compose logs`.
- **No uptime SaaS** — target 99 % monthly on one VPS; `/healthz` is public for any external checker the association chooses.

[Binding guidance](../architecture/performance-and-scale.md#binding-guidance) against premature infrastructure applies.

---

**Next:** [Resilience](resilience.md) · **Related:** [Security § auditing](../architecture/security.md#auditing-as-a-security-control), [Background jobs](../architecture/background-jobs.md)
