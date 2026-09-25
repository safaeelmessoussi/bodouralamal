[Documentation](../README.md) › [Development](README.md) › **QA inventory**

# QA inventory

What is built and how each part is verified. Derived 2026-08-21 from `lib/route.ts`, the admin module registry, `app.ts` (155 mounted operations), `openapi.json` (119 paths / 155 operations), the TD-3 registry and the test/harness files — not from SRS intent.

## Verification columns

| Column | Means |
|---|---|
| Unit | pure decision, no database or browser |
| Integration | real API against the real database over HTTP |
| Browser | Chrome over CDP against the running stack — clicks, not markup |
| Manual | a human drove it; nothing automated |

- Integration without a browser column = not verified as a product; stated per row.

## Areas

| # | Area | Surfaces | Unit | Integration | Browser | Notes |
|---|---|---|---|---|---|---|
| 1 | Authentication | `/login`, OAuth callback, refresh, logout | ✓ | ✓ `auth`, `auth-refresh`, `refresh-token` | — | TD-12 rotation API-level only |
| 2 | Users | `/admin/users` | ✓ | ✓ `user-management` (27) | ✓ sorting | eligibility filter since 2026-08-18 |
| 3 | Beneficiaries / enrolment | `/admin/enrollments` | ✓ | ✓ `educational-organisation`, `group-less-enrollment`, `user-management` (R79) | ✓ 17/17: six person-shapes, WHO→WHERE narrowing, forged request | R27 + R79 |
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
| 14 | Rescheduling | session override | ✓ | ✓ `notification` (R78.4) | **gap** | API only |
| 14a | Event notice, optional | «إشعار المعنيين» after saved create/reschedule/delete (R82.5) | ✓ `notify-confirmation` (8) | ✓ `notification-targets` (27) | ✓ 37/37 `verify-notify-ui` | delete commits first; send / decline / repeat |
| 14b | Event audience | scope → recipients (R82.7) | ✓ | ✓ in `notification-targets` | ✓ in 37/37 | Level · Branch+Category · Category-wide · global · deleted Event Trash snapshot |
| 14c | Personal calendar | `GET /me/calendar` (R82.8) | ✓ | ✓ in `notification-targets` | ✓ in 37/37 | three people |
| 14d | Grade published | publish → notice (R82.4) | ✓ | ✓ `notification-targets` | ✓ in `verify-grading` | draft silent; republish idempotent |
| 15 | Teaching profile | «الملف التدريسي» on المؤطِّرات (R88; renamed R105) | ✓ | ✓ `teaching-profile` (15) | ✓ 13/13 `verify-teaching-profile` | planning data, grants nothing; off `المستخدمون` since 2026-08-19 |
| 15b | المؤطِّرات | `/admin/teachers` | ✓ `teachers.test.tsx` (14) | ✓ `user-management` R88 block (5) | ✓ in 13/13 | population = live `teacher` role |
| 15c | Staff-picker warnings | scheduling form (R90) | ✓ `staff-picker.test.ts` (18) | ✓ `teaching-candidates` (23) | ✓ 13/13 `verify-staff-picker` | four appraisals; warnings never block |
| 15d | Class staffing on EDIT | `PATCH /admin/course-schedules/{id}` | ✓ | ✓ in the 23 | ✓ in 13/13 | fixed 2026-08-19 (server refused the form's key) |
| 15e | Effective-dated staffing | `CourseScheduleStaff.effective_from/until` (R91) | ✓ `effective-staffing.test.ts` (14) | ✓ `effective-staffing` (24) | ✓ 13/13 `verify-effective-staffing` | history never rewritten; one main per date |
| 15f | One-off Session cover | «مؤطّرة هذه الحصة» on sessions page | ✓ | ✓ in the 24 | ✓ in 13/13 | overrides the schedule only |
| 15g | Cross-branch occurrence audience | «الحضور من الفروع» (R92) | ✓ `session-audience.test.ts` (10) | ✓ `session-audience` (20) | ✓ 16/16 `verify-cross-branch` | override replaces; venue never moves |
| 15h | Class delivery حضوري / عن بُعد | `طريقة الحضور` (R97) | ✓ `delivery.test.ts` (21) | ✓ `delivery` (32) | ✓ 24/24 `verify-delivery` | one inheritance mechanism; online occurrence holds no room |
| 15i | Entering a class عن بُعد | «دخول الحصة» → `/classroom/{id}` (R98) | ✓ `classroom.test.tsx` (23) | ✓ `online-class` (38) · `online-class.http` (9) | ✓ 61/61 `verify-livekit-join` (R164, via `/rtc`; was 46/46) | real three-party room; expired/future/capability-only مؤطِّرة refused; guardian enters as the child; room derived, never stored; Staging browser joined over UDP 7882 |
| 15j | Recording an online class | «بدء التسجيل» (R99) | ✓ in `classroom.test.tsx` (30) | ✓ `session-recording` (23) · `online-class.http` (17) | ✓ in 61/61 | optional; survives tab close; صوت وصورة → MP4, صوت فقط → OGG; signed idempotent callback; beneficiary 403 yet sees «جاري التسجيل»; Staging 2-vCPU recording 1280x720 @ 29.99 fps (R164) |
| 15k | Importing a recording | «التسجيلات» (R99 C2) | ✓ in `classroom.test.tsx` (31) | ✓ `session-recording-ingest` (22) · `session-page.http` (19) · `upload.http` (14) | ✓ 27/27 `verify-livekit-ingest` | provider `completed` ≠ «متاح» (content row = availability); real OGG/MP4 played (`readyState`/`duration`); different-Level beneficiary 404; ordinary MP4 upload refused; manifest off → staging bucket untouched |
| 21 | Notifications end to end (UI) | Session cancel/reschedule · Event create/cancel · grade publish → recipient's bell | ✓ `notification-types` (6) · `notify-confirmation` (8) | ✓ `notification-targets` (27) · `session-audience` | ✓ 37/37 `verify-notify-ui` | |
| 15a | Capability ≠ authorization | declared-everything teacher (R88.3) | ✓ | ✓ in the 15 | — | no roster, no Quran marker, no class in calendar |
| 15 | Content library | `/admin/content`, `/teacher/content` | ✓ | ✓ `library`, `content`, `upload` | ✓ 16/16 recorder | |
| 16 | Session materials | materials dialog | ✓ | ✓ `session-page` | ✓ 22/22 | |
| 17 | Audio recordings | recorder, both entry points | ✓ | ✓ upload pipeline | ✓ 22/22 + 16/16, real MediaRecorder | |
| 18 | Student calendar | `/dashboard/student` | ✓ | ✓ `calendar`, `business-scenario` | ✓ in 18/18 | |
| 19 | Teacher calendar | `/teacher/schedules` | ✓ | ✓ `business-scenario` (staff) | **gap** | API only |
| 20 | Public calendar | `/calendar` | ✓ | ✓ `calendar`, `calendar-bootstrap` | ✓ 18/18 both views | |
| 21 | Notifications | student dashboard section | ✓ | ✓ `notification` (18) | ✓ 18/18 | R77 + R78.2/4 |
| 22 | Quran | `/teacher/quran`, `/dashboard/student/quran` | ✓ | ✓ `quran` | **gap** | |
| 23 | Grades / exams | `/teacher/exams`, `/dashboard/student/grades` | ✓ | ✓ `grade`, `exam` | **gap** | |
| 24 | Approvals | `/admin/approvals` | ✓ | ✓ `approval`, `child-application` | **gap** | |
| 25 | Trash | `/admin/trash` | ✓ | ✓ `trash`, `trash-coverage`, `trash-lifecycle` | ✓ `verify-trash-restore` (R169 §8, restore only) | purge un-driven |
| 26 | Hijri calendar | `/superadmin/hijri-calendar` | ✓ | ✓ `hijri-calendar` | **gap** | |
| 27 | Settings | `/superadmin/settings` | ✓ | ✓ `setting` | **gap** | |
| 28 | Profile / personal | `/profile`, `/profile/register-child` | ✓ | ✓ `profile`, `family-link` | **gap** | |
| 29 | Registration | `/register` | ✓ | ✓ `registration`, `staff-registration` | **gap** | |
| 30 | Public landing / resources | `/`, `/resources` | ✓ | ✓ `public-branch` | **gap** | |
| 31 | Canonical occurrence dialog + stable link | `/calendar?occurrence=<kind>:<id>&date=YYYY-MM-DD` | ✓ | ✓ `session-page` + content access | ✓ `verify-public-reader` | refresh/direct link, stale denial, public media, private tiers |
| 32 | Role switching | header | ✓ | ✓ `active-role` | **gap** | R60 |
| 33 | Pending denial | every guarded route | — | ✓ `pending-denial` (210, from OpenAPI) | — | widens with the contract; public file mint is a tested exception |

## Browser harnesses that exist today

Results are from the run named per row (2026-08-19 unless stated); none is copied forward. Scripts live in `scripts/dev/browser/`.

| Harness | Area | Proves | Result |
|---|---|---|---|
| `verify-dialog-states.sh` | shared UI | AG dialog states on 15 pages, page-flow impact, scroll ownership | 110/110 |
| `verify-sorting.sh` | 2, 3, 4–9 | R76 on four tables; found «التسجيلات» forwarding `sort_by=first_name` to a read lacking it (400, since `bab75ed`) | 39/39 |
| `verify-approvals-sorting.sh` | 2, 3 | C: طلبات الانضمام sorts on both columns | 7/7 |
| `verify-reorder.sh` | 4–9 | R76 manual ordering on five screens; grip only in canonical order | 30/30 |
| `verify-admin-navigation.sh` | — | R105 menu + R61 section; Admin = same order minus المستخدمون | 32/32 |
| `verify-legal-pages.sh` | — | P: `/privacy`, `/terms` linked from home, open signed-out, OWNER-INPUT markers | 8/8 |
| `verify-partners.sh` | — | N: «شركاؤنا» absent without a visible partner, present with one, withheld partner off | 1/1 + 3/3 |
| `verify-portals.sh` | 21, 22 | AP: three portals, role-bounded menus; R87 §M gates «إدخال حفظ المستفيدات» on real staffing | 25/25 |
| `verify-calendar-surfaces.sh` | 14c, 20 | AO: five calendar surfaces vs one contract matrix | 23/23 |
| `verify-recorder.sh` | 19 | R75 real `MediaRecorder`: pause/resume → one file; beforeunload guard | 22/22 |
| `verify-ux-slice.sh` | shared UI | AG/AI/W geometry, scroll ownership at two viewports, sidebar `scrollTop` | 22/22 |
| `verify-notifications.sh` | 12, 13, 14a–14c | AM/AN audience only: POSTs `/notify` itself, proves the resolver not the dialog | 22/22 |
| `verify-public-calendar.sh` | 20 | قائمة / تقويم anonymously; R83 cancelled occurrence only with `include_cancelled=true`; reason never leaks | 18/18 |
| `verify-enrolment-gender.sh` | 3 | R79 six person-shapes + R27/BR-21 Level narrowing | 17/17 |
| `verify-calendar-header.sh` | 20 | AJ/AK geometry at 1440px and 390px, dual-date order, table note | 19/19 |
| `verify-library-recorder.sh` | 19 | second recorder entry point; sort indicator | 16/16 |
| `verify-error-experience.sh` | 5 | expected-401 silence, offline, 429, branded 404 | 7/7 |
| `verify-unsaved-guard.sh` | 21 | unsaved-changes guard on every dismissal path; new-class form: no «نمط التدريس», five filters «الكل» (R163 §5) | 24/24 |
| `verify-registration.sh` | 13 | FAMILY registration: «أسجّل أبنائي» after unticking «أسجّل نفسي كمستفيدة» (R168 §1, R170 §2; `role-chooser.mjs`, `date-picker.mjs`), two children, DB rows created and not | 45/45 + 12/12 DB |
| `verify-role-requests.sh` | 10 | R168 §1, R169 §1, R170 on the real pages (`seed-role-requests-scenario.ts`): multi-role request with ranked circles, Admin per-role review (administration shown, no decision; first approval activates), Super Admin placement and مسؤولة/مشرفة عامة, existing account re-asking, closed «ماذا تريدين؟», «صفاتي وطلباتي» | 85/85 |
| `verify-whole-category-recording.sh` | 7 | R172 §1/§11: «تسجيل صوتي» for «كل مستويات الفئة»; names «مواد المستوى» when nothing is assigned whole | 7/7 |
| `verify-level-subjects.sh` | 7 | «مواد المستوى» (Staging 2026-09-23): bounded reads, every Level lists its Subjects, edit keeps an assigned Subject without `DUPLICATE` | 7/7 |
| `verify-operations-status.sh` | 10 | R169 §11 «حالة النظام»: refused anonymously, last in الإدارة, five counts, no payload/key/error text | 8/8 |
| `verify-trash-restore.sh` | 10 | R169 §8: deleted Subject circle offered «استعادة» (was «غير متاح — يتبعه سجلات أخرى»), seats reported | 6/6 |
| `verify-room-capacity.sh` | 10 | R169 §3: non-whole capacity refused before the wire; «not stated» when cleared | 8/8 |
| `verify-content-visibility.sh` | 24 | §14.1 visibility selector and request body; found the upload dialog clearing the page-filter Subject (CHANGES §10) | 24/24 |
| `verify-admin-navigation.sh` | 4 | R105 menu orders as rendered, both roles; nine الإدارة URLs asked of the server with an Admin token | 31/31 |
| `verify-teacher-portal.sh` | 5 | R106 teacher menu, `إدخال متى أنا متاحة`, allowed vs refused with a Teacher token | 25/25 |
| `verify-sorting-headers.sh` | 6 | §6 header sorting: text, numeric, date; not-sortable audit | 19/19 |
| `verify-grading.sh` | 14d, 16 | R81: exam's own maximum, empty ≠ zero, publish notifies, draft silent | 16/16 |
| `verify-teaching-profile.sh` | 15, 15b | AQ/X/AY «الملف التدريسي»; E: untouched profile closes without asking | 14/14 |
| `verify-guardian-child.sh` | 26 | R96.1 switcher: own QR, each child's `user_qr_ref`; forged child and revoked FamilyLink refused | 12/12 |
| `verify-user-qr.sh` | 25 | R96: four identities, four payloads, no PII/role; reference refused as credential | 11/11 |
| `verify-quran-entry.sh` | 24 | Section C: إدخال الحفظ as ten identities; R88/R91/R92 scope; مراجعة not inflating; forged Surah refused | 24/24 |
| `verify-occurrence-details.sh` | 23 | AT: one details dialog from four calendars; walks to the scenario month by ARIA label (stale 2026-09-01→09-22) | 13/13 |
| `verify-teacher-scheduling.sh` | 22 | merged مؤطرة surface: R93 assistant notice, R94 type picker read by option text, R140 Level list; repaired R165 §3; found exam 400 (R140 narrowing on every type) then 403 `WHOLE_LEVEL_OUT_OF_SCOPE` — fixed | 14/14 (2026-09-20) |
| `verify-notify-ui.sh` | 21 | clicks «إرسال الإشعار», reads the recipient's bell; R91/R92, Event deletion/cancellation, grade republish; no `prisma.notification.create` | 37/37 |
| `verify-cross-branch.sh` | 15g, 20 | R91 × R92: six identities on one combined occurrence | 16/16 |
| `verify-effective-staffing.sh` | 15e, 15f | R91 as four identities; handover leaves the past alone | 13/13 |
| `verify-staff-picker.sh` | 15c, 10 | AR: five مؤطِّرات marked before the choice, named after it, nothing disabled | 13/13 |
| `verify-schedule-edit.sh` | 10, 11 | «تعديل العنصر»: «نهاية التكرار» via the platform date picker, persisted, audience untouched; `seed-dev-scenario` now uses a live year | 13/13 (2026-09-20) |
| `verify-student-flows.sh` | 22 | beneficiary portal incl. حسابي enrolments (G); check 11 fixture-coupled (checks 1–3 cancel the only class) | 10/11 |
| `verify-calendar-filters.sh` | 20 | AL: filter survives the view switch in controls, URL, request | 11/11 |
| `verify-content-scope.sh` | 14 | D: مؤطِّرة's مكتبة المحتوى filters; admin reads refused | 14/14 |
| `verify-visibility-ui.sh` | 20 | B §D visibility tier per R50 scope; types addressed via `catalogue.mjs`, never by name (R168 §4); fixed a false pass (substring, bare `finish()`) | 20/20 (2026-09-21) |
| `verify-scheduling-types.sh` | 11 | R110 catalogue on أنواع الجدولة and the picker; no name typed (R168 §4) | 11/11 (2026-09-21) |
| `verify-academic-periods.sh` | 4 | R122 الفصول الدراسية; جارٍ from dates; year text on edit (AF); approval needs `academic_period_id` | 4/4 |
| `verify-attendance.sh` | 4 | R123 / R163 §3: public calendar offers «الحضور» to nobody; management `required` sheet → حاضرة; عطلة has none; found `GET /calendar` without credential — fixed | 6/6 (2026-09-20) |
| `verify-assessments.sh` | 6 | R124/R125 builder and paper; found the teaching route rendering the back-office sidebar | 6/6 |
| `verify-class-filters.sh` | 10 | R163 §5, R165 §2/§6/§7, R166 §2/§3, R167 §1: five filters, server-composed name, «السور», split (journey C → 200, one class; §4), «تعديل الحصة» one `PATCH /sessions/{id}`; found group-only classes publishing `level_id: null` | 20/20 (2026-09-21) |
| `verify-enrolments-dialog.sh` | 10 | R167: `GET /clock`, «إدارة التسجيلات», «إتمام المستوى» with `acknowledge_unmet`, «شهاداتي» + «تحميل PDF» as the student, PWA installable; reading «إتمام المستوى» writes the R10 coverage-cache row `--clean` did not unwind | 24/24 (2026-09-21) |
| `verify-recorder-crash.sh` | 10 | R168 §2 recorder-kill drill (~15 min, no clock switch): segments every ten seconds, SIGKILL, provider still «active», restart after ninety silent seconds, reconciler assembles `recovered_from_segments` `audio/mp4`; first runs found `<id>.m4a` → `<id>.m4a.mp4` | CHANGES 2026-09-21 (R168) |
| `verify-exam-scheduling.sh` | 10 | R136 sittings from الجدولة, `?source=&mode=` prefill, bare physical sitting named by the server (R166 §3); RTL at three widths | 92/92 (2026-09-21) |
| `verify-circles-reorder.sh` | 9 | R78.1 ordering within `(level, subject)`; one transient timing failure, 9/9 on re-run | 9/9 |
| `verify-circle-branch.sh` | 10 | R172 §15: circle in a branch, listed and filtered | 10/10 |
| `verify-weekly-follows-start.sh` | 4 | R172 §13: weekly class follows its start date on «تعديل» | 4/4 |
| `measure-page-header.sh` | shared UI | header layout at nine widths | 9/9 widths |

- 508 checks across 22 harnesses green in one pass on 2026-08-20 (+ nine header widths): a snapshot, not a running count; later harnesses run with their slice; rerunning all is a release activity.
- `verify-notify-ui` 37/37 on 2026-08-21 (C-01) is not folded into that total.
- A harness that substitutes an API call for the user action only confirms the layer beneath (`verify-notifications` vs `verify-notify-ui`); both stay.
- `verify-staff-picker` (closed 2026-08-20): R91 replaced `StaffPicker`'s single «المؤطّرة» selector with `StaffingPeriods` (one dated row per assignment; unstaffed = no rows); the add control renders `＋إضافة إسناد` (`Button variant="add"` carries the glyph), so exact-text matching failed; once reachable it found `StaffingPeriods` rendering bare names (R90 lost) — `markedLabel` and `Warnings` are exported from `StaffPicker` with a source guard against private copies. Probe: type `class`, `ClassSection`, legend «المؤطّرات وفتراتهن».

## The gaps, ranked

1. Rescheduling (14): no student calendar watched moving.
2. Teacher calendar (19): `business-scenario` only.
3. Grades / exams (23), Quran (22): largest undriven editable tables.
4. Approvals (24): irreversible queue.
5. Registration (29), Profile (28): public entry paths.
6. Trash (25), Hijri (26), Settings (27): Super-Admin-only.
7. Role switching (32): R60 fail-safe at API level only.

## Fixture inventory

| Tag | What it is | Lifecycle |
|---|---|---|
| `[تجريبي]` | demo seed `prisma/seed/fixtures.ts`: six people, a branch, a level, an exam; idempotent | keep; `sex` backfilled 2026-08-18 |
| `[dev-scenario]` | harness scenario `backend/scripts/seed-dev-scenario.ts`; `--clean` removes exactly its rows; every harness traps `EXIT` | ephemeral |
| `[dev-session]` | one dev session user from `issue-dev-session.sh` | keep |
| `[cprobe]`, `[scenario]`, `[http-*]` | stale probe/suite residue | safe to remove; unreferenced |

- R79's `is_beneficiary` backfill from enrolment evidence also counted probe rows (bootstrap Super Admin came back marked); the seed now states what that account is.
- R80: `sex` was required at registration and writable nowhere else; when a column becomes mandatory check every creation path and that a missing value is repairable.
- `[تجريبي]` had `sex = NULL` (seed predated R27); re-audit fixtures whenever a normative field is added.
