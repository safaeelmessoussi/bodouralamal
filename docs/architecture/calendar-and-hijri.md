[Documentation](../README.md) › [Architecture](README.md) › **Calendar and Hijri**

# Calendar and Hijri

The calendar is the platform's most visible surface — it is on the landing page, open to
anonymous visitors — and its two halves each contain a decision worth understanding.

## Scheduling is schedule-driven

Organisation and delivery are **separate**, and the calendar is where that separation
becomes visible.

```
ORGANISATION  (who is grouped with whom)
  AdministrativeGroup ── level + branch + name.  NO room, teacher, schedule or capacity.
  TeachingGroup       ── subject + level.  Exists ONLY where a subject splits its students.

DELIVERY  (what is taught, when, by whom, where)
  RecurringCourseSchedule
      subject · teaching_mode + ONE target · branch · room · teacher + assistants
      start_time · end_time · recurrence
      teaching_mode ∈ entire_level | administrative_group | teaching_group

           │  session.materialize  (pg-boss, eager, to the academic-year horizon)
           ▼
  Session ── ONE DATED OCCURRENCE
      carries its OWN date · time · room · teacher · status
      defaulted from the schedule, individually overridable
      notes · recordings · linked content · (later) attendance hang HERE

NON-TEACHING  (everything that is not a class)
  Event  ── holidays · ceremonies · exams · one-off activities
            NEVER generates a Session
```

**Sessions are materialized eagerly, not computed on read**, and the reason is conflict
detection. Comparing recurrence *rules* cannot see that a weekly and a biweekly-alternating
Tuesday 15:00 collide only on alternate weeks. Comparing materialized rows can, so overlap
checks on room, teacher **and assistant** are exact rather than approximate.

**A session edit is not a schedule edit.** Cancelling a class, moving it to another room, or
adding a makeup are edits to a *session row*, which marks it `overridden`. The next schedule
edit then leaves it alone — as it leaves alone any session carrying a note, a recording, a
content link or a grade — and reports what it skipped. Silently discarding a human decision
is the failure this rule exists to prevent.

The calendar renders a unified grid of both sessions and events, in one list. **It is
public**: anonymous visitors get the same filter set as signed-in users, who additionally
get those filters *prefilled* from their profile. Identical filters never means identical
results — every result set stays visibility-filtered.

> [`BR-17`](../reference/business-rules.md#br-17) ·
> [`BR-23`](../reference/business-rules.md#br-23) · SRS §4.4, §4.4c

## Wall-clock time, and the Ramadan trap

**Schedule, session and event times are local Moroccan wall-clock values** — a `time` or
`date` with an implicit timezone — **not UTC instants.** Persisted timestamps (`created_at`, audit rows,
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

**The development fixtures deliberately seed nothing here**, and the reason is worth knowing
because it is not obvious.

Only two real announcements exist anywhere in this project: 1 Dhu al-Hijja 1447 = 18 May 2026
and 1 Muharram 1448 = 17 June 2026 (recorded in Revision 31). Seeding beyond them would mean
**inventing** an official religious calendar — a fabricated month start looks authoritative
and is wrong, which is the worst possible failure for this feature.

And **the integration suites own those two years, with the stronger claim.**
`calendar.integration.test.ts` asserts that 16 June 2026 still reads `1447-12-30` — Umm
al-Qura puts 1 Muharram 1448 there, Morocco announced the 17th — and that test is the guard
that catches an algorithm creeping back in. It must use the real values. Since
`(hijri_year, hijri_month)` is unique, a fixture row for 1447/12 collides with the row that
test creates, and the suite's cleanup deletes it. **A fixture that vanishes the first time
someone runs the tests is worse than no fixture**, because the disappearance is silent.

> **To see the overlay locally, record two consecutive months through the API** — the exact
> calls are in [Recording an official Hijri month](../operations/runbooks.md#recording-an-official-hijri-month).
> Two, not one: a single month resolves only its certain 29 days.

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

### Re-examined 2026-08-05: automation was reconsidered and rejected again

The Document Owner restated *"the system MUST always follow the official Moroccan Hijri
calendar"* as a project constraint and asked whether something more robust than manual
maintenance was possible. It was re-examined from scratch, and **the constraint is precisely
what rules automation out.**

Every automatable Hijri calendar is a *calculation*, and Morocco does not calculate:

| Candidate | Why it fails the constraint |
|---|---|
| **Umm al-Qura** | Saudi Arabia's calculated calendar. Diverges from Morocco's announcements regularly, and by design — different country, different method |
| **Tabular / arithmetic** | A fixed 30-year leap cycle. Cannot represent an observation-based calendar at all |
| **Astronomical conjunction / visibility models** | Predicts when the crescent *could* be seen. Morocco declares when it *was* seen, by naked eye, from Moroccan territory — the two disagree whenever weather or judgement intervenes |
| **Scraping the Ministry's announcements** | Prose news posts with no stable structure, published *after* the sighting. A parser here fails silently and produces a wrong date, which is worse than no date |

**An automated overlay would not be occasionally imprecise — it would be confidently wrong**,
and a wrong official date is a worse failure than a missing one. Automation does not serve
this constraint; it violates it. **The Revision 32 decision stands unchanged.**

### The failure mode that IS worth fixing: running out in silence

Correctness was never the weakness of the manual path — [silence over guessing](#the-overlay-is-invisible-until-someone-records-a-month--including-in-development)
is exactly right, and `baseHijri` returns `null` rather than a guess.

The weakness is **operational**: when the recorded months run out, every date quietly renders
Gregorian-only and *nothing says so*. No error, no log, no screen state. A manually maintained
dataset that degrades in silence is how a feature stops working without anyone noticing.

So `GET /admin/hijri-calendar` carries a **`coverage`** block — `published_through`,
`days_remaining`, `warning`, `next_unrecorded` — on the screen that exists to maintain it.

Four decisions inside it, each with a reason:

- **It computes no Hijri date.** It is arithmetic on Gregorian dates the Ministry supplied.
  The constraint is untouched.
- **`days_remaining` counts to the 29-day floor, not 30**, because day 30 only resolves when
  the next consecutive month is recorded. Counting to 30 would promise runway the resolver
  will not deliver.
- **It goes negative rather than clamping at zero.** *Expired 40 days ago* and *expires today*
  call for different urgency, and clamping erases the difference.
- **`null`, never `0`, when nothing is published.** *Nobody has recorded anything* and *it ran
  out today* are different answers; a screen showing `0` for both reports an expiry that never
  existed.

**Only published months count** — §5.7 renders only those, so counting drafts would report
runway the platform will not use.

**No route was added** (§20 rule 16): this extends the response of the endpoint that already
exists for exactly this job.

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
