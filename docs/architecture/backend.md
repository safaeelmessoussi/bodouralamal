[Documentation](../README.md) › [Architecture](README.md) › **Backend**

# Backend

Node.js, Express 5, Prisma, TypeScript strict. The whole design is one idea applied
consistently: **each layer has exactly one job, and the boundaries are enforced.**

## Layering

```
HTTP request
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ middleware/    request id · authentication · child context   │
│                error envelope                                │
├─────────────────────────────────────────────────────────────┤
│ controllers/   HTTP only. Parse, validate (Zod), call ONE    │
│                service method, shape the response.           │
│                No business logic. Ever.                      │
├─────────────────────────────────────────────────────────────┤
│ services/      Business logic. Transaction boundaries.       │
│                State machines. Permission enforcement.       │
│                Audit writes. Never touches Prisma directly.  │
├─────────────────────────────────────────────────────────────┤
│ policies/      Permission and scope predicates, reusable     │
│                across services.                              │
├─────────────────────────────────────────────────────────────┤
│ repositories/  The SOLE data-access layer. Uniform           │
│                soft-delete filtering. The only place raw     │
│                SQL may appear in application code.           │
└─────────────────────────────────────────────────────────────┘
   │
   ▼
PostgreSQL
```

### Why this is enforced rather than encouraged

Each boundary prevents a specific failure that has a history in this kind of codebase:

- **Business logic in a controller** becomes unreachable from a job handler or a second
  endpoint, so it gets copied — and the copy drifts.
- **Prisma in a service** means soft-delete filtering is applied by memory rather than by
  construction, and the first query someone forgets it on silently returns deleted rows.
- **A transaction opened outside a service** cannot enforce a state machine, because the
  code that validates the transition is not the code that writes it.

> Binding rules: SRS §16.2 · [Conventions](../development/conventions.md#layering)

## Module map

| Directory | Holds | Notable contents |
|---|---|---|
| `controllers/` | One module per resource | `calendar`, `calendar-bootstrap`, `event`, `group`, `branch`, `public-branch`, `hijri-calendar`, `user`, `approval`, `family-link`, `consent`, `social-profile`, `registration`, `auth`, `health` |
| `services/` | Business logic per resource | Plus `refresh-token`, `roster`, `public-branch`, `calendar-bootstrap` |
| `repositories/` | Data access | `user`, `audit`, `refresh-token`, `trash`, `jobs`, and `optimistic-lock` |
| `policies/` | Permission predicates | `branch-scope`, `teacher-scope`, `freshness.policy` |
| `validators/` | Zod schemas | `branch`, `registration` |
| `middleware/` | Cross-cutting HTTP | `authenticate`, `child-context`, `request-context` |
| `jobs/` | pg-boss handlers | `runner` |
| `lib/` | Shared primitives | `access-token`, `onboarding-token`, `oauth`, `cookies`, `config`, `errors`, `hijri`, `pagination`, `search-normalize`, `storage`, `display-name`, `prisma` |

Tests live **beside** the code they test — `*.test.ts` for unit,
`*.integration.test.ts` for tests requiring a real database, and
`*.http.integration.test.ts` for tests driving the HTTP surface.

## Transactions

Some sequences must be all-or-nothing. The specification enumerates them (TD-4); the
service layer implements them verbatim. The most consequential:

| # | Sequence | Why atomic |
|---|---|---|
| 1 | **Registration** — parent + child + link + consents + identity + token record | A parent without their child, or a consumed token without a registration, are both broken states |
| 2 | **Approval bundle** — parent + child + link + audit | Partial activation grants access nobody approved |
| 8 | **Soft delete** — `deleted_at/by` + Trash snapshot + audit | A deletion without a snapshot is unrecoverable |
| 12 | **Quota-gated upload** — lock counter → check → increment → create | Checking outside the transaction lets two concurrent calls both pass at the limit |
| 13 | **Refresh rotation** — revoke presented + insert successor + audit | A lost successor logs the user out; an unrevoked predecessor leaves two live tokens and **defeats reuse detection** |
| 15 | **Suspension** — status change + revoke every live token + audit | A suspension that commits without revoking leaves a 30-day credential alive |

### The general rule about jobs

> Wherever a mutation triggers a background job, the enqueue is **a database insert through
> the same transaction client**. A committed mutation with a lost job, and a job for an
> uncommitted mutation, are both prohibited states.

This is why `boss.send()` is banned for job-triggering mutations: it uses its own connection
and sits **outside** the transaction. Jobs are inserted through a dedicated
`JobsRepository`, which is one of only two places raw SQL is permitted in application code.

> [Background jobs](background-jobs.md#transactional-enqueue)

## Concurrency

Read-committed isolation everywhere. Correctness comes from three named mechanisms, never
from escalating the isolation level — the retry machinery that global `SERIALIZABLE` would
demand is not justified at this scale.

### 1. Optimistic locking on staff-edited entities

`Group`, `Level`, `Category`, `Subject`, `Branch`, `Room`, `Event`, draft `Exam`, content
metadata, `SystemSetting`, `HijriMonthStart`, `Grade`, and `User` each carry an integer
`version`. Every edit form loads it and sends it back; the update is conditional:

```sql
UPDATE … SET …, version = version + 1 WHERE id = ? AND version = ?
```

Zero rows updated → **`409 VERSION_CONFLICT`**. The client says "this record was changed by
someone else", reloads, and the user re-applies. **Silent last-write-wins is prohibited.**

A shared `updateWithVersion` helper implements this once for any delegate, and it
distinguishes a version conflict from a genuinely missing row — an important difference,
since conflating them would report "someone else edited this" for a record that was deleted.

> The list of version-carrying entities lives in **exactly one place** (TD-15.1). §7 used to
> restate it and the copy had already drifted, omitting `HijriMonthStart`. It now
> cross-references instead — a small change that is the general lesson of this project.

### 2. Pessimistic row locks where an invariant is checked then written

`SELECT … FOR UPDATE` on the governing rows **before** the check:

- Roster mutation locks the group row before comparing against capacity.
- Quota enforcement locks the rate-limit counter row before comparing against the limit.
- Display-order reordering runs as one transaction locking the parent scope.

Lock ordering is consistent (parent before children) to prevent deadlocks; scope is rows,
never tables.

### 3. First-wins on state transitions and unique races

Two admins approving the same registration, a double publish, a duplicate family link: the
first transaction commits, the second finds the state already advanced and receives
`409 STATE_CONFLICT` or `409 DUPLICATE`. The UI treats these as "already handled,
refreshing".

**Concurrency conflicts are never surfaced as 500s.** They are expected, coded outcomes.

> **A status check is not a lock.** The approval queue implemented first-wins by reading the
> row `WHERE account_status = 'pending'` and then updating it. Under `READ COMMITTED` that does
> not hold: two transactions both read `pending` — neither sees the other's uncommitted write —
> so both proceeded and **both succeeded**, writing two `user.approve` audit rows for one
> decision. The test caught it roughly **one run in five** and had been passing on timing luck
> since the queue was written; an unrelated fixture change in Revision 39 shifted the timing
> enough to surface it.
>
> The fix is the `SELECT … FOR UPDATE` the other services already use: the second caller blocks,
> then re-reads the **committed** status and takes the `STATE_CONFLICT` path that was always
> intended. Verified by running the concurrency test **10/10**, where it had been ~4/5.
>
> The general rule: **first-wins needs a lock or a conditional update, never a read followed by
> a write.** If a guard's correctness depends on which transaction happens to read first, it is
> not a guard.

## Error handling

> **An error the client cannot act on is a bug, even when the status is right.**
>
> `POST /registrations` returned `503 SERVICE_UNAVAILABLE` with an empty
> `details` when `legal.consent_text_version` was unset. The status was correct —
> §4.1a forbids writing a consent record whose text version is unknown, so
> failing closed is the right behaviour. But an empty `details` made a permanent
> configuration gap indistinguishable from a transient outage, so the form
> rendered *"try again later"*: advice that could never work, because no amount
> of waiting writes a missing `SystemSetting` row. It cost a P0 investigation.
>
> TD-3.8 defines `details` as *"structured context for codes that carry it"*, and
> this is exactly such a code. It now reports
> `{ reason: 'CONSENT_TEXT_VERSION_NOT_CONFIGURED', setting: 'legal.consent_text_version' }`.
> A setting **key** is not a secret — it is already named in the SRS — and naming
> it is the difference between an actionable message and a mystery.
>
> The rule: **when a failure has one known cause, say which.** Reserve the
> generic message for causes that are genuinely unknown.


Errors are thrown as **typed domain errors** and mapped centrally to the single response
envelope. There is no scattering of `res.status(...)` through controllers.

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message_key": "errors.concurrency.version",
    "message": "…localized fallback…",
    "details": { },
    "request_id": "…"
  }
}
```

The `code` is drawn from a **closed catalogue** extensible only by specification revision.
`request_id` is the same value that appears in the structured logs, so a user-reported
error is traceable end to end.

**Never leaked in any response:** stack traces, SQL, internal paths.

> [Error codes](../reference/error-codes.md) · [API](api.md#the-error-envelope)

## Two patterns worth copying

### Pagination lives in one module

`lib/pagination.ts` is the single implementation of the pagination rule: default 25,
maximum 100, `{ data, meta }` envelope.

It exists because the rule had **two byte-identical copies** in services while **five other
list endpoints implemented none of it** — both halves of the same hazard. A normative
constant with more than one home drifts, and the surface that drifts still passes its own
tests.

It also clamps rather than rejects. A caller asking for 5,000 rows is asking for something
the contract does not offer, but refusing would turn a cosmetic client bug into an outage;
capping serves the first 100 and reports the real `page_size` back.

One subtlety, recorded because it was a real bug: **absent and nonsensical are different**.
`Math.trunc(x) || DEFAULT` silently turned `page_size=0` into 25 while the `Math.max(…, 1)`
beside it claimed to floor at 1. Two mechanisms disagreeing about one value *is* the bug.

### Display-name resolution is a function, not an inline fallback

```ts
export function publicDisplayName(person: {
  publicDisplayName: string | null;
  nameArabic: string;
}): string {
  const chosen = person.publicDisplayName?.trim();
  return chosen ? chosen : person.nameArabic;
}
```

Trivial — and deliberately a named function in one module rather than a `??` at each call
site, because it implements a **platform-wide binding invariant**: wherever a person's
identity appears on a public surface, the backend decides which name to publish and the
client renders it verbatim.

Getting the branch wrong publishes a legal name where someone asked for a kunya, and the
interface gives the person affected no sign it happened. A CI guard fails the build on any
inline fallback, on the raw fields reaching the frontend, and on a controller exposing both
inputs outside the one admissible staff screen.

> SRS §7 *Public display identity invariant* · §20 rule 21 ·
> `scripts/ci/check-display-identity.sh`

## Raw SQL: exactly two sanctioned uses

Raw SQL belongs in migration files. In application code it is permitted **inside
repositories only**, for exactly two purposes:

1. **`SELECT … FOR UPDATE` row locks** — Prisma has no lock API.
2. **Inserting pg-boss job rows through the transaction client**, via `JobsRepository`.

Anywhere else it is prohibited. A CI guard additionally flags mass-write Prisma calls that
skip soft-delete filtering.

---

**Next:** [Database](database.md) · **Related:** [API](api.md),
[Conventions](../development/conventions.md), [Background jobs](background-jobs.md)
