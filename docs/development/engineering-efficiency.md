[Documentation](../README.md) › [Development](README.md) › **Engineering efficiency**

# Engineering efficiency

**Implementation efficiency is a primary project objective, not a courtesy.**

An implementing agent is responsible for *choosing the workflow*, not only for executing one.
The measure is **engineering progress per unit of context consumed**, sustained across many
sessions — not tokens saved in the current one.

> This page is the authoritative home of the efficiency policy. It **cites** the rules that
> already have homes — the [constitution](engineering-constitution.md), the
> [documentation policy](documentation-policy.md), [testing](testing.md) — rather than
> restating them, per [§1.2 one authoritative home per concept](engineering-constitution.md#12--one-authoritative-home-per-concept).

---

## The one-sentence version

Choose, continuously and without being asked, the approach that delivers the most finished
work for the least context — and never buy that saving with correctness, architectural
integrity, security, specification compliance, or documentation.

## What efficiency is measured in

**Completed vertical slices.** Not tokens, not turns, not brevity.

This matters because the obvious way to reduce context is to do less work, and that is not
efficiency — it is scope narrowing, which is
[the Document Owner's call and never the implementer's](README.md#reporting-completion). A
cheap answer that leaves the task unfinished has *negative* efficiency: the next session pays
the full cost of re-entering the problem, and pays it cold.

Three consequences:

- **Finish the slice you started.** Partially completed work is the most expensive artefact
  in this project — it carries all the context cost of the work and none of the benefit.
- **A slice ends at a resource boundary**, with the tree clean, the documentation updated and
  the commit pushed. Anything less is not a boundary, it is an interruption.
- **Efficiency never shortens the deliverable.** It shortens the path to it.

## The five non-negotiables

Efficiency argues for skipping things. These five are never what it skips:

| | Where it lives |
|---|---|
| **Correctness** | — |
| **Architectural integrity** | [The constitution](engineering-constitution.md) |
| **Security** | [The constitution §7](engineering-constitution.md), SRS §20 |
| **Specification compliance** | `SRS.md` — and it is [immutable to implementers](README.md) |
| **Documentation** | [Documentation policy](documentation-policy.md) — part of Done, same commit |

**Documentation is on this list deliberately, and it is the one most at risk.** It is the
cheapest thing to defer and the most expensive thing to have deferred: undocumented knowledge
is [technical debt payable immediately](documentation-policy.md#undocumented-knowledge-is-technical-debt),
because the moment of discovery is the cheapest moment to record it. An "efficient" session
that ships code without its documentation has moved cost onto every session after it, and
this project has never once recovered that cost later.

## Context management

**Treat context as a finite engineering resource** — spend it where it converts into
delivered work.

- **Read only what the current objective requires.** The specification is cross-referenced by
  `§`/`BR-x`/`TD-x` *for exactly this purpose*; read the clause, not the document.
- **No repository-wide search without evidence that a narrower one will not do.** A guess
  about where something lives is cheaper to test than a sweep is to run.
- **Do not re-read what is already understood** unless there is evidence it changed.
- **Reuse conclusions that remain valid.** This is the same instinct as
  [one authoritative home per concept](engineering-constitution.md#12--one-authoritative-home-per-concept),
  applied to reasoning instead of code: re-deriving a settled decision is duplicating it, and
  the re-derivation can drift from the original exactly as a copied rule does.
- **Keep prose short while implementing.** Explanation belongs in the code, the documentation
  and the completion report — three places that persist. Narration in the middle of a slice
  persists nowhere.

### The pre-implementation read is not an exception to this

The [mandatory read before implementing](documentation-policy.md#1-before-implementing) looks
like context spent for nothing. It is the highest-return read available: it finds the decision
already recorded, the concept's existing home, and the honest size of the task. Skipping it
does not save context — it defers the cost to the point where the work has to be redone.

**The efficient version of that read is targeted, not thorough.** Read the pages the change
touches. That is the whole difference.

## What waste actually looks like here

Named, because a policy against "unnecessary work" catches nothing:

- **Re-deriving a settled conclusion** — re-proving a mechanism already proven on an
  equivalent case earlier in the same session.
- **Re-running a suite that could not have moved** — a full sweep after a change no test in it
  can observe.
- **Restating a rule that already has a home** — the documentation equivalent, and
  [independently forbidden](engineering-constitution.md#12--one-authoritative-home-per-concept).
- **Surveying options instead of choosing one.** Where a recommendation is possible, give the
  recommendation.
- **Re-auditing a repository that a previous session already established the state of.**
- **Reading a file to confirm an edit succeeded** — the tooling errors if it did not.

## Planning

Choose the slicing that maximises total throughput. **Default to small, independently
completable vertical slices** — one resource, end to end — because they bound the context a
failure can waste and produce a compaction point for free.

Depart from that default when a different organisation is *demonstrably* cheaper: several
resources sharing one expensive setup step, or one migration serving three endpoints. Say so
in a line when you do.

## Verification

**Verify what the change could have broken, at the cheapest level that could actually observe
the breakage.** ([The four layers](testing.md) are what "level" means.)

- Run the targeted suite while building; defer repository-wide validation to a milestone —
  **unless running it earlier reduces implementation risk**, which it does whenever the later
  failure would invalidate work built on top of it.
- **Do not re-run an expensive command without evidence the result could have changed.**
- **Name what you skipped, and why, in the completion report.** Deferred verification that is
  not written down is indistinguishable from verification that never happens — and a
  [Definition of Done](engineering-constitution.md#9-definition-of-done) is not satisfied by
  intent.

### Skipping is legitimate only for the established, never for the likely

This is the line the whole section turns on. Not re-running a check whose conclusion is
**already established** is efficiency. Not running one whose result is merely **probable** is
a guess wearing an efficiency argument.

### Measure, don't infer

**When a fact is cheap to check, check it.** Efficiency reasoning is the most common way an
agent talks itself into assuming a result, and on this project inference has lost to
measurement every time it has been tried:

- A `docker compose build` failed inside a `;`-chained command; the tests then ran green
  against a **stale container**. Grepping `dist/` in the running image cost one command and
  found it.
- A test-count discrepancy invited arithmetic about which suites had grown. Stashing the work
  and running the baseline cost two minutes and proved the *previously reported* figure wrong.

The [three earlier harness false negatives](README.md#the-one-habit-worth-copying) are the
same lesson from before this policy existed. **A cheap measurement is not a context cost — it
is the thing that stops a whole session being built on a false premise.**

## Autonomy

Selecting the strategy is part of the work. Continuously ask whether a different workflow
would produce more progress per unit of context; when one would, **switch and explain in one
line**. Do not ask permission for a workflow change, and do not write a comparison of the
options — the explanation exists so the reader can object, not so they can decide.

## The context threshold

Monitor context growth. When continuing in the current conversation has become materially
less efficient than continuing from a compacted one:

1. **Finish the current logical slice** — never compact mid-slice.
2. **Produce a handoff** (below).
3. **Recommend `/compact`.**

**Do not recommend it without a real expected benefit.** A compaction at the wrong moment
costs a re-derivation of everything the summary drops.

### What makes a handoff cheap to resume from

Empirically, four things — anything else is re-derivable:

| | |
|---|---|
| **Where** | Branch and commit, and that the tree is clean |
| **What is done** | The slice just completed, in one line |
| **What is next** | The next slice, and the *minimum* files it requires |
| **What is settled** | Conventions already established, so they are not re-litigated — plus that this policy stays in force |

---

## Why this is written down

Two reasons, both learned here.

**A policy held only in a conversation dies at the next compaction.** This one governs
behaviour across sessions by definition, so it has to outlive any single one of them — which
is the same argument as [documentation is part of Done](documentation-policy.md#the-rule),
applied to a working agreement instead of a feature.

**And an efficiency drive with no stated limits erodes the practices that are hardest to
justify in the moment** — the second test, the documentation update, the check whose result
you are confident of. Those are exactly the practices this project has already paid for
skipping. Writing the limits down beside the objective is what keeps the objective from
consuming them.

---

**Related:** [Engineering constitution](engineering-constitution.md),
[Documentation policy](documentation-policy.md), [Testing](testing.md),
[Development](README.md)
