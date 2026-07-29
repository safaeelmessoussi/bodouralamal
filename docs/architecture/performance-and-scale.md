[Documentation](../README.md) › [Architecture](README.md) › **Performance and scale**

# Performance and scale

The shortest useful summary: **this is a small system, and saying so plainly is what keeps
it correct.**

## The design envelope

| Dimension | Launch (year 1) | **Design ceiling** — reach this without re-architecture |
|---|---|---|
| Total users | ~900, growing | **5,000** |
| Branches / rooms / groups | 1–3 / ~10 / ~40 | 10 / 60 / 200 |
| Concurrent sessions | ~50 | 300 |
| Quran progress logs | ~30k/year | 200k total |
| Grades and submissions | ~15k/year | 100k total |
| Content objects | ~1k/year, audio-dominant | 10k |
| Audit rows — **authentication** | **~800–900k/year**, ~900k steady state | ~5M/year, ~5M steady state |
| Audit rows — everything else | ~100k/year, accumulating | ~500k/year, accumulating |

**These are planning estimates for infrastructure sizing, not hard limits.** Nothing in the
application enforces them, and exceeding one is not a fault condition. The table exists so
the VPS is provisioned honestly and so implementers know which access patterns must stay
index-backed.

### Why authentication rows dominate

Access tokens live one hour, so every active session writes a refresh audit row roughly
hourly. At launch scale that is an order of magnitude more rows than everything else
combined.

That figure is **a direct consequence of session behaviour**, not a logging accident, and
per-refresh auditing is deliberately **not** reduced to save rows — the attribution
invariant depends on it.

When this was discovered, the choice was to **revise the estimate rather than weaken the
audit trail.** The rows are **bounded rather than cumulative**: they fall under 12-month
retention and are collected by a job, so their steady state is one rolling year. Only the
non-authentication rows accumulate indefinitely.

### Storage projection

An audit row costs roughly **400–500 bytes all-in** — row header, payload, and its three
index entries.

| | Launch | Ceiling |
|---|---|---|
| Rows in steady state | ~1.4M | ~7.5M |
| **Disk footprint** | **~0.6–0.7 GB** | **~3–3.75 GB** |

This is **disk, not RAM** — it does not compete with the container memory pins, but it
belongs in the VPS disk budget beside the audio estimate, and it enters backup sizing: the
audit table is in every nightly dump and every offsite push, and the **restore-time target
is asserted against a database carrying this footprint.** The 12-month retention is what
keeps that flat instead of growing every year.

## Binding guidance

Two halves, and both matter.

### Do not build for scale you do not have

> **Do not introduce caching layers, read replicas, sharding, search engines, or horizontal
> scaling machinery for the MVP. Premature optimization is a defect here.**

The single-VPS topology is **the correct architecture for this entire envelope**. Every
piece of scaling machinery is a container to run, a failure mode to handle, a thing to back
up, and a source of consistency bugs — paid for permanently, against a load that does not
require it.

### Do not write code that dies at the ceiling

Equally binding, and it is the half that gets forgotten:

- **Every list is paginated.** Default 25, maximum 100.
- **Every hot path is index-backed**, with composite indexes matched to actual query
  patterns.
- **No endpoint performs an unbounded scan or an N+1 loop.**
- **Latency targets are measured against ceiling-scale fixture data**, not a ten-row
  development database.

That last point is the one most often skipped, and it is why targets are stated against
fixtures at the ceiling rather than against whatever happens to be in a developer's database.

## Measurable targets

| Metric | Target |
|---|---|
| Standard API reads (dashboards, lists) | p95 **< 300 ms** |
| Quran progress write **including the synchronous interval merge** | p95 **< 100 ms** |
| Presigned URL mint | p95 **< 150 ms** |
| Full-level grade recalculation (100 students × 10 exams) | **< 60 s**, background |
| Backup RPO / RTO | **≤ 24 h / < 1 h**, restore drill passed before launch |
| Availability (single VPS, realistic) | **99 % monthly** |

The second row is the interesting one: the synchronous recalculation is **inside** the
budget, not excused from it. That constraint is what forced the self-healing cache design
rather than a naive recompute-on-read.

## Caching

Almost nothing is cached, and the one exception is scoped deliberately.

| | Policy | Reasoning |
|---|---|---|
| `GET /calendar/bootstrap` | `public, max-age=300` + strong `ETag` | Reference data. A Super Admin recording a Hijri month or adding a level is not a change a visitor must see within seconds |
| `GET /calendar` | **Uncached** | An event edit **is** a change a visitor must see immediately |
| Everything else | Uncached | Authenticated, personal, or low-volume |

Reference data and operational data have different rates of change, and that difference is
the seam the split follows. Five minutes was chosen against **what actually changes**, not
picked as a round number.

There is **no server-side cache layer** — no Redis, no in-process memoization of query
results. The one cache in the system is the Quran coverage row, and it is
[self-healing and never authoritative](database.md#studentsurahprogress--a-cache-that-cannot-go-stale).

## The one real cache, and its discipline

`StudentSurahProgress` exists because the pure derive-on-read design would have cost
O(n·logs) per read at ceiling scale. It is worth reading as a pattern:

- The **logs are always the source of truth.** The cache is an optimization, never an
  authority.
- Every row carries a **stamp of the newest log it saw.**
- Every consumer compares that stamp against the latest log (one indexed max) and, on
  mismatch, **recomputes and repairs the row in place before using it.** A stale read is
  structurally impossible, including after a crash between the log commit and the cache
  write.
- **List pages run the guard as one joined query** — never per-row cache reads plus per-row
  max lookups, which would be *a stealth N+1 wearing a cache costume*.

## Resource budget on a 4 GB box

```
Postgres    shared_buffers = 256MB · work_mem = 8MB · max_connections = 30
MinIO       GOMEMLIMIT = 512MiB
Node        --max-old-space-size = 768
Prisma      connection_limit = 10
pg-boss     pool ≤ 5
            statement_timeout = 10s
```

**Steady-state target ≈ 2.2 GB.** These are configuration, not suggestions — leaving any of
them at defaults is called out as non-compliant.

The headroom exists **only because production images are built in CI and pulled**. The
frontend build peaks near 2 GB, which would exhaust a box already running PostgreSQL, MinIO,
and Node. Building on the server is an emergency-only fallback, with the stack fully down.

> [Deployment](../operations/deployment.md)

## Connection pooling is the real risk

Stated explicitly in the specification: **the concurrency risk on this box is pool
exhaustion, not deadlock.**

Hence the pinned budget above, and hence the ten-second statement timeout — interactive
transactions must finish well inside it, which is also a design constraint on how much work
a transaction may do.

## Front-end performance

The connectivity constraint drives more here than raw payload size:

- **No web font** — a linked face would be CSP-blocked and silently fall back; an inlined
  Arabic face costs 200 KB–1 MB.
- **Two runtime dependencies**, React and React DOM.
- **The calendar makes exactly two requests and never a third**, including when an event is
  opened — because occurrences are self-sufficient. The alternative was an N+1 on the screen
  a visitor is most likely to open.
- **Static assets are gzipped** (and brotli where available) at the proxy.

## Growth beyond the ceiling

A second institute means a **separate dedicated deployment** — its own VPS, database, MinIO,
and domain, which the containerized pipeline makes operationally cheap — or a deliberate,
owner-approved re-architecture.

**It is not something MVP code should speculatively absorb**, and reintroducing tenancy
plumbing in anticipation is prohibited.

---

**Related:** [System overview](system-overview.md#why-one-box),
[Database](database.md#connection-budget), [Resilience](../operations/resilience.md)
