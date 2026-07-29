[Documentation](../README.md) › [Reference](README.md) › **Technical design constraints**

# Technical design constraints

Nineteen numbered constraints (TD-1 … TD-16, plus TD-6a, TD-6b, TD-11a). Where
[business rules](business-rules.md) say *what the domain requires*, these say *how the system
must be built*.

Authoritative text: SRS §13. This page says what each covers, where it lives in the code, and
which handbook page explains it.

---

## <a id="td-1"></a>TD-1 — State machines

Exhaustive lifecycles for account status, family links, grades, exam submissions, and content
visibility. **Any transition not listed is prohibited and rejected with `STATE_CONFLICT`.**

State changes happen **only through service methods that validate the transition** — never a
raw column update.

Notable: `Rejected` is **terminal** — re-registration requires staff action, never silent
reactivation. `Approved` on a family link is also terminal; revocation is a soft delete, and
the enforcement is already complete because the middleware re-checks per request.

*Code:* `services/` · *Explained:* [Backend](../architecture/backend.md)

## <a id="td-2"></a>TD-2 — Role-permission matrix

**Normative**, and **enforced server-side on every endpoint. UI hiding is never the
enforcement mechanism.**

Admin actions are constrained to assigned branch scope; Super Admin is unscoped by role.
Teacher actions are constrained to groups assigned through group membership. **Parent actions
on child data additionally require per-request child verification** — role alone is never
sufficient.

*Code:* `policies/` · *Explained:*
[Identity and access](../architecture/identity-and-access.md#authorization),
[Users and roles](../overview/users-and-roles.md)

## <a id="td-3"></a>TD-3 — API route registry

The normative registry **for currently documented milestones** — the seed for the generated
contract, not the finished catalogue of every endpoint the product will ever have. Later
milestones add endpoints through subsequent revisions.

Includes **TD-3.8**, the standard error envelope and canonical code catalogue.

*Code:* `app.ts`, `controllers/` · *Explained:* [API](../architecture/api.md) ·
*Index:* [API endpoints](api-endpoints.md), [Error codes](error-codes.md)

## <a id="td-4"></a>TD-4 — Transaction boundaries

Fifteen sequences that must each execute in **one transaction**. Registration, approval
bundles, soft deletes, quota-gated uploads, refresh rotation, logout, and
suspension-revokes-sessions among them.

**General rule:** wherever a mutation triggers a job, the enqueue is a database insert
**through the same transaction client**. A committed mutation with a lost job, and a job for
an uncommitted mutation, are **both prohibited states.**

*Code:* `services/` · *Explained:*
[Backend](../architecture/backend.md#transactions)

## <a id="td-5"></a>TD-5 — Deletion and cascade rules

Per-entity, mostly prohibitive: branches, rooms, categories, levels, and groups **cannot be
deleted** while dependents reference them.

**Un-enrolment never touches grades, submissions, or progress logs** — academic records
survive intact.

*Explained:* [Database](../architecture/database.md#soft-delete-and-cascade)

## <a id="td-6"></a>TD-6 — Database constraints

Uniqueness, checks, collations, referential integrity — **schema-enforced**, not merely
validated in application code.

*Explained:* [Database](../architecture/database.md#constraints-the-application-layer-cannot-be-trusted-with)

## <a id="td-6a"></a>TD-6a — Prisma migration workflow

**Binding.** Collations, checks, partial and functional indexes, and triggers **cannot be
expressed in Prisma's schema syntax** — an agent writing them there will fail to compile or
silently drop the validation.

Mandatory: `prisma migrate dev --create-only`, then hand-write the SQL. **`prisma db push` is
prohibited in every environment.**

*Enforced:* two CI guards · *Explained:*
[Database](../architecture/database.md#hand-written-sql)

## <a id="td-6b"></a>TD-6b — Migration compatibility policy

**Binding.** Forward-only in production. Data preservation always. Destructive operations
follow **expand–migrate–contract**, with the drop in a **separate, later migration**. **No
direct renames** — Prisma renders them as DROP + ADD.

*Explained:* [Database](../architecture/database.md#compatibility-policy)

## <a id="td-7"></a>TD-7 — Background job catalog

Eight jobs, with triggers, payloads, and idempotency strategy. Exponential backoff, five
attempts, then dead-letter with an Admin-visible failure.

**Quran coverage recalculation is deliberately not a job** — it is synchronous by rule.

*Code:* `jobs/` · *Explained:*
[Background jobs](../architecture/background-jobs.md#the-catalog)

## <a id="td-8"></a>TD-8 — Audit log coverage grid

Every listed action writes an audit row. **This list is the minimum; adding coverage is
allowed, removing it is not.**

Includes **reads** where reads are sensitive — viewing a child's case file is audited.
Retention: 12 months for authentication rows, indefinite for everything else, enforced by a
job selecting on an **enumerated allowlist AND** the age horizon.

*Code:* `repositories/audit.repository.ts` · *Explained:*
[Security](../architecture/security.md#auditing-as-a-security-control)

## <a id="td-9"></a>TD-9 — Validation limits and storage naming

Field limits, upload caps, the MIME allowlist, and the **deterministic immutable key
structure** with its random hash segment.

*Code:* `validators/` · *Explained:* [Storage](../architecture/storage.md#keys)

## <a id="td-10"></a>TD-10 — Pagination, sorting, and search

**Every list endpoint is paginated: default 25, max 100**, in a `{ data, meta }` envelope.
Deterministic tiebreakers. Substring search over **generated normalized shadow columns** —
never per-row normalization at query time. **No fuzzy matching in the MVP.**

**One exemption:** a composite document is not a list endpoint.

*Code:* `lib/pagination.ts`, `lib/search-normalize.ts` · *Explained:*
[API](../architecture/api.md#pagination)

## <a id="td-11"></a>TD-11 — Time, timezone, and date policy

Persisted timestamps are UTC. **Group and event times are local wall-clock values, not UTC
instants** — Morocco suspends DST during Ramadan, and a UTC instant would shift every weekly
schedule twice a year.

Week starts Monday. Hijri display is decorative and reproduces recorded official data —
**never an algorithm, never an offset.**

*Explained:* [Calendar and Hijri](../architecture/calendar-and-hijri.md#wall-clock-time-and-the-ramadan-trap)

## <a id="td-11a"></a>TD-11a — Non-functional targets

Measurable: API reads p95 < 300 ms · Quran writes **including synchronous recalculation**
p95 < 100 ms · presigned mint p95 < 150 ms · RPO ≤ 24 h / RTO < 1 h · 99 % monthly.

*Explained:* [Performance and scale](../architecture/performance-and-scale.md#measurable-targets)

## <a id="td-12"></a>TD-12 — Auth session, child context, presigned URLs

Token lifetimes and transport, rotation mechanics with the idempotent grace window, the CSRF
posture, **high-risk endpoint freshness**, JWT claims, OAuth flow state, the onboarding
token, email normalization, presigned TTLs, and the **authentication failure semantics by
mount**.

*Code:* `middleware/authenticate.ts`, `lib/access-token.ts`, `services/refresh-token.service.ts`
*Explained:* [Identity and access](../architecture/identity-and-access.md)

## <a id="td-13"></a>TD-13 — Configuration and environment catalog

**The single authoritative variable list**; `.env.example` is generated from it and must stay
in lockstep. Plus rate limits, connection-pool budget, and container memory pins.

**Secrets have no defaults by design.**

*Code:* `lib/config.ts` · *Explained:*
[Configuration](../operations/configuration.md)

## <a id="td-14"></a>TD-14 — Observability and health minimums

Health endpoint with per-component detail; structured JSON logs with a propagated request id;
**no PII in logs**; job failures surfaced to Admins.

*Code:* `controllers/health.controller.ts`, `middleware/request-context.ts` ·
*Explained:* [Observability](../operations/observability.md)

## <a id="td-15"></a>TD-15 — Concurrency policy

Read-committed everywhere. Correctness from three mechanisms: **optimistic locking** on
staff-edited entities, **`SELECT … FOR UPDATE`** on check-then-write invariants, and
**first-wins** on state transitions and unique races.

**Never escalate isolation to paper over a missing lock. Never surface a concurrency conflict
as a 500.**

*Code:* `repositories/optimistic-lock.ts` · *Explained:*
[Backend](../architecture/backend.md#concurrency)

## <a id="td-16"></a>TD-16 — Degraded operation

Per-dependency blast radius and required behaviour. **The system never fabricates success.**

*Explained:* [Resilience](../operations/resilience.md#degraded-operation)

---

## Quick index

| | Covers | Explained in |
|---|---|---|
| [TD-1](#td-1) | State machines | [Backend](../architecture/backend.md) |
| [TD-2](#td-2) | Permission matrix | [Identity and access](../architecture/identity-and-access.md) |
| [TD-3](#td-3) | Route registry, error envelope | [API](../architecture/api.md) |
| [TD-4](#td-4) | Transaction boundaries | [Backend](../architecture/backend.md#transactions) |
| [TD-5](#td-5) | Deletion and cascade | [Database](../architecture/database.md) |
| [TD-6](#td-6) | Database constraints | [Database](../architecture/database.md) |
| [TD-6a](#td-6a) | Migration workflow | [Database](../architecture/database.md#hand-written-sql) |
| [TD-6b](#td-6b) | Migration compatibility | [Database](../architecture/database.md#compatibility-policy) |
| [TD-7](#td-7) | Job catalog | [Background jobs](../architecture/background-jobs.md) |
| [TD-8](#td-8) | Audit coverage | [Security](../architecture/security.md) |
| [TD-9](#td-9) | Validation, storage naming | [Storage](../architecture/storage.md) |
| [TD-10](#td-10) | Pagination, sorting, search | [API](../architecture/api.md#pagination) |
| [TD-11](#td-11) | Time and dates | [Calendar](../architecture/calendar-and-hijri.md) |
| [TD-11a](#td-11a) | Performance targets | [Performance](../architecture/performance-and-scale.md) |
| [TD-12](#td-12) | Sessions, child context, URLs | [Identity and access](../architecture/identity-and-access.md) |
| [TD-13](#td-13) | Configuration catalog | [Configuration](../operations/configuration.md) |
| [TD-14](#td-14) | Observability | [Observability](../operations/observability.md) |
| [TD-15](#td-15) | Concurrency | [Backend](../architecture/backend.md#concurrency) |
| [TD-16](#td-16) | Degraded operation | [Resilience](../operations/resilience.md) |

---

**Related:** [Business rules](business-rules.md), [Architecture](../architecture/README.md)
