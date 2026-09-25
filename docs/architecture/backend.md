[Documentation](../README.md) › [Architecture](README.md) › **Backend**

# Backend

Node.js, Express 5, Prisma, TypeScript strict; one job per layer, boundaries enforced.

## Layering

| Layer | Job |
|---|---|
| `middleware/` | request id · authentication · child context · error envelope |
| `controllers/` | HTTP only: parse, validate (Zod), call ONE service method, shape the response; no business logic |
| `services/` | business logic, transaction boundaries, state machines, permission enforcement, audit writes; never touches Prisma directly |
| `policies/` | permission and scope predicates reusable across services |
| `repositories/` | the sole data-access layer; uniform soft-delete filtering; the only place raw SQL may appear |

- Enforced because controller logic gets copied, Prisma in a service forgets soft-delete filtering, and a transaction outside a service cannot enforce a state machine. Binding: SRS §16.2 · [Conventions](../development/conventions.md#layering).

## Module map

| Directory | Notable contents |
|---|---|
| `controllers/` | `calendar`, `calendar-bootstrap`, `event`, `group`, `branch`, `public-branch`, `hijri-calendar`, `user`, `approval`, `family-link`, `consent`, `registration`, `auth`, `health` |
| `services/` | per resource, plus `refresh-token`, `roster`, `public-branch`, `calendar-bootstrap` |
| `repositories/` | `user`, `audit`, `refresh-token`, `trash`, `jobs`, `optimistic-lock` |
| `policies/` | `branch-scope`, `teacher-scope`, `freshness.policy` |
| `validators/` | Zod: `branch`, `registration` |
| `middleware/` | `authenticate`, `child-context`, `request-context` |
| `jobs/` | `runner` |
| `lib/` | `access-token`, `onboarding-token`, `oauth`, `cookies`, `config`, `errors`, `hijri`, `pagination`, `search-normalize`, `storage`, `display-name`, `prisma` |

Tests sit beside the code: `*.test.ts` (unit), `*.integration.test.ts` (real database), `*.http.integration.test.ts` (HTTP surface).

## Transactions

TD-4 enumerates the atomic sequences; services implement them verbatim:

| # | Sequence | Why atomic |
|---|---|---|
| 1 | registration: parent + child + link + consents + identity + token record | a parent without child or a consumed token without registration |
| 2 | approval bundle: parent + child + link + audit | partial activation grants unapproved access |
| 8 | soft delete: `deleted_at/by` + Trash snapshot + audit | a deletion without snapshot is unrecoverable |
| 12 | quota-gated upload: lock counter → check → increment → create | two concurrent calls both pass at the limit |
| 13 | refresh rotation: revoke presented + insert successor + audit | a lost successor logs out; an unrevoked predecessor defeats reuse detection |
| 15 | suspension: status change + revoke every live token + audit | otherwise a 30-day credential stays alive |

- A job-triggering mutation enqueues through the same transaction client via `JobsRepository`; `boss.send()` is banned there ([background jobs](background-jobs.md#transactional-enqueue)).

## Concurrency

Read-committed everywhere; three mechanisms, never a higher isolation level.

1. Optimistic locking: `Group`, `Level`, `Category`, `Subject`, `Branch`, `Room`, `Event`, draft `Exam`, content metadata, `SystemSetting`, `HijriMonthStart`, `Grade`, `User` carry an integer `version`; `UPDATE … SET …, version = version + 1 WHERE id = ? AND version = ?`; zero rows → `409 VERSION_CONFLICT`; silent last-write-wins is prohibited. `updateWithVersion` implements it once and distinguishes a conflict from a missing row; the entity list lives only in TD-15.1.
2. Pessimistic `SELECT … FOR UPDATE` on the governing row before a check-then-write: roster mutation locks the group before capacity; quota enforcement locks the counter row; reordering locks the parent scope; email ownership locks one `NormalizedEmailLock` row (inserted with conflict absorption) before re-reading `User.pre_provisioned_email` and active `UserIdentity.email`; authentication takes `FOR NO KEY UPDATE` on User, then `RefreshSession` anchors in UUID order ([details](identity-and-access.md#rotation-three-outcomes)). Lock order: normalized email → User → refresh-session anchors; rows, never tables.
3. First-wins on state transitions and unique races: the second transaction receives `409 STATE_CONFLICT` or `409 DUPLICATE` (UI: «already handled, refreshing»); never a 500. A status check is not a lock: reading `WHERE account_status = 'pending'` then updating let two approvals both succeed under `READ COMMITTED` (R39); first-wins needs a lock or a conditional update, never a read then a write.

## Error handling

- Typed domain errors mapped centrally to the single envelope ([API](api.md#the-error-envelope), [error codes](../reference/error-codes.md)); no scattered `res.status(...)`; `code` from a closed catalogue; `request_id` matches the structured logs; never stack traces, SQL or internal paths.
- An error the client cannot act on is a bug: `POST /registrations` with no consent text version (§4.1a fails closed) returns `503 SERVICE_UNAVAILABLE` with `details: { reason: 'CONSENT_TEXT_VERSION_NOT_CONFIGURED' }`, not empty `details`; R119 removed the `setting` key (a `LegalConsentText` now; a key must not reach a user-facing message, rule M) and kept the coded `reason`.
- When a failure has one known cause, say which; the actionable part is the remedy («إعدادات المنصة»), not the implementation.

## Two patterns worth copying

### Pagination lives in one module

- `lib/pagination.ts`: default 25, maximum 100, `{ data, meta }`; replaced two identical copies and five endpoints with none.
- Clamps rather than rejects (serves 100, reports the real `page_size`); absent and nonsensical differ: `Math.trunc(x) || DEFAULT` turned `page_size=0` into 25 against a claimed floor of 1.

### Display-name resolution is a function, not an inline fallback

- `publicDisplayName({ publicDisplayName, nameArabic })`: trimmed chosen name, else `nameArabic`; one named function, never a `??` per call site; the backend decides the public name, the client renders verbatim (SRS §7, §20 rule 21).
- `scripts/ci/check-display-identity.sh` fails on any inline fallback, on the raw fields reaching the frontend, and on a controller exposing both inputs outside the one admissible staff screen.

## Raw SQL: exactly two sanctioned uses

Inside repositories only: `SELECT … FOR UPDATE` row locks (Prisma has no lock API) and pg-boss job inserts through the transaction client (`JobsRepository`); a CI guard also flags mass-write Prisma calls that skip soft-delete filtering.

---

**Next:** [Database](database.md) · **Related:** [API](api.md), [Conventions](../development/conventions.md), [Background jobs](background-jobs.md)
