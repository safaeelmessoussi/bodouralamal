[Documentation](README.md) › **SRS proposal — Revision 51**

# Draft SRS Revision 51 — Scheduling is one section with two models

> **Status: APPLIED to `docs/SRS.md` on 2026-08-05**, on the Document Owner's approval of the
> grouping and instruction to *"prepare it as an SRS revision."* §0 carries the entry and §14.1's
> sitemap now lists الجدولة with Events and Sessions under it.
>
> Retained for the **rationale** — particularly the table of what could not be shared and why,
> which the specification states as a rule rather than an argument. Delete it once that
> reasoning has a home in the handbook.

---

## The observation

§14.1 currently places the two scheduled things in different sections:

```
├── Academic
│   ├── Course Schedules .............. /admin/schedules
├── Calendar .......................... /admin/calendar
```

That grouping follows the *models* — one is teaching, one is not — but an administrator
groups them by **the question they are answering**: *what is happening, and when?* A holiday
and a Quran class are both things on a calendar, and finding them in unrelated parts of a menu
makes them feel like unrelated systems.

## The proposal

```
├── الجدولة (Scheduling)
│   ├── الأنشطة (Events) ............... /admin/calendar
│   └── الحصص (Sessions) ............... /admin/schedules
```

**No route changes.** Only the section a node is listed under, and the section's name.

## What this does NOT claim

The two remain **different domain models**, and this revision changes nothing about that —
§4.4's *"an Event never generates Sessions, and a teaching occurrence is never an Event"*
stands, as does §20 rule 22's prohibition on re-conflating organisation with delivery.

Grouping them in the menu is a statement about **where a person looks**, not about what the
models are. The distinction that matters to the system is preserved; the distinction that does
not matter to the user is removed from their way.

## Exact wording to apply

### 1. New entry in §0

> **Revision 51 (Document Owner decision — Scheduling is one navigation section, 2026-08-05):**
> §14.1 listed Course Schedules under *Academic* and Events under *Calendar*, which follows the
> models and not the question an administrator is asking. Both are things that happen on a
> calendar, and finding them in unrelated parts of the menu made them feel like unrelated
> systems. **They join one section, `الجدولة` (Scheduling), with two nodes — `الأنشطة` (Events)
> and `الحصص` (Sessions).** **No route changes**, and **nothing about the models changes**:
> §4.4's separation of Events from teaching occurrences and §20 rule 22's prohibition on
> re-conflating organisation with delivery both stand. This is a statement about where a person
> looks, not about what the two things are.

### 2. §14.1 — the sitemap

> Replace the `Academic → Course Schedules` line and the top-level `Calendar` line with:
>
> ```
> ├── الجدولة / Scheduling
> │   ├── Events ........................ /admin/calendar
> │   └── Sessions ...................... /admin/schedules
> │        └── Occurrences ............... /admin/schedules/{id}/sessions
> ```

---

## What was implemented without a revision, and why it needed none

The Owner's larger point — *"if I edit an Event, and later edit a Session, I shouldn't have to
learn a different UI"* — is right and is now true for the parts where it can be true.
`components/scheduling/recurrence-editor.tsx` holds one recurrence control and one date/time
block, rendered by both forms.

**Three of the components in the original list could not be shared, and forcing them would have
made the interface state something false.** Recorded here because the reasoning is the useful
part:

| Component | Why not |
|---|---|
| **Room selector** | **`Event` has no room.** §7 gives it no `room_id`, and the calendar maps `room_name: null` for events with the note *"an Event is the exception layer; it has no room and no instructor of its own."* A room picker on an event form would collect a value nothing stores |
| **Scope dialog** (this / this-and-future / all) | **An event occurrence does not exist as a row.** Sessions are materialized eagerly (TD-4.6c) which is exactly what makes *this occurrence only* possible — there is something to override. Event occurrences are computed on read by `expandEvent`, so there is nothing to attach an override to. Offering the dialog would promise an operation with no representation |
| **Conflict preview** | Conflicts are room, teacher and assistant overlaps (§4.4). An Event has **none of the three**, so there is nothing to detect |

**And the recurrence editor is one component with two variants rather than one form**, because
`lib/recurrence.ts` states the shapes are *"deliberately not merged"*: an Event is anchored on a
start date, while a class happens **on Tuesdays** — *"collapsing them would mean one of the two
lying about how it is specified."* The **control** is identical, which is what an administrator
notices; the **fields** differ, because the models do.

**If the Owner wants the scope dialog on Events**, that is a real feature and a real decision:
it requires either materializing event occurrences or an exception model, and it would be its
own revision.
