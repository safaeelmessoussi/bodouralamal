[Documentation](README.md) › **SRS Proposal — Revision 127**

# SRS Proposal — Revision 127

**Save-and-resume is the only assessment response policy. `single_submission`,
declared since the initial schema and never implemented, is withdrawn.**

**Status: RATIFIED by the Document Owner, 2026-09-03 — AWAITING APPLICATION to
`SRS.md`.** The removal is implemented, migrated and tested; the clauses below
are the exact text the Document Owner applies. Until they are applied, `SRS.md`
describes a policy the platform no longer has a column for, and §17 continues to
contradict R124.

---

## 1 · The contradiction this revision resolves

R124's ratified §4.6 states, **unconditionally**:

> *"A student saves an incomplete draft and returns to it."*

§17 line 1322 states:

> *"`single_submission` exams skip resume: the first submit is final."*

Both were in force. The Owner has resolved it in favour of R124: **SAVE ≠
SUBMIT**, a student may save an incomplete response and return later, and Final
Submit is explicit and final. There is one response policy in v1.

## 2 · The measured state of the withdrawn field

`exam.access_policy` has existed since `20260724194811_init_schema`, `NOT NULL
DEFAULT 'save_and_resume'`, as part of R56/R58's online-exam design — the same
family of decisions in which `online` mode was **declared and then refused**.
Audited at `652ce3f`:

| surface | finding |
|---|---|
| writers | one — the development seed fixture |
| readers | one — `accessPolicy: true` in `ASSESSMENT_SELECT`, **selected and never branched on** |
| write boundaries | none: not create, not update, not the R124 builder |
| error path | `SINGLE_SUBMISSION_FINAL` in the catalogue with **no thrower**, for its whole life |
| UI | none — no control, no display, no translation key |
| guards | a frontend test pinned it **off** the wire |

R124's own drafting record calls `access_policy` one of four things that were
*"dormant and are now used"*. That sentence was true of the other three and is
**not true of this one**; this revision corrects it.

**An unused capability is still a capability** (R111 clause 2). An empty
alternative is a declared behaviour that a future maintainer implements by
guessing its semantics from the enum name. §18 made it worse by listing
*"single_submission vs save_and_resume enforced"* as an **acceptance criterion**
for behaviour that has never existed, so §18 could not be satisfied by any
implementation.

## 3 · Proposed removals from `SRS.md`

Six current normative references claim the policy exists. All six are withdrawn:

1. **§4.6, line 890** — *"**Access Policy:** `single_submission` vs
   `save_and_resume`, per exam, changeable on the fly."* → **deleted.**
2. **§7, line 1159** — the `Exam` entity's *"access policy
   (`single_submission | save_and_resume`)"* → **deleted from the field list.**
3. **§17, line 1322** — *"`single_submission` exams skip resume: the first
   submit is final."* → **deleted.** This is the half of the contradiction that
   loses.
4. **TD-3, line 1659** — *"`PATCH /submissions/{id}` → save-and-resume answer
   patch (rejected for `single_submission`)"* → the parenthesis is **deleted**;
   the route and its semantics are unchanged.
5. **§17 flow, line 2547** — *"(save_and_resume: PATCH loops; single_submission:
   one final submit)"* → replaced by *"(save and resume until Final Submit,
   which is explicit and final)"*.
6. **§18, line 2648** — the acceptance item *"single_submission vs
   save_and_resume enforced"* → replaced by *"a saved response remains resumable;
   Save does not Submit; a submitted response is final"*, which are the three
   properties actually built and tested.

**TD-3.8's catalogue loses `SINGLE_SUBMISSION_FINAL`**, on the same reasoning
that retired `CAPACITY_FULL` under R43: *an unraisable code invites somebody to
find a use for it*. Both retirements are now pinned by name in
`errors.test.ts`, so a re-addition is a deliberate revision rather than an
accident.

**Historical revision text is NOT edited.** §0's R56, R58 and R124 clauses record
what was decided and when; the field's withdrawal is stated as this revision's
own clause, exactly as R126 handled R59's expired rationale.

## 4 · Schema and migration

`exam.access_policy` and the `exam_access_policy` enum type are dropped by
`20260904100000_drop_exam_access_policy`, a TD-6b **contract-phase** migration
with no expand and no migrate step — deliberately, because the decision is that
a second policy does not exist, and a transitional column would preserve exactly
the capability being withdrawn.

**The migration refuses rather than assumes.** Every row carries a value here, so
*"is the column empty"* is not the question it was for `user.notes`. The question
is whether anybody ever recorded the **withdrawn** intention: the migration
counts rows reading `single_submission`, refuses with that count if any exist,
and lets the default value through without comment — a default is what every row
got for free, not a decision somebody made.

Verified read-only before the migration was written: **Localhost — 1 exam,
1 `save_and_resume`, 0 `single_submission`.** Staging was not queried in this
session and Production is not deployed; the guard is what makes the check
authoritative wherever the migration runs. Both directions were then proved:
`migrate deploy` against the **existing** local database, and the **full chain
against a fresh disposable database** — after each, neither the column nor the
type exists.

## 5 · Deliberately unchanged

* **The submission lifecycle** — `SubmissionState` and every transition in it.
* **`PATCH /submissions/{id}`** and every other route; TD-3 loses a parenthesis,
  not an endpoint.
* **R124's freeze rule** — the first student submission still freezes the paper,
  and there is still no staff reopen, reset or resubmit action in v1.
* **`student_exam_submission.state`, `submitted_at`** and the immutability of a
  submitted answer.
* **Auto-scoring**, which stays postponed; nothing here implements it.
* **The initial migration**, which is not rewritten. The column's history stays
  in the chain where it happened.
