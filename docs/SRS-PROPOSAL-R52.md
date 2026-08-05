[Documentation](README.md) › **SRS proposal — Revision 52**

# Draft SRS Revision 52 — the Trash UI returns to the MVP

> **Status: APPLIED to `docs/SRS.md` on 2026-08-05**, with the Owner's amendment: **do not
> defer the feature — ship it with per-entity capability.** *"Restore should be supported only
> for entity types whose restoration is already safe and complete … the UI can support different
> capabilities per entity type."*
>
> That is a better answer than the split this proposal recommended, and it is what shipped.
> Retained for the rationale below — the cascade hazard and the entity analysis — which the
> specification states as a rule rather than an argument.
>
> **Why this one needed asking at all:** unlike R44–R51, which recorded decisions the SRS was
> silent about, this reversed an **explicit postponement** — §7 and §10.1 placed `/admin/trash`
> outside the MVP, and Revision 7 stated those annotations *"are intentional and must be kept —
> they are what AI rule §20.16 enforces against."* Stopping to ask was the point; the Owner's
> answer then improved the design.

---

## What the SRS says today

> **Trash restoration UI — deferred (Revision 6):** the `/admin/trash` page and its
> restore/permanent-delete UI are **post-MVP (§10.1)**. In MVP, restoration of a soft-deleted
> record is performed by the developer/Super Admin via **manual SQL against the `Trash`
> snapshot**, following a documented runbook … every manual restore is executed **exclusively
> through a locked CLI maintenance script** … running restoration SQL directly in psql is
> prohibited, because a raw session enforces nothing and BR-15 accountability would depend on
> developer goodwill.

So the MVP answer to *"restore this record"* is a CLI script, not a screen — and **that script
does not exist either.** Neither half of the deferred plan has been built.

## Why it was deferred, and why that reason is still real

The clause states the hazard in its own words:

> the runbook **must explicitly capture and reinstate the relationship rows the TD-5 cascade
> removed** — `FamilyLink`, `Enrollment`, `StudentTeachingGroup`, `CourseScheduleStaff`,
> `UserBranchRole`, and `UserIdentity` deactivations — **a User restored without their links,
> enrollments and roles is a half-restored, silently broken account.**

**This is the whole difficulty, and a naive Trash page gets it wrong.** Clearing `deleted_at`
on the row is the easy 10%: a restored student with no `Enrollment` is enrolled in nothing, a
restored parent with no `FamilyLink` cannot see their child, and a restored teacher with no
`UserBranchRole` can sign in and reach nothing. **Every one of those failures is silent** — the
row is back, the screen looks right, and the person is broken.

Nothing about that has changed since Revision 6. What *has* changed is that the entities the
cascade touches are now far more numerous than they were: Revision 43 added `Enrollment`,
`StudentTeachingGroup`, `CourseScheduleStaff` and `SessionStaff` to the graph.

## What a correct implementation actually requires

| Piece | Status |
|---|---|
| `Trash` table with JSON snapshots | **Exists** (§7), written by `trash.repository.ts` on every soft delete |
| `purge_after` / BR-15's 90-day window | **Exists** on the row |
| Endpoints — list, restore, permanent delete | **None.** No `/admin/trash` route exists |
| **Cascade reinstatement per entity type** | **None, and this is the hard part** |
| `trash.manual_restore` audit action | Named in the clause; not implemented |

**The cascade reinstatement cannot be generic.** Restoring a `Branch` is nearly trivial;
restoring a `User` means reinstating six relationship types, each with its own rules about
whether the *related* row still exists — a student's Administrative Group may itself have been
deleted since. A Trash page that offers one **Restore** button for every entity type is
promising a correctness it does not have.

## What I recommended, and what the Owner decided instead

*(Recorded as written, because the Owner's amendment is the better answer and the contrast is
the useful part: I proposed deferring restore wholesale; the Owner proposed deferring it **per
entity type**, which ships the same safety with far more of the feature.)*

**What shipped:** browsing, plus restore for `Branch`, `Category`, `Subject` and `Room` — the
types whose deletion is *guarded* rather than cascading — with every other type refused loudly
and the reason stated on the row.

**What I had proposed:**

1. **`GET /admin/trash`** — list, filter by entity type, by who deleted it and when, search,
   and show `purge_after`. Super Admin only. **This has no correctness hazard at all**: it
   reads a table nobody disputes and answers *what was deleted, by whom, and when*, which is
   the question an administrator actually arrives with.
2. **The locked CLI restore script** the clause already requires — `npm run db:restore`,
   wrapping snapshot restoration, cascade reinstatement and the `trash.manual_restore` audit
   row in one transaction. Per entity type, explicitly, starting with the ones that have no
   cascade.
3. **Restore and permanent-delete from the UI — a later slice**, once (2) has proven the
   reinstatement per entity type. A button is safe only when the operation behind it is.

**Permanent delete deserves a specific note.** BR-15's 90-day window is enforced automatically
by `content.quarantine-purge` (TD-7). A manual *"delete permanently now"* control bypasses a
retention rule that exists for legal and safeguarding reasons — that is a decision about data
retention policy, not a convenience, and it should be taken deliberately rather than because a
Trash page conventionally has that button.

## Exact wording to apply, if the Owner accepts

### 1. New entry in §0

> **Revision 52 (Document Owner decision — the Trash browsing UI returns to the MVP,
> 2026-08-05):** Revision 6 deferred `/admin/trash` in full. The **read-only half returns**: a
> Super Admin screen listing soft-deleted records with their entity type, who deleted them, when,
> and when BR-15's window purges them, with filtering and search. **It has no correctness
> hazard** — it reads the `Trash` snapshots and asserts nothing about restoring them.
>
> **Restore and permanent delete remain deferred**, and the reason is unchanged and stated in
> §7: the TD-5 cascade removes `FamilyLink`, `Enrollment`, `StudentTeachingGroup`,
> `CourseScheduleStaff`, `UserBranchRole` and `UserIdentity` rows, and **a User restored without
> them is a half-restored, silently broken account** — one that looks correct on every screen.
> Restoration therefore keeps its §7 mechanism, the **locked CLI maintenance script**, which is
> now a required MVP deliverable rather than an assumed one. **A Restore button ships when the
> reinstatement behind it is proven per entity type, not before.**
>
> **Permanent deletion from the UI is not added.** BR-15's 90-day window is enforced by
> `content.quarantine-purge` (TD-7); a manual override is a data-retention decision and requires
> its own revision.

### 2. §7 — amend the deferral

> Replace *"the `/admin/trash` page and its restore/permanent-delete UI are post-MVP"* with:
> *"the `/admin/trash` **browsing** page is in the MVP (Revision 52); its **restore and
> permanent-delete** actions are post-MVP and restoration runs through the locked CLI script
> below."*

### 3. TD-3 — one route

> `GET /admin/trash?entity=&deleted_by=&from=&to=&q=&page=` → Super Admin only. Lists
> soft-deleted records with entity type, target id, who deleted them, when, and `purge_after`.
> **No write operations.**

### 4. §14.1 — one node under Administration

> `Trash .............................. /admin/trash (Super Admin, read-only — R52)`

---

## If the Owner wants the full feature instead

That is a legitimate call, and it is bigger than it looks. It needs, per entity type: a
reinstatement plan for every relationship the TD-5 cascade removes, a rule for what happens
when a *related* row was itself deleted, and a test per type proving the restored record is
whole. I would want that scoped as its own milestone slice rather than folded into a screen —
and I would want to write the CLI script first regardless, because it is the same logic and it
is testable without a UI.
