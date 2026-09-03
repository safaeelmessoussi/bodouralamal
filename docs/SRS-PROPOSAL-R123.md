[Documentation](README.md) › **SRS Proposal — Revision 123**

# SRS Proposal — Revision 123

**Attendance is built. §4.7 stops saying "postponed", and §20 rule 16 stops
naming it.**

**Status: DRAFT REVISION AWAITING THE DOCUMENT OWNER.** The Owner commissioned
the implementation on 2026-09-03 and it is **live in the code**, so this
document is the wording that has to catch up — the same position
[R45](SRS-PROPOSAL-R45.md) and [R46](SRS-PROPOSAL-R46.md) are in. **No agent
has edited `docs/SRS.md`**, and none may: §20 rule 20 reserves that to the
Document Owner. Until this is applied, §4.7 and §20 rule 16 remain the
normative text and **this repository contains a code/specification conflict
that only the Owner can close** — which is reported here rather than resolved
silently, as rule 20 requires.

---

## 1 · The conflict, stated plainly

Two clauses in force today forbid the work the Owner asked for:

> **§20 rule 16** — *"never build MVP UI, schema, or logic for postponed
> features … and — specified but deliberately unbuilt by Revision 43 —
> attendance (§4.7) … A specification written ahead of its build is not
> permission to build it: §4.7 exists so the Session entity has the right
> shape, and creating its table early is the violation it was written to
> avoid."*

> **§4.7** — *"Nothing in this section is built in the MVP. No table, no
> endpoint, no screen, no job, no column."*

The Owner's instruction of 2026-09-03 is that permission. Rule 16's sentence is
correct about what it was written for and is now spent: the postponement was a
sequencing decision, not a design one, and the design it protected is the design
that shipped.

A second, smaller conflict: §4.7 says attendance is recorded *"per Session"*
only. The Owner's own exclusions — vacations and parties — are `Event` rows, and
excluding them is meaningful only if other Events otherwise carry attendance. So
§4.7's carrier list widens to the three dated occurrence carriers the platform
already has.

## 2 · Proposed replacement for §4.7

> ### 4.7 Attendance (built — Revision 123)
>
> * **Attendance is recorded per dated occurrence, per beneficiary.** The
>   platform has exactly three dated occurrence carriers and this revision adds
>   no fourth: a **Session** (a materialised class), an **Event** together with
>   the date its recurrence produces, and an **Exam** sitting. An `Attendance`
>   row names exactly one of them.
> * **A row is the presence.** There is no absence row and no status column.
>   Present is a live row; not marked is the absence of one. An "absent" row per
>   expected person per occurrence would record, thousands of times, that
>   nothing happened.
> * **Attendance is informational and gates nothing** — not grades, not
>   certification, not level completion (BR-11). The Fluid Engagement Model is
>   unchanged and is why: an absence in this association routinely means
>   *watched the recording*.
> * **What attendance MEANS is a property of the scheduling type**, stored as
>   `attendance_mode`: `disabled`, `optional` or `required`. **عطلة and حفل are
>   `disabled` and have no sheet at all** — reading, marking and configuring are
>   refused server-side, not hidden. `required` opens the sheet on the expected
>   roster; `optional` opens it empty, as the association's blank paper list
>   does.
> * **Who may mark is a property of the class or activity**, stored as
>   `attendance_marking`: `staff_only` or `self_or_staff`. An exam sitting is
>   invigilated and carries no such column.
> * **The expected roster is resolved, never stored** (§20 rule 22). It is the
>   occurrence's audience under §4.4c, narrowed to the enrolments whose
>   `AcademicPeriod` covers **the occurrence's own date** (Revision 122) — so a
>   sheet read years later shows who was expected *then*. An enrolment recording
>   no period is unclassified history and is never expected.
> * **Enrolment decides who is EXPECTED, never who is ALLOWED.** Any live
>   beneficiary may be marked present, including one not enrolled in that class;
>   the sheet reports her as beyond the roster, which is the note the paper sheet
>   takes in the margin.
> * **Self check-in is an adult capability, refused structurally to minors.** A
>   beneficiary may record **only her own** presence, and only where the
>   occurrence is `self_or_staff` **and every Category she is enrolled in
>   carries `self_attendance_allowed`**. اليافعات and الطفل are always
>   staff-recorded, **and the server refuses a self check-in for them even if an
>   occurrence is configured `self_or_staff`**. The rule is read from a column,
>   never from a Category's name (§4.4b), and never from `schooling_stage`,
>   which R62.7 says gates nothing.
> * **Removing a mark is staff work and is a soft delete** with a Trash snapshot
>   and an audit row (TD-5, §20 rule 11): *she was marked and then unmarked* is a
>   correction a register has to be able to show.
> * **A Session carrying attendance is protected from schedule regeneration**
>   (§20 rule 24), through the single `session-protection` predicate.
> * **No analytics.** No percentages, no reports, no completion statistics. No
>   QR, geolocation, biometrics, signatures, photos, device identifiers or IP
>   recording — §10.3's QR self-check-in remains a later phase and is not this.
> * **Audit detail carries ids, a date and nothing else** (TD-14): never a name
>   or an email, mechanically enforced by the audit repository's minimisation
>   guard.

## 3 · Proposed amendment to §20 rule 16

Strike the attendance clause. The postponed list becomes:

> *"…never build MVP UI, schema, or logic for postponed features (weight-template
> engine, in-app recorder, FR/EN catalogs, Committees, audit page, print layout,
> notifications, CSV import/export, Trash restore, multipart resume, **and —
> specified but deliberately unbuilt by Revision 43 — session announcements**
> — §10.1)."*

The sentence *"A specification written ahead of its build is not permission to
build it"* **stays**, and stays attached to session announcements. It was right,
and it is why the seam was worth writing before the feature.

## 4 · Proposed amendment to §10.1

The Attendance System bullet moves out of the roadmap and is replaced by a
pointer to §4.7. **Session Announcements stay exactly where they are.**

## 5 · Proposed §7 additions

* **`AcademicPeriod`** already joined §7 at Revision 122.
* **`Attendance`** — `id`, exactly one of `session_id` / `event_id` / `exam_id`,
  `occurrence_date`, `student_id`, `marked_by`, `recorded_at`, soft-delete
  columns. Unique among live rows on
  `(session_id, event_id, exam_id, occurrence_date, student_id)`.
* **`SchedulingType.attendance_mode`** replaces `attendance_required`.
* **`Category.self_attendance_allowed`**, and
  **`RecurringCourseSchedule.attendance_marking`** /
  **`Event.attendance_marking`**.

## 6 · What the Owner is being asked to decide

1. **Ratify** the replacement §4.7, the rule 16 amendment and the §10.1 change.
2. **Confirm the party exclusion's representation.** حفل has no structural
   marker distinguishing it from نشاط, so the migration classifies the *seeded*
   حفل row as `disabled` by name, once, guarded to a row still carrying that
   name and still of kind `activity`. **Nothing at runtime ever matches a name.**
   If the Owner would rather حفل be `optional` and left to the administration,
   that is one click on أنواع الجدولة and no code change.
3. **Confirm that an exam sitting takes attendance at all.** اختبار was
   `attendance_required = true` under OD-03 and is now `required`. If a physical
   sitting should instead rely on `StudentExamSubmission`, the catalogue row
   moves to `disabled` — again one click, no code change.

---

**Related:** [`SRS.md`](SRS.md) §4.7, §20 · [Business rules](reference/business-rules.md) ·
[Database](architecture/database.md) · [API endpoints](reference/api-endpoints.md)
