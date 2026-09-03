[Documentation](README.md) › **SRS Proposal — Revision 126**

# SRS Proposal — Revision 126

**Student educational evidence forbids deleting an assessment. Publication does
not, and attendance does not.**

**Status: APPLIED — ratified by the Document Owner and applied to `SRS.md` as SRS Revision 126, 2026-09-03.** Kept as the drafting record; **`SRS.md` is now authoritative**. §0 and §4.6 carry the deletion rule and the correction of R59 clause (3); §0's historical R59 sentence is retained as the record of what was decided then. The behaviour is implemented and tested; the clauses below are the
exact text the Document Owner applies. Until they are applied, `SRS.md` §0's
R59 clause (3) states a rationale that R123 and R124 made false, and §4.6
describes a deletion that is now refused in one named case.

---

## 1 · The measured finding this revision answers

`DELETE /exams/{id}` is a **soft** delete — an `UPDATE` that sets `deleted_at`.
Six foreign keys reference `exam`, and every one of them is protective:

| referencing table | column | on delete | added by |
|---|---|---|---|
| `attendance` | `exam_id` | `RESTRICT` | R123 |
| `exam_question` | `exam_id` | `RESTRICT` | R124 |
| `grade` | `exam_id` | `RESTRICT` | initial schema |
| `notification` | `exam_id` | `RESTRICT` | R116 |
| `student_exam_submission` | `exam_id` | `RESTRICT` | R124 |
| `exam_staff` | `exam_id` | `NO ACTION` | initial schema |

`student_exam_answer` and `exam_question_option` reference the exam indirectly,
through `student_exam_submission` and `exam_question` respectively.

**Because the deletion is an `UPDATE`, not one of those constraints ever fired.**
Nine materially different situations therefore behaved identically — a bare
draft, a published sitting nobody sat, a saved student draft, a final
submission, a draft mark, a published mark, an attended sitting, a paper with
questions and a paper with answers. All nine were tombstoned by the same click,
and every reader's `deleted_at IS NULL` filter then withdrew the paper, the
marks and the register together. `readPublishedGrades` hides a soft-deleted
exam's marks **deliberately** — *"the sitting was withdrawn (R59), and the mark
went with it"* — which is right for a cancelled sitting and wrong for a
delivered one, and nothing in the code told the two apart.

## 2 · Proposed addition to §4.6

> **An assessment that has generated student educational history is not
> deletable.** Deletion is refused when **any `StudentExamSubmission` exists in
> any state**, or **any `Grade` exists in any status**. Either alone is
> sufficient. The refusal is a `STATE_CONFLICT` carrying
> `reason: STUDENT_EVIDENCE_EXISTS` and **the two counts and nothing else** — a
> number makes the refusal actionable, while a name would put a beneficiary into
> an error message (TD-14).
>
> **State does not soften the rule.** An `in_progress` submission is work
> somebody did, and a `draft` Grade is a mark somebody awarded. Neither table
> carries `deleted_at`, so the question is a plain count.
>
> **PUBLICATION ALONE DOES NOT BLOCK.** Publishing an assessment creates no
> student record; a published paper nobody sat is still a plan. This is R118
> clause (1)'s rule for schedules — *a schedule nobody ever taught is a plan;
> one materialized Session makes it permanent* — applied to the same shape of
> question, with a submission or a Grade in the place of the Session.
>
> **ATTENDANCE ALONE DOES NOT BLOCK.** R123 makes attendance an independent fact
> about the **occurrence**, not a record of achievement, and the three are
> deliberately separate: *exam attendance ≠ exam submission ≠ exam grade*.
> Blocking on it would make a cancelled sitting undeletable because one person
> was marked present at it — the exact case deletion exists for. Attendance rows
> survive the tombstone unchanged and keep protecting the row against a
> permanent purge.
>
> **No `cancelled` state is introduced.** The lifecycle stays
> `draft → published → closed`, with soft deletion beside it.
>
> **Grade visibility is unchanged by this revision.** Whether a withdrawn
> sitting's published marks should remain visible to a beneficiary is a separate
> question and is not decided here.

## 3 · Proposed correction to §0's Revision 59, clause (3)

R59's clause (3) admitted `Exam` to the restorable set on this reasoning:

> *"`Exam` joins the restorable set — its deletion cascades to exactly one child
> table, `ExamStaff`, whose reinstatement is a single well-defined statement, so
> it meets the existing written and tested standard."*

That was true in July 2026 and is **false now**: R123 attached `attendance`, and
R124 attached `exam_question`, `exam_question_option`,
`student_exam_submission` and `student_exam_answer`. Neither revision reopened
the clause.

**The historical sentence is not rewritten** — §0 records what was decided, when,
and on what basis, and editing it would erase the fact that the premise later
changed. The correction is stated **as this revision's own clause**, and it is
the current normative reasoning:

> **Restorability is now true for a narrower row, and for a better reason.**
> `Exam` remains restorable, but the class of deletable exams is exactly those
> carrying **no student evidence** — and for such a row the deletion still
> cascades to `ExamStaff` alone, so R59's *written and tested* standard is met in
> fact rather than by an assumption that has since expired. Questions and options
> may exist on a deletable exam and are **not** part of the cascade: they are
> left pointing at the tombstone, are restored with it, and their `RESTRICT`
> foreign keys are what stop a **permanent purge** from destroying them —
> `purgeEntry` turns PostgreSQL's refusal into `DEPENDENTS_EXIST`, which is the
> designed behaviour and is unchanged.

## 4 · Proposed correction to §18

§18's acceptance list gains one line:

> *An assessment holding a student submission or a Grade cannot be deleted; one
> holding only attendance, only questions, or only a publication can.*

## 5 · Deliberately unchanged

* **TD-2** — deletion authority stays Admin and above (R70.4). The guard refuses
  a **capability against a row**, never a role, so a Super Admin meets exactly
  the same refusal; evidence is not a permission.
* **TD-3** — no route is added, removed or renamed.
* **TD-5 / BR-15** — soft delete, the Trash snapshot, the 90-day window and the
  restore plan are untouched.
* **TD-8** — `exam.delete` is unchanged; a refused deletion writes **no** audit
  row, because none happened.
* **§20 rule 11** — a destructive path still writes Trash and AuditLog. A
  refusal is not a destructive path.
* **R116** — the cancellation notification is unchanged, and now fires only when
  a deletion actually occurs: the guard is the first statement in the
  transaction, so a refusal rolls back before it.
* **R59.4** — the quarantine-destruction question stays open and is not
  authorised by anything here.
* The `Grade` visibility rule of `readPublishedGrades`, in every particular.
