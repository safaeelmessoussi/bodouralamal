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

**The one legitimate exception is a table whose cells hold live form controls**
bound to per-row draft state — the grade sheet, the Quran log editor, the Hijri
month editor. `Column.cell` *can* render an input, but the row model assumes a
row is a value to read and act on, not a form field with its own dirty state and
save. Three screens qualify; they are named with their reasons in the guard's
allowlist. **A fourth is the signal to build an editable-table primitive**, not
to add a fourth exception.

A **calendar month grid** is a `<table>` and is not a list: weekdays across, weeks
down, a cell addressed by both. Different concept, permanent exception.

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

**And check whether the SRS has already refused the shape being asked for.** A
*per-exam* maximum mark is not this: R58 rejected it in terms — *"a second answer
to what `grading.display_scale` already owns"* — so the question *"is this exam
out of 10 or 20"* is platform-wide by decision, not by omission.


---

## The guards

Rules that are not checked drift back. These are behavioural or registry-level,
never CSS-class assertions — asserting a component's classes would pin the design
system's internals, break on every restyle, and catch nothing.

| Guard | What it pins |
|---|---|
| [`ui/atomic-components.test.tsx`](../../frontend/src/components/ui/atomic-components.test.tsx) | one Button (both class vocabularies, and no second system in CSS) · the `＋` convention, in code and in the catalogue · one table, with reasoned exceptions · one Level label · no engineering reference in a user-facing string · no data gate in the copy · no pass/fail on the sheet · no account creation on `المستخدمون`, **in code and in the catalogue** · **the dirty-state wiring, and that no form omits `dirty`** |
| [`i18n/resolves.test.ts`](../../frontend/src/i18n/resolves.test.ts) | **every literal `t()` key resolves** — and that `t()` still returns the key on a miss, which is the behaviour the guard exists to police |
| [`lib/admin-modules.test.ts`](../../frontend/src/lib/admin-modules.test.ts) | §14.1's sitemap · R61's section rule · **the الإدارة curriculum order** · every label resolves |
| [`lib/teacher-modules.test.ts`](../../frontend/src/lib/teacher-modules.test.ts) | the teaching nodes, their sections, and **no `/admin/*` path in her menu** |
| [`pages/admin/teaching-structure.test.ts`](../../frontend/src/pages/admin/teaching-structure.test.ts) | the circles page reads unconditionally · R69.3's deep links are focus, not gates · BR-22 survives · R43.3 authorization |
| [`components/grading/grade-sheet.test.ts`](../../frontend/src/components/grading/grade-sheet.test.ts) | empty ≠ zero · the scale is the server's · **no verdict, and the override still shown** |
| [`ui/data-table.test.tsx`](../../frontend/src/components/ui/data-table.test.tsx) | all five states, and the action column |
| `grade.http.integration.test.ts` | a student reads published grades and **not drafts**, one student never reads another's, the projection carries no verdict |
| `teaching-group.http.integration.test.ts` | the flat read grants nothing, every filter narrows, TD-10 pagination, Admin-only |

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
