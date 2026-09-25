[Documentation](../README.md) › [Architecture](README.md) › **API**

# API

REST under `/api/v1`, same origin as the client; 175 operations across 133 paths ([inventory](../reference/api-endpoints.md)).

## The contract is generated, and it is governed

- [`docs/openapi.json`](../openapi.json) is an artifact of the implementation, never hand-edited.
- CI: (1) regenerates and diffs against the committed copy; (2) walks the live Express router, failing on documented-but-unserved or served-but-undocumented operations (a documented route was once never mounted); (3) conformance against the SRS endpoint registry.
- Documented-but-unimplemented endpoints report `PENDING` (non-fatal until the final release checklist).
- Spec-first (R21): the SRS registry is the normative seed for documented milestones; later milestones add endpoints through specification revisions.

## Conventions

| | |
|---|---|
| Prefix | `/api/v1`, same origin (cookie delivery) |
| Naming | plural nouns, kebab-case paths, `snake_case` JSON |
| Auth | `Authorization: Bearer <access token>`; never a cookie except the one refresh route |
| Child context | `X-Active-Child-ID` header |
| Errors | one envelope ([below](#the-error-envelope)) |
| Lists | always paginated ([below](#pagination)) |
| Caching | off by default; one opt-in ([below](#caching)) |
| Bodies | explicit contract DTO, never an ORM entity |
| Internal | `GET /internal/storage/public-authorize`: Nginx-only `internal` auth-subrequest for canonical public objects (§3.1, BR-2, TD-4.9); `x-internal`, origin-root server override, still in router parity and the registry; no human credential, no domain data, TD-3.8 envelope |

## The contract is an interface, not a serialisation

- SRS §16.2 (R38): no endpoint exposes ORM entities; every response is built field by field in [`controllers/dto.ts`](../../backend/src/controllers/dto.ts) as an allow-list projection.
- A new column never reaches a response until added to a DTO (R35 for the public branch directory, R38 for every endpoint); `snake_case` everywhere; a TD-11 calendar date serialises as `YYYY-MM-DD`, never an instant.
- Guards: `scripts/ci/check-contract-dto.sh` fails a controller handing a service result straight to `res.json`; HTTP suites assert the exact key set of each response.
- R117: `GET /admin/approvals` exposes complete applicant/contact/consent data only in its Admin/Super-Admin DTO, one exact block per child; `review_user_id` is a lookup coordinate, not authorization; live-role freshness gates the route; a stale coordinate returns an empty page.

## The error envelope

Every non-2xx response: `{ "error": { "code", "message_key", "message", "details", "request_id" } }`.

| Status | Means |
|---|---|
| `400` | validation failure, incl. a missing child header from a parent-only caller |
| `401` | unauthenticated |
| `403` | permission violation, consent gate, global-scope violation |
| `404` | not found or out of scope, never distinguished |
| `409` | state or constraint conflict |
| `413` | payload too large |
| `429` | rate limited |
| `503` | required external dependency down |
| `500` | anything else; no stack traces, SQL or internal paths |

`code` is a closed catalogue extensible only by specification revision; text resolves through `message_key`, Arabic primary ([error codes](../reference/error-codes.md)).

### The `404`-for-out-of-scope rule

`403` would confirm the thing exists (a minor's record, an unapproved family link, another branch's data). §20 rule 17 · [Security](security.md#no-existence-leaks).

## Pagination

- Every list: `?page=1&page_size=25`, default 25, maximum 100; response `{ "data": [...], "meta": { "page", "page_size", "total" } }`.
- Every sort carries the `id` tiebreaker; structural entities sort `display_order ASC NULLS LAST`, then `name` (natively collated).
- One exemption: the composite `GET /calendar/bootstrap` (three categories, ~21 levels, ≤10 branches, ≤366 days) is not a list; any unbounded collection is paginated.
- `backend/src/lib/pagination.ts` · [Backend](backend.md#pagination-lives-in-one-module).

## Sorting is a contract, never a column name

- `?sort_by=<field>&sort_dir=asc|desc`; absent, the collection keeps BR-19's order.
- Each endpoint declares its own allow-list from public name to ordering expression; an unknown name is `400 VALIDATION_FAILED`; `sort_dir` without `sort_by` is refused; no path from query string to column exists.
- Per-endpoint, not shared (`sort_by=category` sorts Levels, refused on Categories); the database sorts, never the client.
- SRS R76.1–R76.3 · `backend/src/lib/sorting.ts`.

## Manual ordering takes the sequence, not per-row numbers

- `PATCH /admin/{resource}/order` with `{ "ids": [...] }`; the server writes `display_order` from position, so duplicates and gaps are impossible.
- The sequence must be the exact live set in scope; otherwise refused naming `DUPLICATE_ID`, `UNKNOWN_ID` or `INCOMPLETE_ORDER`; a foreign id answers like a nonexistent one (§20 rule 17).
- One transaction, idempotent; concurrent reorders resolve last-writer-wins on the whole sequence; TD-15's per-row `version` is deliberately not used.
- Parent-scoped resources carry `within`, required, not inferred; `TeachingGroup` joined in R78.1 (R76.7 had excluded it for lack of evidence) with an object `within` (§4.4c).

| Resource | Body |
|---|---|
| `PATCH /admin/branches/order` | `{ ids }` |
| `PATCH /admin/categories/order` | `{ ids }` |
| `PATCH /admin/subjects/order` | `{ ids }` |
| `PATCH /admin/levels/order` | `{ within: categoryId, ids }` |
| `PATCH /admin/administrative-groups/order` | `{ within: levelId, ids }` |
| `PATCH /admin/teaching-groups/order` | `{ within: { level_id, subject_id }, ids }` |

- Authority is inherited from the resource's write authority; TD-2 gains no row.
- Each `order` route is declared before its `/:id` sibling (Express declaration order).
- SRS R76.4–R76.7 · `backend/src/lib/reorder.ts`.

## Authentication semantics, decided once

| Mount | Missing credential | Invalid / expired | Valid, non-active account |
|---|---|---|---|
| `authenticate()` (protected) | `401` | `401` | `403` |
| `optionalAuthenticate()` (public) | anonymous | anonymous, never an error | passed through with status |

- A public endpoint never returns `401` and its contract documents none (R34: a stale token must not login-wall the landing calendar); session state comes from the refresh endpoint and `GET /me`, never a public read.

## Caching

| Endpoint | Policy |
|---|---|
| `GET /calendar/bootstrap` | `Cache-Control: public, max-age=300` + strong `ETag` (reference data) |
| `GET /calendar` | uncached (an event edit must be visible immediately) |

## Designing an endpoint: the bootstrap as a worked example

- Four reference reads (Hijri mapping, month metadata, category, level, branch lists) were rejected for one composite document: fewer round trips on mobile, one cache policy, a nameable concept.
- Screen-shaped coupling is accepted because the registry is already screen-oriented and the endpoint is bounded: calendar-chrome reference data only, never events, enrolments, progress or grades.
- Occurrences are self-sufficient (description, recurrence, branch/room names, category, level, instructors): opening one costs no request.
- `?category_id=` narrows only the Level list, server-side (§4.4); an unknown id returns an empty list, never all levels.

## Public endpoints

| Route | Exposes | Decision |
|---|---|---|
| `GET /calendar` | public-tier occurrences | tier decides, all three kinds since R109 ([tiers](calendar-and-hijri.md#three-visibility-tiers--on-all-three-kinds-r109)) |
| `GET /calendar/bootstrap` | calendar chrome reference data | bounded as above |
| `GET /branches` | name, address, phone, email, opening hours, map link | R35 |

- `GET /branches` is a dedicated allowlist route (never `version`, `operational_start_date`, timestamps or deletion columns), not the admin route relaxed.
- A CI sweep derived from the generated contract asserts each route's public/authenticated classification.

## Background jobs over HTTP

An enqueuing endpoint returns `202 Accepted` with a job id; `GET /jobs/{id}` reports `created | active | completed | failed` with progress or error.

---

**Next:** [Identity and access](identity-and-access.md) · **Related:** [API endpoints](../reference/api-endpoints.md), [Error codes](../reference/error-codes.md), [CI/CD](../development/ci-cd.md)
