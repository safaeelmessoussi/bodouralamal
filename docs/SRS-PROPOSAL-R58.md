[Documentation](README.md) › **SRS proposal — Revision 58**

# Draft SRS Revision 58 — an Exam has a mode, and a physical exam is scheduled

> **Status: APPLIED to `docs/SRS.md` on 2026-08-09**, on the Document Owner's decision that
> exams are **sat on the premises** (`حضوري`) with an online mode planned and explicitly
> disabled.
>
> This revision **supersedes two standing rules** in §4.6, which the Owner instructed be updated
> rather than worked around.

---

## The two rules this replaces

**(1) §4.6, Revision 12 — "digital exams only in MVP":**

> digital exams only in MVP; the standardized print-ready CSS layout is postponed to §10.1 —
> paper sittings are prepared outside the platform until then, and their marks entered as grades
> normally.

**Superseded.** A physical sitting is now organised *in* the platform: it has a branch, a room, a
date, a clock window and staff. What stays outside the platform is the **paper itself** — the
questions, the print layout, and the marking of scripts. The association was already doing the
organising; it was doing it on paper *about* an event the platform could not see.

**(2) §4.6 — "Exam Independence & Floating Rounds":**

> Exams are created **independently of strict calendar bounds** or rounds.

**Narrowed, not deleted.** The sentence protected something real: an exam must not require a
Course Schedule or a term boundary to exist. That still holds. What changes is that a *physical*
exam now **carries its own date and time**, because a sitting that nobody can find is not
organised. `round` remains an optional, non-restricting sorting selector exactly as before.

## The model: one Exam, two modes

```
Exam
├── mode: physical | online        ← the discriminator
├── (both)      title, description, date, level, subject, academic_year, round
├── (physical)  branch, room, start_time, end_time, administrative_group?, staff[]
└── (online)    questions, access_policy, submissions        ← §4.6, unchanged, M5
```

**Why one entity with a mode, and not `Exam` + `ExamSitting`.** The earlier draft of this
revision argued for splitting them, on the grounds that the question paper and the event where it
is answered are different facts. That argument fails for a **physical** exam specifically: its
paper is not in the platform at all, so the row *is* the sitting. There is no second fact to
separate. An online exam is the mirror image — no room, because nobody sits anywhere.

The mode is therefore a genuine discriminator rather than a flag: each mode's columns are exactly
the ones its own reality has, and **the database enforces that with CHECK constraints** so a
physical exam cannot acquire an access policy or an online one a room.

**`mode` is fixed after creation**, like the scheduling type it corresponds to: changing it would
mean discarding every column the other mode does not have.

## Fields, and the four that were rejected

Added to `Exam`:

| Field | Mode | Why it earns its place |
|---|---|---|
| `mode` | both | The discriminator |
| `description` | both | Every other schedulable item has one (R57) |
| `academic_year_id` | both | **A gap independent of this revision**: content and course schedules both carry one, and grades aggregate per year, yet an exam did not |
| `branch_id` | physical | Where it is sat. Required — a sitting happens somewhere |
| `room_id` | physical | Which room. Required for the same reason |
| `start_time` / `end_time` | physical | Wall-clock (TD-11), never instants |
| `administrative_group_id` | physical, optional | **Null = the whole Level.** A narrower target when one group sits separately |
| `ExamStaff` join | physical | One `supervisor`, zero or more `assistant` — the shape `CourseScheduleStaff` already uses (§4.4c) |

**Rejected, each for a reason:**

* **مدة الامتحان (duration)** — `end_time − start_time`. A stored duration is a second source of
  truth that drifts the first time somebody edits one and not the other.
* **الدرجة القصوى (max mark)** — §4.6 stores every score as **basis points of the exam's total**
  (0–10,000 bp) and converts to the association's scale at render time from
  `grading.display_scale`. A per-exam maximum would be a second answer to a question
  `SystemSetting` already owns.
* **ملاحظات تنظيمية (organisational notes)** — that is `description`. Two free-text fields
  invite a convention about which to use, and the convention will not hold.
* **حالة الامتحان (status)** — `is_published` exists, and TD-1 defines no other exam state.
  A second status column would be a lifecycle nobody has specified.

**Why not §4.4c's three teaching modes for the target.** A Course Schedule targets a Level, an
Administrative Group *or* a Teaching Group, because teaching is split by subject. An exam is sat
by **a roster at a premises** — the Teaching Group split has no bearing on who sits a paper — so
one optional Administrative Group is the honest shape, and three nullable columns would offer a
choice the domain does not have.

## The online mode is designed for, not built

`mode = online` is **declared and refused**: the picker offers it, disabled, with a stated reason
(§14.4 — a blocked capability says why rather than vanishing). **No online columns, no online
endpoints and no online UI are added**, because a field with no behaviour behind it is a promise
the platform has not made.

When it arrives it needs an exam page or link, a **selected-student** audience rather than a
group, an opening and closing window, access rules and submission settings. §4.6 already models
the last two (`access_policy`, `StudentExamSubmission`). None of that changes the scheduling
experience: it is one more branch of the same form, which is the architectural rule this revision
exists to preserve — **one scheduling experience → Exam → mode**, never two admin pages.

## The calendar

A physical exam is an occurrence like any other and appears in the same calendar. `Occurrence`
gains `kind: 'exam'` beside `session` and `event`, and the interface gives it its **own colour**,
used identically in the calendar, the list, the details dialog and the type indicator — an exam
is the one item on a timetable somebody must not mistake for an ordinary class.

## Exact wording applied

### §0

> **Revision 58 (Document Owner decision — an Exam has a mode, and a physical exam is scheduled,
> 2026-08-09):** §4.6 said **digital exams only in MVP** with *"paper sittings prepared outside
> the platform"*, and that exams are *"created independently of strict calendar bounds"*. **Both
> are superseded here**, on the Owner's decision that exams are sat on the premises. `Exam` gains
> **`mode` (`physical | online`)**, fixed after creation, plus `description` and
> `academic_year_id` for both modes and, for a physical sitting, **`branch_id`, `room_id`,
> `start_time`, `end_time`, an optional `administrative_group_id` (null = the whole Level) and an
> `ExamStaff` join carrying one supervisor and any number of assistants** — the shape
> `CourseScheduleStaff` already uses. **The mode is a discriminator, not a flag:** each mode
> carries exactly the columns its own reality has, and CHECK constraints refuse a physical exam an
> access policy or an online one a room. **One entity rather than `Exam` + `ExamSitting`**,
> because a physical exam's paper is not in the platform at all — the row *is* the sitting, and
> there is no second fact to separate. **Exam independence is narrowed, not deleted**: an exam
> still needs no Course Schedule and no term boundary to exist, and `round` remains an optional
> non-restricting selector; what changes is that a physical exam carries its own date and clock
> window, because a sitting nobody can find is not organised. **`mode = online` is declared and
> refused** — offered disabled with a stated reason (§14.4) and given **no columns, no endpoints
> and no UI**, since a field with no behaviour behind it is a promise the platform has not made.
> **Duration, maximum mark, organisational notes and exam status are deliberately NOT added**:
> the first is `end_time − start_time`, the second is a second answer to what
> `grading.display_scale` already owns, the third is `description`, and the fourth is a lifecycle
> TD-1 does not define. A physical exam appears in the shared calendar as `kind: 'exam'` with its
> own colour, used identically in every surface that shows it.

### §7 — `Exam`

> Add `mode`, `description`, `academic_year_id`, `branch_id`, `room_id`, `start_time`,
> `end_time`, `administrative_group_id`; and **`ExamStaff`** — join of `exam_id` ↔ `user_id` with
> a `position` (`supervisor | assistant`), mirroring `CourseScheduleStaff`.

### TD-3.6

> ```
> GET    /exams?branch_id=&level_id=&from=&to=&page=   → staff; the scheduled exams
> POST   /exams          → physical: title, description?, date, start_time, end_time,
>                          level_id, subject_id, academic_year_id, branch_id, room_id,
>                          administrative_group_id?, staff[]
> PATCH  /exams/{id}     → the same fields; `mode` is NOT editable
> DELETE /exams/{id}     → soft delete + Trash snapshot (TD-5, BR-15)
> ```
