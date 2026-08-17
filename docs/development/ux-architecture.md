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
[`atomic-components.test.ts`](../../frontend/src/components/ui/atomic-components.test.ts)
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

---

## The guards

Rules that are not checked drift back. These are behavioural or registry-level,
never CSS-class assertions — asserting a component's classes would pin the design
system's internals, break on every restyle, and catch nothing.

| Guard | What it pins |
|---|---|
| [`ui/atomic-components.test.ts`](../../frontend/src/components/ui/atomic-components.test.ts) | one Button (both class vocabularies, and no second system in CSS) · the `＋` convention, in code and in the catalogue · one table, with reasoned exceptions · one Level label · no engineering reference in a user-facing string · no data gate in the copy · no pass/fail on the sheet · no account creation on `المستخدمون` |
| [`lib/admin-modules.test.ts`](../../frontend/src/lib/admin-modules.test.ts) | §14.1's sitemap · R61's section rule · **the الإدارة curriculum order** · every label resolves |
| [`lib/teacher-modules.test.ts`](../../frontend/src/lib/teacher-modules.test.ts) | the teaching nodes, their sections, and **no `/admin/*` path in her menu** |
| [`pages/admin/teaching-structure.test.ts`](../../frontend/src/pages/admin/teaching-structure.test.ts) | the circles page reads unconditionally · R69.3's deep links are focus, not gates · BR-22 survives · R43.3 authorization |
| [`components/grading/grade-sheet.test.ts`](../../frontend/src/components/grading/grade-sheet.test.ts) | empty ≠ zero · the scale is the server's · **no verdict, and the override still shown** |
| [`ui/data-table.test.tsx`](../../frontend/src/components/ui/data-table.test.tsx) | all five states, and the action column |
| `grade.http.integration.test.ts` | a student reads published grades and **not drafts**, one student never reads another's, the projection carries no verdict |
| `teaching-group.http.integration.test.ts` | the flat read grants nothing, every filter narrows, TD-10 pagination, Admin-only |

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
