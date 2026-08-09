[Documentation](README.md) › **SRS proposal — Revision 57**

# Draft SRS Revision 57 — a Course Schedule carries its own name

> **Status: APPLIED to `docs/SRS.md` on 2026-08-09**, on the Document Owner's explicit approval:
> *"Class title — approve R57. Add a real title field to RecurringCourseSchedule and also add a
> description: العنوان\* — manually entered; الوصف — optional."*
>
> Retained for the rationale — chiefly *why the Subject was not already a name*, and why the
> required column still had to arrive nullable.

---

## What the model said before

`RecurringCourseSchedule` had **no name at all**. A class was identified by its Subject and its
target: *تفسير · مجموعة 1*. That is a correct *identification* and a poor *name* — two Tafsir
classes for the same group at different levels of depth, or a revision circle and a memorisation
circle in the same Subject, are different things an administrator must be able to tell apart at
a glance and could not.

The unified Scheduling screen made the gap plain: every other schedulable item is named by
something a person typed, and a class alone borrowed its name from a foreign key.

## The decision

`RecurringCourseSchedule` gains:

* **`title`** — **required**, 1–120 characters, Arabic-collated like every other display name
  (TD-6a). What the class is called.
* **`description`** — optional, ≤ 2,000 characters. The same bound `Event.description` and
  `EducationalContent.description` already take (TD-9).

Both are ordinary attribute columns: editable after creation, unlike Subject, target, branch and
academic year, which §4.4 freezes because changing them would re-point Sessions already
materialized against the old answer. **A name is not one of those** — renaming a class changes
nothing about what was taught, to whom, or when.

## Why a required column arrives nullable

TD-6b mandates **expand–migrate–contract** and forbids data loss, so a `NOT NULL` column cannot
simply appear on a table with rows. The migration therefore:

1. **expands** — adds both columns nullable;
2. **migrates** — backfills `title` from the Subject's name, which is exactly the identification
   those rows have been displaying, so no existing schedule changes meaning;
3. **contracts** — sets `title NOT NULL`.

The backfill is deliberately the Subject name rather than a placeholder: a row created before
this revision *was* named after its Subject on every screen, so carrying that forward is
preservation rather than invention.

## What this does not change

**Nothing about scheduling.** The title is a label: it is not an identifier, it is not unique, it
takes no part in conflict detection, recurrence, materialization, the R50 split, or the resolved
audience. `subject_id` remains what a client filters and links by, and §4.4c remains the single
definition of who a class is for.

## Exact wording applied

### §0

> **Revision 57 (Document Owner decision — a Course Schedule carries its own name, 2026-08-09):**
> `RecurringCourseSchedule` had **no name**: a class was identified by Subject and target, which
> identifies correctly and names poorly — two classes in one Subject for one group could not be
> told apart at a glance, and the unified Scheduling screen (R56) made that plain, since every
> other schedulable item is named by something a person typed. It gains a **required `title`**
> (1–120 characters, `ar-x-icu` collated, TD-6a/TD-9) and an **optional `description`** (≤ 2,000,
> the bound `Event.description` already takes). **Both are editable after creation**, unlike
> Subject, target, branch and academic year, which §4.4 freezes because changing them re-points
> Sessions already materialized — a name is not such a value. **The title is a label, never an
> identifier:** it is not unique and takes no part in conflict detection, recurrence,
> materialization, the R50 split or audience resolution, and `subject_id` remains what a client
> filters and links by. Per TD-6b the column arrives **nullable, is backfilled from the Subject's
> name — which is precisely what those rows already displayed — and is then set `NOT NULL`**, so
> no existing schedule changes meaning and nothing is lost.

### §7 — `RecurringCourseSchedule`

> Add: `title` (required, 1–120, Arabic-collated) and `description` (optional, ≤ 2,000). Labels,
> not identifiers.

### TD-3.12 — `POST /admin/course-schedules`

> Body gains `title` (required) and `description` (optional); `PATCH` accepts both, unlike the
> frozen scope fields.
