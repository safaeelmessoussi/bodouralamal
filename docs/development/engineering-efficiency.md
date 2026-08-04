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

## Reporting is spent from the same budget

A completion report consumes context exactly as implementation does, and an over-long one is
paid for by every session that inherits it.

**The six-section structure is normative** (SRS §16.3, Revision 37.2) and is not negotiable —
two of its sections carry obligations the specification imposes elsewhere. **Its length is
not normative**, and length is the whole cost. The compact discipline — bullets, no restated
conventions, no narration of the diff, one word for an empty section — lives with the rest of
the reporting guidance in [Reporting completion](README.md#write-them-compactly).

## Autonomy

Selecting the strategy is part of the work. Continuously ask whether a different workflow
would produce more progress per unit of context; when one would, **switch and explain in one
line**. Do not ask permission for a workflow change, and do not write a comparison of the
options — the explanation exists so the reader can object, not so they can decide.

## Process optimisation is subordinate to implementation

Improving the process is valuable. **Implementation is the default activity**, and the process
is improved *in service of it*, never instead of it.

**Once a process improvement has been proposed and handed over for a decision, that work is
complete.** Do not revisit, refine, defend or extend the same proposal unless:

- the Document Owner explicitly asks;
- **new evidence materially changes the recommendation** — not evidence that merely supports
  it; the bar is *the recommendation would now be different*; or
- implementation cannot proceed correctly without the decision.

### Hand it off to a document, not to the next report

This is the mechanism that makes the rule hold. A pending proposal lives in **its own
document**, with `CHANGES.log` recording that it was raised. It does **not** live in the
*Remaining work* section of every subsequent report — that is precisely how a settled handoff
becomes a recurring topic, re-argued a little each time and paid for out of the
implementation budget.

**Record once. Then stop mentioning it.**

### A pending proposal never blocks

The rules in force stay in force while a proposal is pending. Waiting on a decision is not a
reason to pause, to re-raise, or to work under the proposed rules early.

### Why this needs saying

**Process work is unbounded and feels productive.** There is always another refinement, it
never fails a test, and it produces the appearance of progress without any. Implementation is
bounded, verifiable, and the thing the platform is actually made of. Given a choice between
polishing the process and shipping the next vertical slice, **the slice wins** — and process
observations are **batched** until one is worth a moment of its own, rather than acted on the
instant they occur.

**This section governs itself.** The efficiency policy is a process document, so it is subject
to its own rule: it is not to be continuously re-tuned.

## The context threshold

**The recommendation is an estimate of engineering throughput, never an observation about
conversation size.** Message count, turn count and elapsed time are not evidence and must
never be given as the reason.

### The test

> **Would the next slice go faster from a compacted context than from this one?**

Answer it by separating what is loaded into two kinds:

| | |
|---|---|
| **Live context** | What the next slice will actually reuse — file contents it will edit, fixture and test shapes it will copy, decisions still in flight |
| **Spent context** | Closed decisions, completed process discussions, resolved detours, superseded approaches — **already recorded durably elsewhere**, which is why they are spent |

**Spent context is inert, not harmful.** Its presence is not a reason to compact. The
recommendation turns on **live** context only:

- **Recommend** when the next slice's working set is **largely disjoint** from what is loaded
  — a different subsystem, a different layer — so most of what is carried will never be
  consulted while the useful part is small enough to survive a summary intact.
- **Do not recommend** when the loaded implementation context — the fixtures, the file shapes,
  the conventions in their concrete form — is **what the next slice will build on**. A summary
  compresses that too, and the re-reads it forces are a real cost paid immediately, against a
  saving that is speculative.

### Capacity, not only value

Value is half the question. The other half is **whether the remaining budget can finish the
next slice at all** — because the two failure modes are not symmetric:

- Compacting one slice early costs a re-read or two.
- **Running out mid-slice costs the in-flight state that was never written down** — the
  half-formed decision, the reason the third attempt failed. That is the most expensive thing
  in the conversation and the only thing a summary cannot reconstruct, and the policy forbids
  compacting there precisely because of it.

**So under genuine uncertainty, err toward the boundary.** The two questions compose:

| | **Budget comfortably fits the slice** | **Budget probably will not** |
|---|---|---|
| **Context is live** | **Continue.** Say nothing. | **Recommend — and say the reason is capacity, not value**, so the loss is a known trade rather than a silent one |
| **Context is spent** | **Continue.** Inert history is not a reason. | **Recommend.** The easy case |

**Size the slice from the last comparable one**, not from a feeling: *this slice is ten
operations against the last one's six, so roughly 1.5–2×*. That is an estimate with a basis;
"it feels big" is not.

**Corollary — a slice too large for a *fresh* budget is too large, full stop.** Split it at a
resource boundary rather than starting work that will need compacting halfway through
regardless. Splitting is the cheaper instrument, and it should be reached for first.

**When capacity forces a compaction of live context**, the handoff carries the extra weight:
name the concrete things that would otherwise be lost — file paths, the fixture pattern being
copied, the decision just made — because that is exactly the material a summary flattens.

### Compaction is not free, so the default is not to recommend

A compaction at the wrong moment costs a re-derivation of everything the summary drops, paid
in full at the start of the next slice. A conversation carrying some inert history costs
almost nothing. **When the two are close, say nothing and keep implementing** — the asymmetry
is the whole reason the default is silence.

### State the evidence, not the feeling

A recommendation names three things, or it is not made:

1. **what is spent**, and where it is now recorded durably;
2. **what the next slice needs**, concretely;
3. **whether that need survives a summary** — the part that decides it.

"The conversation is long" is none of these.

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
