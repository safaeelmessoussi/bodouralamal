[Documentation](../README.md) › **Architecture**

# Architecture

The technical core of the handbook, written for an engineer who has never seen this
repository and may one day have to rebuild it.

Each page explains **why** as well as **what** — the alternatives that were rejected, the
constraints that forced a choice, and the failure the design is guarding against. Where a
rule is normative it is cited rather than restated
([why](../README.md#the-two-kinds-of-document-in-this-repository)).

## The one-hour tour

Read these four in order and you will understand the system:

1. **[System overview](system-overview.md)** — the whole thing on one page: containers, the
   request path, and why it is deliberately one box.
2. **[Identity and access](identity-and-access.md)** — OAuth, sessions, branch scoping,
   child context. The part with the most consequence if you get it wrong.
3. **[Backend](backend.md)** — how the server is layered and where each kind of logic must
   live.
4. **[Database](database.md)** — the schema, the constraints that carry the invariants, and
   the migration discipline.

## All pages

### The shape of the system
| | |
|---|---|
| [System overview](system-overview.md) | Containers, request path, single-tenant posture, module map |
| [Backend](backend.md) | Controller → service → repository layering, transactions, errors |
| [Frontend](frontend.md) | React structure, routing, adapters, state, accessibility |
| [API](api.md) | Contract governance, conventions, envelope, pagination, caching |
| [Database](database.md) | Schema, constraints, collation, migrations, concurrency |

### Cross-cutting concerns
| | |
|---|---|
| [Identity and access](identity-and-access.md) | Authentication, sessions, authorization, child context |
| [Security](security.md) | The posture as a whole — CSRF, CSP, existence leaks, PII, residency |
| [Performance and scale](performance-and-scale.md) | Targets, the envelope, caching, what not to build |
| [Internationalization](internationalization.md) | Arabic-only launch, RTL, native collation, i18n keys |

### Subsystems
| | |
|---|---|
| [Storage](storage.md) | Dual-bucket MinIO, presigned URLs, immutable keys, consent gating |
| [Background jobs](background-jobs.md) | pg-boss, the catalog, transactional enqueue |
| [Calendar and Hijri](calendar-and-hijri.md) | Scheduling, recurrence, wall-clock time, official Hijri data |
| [Design system](design-system.md) | Tokens, the cascade, components |

## Principles you will see repeatedly

These are not aspirations. Each one is enforced somewhere — by a constraint, a test, or a
CI guard — and each was added after something went wrong.

**One statement, many references.** A requirement stated twice drifts. Every duplicated
rule in this project's history has diverged, and the copy that drifted still passed its own
tests. The fix is always a cross-reference, never a sync.

**Structural over procedural.** Where a rule can be made impossible to break, it is. The
frontend type for a calendar occurrence does not carry the raw name fields at all, so a
client *cannot* implement the display-name fallback it is forbidden from implementing.

**Verified, not asserted.** A guard is proven by reintroducing the bug it exists to catch.
A mutation that survives testing is distrusted until the mutation is proven to have shipped.

**Silence over guessing.** An unrecorded Hijri month renders nothing. An out-of-scope
record returns `404`. The system never fabricates an answer it does not have.

**The transaction is the unit of correctness.** Where two facts must be true together, they
commit together — including the enqueue of the job that acts on them.

**Say what was rejected.** A design note that records the alternative and why it lost is
what stops the next person re-deciding it under deadline, without the context.

---

**Related:** [Business processes](../overview/business-processes.md),
[Conventions](../development/conventions.md),
[Technical design](../reference/technical-design.md)
