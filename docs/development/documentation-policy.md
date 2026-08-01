[Documentation](../README.md) › [Development](README.md) › **Documentation policy**

# Documentation policy

**Documentation is part of the implementation. A feature is not Done until its documentation
is updated — in the same commit.**

Read this before your first pull request, and work through
[the before/during/after sequence](#the-workflow-before-during-after) on **every** task —
the assessment happens *before* you write code, not after.

> **The obligation is normative, and it lives in the specification — SRS §16.4** (Revision
> 37). This page is the working guide to satisfying it: which page to update for which
> change, and how to write it. Where the two differ, §16.4 wins and this page is the defect.
>
> **Reading the relevant documentation before starting implementation is additionally a
> mandatory content of `CLAUDE.md`** (§16.3, Revision 37.1) — pinned there so the step
> survives any future rewrite of that file.

---

## The rule

> **Documentation drift is a defect.**
>
> When a code change makes documentation inaccurate, the documentation is updated **in the
> same commit**. Never in a follow-up, never in a ticket, never "when things calm down".

§16.4 states it once; every other place that mentions it — `CLAUDE.md`, `AGENTS.md`, §20's
"always" list, and this page — **cites** it.

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

## The workflow: before, during, after

Documentation is not a step at the end. It brackets the work.

### 1. Before implementing

**Read the documentation covering the area you are about to change, and decide which
documents the task affects.** Do this *first*, before writing code.

This is not ceremony, and it is the step most often skipped. It pays for itself three ways:

- **You find the existing decision.** Half of what looks like a new problem was already
  argued and recorded — often with the alternative you were about to pick, and the reason it
  lost.
- **You find the authoritative home.** Knowing where a concept already lives is what stops
  you creating a second one.
- **You size the task honestly.** "This is a two-line change" is usually false once you can
  see that it touches an architectural claim, an operational procedure, and a contract.

### 2. During implementation

**Keep the documentation moving with the code.** When you make a decision, write it down
while the reasoning is still in front of you.

**Never leave documentation for "later".** Later is a commit that does not land, and the
person who pays is whoever reads the stale page months from now and believes it.

### 3. After implementing

Update **every** affected document, then the connective tissue:

- **Cross-references** — both directions. A new page nobody links to is invisible.
- **Indexes** — the section `README.md`, and [`docs/README.md`](../README.md) if a page was
  added or its purpose changed.
- Then the per-change-type table below.

## What must be updated, by change type

| If you changed… | Update |
|---|---|
| An **API endpoint** | [API endpoints](../reference/api-endpoints.md); the contract regenerates itself, but its *governance* and any convention change belong in [API](../architecture/api.md) |
| The **database schema** | [Database](../architecture/database.md) — and the migration list at its foot |
| A **business rule** | The **SRS** (Document Owner only — see below), then [Business rules](../reference/business-rules.md) and whichever [overview](../overview/business-processes.md) page describes the process |
| **Authentication or authorization** | [Identity and access](../architecture/identity-and-access.md), and [Security](../architecture/security.md) if the posture moved |
| A **frontend structure or pattern** | [Frontend](../architecture/frontend.md) |
| **User-visible behaviour** — a screen, a state, a flow, wording that changes what someone sees or does | [Frontend](../architecture/frontend.md), and the [overview](../overview/business-processes.md) page describing that process if the *process* changed rather than only its presentation |
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

The two tiers, and which wins, are defined normatively in **§16.4**.

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

### Think past the change in front of you

A task often produces knowledge worth more than the diff. Before you finish, ask whether it
produced any of these — and if it did, write it where it belongs:

| Produced | Goes to |
|---|---|
| A **design decision** | The relevant architecture page, with the alternative and why it lost |
| **Architectural knowledge** — how two parts actually interact | The architecture page that owns the seam |
| An **implementation pattern** worth copying | [Conventions](conventions.md), or the architecture page as a worked example |
| A **constraint** discovered the hard way | Wherever someone would hit it — often [Database](../architecture/database.md) or [Performance](../architecture/performance-and-scale.md) |
| An **operational consideration** | [Operations](../operations/README.md) — and a [runbook](../operations/runbooks.md) if it is a procedure |
| A **maintenance note** — a trap, a stale-state gotcha | The troubleshooting table in [Getting started](getting-started.md), or beside the code as a comment |
| **Developer guidance** | [Conventions](conventions.md) or [Getting started](getting-started.md) |

The test is not *"is this part of the ticket?"* but **"would this help someone rebuilding or
maintaining the platform later?"** If yes, it is in scope, and the moment you learned it is
the cheapest moment to record it.

#### Undocumented knowledge is technical debt

> **Standing rule.** Knowledge you discover during implementation that is not already
> documented **is technical debt from the moment you discover it** — whether or not anyone
> asked for it, and whether or not it relates to the task. **Document it immediately, in the
> appropriate place.**

It is debt in the strict sense: it accrues interest, and someone else pays. The interest is
the hour the next person spends rediscovering it — or worse, the change they make *without*
knowing it, because nothing warned them.

Two properties make this rule worth stating separately from the table above:

- **It has no "was it in scope?" exemption.** A trap found while fixing something unrelated
  is still a trap. Deferring it to "a docs task later" is how it is lost, because by then the
  discovery is no longer in anyone's head.
- **It applies to small things.** A one-line troubleshooting row is often higher-value per
  word than a page of architecture, because it converts a wasted afternoon into a lookup.

**Where "immediately" means:** the same commit if it touches a page you are already editing;
otherwise its own small commit, now, not queued. The correct home is usually obvious from the
table above — and if it genuinely has no home, that absence is itself worth reporting.

This is where the project's most useful paragraphs came from: the stale-Prisma-client trap,
the PostgreSQL 18 volume-mount requirement, the port-clash reasoning in the dev overlay, and
the mutation-testing false negatives were all incidental discoveries, not deliverables.

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

## Documentation is code

It is held to the same standards, and each one already has a home on this page rather than a
restatement here:

| Standard | Where it lives |
|---|---|
| No duplication · one authoritative source | [The single-source-of-truth rule](#the-single-source-of-truth-rule) |
| Correct cross-references | [Style](#style), enforced by [`check-doc-links.sh`](#enforcement) |
| Clear hierarchy | [`docs/README.md`](../README.md) — every page reachable from an index |
| No outdated information | [Status honesty](#status-honesty), and the same-commit rule above |

Which means a documentation change is reviewed like code: a second home for a concept is a
defect, a broken cross-reference fails the build, and a page describing something that is not
true is a bug with a longer fuse than most.

## The documentation half of Done

> **The full Definition of Done lives in
> [Engineering principles § 9](engineering-principles.md#9-definition-of-done)** — it covers
> implementation, reuse, tests, tokens, accessibility and record-keeping, of which
> documentation is one part. It moved there when it outgrew this page: a definition of *done*
> that lives inside a *documentation* policy is filed under one of its own clauses.

The documentation-specific checks it refers back to:

- [ ] Every document my change made inaccurate is updated **in this commit**
- [ ] I stated **why**, not only what — including anything I rejected
- [ ] I did not restate a rule that already lives somewhere; I linked to it
- [ ] I did not create a second home for an existing concept
- [ ] Anything specified-but-unbuilt says so
- [ ] I asked what else the task taught, and wrote down anything a future maintainer would
      want ([above](#think-past-the-change-in-front-of-you))
- [ ] Cross-references verified (`bash scripts/ci/check-doc-links.sh`)
- [ ] [`CHANGES.log`](../CHANGES.log) updated; [`TASKS.md`](../TASKS.md) ticked

**Reporting "done" with the documentation outstanding is reporting done falsely.** The
implementation is the visible half; the documentation is what makes it survivable.

And when you do report it, use the six fixed sections in
[Reporting completion](README.md#reporting-completion) — section 3 is *Documentation updates*,
which is where this page's work becomes visible to the reader rather than implied.

## Enforcement

| Check | What it does |
|---|---|
| `scripts/ci/check-doc-links.sh` | **Fails the build** on a broken relative link or a missing anchor target. Listed in the specification's CI gates (§19.2) |
| Code review | The reviewer checks the documentation diff against the code diff |
| SRS §16.4 | The obligation itself is normative — not a team convention that can lapse |
| SRS §20 | The "always" list now includes updating documentation in the same commit |

Link integrity is automatable and therefore automated. **Accuracy is not**, which is what
review is for.

---

**Related:** [Conventions](conventions.md), [CI/CD](ci-cd.md),
[Documentation map](../README.md)
