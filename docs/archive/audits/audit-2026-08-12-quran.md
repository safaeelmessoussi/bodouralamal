[Documentation](../README.md) › **M4 Quran Progress — audit**

# M4 — Quran Progress: current-state audit

> **Historical document.** Revision 107 supersedes this audit's conclusion that
> the broad Quran domain is a Subject. See [Quran progress](quran-progress.md):
> atomic Subjects are scheduled separately and only حفظ القرآن carries the
> memorisation marker. The text below is retained as the R73 audit record.

**Status: audit only. Nothing implemented, no schema or SRS touched.**
Decisions required from the Document Owner are listed at the end.

---

## The headline

**The Owner's question — *"Quran memorization is a Subject; progress should be
associated with that Subject rather than treated as an unrelated standalone
feature"* — is one the SRS has already answered, explicitly, and in two parts.**

Revision 43 clause 9, recorded in §7:

> **Quran is a Subject for SCHEDULING ONLY — memorization tracking is
> unchanged.** … *"That rule was about tracking, and it remains true of tracking:
> **Quran memorization is recorded exclusively by the §4.5 progress engine**, as
> Surah + ayah range, and `LevelSurah` remains the Quran-side curriculum join.
> What was missing was any way for a timetable to say 'this session is Quran' —
> so the Quran may now be a `Subject`, carry Teaching Groups, and be delivered by
> Recurring Course Schedules like any other.* **It is a defect to record
> memorization progress against a Subject, or to derive Quran coverage from
> anything but `QuranProgressLog` (BR-13).**"

So **half the intent is already true and the other half is already refused**:

| The Owner wants | Status |
|---|---|
| Quran is a Subject, not a standalone island | **Already true** (R43) — it carries circles, schedules and teachers like any Subject |
| Quran progress is *associated* with that Subject | **Already true operationally** — see below |
| A `subject_id` on the progress log | **Refused by name** — §7 calls it *"a defect"* |

**The association already exists, through scope rather than through a column.**
Who may log for a student resolves through `studentsTaughtBy` — *the schedules
they staff* (§4.4c) — and a Quran circle is exactly such a schedule. A مؤطرة who
teaches حلقة القرآن for a group reaches those students and no others. Nothing is
standalone; the link is the timetable, not a foreign key.

**Why the SRS put it that way, stated so the decision can be reviewed rather than
rediscovered:** a Surah's coverage is a fact about a **student and a Surah**, and
it survives the student changing circle, changing group, changing Level or
changing teacher. Stamping a `subject_id` on the log would make the same recited
ayahs count differently depending on which class they were recited in, and BR-13
requires coverage to be *the union of intervals* — one number per student per
Surah, always current.

---

## 1 — What already exists

### Schema — complete, and more finished than expected

| Model | State |
|---|---|
| `QuranSurah` | **114 rows seeded** (`prisma/seed/production.ts`) — `surah_id`, `name_arabic`, `name_transliterated`, `total_ayahs` |
| `QuranProgressLog` | Table exists. `(student_id, surah_id, start_ayah, end_ayah, category, logged_by, logged_at, deleted_at, deleted_by)` |
| `StudentSurahProgress` | The R10 cache: `merged_ayah_count`, `coverage_percent`, `merged_intervals` (JSONB), `last_log_id`, `last_log_at` |
| `LevelSurah` | Table exists, **0 rows**, no service and no UI |
| `QuranLogCategory` | `new_memorization \| revision` |
| `Exam.surah_id` | Already nullable-linked, for a Surah-specific exam |

**The hardest database piece is already in place**, from the initial migration:

* `CHECK (start_ayah >= 1 AND start_ayah <= end_ayah)`
* **and a cross-table trigger** — `quran_progress_log_ayah_bounds_trigger`
  running `quran_log_ayah_bounds_check()` `BEFORE INSERT OR UPDATE OF surah_id,
  end_ayah` — which is TD-6's *"upper bound vs `total_ayahs` enforced in the
  service layer + DB trigger, since it crosses tables."*

Indexes `(student_id, surah_id)` and `(student_id, surah_id, deleted_at)` exist;
TD-6 names the composite as a hot path.

### Code — nothing

**No service, controller, route, validator, adapter, screen or test.** Zero
`quran_progress_log` rows. The only mentions are docstrings:
`jobs/runner.ts` records that *"Quran coverage recalculation must never be moved
into a job"*, and `roster-resolution.ts` names §4.5 among the rules its
derivation serves.

## 2 — What the SRS already specifies

§4.5 is written in full and needs no revision to be implemented:

* **Storage** — discrete Surah + closed ayah range, validated per TD-6.
* **BR-13 interval merge** — coverage is the union of non-overlapping intervals;
  overlapping logs must never inflate progress. Worked example included.
* **Synchronous recalculation (R6, R8, R10)** — create, update **and
  soft-delete** each recompute that student's coverage **for that Surah, in the
  same request**, never in a job. The mechanics are prescribed: commit the log in
  a short transaction, then immediately upsert the cache with a `last_log_id` /
  `last_log_at` stamp.
* **The read-side self-heal guard** — every consumer compares the cache's stamp
  against the latest log and *recomputes and repairs in place* on mismatch. And
  the performance rule that goes with it: **list pages run the guard as ONE
  joined query**, never per-row, *"which would be a stealth N+1 wearing a cache
  costume."*
* **No auto-exam trigger** — 100 % coverage creates nothing; post-MVP (§10.1).
* **Students view read-only; only teachers log.**
* **BR-11** — level completion is 100 % coverage plus the final exam *only if one
  is configured*.
* **TD-2** — `Log / correct / soft-delete Quran progress`: Super Admin ✔ ·
  Admin ✔ · **Teacher ✔ (own students)**.
* **TD-8** — `quranlog.update` / `quranlog.delete`, detail *log reference,
  old→new range, recalculated coverage*.
* **§14.1** — `/teacher/students/{id}/quran` (logging) and
  `/dashboard/student/quran` (read-only per-surah cards).
* **TD-11a** — Quran progress writes **including the synchronous merge** are
  p95 < 100 ms.

## 3 — What can be reused

| Need | Reuse |
|---|---|
| *Which students may this مؤطرة log for* | **`studentsTaughtBy`** (§4.4c) — already the single definition, already used by content and exams |
| *May this caller touch this student* | **`assertCanAccessStudent`** — Super Admin unscoped, Admin by `Enrollment.branch_id` (R66), Teacher by their courses; **out of scope answers 404, never 403** (§20 rule 17) |
| Audit | `audit.repository.ts` + the two TD-8 rows |
| Soft delete | TD-5, and R59's *deliberate deletion reaches the Trash* test |
| Optimistic locking | TD-15 `version` — **note: `QuranProgressLog` has no `version` column** |
| Screens | `AdminLayout` / `TeacherLayout`, `DataTable`, `FormDialog`, the R71 `StaffPicker` pattern for shared controls |

## 4 — The four delivery shapes the Owner asked about

**All four already resolve, with no new concept**, because a Quran class is an
ordinary schedule and §4.4c resolves its audience:

| Shape | Schedule | Audience |
|---|---|---|
| Level teaches Quran to the **entire Level** | `entire_level`, subject = Quran | that Level's students **at the schedule's branch** (`Enrollment.branch_id`, R66) |
| Level **subdivided into groups** | `administrative_group` | that group's enrolled students |
| Quran **subdivided into circles** (حلقات) | `teaching_group` | that circle's members |
| A مؤطرة **teaching or assisting** | either position | **identical** — R43 gave co-teachers and assistants one table and one rule, and `staffsSession`/`studentsTaughtBy` count both |

A student in a Level where Quran is split but who holds no circle appears on that
Subject's **unassigned list** (§4.4c, §5.6) — already built.

## 5 — What is missing

1. **The whole §4.5 engine** — service (merge, synchronous recalculation,
   self-heal), routes, validators, adapters, and the two §14.1 screens.
2. **`LevelSurah` has no service and no UI**, and 0 rows. It is *"the Quran-side
   curriculum join"* and **BR-11's completion rule depends on it** — 100 %
   coverage of *which* surahs is otherwise unanswerable. §4.5 itself never
   mentions it. **Owner decision: is `LevelSurah` in M4?**
3. **`/teacher/students/{id}/quran` has no registry entry**, and its path carries
   an id — structurally the same problem R69 fixed for `مواد المستوى` and R70.1
   for grade entry, where a screen with an id in its path has no menu that can
   reach it. The established remedy is a query parameter
   (`/teacher/quran?student=`).
4. **No `quranlog.create` in TD-8.** The grid has `quranlog.update` and
   `quranlog.delete` — the write that precedes both is unrecorded, exactly the
   gap R70.3 closed for `grade.enter`.
5. **`QuranProgressLog` carries no `version`.** Two مؤطرات correcting the same
   log is the TD-15 case; whether it applies here is an Owner call, and it would
   be a schema change.
6. **R59's Trash obligation is unresolved.** *"A deletion a person deliberately
   performed gets its own Trash entry"* — a مؤطرة soft-deleting a mis-logged
   range is deliberate, so on R59's test it needs a snapshot. Nothing exempts it
   today, and the coverage guard will demand one.
7. **No student-facing read** — `/dashboard/student/quran` does not exist; the
   student dashboard's own docstring says Quran progress is elsewhere.

## 6 — Authorization

**No new rule and no new resolver.** TD-2 already grants the capability, §4.4c
already resolves the scope, and `assertCanAccessStudent` already implements it
with the three roles resolved the way TD-2 qualifies each:

* **Super Admin** — unscoped.
* **Admin** — their branches, via `Enrollment.branch_id` (R66).
* **مؤطرة** — the students of the courses they staff, **teaching or assisting
  equally**.
* **Out of scope answers 404**, so a response can never be used to discover that
  a minor's record exists (§20 rule 17).

**One question the SRS does not answer:** may a مؤطرة log Quran progress for a
student she teaches **only for another Subject** — Fiqh, say — when somebody else
teaches that student's Quran circle? §4.4c's *"own students"* is subject-blind,
so as written: **yes**. Whether the association wants that is a policy call, not
a code one, and it is the one place where the Owner's *"associate progress with
the Subject"* instinct would change behaviour rather than merely describe it.

## 7 — Schema changes required

**For the specification as written: none.** The tables, the enum, the CHECK, the
cross-table trigger and the indexes all exist.

Only the open decisions above would add anything:

| If the Owner decides | Change |
|---|---|
| Logging is restricted to the student's **Quran** teacher (§6) | **None** — a scope narrowing in the service |
| `QuranProgressLog` needs TD-15 locking | `version` column + migration |
| `LevelSurah` management ships in M4 | **None** — the table exists; it needs a service and a screen |

## 8 — SRS revisions required

**Not for the engine** — §4.5, BR-11, BR-13, TD-2, TD-6, TD-8 and TD-11a are
complete and consistent. Only two small gaps, both the shape this document has
closed three times already:

1. **Navigation** — `/teacher/students/{id}/quran` cannot be reached from a menu
   because its path carries an id (§14.1, §20 rule 16). R69's and R70.1's remedy
   is a node with a query parameter.
2. **TD-8** — a `quranlog.create` action type, so the most frequent operation is
   not the unrecorded one (the gap R70.3 closed for grades).

**Deliberately not proposed:** no `subject_id` on `QuranProgressLog`, which §7
calls a defect by name; no auto-exam trigger (§10.1); no averages or aggregation.

## 9 — Recommended slices

**M4a — the engine and the teacher's screen**
1. `policies/quran.ts` — the interval merge, pure and unit-tested against BR-13's
   own worked example.
2. `quran.service.ts` — log create / correct / soft-delete, each with the
   **synchronous** recalculation and the cache upsert; `assertCanAccessStudent`
   for scope; TD-8 rows.
3. The **read-side self-heal guard**, and the list path as **one joined query**.
4. Routes, validators, adapter.
5. `/teacher/quran?student=` — per-surah cards, log form, correction and deletion.

**M4b — the student's view**
6. `/dashboard/student/quran` — read-only per-surah coverage and log history,
   reusing M4a's read.

**M4c — `LevelSurah`, only if the Owner puts it in scope**
7. Which surahs a Level covers, and BR-11's completion check on top of it.

**Explicitly out:** the auto-exam trigger, averages, and anything that derives
coverage from a source other than `QuranProgressLog`.

---

## Decisions needed

1. **Confirm the model.** Quran progress stays keyed on *(student, surah)* with
   no `subject_id`, associated with the Quran Subject **through scope and the
   timetable** — as R43 and §7 specify. Or overrule that, which would need a
   revision reversing a rule the SRS states as a defect.
2. **§6's open question:** may a مؤطرة log Quran for a student she teaches only
   for another Subject? As specified, yes. Narrow it to the student's Quran
   teacher?
3. **Is `LevelSurah` in M4?** BR-11's completion rule needs it; §4.5 does not.
4. **Does `QuranProgressLog` need TD-15 `version`?** The only schema change on
   the table.
5. **Shall I draft the two small clauses** (the navigation node and
   `quranlog.create`) as one revision before implementing?
