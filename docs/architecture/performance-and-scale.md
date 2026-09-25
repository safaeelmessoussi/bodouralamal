[Documentation](../README.md) › [Architecture](README.md) › **Performance and scale**

# Performance and scale

A small system; saying so plainly keeps it correct.

## The design envelope

| Dimension | Launch (year 1) | Design ceiling (no re-architecture) |
|---|---|---|
| Total users | ~900, growing | 5,000 |
| Branches / rooms / groups | 1–3 / ~10 / ~40 | 10 / 60 / 200 |
| Concurrent sessions | ~50 | 300 |
| Quran progress logs | ~30k/year | 200k total |
| Grades and submissions | ~15k/year | 100k total |
| Content objects | ~1k/year, audio-dominant | 10k |
| Audit rows — authentication | ~800–900k/year, ~900k steady state | ~5M/year, ~5M steady state |
| Audit rows — everything else | ~100k/year, accumulating | ~500k/year, accumulating |

- Planning estimates for VPS sizing, not enforced limits; exceeding one is not a fault.
- Authentication rows dominate: one-hour access tokens → a refresh audit row per session roughly hourly; per-refresh auditing is not reduced (attribution invariant); estimate revised instead.
- Authentication rows are bounded by 12-month retention collected by a job (steady state one rolling year); non-authentication rows accumulate indefinitely.

### Storage projection

Audit row ≈ 400–500 bytes all-in (header, payload, three index entries).

| | Launch | Ceiling |
|---|---|---|
| Rows in steady state | ~1.4M | ~7.5M |
| Disk footprint | ~0.6–0.7 GB | ~3–3.75 GB |

- Disk, not RAM; enters the VPS disk budget beside the audio estimate and backup sizing (every nightly dump and offsite push); the restore-time target is asserted against this footprint.

## Binding guidance

- Do not introduce caching layers, read replicas, sharding, search engines or horizontal scaling machinery for the MVP; premature optimization is a defect; single VPS is the correct architecture for the whole envelope.
- Do not write code that dies at the ceiling: every list paginated (default 25, maximum 100); every hot path index-backed with composite indexes matched to real queries; no unbounded scan or N+1; latency targets measured against ceiling-scale fixture data.

## Measurable targets

| Metric | Target |
|---|---|
| Standard API reads (dashboards, lists) | p95 < 300 ms |
| Quran progress write including the synchronous interval merge | p95 < 100 ms |
| Presigned URL mint | p95 < 150 ms |
| Full-level grade recalculation (100 students × 10 exams) | < 60 s, background |
| Backup RPO / RTO | ≤ 24 h / < 1 h, restore drill passed before launch |
| Availability (single VPS) | 99 % monthly |

- The synchronous recalculation is inside the 100 ms budget; this forced the self-healing cache over recompute-on-read.

## Caching

| | Policy | Reason |
|---|---|---|
| `GET /calendar/bootstrap` | `public, max-age=300` + strong `ETag` | Reference data; a recorded Hijri month or new level need not appear within seconds |
| `GET /calendar` | Uncached | An event edit must be visible immediately |
| Everything else | Uncached | Authenticated, personal or low-volume |

- No server-side cache layer: no Redis, no in-process memoization; the only cache is the Quran coverage row ([self-healing, never authoritative](database.md#studentsurahprogress--a-cache-that-cannot-go-stale)).

## The one real cache, and its discipline

- `StudentSurahProgress` exists because derive-on-read costs O(n·logs) per read at ceiling.
- Logs are the source of truth; each row carries a stamp of the newest log seen; every consumer compares against the latest log (one indexed max) and repairs in place on mismatch, so a stale read is impossible even after a crash between log commit and cache write.
- List pages run the guard as one joined query, never per-row reads plus per-row max lookups.

## Resource budget on a 4 GB box

| Component | Pin |
|---|---|
| Postgres | `shared_buffers = 256MB` · `work_mem = 8MB` · `max_connections = 30` |
| MinIO | `GOMEMLIMIT = 512MiB` |
| Node | `--max-old-space-size = 768` |
| Prisma | `connection_limit = 10` |
| pg-boss | pool ≤ 5 |
| SQL | `statement_timeout = 10s` |

- Steady-state target ≈ 2.2 GB; defaults are non-compliant.
- Headroom exists only because production images are built in CI and pulled; the frontend build peaks near 2 GB; building on the server is emergency-only with the stack down ([Deployment](../operations/deployment.md)).

## Connection pooling is the real risk

- The concurrency risk is pool exhaustion, not deadlock; hence the pinned budget and the 10 s statement timeout, which bounds how much work a transaction may do.

## Front-end performance

- No web font (a linked face is CSP-blocked; an inlined Arabic face costs 200 KB–1 MB).
- Two runtime dependencies: React and React DOM.
- The calendar makes exactly two requests, never a third, even when opening an event (occurrences are self-sufficient).
- Static assets gzipped (brotli where available) at the proxy.

## Growth beyond the ceiling

- A second institute = separate deployment (own VPS, database, MinIO, domain) or owner-approved re-architecture; speculative tenancy plumbing prohibited.

**Related:** [System overview](system-overview.md#why-one-box), [Database](database.md#connection-budget), [Resilience](../operations/resilience.md)
