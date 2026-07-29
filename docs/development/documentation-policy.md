[Documentation](../README.md) › [Development](README.md) › **Documentation policy**

# Documentation policy

**Documentation is part of the implementation. A feature is not Done until its documentation
is updated — in the same commit.**

This page is the binding working agreement. Read it before your first pull request.

---

## The rule

> **Documentation drift is a defect.**
>
> When a code change makes documentation inaccurate, the documentation is updated **in the
> same commit**. Never in a follow-up, never in a ticket, never "when things calm down".

A follow-up commit that never lands is the normal outcome, and the cost is not evenly
distributed: the person who pays is the one who reads the stale page six months later and
believes it.

## Why the same commit, specifically

Three reasons, in increasing order of importance:

1. **The context is in your head now.** In two weeks you will remember *what* you changed but
   not *why the alternative lost* — and the why is the part worth writing.
2. **A reviewer can check it.** A documentation change reviewed alongside its code change
   gets read against the diff. Reviewed alone, it gets skimmed.
3. **Drift is invisible.** Wrong code fails a test. Wrong documentation passes everything and
   waits.

## What must be updated, by change type

| If you changed… | Update |
|---|---|
| An **API endpoint** | [API endpoints](../reference/api-endpoints.md); the contract regenerates itself, but its *governance* and any convention change belong in [API](../architecture/api.md) |
| The **database schema** | [Database](../architecture/database.md) — and the migration list at its foot |
| A **business rule** | The **SRS** (Document Owner only — see below), then [Business rules](../reference/business-rules.md) and whichever [overview](../overview/business-processes.md) page describes the process |
| **Authentication or authorization** | [Identity and access](../architecture/identity-and-access.md), and [Security](../architecture/security.md) if the posture moved |
| A **frontend structure or pattern** | [Frontend](../architecture/frontend.md) |
| **Design tokens or the stylesheet index** | [Design system](../architecture/design-system.md) |
| **Deployment, config, or infrastructure** | [Deployment](../operations/deployment.md), [Configuration](../operations/configuration.md), [Environments](../operations/environments.md) |
| A **background job** | [Background jobs](../architecture/background-jobs.md) |
| **Tests or CI** | [Testing](testing.md), [CI/CD](ci-cd.md) |
| An **architectural decision** | The relevant architecture page — including **what you rejected and why** |
| Anything at all | [`CHANGES.log`](../CHANGES.log), and tick [`TASKS.md`](../TASKS.md) |

## The single-source-of-truth rule

**Each concept has exactly one authoritative document. Others reference it.**

If two documents describe the same thing, that is a defect to refactor — not a sync to
maintain.

### Why this is stated so forcefully

Every duplicated requirement in this project's history has drifted:

| Duplication | What happened |
|---|---|
| The version-column list | Stated in two places; one copy silently omitted a new entity |
| The 90-day purge window | Hand-computed at four separate delete sites |
| The pagination rule | Two byte-identical copies in services, while **five other endpoints implemented none of it** |
| The display-name fallback | Introduced while describing one payload, which made a platform-wide rule look like a property of one screen |

**The copy that drifts still passes its own tests.** That is what makes duplication
dangerous rather than merely untidy — the divergence is invisible until something breaks.

**The fix is always a cross-reference, never a sync.**

## The specification is different

[`SRS.md`](../SRS.md) is **normative and immutable to contributors and agents.** It changes
only through a numbered revision approved by the Document Owner.

| Situation | What to do |
|---|---|
| The specification is **wrong** | **Stop and report.** Do not edit it |
| The specification is **silent** on something you need | **Stop and ask.** Do not invent |
| Two clauses **conflict** | **Stop and report.** Business rules win, and the conflict must be reported — not silently resolved |
| Your code contradicts it | Your code is the bug |

The handbook (everything else in `docs/`) is **mutable by anyone**, in the same commit as
the change it describes.

> [The two kinds of document](../README.md#the-two-kinds-of-document-in-this-repository)

## Write the system, not the code

The test is: **could an experienced engineer who has never seen this repository rebuild the
platform from this documentation alone?**

That bar means explaining more than what exists:

- **Why it exists** — the constraint or requirement that forced it
- **Why this design** — and **what was rejected**, which is the part that stops the next
  person re-deciding it under deadline without your context
- **How the parts interact**
- **The constraints, trade-offs, and extension points**
- **The security and performance implications**

Compare:

> ❌ *"`publicDisplayName` returns the public display name, falling back to the Arabic name."*
>
> ✅ *"Deliberately a named function rather than an inline `??`, because it implements a
> platform-wide invariant. Two implementations of one rule eventually disagree, and here
> disagreement means publishing a legal name where someone asked for a kunya — a failure the
> interface does not reveal to the person it affects."*

The first describes the code, which the code already does. The second explains the system.

### Record what you rejected

A design note that names the alternative and why it lost is the highest-value paragraph in
any of these pages. It is what prevented four separate near-regressions in this project's
history.

## Style

- **Cite, do not restate.** `§4.3`, `BR-5`, `TD-12`, "Revision 31".
- **Relative links only** — they work in GitHub, in editors, and in clones.
- **Every page opens with a breadcrumb** and closes with **Next** / **Related**.
- **Tables for comparisons, prose for reasoning.** A table cannot hold a "because".
- **Say "deliberately" when it is.** It marks a decision so the next reader knows it was made
  rather than defaulted into.
- **Arabic terms** get a translation on first use.
- **Diagrams** are Mermaid or ASCII — both render in GitHub, both diff as text.
- **Do not pad.** A short honest page beats a long one that repeats a neighbour.

## Status honesty

Where something is specified but not built, **say so where it is described** — as
[Storage](../architecture/storage.md) and
[Frontend](../architecture/frontend.md) both do at the top.

Documentation that describes an unbuilt feature in the present tense is worse than no
documentation, because it costs a reader an hour before they discover it.

## The checklist

Before opening a pull request:

- [ ] Every document my change made inaccurate is updated **in this commit**
- [ ] I stated **why**, not only what — including anything I rejected
- [ ] I did not restate a rule that already lives somewhere; I linked to it
- [ ] I did not create a second home for an existing concept
- [ ] Every link I added resolves (`bash scripts/ci/check-doc-links.sh`)
- [ ] Anything specified-but-unbuilt says so
- [ ] [`CHANGES.log`](../CHANGES.log) has its entry; [`TASKS.md`](../TASKS.md) is ticked
- [ ] If a **specification** change was needed, I **stopped and reported** rather than editing

## Enforcement

| Check | What it does |
|---|---|
| `scripts/ci/check-doc-links.sh` | **Fails the build** on a broken relative link or a missing anchor target |
| Code review | The reviewer checks the documentation diff against the code diff |
| The specification's own guardrails | Reading the ledger before starting and appending after finishing is already binding |

Link integrity is automatable and therefore automated. **Accuracy is not**, which is what
review is for.

---

**Related:** [Conventions](conventions.md), [CI/CD](ci-cd.md),
[Documentation map](../README.md)
