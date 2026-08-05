[Documentation](README.md) › **SRS proposal — Revision 50**

# Draft SRS Revision 50 — editing a recurring schedule: the three scopes, and the split

> **Status: APPLIED to `docs/SRS.md` on 2026-08-05**, on the Document Owner's explicit
> authorisation to edit the specification directly — *"I am explicitly authorizing that change
> even if it overrides the previous guardrail in CLAUDE.md."*
>
> **The SRS is now the source of truth for this behaviour.** §0 carries the Revision 50 entry,
> §4.4 the three scopes and the split, TD-3.12 the `scope`/`from_date` parameters, §7
> `effective_until`, and §18 the acceptance criteria.
>
> This file is retained only for the **rationale** — the rejected alternatives and the
> implementation traps below, which the specification states as rules rather than arguments.
> Delete it once that reasoning has a home in the handbook.

---

## The decision

An administrator editing one occurrence of a recurring class must be asked **which occurrences
the change applies to**, and offered exactly three answers:

1. **This session only**
2. **This session and all future sessions**
3. **All sessions of this schedule**

This is the behaviour every calendar application has trained people to expect, and its absence
is a trap: an administrator who moves "the Tuesday class" without being asked has no way to know
whether they moved one week or the year.

**The same question applies to every operation that can reach a series** — edit, cancel, delete.
Not only to edits.

## What the model already does, and the one thing it cannot

Two of the three scopes are **already implemented**, and this revision does not change them:

| Scope | Mechanism today | Status |
|---|---|---|
| **This session only** | `PATCH /sessions/{id}` — sets `overridden`, which Revision 43.4 defines as *a human decided about this occurrence*, and Revision 43.6 then protects from later schedule rewrites | Built |
| **All sessions** | `PATCH /admin/course-schedules/{id}` — rewrites future un-overridden sessions and reports `resynced` and `protected_sessions` | Built |
| **This and all future** | **Nothing.** No mechanism ends a schedule at a date | **Missing** |

`RecurringCourseSchedule` carries `anchor_date` — where the recurrence *starts counting* — and
**no end date at all**. Materialization runs from today to `horizonFor()`, the end of the current
academic year. So the model can say when a series begins and cannot say when it stops.

**That absence is the whole gap.** Everything else this revision needs already exists.

## The mechanism: split the schedule

**"This session and all future" is implemented by splitting the schedule in two.** No new
recurrence engine, no exception table, no per-occurrence rule storage.

Given a schedule `S` and a selected occurrence on date `D`:

1. **`S` is closed at the occurrence before `D`** — `S.effective_until = D − 1 day`.
2. **A successor `S'` is created**, carrying `S`'s values with the edit applied, and
   `anchor_date = D`.
3. **Sessions before `D` are untouched.** They belong to `S`, whose recurrence rule has not
   changed for any date it still covers.
4. **Sessions from `D` onward that belong to `S` are re-pointed or removed** per the existing
   materialization rules, and `S'` materializes its own.
5. **Overridden sessions keep their overrides**, exactly as they do under an "all sessions" edit
   today. Revision 43.6's protection is unchanged and is *not* re-specified here — it applies
   because the split uses the same materialization path, not because this revision says so.

### Why a split rather than an exception model

An exception table — per-occurrence overrides of a recurrence rule — is the other common answer,
and it is the wrong one here:

- **The platform already has per-occurrence overrides.** `Session` rows are materialized eagerly
  (TD-4.6c), each one is real, and `overridden` already marks the ones a human touched. A second
  exception mechanism would mean two ways to say *this occurrence differs*, and §20 rule 22's
  lesson applies: two representations of one fact drift.
- **Conflict detection runs against materialized sessions, never against rules** (§4.4). A rule
  that carried exceptions would have to be expanded before it could be compared, which is exactly
  what eager materialization exists to avoid.
- **A split is expressible in the entities that already exist.** Two schedules, each with a plain
  recurrence, each materializing normally. Every downstream consumer — conflicts, rosters, the
  calendar, the Session page — keeps working with no knowledge that a split happened.

### The one schema change

```
RecurringCourseSchedule.effective_until   DATE NULL
```

**`NULL` means open-ended**, which is what every schedule is today and what most remain. It is a
**calendar date**, not an instant (TD-11) — a schedule ends after a day's classes, not at a
timezone-dependent moment.

**`anchor_date` and `effective_until` are the bounds of one series.** Materialization already
starts at `anchor_date` where present; it gains one condition — *stop at `effective_until`* —
and nothing else changes.

## What this revision deliberately does not do

- **It does not change `overridden`.** Revision 43.4's definition — *a human decided*, not
  *differs from the schedule* — is what makes "this session only" work at all, and it is
  untouched.
- **It does not change Revision 43.6's protection predicate.** A split runs through the same
  materialization path, so protected sessions are protected for the same reason and by the same
  code.
- **It introduces no new endpoint.** The split is performed by
  `PATCH /admin/course-schedules/{id}` under a new `scope` parameter — see below — because it is
  an edit to a schedule, and a second route returning the same resource is duplication rather
  than separation (the rule Revision 45 records).
- **It does not apply to Events.** A standalone Event is not a series; §4.4 gives it its own
  recurrence, and nothing here changes it.

## Exact wording to apply

### 1. New entry in §0

> **Revision 50 (Document Owner decision — recurrence edit scopes, 2026-08-05):** an
> administrator editing, cancelling or deleting one occurrence of a recurring class **must be
> asked which occurrences the change applies to**, and offered exactly three scopes: **this
> session only**, **this session and all future sessions**, and **all sessions of this schedule**.
> The question is mandatory for **every operation that can reach a series**, not only for edits —
> an administrator who moves "the Tuesday class" without being asked cannot know whether they
> moved one week or a year.
>
> **Two scopes are unchanged and already implemented.** *This session only* is
> `PATCH /sessions/{id}`, which sets `overridden` (Revision 43.4 — *a human decided about this
> occurrence*) and is thereafter protected from schedule rewrites (Revision 43.6). *All sessions*
> is `PATCH /admin/course-schedules/{id}`, which rewrites future un-overridden sessions and
> reports `resynced` and `protected_sessions`.
>
> **"This session and all future" is implemented by SPLITTING the schedule, and no other
> mechanism is authorised.** The current schedule is closed at the day before the selected
> occurrence and a **successor schedule** is created carrying the new values, anchored at that
> occurrence. Past sessions are untouched; overridden sessions keep their overrides; sessions
> from the split date follow the successor. **An exception model is explicitly rejected:** the
> platform already materializes every occurrence as a real `Session` and already marks the ones a
> human touched, so a second way to say *this occurrence differs* would be two representations of
> one fact — and §4.4 computes conflicts against materialized sessions rather than rules, which a
> rule-with-exceptions would defeat.
>
> **One schema change:** `RecurringCourseSchedule` gains **`effective_until`** (nullable calendar
> date, TD-11). **`NULL` means open-ended**, which every existing schedule is. Together with
> `anchor_date` it bounds one series, and materialization gains exactly one condition — stop at
> `effective_until`.
>
> **No new endpoint.** The scope travels as a parameter on the existing schedule edit; a second
> route returning the same resource is duplication rather than separation (Revision 45).

### 2. §4.4 — after the recurrence paragraph

> **Editing a recurring class asks for a scope (Revision 50).** Every operation that can affect
> more than the selected occurrence — edit, cancel, delete — presents the three scopes above and
> **states which occurrences are about to change before the administrator confirms**. A default
> is permitted; a silent choice is not.
>
> **The split is the mechanism for *this and all future*.** Closing a schedule at
> `effective_until` and anchoring a successor at the split date keeps every downstream
> consumer — conflict detection, rosters, the calendar, the Session page — working with no
> knowledge that a split occurred, because both halves are ordinary schedules.

### 3. TD-3.12 — `PATCH /admin/course-schedules/{id}`

> Body gains **`scope`**: `all_sessions` (default, the present behaviour) or `this_and_future`,
> the latter requiring **`from_date`** — the occurrence the split begins at. `this_and_future`
> answers with **both** schedules and the materialization report, since the caller's list now
> contains two rows where it had one.

### 4. §7 — `RecurringCourseSchedule`

> **`effective_until` (nullable, Revision 50).** The last calendar date this recurrence
> produces occurrences for. **`NULL` is open-ended**, and is the value of every schedule created
> before this revision and of most created after it. Set when a schedule is split; with
> `anchor_date` it bounds the series.

### 5. §18 — acceptance criteria

> ☑ Editing an occurrence offers three scopes and states which occurrences will change
> ☑ *This session only* leaves the schedule untouched and the occurrence `overridden`
> ☑ *This and all future* splits: past sessions unchanged, overrides preserved, future
> occurrences follow the successor
> ☑ *All sessions* behaves exactly as before, sparing overridden sessions
> ☑ A split schedule materializes no occurrence after its `effective_until`

---

## Implementation notes for whoever builds it

- `horizonFor()` bounds materialization at the academic year's end; `effective_until` is a
  **second** upper bound, and the earlier of the two wins.
- `expandSchedule()` is the single place that turns a rule into dates — the `effective_until`
  condition belongs **there and nowhere else**, or two expansions will disagree.
- The split is one transaction: close `S`, create `S'`, re-materialize. A half-split leaves a gap
  in the timetable, which is worse than either outcome.
- `CourseScheduleStaff` rows must be copied to `S'`; a successor with no staff would silently
  drop the teacher from every future session.
