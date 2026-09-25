[Documentation](../README.md) › [Architecture](README.md) › **Calendar and Hijri**

# Calendar and Hijri

## Scheduling is schedule-driven

Organisation and delivery are separate:

| Layer | Entity | Carries |
|---|---|---|
| Organisation | `AdministrativeGroup` | level + branch + name; no room, teacher, schedule, capacity |
| Organisation | `TeachingGroup` | subject + level; only where a subject splits its students |
| Delivery | `RecurringCourseSchedule` | subject · `teaching_mode` ∈ `entire_level \| administrative_group \| teaching_group` + one target · branch · room · teacher + assistants · times · recurrence |
| Delivery | `Session` | one dated occurrence from `session.materialize` (pg-boss, eager, to the academic-year horizon); own date, time, room, teacher, status; notes, recordings, content links, (later) attendance hang here |
| Non-teaching | `Event` | holidays, ceremonies, exams, one-off activities; never generates a `Session` |

- Sessions are materialised eagerly so room, teacher **and assistant** overlap checks are exact.
- A session edit marks the row `overridden`; a schedule edit skips overridden rows and any session with a note, recording, content link or grade, and reports what it skipped.
- A split at the first session is the whole series (R165 §4): closing the predecessor before `anchor_date` is refused by a DB CHECK (used to `500`); a predecessor left with nothing is retired (soft-deleted, `predecessor_retired` audit row, no Trash snapshot: a restore would re-materialise over its successor); one owning protected history stays, closed on its anchor date.
- A plain weekly class meets on its start date's weekday on every save (R172 §13): «أسبوعيًا» has no weekday control; `weekdaysForClass` (`frontend/src/adapters/scheduling.ts`) derives it from `تاريخ البداية` on create and edit; R87 «أيام محددة» patterns keep theirs.
- Surah subjects (R165 §2/§5): `Subject.requires_surahs` (حفظ القرآن, تفسير القرآن), never the name; `resolveSurahs` (`policies/curriculum.ts`) is the one rule: a class names ≥1 Surah of the «مقرر الحفظ» of a Level it addresses (`course_schedule_surah`), an exam exactly one (`exam.surah_id`), an occurrence its own (`session_surah`), which REPLACES the class's for that date while audience dimensions are ADDED; occurrences carry `surah_names`; forms read marker, syllabus and names from `/me/scope-options`.
- Nobody types a class title (R166 §3): `lib/item-title.ts` composes *type — Subject — Surah(s) — main teacher's public name — when* at read time (`services/class-title.ts` for lists and write responses; inline in the calendar projection); free text goes in «الوصف»; activities, holidays and sittings from an authored paper keep their typed title; a bare sitting's is composed but STORED in `exam.title` by `scheduleExam`, recomposed on edit only while still composed; in a `VARCHAR(120)` column Surahs give way first, then the main teacher, never «when»; `recurring_course_schedule.title` and `session.title` are retired in place (nullable, unwritten, unread).
- «تعديل الحصة» changes everything about ONE session in one save (R166 §2): audience (five lists), Subject, Surah, room, delivery, date, times, visibility, «الوصف», staff; `PATCH /sessions/{id}` takes optional `audience`, written in the same transaction by the writer of `PUT /sessions/{id}/audience`, one version bump, own audit row; only changed fields are sent.
- A class's branch is derived (R165 §6): «فروع» = who it is for; `branch_id` via `homeBranchOf`: the one branch chosen, else the room's, else the branch already held while still chosen, else the first chosen.
- One unified public grid; anonymous visitors get the same filter set; every result stays visibility-filtered.
- Login preserves the chosen public view (Owner 2026-09-07; R135 §4.4/TD-3.4): profile suggestions are returned, not auto-applied; `GET /me/calendar` keeps its personal meaning (R82(8)).
- The calendar dialog is the only occurrence-detail surface (Owner 2026-09-07); no Session page; stable links carry kind, id, date to `/calendar`; a refresh does a focused tier-scoped day read first, so a stale, deleted or restricted coordinate is an unavailable state, not an existence leak.
- Month view is a seven-column grid at every width (Owner rejected the phone agenda, 2026-09-07); phone cells put Gregorian right, Hijri left on separate rows, full-width tappable chips, truncated titles; the list/grid switch remains.

> [`BR-17`](../reference/business-rules.md#br-17) · [`BR-23`](../reference/business-rules.md#br-23) · SRS §4.4, §4.4c

## Wall-clock time, and the Ramadan trap

- Schedule, session and event times are Moroccan wall-clock `time`/`date` values, not UTC instants; `created_at`, audit rows and job times are UTC.
- Morocco (UTC+1) suspends DST every Ramadan; a UTC instant would shift an hour twice a year; 17:00 is 17:00, always.
- Rendering, recurrence expansion and "today" use `Africa/Casablanca`; week starts Monday; a named regression test covers a simulated Ramadan transition.

### Which offset Morocco observes — read from the host, never from an image

R167 §2. Morocco changes its clock by decree (20 Sep 2026 → UTC+0); Node converts local time with ICU data compiled into its binary (`process.versions.tz`), so pinning tzdata in the image (formerly prescribed) went stale.

| Piece | Role |
|---|---|
| `docker-compose.yml` | mounts the HOST's `/usr/share/zoneinfo` read-only into `api` and `db`: one authority for the app and PostgreSQL's `Africa/Casablanca` |
| `backend/src/lib/morocco-clock.ts` | parses the TZif (RFC 8536, 64-bit block): `moroccoOffsetMinutes`, `moroccoParts`, `moroccoDateIso`, `moroccoTimeHHMM`, `moroccoWallClockToInstant`; re-reads on mtime change (checked every five minutes) |
| `scripts/ci/check-no-local-clock.sh` | nothing in `backend/src` may read the local clock (`getHours`, `new Date(y, m, d…)`, `toLocale…String`); proven to fail on a planted violation |
| `GET /clock` | public, cacheable five minutes: `{ now, zone, utc_offset_minutes, in_force_since, next_change_at, source }` |
| `frontend/src/lib/morocco-time.ts` | `formatInstant` uses the SERVER's offset inside its window; older instants use the device's `Africa/Casablanca` rules |

- Unreadable file → ICU fallback declared as `source: "icu-fallback"`; a deployment verifies `source: "host-zoneinfo"`.
- `TZ` stays set in containers only so a line the guard missed fails by an hour, not a zone.
- pg-boss `tz` crons use bundled zone data: nightly jobs may run an hour off after a decree until rebuilt (housekeeping only); `session-recording-reconcile` runs every quarter hour in no zone.

## Recurrence and multi-scope events

- Five patterns: none, daily, weekly, biweekly-alternating (week on, week off), yearly; the alternating one is modelled and tested explicitly, parity against the series' own anchor.
- Branch, category, level and group scopes are written into four join tables at creation, never wildcards on read; four tables, not one polymorphic one, is the precedent for rejecting a generic `scope_type`/`scope_id` authorisation framework (no foreign key possible).
- Only branches whose `operational_start_date` has arrived are populated; branch-scoped views grey out earlier dates.
- On activation an Admin manually backfills applicable global and recurring events or knowingly skips; never silently auto-filled nor silently ignored; an Admin capability (operational work) though branches are Super-Admin reference data.

## The scheduling-type catalogue (R110)

Reference data she manages, not a client constant; Owner-canonical order:

| # | Type | حضور إجباري | `structural_kind` | entity |
|---|---|---|---|---|
| 1 | حصة دراسية | نعم | `class` | `RecurringCourseSchedule` |
| 2 | اختبار | نعم | `exam` | `Exam` |
| 3 | محاضرة | لا | `activity` | `Event` |
| 4 | حفل | لا | `activity` | `Event` |
| 5 | عطلة | لا | `holiday` | `Event` |

- Six types (`نشاط` joined), three entities, four structural kinds, no fifth scheduling model; `holiday` is its own kind since R110(9); R56 fixed the selector's branches as the three entities, R110 stores that routing.
- R56 declined `Event.type` until filtering/reporting by category became real; `attendance_required` (OD-03) is that requirement and drives the form. A holiday still cancels no class (BR-17; §4.4(6)); عطلة is an ordinary schedulable activity (OD-03), not a suppression mechanism.
- The catalogue (server) answers which types exist, names, order, attendance; `adapters/scheduling-types.ts` (code, never administrable) answers what an entity can express (all-day, end date, `once`, drillable occurrences); `structural_kind` joins the two.
- `structural_kind` is never inferred from the name (§4.4b) and is fixed after creation.
- `Event.scheduling_type_id` is nullable, required at the boundary (R35); pre-R110 activities record no type and are not guessed.
- Deletion refused while an activity names the type: `ON DELETE RESTRICT` plus a TD-5 blocked-delete check.
- Read: any staff who may schedule, مؤطِّرة included (R93/R94); write: Super Admin only (OD-01); R105's الإدارة menu node is never the control.
- Seed finds by live name and creates only when absent; rename, reorder, re-flag and addition survive re-runs.

### The catalogue is what the calendar filters by (Owner, 2026-09-02)

`الجدول الزمني → النوع` used to offer the storage taxonomy `session | event | exam`, so a holiday could not be asked for:
1. `scheduling_type_id` (nullable, `RESTRICT`) added to `RecurringCourseSchedule` and `Exam`, validated by `assertTypeOfKind` (`assertActivityType` wraps it).
2. `GET /calendar?scheduling_type_id=` resolves the type's `structural_kind` first (which source can hold it), then narrows by id.
3. Options come from `GET /calendar/bootstrap`; one module, `components/calendar/scheduling-type-filter.ts`, serves public and personal calendars.
- Legacy rows are not guessed: pre-revision schedules and sittings have no type, none backfilled; they match no type filter, stay visible under «الكل», and the column is editable; a `structural_kind` fallback would be §4.4b name-matching.
- `type` is still accepted and narrows independently; an id naming no type returns an empty set.
- A عطلة is marked from the row, never its name: occurrences carry `scheduling_type_id`, `scheduling_type_name`, `structural_kind`; the chip renders an outline plus the type's own word (rule AV).

## Three visibility tiers — on all three kinds (R109)

Enum, never boolean; since R109 on every kind (before, a class was unconditionally public per §4.4 and a sitting had no tier); pre-existing rows were backfilled `public`.

| Kind | Column | Notes |
|---|---|---|
| نشاط `Event` | `event.visibility` | default moved `private` → `public` for new rows only |
| حصة `RecurringCourseSchedule` | `.visibility` | template: default for materialised Sessions |
| حصة `Session` | `.visibility` | snapshot at materialisation |
| امتحان `Exam` | `.visibility` | one column, no snapshot |

| Tier | Who sees it |
|---|---|
| Public | unauthenticated visitors and every approved user |
| Private | any logged-in approved Student (deliberately not filtered by own branch/group), Parents in a linked student's context, Staff within branch scope |
| Hidden | the responsible person plus Super Admins; invisible to students and parents |

### `hidden` is OWNERSHIP, and R109 narrowed it

§4.4's «Teachers whose scope intersects … and all Admins regardless of branch scope» became *who answers for this item* (Admin reach removed by Owner decision): نشاط `EventStaff.position = 'responsible'` (R71.3); حصة `SessionStaff.position = 'teacher'`, resolved on the occurrence's date; امتحان `ExamStaff.position = 'supervisor'`.
- An assistant does not read a hidden item: R87 §G is about acting, not ownership; `EventStaff` draws the same line (both positions see, only `responsible` edits).
- B6, event definitions: `GET /events` allows a Teacher only group-only definitions whose complete group set she teaches, or ones with her live `EventStaff` assignment; hidden stays excluded unless responsible; date filters combine with authorisation, never overwritten by its `OR`.
- B6, creation: the complete explicit branch/group request is authorised before the operational-branch filter; a foreign ID refuses the whole request; an empty resolved branch request cannot become global; R139 `global:true` expands to all operational branches permitted to the Admin; joins keep intersection semantics; R71/R72 restrict Teacher-created Events to own groups; PATCH refuses scope keys; no scope-editing or series-splitting route.
- One main teacher per DATE, not per series: R91 withdrew `@@unique([scheduleId, userId])`; «at most one main on any date» is enforced (`OVERLAPPING_MAIN_TEACHER`); `session.materialize` snapshots `SessionStaff` from `CourseScheduleStaff` effective that date (R91: `SessionStaff` answers who took the class), the only form expressible as a `where` filter.

### Where the tier applies — and where it must not

- Gates `GET /calendar`, `GET /me/calendar`, the focused §5.2 Session read, and the Sessions a content item is used by; refusal is `404`, never `403` (§20 rule 17).
- Not applied to `GET /admin/events`, `/admin/course-schedules`, `/admin/exams` (role plus branch scope), else hidden items would be unadministrable.
- Accepted: Risk R-6 cross-branch private visibility (any logged-in student sees every private event; a branch-scoped Admin sees less than a beneficiary); Risk R-7 existence leaks through conflict detection (hidden نشاط and حصة alike).
- `Pending` users, and Active accounts with no Student, Parent or staff role, see the public tier only; the frontend sends the access token when one exists and never chooses a tier.
- The tier travels schedule → occurrence like `room_id` (R43.4) and `delivery_mode` (R97): schedule default, `session.materialize` snapshot with resync of future un-protected occurrences, `session.overridden` protection; no `visibility_overridden` column (two markers would drift); an R50 split carries the tier onto the successor and may change it.
- Screen (§D): one control, `VisibilityField`, in the scheduling form for all three kinds and the occurrence editor (moved out of `ActivitySection`); `fromSchedule`, `fromExam`, `fromEvent` hydrate the stored tier, since the initialiser's `item?.visibility ?? 'public'` would silently republish a hidden class on a `null`.
- An occurrence edit uses R50's prompt: هذه الحصة فقط → `PATCH /sessions/{id}` (becomes `overridden`); هذه الحصة وكل ما بعدها → the R50 split (successor's tier); كل الحصص → `PATCH /admin/course-schedules/{id}` (resyncs future un-protected occurrences).

## The Hijri overlay

- Morocco fixes each Hijri month by local moon sighting, announced by the Ministry of Habous and Islamic Affairs on the evening of the 29th; it regularly differs from Umm al-Qura (1 Muharram 1448 = Wednesday 17 June 2026; Umm al-Qura: 16 June).
- Rejected (R31): library algorithm plus a Super Admin ±2-day global offset; a uniform correction cannot fit a per-month divergence.
- The platform reproduces the official calendar and computes nothing: `HijriMonthStart(year, month, gregorian_start_date, status)`, `draft` → `published`; only published months render; every consumer resolves through one function against this table.
- The Super Admin records, never decides (R32 vocabulary rule across SRS, API, UI, code): *record official month start*, *publish official month*, *official Ministry announcement*; never *choose*, *define* or *set month*.
- Recording is recurring owner work (about one per month plus Ministry corrections).
- Month 1–12, year 1300–1600; two months of one year may not share a Gregorian start; month n+1 must start after month n (DB-enforced).
- Version column for optimistic locking; the recording audit row captures previous and new start date.

### The overlay is invisible until someone records a month — including in development

`HijriMonthStart` starts empty and the production seed puts nothing in it (§15.1), so a fresh deployment renders no Hijri values, indistinguishable from a broken feature.

| Situation | Renders |
|---|---|
| nothing recorded, or recorded but `draft` | nothing (silence over guessing) |
| a month recorded, the next not | its first 29 days only; day 30 is certain only once the next month is recorded |
| two consecutive months | the earlier one, complete |

- Development fixtures seed nothing: only two real announcements exist (1 Dhu al-Hijja 1447 = 18 May 2026; 1 Muharram 1448 = 17 June 2026, R31); more would invent an official calendar.
- `calendar.integration.test.ts` asserts 16 June 2026 reads `1447-12-30` with real values (the guard against an algorithm creeping back); `(hijri_year, hijri_month)` is unique, so a fixture row for 1447/12 would collide and be deleted by the suite's cleanup.
- To see the overlay locally, record two consecutive months via the API: [Recording an official Hijri month](../operations/runbooks.md#recording-an-official-hijri-month).
- NOT BUILT: the Super Admin *Hijri Calendar Management* screen (§5.7); the four endpoints exist, so an authenticated API call is the only way to record a month.

### Why there is no importer

- The Ministry publishes a prose news announcement after each sighting: no API, feed or dataset, no year in advance; an import endpoint could only answer *not configured*, so none ships and the manual path is primary.
- No provider interface or registry (unused scaffolding); `recordMonthStart` is the single write path (ordering rule, locking, draft state, audit trail), `HijriMonthStart.source` records provenance, one resolver serves every reader; a future importer needs a fetcher, a route and an audit row.
- Re-examined 2026-08-05 on the Owner's constraint «the system MUST always follow the official Moroccan Hijri calendar»: automation rejected again, R32 stands: Umm al-Qura is a Saudi calculation that diverges by design; tabular/arithmetic is a fixed 30-year cycle; astronomical models predict when the crescent could be seen, not when it was; scraping the Ministry's prose fails silently with a wrong date.

### The failure mode that IS worth fixing: running out in silence

- `baseHijri` returns `null`, never a guess; when recorded months run out, dates render Gregorian-only with no error, log or screen state.
- `GET /admin/hijri-calendar` carries `coverage` (`published_through`, `days_remaining`, `warning`, `next_unrecorded`): Gregorian arithmetic only; `days_remaining` counts to the 29-day floor, goes negative rather than clamping, and is `null`, never `0`, when nothing is published; only published months count (§5.7); no route added (§20 rule 16).

### The Umm al-Qura baseline (Owner, 2026-08-30)

- `POST /admin/hijri-calendar/{year}/import` fills only months with no row at all and never updates (not «import unless edited»: a «has a human touched this?» test can be got wrong); idempotent by construction.
- Source: ICU's Umm al-Qura tables via `Intl.DateTimeFormat` (`lib/umm-al-qura.ts`), no network; provenance `source = 'umm_al_qura_icu'` (a corrected row reads `manual`); arrives `draft`; no read path consults ICU.
- ICU rather than a checked-in JSON table (which would need re-transcribing to extend); `assertUmmAlQuraAvailable` refuses on a Node without full ICU rather than falling back to the arithmetic `islamic` calendar.

## The calendar screen's two requests

Exactly two requests, never a third, including when opening an event (design: [API](api.md#designing-an-endpoint-the-bootstrap-as-a-worked-example)):

| Request | Returns | Cached |
|---|---|---|
| `GET /calendar/bootstrap` | chrome: Hijri day mapping, month metadata for the dual title, category, level and branch lists | 5 minutes, strong ETag |
| `GET /calendar` | occurrences, each self-sufficient | no |

- Month metadata drives the dual title («يوليوز 2026 | محرم 1448»; «يوليوز / غشت 2026 | محرم / صفر 1448» across a boundary) with no transition logic in the client: two entries join with a slash; the year prints once when shared, twice when not.
- An unrecorded month renders nothing: no Hijri number in the cell; the title's Hijri side and divider are omitted.
- Day-cell coordinate row: Hijri left, Gregorian right, matching the dual title; the row alone is LTR so DOM order equals visual order; nothing is swapped for layout.
- Instructor names arrive resolved; the client renders them verbatim with no fallback ([why](security.md#on-public-surfaces)).

---

**Next:** [Frontend](frontend.md) · **Related:** [Business processes](../overview/business-processes.md#3-scheduling), [Database](database.md#hijrimonthstart--the-calendars-sole-source)
