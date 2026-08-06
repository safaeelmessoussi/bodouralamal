[Documentation](README.md) › **SRS proposal — Revision 56**

# Draft SRS Revision 56 — one Scheduling page, two views

> **Status: APPLIED to `docs/SRS.md` on 2026-08-06**, on the Document Owner's approval of the
> plan in full, including the explicit decision **not** to add `Event.type`.
>
> Retained for the rationale — chiefly *why the models stay separate while the experience
> becomes one*, and *why the event categories are not a column*, both of which the specification
> states as rules rather than as arguments.

---

## What changes, and what deliberately does not

**The administrator stops choosing between two screens.** §14.1's الجدولة section listed two
nodes — `الأنشطة` (`/admin/calendar`) and `الحصص` (`/admin/schedules`) — and an administrator
had to know, before clicking anything, whether the thing they wanted to create was an *Event* or
a *Course Schedule*. That is a question about the platform's internals, asked at the moment
somebody wants to schedule a class.

**The models do not merge, and R51's reasoning for that is unchanged.** §20 rule 22 forbids
re-conflating organisation with delivery, and the two entities remain genuinely different:

| | `Event` | `RecurringCourseSchedule` |
|---|---|---|
| Occurrences | **computed on read** (`expandEvent`) | **materialized as rows** (TD-4.6c) |
| Room, staff, subject | none | all three |
| Carries | nothing | attendance, notes, recordings, content links, grades |

The first row is the load-bearing one: §4.4 computes conflicts **against materialized sessions**
because comparing recurrence *rules* cannot see that a weekly and a biweekly Tuesday class
collide only on alternate weeks, and R50's split mechanism works only because occurrences are
rows. Merging would force one of those behaviours onto both.

**So this revision changes where a person looks and what they are asked, not what the platform
stores.** It is R51's principle carried one step further: R51 put the two nodes in one section;
this makes them one screen, with the type as a field rather than as a navigation decision.

## Why the event categories are NOT a column

The Owner asked for a type selector offering `حصة · نشاط · اجتماع · عطلة · مناسبة · ورشة ·
امتحان`, and asked that no column be added unless it carries real business value.

**It does not, and the specification is what settles it.** §4.4(6) states that a cancellation is
*"an edit to a **Session** row rather than a parallel Event mechanism"*, and BR-17 states that
non-teaching activity *"is never the source of the routine timetable."* **A holiday therefore
suppresses no class** — classes are cancelled by cancelling their sessions. The category would
drive no rule, no job, no report.

The vocabulary is also already in the specification, as prose, in four places — §4.4, §7, BR-17
and the glossary all read *"holidays, vacations, ceremonies, exams, one-off activities."* It has
never needed to be a field, and an administrator who wants to write **عطلة** writes it in the
title, which is what the title is for.

**The type selector's branches are therefore exactly the ones that mean something** — the three
that route to different entities. Should filtering or reporting by category ever become a real
requirement, `Event.type` can be added then, with a purpose to justify it.

## The two views

One node, two perspectives on the same data, selected by a query parameter rather than a second
navigation node — the pattern §5.2's Educational Library already uses for its level index and
level view, and for the same reason: **a new path segment would be a navigation node §14.1 does
not list** (§20 rule 16).

* **List view (default)** — the *definitions*: the rules an administrator created. One weekly
  class is **one row**, not forty. Editing, deleting and R50's scopes all act on definitions.
* **Calendar view** — the *occurrences*, from `GET /calendar`, which has always merged Sessions
  and Events into one `kind`-tagged list. This is the read the public calendar already uses.

**This distinction is the real reason the two old pages never felt alike**, beneath every visual
difference: `/admin/schedules` listed *rules* while `/admin/calendar` listed *expanded
occurrences*. They were not two styles of the same screen; they were two different questions.

## Why `GET /events` is required

There is no list of event **definitions**. `POST`, `PATCH` and `DELETE /events` exist; reads have
always gone through `GET /calendar`, which returns occurrences. A List view of definitions
therefore cannot be built from the existing surface, and showing events as occurrences beside
classes as rules would rebuild the very incoherence this revision removes.

`GET /events` mirrors `GET /admin/course-schedules`: paginated (TD-10), branch- and date-
filterable, staff-only, returning the stored rule rather than its expansion.

## Extensibility — Exams

§4.6's `Exam` is a first-class entity with its own date, level, subject, questions and grading,
and TD-3.6 gives it `POST /exams`. When M5 ships, **`امتحان` becomes a third branch of the same
router** — not a second scheduling experience, and not an Event that would store the same exam
twice (§20 rule 22). Until then the option is offered and disabled, with the reason stated, per
§14.4's rule that a blocked capability says why.

## Exact wording applied

### §0

> **Revision 56 (Document Owner decision — one Scheduling page with two views, 2026-08-06):**
> §14.1's `الجدولة` section listed two nodes, and an administrator had to know whether the thing
> they wanted to create was an *Event* or a *Course Schedule* before they could click anything —
> a question about the platform's internals asked at the moment somebody wants to schedule a
> class. **The two nodes become one screen at `/admin/schedules`**, on which the **type is a
> field**: `حصة` routes to a Course Schedule, `نشاط` to an Event, and `امتحان` to §4.6's `Exam`
> when M5 ships. **The models do not merge and R51's reasoning is unchanged** — §20 rule 22
> stands, Events are still computed on read while Sessions are materialized (TD-4.6c), and §4.4
> still computes conflicts against real rows. **One screen carries two views**, chosen by a query
> parameter rather than a second navigation node (§20 rule 16): a **List view of definitions**,
> where one weekly class is one row, and a **Calendar view of occurrences** from `GET /calendar`.
> That distinction is the substantive one — the old pages listed *rules* and *expanded
> occurrences* respectively, which is why they never read as one feature. **`GET /events` is
> added** because no list of event definitions existed. **`Event.type` is deliberately NOT
> added:** §4.4(6) makes a cancellation an edit to a Session row rather than a parallel Event
> mechanism and BR-17 keeps non-teaching activity out of the timetable, so a holiday suppresses
> no class and the category would drive no rule, job or report; the vocabulary already lives in
> §4.4, §7, BR-17 and the glossary as prose, and an administrator writes `عطلة` in the title.
> It may be added when filtering or reporting by category becomes a real requirement.
> **`/admin/schedules/{id}/sessions` is unchanged**, and keeps R50's three edit scopes.

### TD-3.4 — one route

> ```
> GET /events?branch_id=&from=&to=&page=   → staff. The stored event DEFINITIONS, paginated
>                                            (TD-10) — never their expansion, which is
>                                            GET /calendar. Added by R56 for the List view
> ```

### §14.1 — the sitemap

> ```
> ├── الجدولة / Scheduling *(R51, unified by R56)*
> │   ├── Scheduling .................... /admin/schedules  (list + calendar views, all types)
> │   │   └── Occurrences ............... /admin/schedules/{id}/sessions (the R50 scope dialog)
> │   └── Student view .................. /dashboard/student/calendar (view)
> ```

### §5.6 — the screen entry

> Replace *Calendar & Events (`/admin/calendar`)* with a single **Scheduling (`/admin/schedules`)**
> entry describing the type selector, the shared recurrence editor, and the two views.
