[Documentation](../README.md) › [Development](README.md) › **Teaching authority**

# Teaching authority — who may act on whom, and when

Cites [`docs/SRS.md`](../SRS.md) §4.4c and Revisions 73, 87, 88, 90, 91, 107; the SRS wins.

## The three facts

| Fact | Where | May it authorise? |
|---|---|---|
| Capability / availability — «I can teach حفظ القرآن», «I am free Thursdays» | `TeacherSubjectCapability` · `TeacherCategoryCapability` · `TeacherAvailability` (R88) | never |
| Effective assignment — she staffs this class from X to Y | `CourseScheduleStaff`, `effective_from` / `effective_until` (R91) | yes, on dates inside the period |
| Occurrence staffing — she took this lesson | `SessionStaff` (R43.4) | yes, for that occurrence; overrides the schedule |

- A flawless profile with no assignment reaches nothing; an assigned Subject never declared holds full authority (`teaching-candidates.http.integration.test.ts` and browser).

## The period model

| Bound | Meaning |
|---|---|
| both bounds | inclusive calendar dates (TD-11, never instants) |
| `effective_from = NULL` | from the schedule's own beginning |
| `effective_until = NULL` | through the schedule's own end (possibly open) |

- Pre-R91 rows carry two NULLs = the schedule's whole life: no backfill; deriving `effective_from` from `anchor_date` rejected (asserts a date nobody recorded).
- Arithmetic only in [`policies/effective-staffing.ts`](../../backend/src/policies/effective-staffing.ts): `effectiveOn(date)`, `effectiveWithin(from, to)` are Prisma fragments composed into one query, never an id list (`roster-resolution.ts`).
- Touching IS overlapping: `intervalsOverlap` counts a shared day (unlike `teaching-profile.overlaps` for availability) — two mains on one day is what R91 §6 forbids.

## Which date each consumer asks about

| Consumer | Date | Why |
|---|---|---|
| `studentsTaughtBy` — roster, `/quran-students` | today | whom do I teach now |
| `teacherBranchIds` — upload scope, branch list | today | uploading happens now |
| `teachesQuran` → `GET /me` → «إدخال الحفظ» menu | today | marker must agree with the roster |
| `teacherEventScope` — Hidden-event visibility | today | today's teaching decides today's view |
| `assertExamInTeacherScope` | the exam's own date | a replacement authoring inside her period is authorised |
| `staffsSession` | the occurrence's date, after `SessionStaff` | occurrence truth first, schedule as of that date second |
| Personal calendars · notifications · occurrence content | the occurrence's own `SessionStaff` | materialization wrote the right person per date |
| R90 candidate conflicts | the proposed class's period | a finished assignment is not a clash |
| `readableScope` — class DEFINITIONS | any period | her own history, grants nothing |

- Physical create/schedule and PATCH pass the resolved exam date to the scope helper (PATCH checks existing and proposed target/date); individual exam authoring/grading passes it to `studentsTaughtBy`; exact-Session cover never becomes whole-Level authority.
- Exam mutation and grade save/publish share `repositories/exam.repository.ts`'s governing row lock with paper/submission writes; authority, version, maximum, publication state read after locking; TD-15 requires the current version for an existing Grade. Status: [testing](testing.md#high-readiness-checkpoint-2026-09-13).

## History is never rewritten

- Materialization snapshots each occurrence with the assignments effective on its date (one edit → October→Safa, November→Amina, December→Safa, nothing touched by hand).
- Resync reaches only future, un-overridden, still-`scheduled` occurrences (§4.4).
- A past occurrence is never resolved through the schedule.

## The occurrence override

- One-off cover = `SessionStaff` for one date: full authority there, none beyond; schedule untouched. Edited from «مؤطّرة هذه الحصة» on `/admin/schedules/{id}/sessions`; the dialog says *this occurrence only*.
- `studentsTaughtBy` has an occurrence arm so a cover with no schedule assignment reaches that day's audience (added when R87 §J's «إدخال الحفظ» handed a cover an empty list — rule P inverted).

## Who ATTENDS ≠ who teaches (R92)

| Question | Answered by |
|---|---|
| who teaches | R91 effective assignment, then the occurrence's `SessionStaff` |
| who attends | `audienceForSession` — schedule's audience unless the occurrence states its own branches |

- `SessionAudienceBranch`: a lesson delivered once instead of twice, two branches meeting at one venue, that occurrence only.
- Replacement, not addition: no rows → inherited; rows ARE the branches; the dialog seeds the schedule's branch selected.
- Location ≠ audience: `Session.branch_id` not overloaded or written; `GET /sessions/{id}/roster` reports both.
- Scope, never a roster (§20 rule 22): resolved against live Enrollments at read time; no Enrollment mutated, Session duplicated or per-student row — asserted.
- One resolver: `audienceForSession` feeds personal calendar, roster, notification recipients, audit count and the Quran occurrence arm; the Quran arm was missing until 2026-08-20 (`studentsTaughtBy` read `audienceWhere(session.schedule)`); it now covers regular مؤطِّرة and cover, date-bound ([Quran progress](quran-progress.md)).
- Whole-Level only: Group/Circle targets carry their branch, so a branch list is refused and not offered; cross-branch Groups/Circles is an open Owner question.
- The counterpart is never guessed: the platform never cancels the other branch's occurrence; the administrator does, through the flow that asks whether to tell people.

## An Event is not a class (R93)

- `EventStaff` (R71) and `CourseScheduleStaff` (R91) stay separate (§20 rule 22); event staffing is not effective-dated.
- A مؤطرة staffs the event she answers for, names assistants, cannot make another responsible (`RESPONSIBLE_MUST_BE_SELF`, server-refused).
- `GET /admin/users` and `GET /admin/levels` answer 403 for her, so `GET /me/event-staff-options` (whom may I name) and `GET /me/event-scope-options` (Administrative Groups she teaches, §4.4c, bounded by R91) exist; nothing widened (rule O: a smaller question, never a wider permission).

### Audience dimensions combine — in every read (R169 §6)

Branch B1 + Level Y = both at once; two branches = either; an untouched dimension is «الكل».

| Reader | Where | Since |
|---|---|---|
| notified / expected (attendance) | `eventAudienceWhere` — ONE enrolment satisfies every named kind | R82 |
| personal calendar | `personalFilters`, event arm (`dimensionMatch`) | R140 |
| مؤطِّرة's view of a PRIVATE activity | `visibilityFilter`, teacher arm (`reaches`) — each dimension must reach her scope | R169 §6 (it unioned) |
| calendar of a Level / Category / group | `readCalendar` scope filters via taxonomy relations | R169 §6 (only `branch_id` read so) |
| the form | `ActivitySection` — «الكل» untouched, combination once chosen | R169 §6 (it said union) |

- Not this rule: activities she STAFFS are hers whatever their scope (R71.2, staffed ∪ scope); a class's حلقة unions with its other filters (§4.4c) — an activity has no حلقة dimension.

### The assignment notice

| | |
|---|---|
| `event_created` | it is happening — to the people it is for, optional (R82.5) |
| `event_staff_assigned` | you are working on this — to the person named, automatic |

- Only the newly assigned (in force vs submitted); a title edit tells nobody; removed then re-added = newly assigned (returns unread to the top); actor excluded (R78.3); Admin naming an assistant tells her as a مؤطرة does.

## Invariants — why not in SQL

`assertStaffIntervals` in [`course-schedule.service.ts`](../../backend/src/services/course-schedule.service.ts) holds the schedule's staffing rows `FOR UPDATE` (TD-15.2) and checks: (1) at most one main مؤطِّرة per date; (2) no overlapping periods for one person on one schedule; (3) every period intersects the schedule's life — refused, never clipped.
- `EXCLUDE USING gist` needs `btree_gist`, not installed by §3.1 nor listed in TD-13; the lock serialises racing administrators.

## Who may assert a capability (Owner, 2026-08-30)

- Only the writer changed: R88.2 reserved the profile to administration, R106 opened availability, the Owner now opens declared Subjects and Categories on `/teacher/availability`.
- Self-service writes `TeacherSubjectCapability` / `TeacherCategoryCapability` only; the HTTP suite declares two Subjects and a Category and finds `/quran-students` empty, `/admin/users` refused.
- No `{id}` in `PUT /me/teaching-profile/capabilities` (subject from the token); two routes each replacing their half, `.strict()` against the other's field; `self_service: true` in the audit (R88.2's reliance question stays answerable).
- Validation shared with the administrative writer (retired Subject → `UNKNOWN_SUBJECT`); both screens render the same `CapabilitiesEditor`.
- Document Owner: R88.2's refusal is superseded by this instruction; the SRS is not edited here.

## The guards

| Guard | Pins |
|---|---|
| [`policies/effective-staffing.test.ts`](../../backend/src/policies/effective-staffing.test.ts) | inclusive bounds · open ends · touching = overlapping · single-day periods · schedule-life containment |
| [`controllers/effective-staffing.http.integration.test.ts`](../../backend/src/controllers/effective-staffing.http.integration.test.ts) | migration compatibility · three interval refusals · two rows for one person · per-occurrence materialization · roster/marker/calendar boundaries · assistant parity · occurrence override · R90 conflict clean-up · R88 untouched · concurrency |
| [`scripts/dev/browser/verify-effective-staffing.mjs`](../../scripts/dev/browser/verify-effective-staffing.mjs) | Admin, Safa, Amina, assistant: dated rows, Safa twice, per-date occurrences, four answers at one moment, handover leaves the past alone |
| [`components/scheduling/staffing-periods.test.ts`](../../frontend/src/components/scheduling/staffing-periods.test.ts) | blank date = open-ended, converted once at the wire · many assistants · one person on several rows · Arabic refusals |
| [`controllers/session-audience.http.integration.test.ts`](../../backend/src/controllers/session-audience.http.integration.test.ts) | R92: inherited unchanged · both branches · unrelated excluded · venue unmoved · next occurrence untouched · clearing restores · notifications follow the audience · staffing × audience independent · nothing mutated or duplicated · refusals, version conflict |
| [`components/scheduling/session-audience.test.ts`](../../frontend/src/components/scheduling/session-audience.test.ts) | R92: seeded with the inherited branch · venue as text · action only where the server accepts · roster shown, not inferred · `dirty` passed |
| [`services/quran-entry.integration.test.ts`](../../backend/src/services/quran-entry.integration.test.ts) | R91 × R92 × R73: whole-Level/Group/Circle rosters · assistant parity · unrelated Subject and R88 declaration grant nothing · dated authority both ways · one-off cover · combined occurrence not permanently widened |
| [`scripts/dev/browser/verify-quran-entry.mjs`](../../scripts/dev/browser/verify-quran-entry.mjs) | the same matrix as ten identities, ending at حفظي |
| [`scripts/dev/browser/verify-cross-branch.mjs`](../../scripts/dev/browser/verify-cross-branch.mjs) | R91 × R92, six identities: Admin combines, both beneficiaries share, unrelated does not, covering مؤطِّرة has it, the schedule's does not, cancelling tells the right people, next week normal |
