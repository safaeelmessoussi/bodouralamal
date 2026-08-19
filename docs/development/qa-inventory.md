[Documentation](../README.md) › [Development](README.md) › **QA inventory**

# QA inventory

**What exists, how each part is currently verified, and where the gaps are.**

Derived from the repository on 2026-08-18 — the route table (`lib/route.ts` and
the admin module registry), `app.ts`'s 140 mounted operations, `openapi.json`
(107 paths / 141 operations), the TD-3 registry, and the test and harness files
themselves. **Not** from the SRS's intentions: this page says what is *built*.

## How to read the verification columns

The four are not interchangeable, and the distinction is the point of this page:

| Column | Means |
|---|---|
| **Unit** | A pure decision, asserted without a database or a browser |
| **Integration** | The real API against the real database, over HTTP |
| **Browser** | Chrome over CDP against the running stack — clicks, not markup |
| **Manual** | A human has driven it; nothing automated covers it |

A feature with integration coverage and no browser column **is not verified as a
product**. That gap is what this phase exists to close, and it is stated per row
rather than summarised.

## Areas

| # | Area | Surfaces | Unit | Integration | Browser | Notes |
|---|---|---|---|---|---|---|
| 1 | Authentication | `/login`, OAuth callback, refresh, logout | ✓ | ✓ `auth`, `auth-refresh`, `refresh-token` | — | TD-12 rotation covered at API level; no browser flow |
| 2 | Users | `/admin/users` | ✓ | ✓ `user-management` (27) | ✓ sorting | Eligibility filter added 2026-08-18 |
| 3 | Beneficiaries / enrolment | `/admin/enrollments` | ✓ | ✓ `educational-organisation`, `group-less-enrollment`, `user-management` (R79) | ✓ **17/17** — six person-shapes, WHO→WHERE narrowing, forged request | R27 + R79 traced end to end |
| 4 | Levels | `/admin/levels` | ✓ | ✓ `taxonomy` | ✓ reorder + sort | |
| 5 | Subjects | `/admin/subjects` | ✓ | ✓ `taxonomy`, `reference-data` | ✓ reorder + sort | |
| 6 | Categories | `/admin/categories` | ✓ | ✓ `taxonomy` | ✓ reorder + sort | |
| 7 | Branches | `/admin/branches` | ✓ | ✓ `branch` (both) | ✓ reorder + sort | |
| 8 | Administrative groups | `/admin/groups` | ✓ | ✓ `administrative-group` | ✓ reorder + sort | |
| 9 | Teaching groups / حلقات المواد | `/admin/teaching-groups` | ✓ | ✓ `teaching-group` | ✓ 9/9 reorder, sort | R78.1 |
| 10 | Course schedules / الجدولة | `/admin/schedules` | ✓ | ✓ `course-schedule` (both) | ✓ 12/12 edit | |
| 11 | Sessions / occurrences | `/admin/schedules/{id}/sessions` | ✓ | ✓ `session`, `session-page` | ✓ via edit + recorder | |
| 12 | Cancellation | session row action | ✓ | ✓ `notification`, `business-scenario` | ✓ 18/18 | |
| 13 | Restoration | session row action | ✓ | ✓ same | ✓ 18/18 | |
| 14 | Rescheduling | session override | ✓ | ✓ `notification` (R78.4) | **gap** | API-verified only |
| 14a | Event notice, optional | «إشعار المعنيين» after a save (R82.5) | ✓ | ✓ `notification-targets` | ✓ 19/19 `verify-notifications` | send / decline / repeat |
| 14b | Event audience | scope → recipients (R82.7) | ✓ | ✓ `notification-targets` | ✓ within 19/19 | Level · Branch+Category · Category-wide · global |
| 14c | Personal calendar | `GET /me/calendar` (R82.8) | ✓ | ✓ `notification-targets` | ✓ within 19/19 | asked as each of three people |
| 14d | Grade published | publish → notice (R82.4) | ✓ | ✓ `notification-targets` | ✓ within `verify-grading` | draft is silent; republish idempotent |
| 15 | Teaching profile | «الملف التدريسي» on **إدارة المؤطِّرات** (R88) | ✓ | ✓ `teaching-profile` (15) | ✓ 13/13 `verify-teaching-profile` | **planning data**; the screen says it grants nothing. Moved off `المستخدمون` 2026-08-19 — see 15b |
| 15b | إدارة المؤطِّرات | `/admin/teachers` | ✓ `teachers.test.tsx` (14) | ✓ `user-management` R88 block (5) | ✓ within 13/13 | population = live `teacher` role; a مؤطِّرة who also studies is listed, a beneficiary who does not teach is not |
| 15c | Staff-picker warnings | the scheduling form's مؤطِّرة + assistants (R90) | ✓ `staff-picker.test.ts` (18) | ✓ `teaching-candidates` (23) | ✓ 13/13 `verify-staff-picker` | four appraisals; **warnings never block**; assignment is the only authority |
| 15d | Class staffing on EDIT | `PATCH /admin/course-schedules/{id}` | ✓ | ✓ within the 23 | ✓ within 13/13 | **fixed 2026-08-19** — the form offered the controls and the server refused the key |
| 15e | Effective-dated staffing | `CourseScheduleStaff.effective_from/until` (R91) | ✓ `effective-staffing.test.ts` (14) | ✓ `effective-staffing` (24) | ✓ 13/13 `verify-effective-staffing` | **history is never rewritten**; one main per date; many assistants |
| 15f | One-off Session cover | «مؤطّرة هذه الحصة» on `/admin/schedules/{id}/sessions` | ✓ | ✓ within the 24 | ✓ within 13/13 | occurrence staffing **overrides** the schedule, and reaches nothing beyond it |
| 15a | Capability ≠ authorization | declared-everything teacher (R88.3) | ✓ | ✓ within the 15 | — | no roster, no Quran marker, no class in her calendar |
| 15 | Content library | `/admin/content`, `/teacher/content` | ✓ | ✓ `library`, `content`, `upload` | ✓ 16/16 recorder | |
| 16 | Session materials | materials dialog | ✓ | ✓ `session-page` | ✓ 22/22 | |
| 17 | Audio recordings | recorder, both entry points | ✓ | ✓ upload pipeline | ✓ 22/22 + 16/16, real MediaRecorder | |
| 18 | Student calendar | `/dashboard/student` | ✓ | ✓ `calendar`, `business-scenario` | ✓ within 18/18 | |
| 19 | Teacher calendar | `/teacher/schedules` | ✓ | ✓ `business-scenario` (staff) | **gap** | API-verified only |
| 20 | Public calendar | `/calendar` | ✓ | ✓ `calendar`, `calendar-bootstrap` | ✓ 18/18 both views | |
| 21 | Notifications | student dashboard section | ✓ | ✓ `notification` (18) | ✓ 18/18 | R77 + R78.2/4 |
| 22 | Quran | `/teacher/quran`, `/dashboard/student/quran` | ✓ | ✓ `quran` | **gap** | |
| 23 | Grades / exams | `/teacher/exams`, `/dashboard/student/grades` | ✓ | ✓ `grade`, `exam` | **gap** | |
| 24 | Approvals | `/admin/approvals` | ✓ | ✓ `approval`, `child-application` | **gap** | |
| 25 | Trash | `/admin/trash` | ✓ | ✓ `trash`, `trash-coverage` | **gap** | |
| 26 | Hijri calendar | `/superadmin/hijri-calendar` | ✓ | ✓ `hijri-calendar` | **gap** | |
| 27 | Settings | `/superadmin/settings` | ✓ | ✓ `setting` | **gap** | |
| 28 | Profile / personal | `/profile`, `/profile/register-child` | ✓ | ✓ `profile`, `family-link` | **gap** | |
| 29 | Registration | `/register` | ✓ | ✓ `registration`, `staff-registration` | **gap** | |
| 30 | Public landing / resources | `/`, `/resources` | ✓ | ✓ `public-branch` | **gap** | |
| 31 | Session page | `/session/{id}` | ✓ | ✓ `session-page` | **gap** | Tier rules API-verified |
| 32 | Role switching | header | ✓ | ✓ `active-role` | **gap** | R60 |
| 33 | Pending denial | every guarded route | — | ✓ `pending-denial` (136, derived from OpenAPI) | — | Widens automatically with the contract |

## Browser harnesses that exist today

**Every row below was RUN on 2026-08-19** and carries the count that run
produced — not a count copied forward. Three harnesses had to be repaired before
they could be counted honestly; those repairs are in the *Reconciliation* note
under the table.

| Harness | Area | Covers | 2026-08-19 |
|---|---|---|---|
| `verify-dialog-states.sh` | shared UI | **AG** — closed/open/close/reopen across 15 pages, from both the affected and the unaffected sets, plus page-flow impact and scroll ownership | 110/110 |
| `verify-sorting.sh` | 2, 3, 4–9 | R76 sort contract across four tables: one directed header, the actions column never sortable, order survives paging | 39/39 |
| `verify-reorder.sh` | 4–9 | R76 manual ordering on five screens; canonical order is the only state that offers the grip | 30/30 |
| `verify-portals.sh` | 21, 22 | **AP** — three portals, one frame: each menu reaches what its role may reach and nothing else; R87 §M gates «إدخال الحفظ» on real staffing | 26/26 |
| `verify-calendar-surfaces.sh` | 14c, 20 | **AO** — the five calendar surfaces against one contract matrix | 23/23 |
| `verify-recorder.sh` | 19 | R75 through a real `MediaRecorder`: pause/resume produce one file, the beforeunload guard holds | 22/22 |
| `verify-ux-slice.sh` | shared UI | **AG/AI/W** as rendered boxes — scroll ownership at two viewports, control geometry, sidebar `scrollTop` across a navigation | 22/22 |
| `verify-notifications.sh` | 12, 13, 14a–14c | **AM/AN** — asked as three different people: who sees what, who is told, and that declining tells nobody | 22/22 |
| `verify-public-calendar.sh` | 20 | قائمة / تقويم driven anonymously; **R83** — a cancelled occurrence leaves the ordinary projection and `include_cancelled=true` still carries it; the reason never leaks | 18/18 |
| `verify-enrolment-gender.sh` | 3 | R79 beneficiary identity across six person-shapes + R27/BR-21 Level narrowing | 17/17 |
| `verify-calendar-header.sh` | 20 | **AJ/AK** — region geometry at 1440px and 390px on both calendars, title drift, the table note against its table | 17/17 |
| `verify-library-recorder.sh` | 19 | The second recorder entry point, and the sort indicator | 16/16 |
| `verify-grading.sh` | 14d, 16 | R81 — the exam's own maximum, empty ≠ zero, publish notifies and a draft is silent | 16/16 |
| `verify-teaching-profile.sh` | 15, 15b | **AQ/X** — ownership of «الملف التدريسي», the population, Arabic weekdays, a range that survives a reload | 13/13 |
| `verify-effective-staffing.sh` | 15e, 15f | **R91** — the replacement as four identities: dated rows, Safa twice, per-date occurrences, and a handover that leaves the past alone | 13/13 |
| `verify-staff-picker.sh` | 15c, 10 | **AR** — five مؤطِّرات an administrator must tell apart; the appraisal, the assignment and the authority pair | **6/13 — KNOWN FAILING, see below** |
| `verify-schedule-edit.sh` | 10, 11 | «تعديل العنصر» — R50's scopes through the real dialog | 12/12 |
| `verify-student-flows.sh` | 22 | The beneficiary's own portal: calendar, library, memorisation, grades, account | 11/11 |
| `verify-calendar-filters.sh` | 20 | **AL** — a filter chosen in one view survives the switch, in the controls, in the URL **and in the other view's request** | 11/11 |
| `verify-circles-reorder.sh` | 9 | R78.1 — ordering حلقات المواد within a `(level, subject)` pairing | 9/9 |
| `measure-page-header.sh` | shared UI | Header layout measured in a browser at nine widths | 9/9 widths |

**453 of 460 checks across 20 harnesses**, plus `measure-page-header`'s nine
width measurements — 21 scripts in `scripts/dev/browser/` and 21 rows here.
**Nineteen harnesses are fully green; `verify-staff-picker` is at 6/13** and is
described immediately below rather than quietly excluded from the count.

### `verify-staff-picker` — 6/13, open (2026-08-19)

R91 replaced the class form's `StaffPicker` with the dated `StaffingPeriods`
editor, and this R90 harness has not been brought across correctly. Checks 6, 7,
8, 10 and 11 fail.

**Established:** «إضافة إسناد» is *not present* on the dialog the harness has
open, while a select offering the seeded مؤطِّرات *is* — which is `StaffPicker`'s
lead selector rather than the periods editor. The dialog is very likely not
rendering `ClassSection` for this fixture's row.

**Not established, and not guessed at:** whether the R90 fixture's schedule is
being typed as something other than a class by the list, or the form is opening a
different section. Both would be product findings; neither has been demonstrated.

**What this does NOT put in doubt.** Checks 1, 2, 9, 12 and 13 pass, and R90's
behaviour is covered by `teaching-candidates.http.integration.test.ts` (23 tests,
green) and by `verify-effective-staffing` (13/13), which drives the periods
editor with real data through the same form. What is unverified is this
harness's interface half.

### Reconciliation (2026-08-19) — what the old table was hiding

The previous table listed **ten** harnesses and claimed **181** checks. Eight
scripts existed and were cited from the rule each one guards in
[ux-architecture](ux-architecture.md#the-guards), but had never been added here;
two of the counts it did carry were stale (`verify-notifications` had grown from
18 to 22). **A file existing is not coverage** — running all nineteen found three
harnesses that could not have been counted:

* **`verify-portals`** — «إدخال الحفظ» absent from the مؤطرة's menu. **The
  product was right and the fixture was wrong.** The seed took
  `subject.findFirstOrThrow({ deletedAt: null })` — *whichever Subject sorts
  first in the development database* — and titled the schedule «حلقة الحفظ» on
  the strength of it. That Subject carries `tracks_quran_progress: false`, so
  R87 §M correctly hid the entry from somebody who staffs no Quran class. The
  seed now creates its own marked Subject.
* **`verify-public-calendar`** — 11/18, then a crash. It waited on `.cal-toolbar`
  (retired by R84 when the filters and the view switch moved into the one shared
  header), read the hand-rolled `.occurrence-list` that R84 replaced with the
  platform's `DataTable`, and asserted **R77's rule that R83 reversed**: a
  cancelled occurrence used to stay on the public calendar and now leaves it.
  Every check was **restated with its reason recorded, never deleted** — and the
  reversal kept a half that can still regress, so *omitted from the ordinary
  read* is now pinned beside *still carried by `include_cancelled=true`*.
* **`verify-sorting`** and **`verify-reorder`** — intermittent, naming a screen
  that worked. The readiness predicate looked for `.datatable__skeleton` and then
  accepted `.state` as ready; the shared `LoadingState` renders
  `.state[role="status"]`, so **the loading state satisfied the ready
  predicate**. Fixed in both; three consecutive clean runs each.

**The lesson is the one this page exists for:** a harness nobody runs decays
against the product exactly as documentation does, and it decays *silently* —
two of these three would have been counted as coverage by anybody reading the
directory listing.

## The gaps, ranked

Ordered by *what a user would notice first*, not by how easy each is:

1. **Rescheduling (14)** — the notification is API-verified; nobody has watched a
   student's calendar move.
2. **Teacher calendar (19)** — staff visibility is asserted through the API in
   `business-scenario`; the teacher's own screen is undriven.
3. **Grades / exams (23)** and **Quran (22)** — the two largest undriven
   surfaces, and both are editable tables, which is where defects hide.
4. **Approvals (24)** — a queue with irreversible actions.
5. **Registration (29)** and **Profile (28)** — the public entry paths.
6. **Trash (25)**, **Hijri (26)**, **Settings (27)** — Super-Admin-only, lower
   traffic.
7. **Role switching (32)** — R60's fail-safe is asserted at API level.

## Fixture inventory

Three tag families exist in the development database, and they are **not** the
same kind of thing:

| Tag | What it is | Lifecycle |
|---|---|---|
| `[تجريبي]` | The **intentional demo seed** — `prisma/seed/fixtures.ts`. Six people, a branch, a level, an exam. Idempotent and re-runnable | Keep. Backfilled with `sex` on 2026-08-18 |
| `[dev-scenario]` | The **browser-harness scenario** — `backend/scripts/seed-dev-scenario.ts`. Seeded per run, `--clean` removes exactly its own rows, and every harness traps `EXIT` to clean up | Ephemeral by design |
| `[dev-session]` | One **development session user** minted by `issue-dev-session.sh` | Keep; harmless |
| `[cprobe]`, `[scenario]`, `[http-*]` | **Stale probe and suite residue** from interrupted runs | Safe to remove; no code refers to them |

**A second lesson, from R79's backfill:** the migration raised `is_beneficiary`
from enrolment evidence, which is correct — but in a development database that
evidence includes rows earlier probe runs created, so the bootstrap Super Admin
came back marked. The seed now states what that account **is** rather than
leaving it to a column default, and the dev rows were corrected. **Evidence-based
backfill is only as clean as the database's history.**

**A third lesson, from R80:** `sex` was required at registration and **writable
nowhere else**, so every person staff created was permanently incomplete and no
migration could fix it. *A field required on one road in, and unreachable on the
others, is not a required field — it is a trap.* Check every creation path when a
column becomes mandatory, and check that a missing value can still be repaired.

**The lesson this phase already produced:** `[تجريبي]` had `sex = NULL` because
the seed predated R27, so the demo data could not satisfy a rule the platform
correctly enforced. A fixture that cannot pass is worse than no fixture — it
makes the product look broken. **Fixtures must be re-audited whenever a
normative field is added.**
