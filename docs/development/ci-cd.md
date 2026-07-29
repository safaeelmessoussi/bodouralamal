[Documentation](../README.md) › [Development](README.md) › **CI/CD**

# CI/CD

GitHub Actions, four parallel jobs, on every push to `develop`/`main` and on every pull
request.

```
guards      ten guard scripts — the SRS rules that are mechanically checkable
contract    regenerate the OpenAPI document, fail on drift, check conformance
backend     lint · typecheck · test
frontend    lint · typecheck · test
```

## The guards

Each exists because something went wrong, or would plausibly go wrong silently. Each was
**proven by reintroducing the bug it catches.**

| Guard | Fails on |
|---|---|
| `check-env-not-committed.sh` | An `.env` file committed |
| `check-no-db-push.sh` | `prisma db push` appearing anywhere — it bypasses the migration history and **silently drops hand-written SQL** |
| `check-migrations.sh` | Hand-written migration SQL missing from the history |
| `check-migration-drop-rename.sh` | A `DROP`/`RENAME` without a contract-phase justification, flagged for human review |
| `check-prisma-mass-write.sh` | A mass-write Prisma call that skips soft-delete filtering |
| `check-header-nav-exclusive.sh` | The burger and horizontal navigation both visible at one width |
| `check-design-tokens.sh` | A raw colour, a reach past the semantic token layer, or a stylesheet nobody imports |
| `check-display-identity.sh` | Raw name fields reaching the frontend · an inline display-name fallback · a controller exposing both inputs outside the one admissible staff screen |
| `check-openapi-td3.sh` | An endpoint that contradicts the specification, is implemented undocumented, or is documented but absent from the router |
| `check-doc-links.sh` | A broken relative link or missing anchor in the documentation (SRS §16.4, listed in §19.2) |

Run them all locally:

```bash
for g in scripts/ci/check-*.sh; do bash "$g" || echo "FAILED: $g"; done
```

## The contract job

Three steps, and the **order** is what makes it work:

```yaml
1. npm run openapi:generate          # regenerate FROM THE IMPLEMENTATION
2. git diff --exit-code docs/openapi.json   # fail if the committed copy differs
3. bash scripts/ci/check-openapi-td3.sh     # conformance against the specification
```

**Step 1 is not redundant.** Without regenerating, step 3 would be validating a file a human
could hand-edit — exactly what the specification forbids. Regenerating first is what makes
`openapi.json` a generated artifact *in fact*, not merely by intention.

Generation walks the **live Express router**, so it fails on any operation documented but not
served, or served but not documented.

> **Rule 3 exists because it was needed.** A route was once added to both the registry and
> the contract while never being mounted — every gate passed while the endpoint returned
> `404`.

**Documented-but-unimplemented endpoints report `PENDING`** and do not fail the build. A gate
that is red from M1 to M6 is a gate nobody reads. The final release checklist flips `PENDING`
to fatal.

## Stories behind three guards

### The burger that was always visible

`.app-header__burger { display: inline-flex }` was declared **after** the media query hiding
it, at equal specificity. In a stylesheet where every rule has single-class specificity,
**order is the cascade** — so the burger showed at every width.

Now `check-header-nav-exclusive.sh` asserts the two are mutually exclusive.

### The token guard that caught its own author

`check-design-tokens.sh` was added, and **two commits later it failed on a hardcoded
`rgb(7 56 38 / 45%)` dialog backdrop** written by the same person. Fixed with a proper
`--color-backdrop` token.

A guard that only ever catches other people's mistakes is not being tested.

### The display-identity guard

Proven by **planting an inline `?? nameArabic`** in the calendar service. Rejected with file
and line; passing again once reverted.

It enforces a rule where the failure is invisible to the person it harms: the wrong branch
publishes a legal name where someone asked for a kunya.

## What CI does not yet run

The workflow is explicit that later milestones extend it, as **dedicated tasks recorded in
the ledger** rather than drive-by additions:

- Integration tests against a containerized database (run locally today)
- Permission-matrix API tests generated from the matrix
- Playwright end-to-end journeys
- The ≥ 80 % coverage gate on services and policies

## Deployment

There is **no automatic deployment to production.** The pipeline is
[deliberate and manual](../operations/deployment.md), ten steps, run by a human on the VPS.

**Images are built in CI and pulled** — never built on the server, where the frontend build's
~2 GB peak would exhaust a 4 GB box.

Pushing to `develop` triggers an automatic **Vercel** build of the frontend in a
fixture-pointing configuration that calls no real backend.

## Adding a guard

1. Write the check as a shell script in `scripts/ci/`.
2. **Prove it: reintroduce the bug and confirm the build goes red.** This step is not
   optional — an untested guard is a guard that may be testing nothing.
3. Revert the bug; confirm it passes.
4. Wire it into the workflow with a name that says which rule it enforces.
5. Document it here and in [Conventions](conventions.md).

### Two shell traps that have already produced false results here

Both were found while proving `check-doc-links.sh`, and both make a guard report confidently
wrong answers rather than failing loudly. Worth knowing before you write the next one.

**`grep -q` inside a pipeline under `set -o pipefail` reports failure on success.**

```bash
set -uo pipefail
if ! produce_list | grep -qxF "$needle"; then   # ✗ broken
```

`grep -q` exits **as soon as it matches**, which closes the pipe; the upstream producer then
takes `SIGPIPE` (141), and `pipefail` propagates that as the pipeline's status. So a **found**
needle reports **not found**. Capture first, then match:

```bash
haystack=$(produce_list)
if ! grep -qxF "$needle" <<<"$haystack"; then   # ✓
```

This one made the link guard report **every anchor in the repository as broken**.

**`printf '%s'` without `\n` silently concatenates a loop's output.**

A helper emitting one value per call with no trailing newline turns 40 lines into one, after
which `grep -x` matches nothing. Same guard, same debugging session, same symptom — which is
why the trace-then-isolate order matters: `bash -x` located the first, and testing the helper
in isolation located the second.

**The general lesson:** when a guard reports something implausible — *everything* is broken,
or *nothing* is — suspect the harness before the content. Three of this project's
mutation-testing false negatives had the same shape
([Testing](testing.md#mutation-testing)).

## Why guards rather than review notes

A review note is followed until the reviewer is on holiday. Nine of the twenty-one binding
guardrails are mechanically checkable, so they are mechanically checked — and the reviewer's
attention goes to the twelve that are not.

---

**Related:** [Testing](testing.md), [Conventions](conventions.md),
[Deployment](../operations/deployment.md)
