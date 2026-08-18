[Documentation](../README.md) › [Architecture](README.md) › **API**

# API

A REST API under `/api/v1`, **on the same origin as the client**. JSON in, JSON out, bearer
authentication unless a route is explicitly public. Plural nouns, kebab-case paths.

Current surface: **47 operations across 35 paths**. Full inventory:
[API endpoints](../reference/api-endpoints.md).

## The contract is generated, and it is governed

[`docs/openapi.json`](../openapi.json) is an **artifact of the implementation**. It is never
hand-edited — not even to make a check pass.

CI enforces this in **both** directions, which is the part that matters:

1. **Regenerate and diff.** CI regenerates the document from the implementation and fails if
   the committed copy differs. Without this step the gate below would be validating a file a
   human could edit — exactly what the specification forbids. This is what makes the file
   generated *in fact*, not merely by intention.
2. **Walk the live router.** Generation traverses the actual Express router and fails on any
   operation that is documented but not served, or served but not documented.
3. **Conformance against the specification.** A third check compares the result to the
   endpoint registry and fails on an endpoint that contradicts the specification, or is
   implemented without documentation, or appears in the contract undocumented.

**Rule 2 exists because it was needed.** A route was once added to both the registry and the
contract while never being mounted — every gate passed while the endpoint returned `404`.

**Documented-but-unimplemented endpoints report `PENDING`** until their milestone lands.
They are a work-in-progress signal, not invented endpoints, and must not fail the build: a
gate that is red from M1 to M6 is a gate nobody reads. The final release checklist flips
`PENDING` to fatal.

### What "spec-first" means in practice

The registry in the specification is **the normative registry for currently documented
milestones** — a seed, not the finished catalogue of every endpoint the product will ever
have. Later milestones add endpoints through **subsequent specification revisions**, so the
surface still grows spec-first without rewriting the registry before every CRUD screen.

That reading was itself a decision (Revision 21), taken to resolve a contradiction that had
blocked every CRUD screen: one section called the registry canonical and exhaustive, while
the registry's own preamble called itself a seed of representative operations. Under the
strict reading, the branch and room CRUD that three other sections required would have been
*invented* endpoints.

## Conventions

| | |
|---|---|
| **Prefix** | `/api/v1`, same origin as the client — mandatory for cookie delivery |
| **Naming** | Plural nouns, kebab-case paths, `snake_case` JSON fields |
| **Auth** | `Authorization: Bearer <access token>`. **Never a cookie**, except the one refresh route |
| **Child context** | `X-Active-Child-ID` header on child-scoped requests |
| **Errors** | One envelope, always ([below](#the-error-envelope)) |
| **Lists** | Paginated, always ([below](#pagination)) |
| **Caching** | Off by default; one endpoint opts in ([below](#caching)) |
| **Response bodies** | An explicit contract DTO, never an ORM entity ([below](#the-contract-is-an-interface-not-a-serialisation)) |

## The contract is an interface, not a serialisation

SRS §16.2 (Revision 38), binding:

> No endpoint may expose ORM entities directly. Every endpoint must expose an explicit contract
> DTO. The API contract is an intentional interface, never an accidental serialization of
> database models.

Every response is built **field by field** in [`controllers/dto.ts`](../../backend/src/controllers/dto.ts)
— an allow-list projection, never a spread of a row.

Three consequences, all of which the branch endpoint got wrong before Revision 38:

1. **A column added to a model never reaches a response by default.** It reaches one when
   somebody adds it to a DTO, deliberately. Revision 35 established this for the public branch
   directory — *"an endpoint that returns everything except what we remembered to strip is one
   careless `select` away from leaking"* — and Revision 38 generalised it to every endpoint.
   A staff endpoint leaking `deleted_by` is not a privacy breach, but it is still a contract
   nobody designed.
2. **`snake_case`, everywhere.** One wire convention, not one per endpoint.
3. **A TD-11 calendar date serialises as `YYYY-MM-DD`**, never as an instant. An instant invites
   a timezone conversion in a client, which is the exact class of bug TD-11 exists to prevent —
   a branch opening on 1 March reading as 28 February one timezone west.

**Why it needed a rule.** Nothing was *wrong* with the code that returned `res.json(branch)`;
the problem was that nobody had chosen the shape at all, and a client then depended on it. The
drift is silent by nature: a service test asserts the decision and never the wire, so every test
stayed green for months. Two mechanisms close that gap — `scripts/ci/check-contract-dto.sh`
fails a build where a controller hands a service result straight to `res.json`, and the HTTP
suites assert the **exact key set** of each response, so a field arriving that nobody chose is a
test failure rather than a surprise.

## The error envelope

Every non-2xx response, without exception:

```json
{
  "error": {
    "code": "CAPACITY_FULL",
    "message_key": "errors.roster.capacity",
    "message": "…localized fallback…",
    "details": { },
    "request_id": "b3f1…"
  }
}
```

| Status | Means |
|---|---|
| `400` | Validation failure, including a missing child header from a parent-only caller |
| `401` | Unauthenticated |
| `403` | Forbidden — permission violation, consent gate, global-scope violation |
| `404` | Not found **or out of scope — never distinguished** |
| `409` | State or constraint conflict |
| `413` | Payload too large |
| `429` | Rate limited |
| `503` | A required external dependency is down |
| `500` | Anything else — **no stack traces, no SQL, no internal paths, ever** |

The `code` values form a **closed catalogue** extensible only by specification revision, so
clients can switch on them safely. User-facing text resolves through the `message_key`,
Arabic primary.

> [Error codes](../reference/error-codes.md) — the full catalogue with client guidance.

### The `404`-for-out-of-scope rule

This is not tidiness. `403` tells the caller *the thing exists and you may not see it*,
which is precisely the fact that must not leak about a minor's record, an unapproved family
link, or another branch's data.

> [`§20 rule 17`] · [Security](security.md#no-existence-leaks)

## Pagination

Every list endpoint: `?page=1&page_size=25`, **default 25, maximum 100**.

```json
{ "data": [ … ], "meta": { "page": 2, "page_size": 25, "total": 137 } }
```

All sorts carry a deterministic tiebreaker (`id`) so pages stay stable. Structural entities
sort by `display_order ASC NULLS LAST`, then `name` — which is correct Arabic order
automatically, because the column is natively collated.

**Exactly one exemption exists**, and it is narrow by construction: a **composite document**
is not a list endpoint. `GET /calendar/bootstrap` returns one object whose contained lists
are bounded by the domain — three categories, ~21 levels, ≤10 branches, ≤366 days — rather
than by a page size. Paginating any of them would be meaningless, because a caller cannot
use half a filter.

An endpoint returning an unbounded collection is a list and is paginated, whatever its
shape.

> Implementation: `backend/src/lib/pagination.ts` ·
> [Backend](backend.md#pagination-lives-in-one-module)

## Sorting is a contract, never a column name

`?sort_by=<field>&sort_dir=asc|desc`, snake_case like `page_size` beside it. Absent, the
collection keeps BR-19's order exactly — this is a capability, not a new default.

**`sort_by` names a field the endpoint promises**, and every endpoint declares its own
**allow-list** mapping that public name to an ordering expression. A name outside the list is
`400 VALIDATION_FAILED` — never ignored, never passed through. There is therefore no path
from a query string to a column: not a sanitised one, an **absent** one, which is the only
version that stays true under later refactoring. `sort_dir` without `sort_by` is refused too,
because it asks the server to guess.

The allow-list is **per endpoint** rather than shared. A shared table would quietly let every
list accept every other list's fields, which is how an allow-list stops being one — so
`sort_by=category` sorts Levels and is refused on Categories.

**Sorting is the database's**, never the client's: a client sorting a page of a paginated
collection would order that page and misreport it as the collection's order.

> [`SRS R76.1–R76.3`] · Implementation: `backend/src/lib/sorting.ts`

## Manual ordering takes the sequence, not per-row numbers

`PATCH /admin/{resource}/order` with `{ "ids": [...] }` — the order itself. The server writes
`display_order` from each id's **position**, so duplicate and gapped values are *structurally
impossible* rather than validated against, and no client does arithmetic that races another
client doing the same.

The sequence must be **the exact live set** in the caller's scope. A partial one cannot say
where the omitted rows belong — prepend, append, or leave the old numbers to interleave? —
so it is refused, naming which ids were `DUPLICATE_ID`, `UNKNOWN_ID` or `INCOMPLETE_ORDER`,
because *"invalid order"* is not something a caller can act on. A foreign id answers exactly
like a nonexistent one (§20 rule 17).

One transaction, and **idempotent**: the same sequence twice produces the same rows, so a
retry after a dropped response is safe. Two administrators reordering at once resolve
last-writer-wins **on the whole sequence**, which is the honest outcome for an ordering;
TD-15's per-row `version` is deliberately not used, because it answers *"did this row change
under me"* and a reorder is a statement about the collection.

Two of the five resources are **scoped to a parent** — `display_order` on `Level` lives
within its Category and on `AdministrativeGroup` within its Level (§2.2) — so their body
carries `within`, the parent's id. It is required rather than inferred from the ids: the
server must know which collection the sequence claims to be *before* it reads the live set to
compare against.

| Resource | Body |
|---|---|
| `PATCH /admin/branches/order` | `{ ids }` |
| `PATCH /admin/categories/order` | `{ ids }` |
| `PATCH /admin/subjects/order` | `{ ids }` |
| `PATCH /admin/levels/order` | `{ within: categoryId, ids }` |
| `PATCH /admin/administrative-groups/order` | `{ within: levelId, ids }` |
| `PATCH /admin/teaching-groups/order` | `{ within: { level_id, subject_id }, ids }` |

**`TeachingGroup` joined them in R78.1.** R76.7 had excluded it because *no interface had
ever set the column*, so ordering circles was not a decision anybody took — an **evidential**
reason, and the Owner asking for the gesture is the evidence it lacked. It is the only one
whose `within` is an **object**: §4.4c splits a `(Level, Subject)` pairing into circles, and
neither half alone names the collection.

Authority is **inherited** from the resource's existing write authority — whoever may edit a
Branch may reorder Branches — and TD-2 gains no row.

Each `order` route is declared **before** its `/:id` sibling, since Express matches in
declaration order and the literal would otherwise arrive as a malformed id.

> [`SRS R76.4–R76.7`] · Implementation: `backend/src/lib/reorder.ts`

## Authentication semantics, decided once

Two middlewares, one rule each — stated project-wide rather than per endpoint, because
deciding it per endpoint is how the copies diverge.

| Mount | Missing credential | **Invalid / expired credential** | Valid, non-active account |
|---|---|---|---|
| `authenticate()` — protected | `401` | `401` | `403` |
| `optionalAuthenticate()` — public | anonymous | **anonymous — ignored, never an error** | passed through with status |

**A public endpoint must never return `401`, and its contract entry must not document one.**

This was reversed from the original implementation (Revision 34). The public calendar
renders on the landing page. Refusing a request because it happened to carry a stale token
means a returning visitor — whose token expired while the tab sat open — gets an error on a
page with no login requirement at all, and a client treating `401` as *redirect to login*
would **login-wall a public page**.

The former justification, that a silent downgrade hides an expired session, does not
survive scrutiny: the client learns its session state from the refresh endpoint and `GET
/me`, which exist for exactly that purpose, and never from a public read.

## Caching

Almost everything is uncached. One endpoint opts in, and the split is deliberate:

| Endpoint | Policy | Why |
|---|---|---|
| `GET /calendar/bootstrap` | `Cache-Control: public, max-age=300` + strong `ETag` | Reference data. A Super Admin recording a Hijri month is not a change a visitor must see within seconds |
| `GET /calendar` | **Uncached** | An event edit *is* a change a visitor must see immediately |

Reference data and event data have different rates of change, and that difference is the
seam the split follows. Writing one cache policy over one composite document is also
materially safer than keeping four independent policies consistent.

## Designing an endpoint: the bootstrap as a worked example

The calendar screen needs four things beyond its events: the Hijri mapping for every
displayed day, the month metadata for the dual title, and the category, level, and branch
lists for its filters. The obvious shape is four endpoints. **That was rejected**, and the
reasoning generalises.

**Why one composite document:**

- **Round trips are the scarce resource here.** Users are on unreliable mobile connections;
  four sequential reference reads before the grid draws its first cell is four chances to
  stall, on the screen a visitor is most likely to open.
- **One cache policy instead of four.**
- **The grouping is a real concept, not a bundle.** *"What the calendar screen must know
  before it can draw"* is nameable and stable.

**The objection, and the limit that answers it.** A screen-shaped endpoint couples the API
to one UI, normally an anti-pattern. Two things make it correct here: the registry is
*already* screen-oriented throughout, so this is consistent rather than a departure; and the
endpoint is bounded by an explicit rule —

> **The bootstrap carries reference data required to render the calendar chrome, and never
> operational data.** Events, enrolments, progress, and grades are not admissible, whatever
> a future screen would find convenient.

Without that limit a bootstrap becomes a dumping ground, which is the failure mode being
guarded against.

**A second decision in the same design:** occurrences were made **self-sufficient** —
carrying description, recurrence, branch and room names, category, level, and instructors —
so opening an event costs **no further request**. The alternative was an N+1 on a public
screen.

**And a third, added when the screen was built:** the bootstrap takes an optional
`?category_id=` that narrows **only** its Level list. That parameter exists because §4.4
requires the category→level narrowing to happen *server-side*, *"so the client never filters a
list it was handed"* — client-side filtering would have been one line and would have violated
the clause. The narrowing is scoped as tightly as the rule needs: everything else in the
payload is the calendar's chrome regardless of the selection.

An unknown id returns an **empty** list rather than silently widening to all levels, on the
principle that **a filter which quietly stops filtering is worse than one that returns
nothing** — the screen would otherwise show every level while claiming to show one category's.

## Public endpoints

Three routes are anonymous, and each was a deliberate decision about what may be public:

| Route | Exposes | Decision recorded |
|---|---|---|
| `GET /calendar` | Public-tier occurrences | The visibility tier decides what a caller receives |
| `GET /calendar/bootstrap` | Reference data for the calendar chrome | Bounded by the rule above |
| `GET /branches` | Name, address, phone, email, opening hours, map link | Revision 35 |

`GET /branches` illustrates the house style for public surfaces. It is **a dedicated route,
not the admin route with permissions relaxed**, and it returns an **allowlist** — never
`version`, `operational_start_date`, timestamps, or deletion columns.

> An endpoint's audience is part of its contract, and one endpoint serving two audiences has
> to get the difference right on **every future change**. A public endpoint that returns
> "everything except what we remembered to strip" is one careless `select` away from
> leaking.

There is also a self-maintaining CI sweep that derives its route list **from the generated
contract** and asserts each route's public/authenticated classification. It has already
caught three newly added public routes that needed classifying.

## Background jobs over HTTP

Any endpoint that enqueues a job returns `202 Accepted` with a job id. `GET /jobs/{id}`
reports `created | active | completed | failed` with progress or error.

---

**Next:** [Identity and access](identity-and-access.md) · **Related:**
[API endpoints](../reference/api-endpoints.md), [Error codes](../reference/error-codes.md),
[CI/CD](../development/ci-cd.md)
