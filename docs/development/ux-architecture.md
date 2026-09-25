[Documentation](../README.md) › [Development](README.md) › **Platform UX & atomic design**

# Platform UX & atomic design rules

Cross-cutting: every UI request is interpreted *against* these rules. Counterpart of the [engineering constitution](engineering-constitution.md) (§2 *one component per concept*): this page names the concepts. It cites `docs/SRS.md` rather than restating it (§16.4); §14.1, §14.2, §14.4 and §20 are normative and the SRS wins. Letters follow writing order; a recurring letter names two rules, and both stand.

## A · Data-first pages
- A management page shows what it manages on arrival; no dropdown gate — the copy «اختاري X لعرض Y» is the trace `atomic-components.test.tsx` scans for.
- A detail never replaces the list: a row action opens it by query parameter (`?exam=`, `?level=`, `?student=`), never a path segment §14.1 does not list (§20 rule 16). A genuine detail workflow is exempt; say why in the module docstring.

## B · Standard page structure
- Title → description → primary action (if the page owns creation) → search/filters → table → pagination → row actions → empty state only when genuinely empty; the title never changes when a detail opens.
- The primary action lives in the layout's `actions` slot, never the table toolbar; a page not owning creation offers no create control and says where creation lives (`نقاط الامتحانات` → `الجدولة`, R56; §20 rule 16).

## C · One concept → one atomic component
| Concept | Component |
|---|---|
| Any button or call to action | [`ui/button.tsx`](../../frontend/src/components/ui/button.tsx) — `Button`, `ButtonLink`; variants `primary · secondary · ghost · danger · add` |
| Any list of records | [`ui/data-table.tsx`](../../frontend/src/components/ui/data-table.tsx) — `DataTable` + `Pagination` |
| The five UI states | [`states.tsx`](../../frontend/src/components/states.tsx) — loading · empty · no-results · error · no-permission (§14.4) |
| A Level, chosen or displayed | [`scope/level-select.tsx`](../../frontend/src/components/scope/level-select.tsx) — `LevelSelect`, `levelLabel`, `withCategoryNames` |
| One choice from many | [`ui/searchable-select.tsx`](../../frontend/src/components/ui/searchable-select.tsx) — `SearchableSelect` |
| Several choices from many | [`ui/multi-select.tsx`](../../frontend/src/components/ui/multi-select.tsx) — `MultiSelectField` |
| Any form field | [`ui/field.tsx`](../../frontend/src/components/ui/field.tsx) — `TextField`, `SelectField`, `DateField`, `NumberField`, `TextArea`, `CheckboxField`, `SearchInput` |
| A form in a dialog | [`ui/form-dialog.tsx`](../../frontend/src/components/ui/form-dialog.tsx) |
| Any destructive confirmation | [`ui/confirm-dialog.tsx`](../../frontend/src/components/ui/confirm-dialog.tsx) |
| A status or kind marker | [`ui/badge.tsx`](../../frontend/src/components/ui/badge.tsx) |
| Curriculum selector dependencies | [`hooks/use-scope-options.ts`](../../frontend/src/hooks/use-scope-options.ts) + `scope/scope-selectors.tsx` |
| The lead-plus-assistants shape | [`scheduling/staff-picker.tsx`](../../frontend/src/components/scheduling/staff-picker.tsx) |

- A different appearance is a documented variant (`danger`, `add`), never a second implementation; never hand-write a component's classes (`className="btn btn--secondary"` is a second button; `.button` / `.button.primary` was a second system).

## D · The Level label
- Always `{Category} — {Level}` through `levelLabel`, everywhere (§4.4b: Level names are not unique across Categories); a source carrying only `category_id` joins with `withCategoryNames`.
- Only exception: the Category is stated by the surrounding structure (Level cards under an `<h2>` naming it); a category-narrowed list is not that exception.

## E · Searchable dropdowns
- Opening shows the options; typing narrows client-side over the list handed over, never a data-loading trigger; prefix ranks above substring; below ~8 options the component hides the search box.
- A typed-search workflow is only for a dataset genuinely too large to send; say so.

## F · Filters
- The «no filter» option of every dropdown is the one word **«الكل»** (the Owner, 2026-09-25) — never «كل المستويات», «كل الفروع» or a per-field phrase; the field's label already says what «all» is of.
- Filters narrow visible data, never gate it; every API filter parameter is optional (`GET /admin/teaching-groups`: `level_id`, `subject_id`, `category_id`, `q`); no matches under a filter is `NoResultsState`, not `EmptyState` (§14.4).

## G · Add buttons
- Every create action is `<Button variant="add">`; the variant emits `＋`, a caller never types it.

## H · Tables
- Use `DataTable` (§14.2, §14.4, once); columns, actions, labels, empty copy, sorting and reordering are configuration.
- Exception: cells holding live form controls bound to per-row draft state — grade sheet, Quran log editor, Hijri month editor — allowlisted in the guard; a fourth means build an editable-table primitive. A calendar month grid is a `<table>`, not a list.

## AF · Ordering a list: sort is a question, drag is a decision
- Column sort is a temporary view: header is a `<button>`, asc → desc → asc (never back to unsorted), `aria-sort` on the `<th>`, only a `sortKey` column sorts, never actions; the server sorts (`?sort_by=&sort_dir=`).
- Drag is a persisted decision: «الترتيب» is no longer a typed number; the grip is a `<button>` with ↑/↓ (native drag is mouse-only); the client sends the sequence, the server assigns `display_order`; the optimistic order holds until the returned rows agree.
- `DataTable` derives the blocks itself and a blocked handle is disabled and explained, never hidden: `sorted` (visible order is not the business one) · `paged` (the server takes the exact live set) · `scope` (`Level` and `AdministrativeGroup` order within a parent, §2.2).

### Which tables sort, and which deliberately do not
- Server-side wherever it exists (R76.1): a sortable column is an endpoint contract.

| Sorts | Fields |
|---|---|
| الفروع · الفئات · المواد · المستويات · المجموعات الإدارية | R76's original five |
| حلقات المواد | `name` · `level` · `subject` (R78) |
| المستخدمون | `name` · `created_at` |
| المستفيدات | `student` · `level` · `branch` |
| المؤطِّرات (§6) | `name` |
| طلبات الانضمام (§6) | `applicants` · `submitted` |
| الجدولة (§6) | `type` · `title` · `when` · `branch` — client-side |
| مكتبة المحتوى (§6) | `title` · `branch` · `size` · `published` |
| نقاط الامتحانات (§6) | `title` · `date` · `level` · `subject` — the exam list |
| إدخال الحفظ (§6) | `name` — the roster, client-side |

- Not sortable: draft-bearing editors under active edit (grade sheet, Quran log editor, Hijri month editor) — §6 (Owner, 2026-08-26) narrowed the exclusion to those; `نقاط الامتحانات` and `إدخال الحفظ` sort their selection table, not the editor; Level surahs/subjects and a student's own grades/progress keep the domain's order; `account_status` on المستخدمون is not sortable (alphabetical order means nothing; the filter answers it).
- Dataset decides server vs client: paginated collections use `lib/sorting.ts` (allow-list; order ends in `id`); only `الجدولة` (three sources merged in `adapters/scheduling.ts`) and the whole `إدخال الحفظ` roster use `lib/sort-rows.ts` (typed accessors, `Intl.Collator('ar')` matching `ar-x-icu`, absent last both ways, stable); never reorder one page of a paginated collection.
- SRS R76 · `components/ui/reorderable.ts` (pure functions) · [API contracts](../architecture/api.md#manual-ordering-takes-the-sequence-not-per-row-numbers).

## AG · A notification is a delivered fact, and the screen must not pretend otherwise
- MVP types (R77, R78, R82, R83, R93) are delivered facts, not projections of calendar state; the one surface is the portal bell (AP); the preference/tier/channel framework is postponed and absent; sender choice is AN.
- Nothing is marked read by rendering — the reader presses «تم الاطّلاع» (R77.5: unread is withdrawn on reinstatement, read is corrected); a read notice stays; an empty bell says so and no empty card is mounted in main content; the unread marker is an inline-start border, a shape not only a colour (§14.4). SRS R77/R82/R83 · [API contracts](../reference/api-endpoints.md#notifications).

## AH · Recording is a second WAY to make a library item, never a second model
- A recording is an ordinary `EducationalContent` with `audio/*` MIME (§4.9, Revision 75) via the existing `initiate → PUT → complete` pipeline and `SessionContent` join — no new entity, endpoint or storage path, so consent gate, tiers, quarantine-on-replace and R14's quota apply unchanged; the recorder sits beside the uploader in one dialog and the phone-upload path is untouched.
- The component renders its own unsupported state naming the phone path (§14.4); `pause()`/`resume()` keep one `MediaRecorder`; the clock is UI only, `aria-live="off"`; Risk R-4 (iOS suspends capture) is accepted, with a standing warning, a `visibilitychange` notice and a `beforeunload` guard styled as a condition; a failed save keeps the blob (Risk R-9).
- The recording is the application's, not the screen's (Revision 172 §4): one module-level `RecordingSession` (`lib/recording-session.ts`; browser behind `Platform` in `lib/recording-platform.ts`); the recorder is a view bound by `origin.key`; `RecordingBar` at the root shows the controls on every page with «العودة»; chunks go to on-device IndexedDB every 10 s so `restore()` offers «حفظ»/«حذف» after a reload; Wake Lock; the track's `mute` event raises the capture-gap notice; the name is the server's suggestion (R172 §3: «تسجيل صوتي — المادة — من سجّلت — التاريخ الوقت»). SRS R75 · `lib/recorder.ts` · `lib/recording-session.test.ts`.

## AI · A selector dependency follows the business question, not the field order
- The domain decides the arrow; enrolment asks WHO → WHERE → HOW: المستفيدة depends on nothing · المستوى on the beneficiary (R27; BR-21 excludes only the Level she holds) · الفرع on the Level · مجموعة المستوى on Level and Branch (§4.4c, optional) · حلقات المواد on Level and Subject, independent of the group.
- Filtering beneficiaries by a chosen Level was the rule backwards; say the pair as a question before wiring it. Both directions narrow server-side (§4.4, rule O); `sex` never leaves the service.

## I · Empty states
- Use the shared states, never a hand-coded empty state or button; say which emptiness — nothing exists · nothing matches · the question does not apply (`split: false` on `حلقات المواد`: the Subject is taught to the whole Level).

## J · Navigation simplicity
- A menu-reachable page gains no second access path without a stated reason; breadcrumbs are for genuine hierarchy (the removed `الجدولة › {exam}` trail named a sibling as parent).
- A duplicate path to a sibling node is removed; a read-only hand-off naming the owning screen (`حلقات المواد` → `مجموعات المستويات`, R69.5) is kept.

## K · Business-concept separation
- Never visually merge what the model keeps separate: `Administrative Group ≠ Teaching Circle` (§4.4c, §20 rule 22); the enrolment form keys circles on the Level alone (a circle is `(Subject, Level)`).
- Orchestration calls existing endpoints in order; never a new endpoint doing both, never a new join table.

## L · Enrolment
- `Enrollment = Student → Level → Branch → AcademicPeriod` (R66, R122); `AdministrativeGroup` is an optional subdivision; `TeachingGroup` an independent placement under `(Subject, Level)`; a group-less enrolment is a placement, not a gap, and must hold a circle seat (`group-less-enrollment.test.ts`).

### An enrolment belongs to a semester, and «جارٍ» is read from its dates
- R122: the table carries a **الفصل** column `{السنة} — الفصل {n}` with a **جارٍ / منتهٍ** badge computed from the period's dates, never `deleted_at` (which means only *a human ended this early*; a finished semester keeps its row and reads **منتهٍ**; pre-R122 rows read **غير مسجَّل**).
- The form asks **الفصل الدراسي** before the group, defaults to the period covering today, and it is required; rule A still governs the list.
- «إنهاء التسجيل» is a soft delete into Trash (R59): releases circle seats, retains grades, Quran logs and audit; never a hard delete; the UI states what is kept.

### The identity of an enrolment is not editable
- `Student → Level → Branch → الفصل` is the enrolment; «تعديل التسجيل» edits only group and circles; moving a student is **إنهاء التسجيل** then **تسجيل مستفيدة**; the contract refuses identity edits (rule AF below); the confirmation says what ends · what is kept (the beneficiary and her other enrolments) · what may be done next.

## BE · الحضور — the register, and the two sheets it is
- The register lives inside the shared occurrence dialog (rule A). R123 states: `disabled` renders nothing (عطلة, حفل); `required` opens on the expected roster; `optional` opens empty, and the copy says which sheet; nobody is written as absent (attendance gates nothing, BR-11).
- Staff open the sheet; a beneficiary gets «تسجيل حضوري», never the roster (the server refuses her the sheet); a control the server would always refuse is not offered (rule O): «تسجيل حضوري» is hidden from a teen or child via server-derived `me.self_attendance_allowed`, and `self_or_staff` is withheld from the scheduling form where the Category forbids it (`Category.self_attendance_allowed`, carried on the Level like `default_visibility`; no Category name is read, §4.4b).
- A recurring نشاط is one row over many dates: every activity attendance call sends `?date=`.

## BF · الاختبارات — a paper, not a form designer
- One builder for a formal exam and a quick class test, differing by `target_kind` resolved server-side (§4.4c); four question kinds, up/down reordering, no drag library (§14.3); حفظ leaves a draft, إرسال confirms in Arabic and is irreversible; nothing autosaves or autosubmits; once sent every control is `disabled` and the page says so; the freeze is stated, not hidden (`409`).
- A beneficiary sees only her own paper (no roster, answers, key or route for them); her grade arrives through «نقاطي» once published; grading stays on «نقاط الامتحانات» (`Grade` keyed to the row).
- The target picker offers people, not identifiers (R125): the server's answer to *what may I address* (`studentsTaughtBy`, staffed occurrences, branch scope), not the boundary (rule O), composed from `SearchInput` + `SelectField`; a selection no longer offered is cleared. `/teacher/assessments` renders `AssessmentsView` inside `TeacherLayout` and imports no `AdminLayout`; a مؤطِّرة is an authorised author (`assertExamInTeacherScope`) — rule P's seventh instance (cf. `/teacher/exams`, R70.1).

## M · User-facing text
- No engineering reference reaches a user-facing surface (no `§4.4c`, `TD-12`, `BR-7`, `R66`, «بعد المراجعة 66», commit hash, route name); state the meaning. Comments citing the SRS are load-bearing; the guard scans string values only.

## N · Published data, and verdicts
- A student sees published results only; `status: 'published'` belongs in the server's `where`.
- No verdict label: the sheet reports mark, absence and publication state, no pass/fail badge; `Grade.passed`, `manual_pass_fail_override` and BR-12 stay in the model and still decide retakes, progression, re-enrolment; a manual override is still surfaced (provenance).

## O · Scope and authorization
### O.1 · A menu entry is never the enforcement (Owner, 2026-08-28)
- المستخدمون Super-Admin-only is enforced by `ACCOUNT_ADMIN_ROLES` in `user.service.ts`; the registry `roles` field only stops offering what the server refuses («enforce it server-side»); HTTP tests forge Admin requests against every account write and assert `403`; five operational screens read names from `/admin/directory` (R93: a smaller question, never a wider permission).
- A component never decides authorization: the caller passes the permitted dataset, the component renders it, the server is the authority; `LevelSelect`, `SearchableSelect`, `MultiSelectField` filter and fetch nothing (§4.4).
- Hiding is not enforcement (TD-2); affordances follow the active role (R60); a refusal is rendered, never pre-empted; never widen a permission to make a UI work.

## P · No duplicated engines
- Expose an existing service, resolver or policy; never a second implementation or a client-recomputed derived value: no client basis-point rounding (R8), no interim average formula (§10.1, R12), no coverage recomputation (§4.5, R10).
- The recurring shape is a complete capability with no route or node (inventory under AQ): when a screen seems impossible, check whether the service already does it.

## Q · Page responsibility
- One page owns one data domain (R69 removed stray Subject actions); read-only context is not ownership (rule J).

## R · Consistency over local optimisation
- Take the shared solution; if it cannot serve, improve the shared component (`ConfirmDialog` gained an optional `details` slot).

## S · Future change propagates
- A change to an atomic component reaches every usage automatically; guards assert the absence of a second implementation, not the presence of the shared one.

## AA · An occurrence's materials belong to the Session, and the content is the source of truth
- `Session ─ SessionContent ──< EducationalContent` (0..N); an Event has no content relationship (R43 retired `EducationalContent.event_id`); content is referenced, never owned or copied (§4.9); unlinking never deletes a file.
- Surfaced in the canonical occurrence dialog with one focused tier-scoped Session read on open (`GET /calendar` ships no materials; no second Session page); navigable both ways via `GET /library/{id}/sessions`; two independent gates — content through `visibleContentIds` (unseen answers `404`, §20 rule 17), sessions through the R109 calendar tier.
- Canonical: `SessionContent` · `POST /sessions/{id}/content` · `GET /library/{id}/sessions` · [`SessionMaterialsDialog`](../../frontend/src/components/content/session-materials-dialog.tsx) (link · upload-and-link · unlink) · `/calendar/sessions/{id}` (API coordinate, not a route) · `OccurrenceMaterials`. The Owner rejected swapping the phone month grid for an agenda (2026-09-07): keep seven weekday columns ([calendar architecture](../architecture/calendar-and-hijri.md#scheduling-is-schedule-driven)).

## AB · A deep link must be consumed by the page it points at
- A parameter nothing reads is worse than no link (`/resources?content_id=` landed unread; the library routes on `?level=` + `?content=`): carry every half, keep it focus not gate (rule A); `occurrence-link.test.ts` guards both the emitted link and the address read.

## AC · One order for row actions
- `contextual action(s) → تعديل → destructive`, enforced by `orderActions` in [`ui/data-table.tsx`](../../frontend/src/components/ui/data-table.tsx): destructive is the `danger` flag, edit the shared `common.edit` label; stable, applied before per-row availability.

## AD · A picker with an action is a picker, then an action
- `SearchableSelect` (or the field), then the action in `form__actions`; never a `.form__row` holding a field and a bare button (that grid is for two fields and top-aligns).

## AE · A dependency between selectors belongs to forms, not to filters
- `subjectId → levelId` exists so a form cannot offer a pair the server refuses (`SUBJECT_NOT_AT_LEVEL`, §4.4b); a filter has none (`GET /library` and the scheduling list take both as independent optionals); clearing the Level in a filter keeps the Subject, moving to another Level clears it.
- The mechanism is `mode` (default `form`, the strict direction), not a per-caller flag (a `subjectsUnscoped` boolean left `الجدولة` wrong, 2026-08-18); `useScopeOptions({ mode })` and `ScopeSelectors`' `mode` must agree ([`use-scope-options.test.ts`](../../frontend/src/hooks/use-scope-options.test.ts)).

### The dependent-selector contract
`useScopeOptions` answers these once; no page re-derives them.

| Event | Behaviour |
|---|---|
| Parent selected | children reload from the parent's own read |
| Parent changed | children clear eagerly, in `set` |
| Parent cleared | children clear — except a filter's Subject |
| Child no longer offered | cleared by reconciliation |
| Loading | the field is `busy` — disabled and announced |
| Empty | its own sentence (*this Level teaches no subjects*) |
| Unmet dependency | names the missing parent, in a form only |

## T · The page header is one block
- Title, description and action are one two-column grid: heading takes the free space (description up to `--measure-lede`, `min-inline-size: 0`), action as wide as its buttons with `align-self: start`; never a flex row (`flex-wrap: wrap` drops the action under the heading); below 44rem one column.
- Canonical: `.admin__head` / `.admin__heading` / `.admin__actions` in [`admin.css`](../../frontend/src/styles/components/admin.css), rendered by [`PortalShell`](../../frontend/src/components/portal/portal-shell.tsx); never per page, never `<br>`; measured by `scripts/dev/browser/measure-page-header.sh` (nine widths); `scripts/ci/check-shared-layout.sh` refuses a page stylesheet redefining it.

## U · Unsaved work is never lost to a stray click
- With changes: backdrop ignored, `Escape`/Close/إلغاء ask; without: all close; a save closes; never inescapable (≤ 2 clicks out).
- `dismissible` on [`Dialog`](../../frontend/src/components/ui/dialog.tsx) is the mechanism; [`FormDialog`](../../frontend/src/components/ui/form-dialog.tsx) decides from `dirty` (default `false`, hence guarded) via `ConfirmDialog`; forms report `dirty` through [`isDirty`](../../frontend/src/lib/form-dirty.ts), which takes both sides because fields are written in an effect after first render (see AY).

## V · A row action looks like an action
- Row actions are bordered buttons sized for a row (not `ghost`), destructive ones `danger`; `DataTable`'s `actions` renders the shared `Button` with `.row-action` for sizing only; focus ring is the global `:focus-visible`; never styled per page.

## W · The sidebar scrolls with the page on a wide screen; on a phone it is a drawer
- Since 2026-09-25 (the Owner — reverses 2026-08-17's sticky-with-its-own-scroll rule): at ≥ 60rem `.admin-nav` is `position: static`, compact (2.5 rem rows) and never has its own scrollbar; one page scroll reaches every entry. The «إخفاء/إظهار أقسام» toggle is hidden at that width — the sidebar is simply there.
- Below 60rem the toggle opens the drawer (`.admin-nav-panel`), unchanged.

### And it keeps its place across a navigation
- Every portal navigation is a full document load (no client router); afterwards the position is preserved and the active entry revealed only when needed, by the least movement; the page never moves (`scrollTop` on the container, not `scrollIntoView`).
- Canonical: [`lib/nav-scroll.ts`](../../frontend/src/lib/nav-scroll.ts), applied once in `PortalShell`; two `getBoundingClientRect()` calls, not `offsetTop` (relative to the sticky nav).

## X · A missing translation key must fail a test, not ship
- `t()` returns its argument on a miss (deliberately loud); [`i18n/resolves.test.ts`](../../frontend/src/i18n/resolves.test.ts) resolves every literal `t()`/`tList()` key; computed keys (`` t(`admin.section.${x}`) ``) belong to the registry guard that enumerates their values.

## Y · Show the dependency that refuses the action
- Show the relationship as the things, not a count (`المواد` lists linked Levels; `الفئات` keeps a count because *how many* is the question); showing a constraint never relaxes it.

## Z · Configuration the SRS already calls editable must be reachable
- `SystemSetting` is runtime-editable (§7); the grading scale lived there since R14 (§15.1) with no surface, as `legal.consent_text_version` before R42 — check for an unreachable value before adding a field.
- Check whether the SRS refused the shape and whether the refusal still stands: R58's rejection of a per-exam maximum rested on `grading.display_scale`, which R81 retired.

## AF · An identity field is refused by the server, not hidden by the form
- Remove it from the `.strict()` body schema (`VALIDATION_FAILED`), narrow the service patch type, prove it with a forged request ([`enrollment.http.integration.test.ts`](../../backend/src/controllers/enrollment.http.integration.test.ts): `level_id`/`branch_id` refused, row unchanged); the screen still shows the value as text with why and where it changes.

## AG · One scrolling region per overlay
- A dialog scrolls in its body only: `<dialog>` is a flex column with `overflow: hidden` and `max-block-size`, shrinking children carry `min-height: 0`, only `.dialog__body` has `overflow-y: auto` + `overscroll-behavior: contain` ([`dialog.css`](../../frontend/src/styles/components/dialog.css)); `select__options` lists are deliberate nested scrollers.

### And a closed dialog must consume no layout
- `display: flex` on `.dialog` once overrode the UA's `dialog:not([open]) { display: none }`; every `display` on `.dialog` is scoped to `[open]` and the closed rule is explicit; guarded by `check-dialog-hidden-when-closed.sh` (source) and `verify-dialog-states.mjs` (geometry); scroll ownership is measured by `verify-ux-slice.mjs` (`overflowY` auto/scroll, `scrollHeight - clientHeight > 1`, desktop and 390px).

## AH · A message belongs where the action is
- Four kinds: action beside the controls — `Feedback` · field under the input — `Field`'s `error` · page in place of content — `ErrorState` · form above its buttons — `FormDialog`'s `notice`.
- [`ui/feedback.tsx`](../../frontend/src/components/ui/feedback.tsx) replaced 25 hand-written copies in 20 files; it scrolls itself into view on change (`block: 'nearest'`); standing content is not an action message (allowlisted in the guard).

## AI · Controls are grouped, not scattered
- Related controls form one bordered segmented group, one emphasis at most: `[ قائمة | تقويم ]` and `[ السابق | اليوم | التالي ]`, every part `ghost`, the selected view filled, «اليوم» accented on its label only.
- `.cal-segmented` in [`calendar.css`](../../frontend/src/styles/components/calendar.css), used by `CalendarNav` and `ViewSwitch` on every calendar; `border-inline-start` on every child but the first; `outline-offset: -2px`; verified as rendered boxes at 1440px and 390px.

### AJ · One calendar header, and the title is centred on it
- One arrangement, [`calendar-header.tsx`](../../frontend/src/components/calendar/calendar-header.tsx): `[قائمة | تقويم]` · centred `صفر 1448 │ أغسطس 2026` · `[السابق | اليوم | التالي]`, then filters, then calendar/list; source order is the RTL order (no `direction`/`order`); a `1fr auto 1fr` grid centres the title on the header.
- Shape follows the data: a surface with no month omits centre and stepping together (no `showTitle` flag); month names come from the backend bootstrap through `CalendarTitle` (§20 rule 14; R31, R36).

## AP · Three portals, one frame — and a registry is what makes a screen exist
- Back office, teaching and beneficiary portals render the same `PortalShell` (header, sidebar, titled main, §14.4 no-permission, R83 scroll restoration); only the module list differs; a capability with no registry entry does not exist to its user (`/teacher/quran` had a page and no entry — rule P's eighth instance).
- Landing pages (مساحة التدريس, لوحة المستفيدة) stay a sentence and their menu until designed («حصص اليوم والقادمة» removed: it duplicated تقويمي); notifications live in the top bar as one bell rendering the same `NotificationList`, badge from the server's unread count.

## AS · A staffing control must be able to say WHEN
- R91 gave `CourseScheduleStaff` an effective period and withdrew the `(schedule, user)` unique index; a class composes `StaffingPeriods` (who · main/assistant · from · until): ordinary = Safa open → open; temporary replacement = Safa → 30 Nov · Amina 1–30 Nov · Safa 1 Dec → open; rest of semester = Safa → 15 Jan · Amina 16 Jan → open. `StaffPicker` stays for an exam sitting, a celebration and a single occurrence.
- A blank date is open-ended and the form says so; `''` becomes `null` once at the wire boundary; a new row defaults to assistant (one main مؤطِّرة per date); each of the server's three interval refusals has its own Arabic sentence; one-off cover belongs to the occurrence («مؤطّرة هذه الحصة»).

## AT · A shared component nobody opens is not a shared surface
- Three calendars passed `onOpenEvent={() => undefined}` to `EventDetailsDialog`; the guard asserts the wiring, not the import (every calendar renders `<EventDetailsDialog>` and no discarding handler); surfaces differ only by the caller's token.

### Two questions get two answers
- **التسجيلات** and **المواد المرفقة** each have their own heading and empty state; neither claims empty before a 200.

### Which section an item lands in is a SEMANTIC FACT, never a MIME inference (R99.10)
- The split is `origin = session_recording`; MIME decides only player and download; `FileUploader` carries «هذا تسجيل حصة», off by default, `AudioRecorder` sets it unconditionally (R99.12); the marker describes, never permits — `video/*` stays refused at `/uploads/*` (TD-9 video only via the ingestion pipeline, R99.8).

### The recording's NAME belongs to the server (R75.6, moved by R99)
- `recordingBaseName`/`defaultRecordingName` left `frontend/src/lib/recorder.ts` because R99 added a second producer (server-side capture); the algorithm is [`backend/src/lib/recording-name.ts`](../../backend/src/lib/recording-name.ts) and every surface receives `suggested_recording_name` from a read it already loads (focused Session read; library list).
- One namespace per Session (suffix from titles already linked, whatever produced them); convention unchanged (bare, then ` 2`, ` 3`); still a suggestion in an editable field, never read back.

### The extra page step is gone
- «فتح صفحة الحصة وموادها» and the frontend Session route are removed; library links carry kind, id and date to `/calendar`, whose focused read opens the one dialog.

## AU · A dependent form asks in the order the domain depends
- `إدخال الحفظ` asks whom → Level → Surah (`LevelSurah` decides; the form half of AE); one relevant option opens directly, several ask (never `level_ids[0]`); refusals `LEVEL_NOT_ENROLLED`, `SURAH_NOT_IN_LEVEL` proved by forged request (rule AF); the lookup gives names, `LevelSurah` which are taught — never `Array.from({ length: 114 })`.

## AV · One meter for every proportion, and the figure is never the colour alone
- `ProgressBar` is generic (value, total, label); the percentage is always text with full ARIA (`role="progressbar"`, `aria-valuemin/max/now/text`); RTL from the document (`inline-size` at inline start; `transform: scaleX()` rejected); zero is a value, distinct from *not in the curriculum*; CSS guarded by `scripts/ci/check-progress-css.sh`, not vitest (`?raw` on `.css` yields `''`).

## AW · A portal module must say whose record it shows
- Every beneficiary-portal module declares `childContext` (required by the type) because a guardian acting for a linked child reads the same portal.

### Reachability is not authorization, and this is the difference
- `canAccess` admits a guardian and checks `roles.includes('parent')` itself; authority is the approved `FamilyLink` verified against `X-Active-Child-ID` on every request (§4.3); no module `roles` widened, no student role, `actingForChild` defaults `false` (rule O).

### The tell was a documented intent the code contradicted
- `role-home.ts` sends a parent to `/dashboard/student` saying the active role decides whose record renders; the gate contradicted it — a comment stating an unimplemented intent is evidence.

## AR · Planning data advises the chooser; it never narrows the choice
- A screen may annotate the people in a list, never shorten it, disable an entry or gate submit; the R88 profile's four appraisals (*Subject not declared* · *Category not declared* · *not available then* · *clashing class*) are warnings (R88.4).

### The two questions, and which one may answer which
- *Would this person appear suitable?* — the R88 profile, which never decides. *May this person operate as teacher or assistant?* — only the assignment (`CourseScheduleStaff` / `SessionStaff`, §4.4c). Both halves asserted in API tests and browser.

### What this forbids in an interface
- No filtering (the only `filter` is the lead's exclusion from her assistant list, a server-refused duplicate); no `disabled` driven by a warning (`disabled` is the caller's authorization prop, R71.4); no prohibition copy («لا يمكن», «ممنوع», «غير مسموح»).

### *Not declared* is not *unavailable*
- An empty profile means not declared (R88.9): «لم تُسجَّل أوقاتها بعد» ≠ «غير متاحة في هذا الوقت»; a fully empty profile is said once; `monthly`/`yearly` recurrences say they cannot be evaluated.

### Quiet by default
- A candidate with nothing wrong renders nothing; a concern is a short marker on the option and named chips under the control, never on submit (rule AH).

### Written once, on the shared control
- The appraisal lives on `StaffPicker`; adopting it also removed `ClassSection`'s hand-written `SelectField` + checkbox `fieldset` (rule C, open since R71).

## AQ · A screen's population is what decides which operations it may offer
- A row action is offered to every row the screen lists; one that does not fit everybody belongs on a screen whose population fits (`الملف التدريسي` left `/admin/users`); per-row `available` is for *cannot apply right now*, not *belongs elsewhere*.

### A capability with no reach is this project's recurring defect — now ten (P)
- Granted → offered: `مواد المستوى` R26 → R69 · grade entry R43 → R70.1 · teacher activity authoring R43 → R72 · enrolment R66 → R74 · `/teacher/quran` menu entry M4 → R85 · teacher exam authoring R70 → R94 · `إدخال الحفظ` in the back office R73 → §C4 · `/admin/level-surahs` M4c → R105 · `/admin/quran` R73 → R105 · occurrence management for a مؤطِّرة R43 → R106 (TD-2 and `staffsSession` granted it; `/teacher/schedules` offered no way in).
- Grep the service for the verb before concluding a capability is missing; fixtures can hide one too (the seed's staffing loop skipped silently — 15 schedules, 0 staffing rows — and now throws, R106).

### AZ.1 · A refused deletion is not a stale-state conflict, and must not say «refresh»
- `409` carries two situations: `VERSION_CONFLICT` (refresh helps) and `STATE_CONFLICT` + `details.blocked_by` (it never will); `lib/blocked-by.ts` classifies on `details.blocked_by`, `null` otherwise, no contract change.
- The dialog stays open as the explanation, the destructive button withdrawn (not disabled); product words never table keys (`states.err.blockedBy.*`, with counts); the refusal keeps its `request_id`; `BlockedNotice` serves all five raisers of `assertNoBlockingReferences` (Category, Subject, Level, Branch, Room).
- Reported, not taken: the server's `message` still advises refreshing; a distinct `message_key` changes TD-3.8's envelope (Document Owner).

### The back office holds two populations, and they are not the same list
- `المستفيدات` (`/admin/enrollments`) = the people taught · `المؤطِّرات` (`/admin/teachers`) = the people teaching (what, which Categories, when free) · `المستخدمون` (`/admin/users`) = every account (identity, roles, branch scope, sign-in).
- `beneficiaries_only=true` and `role=teacher` are complements (R79); the population is asked of the server (`role=teacher`, rule F); Subject/Category narrowing runs over loaded profiles because the list endpoint carries no planning data.

## AO · The calendar contract — one architecture, five surfaces
| Surface | Data | Month-scoped | Filters | Row actions |
|---|---|---|---|---|
| `/admin/schedules?view=list` | definitions (schedules · activities · exams) | no | the admin set | yes |
| `/admin/schedules?view=calendar` | occurrences | yes | the same admin set | — |
| `/calendar` (both views) | public occurrences | yes | المستوى · النوع | no |
| `/dashboard/student` (both views) | her own occurrences | yes | المستوى · النوع · المادة · المجموعة · الحلقة | no |
| `/teacher` (both views) | her own occurrences | yes | الفرع · الفئة · المستوى · النوع · المادة · المجموعة · الحلقة | no |

- السنة الدراسية appears in no calendar filter; it remains required on the create/edit form.

### The filter section never depends on the view
- The row is built once per surface and handed to both views; month controls follow the data — a non-month-scoped surface withholds the month and `CalendarHeader` omits title and stepping together.

### A filter narrows; it never gates
- `REQUIRES` governs forms; in `mode="filter"` no field reads it; changing a parent clears a stale child and disables nothing.

### Which filters exist is an authorization question
- The caller names them (rule O): a beneficiary gets no الفرع or الفئة; a مؤطرة gets both, options restricted server-side.

### قائمة is a table everywhere
- One `OccurrenceTable` in `DataTable`'s language; no row actions on reading surfaces; the back office keeps its own definitions table.

### What the domain does not support, and is not faked
- الحلقة filters Session occurrences only (no `EventTeachingGroup` join, §4.4c, §20 rule 16); an Event has no location, only `EventBranch` scope rows, so *خارج المقرات* cannot be expressed and no fake Branch was created (open decision below); an event for every Level of a Category at a Branch needs no `EventLevel` rows (R82.7).

## AM · A calendar shows what is ON
- A cancelled occurrence leaves every calendar (R83.1, reversing R77: the notification answers *what happened*); the row is never deleted (status, reason, audit, notice kept; restore returns it; the schedule stays active); history asks `?include_cancelled=true`, opt-in; the exclusion is one `where` in `calendar.service.ts`.

## AN · Telling people is a decision, and it is asked after the fact
- A change commits alone; a separate authorization-checked request asks whether to notify (R82.5, R83.3, replacing R77.4's in-transaction notices); declining creates nothing; idempotency on `(user, target, type)`.
- The client names the kind of change, never recipients (a body naming recipients is refused); `ConfirmDialog` carries «بدون إشعار» through `cancelLabel`.

## AL · A view switch changes presentation, never the dataset
- قائمة and تقويم render one filtered set whose state lives above both: [`use-calendar-filters.ts`](../../frontend/src/hooks/use-calendar-filters.ts) holds the values, [`calendar-filters.tsx`](../../frontend/src/components/calendar/calendar-filters.tsx) renders the surface's fields (which exist is the caller's, rule O); the URL is the state (`?view=` plus filters, §20 rule 16).
- The views may read different sources (definitions vs occurrences); the shared thing is the filter values (subject and academic year stay out); `verify-calendar-filters.mjs` asserts the grid's own request carries `branch_id` after a switch.

## AM · One tickable choice — checkbox and radio are one component
- [`field.tsx`](../../frontend/src/components/ui/field.tsx) owns `field field--choice`: `CheckboxField` (boolean) or `ChoiceField` (radios; `name` required); never hand-write the label/input pair (2026-09-04: four copies had reappeared); one named exception, `schedule-sessions.tsx`, keeps its hint inside the label beside a `<strong>` until measured in a browser.

## AZ · One error experience, and expected responses are not errors
Owner decision (2026-08-26): a failure a person meets is a designed state.

### The three kinds, and the rule that they are different
- Page/region replaces the content that could not load (a failed table fetch, an unknown route); inline sits beside the failed action's controls; expected control flow is shown as nothing — the anonymous `/auth/refresh` 401 at startup is handled where it happens (`refreshAccessToken` returns `null`) and never reaches the error architecture (pinned by a regression).

### What a person is shown
- What happened in Arabic · what to do next · a stable public code (`BA-403`, `BA-NET`, derived from the class, not the server's `code`) · the server's `request_id` byte for byte · the TD-3.8 `code` when present; never a stack trace, SQL, table/column name, filesystem path, exception, secret, token or internal id.

### Two references, and never one pretending to be the other
- A `request_id` exists only when the request reached the server; otherwise a clearly labelled local report reference, unlike a `request_id` in shape, with the network line only when the network genuinely failed.

### Retry is offered only where retrying could work
- `offline`, `server`, `conflict`, `rate_limited`; never `forbidden`, `not_found`, `unauthenticated`; `401` offers signing in, a page-level failure a way home, an inline one neither.
- Scope: `ErrorState` (13 call sites; `DataTable` forwards the real error) renders the branded panel; the unknown route shares its copy; OAuth entry/callback redirect to `/login?error=<key>`, never the envelope; `/content-unavailable` (B-01) stays, `CONTENT_UNAVAILABLE` classifies to *unavailable*; nine ad-hoc `t('…Failed')` strings and dialog/row refusals stay inline (§2). Guards: `error-panel.test.tsx` · `scripts/dev/browser/verify-error-experience.sh`.

## AY · No Add/Edit form silently discards typing — and no pristine one nags
Owner decision (2026-08-25), both halves binding: no Add/Edit form may silently discard unsaved changes; no pristine one may show a discard warning.
- [`useUnsavedGuard`](../../frontend/src/lib/use-unsaved-guard.tsx) owns the behaviour (rule U); `FormDialog` is one caller and a bare `Dialog` adopts it directly: `branches.tsx` (rooms list), `users.tsx` (profile, roles), `approvals.tsx` (staff, placement, child), `session-materials-dialog.tsx`; `＋إضافة مقر`, `taxonomy.tsx`, `levels.tsx` moved to `FormDialog` + `isDirty`; `approvals/role-review.tsx` (R168 §1) holds no input (one dialog at a time — the act it starts replaces it, cancelling returns).
- `dirty` is `isDirty(current, pristine)` against the loaded record, never a captured-on-open snapshot; hydration, server-loaded values, defaults and validation errors are never dirty; a search box is not unsaved work.
- Guards in `atomic-components.test.ts`: no bare `Dialog` holding input lacks the guard; every `useUnsavedGuard` renders its `confirmation`; `scripts/dev/browser/verify-unsaved-guard.sh` (24/24) keeps `＋تسجيل مستفيدة` as reference.

### AY.1 · «Dirty» means *changed*, never *has content* (NEW E)
- الملف التدريسي computed dirty as *has any content*; the fix is `isDirty` against the record captured in the fetch (`lib/form-dirty.ts`); sort multi-select ids before comparing, availability ranges not sorted; place the browser check after one that saves content or it passes against the defect.

### AY.1b · A baseline may only hold fields the reader can CHANGE (2026-08-28)
- `studentId`, set by the opening row action, entered `＋تسجيل مستفيدة`'s baseline and the form was born dirty: a baseline enumerates what the reader can modify, not what the component holds; pinned in `verify-unsaved-guard.mjs` beside الجدولة and إضافة شريك.

## AX · A create/edit form contains every field that decides what is saved
Owner decision (2026-08-25): every field that materially determines the object is visible inside the form; pre-filling from page filters or context is allowed.
- Pre-fill, do not depend; changing a field changes the target; fixed by permission or context → disabled, never hidden (Replacement, R53); withholding a value is not hiding a field (Global / بدون فرع only for permitted callers, §4.9); the form runs its own `useScopeOptions` in `mode: 'form'` and re-proposes the Category's visibility default on Level change.
- The Content Upload dialog was the violation (its filter bar doubled as write scope); `ContentUploadForm` and `ContentRecorderForm` (closed 2026-08-27, §10) carry Level, Subject, Year, Branch and Visibility through the shared `useContentScope`; `session-materials-dialog` is borderline and the Owner's call (its scope is the Session's, a prop); every other screen submitting `level_id`/`subject_id`/`branch_id`/`academic_year_id` renders the control.
- A flag kept after its mechanism was removed guards nothing (`loadingSubjects = false` let a seeded Subject be cleared): the Subject list is derived during render, never in an effect; a form left mounted behind a closed dialog is a defect (both content dialogs mount only while open). Guarded by `scripts/dev/browser/verify-content-visibility.sh` (selectors present, seeded, editable on create, disabled on replacement, `/uploads/initiate` payload matches).

## AK · UI text is not prose, and does not take the prose measure
- `p { max-width: var(--measure) }` (64ch) is for read prose; UI text families are excepted once in [`tokens/layout.css`](../../frontend/src/styles/tokens/layout.css) (six components had patched `max-width: none` locally, a seventh invented `52ch`); prose keeps `--measure`, the page description `--measure-lede`.

## BD · An empty table keeps its columns
- Owner (2026-08-30): `DataTable` renders the empty/no-results message in a `<td colSpan>` spanning every column (grip and actions included), keeping headers, sort buttons, `aria-sort` and the nothing-here/nothing-matches distinction; loading (skeleton) and error (no columns) are unchanged.

## BC · A dialog does not re-fetch what its caller handed it
- A dialog receives the row, not an id to re-resolve (2026-08-29: `تسجيل مستفيدة`'s حفظ sent no request — a `beneficiaries_only` directory search missed a beneficiary listed through R79.7's union); the branch derives from the group (§4.4c) → the role assignment (R66) → an existing enrolment, and if none answers the form says so rather than disabling حفظ (rule AH).

## BB · A server invariant is stated at entry, and re-stated when its measure moves
- Origin (Owner, 2026-08-29): a class beginning 30 غشت 2026 with staffing 29 → 29 غشت refused `STAFF_PERIOD_OUTSIDE_SCHEDULE` (correct, §5, refused rather than clipped) only on Save. Three jobs: constrain (native `min`/`max`) · explain (a field error, rule AH) · enforce (the server, rule O); the first two are bypassable courtesies.

### The half that is easy to miss
- The measure can move without the row being touched (editing the class's start date): the marking is derived on every render (`error={rowError(row)}`); `StaffingPeriods` has no `useState`/`useEffect`, both absences guarded.

### The mirrored rule, and why it is allowed here
- `lib/staffing-period.ts` restates `withinScheduleLife` on the client, admissible only because it can never be permissive; the rule is OVERLAP, not containment (only a period sharing no day is refused), pinned including the anchor day.

## BE · A legally binding value is managed as the record it is, never as a detached string
- `legal.consent_text_version` as a text box in `إعدادات المنصة` versioned wording that lived in `i18n/ar.ts`; retired. A binding value is managed as its content: the Super Admin writes the Arabic wording, names it, reviews and activates it as a separate act (R119's `LegalConsentText`); what is in force is shown in full with its effective date, history read-only; an administrator never manages a hash or UUID.
- Immutability is shown before enforced (rule AF): each version shows its consent count, and a used version says new wording means a new version.

### The applicant's side: available in full, collapsed by default
- Owner (2026-09-02): an inline disclosure — a `<button>` with `aria-expanded`/`aria-controls` reveals the wording in place (region kept in the DOM, hidden with `hidden`, nothing sets `display`, rule AG); not a modal (the Law 09-08 explanation stays one); one `ActiveConsentText` feeds both the wording and the submitted version id; the checkbox label is a name, and what was agreed to is read from `LegalConsentText`, never an i18n key.
- Guards: `services/legal-consent-text.integration.test.ts` (immutability, single-active invariant, displayed-is-recorded, legacy evidence) · `services/setting.integration.test.ts` (exact key set; fails if the retired setting reappears) · `components/consent-notice.test.tsx` · `scripts/dev/browser/verify-consent-disclosure.sh` (`[hidden]` not defeated by author `display`; legend and notice apart).

## BA · A table shows every meaningful field of what it manages
- Owner rule (2026-08-27): every table shows all meaningful fields of the element it represents, by the reader's test; excluded: technical identity (UUIDs, versions, keys, hashes), audit plumbing (`created_at`/`updated_at`/`deleted_by` unless a person reads it), actions (rule AC).
- Show the row's own value, not its parent's (حصص الجدول shows the occurrence's `visibility` after an R109 override); a field the row lacks is a service change (المجموعات الإدارية's member count is derived per request, never stored); a derived field is not sortable (R76.1; `sortable-columns.test.ts` pins each in its `never` list).

## BG · A section that has nothing to offer says so — it never vanishes; and a long form asks what it must before what it may
- Revision 170 §1–§2 (Owner, 2026-09-21). A named place is always there: «صفاتي وطلباتي» renders for everyone who may have it — its content, the sentence saying why it is empty and when it will not be (rule I), or `ErrorState`; conditional rendering is for what a person may not HAVE, never for what is empty.
- The public registration form is the pattern for a long form: say the three steps first (the last, «تراجع الإدارة طلبك», is not hers); each section a card with a CSS-counter-numbered heading (`<fieldset>`/`<legend>` kept, legend floated inside); two columns where there is room, one on a phone, only fields pair up, items align start; required before optional (`NameFields` takes `afterRequired` and closes with one «بيانات اختيارية» block); a several-answer question with a usual answer is a closed `MultiSelectField` with that answer chosen, wrapping not truncating, the default never a lock.

## The guards
Behavioural or registry-level, never CSS-class assertions.

| Guard | What it pins |
|---|---|
| [`ui/atomic-components.test.tsx`](../../frontend/src/components/ui/atomic-components.test.tsx) | one Button and no second CSS system · the `＋` convention · one table with reasoned exceptions · one Level label · no engineering reference or data-gate copy in user strings · no pass/fail on the sheet · no account creation on `المستخدمون` · dirty-state wiring · AH one action message · AJ one calendar header · AL one filter state from the URL · AM one tickable choice |
| `i18n/resolves.test.ts` | X — every literal `t()` key resolves; `t()` still returns the key on a miss |
| `lib/admin-modules.test.ts` | §14.1's sitemap · R61's section rule · both R105 menu orders · the الإدارة curriculum order · dashboard cards = the menu (`dashboardCards`) · every label resolves |
| `lib/teacher-modules.test.ts` | the teaching nodes and sections; no `/admin/*` path in her menu |
| `pages/admin/teaching-structure.test.ts` | circles page reads unconditionally · R69.3 deep links are focus · BR-22 · R43.3 authorization |
| `components/grading/grade-sheet.test.ts` | N — empty ≠ zero · the scale is the server's · no verdict, override shown |
| `ui/data-table.test.tsx` | all five states and the action column |
| `lib/nav-scroll.test.ts` | W — position preserved, active entry revealed by the least movement |
| `pages/calendar.test.tsx` | AI — one segmented group, one emphasis |
| `enrollment.http.integration.test.ts` | AF/L — forged `level_id`/`branch_id` refused and unchanged; group settable; ending one enrolment leaves the other |
| `scripts/dev/browser/verify-ux-slice.mjs` | AG/AI/W as rendered boxes at two viewports, sidebar `scrollTop` across a navigation |
| `scripts/ci/check-dialog-hidden-when-closed.sh` | AG — no unconditional `display` on `.dialog`; the explicit closed rule survives |
| `scripts/dev/browser/verify-dialog-states.mjs` | AG — closed/open/close/reopen on 15 pages from affected and unaffected sets |
| `scripts/dev/browser/verify-calendar-header.mjs` | AJ/AK — region geometry at 1440px and 390px, title drift, Hijri-left/Gregorian-right, the table note's width |
| `components/calendar/calendar-header.test.tsx` | AJ — three regions; shape follows the data |
| `scripts/dev/browser/verify-notifications.mjs` | AM/AN — as three people: who sees what, who is told, declining tells nobody |
| `scripts/dev/browser/verify-calendar-filters.mjs` | AL — a filter survives the view switch in controls, URL and the other view's request |
| `grade.http.integration.test.ts` | N — published grades only, never another's, no verdict |
| `teaching-group.http.integration.test.ts` | the flat read grants nothing, every filter narrows, TD-10 pagination, Admin-only |
| `pages/admin/teachers.test.tsx` | AQ — the action left `المستخدمون` · the node exists beside `التسجيلات` · population by role, never excluding beneficiaries · one profile editor · X — `calendar.weekday` absent |
| `user-management.http.integration.test.ts` | AQ — `role=teacher` and `beneficiaries_only` are complements; a revoked role leaves the list |
| `lib/guardian-portal.test.ts` | AW — gate matches `role-home` · no child refused · no role widened · every beneficiary module declares `childContext` |
| `components/quran/quran-entry.test.ts` | AU, AV — one workspace · curriculum drives the Surah list, never 114 · never `level_ids[0]` · failed read ≠ empty roster · full ARIA meter, no second meter |
| `scripts/ci/check-progress-css.sh` | AV — logical sizing, clipped track, `prefers-reduced-motion` |
| `components/calendar/shared-details.test.ts` | AT — four calendars render the dialog, none discards the click · two sections, two empty states · nothing claimed before a 200 · the focused read carries the caller's token |
| `scripts/dev/browser/verify-occurrence-details.mjs` | AT — the dialog from all four calendars on a real Session, every focused read a 200 |
| `components/scheduling/staffing-periods.test.ts` | AS — blank date open-ended, converted once · one person on several rows · default assistant · each refusal its own sentence · BB — marking derived (no `useState`/`useEffect`) on both date fields |
| `lib/staffing-period.test.ts` | BB — client mirror of `withinScheduleLife`: the 29-vs-30 غشت case, anchor day, overlap not containment, `''` as ±∞ |
| `ui/empty-table.test.tsx` | BD — empty `DataTable` keeps `<table>`, headers, sort buttons, `aria-sort`, spans every column; no columns while loading or failed |
| `pages/admin/enrolment-save.test.ts` | BC/AH — the dialog takes the row, no directory search, fallback group → role → enrolment, حفظ gated only on the Level |
| `pages/admin/enrolment-period.test.ts` | R122 — the form asks, sends and defaults the semester; the badge reads the period; deleting `academic_period_id` fails it |
| `services/enrollment-period.integration.test.ts` | R122 — the Owner's four-step progression against PostgreSQL; an old-period enrolment is not current with `deleted_at IS NULL` |
| `components/calendar/attendance-ui.test.ts` | BE/R123 — عطلة renders no panel · «تسجيل حضوري» needs setting and capability · a beneficiary never reads the sheet · activity calls carry the date · `self_or_staff` withheld with reason · no Category name compared |
| `pages/admin/assessment-ui.test.ts` | BF/R124 — حفظ ≠ إرسال, only the second confirmed · no autosave/autosubmit · controls lock once sent · no route to another's answers, no score · up/down, no drag library, freeze stated, no grading |
| `services/assessment.integration.test.ts` | R124, 32 assertions against PostgreSQL — kinds, targets and reach, draft/submit/freeze, response validation, grade visibility, audit carries no text, the real grading path, R123 × R124 independence |
| `services/attendance.integration.test.ts` | R123, 37 assertions against PostgreSQL — `disabled` refused, optional/required sheets, `beyond_roster`, no absence row, self-mark rules (teen and child refused), roster from the occurrence date's period, two dates two sheets, audit carries no name, `HAS_ATTENDANCE`, the one exam-audience rule |
| `scripts/dev/browser/verify-academic-periods.sh` | R122/A/AF — الفصول الدراسية renders with no year chosen, a period created while unfiltered, جارٍ follows the dates, the year is text on edit |
| `scripts/dev/browser/verify-effective-staffing.mjs` | AS/R91 — the replacement as four identities, Safa twice, per-date occurrences, a handover leaving the past alone |
| `components/scheduling/staff-picker.test.ts` | AR/C — three sections delegate to the shared picker · exactly one `filter`, nothing `disabled` by a warning · every warning has its key · none reads as a prohibition |
| `teaching-candidates.http.integration.test.ts` | AR — the four appraisals, ranges never merged, *not declared* ≠ *unavailable*, `monthly` indeterminate · both halves of R88.3 |
| `scripts/dev/browser/verify-staff-picker.mjs` | AR — five مؤطِّرات in the real form: all offered, each marked in Arabic, nothing disabled, the profile-less one assigned anyway |
| `scripts/dev/browser/verify-teaching-profile.mjs` | AQ/X — 13 steps: no profile action on `المستخدمون`, the node, the three populations, the dialog from the clicked row, Arabic weekdays, a range surviving reload |

### A guard must be able to read what it guards
- Verify a new guard sees its input (`import.meta.glob(..., { query: '?raw' })` yields `''` for `.css` here); the tell is a guard that has never failed, so each guard is proven against a reintroduced fault. CSS invariants live in `scripts/ci/` beside `check-design-tokens.sh`; `node:fs` in a test is not the alternative (`scheduling-parity.test.tsx`).
- When code changes shape, restate the property, never delete the guard (three circles-page assertions pinned the accordion; one called `<LevelSelect` as a filter a violation).

## Open Owner decisions that touch these rules
| Decision | State |
|---|---|
| An Event has no location — *خارج المقرات* cannot be expressed (2026-08-19) | `Event` has no room, address or venue; `EventBranch` is scope, not location (a Session's place is its schedule's `room_id`). No fake Branch. Options: nullable `Event.venue_name` + `is_offsite`, or a `Venue` entity (depends on reusing named venues). Awaiting the Owner; meanwhile an event scoped to no branch reads «خارج المقرات» in the branch column. |
| No structural marker identifies a مستفيدة | Minors hold no role (§4.3), `intended_category_id` is unset on live rows, one live account holds `teacher` and `student`; every student picker offers every active account. R64.7's `Category.holds_own_login` decided by the Owner 2026-09-21 (Revision 170 §6): built in its own part. |
| `/admin/level-surahs` is not in §14.1 | M4c shipped it with «no SRS change»; its menu position follows §14.1's dependency order. |
| Two reads unlisted in TD-3 | `GET /admin/teaching-groups`, `GET /students/me/grades` — [audit](../archive/audits/audit-2026-08-17-ux-architecture.md) §Z; precedent `GET /students/me/quran` under TD-3.3, also unlisted. |
| A مؤطرة's Quran list shows names only | `/quran-students` returns `{ id, name_arabic }`; a coverage column needs that read widened. |
