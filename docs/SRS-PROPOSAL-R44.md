[Documentation](README.md) › **SRS proposal — Revision 44**

# Draft SRS Revision 44 — the completion report

> **Status: PROPOSED. Not in force.** `docs/SRS.md` is immutable to implementing agents;
> this file is a drafted revision for the **Document Owner** to apply, amend or reject.
> **Delete it once that decision is made** — a proposal that outlives its decision becomes a
> second specification.
>
> Nothing in `docs/SRS.md` has been changed. The handbook changes that accompany this draft
> are compatible with §16.3 **as it stands today** and are already in force.

---

## The question asked

*Reduce reporting overhead without losing information needed for project continuity,
discovered knowledge, verification traceability, or future implementation. Adopt a
five-section format if it is better; refine the six if it is not.*

## The conclusion: keep six, and change what four of them are for

**A five-section format was drafted and rejected.** The measurement is simple: once
[the compact discipline](development/README.md#write-them-compactly) is applied, an empty
section costs **one word** and a full one costs three to five bullets. The floor for a
six-section report is ~15 lines. Merging two headings saves ~2. **The section count is not
where the cost is** — and it is the only thing a merge addresses, while it does cost two of
the obligations §16.3 pinned deliberately.

The cost is in two places the count does not touch:

1. **Duplication with `docs/CHANGES.log`.** Both narrate the same slice, so the rationale gets
   written twice. This is the larger of the two, and it is a
   [one-authoritative-home](development/engineering-constitution.md#12--one-authoritative-home-per-concept)
   violation that happens to be invisible because one of the two copies is a chat message.
2. **Sections that restate what the commit already shows** — a file list, a diff narrated in
   prose.

So the revision does not renumber anything. It **changes what the sections are for**, under
one governing test:

> **Every section must answer a question the commit and the ledger cannot answer.**
> A section that can be reconstructed from `git show` is overhead wearing a heading.

And one governing fact, which is what makes the rest follow:

> **A completion report is ephemeral. `CHANGES.log` and the handbook are durable.**
> A report is read once and lost at the next compaction. **Therefore no fact of lasting value
> may exist only in a report** — it is recorded where it lasts, and the report points at it.

That single sentence removes more volume than any merge, because it converts the longest part
of every report — the rationale — from *prose* into *a pointer*.

### What was rejected, and why

| Rejected | Why |
|---|---|
| **Five sections** (Completed · Verification · New findings · Next slice · Compact recommendation) | Makes *additional defects* omittable and narrows *remaining work* to a single next target. §16.3 pinned both for stated reasons: the first is where §16.4's "discovered knowledge is paid immediately" becomes visible instead of buried in a diff; the second is what keeps a scope reduction the Owner's decision rather than an implementer's silence. Saves ~2 lines and costs both. |
| **Merging *user-visible* into *engineering highlights*** | The jargon-free section is what makes a report decidable in five seconds by a reader who is not mid-implementation. §16.3's own rationale — *the Document Owner reads reports to decide* — is an argument for keeping the two audiences separate. It costs one heading. |
| **Dropping *documentation updates*** | The strongest merge candidate, and still wrong: it is a forcing function at the moment of writing, and documentation drift is this project's most recurring defect class. Redefined instead — see below. |
| **A "compact recommendation" section** | It is advice about the conversation, not about the work, and it is needed only at a slice boundary. It belongs in the closing line where it already lives, not in a heading that would read *"None"* on most reports. |

---

## Exact wording to apply

Three edits. Nothing else in `docs/SRS.md` is touched.

### 1. Header status line (line 4)

Replace the parenthetical:

> **Status:** Final MVP Blueprint (Revision 44 — the completion report is ephemeral: it
> surfaces and points, while `CHANGES.log` and the handbook hold what lasts), **immutable
> source of truth** — changed only by an explicit Document Owner revision, never by an
> implementing agent

**Revision date:** 2026-08-04

### 2. New entry in §0, after Revision 43.6

> **Revision 44 (Document Owner decision — the completion report is ephemeral, and its length
> is not normative, 2026-08-04):** Revision 37.2 pinned the six-section structure so it would
> survive a rewrite of `CLAUDE.md`. It pinned the *structure* and said nothing about the
> *substance*, and the gap filled itself the way gaps do: reports grew into full narratives
> that restated `docs/CHANGES.log`, narrated diffs the reader could open, and re-explained
> conventions settled several sessions earlier. **The structure was never the cost.** An empty
> section costs one word; the cost is a rationale written twice — once where it lasts and once
> where it does not.
>
> **A completion report is ephemeral. `docs/CHANGES.log` and the handbook are durable.** A
> report is read once and is gone at the next context compaction, so **no fact of lasting
> value may exist only in a report.** Discovered knowledge, design decisions and constraints
> are recorded where they last — the ledger, the handbook, the code — and **the report points
> at them**. This is §16.4's own rule applied to the report itself: a report is not a place
> where knowledge is *stored*, it is where knowledge is *surfaced* so the Document Owner can
> act on it.
>
> **The six sections remain, in the same order, for the reasons Revision 37.2 gave.** A
> five-section format was considered and **rejected**: it made *additional defects discovered*
> omittable and narrowed *remaining work* to a single next target, which defeats the two
> obligations this document pins them for, in exchange for roughly two lines. **What changes
> is what four of the sections are for**, under one test — **every section must answer a
> question the commit and the ledger cannot answer.** A section reconstructible from
> `git show` is overhead wearing a heading.
>
> - **User-visible changes** — unchanged, and the reason is unchanged: it is what makes a
>   report decidable by a reader who is not mid-implementation.
> - **Engineering highlights** — **decisions, not description.** A trade-off, a rejected
>   alternative, a constraint discovered. Never a convention already settled, and never a
>   restatement of the ledger entry for the same slice.
> - **Documentation updates** — **which document now owns what was learned**, not a list of
>   files. The file list is in the commit; the *ownership* is the thing §16.4 cares about and
>   the thing a reader cannot reconstruct.
> - **Additional defects discovered** — unchanged in obligation, and it now **names where the
>   knowledge was recorded**, since §16.4 requires it to be recorded and the report is what
>   makes that checkable.
> - **Verification** — what was **actually run**, and a *skipped* check named only where the
>   reason is non-obvious. This is the traceability half: a report that omits what was not run
>   is indistinguishable from one where everything was.
> - **Remaining work** — **leads with the single highest-value next target**, then lists
>   everything else still open. The lead gives direction; **the remainder is what keeps a
>   scope reduction the Document Owner's decision**, and it is not optional.
>
> **Length is not normative and never was.** It is stated here only because leaving it unsaid
> is what produced the drift: an agent optimising for compliance will write more when the
> document is silent about less. The compact discipline — bullets over paragraphs, three to
> five per section, one word for an empty section, no narration of a readable diff — belongs
> to the handbook (`docs/development/README.md`) along with the wording and the rationale, and
> is governed by `docs/development/engineering-efficiency.md`.

### 3. §16.3 — replace the *completion-report structure* bullet

**File 1 (`/CLAUDE.md`)** — replace the existing bullet with:

> * **the completion-report structure** *(Revision 37.2, refined by Revision 44)* — six
>   sections, in order: **user-visible changes · engineering highlights · documentation
>   updates · additional defects discovered · verification · remaining work**. Pinned here for
>   durability, exactly as the read-first step above is: the *structure* is normative because
>   the Document Owner reads reports to decide, and two of its sections carry obligations this
>   document already imposes — **additional defects** is where §16.4's "discovered knowledge
>   is paid immediately" becomes visible instead of buried in a diff, and **remaining work** is
>   what keeps a scope reduction the Document Owner's decision rather than an implementer's
>   silence. **The report is ephemeral and the ledger is not, so no fact of lasting value may
>   exist only in a report** *(Revision 44)*: it is recorded where it lasts and the report
>   points at it. **Every section answers a question the commit and the ledger cannot answer**;
>   one that does not is overhead. **Length is not normative.** The wording, the per-section
>   guidance, the compact discipline and the rationale belong to the handbook
>   (`docs/development/README.md`).

**File 2 (`/AGENTS.md`)** — replace with:

> * **the completion-report structure** *(Revision 37.2, refined by Revision 44)* — the same
>   six sections, since an agent that never reads `CLAUDE.md` would otherwise report in its own
>   shape; **and that the report points at durable records rather than restating them, since
>   its own content does not survive the session.**

---

## Consistency check

| Touched | Effect |
|---|---|
| §0 | One new entry; no existing entry altered |
| §16.3 | Two bullets replaced; the mandatory-contents lists keep every other item |
| §16.4 | **Unchanged** — Revision 44 *applies* it to the report rather than amending it |
| §20 | **Unchanged** |
| Section count, names, order | **Unchanged** — no downstream document renumbers |

### What is already in force, and what this revision actually buys

**§16.3 as it stands today already delegates *"the wording, the per-section guidance and the
rationale"* to the handbook.** So the four redefinitions, the ephemerality rule and the
compact discipline were applied **without waiting** — they are within the handbook's existing
authority and are live now:
[*Reporting completion*](development/README.md#reporting-completion),
[*The report is ephemeral; the ledger is not*](development/README.md#the-report-is-ephemeral-the-ledger-is-not),
[*Write them compactly*](development/README.md#write-them-compactly),
[*Reporting is spent from the same budget*](development/engineering-efficiency.md).

**What the revision buys is durability, not behaviour** — which is exactly what Revisions 37.1
and 37.2 bought, and for the same reason. Handbook guidance survives until someone rewrites
the handbook. A pin in §16.3 survives a rewrite of `CLAUDE.md`, `AGENTS.md` and the handbook
together. The two rules worth that protection are:

- **the report is ephemeral, so no fact of lasting value may live only in it**, and
- **length is not normative** — stated because silence is what produced the drift.

**If the revision is rejected, nothing regresses.** The guidance stays in the handbook and
stays in force; it is simply not protected against a future rewrite. That is the whole
decision.

---

**Related:** [Reporting completion](development/README.md#reporting-completion),
[Engineering efficiency](development/engineering-efficiency.md),
[Documentation policy](development/documentation-policy.md)
