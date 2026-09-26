[Documentation](../README.md) › [Architecture](README.md) › **Frontend**

# Frontend

React 19 + Vite 8, TypeScript strict. Runtime dependencies: `"react": "19.2.8"`, `"react-dom": "19.2.8"` only — no router, state library, component library, CSS framework, date library or HTTP client. Patch updates are permitted; new frameworks/components need Document Owner approval.

- Routing is a path switch: `resolveRoute(path)` in `lib/route.ts` is a pure function returning a closed `Route` union; `main.tsx` maps a decision to a component. A router joins only as an approved dependency when nested authenticated layouts arrive.
- `Dialog` is native `<dialog>`: `showModal()` gives focus trap, Escape, inertness and top-layer stacking.

## Structure

```
src/
  main.tsx           entry — providers, the path switch
  pages/             one per sitemap node
  components/
    ui/              primitives: button, card, container, dialog, icon, logo
    header/          the application header and its parts
    calendar/        the calendar's atomic components
    …                feature components
  adapters/          API payload → view model
  contexts/          session, active child
  hooks/             navigation, data
  lib/               api client, dates
  i18n/              the ar catalog and the lookup helpers
  styles/            tokens/ · base/ · components/
```

## The adapter layer

`adapters/` is the seam between the API's shape and the components' needs; a contract change lands in one file.

### The unchecked cast under this whole layer

- `api<T>()` asserts a shape and verifies nothing at runtime. A wrong adapter type compiles, passes tests built from the same type, is invisible to `curl`, and fails only in a browser as `undefined` (`adapters/hijri-calendar.ts` once declared `hijri_year`/`months`/`hijri_month_ar` for the real `year`/`data`/`month_name_ar`; `/superadmin/hijri-calendar` rendered blank).
- Two guards, failing on opposite drifts; neither replaces the other:

| Side | Guard | Catches |
|---|---|---|
| Server | HTTP test asserting the exact key set — `expect(Object.keys(body).sort()).toEqual([…])` (`toMatchObject` is blind to a missing field) | The API drifting from the contract |
| Client | A fixture literal typed as the adapter's own interface with the pinned key set (`pages/admin/hijri-calendar.test.tsx`) | The adapter type drifting — the typecheck fails |

- Never share one type between a read and a write response that differ: the Hijri write returns `hijri_year`, omits `month_name_ar`, and has its own `HijriMonthRecorded`.

### Mock adapters

Allowed while a screen's endpoints are unspecified; not licence to invent a contract — the endpoints still need a Document Owner revision (§20 rule 16).

- The interface is production, only the implementation is mock: types are the expected `snake_case` response; swapping in `api()` touches only the adapter's exports.
- No component, page or test touches the mock directly.
- The file states at the top that it is temporary, which endpoints are missing and what authorises them.
- Mock data exercises the layout (one of each kind, one empty group, one with many), not plausibility.
- Never document mock behaviour as production behaviour.
- `adapters/content.ts` is the example: no content endpoint exists — [gap analysis](../reference/api-endpoints.md#specified-not-yet-built).
- The calendar-occurrence type carries no raw name fields; the backend sends `display_name`, so the client cannot implement the forbidden fallback ([Security](security.md#on-public-surfaces), §20 rule 21).

### One API caller — `lib/api.ts`

- Access token only in `Authorization`; active child only in `X-Active-Child-ID`, per request; never a student id in body or query for authorization.
- The error class carries only the status; the rendering screen parses the body.

## Validation errors name the field

- The backend sends `details.issues` with an exact `path` (`applicant.first_name_arabic`, `child.last_name_french`, `branch_id`); `mapServerIssues` maps each `path` onto the form's field keys and marks the control.
- The `path` is used, not Zod's English message; a known path becomes our own Arabic message.
- Server `parent` maps onto form `applicant`.
- An unplaceable issue is surfaced verbatim, never dropped (`Unrecognized key` = stale client on a newer server).

## Mandatory UI states

- Every page and data-bearing component implements all six §14.4 states (Loading, Empty, Error, No permission, No results — distinct from Empty, with a clear-filters action — and Offline/retry); end-to-end tests assert them.
- A Pending user is hard-redirected by a global guard to the approval-status screen before any authenticated route renders; UX layer only — the server denial is the boundary; both tested independently.
- An Active account with no role renders the no-permission state.

## Navigation

- The sitemap is authoritative: no invented sections, no reshuffling; items render only for permitted roles; sidebar RTL-first.
- Status interstitials (approval-status, account deactivated) are redirect targets, not nav nodes: absent from the sitemap tree, still built.
- No "log out everywhere" node exists or may be added; revoke-all is internal (suspension, deletion).

### Breadcrumb

- The sitemap is flat per section (R69 gave `مواد المستوى` and `حلقات المواد` a node each). `PortalShell` takes an optional `breadcrumb`, rendered above the heading by [`components/portal/breadcrumb.tsx`](../../frontend/src/components/portal/breadcrumb.tsx): `المستويات › مواد مستوى «الثاني» › حلقات مادة «الفقه»`.
- Passed in, never derived from the URL (deriving invents ancestors §14.1 does not list — §20 rule 16); ancestors link with R69.3's `?level=` deep link.
- Fewer than two items renders nothing.
- Renders only for a session permitted to open the module (a crumb names a Level).

### Cache headers

| Path | `Cache-Control` | Why |
|---|---|---|
| `index.html` and every SPA route | `no-cache` | Revalidate before reuse; ETag → `304`; a deploy takes effect immediately |
| `/assets/*` | `public, max-age=31536000, immutable` | The filename changes whenever the bytes do |
| `/api/v1/auth/google` and its callback | `no-store` | R175 §5 — one-time `state`; a reused copy fails as `state_mismatch` |
| `/clear-cache` | `no-store` + `Clear-Site-Data: "cache", "storage"` | R175 §5 — one-visit origin reset; see [runbooks](../operations/runbooks.md#a-visitor-still-sees-the-previous-website) |

Rule: a content-hashed asset may be cached forever; the document naming it never (without it, heuristic caching ran the whole old bundle after a deploy). `Clear-Site-Data` stays on its own URL rather than the shell, or every ordinary visit would re-download the bundle (§2.2).

### The router must never return nothing

- `/dashboard` is not a §14.1 path; homes are role-specific: `/dashboard/student`, `/teacher`, `/admin` (R62 removed `/dashboard/parent`; §4.1b step 4a "role-based dashboard redirect").
- A `default` branch returning `null` is a blank page (§14.4). `AdminRouter`'s `AdminNotFound` was unreachable because `isAdminPath` is `moduleForPath(path) !== null`.
- The route test asserts `/dashboard`, `/nonsense`, `/admin-not-really` and `''` resolve to something; a `null` fallback fails six tests.
- `not-found` (§14.1 does not define the path) renders `NotFound` with a way home; `screen-pending` (§14.1 defines it, no milestone built it) renders `ScreenPending` naming why — the back office's `ModulePending` is the same distinction.
- `roleHomePath(roles)` resolves most-privileged first; `null` for no role hides the button (§14.4 Revision 16).

### Header guards

- `check-header-nav-exclusive.sh` asserts the burger and horizontal nav are mutually exclusive (a cascade-order bug once kept the burger visible; proven by reintroducing it).
- The dashboard link is an account control, not a site section; nav building is a pure function; the header is server-rendered in both states in tests.

## Shared components

The §14.3 registry (`StudentSelector`, `GroupSelector`/`LevelSelector`/`BranchSelector`, `PaginatedTable`, `DualDateDisplay`, `VisibilityBadge`/`VisibilitySelect`, `ConsentStatusBadge`, `FileUploader`, `ChildContextSwitcher`, `ApprovalCard`, `ConfirmDialog`, `EmptyState`/`ErrorState`/`NoPermissionState`, `JobStatusIndicator`) is build-once-reuse; duplicating one per page is prohibited.

- `ChildContextSwitcher` is the `ولي الأمر` group inside the one account switcher (R62.9): selecting a child sets active role and child in one action.
- `DualDateDisplay` renders the Gregorian date alone when the Hijri month is unpublished — no placeholder, no guess.
- `Dialog` has a `wide` variant for lists.
- Behavioural contracts live in [Platform UX & atomic design](../development/ux-architecture.md); this is a register.
- `SearchableSelect`: one choice from a large set, options shown on open (replaced pickers showing nothing before two typed characters).
- `Button variant="add"` emits the `＋` convention.
- `withCategoryNames` joins a Category name onto Levels carrying `category_id` so `levelLabel` renders `{Category} — {Level}`.
- `.button` / `.button.primary` in `status-pages.css` (a second button system, ten call sites) was deleted for `ButtonLink`.

## The calendar page

Atomic components: title, navigation, filter toolbar, three filter selects, grid, day cell, event chip, day dialog, details dialog.

- Order, each a centred block: eyebrow `الجدول الزمني` (the `<h1>`) → dual title (`يوليوز 2026 │ محرم 1448`) → `السابق · اليوم · التالي` → `[branch] [category] [level]` → grid.
- The month name appears once, in the title (test: the nav has none). `اليوم` is primary, the others secondary; it moves the month without opening the day dialog. Visible `السابق`, accessible name `الشهر السابق` (test: containment, WCAG 2.5.3). Navigation preserves every filter.
- `GET /calendar/bootstrap` returns the chrome (Hijri days, month metadata, categories, levels, branches; cached 5 min + ETag); `GET /calendar` returns self-sufficient occurrences (uncached). Opening a day or event costs no request ([occurrence self-sufficiency](calendar-and-hijri.md#the-calendar-screens-two-requests)); the details dialog has no loading state.
- The client computes no dates (§20 rule 14): the title renders `gregorian_months` and `hijri.months` as assembled (one → one name, two → slash-joined). `hijri.days` is keyed into a map; the cell coordinate row is LTR in the RTL page: Hijri left, Gregorian right.
- Absence renders as absence: an unrecorded Hijri month shows no number (slot reserved); no recorded month → Hijri title side and divider omitted; a field not sent is absent from the details dialog.
- The Hijri title side has no fallback; the Gregorian side falls back to the displayed month (client state, same i18n list as the dialogs).
- `aria-live="polite"` is on the title (tested).
- Day click → day-programme dialog (replaced a panel under the grid); event click → record dialog.
- A category change re-requests the bootstrap with `category_id` and the server returns that category's levels (§4.4); the level selector has no category prop; the page resets the level.
- `Dialog` uses `useId` for `aria-labelledby` (a hardcoded `dialog-title` collided with two dialogs mounted).
- The grid's [responsive month design](calendar-and-hijri.md#scheduling-is-schedule-driven) also serves personal and administrative calendars; authentication changes the API tier, not the chosen filters; profile defaults must not replace the view during the refresh-cookie exchange (test with a populated profile).

### Installable, and deliberately NOT offline (R167 §4)

- `/manifest.json` (standalone, RTL Arabic, 192/512 icons + maskable), `/sw.js`, «تثبيت التطبيق» in the top menu — desktop bar and mobile sheet, signed in or not.
- `lib/install-app.ts` `installOffer` (pure, unit-tested): the browser's install sheet where `beforeinstallprompt` fired (Chrome, Edge, Samsung Internet, Opera; the event is held at module level); Share-sheet steps on iPhone/iPad; browser-menu steps on other phones; nothing once installed or on a non-installing desktop.
- The service worker caches nothing (it exists only because some browsers require one to install); a unit test holds it to no `respondWith` and no cache write. The API is never cacheable; a private recording must never be readable after its permission is gone; an offline mode is a separate decision with privacy consequences.
- `sw.js` and `manifest.json` are served by `location /` → `no-cache`.

### Printing one certificate (R167 §3)

- «شهاداتي» prints one certificate as A4-landscape PDF via the browser's print-to-PDF (real selectable Arabic text; nothing generated, stored or sent; no dependency).
- The document renders into a portal under `<body>` (`.certificate-print-root`); `html.print-certificate` is set during that `window.print()`; the print stylesheet sets `display: none` on every other `<body>` child (hidden boxes still print blank pages); a named `@page` asks A4 landscape; the box is `297 / 209` (`297 / 210` spills a blank page); every length in `cqw`.

## The educational library

- `/resources` (§5.2, §4.9): a level index grouped by category, and one level's contents grouped academic year → branch.
- §14.1 defines one resources node, so views are `?level=` (a path segment would be an unlisted nav node, §20 rule 16). R167 §5 added `?category=` «كل مستويات الفئة» (`whole_category`): the index opens each Category with its card and counts those items there; the item carries a «لكل مستويات الفئة» badge wherever listed.
- Category order is a page constant `المرأة → اليافعات → الطفل` (R121 — the association's names; R27's sex-neutral forms matched no row), neither alphabetical nor `display_order`; unrecognised categories sort last, never dropped.
- Academic years `YYYY-YYYY` (TD-6) sort as strings, newest first.
- Divergence reported, not resolved: §5.2 pins `is_current` at top (differs only if a future year is recorded); §5.2's Subject tier beneath Branch is a card badge, not a fourth grouping — [gap analysis](../reference/api-endpoints.md#specified-not-yet-built).
- Filters narrow the held response (filtering your own result set is allowed; filtering server-owned reference data is not — the calendar re-requests); options come from present content.
- Preview (§14.6): PDF — inline `<iframe>` + download; video/audio — native `<video>` / `<audio controls>` + download; image — full-width + download; Office document — download only, no in-browser rendering in the MVP. Native elements, no player library (the CSP admits no external script host).
- The URL is fetched when the dialog opens, never with the list: a short-lived presigned GET after a server-side permission check (§3.1, TD-12). A long recording can outlive its URL; the viewer's retry re-mints; pre-emptive refresh is a Document Owner decision.

## The active role drives the whole interface (R60)

- Presentation reads `activeRoles`, never `me.roles`; `/me` reports every role (R60.9) for the switcher's menu only.
- `useActiveRole()`: `roles` → the switcher's menu, nothing else; `activeRole` → labels ("you are working as …"); `activeRoles` → everything else (navigation, dashboards, route guards, write affordances). `activeRoles` is `[activeRole]` because `visibleModules`, `roleHomePath`, `canAccess` take a list.
- Defects fixed at thirteen sites: `لوحة التحكم` sent a Super Admin working as مؤطِّرة to `/admin`; the sidebar listed Super Admin modules to someone acting as Admin.
- `scripts/ci/check-active-role-presentation.sh` fails on a direct read, destructuring from `me`, or `roles` from the context; a source scan, not ESLint (no plugin config, twelve such guards, no dependency to pin — §3.1a); it cannot catch laundering through an intermediate.
- Four files may read the full list: the context, the session fetching `/me`, the switcher, `hasMultipleRoles`; the wrong-role screen asks `switchableTo(candidates)`.
- Write affordances follow the active role.
- Same rule for data: a selector feeding a validated pair is populated from that pair's source — `حلقات المواد` uses `listLevelSubjects(levelId)`, not `listSubjects` (§4.4c; every option produced `SUBJECT_NOT_IN_LEVEL`). A control that can only be refused is the defect; an empty correct list is a named state linking to `مواد المستوى` (like the Levels table's `لا مواد`).
- The wrong-role screen survives for deep links only (§14.4); nothing inside the application navigates there.

## Scheduling is one screen (R56)

- `الجدولة` (`/admin/schedules`) is the single entry; the kind is picked on the form. Models are not merged (§20 rule 22): Events computed on read, Sessions materialized (TD-4.6c); the divergence lives in `adapters/scheduling.ts` only; screens deal in `SchedulingItem` / `SchedulingType`.
- List = definitions (one weekly class is one row); Calendar = occurrences from `GET /calendar` via the shared `CalendarGrid`; the view is a query parameter (§20 rule 16).
- Event cancellation: `ConfirmDialog` soft-deletes; after success the R82 notification confirmation appears (`بدون إشعار` sends nothing; `إرسال الإشعار` calls the Event notify adapter with `cancelled`). Classes and exams are excluded: Sessions keep R83, an exam announces its R116 lifecycle in the domain transaction, grade publication is BR-8. Order per R82.5; the dialog stays open on a failed send; retry is safe (notification uniqueness constraint).
- `SchedulingForm` owns name, optional description, start/end and recurrence; type fields arrive as `children`: `ClassSection` (§4.4c — subject, target, room, teacher, assistants), `ActivitySection` (§4.4 — visibility, scope), `ExamSection` (§4.6). The parity guard asserts no `type === 'class'` ladder.
- New class teaching-mode draft `entire_level` (`المستوى كامل`); new staffing row `teacher` (`مؤطّرة مسؤولة`); editing seeds stored values; both editable.
- Dirty state: an exhaustive normalized snapshot vs the pristine opening state, passed to `FormDialog`; unchanged closes at once; Cancel/Escape/X on dirty → shared discard confirmation; backdrop ignored while dirty; restoring values makes it clean; Save unmounts without a prompt.
- R58 Exams cost `SCHEDULING_TYPE_SPECS.exam`, one section component and one arm in `saveSchedulingItem`.

### Physical exams (R58)

- `ExamSection` asks `نوع الامتحان` first; `حضوري` built; `عن بُعد` offered disabled with its reason (§14.4) and refused server-side (`STATE_CONFLICT` / `ONLINE_NOT_AVAILABLE`); no online field rendered (link, audience, window, submission rules undecided).
- Shared dependent selectors (R55): branch → level → subject → year; room narrowed to the branch, group to that Level at that branch; empty group = whole Level (DTO carries `null`).
- Editing is arrangements only (date, time, room, group, staff, title, description); `mode`, `level_id`, `subject_id`, `academic_year_id`, `branch_id` refused by `.strict()` — grades are recorded against them.
- `SchedulingItem.ids`: `PATCH /exams` sends group and staff unconditionally, so the list row carries ids and the form seeds without a second request.
- `--color-exam` (violet; class = zellij green, activity = brass, far from danger red) on `event-chip--exam`, `badge--exam`, the details dialog and the type indicator; never colour alone (chip edge, badge ring, the word `امتحان`).

### Recurrence editor

- `expandEvent` repeats every seven days from the start date; `expandSchedule` on the listed weekdays; identical when `weekdays = [start weekday]`, so one editor emits one meaning and the adapter fills the class's weekday set (no backend change).
- Eight patterns map onto `RecurrenceType` in one place; every-two-weeks with and without chosen days share an enum value, told apart by the weekday set; a round-trip test pins reopening.
- `allowOnce={false}` for classes (the database refuses `none` on a schedule; a one-off is an Event).
- Capacity shown, never enforced (BR-23, §20 rule 22): a read-only hint slot; `RoomDto` has no `capacity`, so it renders nothing today.

### Form contract

- Pre-R56, `الأنشطة` and `الحصص` (`/admin/calendar`, gone) drifted in lede, create-button variant, result notice (`.admin-notice` vs bare `<p role="status">`), filter row, `.form` wrapper, save emphasis and hand-written list dialogs. `components/ui/form-dialog.tsx` closes that: a form supplies fields; the component owns wrapper, notice and the two closing buttons. `ListDialog` was removed; read-only dialogs compose `Dialog` with a list component.
- `CourseScheduleDto` resolves `subject_name`, `target_name`, `branch_name`, `room_name` (precedent `libraryItemDto`: labels, never identifiers; `target_name` is whichever the mode names, §4.4c).
- `scheduling-parity.test.tsx` asserts both files use the same primitives and contain no bare `<Dialog>`, raw `<ul>`, raw `<select>` or `r.*_id` in a cell.
- The primary action lives in the layout's `actions` slot, never the table toolbar.
- Only domain fields differ (class: Subject, Room, primary teacher, assistants; Event: visibility, four-way scope); `lib/recurrence.ts` keeps the shapes deliberately unmerged.

## Every selector is dependent — `hooks/use-scope-options.ts`

```
Category ──< Level ──< LevelSubject >── Subject
    │           │
    │           └──< AdministrativeGroup >── Branch
    └──< CategorySubject >── Subject          (R172 §1 — taught to the WHOLE Category)
```

- R172 §1: a whole-Category Subject appears under every Level (`levels[].subject_ids`) and beside the Category (`categories[].subject_ids`). `wholeCategoryOptions` lets a Level control offer «{Category} — كل مستويات الفئة» (only where some Subject is taught whole; value `category:<id>` in the Level slot, recovered by `wholeCategoryOf()`; the content scope then sends `category_id` instead of `level_id`). `subjectsIndependentOfLevel` lets `ScopeSelectors` allow a form's Subject with no Level (a filter-built class addressed to «الكل», R169 §7; formerly disabled with «اختاري المستوى أولًا»).
- Changing a parent reloads every child (a Level change invalidates Subjects and Groups); a selection no longer offered is cleared, not kept.
- One module for six screens, not one chain each. Academic Year is unchained (years are global, §4.10).
- The field list is keyed by content (`scopeFieldKey`), not identity: an inline literal once caused a render loop that the rate limiter (TD-13) refused. A hook taking an array/object prop keys on content or documents the memoisation requirement; the test asserts the key is content-based and used.
- `components/scope/scope-selectors.tsx` words three empties differently: parent not chosen → *choose a level first*; loading → field is `busy`, label does not flicker; genuinely empty → *this level teaches no subjects*, naming the screen that changes it.
- Global / بدون فرع (`branch_id = null`, §4.9) travels as `extraOptions` from the screens that mean it.

## Content upload

- `/admin/content` (§5.6) and `/teacher/content` (§5.5) render the same component; the server decides (a Teacher cannot choose Global and is confined to staffed branches, §4.9); the one client exception: Global is not offered to a Teacher. Refusals render as actionable sentences.
- The R53 replacement primitive stays in the upload contract; the page offers no «استبدال الملف» action.
- A teacher's branch list derives from staffed schedules (§4.4c; Revision 30 forbids browsing reference data), names from the public branch list.
- Uploads are single-shot, no resume (Risk R-9, §4.9), with visible progress: `XMLHttpRequest` for the PUT (`fetch` has no upload progress; streamed bodies unsupported across §14.7). Retry re-runs the whole flow — new ticket, key, hash segment.
- The list is `GET /library` (TD-3.13; staff see `hidden`); branch is the one client-side filter (no `branch_id` parameter).
- Session materials (`/admin/schedules/{id}/sessions`): content is referenced, never owned (Revision 43); link is primary, upload creates then links; remove unlinks, never deletes (TD-3.12).

## The CRUD framework

Branches delivered the framework, not a branches screen (constitution §0.1).

| Capability | Owns |
|---|---|
| `DataTable` | §14.2's list standard and all §14.4 states, once |
| Field primitives | Label association, error wiring, required marking, hints |
| `ConfirmDialog` | Every destructive action, plus TD-8's mandatory justification |
| `Pagination` | TD-10's envelope |
| `Badge` | A status label — state in words, never colour alone |
| `ApprovalCard` | §14.3's bundle-aware queue item |
| `BranchSelector` | §14.3's branch picker — filtering and required-choice modes |

- No `BranchTable`, ever (§2.1); needing to edit `DataTable` rather than configure it means redraw it (§2.3).
- `/admin/approvals` took it as configuration. `ConfirmDialog` reason bounds became parameters (TD-9 consent floor 10 as default; §5.6 rejection 1–500; §1.1). `Badge` was extracted from the Hijri screen's inline `badge badge--warn` on the second use (§2.7). No `RejectDialog`, no `ApprovalBadge` (§2.5).
- R117: submitted data is a row action `عرض التفاصيل` opening the staff-only projection (guardian contact/consent, one fieldset per child with requested Category and Branch); an exact `review_user_id` from a notification opens it automatically; parent/child approval opens a plain guardian confirmation, each child owning the shared placement picker and its Category default.
- `BranchSelector`, `CategorySelector`, `LevelSelector` are thin `SelectField` configurations: `useId` (the old `id="branch-filter"` collided), `field.tsx` wiring, an `allowAll` variant rather than a `RequiredBranchSelector` (§2.5; registration must not submit "all branches", Revision 39); `SelectField` has `busy`. Consumers: calendar filter, approvals filter, registration.
- `DataTable` does not fetch, sort server data or know a Branch (§3.2); first column `<th scope="row">`; Empty ≠ No results; an inapplicable row action is hidden, not disabled.
- Field primitives: `useId`; errors via `aria-describedby` + `role="alert"`; hints in `aria-describedby`.
- Mirrored validation (TD-9 limits) is courtesy; the server is the rule; a client refusing what the server accepts is a client bug (§1.1).
- Adapter vs repair: `GET /admin/branches` returned raw Prisma rows (camelCase, an instant for a TD-11 date, internal columns) and `adapters/branches-admin.ts` compensated; the Document Owner rejected that ("the backend contract is the source of truth"); SRS Revision 38 made every response a contract DTO ([api.md](api.md#the-contract-is-an-interface-not-a-serialisation)). Adapting (paging arguments, a `Page<T>` wrapper, hiding an endpoint URL) is legitimate; repairing a wrong backend shape is a defect report, not a code change.

## The back office: one registry drives nav, routing and permissions

- `lib/admin-modules.ts` holds §14.1's hierarchy as data; sidebar, router and role guard read it, so a menu entry without a route, a route without a permission, or a module visible to a role TD-2 excludes cannot exist. A test asserts the paths against §14.1.
- R105: only the `الإدارة` section remains; placement in it makes a node Super-Admin-only (R61), asserted over the section in `admin-modules.test.ts`. The four other headings gated nothing; adding one is a §14.1 change for the Document Owner.
- Order: the sidebar renders `ADMIN_MODULES`; `dashboardCards()` (exported from `pages/admin/index.tsx`) maps the same array minus `/admin` (by path, not `section !== null`, which after R105 gave an Admin no cards). Both sequences are pinned literally in `admin-modules.test.ts`.
- `status` is part of the contract: a module without endpoints renders a named "not built" state and a sidebar badge; seven of eleven modules are ready, four blocked on endpoints that do not exist.
- Path resolution is longest-match, separator-aware: `/admin/groups/{id}/roster` → groups; `/admin/groupsomething` does not.
- Role gating is a UX layer; the server enforces TD-2 on every endpoint; routes stay under `/admin/*` even where only a Super Admin may write (Revision 26). The back office mounts inside `PendingGuard`.
- The dashboard is a launcher: §5.6's counts and stats have no endpoint.

## Child section — `components/registration/children.tsx`

- Owns the child fields, add/remove, the cap and validation; `/register` and `/profile/register-child` compose it (R62 unified the service, R64 found the parent form collected no branch/stage, R65 moved the page). `/register` asks one branch and stage per family; the personal page per submission.

## Dates — `lib/format-date.ts`

- The one formatter (`١٢ يونيو ٢٠٢٦`, calendar month names); every `<time>` uses it.
- `<input type="date">` renders in the user agent's locale (`mm/dd/yyyy`); `DateField` keeps the native input with `lang="ar-MA"`, a hint naming the order and the chosen date echoed via `formatDate`. Stored values stay `YYYY-MM-DD` (TD-11).

## Footer

- `#root` is a flex column `min-height: 100dvh`; `#root > main` and `#root > .admin` take `flex: 1 0 auto` (`dvh` so mobile chrome does not tuck the footer away).

## Every table shows every field its own form collects (R64)

- Exceptions: operational metadata (`version`, `created_at`/`updated_at`, `deleted_*`) and a relation the row already names.
- §14.2's column list is a minimum, not a ceiling. Found short and fixed: `/admin/branches` lacked `phone`, `email`, `opening_hours_ar`, `google_maps_url`; `/admin/levels` lacked `display_order`.
- A URL renders as an affordance: the map column is a link «فتح الخريطة»; other values render or show the shared *not set* marker.
- Complete: `/admin/groups`, `/admin/users`, `/admin/subjects`, `/admin/categories`. Composite views (`/admin/trash`, `/admin/schedules`, occurrences) are out of scope.

## One form pattern: `FormDialog` (R64)

- Every create/edit dialog is a `FormDialog` and every control a `field.tsx` primitive; `إضافة مجموعة` was the last adopter (raw `<label><select>` → `SelectField`; its own `dialog__actions` row → the shared pair; default save emphasis → `primary`).

## The personal section is role-independent (R65)

- `/profile` carries what concerns the person (details, contact info, registering a child, request status); a portal carries what concerns a role (roster, schedule, grade). §5.2 lists `Profile (/profile)` under Shared / Cross-Role.
- The account menu `الحساب` is the one entry point (the header control independent of role); not one per role.
- `ولي الأمر` stays about approved children; no registration action inside it.
- Account deletion (R111): every account sees the control in `/profile`; the subject comes from the session; the confirmation states educational and consent history survives, sessions end immediately, a Super Admin can restore within the three-day window; a staff-responsibility or last-Super-Admin block renders through the shared `BlockedNotice` with the server's `blocked_by`. The Users action is Super-Admin-only: same recoverable window plus a permanent, irreversible de-identifying variant; one server mechanism.
- `PATCH /profile` accepts `phone` and `nickname`; `.strict()`, so the rest is refused, not ignored; the read still shows them. Excluded: names (identity — §1.1 composes them server-side; a rename is a staff act on §14.2), `sex` (feeds §4.4b's `gender_restriction`), `email` (the Google identity, §4.1b), `account_status` (an approver's decision, TD-1).

## The family surface: one switcher, one dashboard (R62)

- `ولي الأمر` is a group on the Student Dashboard route, not a destination: the switcher's `parent` entry expands into approved children; picking one sets active role and child in one action; no second child dropdown. A parent-only account still gets the switcher. `ولي الأمر` is offered only once a child is approved.
- «＋ تسجيل طفل» moved out of the switcher (R64) to `/profile/register-child` (R65); it posts a single child, asking what `/register`'s child section asks; the public form is the multi-child one.
- `/dashboard/student` renders the caller's own record as student or the active child's as parent: `GET /students/me` resolves the acting student server-side (§4.3, R63); the client only sends the child header.
- The stored child coordinate reconciles to `null` outside Parent context; switching to Student clears it before navigation. A Parent-only account has no standalone `مستفيدة` option (roles come from live roles, not children).
- A persistent banner names the child (R62.10). Scope: identity block, today's and upcoming sessions; Quran progress, grades and exams are later milestones and are not stubbed (§14.4).
- Every authenticated calendar consumer passes the access token to `GET /calendar` (public, optionally authenticated); visibility is decided by the backend, never locally.

## Toasts and browser support

- Toast rules are SRS §14.5 (success 4 s, permission/consent 6 s, validation sticky or inline, job queued → `JobStatusIndicator`; no PII beyond first names, no raw error internals).
- Browser support is §14.7 (last 2 majors of Chrome/Edge/macOS Safari/Firefox, iOS 16+, no ES2020-less browsers, no IE; older browsers get best-effort rendering, a download-link fallback, and upload always works). Layout is tested at 360 px minimum.

## Verifying a styling change

- `scripts/dev/css-resolve.py` resolves every `var()` to literals, one line per declaration — catches changed values.
- Diff the built `dist/assets/*.css` before and after — catches changed order (single-class specificity means order is the cascade; a file split once moved 52 chunks with zero value change).

> [Design system](design-system.md)

---

**Next:** [Design system](design-system.md) · **Related:**
[API](api.md), [Internationalization](internationalization.md)
