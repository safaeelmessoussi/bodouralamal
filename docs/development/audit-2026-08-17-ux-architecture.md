# Audit — platform-wide UX consistency and information architecture

**Date:** 2026-08-17 · **Base commit:** `1164c8c` · **Status:** audit complete, awaiting
the two Owner decisions in §Z before the slice is implemented.

Scope: the Document Owner's 29-section correction pass. This document is the
PHASE A deliverable — what was inspected, what was found, and what each item
costs. It does **not** restate the principles themselves; those go to
[`ux-architecture.md`](./ux-architecture.md) in PHASE D, which is where a future
session reads them.

---

## A. What was audited

| Surface | Files read |
|---|---|
| Atomic components | `ui/button.tsx`, `ui/field.tsx`, `ui/data-table.tsx`, `ui/multi-select.tsx`, `ui/form-dialog.tsx`, `ui/confirm-dialog.tsx`, `ui/badge.tsx`, `ui/dialog.tsx`, `states.tsx`, `scope/level-select.tsx`, `scope/scope-selectors.tsx`, `scope/subject-circles.tsx`, `scheduling/staff-picker.tsx`, `grading/grade-sheet.tsx`, `calendar/level-selector.tsx` |
| Registries & shells | `lib/admin-modules.ts`, `lib/teacher-modules.ts`, `lib/portal-modules.ts`, `hooks/use-scope-options.ts`, `admin/admin-layout.tsx`, `teacher/teacher-layout.tsx`, `pages/admin/index.tsx` |
| Pages | `exam-grades`, `enrollments`, `groups`, `teaching-structure`, `level-surahs`, `level-subjects`, `users`, `approvals`, `scheduling`, `teacher/exams`, `dashboard/student` |
| Backend | `app.ts` route table, `grade.service.ts`, `teaching-group.service.ts`, `enrollment.service.ts`, `roster-resolution.ts`, `reference-data.service.ts` |
| Specification | §5.3, §14.1 (full sitemap), TD-3.3, TD-3.6, TD-3.12, TD-2's exam rows, R43.3, R58, R59, R66, R69, R70, R73, R74, BR-7, BR-8, BR-11, BR-21, BR-22 |
| Guards | `scripts/ci/` (15 guards, incl. `check-openapi-td3.sh` + `td3-routes.txt`), `lib/admin-modules.test.ts`, `ui/data-table.test.tsx`, `grading/grade-sheet.test.ts` |

## B. The headline finding

**The atomic foundation the request asks for already exists.** PHASE B is
therefore almost entirely a *migration* exercise, not a *construction* one:

| Concept | Component | Coverage |
|---|---|---|
| Button (4 variants incl. `danger`) | `ui/button.tsx` | 5 hand-rolled `btn btn--*` call sites remain |
| Table + pagination + 4 states | `ui/data-table.tsx` | 14 pages use it; **5 render `<table className="admin-table">` by hand** |
| Empty / no-results / error / loading / no-permission | `states.tsx` | reached through `DataTable`; hand-rolled `<p className="state">` on the non-`DataTable` pages |
| Level label `{Category} — {Level}` | `scope/level-select.tsx` | 6 call sites conform; **`calendar/level-selector.tsx` does not** |
| Searchable multi-select | `ui/multi-select.tsx` | conforms; `＋ {label}` convention already inside it |
| Search input | `ui/field.tsx` `SearchInput` | conforms |
| Form dialog / confirm dialog | `ui/form-dialog.tsx`, `ui/confirm-dialog.tsx` | conforms |
| Curriculum dependency graph | `hooks/use-scope-options.ts` | already imports `levelLabel` |

So the defects are **drift at the edges**, and the guards in §25 are what stop
the edges drifting again. Nothing in this pass needs a new component *system*.

## C. Findings by requested section

Change class: **F** frontend · **B** backend · **D** documentation · **—** no code needed.

### Data-first conversions

| § | Finding | Class |
|---|---|---|
| 5 | `/admin/exam-grades` opens as a `SelectField` gate + `pickExam` empty state. `listExams` is already role-scoped and returns everything needed for a table. The detail view replaces the page title with `current.title` **and** `GradeSheetView` prints `sheet.exam.title` again — the duplicated «سواعد». Breadcrumb `الجدولة → {exam}` is redundant navigation: the node is in the menu. | F |
| 11 | `حلقات المواد` is an accordion over Levels, lazy-loading per Level. It is *not* dropdown-gated (R69 fixed that), but it is not a table either, and there is no way to see all circles at once. **Needs a flat read — see §Z.1.** `إضافة حلقة` currently sits inside each Subject block only, so a page with no Level open offers no create action. | F + B |
| 13 | `مقرر الحفظ` is the same accordion shape. Same verdict: shows its data, but not as a table, and `تعديل المقرّر` is reachable only after expanding. Levels + their Surahs can be listed eagerly (`listLevelSurahs` per Level is cheap); **completion must stay lazy** — it resolves coverage per student per Surah and eager loading is a request storm. | F |
| 22 | The standard itself. `groups`, `users`, `approvals`, `levels`, `taxonomy`, `branches`, `trash`, `content`, `scheduling`, `schedule-sessions`, `teacher/schedules` already comply. The three above are the outstanding ones. | D |

### Language and leaks

| § | Finding | Class |
|---|---|---|
| 6 | `grade-sheet.tsx` renders a `النتيجة` column with `Badge tone={passed ? 'ok' : 'warn'}` reading `ناجحة`/`راسبة`. `Grade.passed` and `manual_pass_fail_override` are **business state and stay** — BR-8, BR-12 and `overridePassFail` are untouched. Only the column goes. `overridden` (`قرار يدوي`) is a *provenance* fact, not a pass/fail label; it moves onto the status cell. | F |
| 10 | Exactly one leak: `i18n/ar.ts:956` — `groupHint: '… وهو تسجيل صحيح بعد المراجعة 66.'`. A repo-wide sweep of i18n **string values** (not comments) for `§`, `TD-`, `BR-n`, `R-nn`, `مراجعة n` found no other. Comments citing the SRS are correct and stay — they are for maintainers, not users. | F + D |

### Reachability and menus

| § | Finding | Class |
|---|---|---|
| 7 | **The screen is specified and unbuilt.** §5.3 lists `My Grades & Exams (/dashboard/student/grades)` — *"published grades and pending online exams"* — and §14.1 line 1815 carries the node. No student-facing read exists; `GET /exams/{id}/grades` is the staff sheet. TD-3.3's own preamble enumerates **grades** among the student-context reads that resolve the acting student per §4.3, and `GET /students/me/quran` already ships under that same umbrella (M4b). So the read is *inside* an existing normative clause rather than invented — **but it is unlisted in `td3-routes.txt`; see §Z.2.** | F + B |
| 14 | `users.tsx` renders `إضافة حساب` in the layout `actions` slot. `POST /admin/users` and `createUser` stay; only the button and its dialog trigger go. **`UserDialog` itself is shared with edit** — removing the create path must not break edit. | F |
| 15 | Already compliant. `approvals.tsx` uses `DataTable` with `filtered`/`onClearFilters`, so `NoResultsState` + shared `Button` render the *"لا توجد نتائج مطابقة للتصفية"* / *"إزالة التصفية"* pair. It has **no** `actions` slot. Nothing to change; a guard pins it. | — |
| 16 | Current `administration` order is `categories, levels, subjects, level-surahs, level-subjects, branches, trash, hijri, settings`. Requested order swaps the middle two. **§14.1's own Administration order is `الفئات → المستويات → المواد → مواد المستوى`, so the request aligns the code with the SRS.** `/admin/level-surahs` is **not in §14.1 at all** (M4c shipped it with "no SRS change"); the request pins it after `مواد المستوى`, which is the dependency order §14.1 states for the rest. Recorded as a §14.1 documentary gap, not a contradiction. | F + D |
| 17 | **Already granted; the labels are what mislead.** A مؤطرة has `/teacher/schedules` (`status: 'ready'`, R72 gave her Activity authoring) and `/teacher/content` (`ready`). Her menu reads `حصصي` and `المحتوى التعليمي`. The Owner asks for `الجدولة` and `مكتبة المحتوى`. **`مكتبة المحتوى` is `/admin/content`** — the back-office Content Library, staff-only; pointing her there would widen authorization and is refused. Her node keeps its path and takes the requested word. Sections are added to the teacher sidebar so it reads like the back office. `TEACHER_MODULES[0]` (`/teacher` dashboard) is still `blocked` — untouched, it is not in scope. | F |
| 18 | Two redundant paths found: the `الجدولة` breadcrumb on `/admin/exam-grades` (§5), and `teaching-structure.tsx`'s in-page links to `/admin/groups?level=` and `/admin/level-subjects?level=`. The latter two are **kept**: they are cross-hierarchy hand-offs from a read-only block to the screen that owns the data (R69.5), not duplicate access to a sibling. Documented as the exception test. | F + D |

### Atomicity migrations

| § | Finding | Class |
|---|---|---|
| 2, 19 | 5 pages hand-roll `<table className="admin-table">`: `hijri-calendar`, `teacher/quran`, `level-surahs`, `teacher/exams`, `dashboard/quran`, `enrollments`, plus `grade-sheet`. **`grade-sheet` and `teacher/quran` stay hand-rolled and the reason is recorded**: their cells hold *live form controls* bound to per-row draft state, which `Column.cell` can render but which makes `DataTable`'s row-identity and action model a poor fit. The other five convert. | F |
| 3 | `calendar/level-selector.tsx` renders `level.name` bare. Its docstring argues the list is category-narrowed server-side — **true only once a Category is chosen**; with `الكل` selected the list spans Categories with ambiguous bare names (§4.4b: names are not unique across Categories). Converts to `levelLabel`. `LevelRef` must carry `category_name`; if the bootstrap does not return it the label degrades to the bare name, which `levelLabel` already handles. | F (+B if bootstrap lacks the field) |
| 4 | `MultiSelectField` conforms. The two *single*-choice large sets are the student pickers (§12 and the enrolment dialog): both are `SelectField` over a fetched list. The enrolment one already loads on open (fixed in R74). **`groups.tsx` `RosterDialog` still gates on `value.trim().length < 2`** — a typed-search workflow, the exact defect §4 forbids. Needs a shared **single-select searchable** primitive; `MultiSelectField` is the wrong shape (it is additive). | F |
| 20 | `SearchInput` + `ScopeSelectors` + `DataTable`'s `filtered`/`onClearFilters` are the system, and `NoResultsState` renders the reset through the shared `Button`. No hand-coded reset button found. Compliant. | — |
| 21 | **The `＋` convention is applied nowhere on a page-level Add button.** `MultiSelectField` uses `＋ {label}` internally; `enrollments`, `groups`, `users`, `levels`, `taxonomy`, `branches`, `scheduling` all render a bare-label `Button variant="primary"`. The inconsistency the Owner describes is real but inverted from the example — none of them carry it. Fix: an `add` variant on the shared `Button` that prefixes `＋`, applied at every create call site. | F |

### Enrolment

| § | Finding | Class |
|---|---|---|
| 8 | **Buildable with no new relationship and no schema change.** `POST /admin/teaching-groups/{id}/members` → `addMember` already exists; it resolves the student's branch through `Enrollment.branch_id` (`studentBranchInLevel`, R66) and refuses `NOT_ENROLLED_IN_LEVEL` and a duplicate `(student, subject, level)` with `409`. So the dialog orchestrates **two existing server calls in order** — enrol, then add each chosen circle — and every rule stays server-side. A circle carries **no branch**; it is `(Level, Subject)`, and membership is branch-scoped through the student's enrolment. The UI therefore offers circles by Level, grouped by Subject, and never implies a Group↔Circle link. Needs the flat read of §Z.1 to list a Level's circles across Subjects in one request. | F |
| 9 | **The implementation matches the SRS; the wording is what is unclear.** `unenrolStudent` → `releaseEnrollment` soft-deletes the `Enrollment`, releases that enrolment's circle seats, writes the R59 Trash entry and retains the audit trail. Exactly what the current copy claims. The gap is that nothing distinguishes *moving a placement* (the `تعديل` dialog, which also releases seats) from *ending the enrolment*. Fix is copy + a `dl` of what is and is not retained. **No logic change, no hard delete.** | F + D |
| 12 | See §4 above. Eligibility: BR-21 makes `(student, level)` unique, so "eligible" = not already enrolled in this Level — which is **not derivable client-side** from `searchUsers`. Resolution: load on open, exclude the current roster client-side, and let the server's existing `ALREADY_ENROLLED_IN_LEVEL` refusal (already surfaced as `admin.groups.alreadyInLevel`) answer the rest. **No role filter** — no structural fact identifies a مستفيدة (R64.7, still open), and filtering by role would hide exactly the students who need enrolling. | F |

## D. Cross-cutting safety review (§26)

| Rule | How this slice preserves it |
|---|---|
| BR-21 | Untouched. `enrolAtPlacement` still refuses a second enrolment per Level; §8's dialog surfaces the refusal. |
| R43.3 | Untouched. Circle **structure** Super Admin, **membership** Admin/branch-scoped. The circles table gates its own controls on the **active** role (R60); the server enforces regardless. |
| R43.4, R58 | Untouched. One `Exam` entity, audience = named group **or** the Level at the exam's branch. §5 changes only how exams are *listed*. |
| R66 | Untouched, and the §8 dialog depends on it: a group-less enrolment must be able to hold a circle seat. Covered by `group-less-enrollment.integration.test.ts`. |
| R73.4 | Untouched. `Subject.tracks_quran_progress` is not read by anything in this slice. |
| R10 | Untouched. §13 reports `levelCompletion` and computes no coverage. |
| R59 | Untouched. §9 is copy only; the soft-delete + Trash path is unchanged. |
| TD-2 | **No row changes.** §17 grants nothing — both nodes were already `ready`. §7's read is student-context (§4.3), not a matrix grant. §14 removes a button and keeps the endpoint. |

## E. Regression guards planned (§25)

Behavioural or registry-level, never CSS-class assertions.

1. `ADMIN_MODULES` administration order pins `categories, levels, subjects, level-subjects, level-surahs`.
2. Every `AdminModule` in `administration` is `SUPER_ONLY` (existing R61 guard — must keep passing after the reorder).
3. `TEACHER_MODULES` contains `/teacher/schedules` + `/teacher/content` and **no `/admin/*` path**.
4. Every teacher and admin module label resolves in the catalogue (existing guard).
5. Source guard: no `<table className="admin-table">` outside an allowlist stating each entry's reason.
6. Source guard: no `btn btn--` string outside `ui/button.tsx` and `ui/data-table.tsx`.
7. Source guard: every Level `<option>`/`SelectField` over levels goes through `levelLabel`.
8. Source guard: no i18n **string value** matches `§|TD-\d|BR-\d|R\d\d|مراجعة \d+`.
9. `SearchableSelect` opens with all options present before any input.
10. `exam-grades` renders a row per exam with no exam selected, and its `title` is `admin.nav.examGrades` in **both** list and detail state.
11. `grade-sheet` renders no `passed`/`failed` catalogue string.
12. Circles page lists circles with no Level/Subject chosen, and renders `إضافة حلقة`.
13. Quran curriculum lists every Level on load.
14. `users` renders no `admin.users.create`; `approvals` renders no `actions` slot.
15. Backend: student reads only **published** grades; a draft is absent; another student's grade is `404`; a parent reads the active child's and only theirs.
16. Backend: the flat circles read is branch-scoped for an Admin and unrestricted for a Super Admin.

## Z. The two decisions this slice needs

Both are **documentary**: no schema, no authorization change, no new domain
relationship, no contradiction with an approved rule. Neither is in the Owner's
stop list (§28.1–5). They are reported because `td3-routes.txt` states TD-3 is
the canonical contract and is *"derived from the SRS; never hand-edit"*, and
`docs/SRS.md` is immutable to the implementer.

### Z.1 — `GET /admin/teaching-groups` (flat, filtered, paginated)

**Why it is needed.** §11 asks for one table of all circles. TD-3.12 addresses
the collection as `/admin/levels/{levelId}/subjects/{subjectId}/teaching-groups`
— the pair that *is* a split. A flat table over that shape costs
*Levels × Subjects* requests; the current accordion exists precisely to avoid
that storm.

**What it would be.** The same rows, the same
`assertCanManageMembership` gate, the same branch scoping, with
`?level=&subject=&branch=&q=&page=` — every parameter a narrowing filter, none
required. A widened filter on an existing collection, not a new capability.

**Recommendation:** approve as a TD-3.12 addition. It is the fourth instance of
this project's recurring pattern — a capability that exists in a service with no
route wide enough to reach it (R69 `مواد المستوى`, R70.1 grade entry, R72
Teacher events, R74 enrolment).

### Z.2 — `GET /students/me/grades`

**Why it is needed.** §7, and §5.3 specifies the screen.

**Why it may need no revision at all.** TD-3.3's preamble already names
**grades** among the student-context reads resolved per §4.3, `/dashboard/student/grades`
is already in §14.1, and `GET /students/me/quran` shipped under that same clause
in M4b without an SRS change. The endpoint is unlisted in `td3-routes.txt`
alongside `/students/me/quran`, `/quran-students` and the `/quran-logs` writes —
so the registry already lags the M4 surface, and this would be the fifth entry
in that lag rather than a new kind of gap.

**Recommendation:** implement under TD-3.3's existing clause, and let the Owner
decide whether the registry is brought current for all five at once.

**Shape:** `{ data: [{ exam: { id, title, date }, level, subject, mark, scale,
status: 'published' }] }`. **Published only** — a draft is not merely hidden but
absent from the query. No pass/fail field, per §6. Acting student resolved by
`childContext` middleware, never from a path parameter (the TD-12 property R63
argued for). Not audited, per R63.6's reasoning for `GET /students/me`.
