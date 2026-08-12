[Documentation](README.md) › **SRS proposal — Revision 70**

# Draft SRS Revision 70 — grade entry gets a home, an audience and an audit row

**Status: authorised by the Document Owner (2026-08-12)** as part of M5a, with
two directions confirmed explicitly:

> *"Events only — keep حصص with Admins"* · *"Follow the SRS — Teachers create
> exams in scope"*

The audit ([`audit-2026-08-12-exams.md`](development/audit-2026-08-12-exams.md))
found the exam model complete and the exam half built. This revision closes the
four documentary gaps that stand between that and grade entry. **No schema
change, no new entity, no new concept.**

---

## 70.0 — What the audit found already correct, stated first

It decides the size of this revision.

| Already specified | Where |
|---|---|
| `Exam` is the physical sitting; no `ExamSitting` | **R58** |
| An exam needs no term boundary — **a past date is permitted** | **R58**, §4.6 |
| Grades are per-exam, informational, bp-only; no averages | §4.6, **R8**, **R12** |
| Scale /20, pass 10/20, in `SystemSetting` only | **R14** |
| Draft until published; re-publish after change | **BR-8** |
| Manual pass/fail override wins | **BR-12** |
| A Teacher's scope derives from the schedules they staff | **§4.4c** |
| **Teachers create exams manually** | **§4.5**, §2.1, TD-2 |
| Teachers may schedule Events in their own scope | TD-2 |
| Teachers may **not** create Recurring Course Schedules | TD-2 |

**The last two are load-bearing together.** §4.4c derives a Teacher's entire
reach *from the schedules they staff*, so a Teacher who could create a Course
Schedule and staff themselves onto it would **widen their own scope** — branch,
level, subject and every student in the resolved audience. TD-2's `⊘` is
therefore not a convenience; it is what keeps the authorization model from being
self-referential. Events carry no staffing and expand nothing, which is why the
same table grants them `✔`. **Both rows stand unchanged.**

## 70.1 — §14.1: grade entry has nowhere to happen

§14.1 lists authoring and grading at `/teacher/exams`, and R56/R58 put exam
*scheduling* on `/admin/schedules`. Between them, **an Admin has no node from
which to enter a grade** — `/admin/grading` is reserved for §10.1's postponed
template engine and must not be borrowed for this.

**`/admin/exam-grades` joins §14.1**, carrying the exam id as **`?exam=`** — the
`/resources?level=` precedent §14.1 already sets, and the one R69 applied to
`/admin/level-subjects` and `/admin/teaching-groups`. A second path segment
would be a navigation node §14.1 does not list.

**`/teacher/exams` is unblocked** and reaches **the same screen**. One grade
sheet with two ways in, never two implementations: this document has paid for
that mistake often enough that R69 spent a revision undoing it.

## 70.2 — BR-7's roster predates the audience it describes

> *"every student on the **Group roster** without a score gets a draft `0`/`absent` row"*

That wording predates **R58**, which made an exam's audience *the whole Level
unless a group is named*, and **R66**, which made the group optional. Taken
literally today it initialises nothing for a whole-Level exam and misses every
ungrouped student.

**It now reads: every student in the exam's AUDIENCE.** The audience is R58's,
restated nowhere: the named Administrative Group, or — when
`administrative_group_id` is NULL — the students enrolled in the exam's Level at
the exam's branch, resolved through **`Enrollment.branch_id`** (R66).

**Nothing else about BR-7 changes:** the timing is still the teacher's first
draft save (R10), the rows are still replaceable before and after Publish, and 0
still counts as 0.

## 70.3 — TD-8 records publishing but not marking

The grid carries `grade.publish`, `grade.republish` and
`grade.passfail_override`. **The write that precedes all three has no action
type**, so the single most frequent grade operation would leave no trail — on a
record about a child's attainment.

**`grade.enter` joins TD-8**, detail `exam, students affected count`, written
once per save rather than per row: a sheet is saved as a sheet, and one row per
student would bury the decision in its own volume.

**It is not purgeable.** Revision 19 fixed `audit.purge`'s allowlist to six
`auth.*` types and forbade extending it by inference; `grade.enter` is outside
that list and stays.

## 70.4 — TD-2's exam row conflates three different acts

> `Author exams; publish/re-publish grades | ✔ | ✔ | ✔ (own students, §4.4c)`

One row, three capabilities with different risks — and the implementation
disagreed with all of it, refusing Teachers every exam write while §4.5 says
*"teachers create exams manually"* and §2.1 says a Teacher *"schedules/grades
exams"*. **The row splits in three; the answers do not change.**

| | Super Admin | Admin | Teacher |
|---|---|---|---|
| **Create/edit an exam sitting** (room, window, staff) | ✔ | ✔ own branches | **✔ within §4.4c scope** |
| **Delete an exam sitting** | ✔ | ✔ own branches | **⊘** — see below |
| **Enter / amend grades** | ✔ | ✔ own branches | ✔ own students (§4.4c) |
| **Publish / re-publish grades** (BR-8) | ✔ | ✔ own branches | ✔ own students (§4.4c) |

**A Teacher's exam scope is §4.4c and nothing new.** Every part of the sitting
must fall inside the schedules they staff: the **branch** among
`teacherBranchIds`, the **(level, subject)** pair among those they teach, and a
named **group** among their own — a whole-Level exam only where they staff that
Level. Rooms are still validated against the branch as R58 requires.

**Deletion stays Admin and above.** `Exam` carries no `created_by`, so *"a
Teacher may delete their own but not another person's"* is not expressible
against the current schema — and a column is **not** added to make it sayable,
because editing already covers the mistake a Teacher needs to correct and R70
adds no schema.

**Deliberately not granted:** assigning content
or events to the Global scope, and anything on the Recurring Course Schedule —
see §70.0.

## 70.5 — What this revision does NOT do

* **No schema change.** Not one column, and no migration.
* **No `ExamSitting`.** R58's single entity stands (audit §4).
* **No stored retroactive flag.** A past-dated exam is an ordinary exam;
  «سُجّل لاحقًا» is derived at render time from `created_at > date` and stored
  nowhere.
* **No averages, no transcripts, no template engine.** §10.1 and R12 are
  untouched, including *"do not hardcode an interim average formula"*.
* **No new scope concept.** §4.4c is the single definition and
  `policies/roster-resolution.ts` its single implementation.
* **No change to the two Course Schedule / Event rows** (§70.0).

## 70.6 — Audit against the live architecture

| Claim | Status |
|---|---|
| `Exam`, `Grade`, `ExamStaff`, `StudentExamSubmission` all exist | **[CODE]** `schema.prisma` |
| Exam CRUD, validators, UI shipped | **[CODE]** `exam.service.ts`, `/admin/schedules` |
| `Grade` has no service, route, adapter or screen | **[CODE]** verified absent |
| No past-date restriction at any layer | **[CODE]** validator, service, form |
| §4.4c is implemented once, in `roster-resolution.ts` | **[CODE]** |
| Teacher Event create/edit already scoped to own groups | **[CODE]** `event.service.ts` |
| Teacher content upload already scoped by §4.4c | **[CODE]** `content.service.ts` |
| Exam creation refuses Teachers, contradicting §4.5/§2.1/TD-2 | **[CODE]** `assertCanManage` |
| **Two scope resolvers still key on the GROUP's branch, not `Enrollment.branch_id`** | **[CODE]** — a live R66 defect, fixed with this revision, not by it |

---

**One navigation node, one reworded rule, one audit type, one matrix row split
in three. No schema, no entity, no concept.**
