[Documentation](../README.md) › [Architecture](README.md) › **Calendar and Hijri**

# Calendar and Hijri

The calendar is the platform's most visible surface — it is on the landing page, open to
anonymous visitors — and its two halves each contain a decision worth understanding.

## Scheduling is group-driven

The inverse of most calendar systems, and the source of most of this design.

```
Group  ──  the SCHEDULING UNIT
           carries its own fixed weekly slot:
           day_of_week · start_time · end_time · room · branch · max_students

Student enrols in a Group
   └─ and thereby acquires that standing weekly class time

Event  ──  the EXCEPTION LAYER
           holidays · one-off activities · exams · makeup sessions · ceremonies
           anything that is NOT "this group's normal weekly slot"
```

**There is no per-session object.** Nothing is generated week by week, so nothing has to be
regenerated when a group's time changes. A group's schedule *is* its columns.

The calendar renders a unified grid of both: expanded group occurrences and events, in one
list.

> [`BR-17`](../reference/business-rules.md#br-17) · SRS §4.4

## Wall-clock time, and the Ramadan trap

**Group and event times are local Moroccan wall-clock values** — a `time` or `date` with an
implicit timezone — **not UTC instants.** Persisted timestamps (`created_at`, audit rows,
job times) are UTC; scheduled times are not.

The specification calls this out as *a known agent trap*, and it is worth the space:

> Morocco observes UTC+1 but **suspends DST during Ramadan every year**. A weekly class
> stored as a UTC instant would silently shift by an hour, twice a year, for every group in
> the system.

A class at 17:00 is at 17:00 on the wall clock. Always.

Rendering, recurrence expansion, and "today" boundaries are computed in `Africa/Casablanca`,
with tzdata pinned in the Docker image so the transitions stay current. **Week starts
Monday** everywhere.

A named regression test asserts that wall-clock times survive a simulated Ramadan
transition.

## Recurrence

Five patterns: none, daily, weekly, **biweekly-alternating** ("week on, week off"), and
yearly.

The alternating pattern is **modelled and tested explicitly** because it is the one naive
implementations get wrong — usually by computing parity against an arbitrary epoch rather
than the series' own anchor.

## Multi-scope events, written explicitly

An event may apply to several branches, categories, levels, or groups at once. Those
relationships are **written into join tables at creation time**, never evaluated as
wildcards at read time.

Four join tables — branch, category, level, group — rather than one polymorphic table. That
choice matters beyond the calendar: it is cited as the precedent for rejecting a generic
`scope_type`/`scope_id` authorization framework, because a polymorphic scope column **cannot
carry a foreign key** and would forfeit the referential integrity every other relation
relies on. One schema should not contain two contradictory scope idioms.

Only branches whose operational start date has arrived are populated.

### Branch activation and backfill

Each branch carries an `operational_start_date`. In branch-scoped calendar views, dates
before it are **greyed out** with no scheduling data rendered.

When a branch activates, an Admin performs a **manual backfill** listing the applicable
global and recurring events to attach — or knowingly skips it.

> **The gap is never silently auto-filled and never silently ignored.** Both silent options
> are wrong: auto-filling invents history nobody scheduled, and ignoring it produces a
> branch with an inexplicably empty calendar.

Backfill stays an **Admin** capability even though branches are Super-Admin-managed
reference data, because it is *operational* work — populating events when a branch
activates — not reference management.

## Three visibility tiers

Stored as an enum, never a boolean.

| Tier | Who sees it |
|---|---|
| **Public** | Unauthenticated visitors and every approved user |
| **Private** | Any logged-in approved **Student** — deliberately *not* filtered by their own branch or group — Parents in a linked student's context, and Staff within branch scope |
| **Hidden** | **Teachers only for events whose scope intersects their assigned groups**; all Admins regardless of branch; Super Admins. Invisible to students and parents entirely |

Two accepted trade-offs are recorded rather than hidden:

- **Cross-branch private visibility** (Risk R-6): any logged-in student sees every private
  event across all branches. Accepted deliberately; revisit if branches request isolation.
- **Hidden-event existence leaks through conflict detection** (Risk R-7): a room-conflict
  check against a hidden event reveals that *something* occupies that slot. Accepted
  consciously.

`Pending` users see the public tier only, which is effectively nothing beyond the public
calendar.

---

## The Hijri overlay

The more interesting half, and one of the clearer examples of this project's method.

### The problem

**Morocco fixes each Hijri month by local moon sighting**, announced by the **Ministry of
Habous and Islamic Affairs** on the evening of the 29th. It regularly differs from Umm
al-Qura and from every calendar library's algorithm — for example, 1 Muharram 1448 falls on
Wednesday 17 June 2026, where Umm al-Qura gives 16 June.

### What was tried, and why it failed

The original design used a library algorithm plus a **globally adjustable ±2-day offset**
that a Super Admin could tune.

**Revision 31 removed it entirely.** The reasoning: an offset can only ever *approximate* a
sighting-based calendar, and it approximates it **uniformly** — while the Ministry's actual
divergence from Umm al-Qura varies month to month. A single global correction is the wrong
shape for a per-month phenomenon.

### What replaced it

> **The platform reproduces exactly the official Hijri calendar published by the Ministry.
> It computes nothing.**

One table, `HijriMonthStart`, records per Hijri year and month the Gregorian date on which
that month officially began. **Every Hijri value in the platform derives from it**, through
a single resolution function that every consumer goes through.

```
Super Admin records the Ministry's announcement
   └─ HijriMonthStart(year, month, gregorian_start_date, status = draft)
        └─ reviewed, then published
             └─ ONLY published months render anywhere
                  └─ every calendar consumer resolves through one function
                     against this one table
```

### The overlay is invisible until someone records a month — including in development

This is the single most common source of *"the Hijri dates are broken"*, and they are not.

`HijriMonthStart` starts **empty**. The production seed deliberately puts nothing in it
(§15.1), so a fresh deployment renders **no Hijri values at all** until a Super Admin records
the Ministry's announcements. That is correct by rule and indistinguishable, on screen, from a
broken feature.

Two further boundaries follow from the resolver, and both look like bugs until you know them:

| Situation | What renders | Why |
|---|---|---|
| Nothing recorded | Nothing | Silence over guessing |
| A month recorded but **`draft`** | Nothing | Only published months render anywhere |
| A month recorded, the **next one not** | Its first **29** days only | Knowing when a month *began* says nothing about when it *ended* — that depends on the next sighting. Day 30 is only certain once the following month is recorded |
| Two **consecutive** months recorded | The earlier one, complete | The later start is what proves the month ran 29 or 30 days |

So a partly-labelled month on screen — the first half filled, the second blank — is **the
resolver working correctly**, not a gap. It means the following month has not been announced
yet.

**Development fixtures carry the two announcements this project has on record** — 1 Dhu
al-Hijja 1447 = 18 May 2026 and 1 Muharram 1448 = 17 June 2026 — so the overlay is
demonstrably alive locally. Everything beyond them would be **invented**, and fabricating an
official religious calendar is exactly what these revisions exist to prevent: a made-up month
start would look authoritative and be wrong.

> **There is currently no interface for recording a month.** The Super Admin
> *Hijri Calendar Management* screen (§5.7) is not built; the four endpoints exist, so the
> only way to record an announcement today is an authenticated API call. Until that screen
> ships, keeping the overlay current is a task nobody can perform through the product.

### Three consequences, all deliberate

**A month that has not been recorded and published carries no Hijri label at all.** Not a
computed guess, not a fallback algorithm — nothing. Where the official answer is genuinely
not yet known, the platform says nothing. Fabricating one would defeat the entire purpose.

**This is recurring administrative work**, not a one-off setup task: roughly one recording a
month, plus any correction the Ministry issues. It is listed as an owner task for exactly
that reason.

**The Super Admin records; they do not decide.** Revision 32 made this a vocabulary rule
enforced across the specification, the API, the interface, and the code:

| Required | Prohibited |
|---|---|
| *record official month start* | *choose month start* |
| *publish official month* | *define month* |
| *official Ministry announcement* | *set month* |

This is not pedantry. Wording that reads as a choice invites treating the value as editorial
judgement, and the platform's entire claim is that it **reproduces an external authority
rather than forming its own view.**

### Why there is no importer

An investigation is recorded in the specification, and its conclusion is a design decision:

The Ministry publishes each month start as a **prose news announcement after the sighting**.
There is **no API, no feed, no downloadable dataset**. And because Morocco fixes each month
by observation on the evening of the 29th, **a full year cannot be published in advance**.

So a shipped import endpoint could only ever answer *not configured*.

> An endpoint that cannot succeed is not an integration point; it is a promise the system
> cannot keep, and it invites a client to build against it.

The manual path is therefore **the primary path, not a fallback**.

**Extensibility is preserved by data, not by scaffolding.** No abstract provider interface
or registry ships, because an abstraction with no implementation is unused scaffolding.
What remains is sufficient and deliberate:

- `recordMonthStart` is **the single write path**, so a future importer calls the same
  service and inherits its ordering rule, optimistic locking, draft state, and audit trail.
- `HijriMonthStart.source` records provenance on the row, so imported and manually recorded
  months are distinguishable **without a schema change**.
- Every reader already goes through one resolution function against one table.

If the Ministry ever publishes an API or dataset, an importer is added **without redesigning
anything** — what is needed is a fetcher, a route, and an audit row.

### Constraints that protect the data

Beyond the obvious range checks (month 1–12, year 1300–1600 — which brackets any date this
platform will render while rejecting a mistyped Gregorian year):

- **Two months of one year may not share a Gregorian start date.**
- **Month *n+1* must start after month *n*.**

An out-of-order pair would make date resolution ambiguous, so the database refuses it.

### Optimistic locking, and why it applies here

`HijriMonthStart` carries a version column: two Super Admins correcting the same month must
not clobber each other. The recording audit row captures **both the previous and the new
start date**, because *the correction is the interesting event* — this table reproduces
official announcements, and a wrong month start silently shifts every Hijri label in it.

---

## The calendar screen's two requests

The frontend calendar makes **exactly two requests, and never a third** — including when a
user opens an event.

| Request | Returns | Cached |
|---|---|---|
| `GET /calendar/bootstrap` | The **chrome**: Hijri day mapping, month metadata for the dual title, category, level, and branch lists | 5 minutes, strong ETag |
| `GET /calendar` | The **occurrences**, each self-sufficient | No |

`?category_id=` on the bootstrap narrows **only the Level list**, server-side — §4.4 requires
that (*"so the client never filters a list it was handed"*). The Hijri days, month metadata,
categories, and branches are the calendar's chrome regardless of which category is selected.

An unknown category id yields an **empty** level list rather than falling back to all levels:
a filter that quietly stops filtering is worse than one returning nothing, because the screen
would show every level while claiming to show one category's.

**Occurrences are self-sufficient** — carrying description, recurrence, branch and room
names, category, level, and resolved instructor display names — so opening an event dialog
costs no further request. The alternative was an N+1 on a public screen.

**The bootstrap carries reference data only, never operational data.** Events, enrolments,
progress, and grades are not admissible, whatever a future screen would find convenient.
Without that limit a bootstrap becomes a dumping ground.

The month metadata is what lets the client render the dual title *"يوليوز 2026 | محرم 1448"*
— or *"يوليوز / غشت 2026 | محرم / صفر 1448"* across a boundary — **with no month-transition
logic in the client at all.** The rule the client follows is the whole of it: one entry
renders one name, two render both joined by a slash; the year prints once when both months
share it and twice when they do not.

**Where a month has not been recorded, the client renders nothing at all** — no Hijri number
in the day cell, and the title's Hijri side and its divider are both omitted rather than left
blank. That is the same "silence over guessing" rule the backend follows, carried through to
the pixel.

> Design rationale in full: [API](api.md#designing-an-endpoint-the-bootstrap-as-a-worked-example)

Instructor names arrive **already resolved**. The backend decided which name is public; the
client renders it verbatim and implements no fallback
([why](security.md#on-public-surfaces)).

---

**Next:** [Frontend](frontend.md) · **Related:**
[Business processes](../overview/business-processes.md#3-scheduling),
[Database](database.md#hijrimonthstart--the-calendars-sole-source)
