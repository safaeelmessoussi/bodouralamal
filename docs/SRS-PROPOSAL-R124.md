[Documentation](README.md) › **SRS Proposal — Revision 124**

# SRS Proposal — Revision 124

**The online assessment builder. §4.6's *"digital exams"* stop being a promise,
and `exam.mode = 'online'` stops being refused.**

**Status: APPLIED — ratified by the Document Owner as SRS Revision 124, 2026-09-04.** Kept as the drafting record; **`SRS.md` §0 and the sections it amends are now authoritative**. The code/specification conflict this document reported is closed: §4.7 and §4.6 describe what is built, and §20 rule 16 no longer names it among the postponed features.

---

## 1 · What was already specified, and what changed

R58 wrote the design and then switched it off:

> *"`physical` carries a place and staff and no questions; **`online` will carry
> questions and no place**. Each mode's columns are exactly the ones its own
> reality has… **`online` is refused here, loudly**."*

So this revision does not introduce an assessment domain — it **builds the half
R58 declared**. Four things were dormant and are now used: `exam.mode = online`,
`exam.access_policy`, `student_exam_submission.state`, and the online branch of
`exam_online_has_no_room_check`.

**No second assessment entity was created.** `Grade` is keyed
`(exam_id, student_id)` and already carries the 20-point scale, the
draft/published split, the grade sheet, the student's results screen and the
parent visibility rule. A parallel `Assessment` table would have forked all five.

## 2 · Proposed additions to §4.6

> **An assessment is an `Exam` in `online` mode.** It carries a paper —
> questions in explicit order — and no place. A **formal online exam** and a
> **quick test attached to one class** are the same paper with a different
> target; there is no second builder, no second table and no second grading
> path.
>
> **Four question kinds and no fifth in v1**: `short_text`, `long_text`,
> `single_choice`, `multiple_choice`. A choice question may ask for a
> justification — `none`, `optional` or `required` — and **a text question may
> not**, because a text answer is its own justification.
>
> **Explicitly excluded from v1**, so a later revision adds them deliberately
> rather than by drift: branching, file-upload answers, images, rich text,
> mathematical notation, timers, proctoring, geolocation, random pools, random
> option order, negative marking, automatic scoring, plagiarism detection and
> analytics.
>
> **Five targets**, one resolver (§4.4c): a Level · an Administrative Group · a
> **Session** · a Teaching Group · **one named beneficiary**. The Level stays
> required on every arm — it is what the paper is written for.
>
> **Eligibility is derived; a submission is a fact.** Nobody is copied into an
> assignment table (§20 rule 22). *Who may start now* resolves from live
> enrolment against the `AcademicPeriod` covering **the assessment's own date**
> (R122); *who answered* is a row that no later enrolment change touches. A
> beneficiary who leaves the Level keeps her submission and loses the ability to
> start a new one.
>
> **Lifecycle: `draft` → `published` → `closed`.** A draft is invisible to
> students and answers `404` — indistinguishable from one they are not eligible
> for (§20 rule 17). An **empty paper cannot be published**. Closing stops new
> answers and hides nothing.
>
> **The paper freezes on the first submission.** No question may be added,
> edited, removed or reordered once anybody has submitted. This is the simplest
> safe rule and is why no versioning scheme exists: a question whose wording,
> order or options changed after an answer was given makes that answer mean
> something the student never said.
>
> **SAVE is not SUBMIT.** A student saves an incomplete draft and returns to it;
> submitting is final for her and requires confirmation. **Nothing autosaves and
> nothing autosubmits.** Reopening a submission is not in v1.
>
> **Grading is manual and is the existing `Grade`** — the 20-point display scale
> and the passing basis in `SystemSetting` are unchanged, and **no second scale
> exists**. Publishing the assessment and publishing the grade are separate
> acts, and an unpublished grade is invisible to student and parent alike.
>
> **A student's answer never leaves the surfaces that need it.** It is not
> copied into `AuditLog`, `Trash`, a notification or a log line. Question text
> and option labels are treated the same way.

## 3 · Proposed §7 additions

* **`ExamQuestion`** — `exam_id`, `display_order`, `kind`, `prompt`,
  `justification`, TD-15 `version`, soft-delete columns.
* **`ExamQuestionOption`** — `question_id`, `display_order`, `label`.
* **`StudentExamAnswer`** — `submission_id`, `question_id`, `text?`,
  `justification?`; unique per `(submission, question)`.
* **`StudentExamAnswerOption`** — the join that makes *«she chose the second
  option»* survive that option being reworded.
* **`Exam`** gains `status`, `closed_at`, `target_kind`, `session_id`,
  `teaching_group_id`, `student_id`; **loses `questions`** and `is_published`.
* **`StudentExamSubmission`** loses `answers`.

**Both `jsonb` columns were snapshotted into `Trash` before being dropped.** They
could not express three things this revision requires: stable explicit ordering,
an answer that references the option it chose, and a database that refuses to
delete an answered question.

## 4 · What the Owner is being asked to decide

1. **Ratify** the §4.6 additions and the §7 entities.
2. **Confirm the freeze rule.** *Frozen on the first submission* is deliberately
   the blunt instrument. The alternative — versioning questions so a paper can
   be edited while old answers keep their old wording — is real engineering
   nobody has asked for, and can be added later without changing what is stored.
3. **Confirm that no reopen action is wanted in v1.** A student cannot resubmit,
   and no staff route reopens a submission. If the association needs one, it is
   an explicit act with its own audit row, not a relaxation of this one.

---

**Related:** [`SRS.md`](SRS.md) §4.6, §7 · [Database](architecture/database.md) ·
[API endpoints](reference/api-endpoints.md) ·
[Personal-data audit](compliance/personal-data-audit.md)
