[Documentation](../README.md) › [Development](README.md) › **Engineering constitution**

# The engineering constitution

**The laws every implementation must satisfy before it is complete.**

This document answers exactly one question:

> **If someone joins this project two years from now, what rules must they obey before writing
> a single line of code?**

Read it before writing production code, audit the feature against it while building, and
verify compliance before reporting done. It is required reading — SRS §16.3 makes it a
mandatory content of `CLAUDE.md` and `AGENTS.md`.

These are **laws, not preferences.** A law that cannot be followed is information — see
[§10](#10-when-a-law-blocks-you). A law quietly ignored is a defect.

---

## 0. The mindset

Everything below follows from two habits of thought. They are first because they change *what
you build*, not merely how you write it.

### 0.1 ✳️ Build systems, not pages

Before building anything, ask: **can this become infrastructure?**

A table, a form, a search box, pagination, a modal, a file uploader, a date picker, a
confirmation dialog, an image viewer, an audio player, a video player, a PDF viewer — **none
of these is ever built for one page.** They are platform capabilities that a page happens to
be the first to need.

The test is not *"does this page need a table?"* but *"does this platform have a table?"* If
the answer is no, that is the thing to build, and the page is its first consumer.

### 0.2 ✳️ Every implementation enriches the platform

Reframe the task before starting it:

| Instead of | Think |
|---|---|
| *I am implementing Branch CRUD* | I am improving the platform's **CRUD framework** |
| *I am implementing Educational Content* | I am improving the platform's **document-management infrastructure** |
| *I am implementing the Calendar* | I am improving the **scheduling engine** |
| *I am implementing Approvals* | I am improving the **review-and-decision workflow** |

The feature is the *occasion*; the capability is the *deliverable*. A platform built this way
gets easier to extend with each feature. One built page-by-page gets harder.

**This is the single highest-leverage idea in this document.** Everything in §2 and §3 is
downstream of it.

### 0.3 ✳️ Ask what will reuse this

When implementing anything: **what feature, six months from now, should reuse this?**

If the honest answer is *"nothing"*, you are probably writing feature-specific code where a
capability belonged. That is sometimes correct — but it should be a decision, not a default.

---

## How to read this document

> **This page states the laws that have no other home, and *cites* the ones that do.**

That is not a stylistic choice — it is §1.2 applied to this page. A constitution that
restated §16.2, §14.3 and §16.4 would create a second authoritative home for a dozen rules,
and **every duplicated requirement in this project's history has drifted** (TD-15's version
list, BR-15's purge window, TD-10's pagination, the display-identity rule). A constitution
that violates its own first principles is worth nothing.

So: where a rule is already normative, you get **one line and a link**. Where it is not, you
get the full law.

| | Meaning |
|---|---|
| ⚖️ | **Normative elsewhere** — the SRS states it; this is a pointer |
| ✳️ | **Stated here** — this page is its authoritative home |
| 🤖 | **Machine-enforced** — a CI guard fails the build |

---

## 1. Architecture

### 1.1 ⚖️ The backend is the source of truth

Business data is computed server-side and rendered by clients verbatim. A client that derives
a business value has become a second implementation of a rule, and two implementations
eventually disagree.

The platform has two named instances, both binding: **never compute a Hijri date in a client**
(§20 rule 14) and **never resolve a public display identity in a client** (§20 rule 21, §7's
*Public display identity invariant*). Both exist because the wrong branch is invisible to the
person it harms.

✳️ **The general law, stated here:** if a value is the answer to a *business* question — what
something is called, what it costs, whether it passed, which name may be published — the
server computes it and the client renders it. A client may compute **presentation**: layout,
formatting of a value it was given, which of its own already-fetched rows to show.

The test is: *would two clients disagree if they implemented this independently?* If yes, it
belongs on the server.

**The frontend never decides any of these:**

| The backend decides | The frontend does |
|---|---|
| Permissions and visibility | Renders what it was given |
| State transitions, publication, approval | Shows the current state and offers the action |
| Hijri dates and calendar resolution | Renders the label, or nothing where there is none |
| Display names on public surfaces | Renders `display_name` verbatim |
| Business validation | Mirrors the limits for *immediate feedback*, never as the authority |

That last row is the one that misleads: a client **may** validate for responsiveness, using the
shared limit constants — but the server validates for correctness, and a client that skips a
check the server enforces is a bug in the client, not a shortcut.

### 1.2 ⚖️ One authoritative home per concept

SRS §16.4. No concept has two authoritative homes anywhere — in code, in the schema, or in
this documentation. **Where an audit finds one requirement stated twice, the fix is to delete
a copy and cross-reference the survivor, never to synchronise them.**

### 1.3 ⚖️ API-first, contract-governed

The generated contract is an artifact of the implementation and is never hand-edited; CI
regenerates it and fails on drift, and on any endpoint that contradicts, or is absent from,
the specification (§3.1, Revision 21). **Never add an endpoint the SRS does not document**
(§20 rule 16) — a new endpoint is a Document Owner revision, not an implementation decision.
🤖 `check-openapi-td3.sh`

### 1.4 ⚖️ Layering is enforced, not encouraged

Controllers hold HTTP only · services own business logic, TD-4 transaction boundaries and TD-1
state machines · repositories are the sole data-access layer (§16.2).
→ [Conventions § layering](conventions.md#layering)

### 1.5 ✳️ The adapter is the only seam between API and UI

Every network call goes through an adapter. Components never fetch, and never see a raw API
payload. Adapter types are written as the response they parse, so a contract change lands in
one file rather than across every component that reads a field.

A screen may be built against a **mock adapter** before its endpoints exist — under the rules
in [Frontend § mock adapters](../architecture/frontend.md#mock-adapters-building-a-screen-before-its-endpoint-exists).
A mock is a placeholder behind a seam, **never licence to invent a contract.**

---

## 2. Reuse — the generic-first law

This section is the heart of the document, and most of it exists nowhere else.

### 2.1 ✳️ One component per *concept*, never one per *entity*

> **Never build `StudentTable`, `TeacherTable`, `LevelTable`, `BranchTable`.**
> Build **one** `DataTable`, configured by columns, actions, sorting and filters.
>
> **Never build `StudentForm`, `TeacherForm`, `UserForm`.**
> Build **one** `EntityForm`, configured by fields.

The entity is data. The table and the form are concepts. **A component named after an entity
is a copy waiting to happen**: the second is created by duplicating the first, the two drift,
and a fix applied to one silently misses the other.

The same law governs dialogs, search, cards, empty states and pagination. §14.3 already names
the registry as *"build once, reuse"* and forbids duplicating a component per page — this
states the principle that produces the registry rather than only its current contents.

### 2.2 ✳️ Every CRUD screen must feel identical

This is the user-facing consequence of §2.1, and it is worth stating separately because it is
the part a *reader* experiences.

> **If someone knows how to edit Branches, they must automatically know how to edit Levels,
> Rooms, Teachers, Academic Years, Categories, Subjects, Content and Events.**

Same toolbar. Same button placement and wording. Same search. Same filters. Same confirmation
dialogs. Same pagination. Same loading, empty, error and no-results states. Same success
messages. Same keyboard behaviour.

A screen that is *almost* the same as its neighbours is worse than one that is obviously
different: the reader's learned expectation is wrong in a way they cannot see. §14.2 makes the
layout normative; **this makes the sameness a goal rather than a coincidence.**

### 2.3 ✳️ Configure, do not hardcode

Icons, labels, button text, columns, filters, row actions, status colours, permissions,
empty-state copy — **these are configuration, not code.** A component that hardcodes them can
serve one screen; the same component taking them as configuration serves every screen.

The concrete test: **if adding a second entity means editing the component rather than passing
it different configuration, the component is drawn wrongly.**

Labels and copy are additionally i18n keys, never literals (§16.2).

### 2.4 ✳️ Zero visual duplication

> **If two screens look 95 % identical, they share components — not merely CSS.**

Shared styling with duplicated markup is the weaker half of the fix: the two copies still
drift in behaviour, states and accessibility, and only the appearance stays in step. When two
screens look alike, find the concept they have in common and extract *it*.

### 2.5 ✳️ Variants, not new components

A visual or behavioural difference within one concept is a **variant of the existing
component**, not a new component.

```
✅  <Button variant="danger">        ❌  <DangerButton>
✅  <Dialog wide>                    ❌  <WideDialog>
✅  <DataTable dense>                ❌  <CompactStudentTable>
```

If a variant needs a third boolean and a special case, that is the signal the concept was
drawn wrongly — **redraw it, do not fork it.**

### 2.6 ✳️ Before creating any component, answer one question

> **Will another screen need this?**
>
> **Yes** → it is generic. It goes in the shared registry with a variant API.
> **No** → it is a feature component. It lives beside its feature.
>
> **Unsure** → build it as a feature component. Promote it the moment a second consumer
> appears — and promote it by **moving** it, never by copying it.

Speculative generality is its own defect. Revision 32 settled the general form of this: *"an
abstraction with no implementation is unused scaffolding."* Build the second consumer's needs
when the second consumer exists, not before.

### 2.7 ✳️ Extract on the second use, never on the third

The first use is a component. **The second use is the extraction.** Copying with intent to
generalise later is how a codebase acquires four nearly-identical tables.

If generalising the existing one is more work than copying it, that is a design problem to
solve, not a reason to copy.

### 2.8 ✳️ Never modify a copy

If an existing component *almost* fits: **improve it** so it fits both cases. Do not copy and
adjust. A copy inherits today's bugs and none of tomorrow's fixes.

---

## 3. Atomic composition

### 3.1 ✳️ Build from the smallest reusable piece upward

```
Page → Section → Card → List → DataTable → Cell → Text
```

Not: *a large page, copied and adjusted.*

A page should read as an assembly of named parts. If a page component exceeds roughly a
screenful of JSX, the parts inside it have names it has not given them yet.

The calendar and the content library are the worked examples: each is a page that composes
title, toolbar, grid, cell, chip and dialog — **each with a single responsibility and each
independently testable.** That is why the calendar's day dialog could replace a whole panel
without touching the grid.

### 3.2 ✳️ A component owns one responsibility

> **A `DatePicker` picks dates.**
>
> It does not validate. It does not format for display. It does not call an API. It does not
> save a form. **The parent composes that behaviour.**

If a component both *fetches* and *renders*, or both *decides permission* and *displays*, it
has two reasons to change — and it can only be reused by screens that want both. Split it: the
page fetches and decides; the component renders what it is given.

The level selector is the sharpest instance — **it has no category prop at all**, so it
*cannot* filter the list it was handed, which is what §4.4 forbids. A rule enforced by shape
cannot be forgotten.

---

## 4. Frontend

### 4.1 ⚖️ The CRUD screen has one layout

Title · actions · filters · paginated table · row actions · all mandatory states. §14.2 makes
this normative for **every** list and management screen; §14.3 lists the components it is
assembled from. **Never reinvent the arrangement per screen.**

### 4.2 ⚖️ Every page implements every mandatory state

Loading (skeleton, not a spinner) · empty · error with request id · no-permission ·
**no-results, distinct from empty** · offline/retry. §14.4 names forgetting empty states as
the most common failure mode.

### 4.3 ✳️ Forms are assembled from field components, never hand-built

Every form input is one of the shared field components — text, textarea, select, autocomplete,
date, file, checkbox, radio group — each owning its own label association, error rendering,
required marking and focus behaviour.

**Hand-built inputs are how accessibility rots**: a hand-rolled field is one missing `for`
attribute away from an unlabelled control, and nobody notices until someone using a screen
reader does.

> **Status: not yet built.** §14.3's registry does not currently list form primitives. They
> arrive with the first form — the first CRUD module — as *components*, not as a hand-rolled
> `<input>` inside a page. Recorded in [TASKS.md](../TASKS.md).

### 4.4 ⚖️ Navigation is the sitemap, exactly

No invented sections, no reshuffling (§14.1, §20 rule 16). The back office holds §14.1's
hierarchy as **data**, so navigation, routing and permissions cannot diverge —
→ [Frontend § the back office](../architecture/frontend.md#the-back-office-one-registry-drives-nav-routing-and-permissions).

A drill-down view is **not** a new navigation node: use a parameter, as `/resources?level=`
and `/admin/groups/{id}/roster` both do.

---

## 5. Design system

### 5.1 ⚖️🤖 Tokens only — no raw values, ever

No hex colours, no `padding: 17px`, no raw radii or durations in component CSS. Components
consume the **semantic** layer only — `--color-primary`, never `--brand-green-700`.
🤖 `check-design-tokens.sh` fails the build on a raw colour, a reach past the semantic layer,
or an unimported stylesheet.
→ [Design system](../architecture/design-system.md)

### 5.2 ⚖️ Import order is the cascade

Every rule has single-class specificity, so **which declaration wins is decided by load
order**. Equal-specificity states are written in ascending order of priority with a comment
saying so.
→ [Design system § state layering](../architecture/design-system.md#state-layering-order-encodes-priority)

### 5.3 ✳️ Design consistency beats local optimisation

> **Never make one screen prettier if it creates a second design language.**

A screen that is individually better and collectively inconsistent is a net loss: the platform
should feel as though **one person designed all of it**. A local improvement worth having is
worth making everywhere — so make it in the shared component, where every screen gets it.

If a screen genuinely needs something the design system lacks, that is a gap in the system to
fill, not a licence to deviate in one page.

### 5.4 ✳️ Colour never carries meaning alone

Every state, type or status conveyed by colour is **also** conveyed in words or shape. It has
to survive a monochrome screen and a colour-blind reader.

Where a brand colour is used below contrast thresholds, that is a **recorded decision with a
measured ratio and a stated reason it is safe** — never an oversight.
→ [Design system § brand colours](../architecture/design-system.md#the-brand-colours-and-a-contrast-decision-recorded-rather-than-hidden)

---

## 6. Backend

### 6.1 ⚖️ Repositories are the only data access

Services never touch the ORM directly; repositories apply soft-delete filtering uniformly
(§16.2). 🤖 `check-prisma-mass-write.sh`

### 6.2 ⚖️ Validation limits live in exactly one place

Zod schemas at the API boundary are the single place field limits are encoded, and the
constants are shared with the client (§16.2, TD-9).

### 6.3 ⚖️ Transactions and state machines belong to services

TD-4's boundaries are implemented verbatim, including same-transaction job enqueue; TD-1's
transitions happen only through service methods that validate them.

### 6.4 ✳️ Reuse the mechanism, not the shape — an exception, recorded

**Generic CRUD services are *not* adopted**, and this is a deliberate exception to §2.1.

A generic CRUD service would bypass the exact layer where TD-1 state machines, TD-4
transaction boundaries and the TD-2 permission predicates live. "Update a row" is not a shared
concept here: approving a registration, publishing a grade and recording a Hijri month are
different operations that happen to end in a write.

**What is reused instead is the mechanism:** the optimistic-locking helper, the pagination
module, the branch-scope and teacher-scope policies, the audit repository, the job repository.
Reuse the machinery; keep the business operation explicit.

---

## 7. Documentation

### 7.1 ⚖️ Documentation is part of Done

A feature is not complete until the documentation describing it is updated, **in the same
commit**. Drift is a defect (§16.4).
→ [Documentation policy](documentation-policy.md)

### 7.2 ⚖️ Discovered knowledge is technical debt, paid immediately

Anything learned during implementation that is not already documented is debt **from the
moment of discovery** — whether or not it was asked for, whether or not it relates to the task.
→ [Documentation policy § technical debt](documentation-policy.md#undocumented-knowledge-is-technical-debt)

✳️ **Four questions to close every task with:**

1. **What did I learn?**
2. **What reusable pattern emerged?**
3. **What pitfall did I discover?**
4. **What will a future developer thank me for writing down?**

Anything with an answer goes into the documentation **now**. The moment of discovery is the
cheapest moment to record it, and the only one at which the reasoning is still intact.

### 7.3 ⚖️ Record what was rejected

A design note naming the alternative and why it lost is the highest-value paragraph in any
page — it is what stops the next person re-deciding it under deadline without the context.

---

## 8. The development process

Not a list of guidelines — **the order the work happens in.** Steps 1–6 come before any
production code, and they are the cheapest point at which the answers can still change the
design.

| # | Step | Why it is here |
|---|---|---|
| 1 | **Read the relevant documentation** | Mandatory (§16.3). Finds the decision already recorded, the concept's existing home, and the honest size of the task |
| 2 | **Check whether the feature changes the SRS** | If a *normative requirement* moves, that is a revision — **stop and report**, never edit (§20 rule 20) |
| 3 | **Check whether an existing component can be reused** | And if it *almost* fits, whether improving it is the answer (§2.8) |
| 4 | **Check whether a generic component should be extracted** | Second consumer means extract now, not later (§2.7) |
| 5 | **Check whether an existing API already solves this** | A second endpoint doing an existing job is duplication in its most expensive form |
| 6 | **Check what new reusable patterns this introduces** | Name them before building, so they are designed rather than discovered |
| 7 | **Implement** | |
| 8 | **Refactor the moment a second consumer appears** | Not at the third copy — at the second use |
| 9 | **Update all affected documentation** | In the same commit (§7.1) |
| 10 | **Verify no duplication was introduced** | Including duplication of *behaviour*, not only of code |
| 11 | **Report in the six-section format** | → [Reporting completion](README.md#reporting-completion) |

**Steps 2 and 5 are the ones most often skipped**, and both are expensive to skip: step 2
because inventing a requirement is the failure §20 rule 20 exists to prevent, and step 5
because a duplicate endpoint outlives every screen that called it.

---

## 9. Definition of Done

**A feature is complete when all of these are true. Not most.**

### Implementation
- [ ] Backend implemented, or its absence explicitly reported as a blocker
- [ ] Frontend implemented, including every §14.4 state
- [ ] **Reusable opportunities extracted** — nothing was copied that should have been generalised
- [ ] **Duplication removed**, not merely avoided
- [ ] No business value computed in a client

### Quality
- [ ] **Tests added**, asserting the *property* rather than the code path
- [ ] **Design tokens respected** — no raw values
- [ ] **Accessibility checked**: labels, roles, focus order, keyboard reachability, and colour
      never the sole carrier of meaning
- [ ] **Responsive**, verified at 360 px (§14.7)
- [ ] RTL correct

### Record
- [ ] **Documentation updated in the same commit**, every affected page
- [ ] **Cross-references verified** — `bash scripts/ci/check-doc-links.sh`
- [ ] [`CHANGES.log`](../CHANGES.log) updated; [`TASKS.md`](../TASKS.md) ticked
- [ ] **SRS revised only if a normative requirement changed** — and that is the Document
      Owner's call, so stop and report rather than editing
- [ ] **These principles verified**, with any intentional exception reported and justified

> **Reporting done with any of these outstanding is reporting done falsely.** Where an
> exception is deliberate — as §6.4 is — it is stated in the completion report with its
> reason, not left to be discovered.

Report using the [six-section structure](README.md#reporting-completion).

---

## 10. When a law blocks you

These are laws, not suggestions — but a law that cannot be followed is information, not an
obstacle to route around.

1. **Do not silently violate it.** A quiet exception is indistinguishable from a mistake.
2. **Do not route around it** by, for example, copying a component to avoid improving one.
3. **State the conflict**, propose the resolution, and — if it needs a specification change —
   **stop and ask** (§20 rule 20).

§6.4 is the worked example: a proposed principle was examined, found to conflict with TD-1 and
TD-4, and **recorded as a reasoned exception** rather than adopted because it sounded right.

---

**Related:** [Conventions](conventions.md) · [Documentation policy](documentation-policy.md) ·
[Testing](testing.md) · [Architecture](../architecture/README.md) ·
[Technical design](../reference/technical-design.md)
