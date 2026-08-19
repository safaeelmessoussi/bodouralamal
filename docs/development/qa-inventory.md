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

| Harness | Covers | Last run |
|---|---|---|
| `verify-reorder.sh` | R76 ordering, five screens | 30/30 |
| `verify-notifications.sh` | R77 cancel → read → restore | 18/18 |
| `verify-schedule-edit.sh` | «تعديل العنصر» | 12/12 |
| `verify-recorder.sh` | R75, real `MediaRecorder` | 22/22 |
| `verify-library-recorder.sh` | Second entry point + sort indicator | 16/16 |
| `verify-circles-reorder.sh` | R78.1 حلقات المواد | 9/9 |
| `verify-sorting.sh` | Sort contract, four tables | 39/39 |
| `verify-public-calendar.sh` | قائمة / تقويم, anonymous | 18/18 |
| `verify-enrolment-gender.sh` | R79 beneficiary identity (six shapes) + R27/BR-21 Level narrowing | 17/17 |
| `verify-teaching-profile.sh` | R88 — ownership of «الملف التدريسي», population, Arabic weekdays | 13/13 |
| `measure-page-header.sh` | Header layout, nine widths | 9/9 |

**194 browser checks across eleven harnesses.**

> **This table is behind the directory** (noted 2026-08-19). `scripts/dev/browser/`
> also holds `verify-grading`, `verify-portals`, `verify-student-flows`,
> `verify-calendar-filters`, `verify-calendar-header`, `verify-calendar-surfaces`,
> `verify-dialog-states` and `verify-ux-slice`, each cited from the rule it guards
> in [ux-architecture](ux-architecture.md#the-guards) but never added here. The
> counts above therefore understate coverage; folding them in means re-running
> each for its current tally, which is its own task.

**The beneficiary-identification gap is closed** (R79, 2026-08-18): `is_beneficiary`
is a durable fact on `User`, independent of every role and of every enrolment. The
fixture set deliberately spans the six shapes — beneficiary-only, staff-only,
staff **and** beneficiary, a minor with no role at all, guardian-only, admin-only —
so the independence is demonstrable rather than argued.

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
