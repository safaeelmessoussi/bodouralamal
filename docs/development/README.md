[Documentation](../README.md) › **Development**

# Development

Contributing to the platform.

## Pages

| | |
|---|---|
| [Getting started](getting-started.md) | From clone to a running stack |
| [Conventions](conventions.md) | Layering, naming, TypeScript, commits, version policy |
| [Testing](testing.md) | Four layers, what each is for, how to run them |
| [CI/CD](ci-cd.md) | Every gate, what it catches, and why it was added |
| [Documentation policy](documentation-policy.md) | **Documentation is part of Done — read this first** |

## The working agreement, in short

1. **Read [`CHANGES.log`](../CHANGES.log) and [`TASKS.md`](../TASKS.md) before starting.**
   They are the fastest read on the current state.
2. **Consult only the specification sections you are implementing.** It is cross-referenced
   by `§`/`BR-x`/`TD-x` identifiers for exactly that purpose — do not read it end to end for
   every task.
3. **Never edit [`SRS.md`](../SRS.md).** It is immutable to contributors. If you believe it
   is wrong, **stop and report**.
4. **If the specification is silent, or two clauses conflict — stop and ask.** Do not invent
   behaviour, and do not silently pick a reading.
5. **Write the tests.** Especially the one that asserts the *security property*, not the code
   path.
6. **Update the documentation in the same commit.** A feature is not Done without it.
7. **Record what you built** in `CHANGES.log`; tick `TASKS.md`.
8. **Regenerate the API contract** if you touched a route.
9. **Run the guards**, then commit atomically to `develop`.

## The one habit worth copying

**Prove the guard, do not trust it.**

Every CI guard in this repository was verified by *reintroducing the bug it exists to catch*
and confirming the build went red. A guard that has never failed is a guard nobody has
tested — and this project has already had three cases where a check appeared to pass while
silently testing nothing.

The same applies to mutation testing: **a surviving mutant is worth distrusting until the
mutation is proven to have shipped.** Three separate harness failures here produced false
negatives — a broken build that left a stale container running, a shell that did not
word-split a variable so zero tests ran, and a test runner using a different failure format
for single-file runs.

---

**Related:** [Architecture](../architecture/README.md), [Operations](../operations/README.md)
