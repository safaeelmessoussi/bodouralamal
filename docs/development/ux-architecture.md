[Documentation](../README.md) › [Development](README.md) › **Platform UX & atomic design**

# Platform UX & atomic design rules

**Cross-cutting. Consult this before implementing any UI request** — the rules
below are what a request is interpreted *against*, not a checklist applied
afterwards.

This page states **how the platform's surfaces behave and how its components are
composed**. It is the counterpart to the [engineering
constitution](engineering-constitution.md), which states what must be true of any
implementation: the constitution's §2 says *one component per concept*, and this
page says what the concepts are and what each one does.

It **cites `docs/SRS.md` rather than restating it** (§16.4). §14.1's sitemap,
§14.2's list standard, §14.4's mandatory states and §20's guardrails are
normative and are not reproduced here; where a rule below has an SRS home, the
reference is given and the SRS wins.

> **Why this page exists.** Every rule here was written after the same defect
> appeared for the second or third time on a different screen. A management page
> gated behind a dropdown was fixed on `حلقات المواد` (R69), then found again on
> `نقاط الامتحانات`, `مقرر الحفظ`, `مواد المستوى`, `/teacher/quran` and a student
> picker. A Level rendered without its Category was fixed on four screens, then
> found on two more. A second button system existed for ten call sites without
> anybody deciding it should. **The pattern is never one screen being wrong — it
> is a rule that was implemented instead of being written down.**

---

## A · Data-first pages

**A management page shows the data it manages immediately.**

A reader arriving on a page must be able to answer, without clicking anything:
what does this page manage · what already exists · how many · what does each one
contain · what can I do to them.

**No dropdown gate.** Never require a selection before the page's primary data
appears. The shape to recognise:

```
BAD                              GOOD
─────────────────────────────    ────────────────────────────────
Title                            Title
"Choose an exam"   ← a gate      Description
(empty page)                     ＋ Primary action (if owned here)
                                 Search · filters   ← narrowing
                                 Table of everything
                                 Pagination · row actions
```

**The observable trace of a gate is its copy**: *«اختاري X لعرض Y»* — choose
something in order to see something. A page that renders its data never needs
that sentence, which is why
[`atomic-components.test.tsx`](../../frontend/src/components/ui/atomic-components.test.tsx)
scans for it.

**A detail view does not replace the list.** The list stays reachable and stays
first; the detail is what a row action opens, addressed by a **query parameter**
(`?exam=`, `?level=`, `?student=`) rather than a path segment, because a new
segment would be a navigation node §14.1 does not list (§20 rule 16).

**The exception, and it is narrow:** a page that is genuinely a *detail workflow*
rather than a list. If you believe you have one, say why in the module docstring.

## B · Standard page structure

```
Title → description → primary action (if the page owns creation)
      → search / filters → table → pagination → row actions
      → empty state, only when the data is genuinely empty
```

**The title does not change when a detail opens.** `نقاط الامتحانات` stays
`نقاط الامتحانات` with an exam open; the exam's name is *context inside the
page*, rendered **once**. Replacing the heading with the record's name means the
reader who arrived from the menu finds a title that does not match what they
clicked — and it is how the same name came to be printed twice, three lines
apart.

**The primary action lives in the layout's `actions` slot**, beside the heading —
never in the table's toolbar. The toolbar narrows what is listed; creating a
record is not a filter.

**A page that does not own creation offers no create control**, and says where
creation lives. `نقاط الامتحانات` links to `الجدولة` because an exam is scheduled
there (R56); it does not grow a second authoring form. §20 rule 16.

## C · One concept → one atomic component

The constitution's §2 law, with the platform's register:

| Concept | Component |
|---|---|
| Any button or call to action | [`ui/button.tsx`](../../frontend/src/components/ui/button.tsx) — `Button`, `ButtonLink`; variants `primary · secondary · ghost · danger · add` |
| Any list of records | [`ui/data-table.tsx`](../../frontend/src/components/ui/data-table.tsx) — `DataTable` + `Pagination` |
| The five UI states | [`states.tsx`](../../frontend/src/components/states.tsx) — loading · empty · no-results · error · no-permission (§14.4) |
| A Level, chosen or displayed | [`scope/level-select.tsx`](../../frontend/src/components/scope/level-select.tsx) — `LevelSelect`, `levelLabel`, `withCategoryNames` |
| One choice from many | [`ui/searchable-select.tsx`](../../frontend/src/components/ui/searchable-select.tsx) — `SearchableSelect` |
| Several choices from many | [`ui/multi-select.tsx`](../../frontend/src/components/ui/multi-select.tsx) — `MultiSelectField` |
| Any form field | [`ui/field.tsx`](../../frontend/src/components/ui/field.tsx) — `TextField`, `SelectField`, `DateField`, `NumberField`, `TextArea`, `SearchInput` |
| A form in a dialog | [`ui/form-dialog.tsx`](../../frontend/src/components/ui/form-dialog.tsx) |
| Any destructive confirmation | [`ui/confirm-dialog.tsx`](../../frontend/src/components/ui/confirm-dialog.tsx) |
| A status or kind marker | [`ui/badge.tsx`](../../frontend/src/components/ui/badge.tsx) |
| Curriculum selector dependencies | [`hooks/use-scope-options.ts`](../../frontend/src/hooks/use-scope-options.ts) + `scope/scope-selectors.tsx` |
| The lead-plus-assistants shape | [`scheduling/staff-picker.tsx`](../../frontend/src/components/scheduling/staff-picker.tsx) |

**A different appearance is a documented variant, never a second
implementation.** `danger` and `add` are variants of `Button` for exactly this
reason; a `DangerButton` beside it would make *"this one is irreversible"* look
different depending on the screen.

**Never hand-write a component's classes.** `className="btn btn--secondary"` on
an `<a>` is a second button, and `.button` / `.button.primary` — which existed
here, in its own CSS block, across ten call sites — is a second button *system*.

## D · The Level label

**Always `{Category} — {Level}`**, through `levelLabel`, everywhere: selectors,
filters, table columns, dialogs, deep-link headings.

**It is not decoration.** §4.4b: Level names are **not unique across
Categories** and levels are not numbered uniformly, so *فرصة أمل* may exist in
two Categories and a bare name genuinely fails to identify one.

**When a source carries only `category_id`** — the calendar bootstrap does — join
the names with `withCategoryNames`. The payload already contains them; a bare
label is a missing join, not a missing field.

**The documented exception:** a context where the Category is *stated by the
surrounding structure* — Level cards under an `<h2>` naming their Category, where
the prefix would repeat the heading directly above. Say so where you make it.

**A category-narrowed *list* is not that exception.** The calendar's Level filter
argued it was, and it was wrong: narrowing happens only once a Category is
chosen, and *all Categories* is the default.

## E · Searchable dropdowns

**Opening shows the options. Typing narrows them.**

* Never require input before anything appears.
* Search is **client-side narrowing of a list the caller already handed over** —
  never a data-loading trigger, and never a substitute for one.
* Rank a **prefix** match above a substring match: typing the beginning of a name
  is the common case and must not be buried.
* Below ~8 options the search box is noise; the component decides that, not the
  caller.

**A typed-search workflow is a different thing and is almost never what you
want.** *"Type two characters to see students"* offers nothing to a reader who
does not already know the name — and a picker that only answers questions you
could have answered yourself is not a picker. Reach for one only when the dataset
is genuinely too large to send, and say so.

## F · Filters

**Filters narrow visible data. Filters never gate initial visibility.**

The API side of the same rule: **every filter parameter is optional and none is
required.** `GET /admin/teaching-groups` takes `level_id`, `subject_id`,
`category_id`, `q` and requires nothing — which is what lets its screen render on
arrival. A required filter reintroduces the gate at the contract, where no UI
change can remove it.

An active filter with no matches is **`NoResultsState`**, not `EmptyState`:
*nothing here yet* and *nothing matches your filters* need different answers
(§14.4).

## G · Add buttons

**Every create action is `<Button variant="add">`.** The variant emits the `＋`;
a caller never types it.

The rule exists because the glyph was in a *translation string* for exactly one
screen — so `تسجيل مستفيدة` carried it and `إضافة مجموعة` did not, and neither
was a decision anybody took. A convention applied by hand is a convention applied
unevenly.

## H · Tables

Use `DataTable`. It implements §14.2's list standard once — header, rows, action
column, pagination — and all of §14.4's states, so every CRUD screen *is* the
same component rather than merely resembling one.

**Everything is configuration**: columns, actions, labels, empty copy. Adding an
entity means passing different configuration, never editing the component.
Sorting and manual reordering are configuration too — see [AF](#af--ordering-a-list-sort-is-a-question-drag-is-a-decision).

**The one legitimate exception is a table whose cells hold live form controls**
bound to per-row draft state — the grade sheet, the Quran log editor, the Hijri
month editor. `Column.cell` *can* render an input, but the row model assumes a
row is a value to read and act on, not a form field with its own dirty state and
save. Three screens qualify; they are named with their reasons in the guard's
allowlist. **A fourth is the signal to build an editable-table primitive**, not
to add a fourth exception.

A **calendar month grid** is a `<table>` and is not a list: weekdays across, weeks
down, a cell addressed by both. Different concept, permanent exception.

## AF · Ordering a list: sort is a question, drag is a decision

Two different acts, and the platform keeps them apart because confusing them is
what makes a saved order untrustworthy.

**A column sort is a temporary view.** The header is a real `<button>`; first
press ascending, second descending, third ascending again — never back to
"unsorted", which a reader cannot tell apart from ascending and which makes the
third click look broken. `aria-sort` sits on the `<th>`, because the direction is
a property of the column. Only a column declaring `sortKey` becomes a button; the
actions column never does. **The server sorts** (`?sort_by=&sort_dir=`): a client
sorting one page of a paginated collection would order that page and misreport it
as the collection's order.

**A drag is a persisted business decision.** «الترتيب» is no longer a number
anybody types — the column and the form field are both gone from every screen —
because a number *and* a sequence stating the same fact disagree the first time
either is used. The row carries a grip; the grip is a `<button>` and ↑/↓ move the
row, since native drag-and-drop is mouse-only and a persisted decision must not
be pointer-exclusive. The client never computes `display_order`: it sends the
**sequence**, and the server assigns the positions.

**Drag is offered only in canonical order, and the table decides that itself.**
Three states block it, and `DataTable` derives all three from what it already
holds rather than taking a prop each page must remember to pass:

| Block | Why |
|---|---|
| `sorted` | Under a column sort the visible sequence is not the business one, so a drop would persist a position the reader never intended |
| `paged` | The contract takes the **exact live set**; a page-sized — or search-filtered — sequence is refused by the server, so the gesture would be a request that cannot win |
| `scope` | `Level` and `AdministrativeGroup` order **within a parent** (§2.2), so until one is selected the rows on screen span several sequences |

A blocked handle is **disabled and explained**, never hidden and never inert: the
status line under the table names the way out — clear the sort, show everything
on one page, pick a Category. This is the rule that would rot fastest as a
per-page flag, and `paged` is the case a page would forget: the server refuses,
and the reader sees a drag that silently does nothing.

The optimistic order is held until **the rows that come back agree with it** —
releasing it when the request resolves would flash the old order for the length
of the refetch, which reads as the drop having failed. A refusal drops it at once.

### Which tables sort, and which deliberately do not

Sorting is **server-side wherever it exists** (R76.1), so making a column
sortable is an endpoint contract and not a table prop. The audit that decided
the current set:

| Sorts | Fields |
|---|---|
| الفروع · الفئات · المواد · المستويات · المجموعات الإدارية | R76's original five |
| حلقات المواد | `name` · `level` · `subject` (R78) |
| المستخدمون | `name` · `created_at` |
| التسجيلات | `student` · `level` · `branch` |

**Deliberately not sortable, and the reason matters more than the list.** A
grade sheet, a Quran log editor and the Hijri month editor hold **live form
controls bound to per-row draft state** — reordering them mid-edit would move a
reader's own unsaved work under them. A Level's surahs and a Level's subjects are
**assignment screens** whose order is the curriculum's, not a reader's. And a
student's own grades and progress are read in the order the domain gives them.

`account_status` was considered for المستخدمون and left out: its *alphabetical*
order (`active`, `pending`, `suspended`) is not its meaningful one, so the column
would look ordered and be arbitrary — the status **filter** already answers the
question a reader actually has. That is the general test: **a column is sortable
when its ordering means something, not when the data happens to permit one.**

> [`SRS R76`] · `components/ui/reorderable.ts` (the rules, as pure functions,
> because this project's component tests have no layout engine) ·
> [API contracts](../architecture/api.md#manual-ordering-takes-the-sequence-not-per-row-numbers)

## AG · A notification is a delivered fact, and the screen must not pretend otherwise

One event exists in the MVP — a class session was cancelled (§4.8 as narrowed by
Revision 77) — so the surface is a **section on the student's own dashboard**,
not §10.1's bell-and-dropdown. Chrome implying a stream of notice types would
promise a postponed feature; whatever §10.1 later specifies **replaces** this
rather than extending it.

**Nothing is marked read by being rendered.** R77.5 turns on the distinction: an
unread notice is *withdrawn* when a class is reinstated, a read one is
*corrected*. Auto-marking on scroll would make every notice read and turn every
restore into a correction nobody needed. The reader presses «تم الاطّلاع».

**A read notice stays on screen.** It is still true — the class is still
cancelled — and hiding it would make the section answer *what is new* while
looking like it answers *what has happened*. This is not an inbox that empties.

**With nothing to say it renders nothing**, rather than an empty panel on every
student's most-used screen.

**It sits above the timetable**, because a cancellation is news *about* the list
below it and a reader who saw the sessions first has already drawn the wrong
conclusion.

The unread marker is an inline-start border — **a shape, not only a colour**
(§14.4) — which reads correctly in RTL with no second rule.

> [`SRS R77`] · [API contracts](../reference/api-endpoints.md#notifications)

## AH · Recording is a second WAY to make a library item, never a second model

A saved recording is an ordinary `EducationalContent` with an `audio/*` MIME
(§4.9 as amended by Revision 75), created through the **existing**
`initiate → PUT → complete` pipeline and linked through the **existing**
`SessionContent` join. No new entity, no new endpoint, no new storage path — so
the consent gate, the visibility tiers, the quarantine-on-replace rule and R14's
upload quota all apply without being restated, because it is the same pipeline.

That is also why the recorder sits **beside the uploader in the same dialog**
rather than on a screen of its own. What a teacher is doing is *attaching this
week's audio*; where the bytes came from is an implementation detail of that.
The phone-record-and-upload path is untouched — this adds one and removes none.

**Where it cannot work, it is not offered and the reason is stated** (§14.4). The
component renders its own unsupported state, so no caller checks the browser: a
condition in the dialog would be a second opinion about `MediaRecorder`, and the
two would disagree the first time either changed. Every such message names the
phone path, because a person told only *this does not work* has been told nothing
they can act on.

**Pause produces one file, and the clock is not the duration.** `pause()` /
`resume()` keep a single `MediaRecorder`. Some containers then record a duration
that ignores the paused time, which is exactly why the elapsed reading is **UI
only** — nothing writes it anywhere and `EducationalContent` has no duration
column. The clock is `aria-live="off"`: a reading announced every second is a
screen reader nobody can use, and the *state* changes are what carry the meaning.

**Risk R-4 is accepted, and the guard covers what a guard can reach.** iOS
suspends `MediaRecorder` on screen lock or backgrounding and can truncate without
error — that residual risk is the specification's. What the interface removes is
the *silent* loss: a standing warning while recording, a `visibilitychange`
notice, and a `beforeunload` guard. The warning is styled as a **condition, not
an error** — danger colouring would make a normal state look like a fault and
leave nothing to say when one occurs.

**A failed save keeps the recording.** There is no resume (Risk R-9), so a retry
re-uploads from zero — but discarding the blob would make one network failure
cost the class.

> [`SRS R75`] · `lib/recorder.ts` holds the rules as pure functions, for the same
> reason [AF](#af--ordering-a-list-sort-is-a-question-drag-is-a-decision) does:
> the component tests have no `MediaRecorder` and no layout engine.

## AI · A selector dependency follows the business question, not the field order

The platform's dynamic-dropdown rule says a choice updates what the other
selectors offer. It does **not** say which way the arrow points, and assuming
*later filters earlier* — or the reverse — gets it wrong half the time.

**The domain decides the direction.** For enrolment the question is:

    WHO am I enrolling?  →  WHERE may she be enrolled?  →  HOW is that subdivided?

so the arrows are:

| Selector | Depends on | Why |
|---|---|---|
| **المستفيدة** | *nothing* | The form's subject. She is a beneficiary whatever else is chosen |
| **المستوى** | the beneficiary | R27 asks whether **she** may enter a restricted Level; BR-21 excludes only the one she already holds |
| **الفرع** | the Level | Where that Level actually meets |
| **مجموعة المستوى** | Level **and** Branch | §4.4c — a group is a roster at a premises. Optional: direct Level enrolment is valid |
| **حلقات المواد** | Level **and** Subject | And **independent of the Administrative Group** — a student may sit in مجموعة 1 and in two circles that share none of its members |

**This was got wrong once, in the obvious direction.** Filtering the beneficiary
list by a chosen Level looked like the dependent-selector rule being applied, and
it was the rule being applied backwards: a woman already enrolled in one Level is
still a beneficiary, and removing her from the picker because she is not in the
Level currently selected answers a question nobody asked. The fix was to reverse
the arrow, not to remove the dependency.

**The test to apply before wiring any pair:** say the two fields aloud as a
question. *"Which Levels may صفاء enter?"* has an answer. *"Which people does
وميض الأمل permit?"* is a different question, and it is not the one the form is
asking.

**Both directions still narrow server-side** (§4.4, rule O): the client sends the
parent and receives the permitted set, so a rule can never drift between the two
— and, in this case, `sex` never leaves the service at all.

## I · Empty states

Use the shared states. **Never hand-code an empty state or its button** — the
reset control on a filtered-empty table is `NoResultsState`'s shared `Button`,
and writing `<button className="btn btn--secondary">إزالة التصفية</button>` on
one screen is how the platform's most-seen surface starts looking like a
different product.

**Say which emptiness it is.** *Nothing exists yet* · *nothing matches the
filter* · *the question does not apply* are three different statements. `split:
false` on `حلقات المواد` is the third: a Subject with no circles is taught to the
whole Level, so *"everyone is placed"* would be a different and falsely
reassuring claim.

## J · Navigation simplicity

**A page reachable from the menu gains no second access path** without a strong,
stated reason. Redundant breadcrumbs and cross-links are the platform's most
frequent clutter, and they imply hierarchies §14.1 does not define — the removed
`الجدولة › {exam}` trail on `نقاط الامتحانات` named a *sibling* node as a parent.

Breadcrumbs are for **genuine hierarchy**, never for duplicate navigation.

**Distinguish two things that look alike:**

* A **duplicate path** — a link to a sibling menu node. Remove it.
* A **cross-hierarchy hand-off** — a read-only block naming the screen that
  *does* own the data it is showing. Keep it: `حلقات المواد` shows a Level's
  groups without being able to edit them, and pointing at `مجموعات المستويات` is
  how R69.5's one-responsibility-per-screen rule stays usable.

## K · Business-concept separation

**Never visually merge concepts the domain model keeps separate.**

`Administrative Group ≠ Teaching Circle` (§4.4c, §20 rule 22). A مستفيدة may sit
in Administrative Group 1, Quran Circle 2 and Tajweed Circle 1 at once, and none
of the three implies another.

**A workflow may orchestrate several placements; it must not imply a
relationship.** The enrolment form offers circles *and* a group — and keys the
circle list on the **Level alone**, because a circle is `(Subject, Level)` and
reloading it when the group changed would assert a dependency the model does not
have.

**Orchestration means calling existing endpoints in order**, each enforcing its
own rules. It never means a new endpoint that does both, and it never means a new
join table.

## L · Enrolment

```
Enrollment          = Student → Level → Branch        (the primary fact, R66)
AdministrativeGroup = an OPTIONAL subdivision of the Level
TeachingGroup       = an INDEPENDENT placement under (Subject, Level)
```

A Level need not have a group; a Subject need not have a circle. **A group-less
enrolment is a placement, not a gap** — and it must be able to hold a circle seat,
which is the [R66 NULL-relation bug class](../SRS-PROPOSAL-R66.md) guarded by
`group-less-enrollment.test.ts`.

**«إنهاء التسجيل» is a soft delete into Trash (R59)**, releasing that enrolment's
circle seats and retaining grades, Quran logs and the audit trail. It is **never**
a hard delete. The UI must distinguish it from *changing a placement*, and state
what is kept — a reader deciding on an irreversible-sounding action deserves to
know it is recoverable, and from where.

### The identity of an enrolment is not editable

`Student → Level → Branch` **is** the enrolment. Editing the Level or the Branch
does not move a student — it silently rewrites which fact the row records, and
every grade, circle seat and exam scope hanging off it now belongs to a placement
that never happened. So «تعديل التسجيل» edits the **optional** parts only: the
administrative group and the teaching circles.

Moving a student is therefore two acts, and the confirmation says so: **إنهاء
التسجيل**, then **تسجيل مستفيدة** in the new Level or Branch. That is not a
workaround for a missing field; it is the only sequence that leaves an honest
history, because it records that one placement ended and another began.

**The contract refuses it, not the form** — see [AF](#af--an-identity-field-is-refused-by-the-server-not-hidden-by-the-form).

The confirmation answers three questions, not one: what ends · what is kept
(**the beneficiary herself, and her enrolments in other Levels**) · and what may
be done next. The third is what makes the dialog a step in a route rather than a
dead end, and it was the one missing when the edit form stopped offering Level.

## M · User-facing text

**No engineering reference ever reaches a user-facing surface**: no `§4.4c`, no
`TD-12`, no `BR-7`, no `R66`, no *«بعد المراجعة 66»*, no commit hash, no internal
route name. A reader of that screen cannot look any of it up.

Where a revision's *meaning* matters, state the meaning:
*«اتركيها فارغة لتسجيلها في المستوى مباشرة»*, not *«…صحيح بعد المراجعة 66»*.

**Comments citing the SRS are correct and load-bearing** — they are how a
maintainer finds the rule. The guard scans string *values* only.

## N · Published data, and verdicts

**A student sees published results, never drafts.** `status: 'published'` belongs
in the server's **`where`**, not in a filter applied to a fetched list: the
difference between *not selected* and *selected then dropped* is the difference
between a rule and a habit.

**Do not label a person with a verdict.** A mark is a fact; «راسبة» is a judgement
about a مستفيدة, and the platform states the fact. The staff sheet reports the
mark, the absence and the publication state — and **no pass/fail badge**.

**This removes no business logic.** `Grade.passed`, `manual_pass_fail_override`
and BR-12's *a manual override always wins* remain in the model and still decide
retakes, progression and re-enrolment. What changed is one presentation. Removing
a rule because its label was removed would be removing something nobody decided
to change.

**A manual override is still surfaced**, because it is *provenance* rather than a
verdict: it says a human decided this row, which a reader of the sheet needs.

## O · Scope and authorization

**A component never decides authorization.**

* The **caller** passes the dataset it is permitted to offer.
* The **component** renders and filters what it was handed.
* The **server** is the authority, on every request.

A shared selector must be adoptable by any screen **without any possibility of
widening what that screen shows** — which is why `LevelSelect`,
`SearchableSelect` and `MultiSelectField` all filter nothing and fetch nothing.
§4.4's rule: *the client never filters a list it was handed*.

**Hiding is not enforcement** (TD-2). Affordances follow the **active** role (R60)
so a reader is not offered a control the server will refuse — and the server
refuses it regardless. A refusal is *rendered*, never pre-empted.

**Never widen a permission to make a UI work.** When a مؤطرة's menu named the same
concepts differently from the back office, the fix was **the words** — her paths
and her §4.4c scope were already correct. Pointing her at `/admin/content` would
have been an authorization change dressed as a rename.

## P · No duplicated engines

If a business operation exists in a service, resolver or policy, **expose it**.
Never write a second implementation, and never recompute a derived value on the
client.

The recurring shape on this project is the opposite problem — **a complete
capability with no route or node wide enough to reach it.** Six instances so far:
`مواد المستوى` (R69), grade entry (R70.1), Teacher events (R72), enrolment (R74),
the flat circles read, and the student's published grades. **When a screen seems
impossible, check whether the service already does it and only the reach is
missing.**

Corollaries: no client-side basis-point rounding (R8 — one rounding, on the write
path); no interim average formula (§10.1, R12 — *"an interim formula is a second
grading engine that would have to be ripped out"*); no coverage recomputation
(§4.5's engine, R10).

## Q · Page responsibility

**One page owns one coherent data domain.** Do not spread CRUD for one entity
across screens: R69 spent a revision removing Subject actions that unrelated
screens had grown because `مواد المستوى` had no node of its own.

Showing another domain's data **read-only, for context** is right and is not
ownership — see the hand-off rule in **J**.

## R · Consistency over local optimisation

When a local improvement conflicts with platform-wide consistency, **take the
shared solution**. A cleverer control on one screen is a control a reader has to
learn twice.

If the shared component genuinely cannot serve the case, **improve the shared
component** — `ConfirmDialog` gained one optional `details` slot rather than one
screen growing its own confirmation, because the alternative was *«are you
sure»* being asked differently on the screen where it mattered most.

## S · Future change propagates

**A change to an atomic component must reach every usage automatically.** That is
the whole return on **C**, and it is why the guards assert the **absence of a
second implementation** rather than the presence of the shared one: presence is
satisfied by a screen that uses the shared component *and* keeps hand-rolled UI
beside it — which one page did here, for a whole revision.

## AA · An occurrence's materials belong to the Session, and the content is the source of truth

```
Session (a materialised class occurrence)
  └── SessionContent  ──<  EducationalContent      0..N, many-to-many
Event (activity)
  └── (no content relationship — R43 retired it deliberately)
```

**Content is referenced, never owned** (§4.9, R43). One semester PDF is
referenced by every session that uses it; unlinking a session **never deletes the
file**, and a recording made in one session is an ordinary library item that
happens to have been produced there.

**Never copy content into an occurrence.** R43 retired
`EducationalContent.event_id` precisely because it *"expressed one relationship,
in one direction, to the wrong entity"* — and a per-occurrence copy would be that
mistake with duplication added.

**An Event has no content relationship at all.** Offering one on an activity is a
door to a room that does not exist; the *kind* decides what a calendar occurrence
may show.

**Surface it by linking to the page that owns it**, not by widening the calendar
read: `GET /calendar` returns a month's chrome, and shipping every occurrence's
materials would make every reader pay for data almost none of them opens. Rule P
applied to reads — expose what exists, never render it twice.

**The relationship is navigable both ways, from one join.** `GET /library/{id}/sessions`
reads `SessionContent` backwards so a library item can name the classes that use
it — §4.9's sentence has two halves and both are now surfaces. **No second
relationship, no denormalised column**: it projects rows that already exist.

**Two visibility rules, and conflating them leaks or hides.** The **content**
gates through `visibleContentIds` (§4.9's tiers) — an item the caller may not see
answers `404`, never an empty list, which would confirm the id exists (§20
rule 17). The **sessions** do not gate: they are the public timetable R43 made
browsable, returned through the very projection `GET /calendar` uses, so the read
exposes nothing a caller could not get by opening the calendar.

Canonical: `SessionContent` · `POST /sessions/{id}/content` ·
`GET /library/{id}/sessions` ·
[`SessionMaterialsDialog`](../../frontend/src/components/content/session-materials-dialog.tsx)
(link existing · upload-and-link · unlink) · `/calendar/sessions/{id}` ·
`OccurrenceMaterials` in the calendar's details dialog.

## AB · A deep link must be consumed by the page it points at

A parameter nothing reads is worse than no link: it navigates, it looks
deliberate, and it silently does nothing. `/resources?content_id=` shipped for
months — the library routes on `?level=`, so the link landed on the Category
index with the item neither opened nor on the page.

**Carry every half the destination needs.** `?level=` says *which shelf*,
`?content=` says *which item on it* — and the ref already carried `level_id`, so
nothing had to be looked up.

**And it stays focus, never a gate** (rule A): the destination renders in full
whether or not the parameter is present, and an id matching nothing opens nothing
rather than emptying the page.

**Guard the pair.** `session.test.tsx` asserts both the link the source emits and
the parameter the destination reads — either alone can drift.

## AC · One order for row actions

```
contextual action(s)  →  تعديل  →  destructive
```

**Enforced by `DataTable`, not by each page's declaration order** — because
declaration order is exactly what drifted: `المستخدمون` read
*تعديل · الأدوار · إيقاف الحساب* while its neighbours read something else, and a
reader who has learnt where *delete* sits on one screen had learnt nothing about
the next.

Classification needs nothing new from callers: **destructive** is the `danger`
flag they already set, **edit** is the platform's single shared `common.edit`
label, and everything else is contextual in the order the page chose. The sort is
**stable**, so a page with several contextual actions keeps their relative sense —
the rule is only about where the two universal ones go.

Ordering happens **before** per-row availability, so a row that hides its
contextual action still reads تعديل → destructive rather than reshuffling.

Canonical: `orderActions` in
[`ui/data-table.tsx`](../../frontend/src/components/ui/data-table.tsx).

## AD · A picker with an action is a picker, then an action

`SearchableSelect` (or the field), **then** the action in `form__actions`. Never
a `.form__row` holding a field and a bare button: that grid is for **two fields**
and aligns its items to the top, so the button lines up with the field's *label*
rather than its control — which is what made `إرفاق` in `مواد الحصة` look wrong.

The alignment comes from **the shape being right**, not from a new class. It is
the same arrangement `مستفيدات المجموعة`, the circle roster and the enrolment
dialog use, and browser measurement confirms the button then matches its
neighbours exactly — same height, same radius, same type size.

## AE · A dependency between selectors belongs to forms, not to filters

`subjectId → levelId` exists so a **form** cannot offer a pair the server refuses
(`SUBJECT_NOT_AT_LEVEL`, §4.4b). A **filter** asks a different question —
*"everything about تفسير"* is legitimate with no Level in mind — and
`GET /library` has always taken the two as **independent optionals**, so the gate
was a client-side invention rather than a contract.

**Check the contract before adding a gate.** `مكتبة المحتوى` disabled its Subject
filter behind *«اختاري المستوى أولًا»* and asked a question nothing required.

**Widening is not retracting.** Clearing the Level in a filter **keeps** the
Subject — the reader removed one constraint, not the other. Moving to *another*
Level still clears it, because that Level may not teach it.

**The mechanism is `mode`, not a per-field flag** (2026-08-18). It began as a
`subjectsUnscoped` boolean and that was the wrong shape: **opt-in, per caller**,
so `مكتبة المحتوى` received it and `الجدولة` did not — the Subject control
rendered enabled and empty, reading «لا مواد مسندة إلى هذا المستوى» with no Level
chosen. One screen right, the next wrong, which is the drift `useScopeOptions`
exists to prevent.

`mode` is a fact the caller **already knows and already passes to
`ScopeSelectors`**, so saying it to the hook is stating one thing once. It
defaults to `form` — the strict direction, so a caller that forgets gets the
behaviour that cannot produce a refused pair. **A guard asserts the two agree**:
any page rendering `ScopeSelectors` with `mode="filter"` must construct its scope
with `mode: 'filter'`.

Canonical: `useScopeOptions({ mode })` + `ScopeSelectors`' `mode`, guarded by
[`use-scope-options.test.ts`](../../frontend/src/hooks/use-scope-options.test.ts).

### The dependent-selector contract

Every dependency in the graph answers the same seven questions, and
`useScopeOptions` answers them **once** so no page re-derives them:

| | |
|---|---|
| **Parent selected** | children reload from the parent's own read |
| **Parent changed** | children clear **eagerly**, in `set`, so no render shows a stale child under a new parent |
| **Parent cleared** | children clear — **except** a filter's Subject, because widening a question is not retracting half of it |
| **Child no longer offered** | cleared by reconciliation; a stale id is what reaches the server as an impossible pair |
| **Loading** | the field is `busy` — disabled and announced, never silently empty |
| **Empty** | its own sentence (*this Level teaches no subjects*), never a bare empty dropdown |
| **Unmet dependency** | names the missing parent (*choose a level first*) — in a **form**; a filter has none |

**Never add a dependency a contract does not have.** `GET /library` and the
scheduling list both take `level_id` and `subject_id` as independent optionals;
the gate was a client-side invention on both screens.

## T · The page header is one block

**Title, description and primary action form a header** — not two things at
opposite ends of a rule.

The description **grows into the width it has**, up to a reading measure
(`--measure-lede`); the action block is **exactly as wide as its buttons**. The
defect this fixes is subtle and was reported three times before it was
understood: `justify-content: space-between` pushed the action to the far margin
and left the text at its flex basis, so a one-line description wrapped its **last
word** onto a line of its own with visible space beside it.

**The primary action does not move when the description grows.** The header is a
**two-column grid** — the heading takes the free space, the action takes its own
width — with `align-self: start` pinning the action to the top of its cell. Its
offset from the top of the header is then a constant: it cannot depend on the
height of a sibling column.

**It must not be a flex row, and this is the trap that cost two attempts.** The
first fix set `align-items: start` on a flex row and looked right. But
`.admin__head` also had `flex-wrap: wrap`: once the heading grows past the space
beside it, the action **wraps onto its own line** — and a line below the heading
sits below the *whole* heading, description included. Measured in Chrome at
1440 px, the button moved **94 px → 475 px** between a one-line description and an
eleven-line one. `align-items` never applied, because the two were never on one
line to be aligned.

**A declaration being present is not the property holding.** The guard asserted
the correct declaration and passed while the layout was broken. That is why this
invariant is **measured in a real browser** —
`scripts/dev/browser/measure-page-header.sh`, nine widths, both a one-line and a
wrapping description — and the source guard only checks that the *structure*
survives.

Also still required: `min-inline-size: 0` on the heading, because a grid item's
default `min-width: auto` refuses to shrink below its longest word — which is what
made a one-line description wrap its last word with room to spare.

**Below 44rem the header is one column** and the action sits under the text,
because there is no room beside it. The measurement asserts that separately
rather than applying the wide rule everywhere.

Canonical: `.admin__head` / `.admin__heading` / `.admin__actions` in
[`admin.css`](../../frontend/src/styles/components/admin.css), rendered by
[`PortalShell`](../../frontend/src/components/portal/portal-shell.tsx). **Never
solve this per page**, and never with `<br>`. Guarded by
`scripts/ci/check-shared-layout.sh`, which also refuses a page stylesheet that
redefines the header.

## U · Unsaved work is never lost to a stray click

A form dialog **holding changes** does not close on a backdrop click, asks before
closing on `Escape` or the close button, and closes silently when nothing has
been typed.

| Way out | With changes | Without |
|---|---|---|
| Backdrop | ignored | closes |
| `Escape` · Close · إلغاء | asks | closes |
| Successful save | closes | — |

**Why the backdrop is ignored rather than asking:** a backdrop click is very
often not an intention, and answering every one with a question trains a reader
to dismiss questions. `Escape` and the close button *are* intentions.

**The dialog is never inescapable** — the close button always leads out in at
most two clicks.

Canonical: `dismissible` on
[`Dialog`](../../frontend/src/components/ui/dialog.tsx) is the *mechanism*;
[`FormDialog`](../../frontend/src/components/ui/form-dialog.tsx) makes the
*decision* from its `dirty` prop and asks with the shared `ConfirmDialog`. Each
form reports `dirty` through
[`isDirty`](../../frontend/src/lib/form-dirty.ts) — **which takes both sides**,
because these dialogs write their fields in an effect *after* first render, so a
captured baseline reports *dirty* the instant an edit dialog is populated.

**`dirty` defaults to `false`**, so a form that omits it silently keeps the old
lose-everything behaviour. That is why it is guarded rather than left to
convention.

## V · A row action looks like an action

Table row actions are **bordered buttons**, sized for a row — not borderless
text in a cell full of text. Destructive ones carry the shared `danger` variant,
so *irreversible* looks the same everywhere.

The defect: `DataTable` rendered them as `ghost`, which has no border and no
background at rest, so «تعديل» and «حذف» were indistinguishable from data until
the pointer crossed them.

Canonical: the `actions` configuration of
[`DataTable`](../../frontend/src/components/ui/data-table.tsx), rendering the
shared `Button` with `.row-action` for sizing only. The focus ring is the
platform's global `:focus-visible` and needs nothing per component. **Never style
a row action per page.**

## W · The sidebar and the page scroll independently

A sidebar taller than the viewport **scrolls itself**, and reaching its end does
**not** hand off to the page underneath.

Three CSS declarations, no JavaScript: a `max-block-size` of the viewport minus
the header, `overflow-y: auto`, and — the one that removes the surprise —
`overscroll-behavior: contain`. A wheel handler would re-derive what the browser
already knows and break keyboard and momentum scrolling on the way.

Canonical: `.admin-nav` in
[`admin.css`](../../frontend/src/styles/components/admin.css), **inside the
two-column media query**: below that breakpoint the sidebar is a normal block in
the flow and must not become a small scrolling box mid-page.

### And it keeps its place across a navigation

Every portal navigation is a **full document load** — there is no client router,
and introducing one to fix a scroll position would be the wrong size of answer.
So the sidebar starts each page at `scrollTop: 0`, and a menu long enough to
scroll then hides the very entry that was just clicked.

Two facts must hold together afterwards, and they are **not** the same fact:

1. **the position is preserved**, so nothing appears to jump; and
2. **the active entry is visible**, because *where am I* must be answerable.

(1) is restored first and (2) corrects it **only when it must**, by the smallest
movement that brings the entry inside the box. Centring the entry on every load
satisfies (2) while destroying (1) — the menu would lurch on every navigation,
which is the complaint and not the fix.

**The page never moves.** `scrollIntoView` scrolls every scrollable ancestor, so
revealing a menu entry would also scroll the article beside it; writing
`scrollTop` on the container moves that container and nothing else.

Canonical: [`lib/nav-scroll.ts`](../../frontend/src/lib/nav-scroll.ts), applied
once in `PortalShell` — a behaviour each portal had to opt into is a behaviour
that would be missing from the next one ([AE](#ae--a-dependency-between-selectors-belongs-to-forms-not-to-filters)).

**Trap, measured in Chrome 2026-08-18:** the first version positioned the entry
with `offsetTop`, which is measured against the nearest **positioned** ancestor —
and the sidebar is `position: sticky`, so the offset was already relative to the
nav and subtracting the nav's own removed a distance that was never in it. The
menu landed at `scrollTop: 70` with the active entry still out of sight, and no
stylesheet could have shown it. Two `getBoundingClientRect()` calls have no such
dependency.

## X · A missing translation key must fail a test, not ship

`t()` returns **its own argument** when a key is missing. That is deliberate — a
raw key is loud where a blank string is silent — but it means **a typo ships as
user-facing text and nothing fails**.

`نقاط الامتحانات` rendered a table headed `admin.schedules.title`,
`admin.exams.date`, `admin.exams.audience`; the same three keys had been wrong on
`/teacher/exams` first, so it **propagated by being copied** — the shape a missing
guard always produces.

Canonical: [`i18n/resolves.test.ts`](../../frontend/src/i18n/resolves.test.ts)
resolves every **literal** `t()` and `tList()` key in the application against the
catalogue. Computed keys (`` t(`admin.section.${x}`) ``) are out of its reach and
belong to the registry guard that enumerates their values — that limit is stated
in the guard rather than left to be discovered.

## Y · Show the dependency that refuses the action

Where a rule refuses an action because of a relationship, **show the
relationship** — and show it as the *things*, not as a count.

`المواد` lists each Subject's linked Levels because a paired Subject cannot be
deleted: a number tells an administrator they are blocked; the names tell them
what to unpair, and where. (`الفئات` keeps a count, correctly — *how many Levels*
is the whole question there.)

**Showing a constraint never relaxes it.** The refusal, its authorization and its
error stay exactly where they were.

## Z · Configuration the SRS already calls editable must be reachable

`SystemSetting` is described in §7 as **runtime-editable**, and the grading scale
has lived there since R14 — seeded by §15.1 and reachable by **nothing in the
product**, exactly as `legal.consent_text_version` was before R42.

**Before adding a field for a missing control, check whether the value already
exists somewhere unreachable.** The recurring shape in **P** has a settings twin:
a value the specification already places, with no surface to change it.

**And check whether the SRS has already refused the shape being asked for** —
*and then check whether that refusal still stands.* This paragraph used to end
here, citing R58's rejection of a *per-exam* maximum mark — *"a second answer to
what `grading.display_scale` already owns"* — as proof that *"is this exam out of
10 or 20"* was platform-wide **by decision, not by omission**. That was true when
it was written and is **false now**: R81 retired the global scale, and with it the
only thing the per-exam maximum could have been a second answer to.

The lesson survives the example, and is worth more than it was. A recorded
refusal is a **reason**, not a verdict: read what it depended on, because a
decision resting on something the Owner has since removed is not a decision any
more. Cite the clause, check its premise, and say which you found.


---

## AF · An identity field is refused by the server, not hidden by the form

When a field defines **what a row is**, removing its control is half a fix. The
route still accepts it, so a forged request — a replayed payload, a stale tab, a
script — still rewrites the identity, and the screen that no longer offers it is
the reason nobody looks there when the data goes wrong.

**Remove it from the schema, not only from the form.** The controller's body
schema is `.strict()`, so an absent key is not merely ignored: the request is
**refused** with `VALIDATION_FAILED`, and a caller learns its assumption is wrong
instead of watching a silent no-op. The service's patch type narrows to match, so
the old branch cannot be reached even from inside.

**Then prove the refusal with a forged request** — the UI test proves the control
is gone, which is exactly what a forged request does not care about. See
`enrollment.http.integration.test.ts`: it sends `level_id` and `branch_id`, and
asserts both that the call is refused **and that the stored row is unchanged**.

And the screen still **shows** the value, as text, with one line saying why it is
not editable here and which route does change it. A field that vanishes without
explanation reads as a missing feature.

## AG · One scrolling region per overlay

A dialog scrolls in **exactly one place**: its body. The header stays, the footer
stays reachable, and the content between them moves.

Two nested scrollers produce two scrollbars side by side — and the outer one,
overflowing by a couple of pixels, scrolls nothing anyone wants while stealing
the wheel. **Hiding a scrollbar in CSS does not fix this**; the ownership has to
be correct, or the same overlay is still two boxes fighting for one gesture.

The shape is: the `<dialog>` is a flex column with `overflow: hidden` and a
`max-block-size`; every flex child that must shrink carries **`min-height: 0`**
— the part that is easy to miss, because without it a flex item refuses to
shrink below its content and pushes the overflow back out to the shell; and only
`.dialog__body` has `overflow-y: auto`, with `overscroll-behavior: contain`.

Canonical: [`dialog.css`](../../frontend/src/styles/components/dialog.css).
Bounded option lists inside a form (`select__options`) are **deliberate** nested
scrollers and are not this defect — the rule is about the dialog's own shell.

### And a closed dialog must consume no layout

**The regression this rule caused, one day later, is part of the rule.**

A native `<dialog>` is hidden by exactly one line in the user-agent stylesheet:
`dialog:not([open]) { display: none }`. Author styles beat the UA stylesheet at
every specificity, so the `display: flex` above — added to fix the scrolling —
did not merely add a layout, it **removed the only thing hiding closed dialogs**.
Every management screen keeps its add/edit dialog mounted, because a native
dialog must be in the DOM to be openable, so all of them rendered permanently in
normal flow underneath the table. The calendar's day dialog is `--wide`, which is
why a `dialog dialog--wide` block appeared at the top of the public calendar.

The pages that survived were the ones that mount their dialog **conditionally** —
which is why the Owner's affected/unaffected lists split exactly along that line,
and why both sets belong in the regression sweep: the second is the control that
tells a real fix from a coincidence.

So: **every `display` on `.dialog` is scoped to `[open]`**, and the hiding is
stated explicitly in the author sheet rather than borrowed from the UA — the next
person to add a `display` here sees the rule they would have to beat.
Guarded twice, deliberately: `check-dialog-hidden-when-closed.sh` refuses the
construct in CI where no browser runs, and `verify-dialog-states.mjs` measures
the rendered geometry, which is the property.

**Measured, never asserted from CSS.** The defect that produced this rule was the
`<dialog>` overflowing by **2px** while its body overflowed by ~300; no
stylesheet reading finds that. `verify-ux-slice.mjs` filters the elements that
genuinely scroll (`overflowY` is `auto`/`scroll` **and** `scrollHeight -
clientHeight > 1`) at desktop and at 390px.

## AH · A message belongs where the action is

Four kinds of message exist, they answer different questions, and they belong in
different places:

| kind | question | where |
|---|---|---|
| **action** | *did the thing I just clicked work* | beside the controls that did it — `Feedback` |
| **field** | *what is wrong with THIS value* | under the input — `Field`'s `error` |
| **page** | *why is there nothing here* | in place of the content — `ErrorState` |
| **form** | *why will this form not submit* | above the form's own buttons — `FormDialog`'s `notice` |

The first kind was hand-written **25 times across 20 files**, every copy a
`<p className="admin-notice" role="status" aria-live="polite">`. They had already
drifted: some carried `aria-live` and some did not, so on those screens a screen
reader was never told the action had succeeded — the defect [C](#c--one-concept--one-atomic-component)
predicts, and nothing had said so.

Canonical: [`ui/feedback.tsx`](../../frontend/src/components/ui/feedback.tsx).
Being in the right place is not enough — **it has to be seen**: a refusal
rendered above a long table, while the reader is at the bottom of it, is a
refusal nobody reads and a click that looks ignored. The component brings itself
into view on change, by the least scroll that works (`block: 'nearest'`), and
does nothing when it is already visible.

A `<div>` reusing the *style* for standing content is not an action message and
does not use the component — it would inherit a `role="status"` that is wrong for
it. Those exceptions are named in the guard's allowlist, with reasons.

## AI · Controls are grouped, not scattered

Related controls form **one segmented group** with a border, shared dividers and
borderless parts — not a row of independent buttons. The group is the bordered
thing; the parts are inside it, which is what makes them read as one control with
sections rather than as several calls to action.

**One emphasis per group, at most.** The calendar rendered five buttons at
`min-width: 7.5rem`, two of them `primary`, and they dominated the page they
existed to navigate. Now: `[ قائمة | تقويم ]` and `[ السابق | اليوم | التالي ]`,
every part `ghost`, the **selected view** filled because *which view am I in*
must be answerable at a glance, and «اليوم» carrying the accent on its label only
— it is the one that returns you to a known place.

Canonical: `.cal-segmented` in
[`calendar.css`](../../frontend/src/styles/components/calendar.css), used by
`CalendarNav` and `ViewSwitch`, and therefore by the public, admin, teacher and
student calendars alike. `border-inline-start` on every child but the first puts
the dividers on the correct side in RTL with no second rule; the focus ring uses
`outline-offset: -2px` so the group's `overflow: hidden` cannot clip it.

**Verified as rendered boxes**, because size is the complaint and CSS cannot
answer it: the widest control measures **73px** where the minimum used to be
120px, each group occupies one row at 1440px and at 390px, and the ring stays
inside the clipping group.

### AJ · One calendar header, and the title is centred on it

The atoms were shared and the **arrangement** was not — which is where the two
calendar surfaces had already diverged, with nothing duplicated for a duplication
guard to catch. The public page put the title above a controls row; the back
office put it beside the stepping inside `.cal-toolbar`, the *filters* container,
with its view switch elsewhere on the page.

    ┌──────────────────────────────────────────────────────────┐
    │ [قائمة | تقويم]     صفر 1448 │ أغسطس 2026     [السابق | اليوم | التالي] │
    ├──────────────────────────────────────────────────────────┤
    │ filters (optional)                                        │
    ├──────────────────────────────────────────────────────────┤
    │ calendar / list                                           │
    └──────────────────────────────────────────────────────────┘

Canonical: [`calendar-header.tsx`](../../frontend/src/components/calendar/calendar-header.tsx).
Source order **is** the RTL visual order, so no `direction` or `order` rule
appears anywhere in the block.

**The title is centred on the header, not in the space left over.** The row is a
`1fr auto 1fr` grid: both side columns take the same width whatever they contain,
so the middle sits on the header's centre line. A flex row with
`space-between` — the obvious alternative — centres the title only when the two
control groups happen to measure the same, and they never do: three controls
against two, and the stepping disappears entirely in the list view. Measured at
1440px, the drift is **0px** on both surfaces with side groups of 135px and
207px; asserting `text-align: center` would have proved nothing, because a
centred line inside an off-centre box is still off centre.

**Shape follows the data, not a flag.** A surface with no month passes none, and
the centre and the stepping are omitted together — the back office's list is a
table of recurring schedules, and naming a month above it would assert a scope it
does not have. A `showTitle` boolean would have been the opt-in that goes missing
on the next surface ([AE](#ae--a-dependency-between-selectors-belongs-to-forms-not-to-filters)).

**No date arithmetic moved.** The month names still come from the backend's
bootstrap through `CalendarTitle` (§20 rule 14; R31, R36); the header decides
position and nothing else.

## AP · Three portals, one frame — and a registry is what makes a screen exist

The back office, the teaching portal and the beneficiary's portal render the
**same** `PortalShell`: header, sidebar, titled main region, §14.4's
no-permission state, and R83's scroll restoration. What differs is the **list of
modules**, which is why only the list is passed.

**A capability with no registry entry does not exist to its user.** `/teacher/quran`
had a page and a router case since M4 and no menu entry, so «إدخال الحفظ» was
complete and unreachable — rule **P** for the eighth time. The beneficiary had no
sidebar at all: her calendar, library, memorisation, grades and account were
reachable by typing a URL. Adding the entries added no capability.

**Landing pages stay minimal by decision, not by omission.** مساحة التدريس and
لوحة المستفيدة render a sentence and their menu until they are designed: cards
invented before the questions they answer are settled become the thing the
design has to work around. «حصص اليوم والقادمة» was **removed** rather than
restyled — those occurrences are in تقويمي, and showing them twice makes one of
the two the wrong place to look.

**Notifications live in the top bar, not on one page.** The list was mounted on a
single dashboard, so a مؤطرة marking grades had no way to learn a class had moved
without navigating home first — a notice nobody encounters was not delivered. The
bell is **one component** rendering the **same** `NotificationList`; the panel is
a container, not a second implementation. The badge shows the server's unread
count rather than one the client derives, because a count a client computes
disagrees with the server the moment the list paginates.

## AS · A staffing control must be able to say WHEN

An assignment that carries dates cannot be edited by a control that has one slot
per person. R91 gave `CourseScheduleStaff` an effective period, and the
association's own cases stopped fitting the old shape immediately:

| Case | Rows |
|---|---|
| ordinary | Safa, main, open → open |
| temporary replacement | Safa → 30 Nov · **Amina 1–30 Nov** · Safa 1 Dec → open |
| rest of semester | Safa → 15 Jan · Amina 16 Jan → open |

**Safa holds two rows in the first**, which a single «المؤطّرة» selector cannot
represent — and which the platform's `(schedule, user)` unique index could not
store, which is why R91 withdrew it. A class therefore composes
`StaffingPeriods`: one row per assignment, each with who · main or assistant ·
from · until.

**`StaffPicker` is unchanged and still correct for an exam sitting, a
celebration and a single occurrence.** They staff one dated thing, so a period
would be a field with one possible value. This is not two implementations of one
concept — it is two concepts, and the test that used to assert *the class
delegates to StaffPicker* was **restated with its reason**, not deleted.

**A blank date means open-ended, and the form says so.** «اتركيه فارغًا ليبدأ
الإسناد مع بداية الحصة» — a blank field that carries meaning must state it, or
the reader supplies her own. The empty string a date input produces is converted
to `null` **once, at the wire boundary**; letting either leak into the other half
is how a bound silently becomes 1970.

**A new row defaults to *assistant*.** At most one main مؤطِّرة may be active on
a date, so defaulting to the capped position would make the commonest next action
a refusal.

**The server's three interval refusals each get their own sentence.** «لا يمكن أن
تكون مؤطّرتان مسؤولتين في تواريخ متداخلة» tells an administrator which of three
date rules she broke; a generic «تعذّر الحفظ» leaves her to guess.

**The one-off cover belongs to the occurrence, not to the recurring form.**
«مؤطّرة هذه الحصة» on the occurrences screen, and the dialog says *this occurrence
only* rather than leaving her to infer it from what did not change.

## AT · A shared component nobody opens is not a shared surface

`EventDetailsDialog` was written once and used once. Three of the four calendars
— the back office's, the مؤطرة's and the beneficiary's — passed
`onOpenEvent={() => undefined}`, so clicking an occurrence **did nothing at
all**. Each of those readers could see a class on her calendar and had no way to
ask anything about it.

**This is harder to see than a fork.** A duplicated dialog shows up in a grep
and drifts visibly; a shared one that is never mounted looks perfectly healthy
in isolation, and every source-level check for *is the component shared* passes.
The tell is the **handler that discards its argument** — `() => undefined` where
a callback is expected is almost always a wire nobody finished.

**So the guard asserts the wiring, not the import**: every calendar renders
`<EventDetailsDialog>` *and* contains no `onOpenEvent={() => undefined}`. The
difference between the four surfaces is the caller's own token, which is what
decides the tier of the session content the dialog reads — not a second
component.

### Two questions get two answers

A class occurrence carries **التسجيلات** and **المواد المرفقة**, and they are
separate concepts. The combined «لا تسجيلات ولا مواد مرفقة بهذه الحصة» made a
reader looking for one parse a sentence about both — and a heading then repeated
one of them underneath. Each section now has its own heading and its own empty
state.

**And neither says anything until the read succeeded.** A 401, 403 or 500 must
never render as «لا توجد مواد»: empty is a valid answer only after a 200, which
is the same rule the notification panel follows.

### The extra page step is gone

«فتح صفحة الحصة وموادها» made answering *what was recorded for this class* cost
a navigation away from the calendar being read. The materials are in the popup;
the Session page keeps its other uses and is no longer the route to that answer.

## AU · A dependent form asks in the order the domain depends

`إدخال الحفظ` asks *whom* → *which Level* → *which Surah*, and the dependency is
real: `LevelSurah` decides which Surahs a Level teaches, so a Surah list means
nothing until a Level is known. Rule **AE** says a dependency between selectors
belongs to **forms**, not filters — this is the form half of that rule, and the
same `mode` caution applies: the caller states a fact, the component derives the
behaviour.

**One relevant option opens directly; several ask.** A مستفيدة enrolled in two
Levels must be asked which curriculum an entry belongs to — picking
`level_ids[0]` chooses a syllabus by insertion order, which is a silent wrong
answer rather than a visible question. One Level is not a choice and must not be
rendered as one.

**The narrowing is convenience; the server is the authority.** Removing an
option from a `<select>` leaves the route accepting it, so both refusals are
coded server-side (`LEVEL_NOT_ENROLLED`, `SURAH_NOT_IN_LEVEL`) and proved with a
forged request — rule **AF**'s test, applied to a curriculum rather than to
identity.

**And a reference list is not a curriculum.** The old form offered all 114
Surahs from `Array.from({ length: 114 })`. The seeded lookup is the source for
*names*; `LevelSurah` is the source for *which of them this Level teaches*, and
conflating the two offered a مؤطِّرة 114 options where the syllabus named two.

## AV · One meter for every proportion, and the figure is never the colour alone

`ProgressBar` is generic by construction — a value, a total, a label, and
nothing about Surahs or ayahs. A Quran-specific visual primitive would become
the second implementation the moment anything else showed a proportion, and
level completion and exam coverage are both already shaped like one.

* **The percentage is always text**, beside the strip. A coloured bar is
  invisible to a screen reader and ambiguous to a colour-blind reader, so the
  full ARIA contract — `role="progressbar"`, `aria-valuemin`, `aria-valuemax`,
  `aria-valuenow`, `aria-valuetext` — is part of the component, not an option.
* **RTL comes from the document.** The fill is sized with `inline-size` and sits
  at the track's inline start. `transform: scaleX()` was rejected because it
  would have to know which way *forward* is.
* **Zero is a value, not an absence.** A Surah at 0% renders an empty track,
  because *not started* is the answer for most of a syllabus and is different
  from *not in the curriculum*, which does not appear at all.

**Its CSS invariant is guarded in `scripts/ci/`, not in vitest** — `?raw` on a
`.css` file yields `''` under this setup, so the guard would have passed while
reading nothing. It was written as a vitest assertion first and caught only by
its own non-empty check, which is the tell CLAUDE.md names: **a guard that has
never failed.**

## AR · Planning data advises the chooser; it never narrows the choice

A screen that knows something about the people in a list may **annotate** them.
It may not shorten the list, disable an entry, or gate the submit — because the
one thing an administrator cannot override is an option that is not there.

**The R88 teaching profile is the case that established this.** It records what a
مؤطِّرة says she can teach and when she is free, so the staff picker can appraise
every candidate against the class being planned: *Subject not declared* ·
*Category not declared* · *not available then* · *already has a clashing class*.
All four are **warnings**, and R88.4 states why: the association resolves
exceptional cases outside the system — an unmaintained profile, an emergency
replacement, a temporary substitution, something the administrator knows and the
platform does not.

### The two questions, and which one may answer which

| Question | Answered by | May it decide? |
|---|---|---|
| *Would this person appear suitable for this planned class?* | the R88 teaching profile | **never** |
| *May this person operate as teacher or assistant for this class?* | the assignment — `CourseScheduleStaff` / `SessionStaff` (§4.4c) | **only this** |

**The former must not answer the latter, in either direction.** A مؤطِّرة with
four warnings holds full authority the moment she is assigned; one with a
flawless profile and no assignment holds none. Both halves are asserted, in the
API tests and in the browser, because a separation only stated in prose is one a
later refactor quietly closes.

### What this forbids in an interface

* **No filtering.** The picker's only `filter` is the lead's exclusion from her
  own assistant list, and that exists because the server refuses the pair as a
  duplicate — offering it would be offering a refusal.
* **No `disabled` driven by a warning.** `disabled` is the caller's
  authorization prop (R71.4) and nothing else may drive it: a disabled option is
  a refusal wearing a hint.
* **No copy that reads as a prohibition.** «لا يمكن», «ممنوع», «غير مسموح» are
  guarded against in the warning strings.

### *Not declared* is not *unavailable*

An empty profile means **not declared**, never *forbidden* (R88.9 read at the
point of use). Somebody who has declared no availability is not somebody who is
busy, so «لم تُسجَّل أوقاتها بعد» is a different string from «غير متاحة في هذا
الوقت» — and a profile empty in all three respects is said **once**, quietly,
rather than as three accusations. A recurrence the appraisal genuinely cannot
evaluate (`monthly`, `yearly` — a day of the month lands on a different weekday
almost every time) says so rather than guessing in either direction.

### Quiet by default

A candidate with nothing wrong renders **nothing**. Four indicators beside every
name would be four things to read past on the ordinary case, which is most
cases. The concern is visible twice and cheaply: a short marker on the option so
it is legible *before* the choice, and named chips under the control *after* it
— beside the control, never on submit (rule **AH**).

### Written once, on the shared control

The appraisal lives on `StaffPicker`, not on the section that first needed it.
Rule **AE**'s lesson applies exactly: *a behaviour each caller must opt into is a
behaviour that will be missing somewhere.* Adopting it also closed a rule **C**
violation that had stood since R71 — `ClassSection` hand-wrote a `SelectField`
and a `fieldset` of checkboxes while `StaffPicker`'s own docstring named *a
course schedule* as one of its three users. **The extraction had been written
down and only two thirds applied.**

## AQ · A screen's population is what decides which operations it may offer

A row action is an operation offered to **every row the screen lists**. So the
question a new action must answer is not *does this operation make sense for this
entity* but **does it make sense for everybody this screen shows** — and if it
does not, the action belongs on a screen whose population is the right one.

`الملف التدريسي` was added to `/admin/users` on the reasoning that a teaching
profile is "a fact about a person, and the person is where the administration
already goes". The premise was true and the conclusion was wrong: `المستخدمون`
administers **accounts**, and its population is every account — guardians,
minors, administrators, beneficiaries. All of them were offered a form asking
which Subjects they could teach.

**The correction is a screen, not a permission check.** Hiding the action for
some rows would have left the same screen answering two unrelated questions, and
`available` per row is for an action that *cannot apply to this row right now*
(a suspended account cannot be suspended), not for an action that belongs to a
different subject entirely.

### الشؤون التعليمية holds two populations, and they are not the same list

| Screen | Population | What it decides |
|---|---|---|
| `التسجيلات` — `/admin/enrollments` | the people being **taught** | which Level, in which branch, optionally which Group |
| `إدارة المؤطِّرات` — `/admin/teachers` | the people **doing the teaching** | what each can teach, for which Categories, and when she is free |
| `المستخدمون` — `/admin/users` | **every account** | identity, roles, branch scope, whether the account may sign in |

**Neither teaching list is derivable from the other.** R79 made *beneficiary* a
durable fact independent of every role precisely so a مؤطِّرة may also study, so
`beneficiaries_only=true` and `role=teacher` are **complements, not variants**:
the same woman appears in both. A screen that reached for `is_beneficiary` as an
exclusion would have hidden a real member of teaching staff — which is why the
teaching screen never asks the question at all, and asks the server for the live
`teacher` assignment instead.

**The population is asked of the server** (rule F): `role=teacher` is a filter
`/admin/users` already defines, so the page states who it wants rather than
fetching a page of accounts and filtering it — a client-side predicate over one
page is wrong the moment there is a second page.

**Narrowing by a fact only this screen holds is not the same defect.** The
Subject and Category filters here run over the teaching profiles the page has
already loaded, because the list endpoint carries no planning data and putting it
there would push a teaching concern onto a general-purpose account contract. The
line is: **the population comes from the server; a narrowing may come from data
the server did not carry.**

## AO · The calendar contract — one architecture, five surfaces

Every calendar in the platform composes the **same** chrome. What differs is
stated as data, not rebuilt per page.

| Surface | Data | Month-scoped | Filters | Row actions |
|---|---|---|---|---|
| `/admin/schedules?view=list` | **definitions** (schedules · activities · exams) | **no** | the admin set | **yes** — it is an operational screen |
| `/admin/schedules?view=calendar` | occurrences | yes | **the same admin set** | — |
| `/calendar` (both views) | public occurrences | yes | المستوى · النوع | no |
| `/dashboard/student` (both views) | **her own** occurrences | yes | المستوى · النوع · المادة · المجموعة · الحلقة | no |
| `/teacher` (both views) | **her own** occurrences | yes | الفرع · الفئة · المستوى · النوع · المادة · المجموعة · الحلقة | no |

**السنة الدراسية appears nowhere.** It narrowed definitions and meant nothing on
a month of occurrences, so it made one surface's two views behave differently —
the asymmetry this architecture exists to end. It remains a required field on the
create/edit **form**, which is a different thing.

### The filter section never depends on the view

This is the property the whole architecture is for. The back office rendered its
filters inside the **list's table toolbar**, so switching to تقويم made the
entire section disappear while its values quietly survived in the URL — a grid
that looked unfiltered and was not. The row is now built once per surface and
handed to both views.

**Month controls follow the DATA, not the view.** They were tied to
`view === 'calendar'`, which was right for the back office's list and wrong for
every other one: a public, beneficiary or مؤطرة **list** is *this month's
occurrences*, and stepping is how a reader moves through it. A surface that is
not month-scoped withholds the **month itself**, and `CalendarHeader` then omits
the title and the stepping together — one fact, no second flag.

### A filter narrows; it never gates

`REQUIRES` governs **forms**, where a dependency is real — a Level needs its
Category before it can be created. In `mode="filter"` **no field reads it**. The
correction had been applied to `subjectId` alone and forgotten on the next field,
which is how المستوى came to be disabled on the back office's list until a
Category was chosen — a precondition §4.4b never states. Changing a parent
**clears a stale child**; it disables nothing.

### Which filters exist is an authorization question

The caller names them (rule O). A beneficiary is offered no الفرع and no الفئة —
her calendar is already hers and either control would imply a scope she does not
have; a مؤطرة is offered both, because she works across them, with every option
restricted server-side so the dropdown never becomes a way to enumerate branches
she does not teach at.

### قائمة is a table everywhere

One `OccurrenceTable` with configurable columns, in the platform's `DataTable`
language. The three hand-rolled lists it replaced had none of its states — no
empty, no error, no retry. **No row actions** on the reading surfaces; the back
office keeps its own definitions table with its own actions, because it is a
different thing showing different rows.

### What the domain does not support, and is not faked

**الحلقة filters Session occurrences only.** A schedule may be addressed to a
Teaching Circle (§4.4c), and an **Event cannot be** — there is no
`EventTeachingGroup` join, and inventing one would be inventing a relationship
the SRS does not define (§20 rule 16). The filter therefore narrows classes and
leaves activities out, exactly as `subject_id` already did.

**An Event has no location of its own** — only `EventBranch` *scope* rows, which
say who it concerns rather than where it happens. So *خارج المقرات* cannot be
expressed today, and **no fake Branch was created for it**. Recorded as an open
Owner decision at the foot of this page rather than shoehorned into Branch.

**An event for every Level of a Category at a Branch needs no `EventLevel` rows
at all**: `EventBranch` + `EventCategory` with no Level rows already means
exactly that, and the audience resolution reads it that way (R82.7). The filter
shows such an event under any Level of that Category, which is what it concerns.

## AM · A calendar shows what is ON

A cancelled occurrence **leaves** the calendar — every calendar: public,
personal and back office (R83.1).

R77 decided the opposite, and the reasoning was good: *hiding it answers "is
there a class" while the reader is asking "what happened to my class"*. The
Owner's answer is better — that question is the **notification's** to answer,
which is what R77 built the notification for. A calendar that lists things which
are not happening makes the reader filter them out by eye, every time.

**The row is never deleted.** The occurrence stays materialized with its status,
its reason, its audit row and its notice; restoring it returns it to the
calendar; future occurrences of the same schedule are untouched and the schedule
stays active. A history screen asks with `?include_cancelled=true` — **an opt-in
nothing turns on by default**, which is what keeps *the ordinary calendar* and
*the administrative view* two different questions rather than one screen with a
convention.

The exclusion lives in the **read**, not in each screen: one `where` clause in
`calendar.service.ts` makes it true on every surface at once, where a per-screen
filter is a rule each new surface must remember.

## AN · Telling people is a decision, and it is asked after the fact

A change to an occurrence or an activity **commits alone**; a separate
authorization-checked request then asks whether to notify the people it concerns
(R82.5, R83.3). Declining creates nothing — it is the **absence** of a request,
never a request that sends zero.

R77.4 wrote the notices inside the changing transaction, fearing *a committed
cancellation nobody was told about*. Separating them answers that fear better
than the coupling did: the person is **asked, every time**, and a failure to
notify can no longer roll back a change that succeeded. Idempotency carries the
weight the transaction used to — `(user, target, type)` is unique, so pressing
send twice writes the same rows.

**The client names the KIND of change and never the recipients.** The audience is
resolved server-side from the target's own scope, so there is no list to forge
and no per-id permission check to write; a body attempting to name recipients is
**refused**, not ignored. `ConfirmDialog` carries the question through its
`cancelLabel`, because «بدون إشعار» is a decision rather than a cancellation of
one.

## AL · A view switch changes presentation, never the dataset

قائمة and تقويم are two renderings of **one** filtered set. The state that
narrows them is held **above both**, so switching cannot reset a selection and
the two cannot disagree about what is being shown.

The defect (2026-08-19): the back office's list queried with branch, subject,
year and type while its grid called `GET /calendar` with a date range and
**nothing else**. Each view owned its own state, so *the filters* were two things
that merely looked alike — nothing was duplicated for a duplication guard to
catch, and the screen looked right in both views separately.

Canonical: [`use-calendar-filters.ts`](../../frontend/src/hooks/use-calendar-filters.ts)
holds the values; [`calendar-filters.tsx`](../../frontend/src/components/calendar/calendar-filters.tsx)
renders whichever fields the surface offers. **Which fields exist is the
caller's**, because that is a permission decision ([O](#o--scope-and-authorization)):
a beneficiary reading her own calendar is offered no branch filter, since the
control would imply a scope she does not have.

**The URL is the state.** `?view=` already survives a reload and a shared link
(§20 rule 16); the filters join it by the same mechanism, which is what makes
*switching view must not reset the filters* true **by construction** — the switch
writes one parameter and leaves the others alone, so there is nothing to lose.
A filtered calendar becomes a link somebody can send, which the three-`useState`
version could not produce.

**The two views may read different sources, and that is not a defect.** The back
office's list shows the *definitions* — a recurring schedule, an event, an exam —
and its grid shows the *occurrences* they produce. So the shared thing is the
filter **values**, not the rows; a field that cannot narrow both (subject and
academic year are class-only concepts an occurrence does not carry) stays out of
the shared set rather than pretending.

**Measured, because a control that still shows a value while the request ignores
it is the same defect wearing the fix**: `verify-calendar-filters.mjs` chooses a
branch in the list, switches to the grid, and asserts the **grid's own request**
carries `branch_id`.

## AK · UI text is not prose, and does not take the prose measure

`p { max-width: var(--measure) }` — 64ch — is right for a paragraph somebody
reads and wrong for the short explanation under a table. It is declared on the
**element**, so it reaches every `<p>` in the application: the reorder hint on
المستويات wrapped its last word onto a line of its own with half the row empty
beside it.

The evidence that this bites repeatedly is that **six components had already
patched it locally** with `max-width: none` — the dual title, the day dialog's
date, the action message, the confirm body, the preview description, the mobile
trigger — and a seventh had invented a *narrower* measure of its own (`52ch` on
the panel hint). Each was a correct local fix for a defect that was never local.

The exception now lives once, beside the rule it excepts, in
[`tokens/layout.css`](../../frontend/src/styles/tokens/layout.css), and lists the
families of UI text rather than adding a class each component must remember —
because a behaviour every caller opts into is one that will be missing from the
next component somebody writes.

**This is not a licence to un-cap long copy.** Prose keeps `--measure`; the page
description keeps the wider `--measure-lede`. The distinction is *does somebody
read this as text*, not *is it short*.

Measured, and **proved against the defect in the same page**: uncapped the note
is one line of 648px in a 1105px table; with the prose cap restored on the same
element it becomes two lines at 620px.

## The guards

Rules that are not checked drift back. These are behavioural or registry-level,
never CSS-class assertions — asserting a component's classes would pin the design
system's internals, break on every restyle, and catch nothing.

| Guard | What it pins |
|---|---|
| [`ui/atomic-components.test.tsx`](../../frontend/src/components/ui/atomic-components.test.tsx) | one Button (both class vocabularies, and no second system in CSS) · the `＋` convention, in code and in the catalogue · one table, with reasoned exceptions · one Level label · no engineering reference in a user-facing string · no data gate in the copy · no pass/fail on the sheet · no account creation on `المستخدمون`, **in code and in the catalogue** · **the dirty-state wiring, and that no form omits `dirty`** · **AH — one action message, and that it still announces politely** · **AJ — only the shared header composes the calendar atoms** · **AL — one calendar filter state, read from the URL in one place** |
| [`i18n/resolves.test.ts`](../../frontend/src/i18n/resolves.test.ts) | **every literal `t()` key resolves** — and that `t()` still returns the key on a miss, which is the behaviour the guard exists to police |
| [`lib/admin-modules.test.ts`](../../frontend/src/lib/admin-modules.test.ts) | §14.1's sitemap · R61's section rule · **the الإدارة curriculum order** · every label resolves |
| [`lib/teacher-modules.test.ts`](../../frontend/src/lib/teacher-modules.test.ts) | the teaching nodes, their sections, and **no `/admin/*` path in her menu** |
| [`pages/admin/teaching-structure.test.ts`](../../frontend/src/pages/admin/teaching-structure.test.ts) | the circles page reads unconditionally · R69.3's deep links are focus, not gates · BR-22 survives · R43.3 authorization |
| [`components/grading/grade-sheet.test.ts`](../../frontend/src/components/grading/grade-sheet.test.ts) | empty ≠ zero · the scale is the server's · **no verdict, and the override still shown** |
| [`ui/data-table.test.tsx`](../../frontend/src/components/ui/data-table.test.tsx) | all five states, and the action column |
| [`lib/nav-scroll.test.ts`](../../frontend/src/lib/nav-scroll.test.ts) | **W** — the sidebar preserves its position *and* reveals the active entry, by the least movement; never past either end |
| [`pages/calendar.test.tsx`](../../frontend/src/pages/calendar.test.tsx) | **AI** — one segmented group, one emphasis, no call to action among the month controls |
| [`enrollment.http.integration.test.ts`](../../backend/src/controllers/enrollment.http.integration.test.ts) | **AF/L** — a forged `level_id` or `branch_id` is refused *and changes nothing*; the group may still be set and cleared; ending one enrolment leaves the other and the beneficiary |
| [`scripts/dev/browser/verify-ux-slice.mjs`](../../scripts/dev/browser/verify-ux-slice.mjs) | **AG/AI/W** as **rendered boxes** — scroll ownership at two viewports, control geometry on two calendars, sidebar `scrollTop` across a real navigation |
| [`scripts/ci/check-dialog-hidden-when-closed.sh`](../../scripts/ci/check-dialog-hidden-when-closed.sh) | **AG** — no unconditional `display` on `.dialog`, and the explicit closed rule survives |
| [`scripts/dev/browser/verify-dialog-states.mjs`](../../scripts/dev/browser/verify-dialog-states.mjs) | **AG** — closed/open/close/reopen on 15 pages from BOTH the affected and unaffected sets, plus page-flow impact and scroll ownership |
| [`scripts/dev/browser/verify-calendar-header.mjs`](../../scripts/dev/browser/verify-calendar-header.mjs) | **AJ/AK** — region geometry at 1440px and 390px on both calendars, title drift from the header centre, and the table note against its table's width |
| [`components/calendar/calendar-header.test.tsx`](../../frontend/src/components/calendar/calendar-header.test.tsx) | **AJ** — the three regions, and the shape following the data rather than a flag |
| [`scripts/dev/browser/verify-notifications.mjs`](../../scripts/dev/browser/verify-notifications.mjs) | **AM/AN** — asked as three different people: who sees what, who is told, and that declining tells nobody |
| [`scripts/dev/browser/verify-calendar-filters.mjs`](../../scripts/dev/browser/verify-calendar-filters.mjs) | **AL** — a filter chosen in one view survives the switch, in the controls, in the URL **and in the other view's request** |
| `grade.http.integration.test.ts` | a student reads published grades and **not drafts**, one student never reads another's, the projection carries no verdict |
| `teaching-group.http.integration.test.ts` | the flat read grants nothing, every filter narrows, TD-10 pagination, Admin-only |
| [`pages/admin/teachers.test.tsx`](../../frontend/src/pages/admin/teachers.test.tsx) | **AQ** — the action left `المستخدمون` (label *and* component) · the node exists, is routed and sits beside `التسجيلات` · the population is asked by role and never excludes beneficiaries · **one** teaching-profile editor · **X** — the weekday keys resolve, `calendar.weekday` stays absent |
| `user-management.http.integration.test.ts` | **AQ** — `role=teacher` and `beneficiaries_only` are complements: a مؤطِّرة who also studies is in both lists, and a revoked role leaves the teaching list |
| [`components/quran/quran-entry.test.ts`](../../frontend/src/components/quran/quran-entry.test.ts) | **AU, AV** — one workspace and one writer · the curriculum drives the Surah list, never 114 · never `level_ids[0]` · a failed read is not an empty roster · the full ARIA meter contract · no second progress meter anywhere |
| [`scripts/ci/check-progress-css.sh`](../../scripts/ci/check-progress-css.sh) | **AV** — logical sizing, a clipped track and `prefers-reduced-motion`, proved against the defect it exists for |
| [`components/calendar/shared-details.test.ts`](../../frontend/src/components/calendar/shared-details.test.ts) | **AT** — all four calendars render the shared dialog **and** none discards the click · two content sections with two empty states · nothing claimed before a 200 · no Session-page step · the focused read carries the caller's token |
| [`scripts/dev/browser/verify-occurrence-details.mjs`](../../scripts/dev/browser/verify-occurrence-details.mjs) | **AT** — the dialog opened from public, back-office, مؤطرة and beneficiary calendars on a real Session, with both sections present and every focused read a 200 |
| [`components/scheduling/staffing-periods.test.ts`](../../frontend/src/components/scheduling/staffing-periods.test.ts) | **AS** — a blank date is open-ended and converted once at the wire · many assistants and one person on several rows · a new row defaults to assistant · each interval refusal has its own Arabic sentence |
| [`scripts/dev/browser/verify-effective-staffing.mjs`](../../scripts/dev/browser/verify-effective-staffing.mjs) | **AS/R91** — the replacement driven as four identities: dated rows on the form, Safa twice, per-date occurrences, four different answers on one class at one moment, and a handover that leaves the past alone |
| [`components/scheduling/staff-picker.test.ts`](../../frontend/src/components/scheduling/staff-picker.test.ts) | **AR/C** — all three sections delegate to the shared picker and none hand-rolls a checkbox list · exactly one `filter`, and nothing `disabled` by a warning · every warning kind has its own catalogue key · no warning string reads as a prohibition |
| `teaching-candidates.http.integration.test.ts` | **AR** — the four appraisals, the containment rule, ranges never merged, *not declared* ≠ *unavailable*, `monthly` indeterminate, a schedule never conflicting with itself · **and both halves of R88.3**: four warnings do not block the assignment, and a flawless profile with no assignment reaches nothing |
| [`scripts/dev/browser/verify-staff-picker.mjs`](../../scripts/dev/browser/verify-staff-picker.mjs) | **AR** — five مؤطِّرات an administrator must tell apart, in the real form: all offered, each marked, each concern named in Arabic, nothing disabled, the one with no profile assigned anyway, and authority following the assignment |
| [`scripts/dev/browser/verify-teaching-profile.mjs`](../../scripts/dev/browser/verify-teaching-profile.mjs) | **AQ/X** — 13 steps through the real screens: no profile action on `المستخدمون`, the menu node, the population (teacher · teacher+beneficiary · beneficiary-only), the dialog opened **from the clicked row**, Arabic weekdays with no key leak, and a range that survives a reload |

### A guard must be able to read what it guards

**Verify that a new guard can actually see its input before trusting it.** A CSS
assertion written as a vitest glob passed for a whole commit while reading
**empty strings**: `import.meta.glob(..., { query: '?raw' })` yields `''` for a
`.css` file under this project's configuration, so every assertion over the text
succeeded and the guard was counted as protection while certifying nothing.

The tell is a guard that **has never failed**, not even once while being written.
A guard worth keeping fails when you first point it at the defect it exists for —
which is why each of these was proven against a reintroduced fault.

CSS invariants therefore live in `scripts/ci/`, beside `check-design-tokens.sh`,
which already scans stylesheets. `node:fs` inside a test is not the alternative:
`scheduling-parity.test.tsx` records why a test must not pull Node's types onto
the application's type surface.

**When a guard fails because the code changed shape, restate the property — do
not delete the guard.** Three assertions on the circles page pinned the
*accordion's* implementation and failed when the table replaced it. One asserted
the absence of `<LevelSelect`, and the redesign uses that very component **as a
filter** — the rule's fulfilment, which the old assertion called a violation.
**A guard should assert the property, not the shape of the code that currently
has it.**

## Open Owner decisions that touch these rules

### An Event has no location — *خارج المقرات* cannot be expressed (2026-08-19)

The Owner asked for calendar filtering of events held **outside association
premises**: a rented hall, an off-site celebration. The model cannot say it.
`Event` carries **no room, no address and no venue** — its only spatial relation
is `EventBranch`, which is a **scope** (who it concerns), not a location (where
it happens). A Session gets its place from its schedule's `room_id`; an Event has
no equivalent.

**Nothing was invented.** A Branch row called *«خارج المقرات»* would be a fake
organisational unit that every branch filter, every enrolment scope and every
audience resolution would then treat as real. The honest options are a nullable
`Event.venue_name` plus an `is_offsite` marker, or a first-class `Venue` entity —
and which one is right depends on whether the association wants to *reuse* named
external venues, which is a question about the association rather than the code.

**Awaiting the Owner's decision.** Until then the branch filter distinguishes the
branches an event is scoped to, and an event scoped to none reads as *«خارج
المقرات»* in the occurrence table's branch column — which is honest about scope
and says nothing false about place.

* **No structural marker identifies a مستفيدة.** Minors hold no role (§4.3),
  `intended_category_id` is unset on every live row, and one live account holds
  both `teacher` and `student`. So every student picker offers **every active
  account**, and filtering by role would hide exactly the students who most need
  enrolling. Related: R64.7's recommended `Category.holds_own_login`.
* **`/admin/level-surahs` is not in §14.1.** M4c shipped it with *"no SRS
  change"*. Its menu position follows the dependency order §14.1 states for its
  neighbours.
* **Two reads are unlisted in TD-3** — `GET /admin/teaching-groups` and
  `GET /students/me/grades`. See
  [the audit](audit-2026-08-17-ux-architecture.md) §Z for both, with the
  precedent (`GET /students/me/quran` ships under TD-3.3's existing clause and is
  unlisted too).
* **A مؤطرة's Quran list shows names only.** `/quran-students` returns
  `{ id, name_arabic }`; a coverage column would need that read widened.
