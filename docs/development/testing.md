[Documentation](../README.md) › [Development](README.md) › **Testing**

# Testing

Four layers, each testing something the others structurally cannot.

| Layer | Scope | Tooling | Gate |
|---|---|---|---|
| **Unit** | Services: interval merge, state machines, consent evaluation, time and DST logic, Arabic normalization | Vitest | Per PR |
| **Integration** | Repositories against **real PostgreSQL**: constraints actually reject bad writes, partial indexes, native collation ordering, soft-delete filtering | Vitest + a real stack | Per PR |
| **API** | Every endpoint against the contract; **permission-matrix tests generated from the matrix**; child-context tests; envelope conformance | Supertest | Per PR |
| **E2E** | Every journey, RTL rendering, mandatory UI states, upload retry | Playwright | Pre-merge to `main` |

**Coverage: ≥ 80 % on services and policies.** No coverage gate on generated or boilerplate
code — a coverage number that counts generated clients measures nothing.

Current totals: **102 backend unit · 487 integration · 72 frontend**.

## Running them

```bash
# Unit — no stack required
cd backend && npm test
cd frontend && npm test

# Integration — needs the stack up
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
bash scripts/dev/test-integration.sh
```

Integration tests run **serially**, because the suites share one database.

## Why integration tests use a real database

Not mocks. The properties being checked **do not exist in a mock**:

- Does a partial unique index actually reject the second row?
- Does `ar-x-icu` collation actually order Arabic correctly?
- Does the transaction actually roll back?
- Does a presigned signature actually survive the proxy?

A mock returns whatever you told it to. The whole point of these tests is to find out what
PostgreSQL, MinIO, and Nginx *really* do.

**Some of the contract lives in headers.** The shared HTTP helper therefore returns
`res.headers` alongside status and body — the calendar bootstrap's `Cache-Control` and `ETag`
are a stated part of that endpoint's behaviour, and a body-only assertion cannot see whether
the policy actually shipped.

## Test the property, not the path

The most important habit on this project.

> ❌ *"The service calls `checkPermission` before returning."*
>
> ✅ *"A teacher requesting another teacher's student receives `404`."*

The first passes when someone refactors the check into something broken. The second fails.

Applied consistently, this is why the suite catches things review does not:

- The mid-transaction **process kill** test — nothing partial persists
- A **suspended teacher denied a presigned mint** within the unexpired-token window
- A **deliberately stalled cache row** repaired by the read-side guard
- **Two concurrent enrolments at capacity − 1** admitting exactly one

## The named regression tests

These are the traps the specification exists to prevent. Each has a dedicated test:

- Ramadan **DST wall-clock stability**
- Consent revocation **rippling through to bucket migration**
- Teacher **global-scope rejection**
- **Re-upload cache-key immutability**
- Pending-session **data-access denial across all endpoints**, plus the client route guard
- **Child-context verification on every student-context endpoint**, including the
  Student-role bypass and the foreign-parent `404`
- **Quran log deletion synchronously un-completing a level**
- **Onboarding-token replay → 409**
- **Presigned PUT/GET round trip through the storage proxy**
- **Case-variant Google email resolving to one identity**
- **Stale-version edit → `VERSION_CONFLICT`** (two admins, one group)
- **Concurrent roster adds at capacity − 1 admit exactly one**
- **Double approval: first wins, second `409`**
- **MinIO down: content 503s while scheduling and grading stay functional**
- **Workers down: enqueues succeed and jobs drain on restart**
- **Body-email substitution against a valid onboarding token is ignored**
- **Suspended teacher denied a presigned mint** within the token window
- **Self-healing cache repairs a deliberately stale row**
- **First draft save initializes absent-zero rows for the full roster**
- **Concurrent teacher score vs admin override → `VERSION_CONFLICT`**
- **The 31st upload in an hour → `429`**, and two concurrent initiations at the boundary
  admit exactly one
- **Replayed refresh token outside the grace window revokes the whole session**
- **Suspension revokes refresh tokens inside its own transaction**
- **Two-tab concurrent refresh rotates exactly once and logs nobody out**

## The token lifecycle is specified as tests

The refresh chain is *the only part of the system where a single missing check silently
extends a 30-day credential*, so it is specified as twelve pass/fail criteria rather than
prose:

| # | Criterion | Expected |
|---|---|---|
| T1 | Refresh with the current live token | New access **and** refresh token; predecessor revoked; one transaction; audit written |
| T2 | Tokens are never stored raw | Only the hash persists — **a database dump yields no usable credential** |
| T3 | Immediate predecessor **within** 10 s | Accepted; **no third token minted** — the chain does not fork |
| T4 | Immediate predecessor **after** 10 s | Refused as reuse |
| T5 | Anything older, or already revoked | **Whole session revoked**; two audit rows |
| T6 | Logout | Revokes **only** the current session; another device keeps working |
| T7 | Revoke-all | Every live token revoked; **no user-facing route exists** |
| T8 | Suspension | All tokens revoked **in the suspension transaction** — verified by refreshing immediately after |
| T9 | Soft delete | As T8, with a different reason |
| T10 | Past expiry | Refused; a purged token refused identically — **fail-closed** |
| T11 | Revoked token, any age | Never accepted, never resurrected |
| T12 | Concurrent refresh, two tabs | **Exactly one** rotation; the loser absorbed by grace, not logged out |

## Mutation testing

Used as standard practice, and it has repeatedly caught defects that inspection missed.

**But: a surviving mutant is worth distrusting until the mutation is proven to have
shipped.** Three separate false negatives here traced to harness problems, not to genuinely
robust code:

| Cause | Symptom |
|---|---|
| The mutation broke the build, so the container kept the **old image** | Every mutant "survived" |
| The shell did not word-split an unquoted variable, so the runner received **one giant filename** and ran **zero tests** | Every mutant "survived" |
| The runner uses a **different failure format** for single-file runs | Failures parsed as passes |

**Verify the mutation actually shipped before drawing a conclusion from it.**

## Testing the guards

Every CI guard was proven by **reintroducing the bug it exists to catch** and confirming the
build went red.

The display-identity guard was proven by planting an inline fallback in the calendar
service — rejected with file and line, passing again once reverted. The header-navigation
guard was proven by re-declaring the burger after its media query.

A guard that has never failed is a guard nobody has tested.

## What is not tested, and why

- **No load-testing infrastructure runs continuously.** Latency targets are verified against
  ceiling-scale fixtures before launch. There is no metrics stack to regress against.
- **Browser matrix testing is E2E-only**, at the audio-playback level where containers
  genuinely differ per browser.
- **The staging origin never exercises authenticated flows** — it is cross-origin by design,
  so those run against the local same-origin stack and the production rehearsal.

## Acceptance checklists

A module is Done only when its checklist is fully ticked, its test gates pass, and its
journeys run green. **Definition of done is per module, not per week.**

The checklists are in SRS §18 — Authentication & Onboarding, Registration/Approvals/Family,
Scheduling & Calendar, Quran Progress, Exams & Grading, Content/Consent/Storage,
Data/Admin/Audit, and Platform & Deployment.

---

**Next:** [CI/CD](ci-cd.md) · **Related:**
[User journeys](../overview/user-journeys.md), [Conventions](conventions.md)
