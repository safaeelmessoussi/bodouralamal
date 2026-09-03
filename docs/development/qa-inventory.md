[Documentation](../README.md) › [Development](README.md) › **QA inventory**

# QA inventory

**What exists, how each part is currently verified, and where the gaps are.**

Derived from the repository on 2026-08-21 — the route table (`lib/route.ts` and
the admin module registry), `app.ts`'s 155 mounted operations, `openapi.json`
(119 paths / 155 operations), the TD-3 registry, and the test and harness files
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
| 14a | Event notice, optional | «إشعار المعنيين» after a saved create, reschedule or delete (R82.5) | ✓ `notify-confirmation` (8) | ✓ `notification-targets` (27) | ✓ 37/37 `verify-notify-ui` | delete commits first; send / decline / repeat |
| 14b | Event audience | scope → recipients (R82.7) | ✓ | ✓ within `notification-targets` (27) | ✓ within 37/37 | Level · Branch+Category · Category-wide · global · deleted Event Trash snapshot |
| 14c | Personal calendar | `GET /me/calendar` (R82.8) | ✓ | ✓ within `notification-targets` (27) | ✓ within 37/37 | asked as each of three people |
| 14d | Grade published | publish → notice (R82.4) | ✓ | ✓ `notification-targets` | ✓ within `verify-grading` | draft is silent; republish idempotent |
| 15 | Teaching profile | «الملف التدريسي» on **المؤطِّرات** (R88; renamed by R105) | ✓ | ✓ `teaching-profile` (15) | ✓ 13/13 `verify-teaching-profile` | **planning data**; the screen says it grants nothing. Moved off `المستخدمون` 2026-08-19 — see 15b |
| 15b | المؤطِّرات | `/admin/teachers` | ✓ `teachers.test.tsx` (14) | ✓ `user-management` R88 block (5) | ✓ within 13/13 | population = live `teacher` role; a مؤطِّرة who also studies is listed, a beneficiary who does not teach is not |
| 15c | Staff-picker warnings | the scheduling form's مؤطِّرة + assistants (R90) | ✓ `staff-picker.test.ts` (18) | ✓ `teaching-candidates` (23) | ✓ 13/13 `verify-staff-picker` | four appraisals; **warnings never block**; assignment is the only authority |
| 15d | Class staffing on EDIT | `PATCH /admin/course-schedules/{id}` | ✓ | ✓ within the 23 | ✓ within 13/13 | **fixed 2026-08-19** — the form offered the controls and the server refused the key |
| 15e | Effective-dated staffing | `CourseScheduleStaff.effective_from/until` (R91) | ✓ `effective-staffing.test.ts` (14) | ✓ `effective-staffing` (24) | ✓ 13/13 `verify-effective-staffing` | **history is never rewritten**; one main per date; many assistants |
| 15f | One-off Session cover | «مؤطّرة هذه الحصة» on `/admin/schedules/{id}/sessions` | ✓ | ✓ within the 24 | ✓ within 13/13 | occurrence staffing **overrides** the schedule, and reaches nothing beyond it |
| 15g | Cross-branch occurrence audience | «الحضور من الفروع» on `/admin/schedules/{id}/sessions` (R92) | ✓ `session-audience.test.ts` (10) | ✓ `session-audience` (20) | ✓ 16/16 `verify-cross-branch` | override **replaces**; venue never moves; next occurrence normal |
| 15h | Class delivery حضوري / عن بُعد | `طريقة الحضور` on the class form and the occurrence editor (R97) | ✓ `delivery.test.ts` (21) | ✓ `delivery` (32) | ✓ 24/24 `verify-delivery` | one inheritance mechanism; an online occurrence holds no room; October stays October |
| 15i | **Entering a class عن بُعد** | «دخول الحصة» → `/classroom/{id}` (R98) | ✓ `classroom.test.tsx` (23) | ✓ `online-class` (38) · `online-class.http` (9) | ✓ 46/46 `verify-livekit-join` | **بذور الأمل authorizes, the provider executes**; a REAL three-party room; expired/future/capability-only مؤطِّرة refused; guardian enters as the child; room derived, never stored |
| 15j | **Recording an online class** | «بدء التسجيل» inside the classroom (R99) | ✓ within `classroom.test.tsx` (30) | ✓ `session-recording` (23) · `online-class.http` (17) | ✓ within 61/61 `verify-livekit-join` | **optional and explicit** — joining records nothing; server-side capture survives the starter's tab closing; صوت وصورة → real MP4, صوت فقط → real OGG; signed idempotent callback; beneficiary refused 403 but still sees «جاري التسجيل» |
| 15k | **Importing a recording into the library** | «التسجيلات» on the Session page and the content library (R99 C2) | ✓ within `classroom.test.tsx` (31) | ✓ `session-recording-ingest` (22) · `session-page.http` (19) · `upload.http` (14) | ✓ 27/27 `verify-livekit-ingest` | **provider `completed` is not «متاح»** — availability is derived from the content row existing; a real OGG and a real MP4 **played by a real media element** (`readyState`/`duration`); the URL is Bodour's, never staging; different-Level beneficiary refused 404; ordinary MP4 upload still refused, marker or no marker |
| 21 | **Notifications, end to end through the UI** | Session cancel/reschedule · Event create/cancel · grade publish → the recipient's own bell | ✓ `notification-types` (6) · `notify-confirmation` (8) | ✓ `notification-targets` (27) · `session-audience` | ✓ 37/37 `verify-notify-ui` | the button a person presses, and the notice she reads |
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
| `verify-approvals-sorting.sh` | 2, 3 | NEW C — طلبات الانضمام reorders on both its sortable columns, proved against three scenario-owned pending applicants whose name order and submission order are different lists | 7/7 |
| `verify-reorder.sh` | 4–9 | R76 manual ordering on five screens; canonical order is the only state that offers the grip | 30/30 |
| `verify-admin-navigation.sh` | — | R105's menu and R61's section, clicked. **Restated 2026-08-28**: an Admin's list is the same order **minus المستخدمون**, since account administration is Super Admin's | 32/32 |
| `verify-legal-pages.sh` | — | **NEW P** — the homepage links to `/privacy` and `/terms` (Google's OAuth policy requires exactly that), each opens for a **signed-out** visitor without redirect, leaks no translation key, and shows its OWNER-INPUT markers rather than invented text | 8/8 |
| `verify-partners.sh` | — | **NEW N** — «شركاؤنا» on the landing page, in two passes: the section is **absent** with no visible partner (no heading, no empty frame, no «لا شركاء» message), then **present** once one exists, with a withheld partner still off the page | 1/1 + 3/3 |
| `verify-portals.sh` | 21, 22 | **AP** — three portals, one frame: each menu reaches what its role may reach and nothing else; R87 §M gates «إدخال حفظ المستفيدات» on real staffing. **The harness had kept the pre-R106 label and was failing quietly**; restated 2026-08-27 | 25/25 |
| `verify-calendar-surfaces.sh` | 14c, 20 | **AO** — the five calendar surfaces against one contract matrix | 23/23 |
| `verify-recorder.sh` | 19 | R75 through a real `MediaRecorder`: pause/resume produce one file, the beforeunload guard holds | 22/22 |
| `verify-ux-slice.sh` | shared UI | **AG/AI/W** as rendered boxes — scroll ownership at two viewports, control geometry, sidebar `scrollTop` across a navigation | 22/22 |
| `verify-notifications.sh` | 12, 13, 14a–14c | **AM/AN — AUDIENCE only.** Drives `/notify` through the API, so it proves who the server resolves and **nothing** about whether the dialog reaches that endpoint. `verify-notify-ui` is the proof of the feature | 22/22 |
| `verify-public-calendar.sh` | 20 | قائمة / تقويم driven anonymously; **R83** — a cancelled occurrence leaves the ordinary projection and `include_cancelled=true` still carries it; the reason never leaks | 18/18 |
| `verify-enrolment-gender.sh` | 3 | R79 beneficiary identity across six person-shapes + R27/BR-21 Level narrowing | 17/17 |
| `verify-calendar-header.sh` | 20 | **AJ/AK** — region geometry at 1440px and 390px on both calendars, title drift, physical dual-date order, the table note against its table | 19/19 |
| `verify-library-recorder.sh` | 19 | The second recorder entry point, and the sort indicator | 16/16 |
| `verify-error-experience.sh` | 5 | The error experience's live half: expected-401 silence, real offline, real 429, branded 404 | 7/7 |
| `verify-unsaved-guard.sh` | 21 | Unsaved-changes protection on every dismissal path, the pristine half, and the rendered new-schedule default | 24/24 |
| `verify-registration.sh` | 13 | The beneficiary registration journey end to end, plus the records it must and must not create | 13/13 |
| `verify-content-visibility.sh` | 24 | §14.1's visibility selector, operated in a real browser: state, selection, the request body, and the replace dialog's absence of one. **Three of its checks had been failing as assumed fixture noise and were one real defect** — the upload dialog cleared the Subject its page filter had seeded (see §10 in `CHANGES.log`) | 24/24 |
| `verify-admin-navigation.sh` | 4 | **R105's two menu orders as they RENDER**, both roles, plus the dashboard cards · an Admin typing each الإدارة URL · and the boundary a menu check cannot see: the same nine asked of the **server** with a real Admin bearer token | 31/31 |
| `verify-teacher-portal.sh` | 5 | R106's teacher menu and `إدخال متى أنا متاحة`, plus allowed-vs-refused probed with a real Teacher token | 25/25 |
| `verify-sorting-headers.sh` | 6 | §6 header sorting clicked — text, numeric and date, plus the not-sortable audit | 19/19 |
| `verify-grading.sh` | 14d, 16 | R81 — the exam's own maximum, empty ≠ zero, publish notifies and a draft is silent | 16/16 |
| `verify-teaching-profile.sh` | 15, 15b | **AQ/X/AY** — ownership of «الملف التدريسي», the population, Arabic weekdays, a range that survives a reload, and **NEW E**: an untouched profile that already has content closes without asking to discard | 14/14 |
| `verify-guardian-child.sh` | 26 | **R96.1** — a parent-only account driven through the account switcher: her own QR, two linked children in turn each showing that child's own `user_qr_ref`, back to her own, plus a forged unrelated child and a revoked FamilyLink both refused | 12/12 |
| `verify-user-qr.sh` | 25 | **R96** — four identities each seeing their own square, four distinct payloads, no PII or role, child context serving the child, and the reference refused as a credential with cookies cleared | 11/11 |
| `verify-quran-entry.sh` | 24 | **Section C** — إدخال الحفظ driven as ten identities: Admin and مؤطِّرة and assistant entry, حفظي's bars and history, reload persistence, whole-Level/Group/Circle rosters, R88 granting nothing, R91 both ways, R92 reached then narrowed, مراجعة not inflating, two-Level grouping, a forged Surah refused | 24/24 |
| `verify-occurrence-details.sh` | 23 | **AT** — the one details dialog opened from all four calendars on a real Session; two content sections; no page step; every focused read a 200 | 13/13 |
| `verify-teacher-scheduling.sh` | 22 | **The merged مؤطرة surface** — one node, the calendar+table page, a responsible selector offering only her, an activity she creates end to end with an assistant (asserted from the network layer), **R93's assignment notice in the assistant's own bell**, and **R94's type picker** — نشاط + امتحان, never حصة, with an exam saved against one of her own classes | 12/12 |
| `verify-notify-ui.sh` | 21 | **The notification pipeline as a person uses it** — clicks «إرسال الإشعار», logs in as the recipient, reads the notice from her own bell; R91/R92 recipients, Event deletion/cancellation, **and the grade-republish reactivation** | 37/37 |
| `verify-cross-branch.sh` | 15g, 20 | **R91 × R92** — six identities on one combined occurrence: audience, venue, calendars, notifications and staffing, each asked of the person it concerns | 16/16 |
| `verify-effective-staffing.sh` | 15e, 15f | **R91** — the replacement as four identities: dated rows, Safa twice, per-date occurrences, and a handover that leaves the past alone | 13/13 |
| `verify-staff-picker.sh` | 15c, 10 | **AR** — five مؤطِّرات an administrator must tell apart; all offered, each marked **before** the choice and named after it, nothing disabled, the one with no profile assigned anyway | 13/13 |
| `verify-schedule-edit.sh` | 10, 11 | «تعديل العنصر» — R50's scopes through the real dialog | 12/12 |
| `verify-student-flows.sh` | 22 | The beneficiary's own portal: calendar, library, memorisation, grades, account — including that **حسابي now carries her enrolments** (NEW G, check 10) | **10/11 — check 11 is fixture-coupled, not a defect.** Checks 1–3 cancel her class, and check 11 then needs a scheduled one to open. The diagnostic now lists the month's chips and reports **no class chip at all** — only أنشطة and one امتحان — so the calendar has nothing of that kind to open. Closing it properly needs the scenario to seed a second class the harness does not cancel |
| `verify-calendar-filters.sh` | 20 | **AL** — a filter chosen in one view survives the switch, in the controls, in the URL **and in the other view's request** | 11/11 |
| `verify-content-scope.sh` | 14 | NEW D — a مؤطِّرة's مكتبة المحتوى filters, and the admin reads still refused | 14/14 |
| `verify-visibility-ui.sh` | 19 | NEW B §D — the visibility tier on the forms, and where each R50 scope lands | 19/19 |
| `verify-scheduling-types.sh` | 10 | R110 — the scheduling-type catalogue on أنواع الجدولة and the الجدولة picker | 10/10 |
| `verify-academic-periods.sh` | 4 | **R122** — الفصول الدراسية renders and creates a period end to end, جارٍ is read from the period's own dates, and the academic year is text on edit (rule AF). **The screen the required `academic_period_id` depends on**: without it, approval refuses every applicant | 4/4 |
| `verify-attendance.sh` | 4 | **R123** — الحضور on the real pages: the occurrence dialog offers it, a `required` sheet opens on its expected roster, marking sends the request and the row reads **حاضرة**, and a **عطلة offers no attendance control at all**. It found a real defect in itself on the first run — the public calendar labels a class by its **Subject**, not by the schedule's title, so the needle was reading the wrong field | 4/4 |
| `verify-assessments.sh` | 5 | **R124** — the builder and the paper on the real pages: a **مؤطِّرة reaches بناء الاختبارات** and gets the builder rather than a pending placeholder, the published paper is on the beneficiary's list, **حفظ saves a draft**, and **إرسال asks first then locks every control**. It earned its keep on the first run twice over: the teaching route was rendering the **back-office sidebar**, and the submit assertion was finding the confirmation dialog's own button | 5/5 |
| `verify-circles-reorder.sh` | 9 | R78.1 — ordering حلقات المواد within a `(level, subject)` pairing | 9/9 |
| `measure-page-header.sh` | shared UI | Header layout measured in a browser at nine widths | 9/9 widths |

**508 checks across 22 harnesses, all green in one pass on 2026-08-20**, plus
`measure-page-header`'s nine width measurements — 23 scripts and 23 rows **as of
that date**. Every row in that pass was run together; none was carried forward.

**That total is a snapshot, not a running count**, and saying so is the fix for a
sentence that claimed *23 scripts in `scripts/dev/browser/` and 23 rows here* in
the present tense while the directory grew to more than twice that. Harnesses
added since carry their own result in their row and are run when the slice that
owns them is verified; re-running all of them is a release activity, not a
per-slice one. `verify-circles-reorder` failed once on keyboard-reorder timing
and passed 9/9 on re-run — recorded because a transient that is not written down
is one somebody re-investigates.

The C-01 slice reran the focused `verify-notify-ui` harness at **37/37** on
2026-08-21. The 508-check statement above remains the most recent complete
all-harness sweep; this focused result is not folded into that historical total.

### Why `verify-notifications` was green while the feature was not

It POSTs to `/notify` itself. That proves the **audience resolver** and the rows
it writes, and says nothing about whether pressing «إرسال الإشعار» reaches the
endpoint at all — which is the half a person experiences. A harness that
substitutes an API call for the user action under test can only ever confirm the
layer beneath it.

`verify-notify-ui` closes that gap: it clicks the real button, logs in as the
recipient, opens her own bell, and asserts the Arabic sentence she reads. **No
`prisma.notification.create`, and no direct notify POST.** Both files stay —
the older one covers audience shapes that would be laborious to drive through
screens.

### `verify-staff-picker` — closed (2026-08-20), and it was hiding a regression

Two layers were wrong, and only the second was obvious.

**Intentional UX change.** R91 gave an assignment an effective period, so a class
composes `StaffingPeriods` — one dated row per assignment — instead of
`StaffPicker`'s single «المؤطّرة» selector. An unstaffed class starts with **no
rows**, so there is no person select until one is added.

**Harness defect.** The add control was matched with
`textContent.trim() === 'إضافة إسناد'`, and the shared `Button` renders
`variant="add"` as **`＋إضافة إسناد`** — the platform's one add convention,
carried by the variant precisely so the glyph cannot be forgotten on the seventh
screen. Exact equality never matched, the row was never added, and the probe
reported an empty picker on a control that worked. A single form probe settled it
in one pass: type `class`, `ClassSection`, legend «المؤطّرات وفتراتهن», button
`＋إضافة إسناد`.

**And then it earned its keep.** With the row finally being added, check 5 failed
on a **real production regression**: `StaffingPeriods` rendered bare names, so
moving a class onto it had silently dropped R90's *visible before the choice*
half. The chips after selection still worked, which is exactly what made the loss
invisible. `markedLabel` and `Warnings` are now **exported from `StaffPicker` and
shared**, with a source guard asserting the periods editor holds no private copy.

**The lesson**: a harness that cannot reach its control reports the product as
broken *and* stops testing it. Both failures were in this one file, and the
second was only reachable once the first was fixed.

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
