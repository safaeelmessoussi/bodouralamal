[Documentation](../README.md) › **Exams & assessment — audit and proposal**

# Exams / Assessments — current-state audit and proposed model

**Status: implemented, and its grading half SUPERSEDED by SRS Revision 81
(2026-08-19).** The exam model and grade entry shipped with R58 and R70. Every
statement below about `grading.display_scale`, `grading.passing_grade_bp`,
basis-point storage and pass/fail describes **the model as it was**: the maximum
grade is now a required column on `Exam`, scores are stored as `NUMERIC(6,2)` on
that scale, and the MVP derives no pass/fail at all. The document is kept as the
record of the analysis that led there — see §4.6 and Revision 81 in the SRS for
what is in force.

Requested before M4 (Quran Progress): audit the platform for an assessment
capability, then propose the smallest coherent model for in-school exams with
grade entry, and show how remote exams land on the same foundation later.

---

## The headline, before the detail

**The model you asked me to propose already exists, and most of it is already
built.** §4.6 specifies exams and grading; Revision 58 rebuilt the exam half
around physical sittings; the schema carries `Exam`, `Grade`, `ExamStaff` and
`StudentExamSubmission` with their five enums; and the exam CRUD, its
validators, its authorization and its UI all shipped.

**What does not exist is grade entry.** `Grade` is a table with no service, no
controller, no route, no adapter and no screen. That single gap is the whole of
your requirement 1, and it is what §19.2 calls M5.

**Your requirement 3 — retroactive recording — needs nothing at all.** There is
no past-date restriction anywhere: not in the Zod validator, not in the service,
not in the form. R58 states that an exam *"requires no Course Schedule and no
term boundary to exist"*. Recording an exam that already happened **is** creating
an exam with a past date, today, in the existing screen.

I therefore recommend **no new entity**, and I flag one modelling question you
raised that the SRS has already answered in the opposite direction — with a
stated reason worth re-reading before you overrule it (§4, *assessment versus
occurrence*).

---

## 1 — Current-state audit

### 1.1 What is specified

| Concept | Where | State |
|---|---|---|
| Exams & grading | SRS **§4.6** | Specified in full |
| Physical sittings | **Revision 58** | Specified; supersedes "digital only" |
| Grade entity | **§7**, `Grade` | Specified |
| Absent-zero semantics | **BR-7** (§4.6) | Specified |
| Draft/Publish | **BR-8** | Specified |
| Manual pass/fail override wins | **BR-12** | Specified |
| Scale /20, pass 10/20 | **Revision 14**, §4.6, §15.1 | Specified as `SystemSetting` |
| bp arithmetic, no floats | **Revision 8**, §20 rule 3 | Specified |
| Weight templates, averages | **§10.1** (Revision 12) | **Deliberately post-MVP** |
| Permission row | **TD-2** | Specified — see §3, gap A |
| Audit rows | **TD-8** | Partial — see §3, gap G |

### 1.2 What is built

| Layer | Exam | Grade |
|---|---|---|
| Schema | `Exam`, `ExamStaff`, `StudentExamSubmission` | `Grade` |
| Migration | applied | applied |
| Service | `exam.service.ts` — create / update / delete / list | **none** |
| Controller | `exam.controller.ts` | **none** |
| Routes | `GET POST /exams`, `PATCH DELETE /exams/:id` | **none** |
| Validators | `exam.validators.ts` | **none** |
| Adapter | `frontend/src/adapters/exams.ts` | **none** |
| UI | `/admin/schedules`, type `امتحان` | **none** |
| Tests | `exam.http.integration.test.ts`, `scheduling-exam.test.tsx` | **none** |

`/teacher/exams` exists as a **navigation node that is deliberately blocked**,
with the reason string «يتطلب هذا القسم واجهات بناء الامتحانات وتصحيحها (المرحلة
الخامسة)، وهي غير متوفرة بعد.» — §14.4's pattern for a declared, unbuilt
capability.

### 1.3 The grading scale

`grading.display_scale = 20` and `grading.passing_grade_bp = 5000` are
`SystemSetting` **rows**, not columns — §7 forbids a passing-grade column on
`Level` or `Category`, and Revision 14 fixed both values. Storage is basis points
(0–10,000); the /20 conversion happens **at render time only**.

`setting.service.ts` exposes `listSettings` and `updateSetting` — there is no
typed single-key read, which grade display and the pass/fail comparison both
need (§3, gap D).

### 1.4 Calendar, scheduling, and how an exam already fits

R56 made `/admin/schedules` one screen whose **type is a field**: `حصة` →
`RecurringCourseSchedule`, `نشاط` → `Event`, `امتحان` → `Exam`. R58 put a
physical exam in the shared calendar as `kind: 'exam'` with its own colour.

**An exam produces no Sessions.** It is one dated occurrence, not a recurrence
rule, so it takes no part in materialization, the R50 split, or session conflict
detection. That is a deliberate boundary (§20 rule 22) and it holds.

### 1.5 Level → Subject, Circles, and who sits a paper

`Exam` carries `level_id` (required) and `subject_id`, and creation asserts the
pair through the **shared** `assertSubjectTaughtAtLevel` policy — the same one
scheduling, circles and content use (R55).

**Teaching Circles are deliberately not part of the exam audience.** R58 is
explicit: *"the §4.4c three-mode target is not reused: an exam is sat by a roster
at a premises and the Teaching Group split has no bearing on who sits a paper"*.
The audience is instead:

* `administrative_group_id = NULL` → **the whole Level** at the exam's branch;
* `administrative_group_id` set → that one group, validated to be of this Level
  and at this branch.

An unsplit Subject therefore raises no special case: the split never entered the
question.

### 1.6 Enrolments

R66 moved `branch_id` onto `Enrollment` and made `administrative_group_id`
nullable. Consequences that matter here, both already settled:

* the exam's whole-Level audience resolves by `Enrollment.branch_id`, which
  answers correctly for ungrouped students;
* **`Grade.administrative_group_id` is already nullable and R66 says it stays
  so** — a student who sat an exam while in no group has no group to record, and
  inventing one would be a fabricated record.

### 1.7 Authorization as built

`exam.service.ts` requires **admin or super_admin**, branch-scoped through
`assertCanActOnBranch`. Teachers cannot create, update or delete an exam today.
See §3, gap A — this conflicts with TD-2 as written.

---

## 2 — Relevant SRS sections and existing entities

**Sections:** §4.6 (grading & exam engine) · §4.4/§4.4c (scheduling, teaching
modes) · §5.6, §14.1, §14.2 (navigation and screens) · §7 (entities) · §10.1
(postponed template engine) · §15.1 (settings) · §19.2 (milestones) · §20 rules
3, 16, 22.

**Revisions in force:** R8 (bp) · R10 (absent-zero timing, sitting provenance) ·
R12 (template engine postponed) · R14 (scale /20) · R43 (educational model,
provenance = Administrative Group) · R56 (one scheduling screen) · **R58 (exam
mode + physical sitting)** · R59 (Exam joins the restorable set; `ExamStaff`
tombstoned not hard-deleted) · R66 (enrolment branch, optional group).

**Rules:** BR-7 (absent-zero) · BR-8 (draft until published) · BR-10
(certificate snapshot, post-MVP) · BR-11 (level completion) · BR-12 (override
wins) · TD-1 (grade lifecycle draft→published) · TD-8 (audit) · TD-15
(optimistic locking).

**Services to reuse, not re-derive:** `exam.service.ts` ·
`policies/curriculum.ts` (`assertSubjectTaughtAtLevel`) ·
`policies/branch-scope.ts` · `enrollment.service.ts` (audience resolution) ·
`setting.service.ts` · `repositories/audit.repository.ts` ·
`repositories/trash.repository.ts`.

---

## 3 — Gaps and conflicts

| # | Finding | Severity | Needs |
|---|---|---|---|
| **A** | **TD-2 grants Teachers "Author exams; publish/re-publish grades" ✔ (own students, §4.4c); the code refuses a Teacher any exam write.** The matrix row conflates two acts — authoring an online paper, and booking a room for a sitting. | **Owner decision** | see §5 |
| **B** | **BR-7 says the absent-zero rows cover "every student on the Group roster".** Under R66 a Level may have no group, and R58's audience may be the whole Level. The rule's wording predates both. | **SRS wording** | small clause |
| **C** | No read resolves *students of a Level at a branch*. `listGroupRoster` is group-only; whole-Level audience logic exists inside `course-schedule.service.ts`/`enrollment.service.ts` for `entire_level`. | Implementation | reuse, don't invent |
| **D** | No typed single-setting read. Grade display and pass/fail both need `grading.display_scale` and `grading.passing_grade_bp`. | Implementation | small helper |
| **E** | **TD-8 has `grade.publish`, `grade.republish`, `grade.passfail_override` — but no row for entering or amending a mark.** Grade entry would write no audit row. | **SRS gap** | small clause |
| **F** | §14.1 puts authoring/grading at `/teacher/exams`, while R56/R58 put exam *scheduling* at `/admin/schedules`. **No admin-side grading node exists** — `/admin/grading` is reserved for the post-MVP template engine (§10.1). An Admin has nowhere to enter a grade. | **SRS gap** | navigation clause |
| **G** | TD-3's error catalogue has no codes for grade entry. | Implementation | reuse existing shapes |
| **H** | `Grade` is not in the restorable/purgeable set (R59 admitted only `Exam`). | Note only | no action in MVP |

**Not gaps** — verified and already correct:

* grades cannot exist without an exam: `Grade.exam_id` is NOT NULL,
  `onDelete: Restrict`, `@@unique([exam_id, student_id])`;
* retroactive exams: no past-date restriction exists at any layer;
* provenance for ungrouped students: nullable by R66's explicit decision;
* Level↔Subject validation: already shared through one policy.

---

## 4 — Recommended domain model

### **No new entity. No new column. No migration.**

```
Exam                       (exists — §4.6, R58)
 ├─ mode: physical | online          the discriminator
 ├─ level_id (req) · subject_id · academic_year_id
 ├─ date · start_time · end_time     wall-clock, TD-11
 ├─ branch_id · room_id              physical only
 ├─ administrative_group_id NULL = the whole Level
 ├─ ExamStaff[]                      supervisor + assistants
 └─ Grade[]                          ← the half to build
        ├─ student_id
        ├─ administrative_group_id   sitting provenance, nullable (R66)
        ├─ value_bp 0..10000         integer only (§20 rule 3)
        ├─ absent                    BR-7
        ├─ status draft | published  BR-8, TD-1
        ├─ manual_pass_fail_override + actor + timestamp + reason (BR-12)
        └─ version                   TD-15
```

### Assessment versus occurrence — the question you raised

You asked me to separate the academic assessment from its occurrence *if the
architecture supports it cleanly*. **It does not, and that was a decision rather
than an omission.** R58:

> **One entity rather than `Exam` + `ExamSitting`**, because a physical exam's
> paper is not in the platform at all — the row *is* the sitting, and there is no
> second fact to separate.

I agree with it for in-school exams, and the test is concrete: **a second entity
earns its place only when one assessment can have many occurrences.** For a
physical sitting it cannot — the paper is sat once, at one place, in one window.
Splitting now would create a table with a permanent 1:1 relationship, and every
read would carry a join that answers nothing.

**The split becomes justified exactly when remote exams arrive** — see §10, where
I show the migration is additive and does not touch `Grade`.

### Why `Grade` needs no change for retroactive recording

A grade is keyed on `(exam_id, student_id)` and knows nothing about *when* the
exam was created relative to its date. A retroactively recorded exam is an
ordinary exam. **Introducing a flag to mark one would be recording our own
workflow as if it were a fact about the association's teaching.**

---

## 5 — Authorization model

### The conflict to resolve (gap A)

TD-2 line: *"Author exams; publish/re-publish grades — Super Admin ✔ · Admin ✔ ·
Teacher ✔ (own students, §4.4c)"*. The code refuses Teachers every exam write.

**These are two capabilities under one row**, and §4.6 shows why: *authoring* is
the online builder's act (questions, access policy), while R58's *scheduling* is
booking a room, a clock window and supervising staff at a branch — reference-
adjacent operational work Revision 26 places with Admins.

**My recommendation, for your decision:**

| Capability | Super Admin | Admin | Teacher |
|---|---|---|---|
| Create / edit / delete an exam **sitting** (room, window, staff) | ✔ | ✔ own branches | ⊘ *(as built)* |
| **Enter and amend grades** | ✔ | ✔ own branches | ✔ **own students (§4.4c)** |
| **Publish grades** (BR-8) | ✔ | ✔ own branches | ✔ own students |
| Manual pass/fail override (BR-12) | ✔ | ✔ | ✔ own students |
| Author an online paper | ✔ | ✔ | ✔ — when the mode is built |

This satisfies your requirement *"Super Admins, Admins and Teachers can enter
grades"* exactly, keeps room-booking with Admins as R58 built it, and needs a
one-line TD-2 clarification rather than a behaviour change.

**"Own students" resolves through §4.4c** — the single definition of a Teacher's
scope, already implemented for schedules and sessions. **No new scoping concept.**

**Branch scoping** reads `Enrollment.branch_id` (R66), never
`User.intended_branch_id` (R39).

---

## 6 — Proposed UI and navigation

**No new navigation node for exams** — they are already `نوع: امتحان` on
`/admin/schedules` (R56), and adding a second entry point is the defect the
post-R69 audit just finished removing.

**Grade entry is a screen reached from the exam**, and it needs a home for
Admins, which §14.1 does not currently give it (gap F). The smallest option that
matches an existing precedent:

```
/admin/schedules                      → an exam row gains a «النقاط» action
/admin/exam-grades?exam={id}          → the grade sheet   ← the ?id= deep link (R69.3)
/teacher/exams                        → unblocked; lists the teacher's own exams,
                                        each linking to the same grade sheet
```

`?exam=` follows the `/resources?level=` and R69 `?level=&subject=` precedent: a
deep link, not a second node. **One grade sheet, two ways in** — the alternative
is two implementations of one screen, which is what R69 was cleaning up.

**The grade sheet itself:**

* the exam's identity in the heading (title · Level · Subject · date · branch);
* the audience resolved to a roster — one row per student;
* per row: a mark on the **/20 scale**, an **absent** checkbox, and pass/fail
  shown as a derived indicator with an override control;
* a **Save draft** action and a separate **Publish** action (BR-8), with the
  published state stated plainly;
* a breadcrumb `الجدولة › {exam title} › النقاط`.

**Not built:** averages, transcripts, or any aggregate — §10.1 (Revision 12) is
explicit, and *"do not hardcode an interim average formula"*.

---

## 7 — Workflow: a scheduled exam

1. Admin opens `/admin/schedules`, chooses `امتحان`, fills Level, Subject,
   academic year, date, clock window, branch, room, optional group, staff.
   *(Exists today.)*
2. The exam appears in the calendar as `kind: 'exam'` and in the list view.
   *(Exists today.)*
3. The exam is sat on paper. **Nothing in the platform changes.**
4. An authorized user opens **النقاط** from the exam row.
5. The sheet resolves the audience and shows one row per student.
6. **First draft save initialises absent-zero rows for every student in the
   audience with no mark** — BR-7 and R10's timing, so draft figures are never
   inflated by omission.
7. Marks are entered and saved as draft, repeatedly.
8. **Publish** makes them visible to students and parents (BR-8), writes
   `grade.publish` (TD-8) and stamps `published_at`.
9. Later corrections re-enter draft and require an explicit re-publish.

## 8 — Workflow: a retroactively recorded exam

**Identical from step 1, with a past date.** No separate flow, no separate
entity, no flag:

1. Admin opens `/admin/schedules`, chooses `امتحان`, and **enters the actual
   past date** — accepted today, at every layer.
2. Room and clock window are still required by R58's shape. For a sitting nobody
   is booking, they record where and when it *was* held — which is what an
   accurate retrospective record is.
3. Steps 4–9 above are unchanged.

**The one thing worth your decision:** should a past-dated exam be **visually
distinguished** in the list — e.g. «سُجّل لاحقًا» — so an administrator can see at
a glance which sittings were recorded after the fact? That is derivable
(`created_at::date > date`) and therefore **presentation, not schema**. My
recommendation is to show it, and to store nothing.

---

## 9 — Grade entry and validation

**Storage is integer basis points, 0–10,000** (§20 rule 3, R8). The form takes a
mark on the **/20 scale** — the association's actual scale — and converts once:

```
value_bp = round_half_up(mark / display_scale × 10000)     on persist
mark     = value_bp × display_scale / 10000                on render
```

**Round-half-up applies exactly once, at final persistence** (R8), never per
intermediate step. No float column exists anywhere and none is added.

**Validation rules, each already specified:**

| Rule | Source |
|---|---|
| The student is in the exam's audience | R58 audience |
| `0 ≤ value_bp ≤ 10000` | §4.6, SQL CHECK |
| `absent = true` ⇒ `value_bp = 0` | BR-7 |
| One grade per `(exam, student)` | schema `@@unique` |
| Concurrent co-teacher vs admin edit | **TD-15 `version`** |
| Pass/fail compares bp to `grading.passing_grade_bp` | R14 — integer-only |
| A manual override wins and is never recomputed | BR-12 |
| Draft is invisible to students and parents | BR-8 |
| Provenance = `administrative_group_id`, **null when the student has no group** | R43, R66 |

**Audit (TD-8):** `grade.publish` / `grade.republish` /
`grade.passfail_override` exist. Entry and amendment have no action type — gap E.

---

## 10 — How this supports remote exams later

**The remote half is already in the schema and already discriminated**, which is
why nothing here needs redesigning:

| Piece | State |
|---|---|
| `Exam.mode = online` | exists; **refused loudly** by the service, offered disabled in the UI (§14.4) |
| `Exam.questions` JSONB, stable question UUIDs | **SUPERSEDED by R124** — the paper became rows (`ExamQuestion`/`ExamQuestionOption`), not a JSONB blob |
| `Exam.access_policy` (`single_submission` / `save_and_resume`) | **WITHDRAWN 2026-09-03 (R127)** — it existed when this audit was written and was never implemented; save-and-resume is now the only policy. The column, the enum and `SINGLE_SUBMISSION_FINAL` are gone |
| `StudentExamSubmission` (answers by UUID, state, `auto_score_bp`) | exists |
| `Grade` keyed on `(exam, student)` | **mode-agnostic** |

The remote flow lands as: submission → MCQ auto-score → **draft `Grade`** →
teacher marks the subjective parts → **the same Publish**. §4.6 already describes
exactly this, and it reuses the grade sheet built for in-school exams rather than
adding a second one. R58 states the intent: online *"becomes one more branch of
the same form, never a second admin page"*.

**The one change remote exams could force, stated now so it is not a surprise.**
If a remote assessment must have **many occurrences** — an open window per
student, retakes, or a resit sitting — then §4's 1:1 stops holding and `Exam`
splits into assessment + occurrence. That migration is **additive and does not
touch `Grade`**:

```
expand    add ExamOccurrence; every existing Exam gets exactly one
backfill  copy date/branch/room/window/staff onto it
contract  re-point Grade.exam_id → occurrence_id; drop the moved columns
```

— TD-6b's standard three-phase shape, on a table that will still be small.
**Doing it now buys nothing** and costs a permanent 1:1 join, which is why the
recommendation is to keep R58's single entity until a second occurrence is a real
requirement.

---

## 11 — SRS revisions: required, and deliberately not

**Three small clauses are genuinely required** — each closes a gap where the
specification is silent or stale, and none changes the model:

1. **Navigation (gap F).** §14.1 must name where grades are entered. Today it
   names only `/teacher/exams`, while exam scheduling lives on `/admin/schedules`
   (R56/R58), so an Admin has no node. §20 rule 16 forbids inventing one without
   the sitemap.
2. **BR-7's roster wording (gap B).** *"every student on the Group roster"*
   predates R58's whole-Level audience and R66's optional group. It should read
   as **the exam's audience**, which is the group when one is targeted and the
   Level's students at the exam's branch otherwise.
3. **TD-8 (gap E).** An action type for entering and amending a mark. `grade.publish`
   exists; the write that precedes it does not, so the most frequent grade
   operation would be unaudited.

**Not required, and I recommend against:**

* **No revision for retroactive exams.** R58 already permits an exam at any date.
* **No revision for the assessment/occurrence split.** R58 decided it, with a
  reason that still holds.
* **No revision for averages or transcripts.** §10.1 postponed them deliberately.
* **The TD-2 row (gap A)** needs a **clarification**, and whether that rises to a
  revision is your call — the matrix's *"author exams"* has always meant the
  online builder, so stating the split explicitly may be a documentation fix
  rather than a normative change.

## 12 — Proposed milestones

Split §19.2's M5 along the line you drew. **M5a is self-contained and shippable
without any online-exam work.**

### M5a — in-school exams and grade entry

| # | Task | Depends on |
|---|---|---|
| 1 | Owner decisions: TD-2 split (gap A) · the three clauses in §11 | — |
| 2 | `grading` settings read helper (gap D) | — |
| 3 | Audience resolution: the exam's group, or the Level's students at its branch — **extracted from the existing `entire_level` logic, not rewritten** (gap C) | — |
| 4 | `grade.service.ts`: read sheet · save draft (with BR-7 absent-zero initialisation) · publish · override. TD-15 throughout | 2, 3 |
| 5 | Routes + validators + TD-3 error codes | 4 |
| 6 | Teacher scope (§4.4c) applied to the sheet | 4 |
| 7 | Grade sheet UI + «النقاط» action + `/teacher/exams` unblocked | 5 |
| 8 | Student/parent published-grade view (BR-8) | 5 |
| 9 | Integration tests: audience · bp rounding · absent-zero · publish visibility · override precedence · concurrent edit · branch and teacher scope | 4–8 |
| 10 | Docs: §4.6 handbook page · CHANGES.log · TASKS.md | all |

**Retroactive recording is not a task.** It is task 1's confirmation that the
existing form is the flow, plus the optional «سُجّل لاحقًا» indicator in task 7.

### M5b — remote exams (later, on the same model)

Online mode enabled · question builder on stable UUIDs · submission lifecycle
(TD-1) · MCQ auto-scoring into **draft grades on the existing sheet** · access
policies. **No change to `Grade`, to the sheet, or to publish.**

---

## What I need from you

1. **Gap A** — the TD-2 split in §5: Teachers grade but do not book sittings?
2. **Gap F** — grade entry at `/admin/exam-grades?exam=` plus the unblocked
   `/teacher/exams`, or a different home?
3. **The three clauses in §11** — shall I draft them as one revision?
4. **Retroactive exams** — confirm the existing form is the flow, and whether you
   want the derived «سُجّل لاحقًا» indicator.
5. **M4 or M5a first?** M5a is larger but unblocks the association's actual
   grading work; M4 has no dependency on it either way.
