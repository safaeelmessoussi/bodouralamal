[Documentation](../README.md) › [Development](README.md) › **Conventions**

# Conventions

Binding. Code review holds you to these, and several are enforced by CI.

## Layering

```
controllers/   HTTP only. Validate with Zod, call ONE service method,
               shape the response. No business logic. Ever.
services/      Business logic, transaction boundaries, state machines,
               permission enforcement, audit writes.
               Never touches Prisma directly.
repositories/  The SOLE data-access layer. Uniform soft-delete filtering.
```

Three rules follow, and each prevents a specific failure:

- **No business logic in controllers.** Logic there is unreachable from a job handler or a
  second endpoint, so it gets copied — and the copy drifts.
- **Services never touch Prisma.** Soft-delete filtering would then be applied by memory
  rather than by construction, and the first query someone forgets it on silently returns
  deleted rows.
- **All state transitions and transactions live in services.** A transaction opened elsewhere
  cannot enforce a state machine, because the code validating the transition is not the code
  writing it.

> [Backend](../architecture/backend.md#layering)

## TypeScript

- **Strict mode everywhere.** No `any` in service or repository layers.
- Errors are **typed domain errors**, mapped centrally to the response envelope. No ad-hoc
  `res.status(...)` scattered through controllers.

## Naming

| Thing | Style |
|---|---|
| Variables, functions | `camelCase` |
| Components, classes, types | `PascalCase` |
| **Database columns** | **`snake_case`** |
| File names, API paths | `kebab-case` |
| JSON fields | `snake_case` |

**UUID primary keys** for all application entities. The only exception is a static lookup
with a natural key — the Surah table, 1–114.

## Validation

**Zod at every API boundary.** Zod schemas are **the single place** field limits are encoded,
and those constants are shared with the frontend so the UI mirrors rather than duplicates
them.

A limit written in two places is a limit that will disagree with itself.

## Raw SQL

Belongs in **migration files**. In application code it is permitted **inside repositories
only**, for exactly two purposes:

1. `SELECT … FOR UPDATE` row locks — Prisma has no lock API
2. Inserting job rows through the transaction client, via `JobsRepository`

Anywhere else: prohibited.

## Internationalization

**Every user-facing string is an i18n key.** No hardcoded UI text, from day one — even though
only the Arabic catalog ships.

That discipline is what makes the French and English catalogs a pure content task later.

## Styling

- Components consume **semantic tokens only** — `--color-primary`, never
  `--brand-green-700`; `--space-4`, never `1rem`.
- Adding a component means adding a file **and** a line to the stylesheet index. **Import
  order is the cascade** — every rule has single-class specificity, so which declaration wins
  is decided by load order.
- Verify a styling change with **both** `scripts/dev/css-resolve.py` (values) **and** a
  built-CSS diff (order). Neither alone is sufficient.

> [Design system](../architecture/design-system.md)

## Version policy

Two phases, and the phase in force determines what you may do.

### Phase 1 — Active development (now)

**Permitted:** patch-level updates to dependencies and container images.

**Prohibited:** **major** upgrades · **minor** upgrades · any new framework or infrastructure
component, without Document Owner approval.

Every patch update must, without exception:

1. be in **its own dedicated commit**, touching nothing else;
2. **state the reason** — bug fix, CVE, compatibility;
3. **re-run the complete CI pipeline**;
4. **update the version table** wherever exact versions are documented;
5. be **recorded in `CHANGES.log`**.

> A patch update is never a side effect of another task, and **never an agent's unprompted
> initiative.** It is a task in its own right, whose ledger row states why it was needed.

### Phase 2 — Feature freeze

Everything freezes; image digests lock; lockfiles regenerate; a full dependency and security
review runs; the release candidate is cut. After that, even a patch requires a dedicated
approved upgrade task.

### Floors, absolute in both phases

Node 22 LTS · PostgreSQL 17 · Prisma 6 · React 19 · Vite 6 · Express 5 · TypeScript 5.x
strict · pg-boss 10.

**Never substitute a different technology.** The frontend is React + Vite; **Next.js is not
part of this stack** and must not be introduced — it would break the same-origin routing
model.

## Commits

- **Atomic per sub-task.** One commit does one thing.
- **Cite the clause** it implements — `§4.3`, `TD-12`, `BR-5`.
- Push completed sub-tasks to **`develop`**.
- Record what was built in **`CHANGES.log`**, immediately.
- **Update the documentation in the same commit** ([policy](documentation-policy.md)).

## Working with the specification

| Situation | Action |
|---|---|
| You need a rule | Read **only** the section you are implementing |
| It seems wrong | **Stop and report to the Document Owner.** Never edit it |
| It is silent | **Stop and ask.** Do not invent |
| Two clauses conflict | **Business rules win — and report the conflict** |
| Your code contradicts it | Your code is the bug |

## Writing code comments

The house style, visible throughout this codebase: a comment explains **why**, especially
what was rejected.

```ts
// Absent means "use the default"; present-but-nonsensical means "clamp".
// Collapsing the two — `Math.trunc(x) || DEFAULT` — silently turned
// `page_size=0` into 25 while the `Math.max(…, 1)` beside it claimed to
// floor at 1. Two mechanisms disagreeing about the same value is the bug,
// not the value either produced.
```

That comment costs six lines and prevents the bug from being reintroduced by someone
"simplifying" it.

Cite the clause a decision comes from, so any behaviour traces to the requirement.

## Things that are prohibited outright

Beyond the layering rules, the guardrails that carry the most weight day to day:

- **Never** replace the job queue with in-memory queues, `setImmediate`, or timers
- **Never** store consent as a boolean
- **Never** use floats in grade or score arithmetic — integer basis points, rounded once
- **Never** expose private-bucket resources via static URLs
- **Never** declare collations, checks, partial indexes, or triggers in `schema.prisma` — and
  **never** run `prisma db push`
- **Never** trust child context without verifying **both** parties
- **Never** widen the permission matrix without a specification revision
- **Never** show a registration form before OAuth completes
- **Never** distinguish "not found" from "out of scope"
- **Never** log PII or commit secrets
- **Never** move real beneficiary data outside Morocco
- **Never** resolve a public display identity in a client
- **Never** invent navigation outside the sitemap, or build UI for a postponed feature

> Full text: SRS §20, twenty-one numbered rules. Nine are
> [enforced by CI](ci-cd.md#the-guards).

---

**Next:** [Testing](testing.md) · **Related:**
[Backend](../architecture/backend.md), [Documentation policy](documentation-policy.md)
