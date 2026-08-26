[Documentation](../README.md) › [Development](README.md) › **CI/CD**

# CI/CD

GitHub Actions, four parallel jobs, on every push to `develop`/`main` and on every pull
request.

```
guards      twenty dependency-free guard scripts — mechanically checkable repository rules
contract    regenerate the OpenAPI document, fail on drift, check conformance
backend     lint · exact typecheck · default tests · production build
frontend    lint · exact typecheck · tests · production build
```

The contract job runs the remaining two guard scripts, so **all twenty-two committed
`scripts/ci/check-*.sh` checks execute in CI**. They stay in the contract job because both
operate on the generated OpenAPI artifact and that job already installs the backend
dependencies needed to regenerate it.

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
| `check-dialog-hidden-when-closed.sh` | A mounted native dialog whose author CSS defeats the browser rule hiding it while closed |
| `check-progress-css.sh` | A progress fill using physical/direction-blind sizing, missing clipping or reduced-motion support, or an unloaded stylesheet |
| `check-shared-layout.sh` | The shared page header redefined per page, a second button system in CSS, or the header losing its two-column grid |
| `check-security-headers.sh` | An Nginx location declaring its own header set but dropping HSTS — `add_header` does not inherit, so the header is silently absent on the wire while the configuration still reads as if it were set |
| `check-storage-edge.sh` | An external MinIO path bypassing the shared proxy policy, or removal of the Nginx-owned unsigned streaming-trailer denial |
| `check-association-terminology.sh` | Superseded Arabic role/person vocabulary returning to the user-facing catalogue |
| `check-western-digits.sh` | Arabic-Indic digit conversion or rendered literals where the interface requires Western numerals |
| `check-display-identity.sh` | Raw name fields reaching the frontend · an inline display-name fallback · a controller exposing both inputs outside the one admissible staff screen |
| `check-active-role-presentation.sh` | Presentation reading the account's full role list instead of the currently active role |
| `check-provider-seam.sh` | Online-class provider details escaping the one provider-integration seam |
| `check-openapi-td3.sh` | An endpoint that contradicts the specification, is implemented undocumented, or is documented but absent from the router |
| `check-openapi-current.sh` | `docs/openapi.json` describing an API that is no longer the one served — a served endpoint with no generator mapping, a mapping the router does not serve, or a document that reconciles but was never regenerated |
| `check-doc-links.sh` | A broken relative link or missing anchor in the documentation (SRS §16.4, listed in §19.2) |
| `check-migration-order.sh` | A migration referencing a column that a **later-named** migration adds — fine on every existing database, fatal on an empty one, so it would surface exactly once: at the first production deploy (TD-6a) |
| `check-contract-dto.sh` | A controller handing a service result straight to `res.json` · a spread inside `dto.ts` that turns an allow-list back into "everything" (SRS §16.2, Revision 38) |

Run them all locally:

```bash
for g in scripts/ci/check-*.sh; do bash "$g" || echo "FAILED: $g"; done
```

## The contract job

Four steps, and the **order** is what makes it work:

```yaml
1. npm run openapi:generate                   # regenerate FROM THE IMPLEMENTATION
2. git diff --exit-code docs/openapi.json     # fail if the committed copy differs
3. bash scripts/ci/check-openapi-current.sh   # the same question, runnable locally
4. bash scripts/ci/check-openapi-td3.sh       # conformance against the specification
```

**Step 1 is not redundant.** Without regenerating, step 4 would be validating a file a human
could hand-edit — exactly what the specification forbids. Regenerating first is what makes
`openapi.json` a generated artifact *in fact*, not merely by intention.

Generation walks the **live Express router**, so it fails on any operation documented but not
served, or served but not documented.

> **Rule 4 exists because it was needed.** A route was once added to both the registry and
> the contract while never being mounted — every gate passed while the endpoint returned
> `404`.

### Why step 3 was added, and what it is NOT a duplicate of

`docs/openapi.json` **went stale for a week** — from `ed7212b` (2026-08-11) to `4842def`
(2026-08-18) — while **24 served endpoints** had no generator mapping: enrolments, the whole
Quran surface, grade entry, the teaching-group reads, `PUT /events/{id}/staff`. Every local
guard was green throughout.

Three things had to be true at once, and each is worth stating because each is a general trap:

1. **Step 4 cannot see it.** It compares the **committed** document against the TD-3 registry
   — *does this file describe endpoints the SRS documents* — and a stale file can satisfy that
   forever. *Does this file describe the API we serve* is a different question, and nothing
   was asking it outside CI.
2. **The generator's failure looked like a build error.** Step 1 does fail on this, but under
   a step named *"Regenerate docs/openapi.json"* — which reads as tooling breaking, not as a
   contract gap, and reads that way to whoever glances at the job.
3. **Nothing local ran the generator.** It is not part of `npm test`, not part of any hook,
   and not in `scripts/ci/`. The one sweep a developer actually runs —
   `for g in scripts/ci/check-*.sh` — could not reach it.

Step 3 fixes the third, which is the one that matters: **the guard now lives where the sweep
looks.** It fails on all three staleness modes, including the one neither other step catches —
a document that reconciles against the router but was never regenerated after a description,
a response code or a path changed.

> **The general lesson, worth more than the fix:** *a guard that checks the committed artifact
> is not a guard that the artifact is current.* Ask which of the two questions each gate is
> really asking, because a gate answering the wrong one stays green while the thing it exists
> to protect rots.

**Documented-but-unimplemented endpoints report `PENDING`** and do not fail the build. A gate
that is red from M1 to M6 is a gate nobody reads. `TD3_REQUIRE_COMPLETE=1` is deliberately not
enabled in this workflow: the remaining registry gaps first need Owner/SRS reconciliation,
including entries superseded by Revisions 58 and 81. Ordinary conformance remains enforced.

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

### Rate limits are a classification problem, not a number problem

`RATE_LIMITED` fired during ordinary manual testing. The instinct is to raise a
limit; the cause was that **`/auth/refresh` sat in the login bucket**.

The SPA calls refresh on every fresh page load — no in-memory token, so it tries
the cookie. At the auth zone's 10 r/m with burst 5 that is **six page loads**
before a 429, measured rather than assumed: six succeeded, the seventh was
refused.

**Neither TD-13 number changed.** `/auth/refresh` and `/auth/logout` were
reclassified under the general-API limit TD-13 already states (120 r/m); the
OAuth entry and callback keep 10 r/m. TD-13's tighter limit protects *credential
guessing*, and neither of those two can be guessed — refresh presents a cookie
the server issued and rotates, and TD-12's reuse detection revokes the whole
session on replay, which is a far stronger control than a counter.

Ruled out while diagnosing, each checked rather than assumed: React StrictMode's
double effect invocation (the client's single-flight promise collapses it to one
network call), duplicate submissions (the form disables its button in flight),
and IP grouping (nginx is the edge, so `$binary_remote_addr` is the real client).

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
- Fatal `TD3_REQUIRE_COMPLETE=1` release completeness, pending Owner/SRS reconciliation
- Container-image publication; the backend/frontend jobs verify application production builds
  but do not publish deployable images

## The release flow (binding — Document Owner, 2026-08-25)

**One commit travels the whole way, and nothing overtakes it.**

```
feature branch
  → local implementation + local tests + local browser verification
  → merge to develop
  → CI on a CLEAN CHECKOUT
  → deploy that exact develop commit to Staging
  → automated Staging E2E / acceptance
  → Staging approval
```

Once Production exists it extends by one step, and only one:

```
  → deploy that exact Staging-approved commit to Production
  → production smoke verification
```

> **No change reaches Production without passing Local, CI and Staging on the same commit.**

Each gate exists because the one before it cannot see what it sees:

| Gate | Catches what the previous gate structurally cannot |
|---|---|
| Local | Everything a developer can reproduce at will |
| **CI on a clean checkout** | Anything an existing `node_modules`, a generated Prisma client or a stale container hides. Both defects that broke this build were exactly this shape — invisible locally, fatal on a clean tree |
| **Staging** | TLS, real headers on the wire, container memory ceilings, worker registration, the storage boundary as the internet sees it. HSTS was configured and never sent, and only a `curl -I` against real TLS could have found it |
| Production smoke | That this deployment, of this commit, on this host, is actually serving |

**Commit-to-Staging traceability is part of the flow, not an extra.** The deployed commit is
recorded on the host at `/opt/bodour/DEPLOYED_COMMIT` and the host tracks `develop` rather
than a branch of its own, so *what is running* is answerable without guessing.

**A red gate stops promotion.** It is not a signal to be read later and worked around.

## Deployment

There is **no automatic deployment to production.** The pipeline is
[deliberate and manual](../operations/deployment.md), ten steps, run by a human on the VPS.

CI now verifies both application production builds. It **does not yet build or publish
container images**; reconciling that with the production deployment procedure is a separate
operations slice. The frontend build's ~2 GB peak remains the reason deployment must not
compile it beside the running services.

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

A review note is followed until the reviewer is on holiday. Many of the binding
guardrails are mechanically checkable, so they are mechanically checked — and the reviewer's
attention goes to the ones that are not.

---

**Related:** [Testing](testing.md), [Conventions](conventions.md),
[Deployment](../operations/deployment.md)
