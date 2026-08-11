[Documentation](README.md) › **SRS proposal — Revision 66**

# Draft SRS Revision 66 — a student is enrolled in a Level; a Group is a subdivision

**Status: authorised by the Document Owner (2026-08-11), who approved both
decisions the audit put to them** — *"YES, adopt the model. YES, move branch to
Enrollment and make Administrative Group optional … Preserve the existing
Subject/Teaching Group model; do not redesign it."*

The audit is [`docs/development/audit-2026-08-11.md`](development/audit-2026-08-11.md),
addendum. This revision implements exactly what it recommended and nothing more.

---

## 66.1 — What does NOT change

Stated first, because most of the intended model is already the specification and
restating it would risk drifting from wording that is already correct.

* **The Subject side is untouched.** §7's Teaching Group clause already says
  *"A Subject with no Teaching Groups in a Level is taught to the entire Level.
  Creating Teaching Groups is not a prerequisite for teaching a Subject."*
  Subjects remain independent entities reaching Levels through `LevelSubject`;
  Circles remain scoped to `(Subject, Level)`; `TeachingMode.entire_level`
  remains how an unsplit Subject is delivered. **No text and no schema.**
* **A Level still belongs to a Category and to no Branch.** It never had a
  branch column.
* **Terminology is unchanged.** `AdministrativeGroup` and `TeachingGroup` keep
  their names: they encode §20 rule 22's organisation-versus-delivery
  distinction, which this revision must not blur. The **Arabic interface labels**
  say «مجموعات المستويات» and «حلقات المواد»; that is a presentation matter and
  needs no clause.
* **`UNIQUE (student_id, level_id)` among non-deleted rows** (BR-21) is
  unchanged and still carries the "one place per Level" rule.

## 66.2 — A student is enrolled in a Level; the Group is optional

§7's Enrollment clause said:

> A student belongs to one or more Levels, and to **exactly one** Administrative
> Group inside each enrolled Level.

It becomes:

> **A student is enrolled in a Level.** A Level that needs no subdivision needs
> no Administrative Group, and a student may be enrolled in it **directly**. When
> a Level *is* subdivided, a student holds **at most one** Administrative Group
> within it — never two, and never a group belonging to another Level.

**A Group is required only when the Level is actually subdivided.** Creating one
is not a prerequisite for admitting anybody, exactly as it is not a prerequisite
for teaching a Subject.

`enrollment.administrative_group_id` becomes **nullable**. Nothing else about the
row changes: `level_id` was always a column, so a student's Level was never
derived and there is no new source of truth. **`StudentLevel` stays withdrawn**
(Revision 43) — `Enrollment` *is* that record.

## 66.3 — The branch moves to the Enrollment

**This is the whole revision; everything else follows from it.**

Until now a student's branch existed **only** through their group —
`Enrollment → AdministrativeGroup.branch_id`, named identically by §5.2 and
Revision 43.3, and read at **13 code sites**. Revision 43.3 relied on it
explicitly, calling the group's branch *"a referent that does exist"* precisely
because a Level spans branches.

Make the group optional and that referent disappears for every ungrouped student,
taking Admin branch scoping, Teaching-Group placement authority, the Educational
Library's own-branch ordering and `entire_level` audience resolution with it.

So: **`Enrollment` carries `branch_id`, and it is the single answer to *where is
this student*.**

* It is **required**. A student is admitted *somewhere*; an enrolment with no
  branch would reintroduce the hole this revision closes.
* **The enrolment is the operational assignment**, which is where the branch
  belongs. A Level spans branches and a Subject spans branches; a *placement*
  does not.
* **Groups keep their own `branch_id`**, unchanged. A subdivided Level still
  reads exactly as the association describes it — *مجموعة 1 at تاركة, مجموعة 2 at
  أمرشيش*.
* **The two cannot disagree**, and that is enforced rather than intended: a
  composite foreign key `(administrative_group_id, branch_id) → AdministrativeGroup(id, branch_id)`,
  **the same device Revision 43 already uses** for `(administrative_group_id, level_id)`.
  A composite FK in PostgreSQL is not enforced when any of its columns is NULL,
  so the ungrouped case needs no exception and the grouped case cannot drift.

**§5.2 and Revision 43.3 are corrected together:** *"the person's own Branch"* is
now `Enrollment.branch_id`. It remains one rule stated in one place — the join
simply became a column. It is still **never** `User.intended_branch_id`, which
records only what an applicant asked for (Revision 39).

## 66.4 — Three rules retire

Each existed only to guarantee that a Level always had a group.

* **TD-4.6b** — `createLevel` created the Level *and* its first Administrative
  Group in one transaction. **Retired.** A Level is created alone, and the
  creation form asks for no branch, because a branch was never a property of a
  Level. The transaction's atomicity reasoning stands for anything that still
  creates two rows; it simply has nothing left to guard here.
* **TD-4.6d** — the bootstrap backfill that put `المجموعة 1` into every Level.
  **Retired.** It was the same guarantee applied to existing data.
* **`LAST_GROUP_IN_LEVEL`** — a Level could not lose its last group. **Retired.**
  Deleting a group that still holds students stays refused by the rule that
  actually protects people, `ENROLMENTS_EXIST`; an empty group may now be deleted
  even when it is the last, leaving the Level directly enrollable.

**Consequence, and it is the point:** the eighteen live Levels that have no group
stop being a defect. They become ordinary Levels that nobody has needed to
subdivide, students can be enrolled in them, and the approval queue's dead end
disappears at its root rather than being filtered around in the interface.

## 66.5 — Placement, approval and delivery

* **Approval places a student in a Level, optionally naming a group.** §4.1's
  rule is unchanged — *"an approved account with no enrollment is a person the
  platform admitted and then lost"* — but the placement it demands is now *a
  Level and a branch*, with a group only where one exists. The approver is
  therefore never blocked by a missing group.
* **`entire_level` resolves by `Enrollment.branch_id`**, not by the group's. The
  clause's meaning is unchanged — *that Level's students at this schedule's
  branch* — and it now answers correctly for ungrouped students instead of
  omitting them.
* **`administrative_group` and `teaching_group` modes are unchanged.**
* **Grades keep `administrative_group_id` as sitting provenance (R43).** It is
  **already nullable** and stays so, for the same reason the enrolment's now is:
  a student who sat an exam while in no group has no group to record, and
  inventing one would be a fabricated record. Verified, not assumed.

## 66.6 — Migration (TD-6b, expand → backfill → contract)

Non-destructive, and every value is **derived from data that already exists**:

1. **Expand** — add `enrollment.branch_id` as nullable; make
   `administrative_group_id` nullable.
2. **Backfill** — `branch_id` from the row's own
   `administrative_group.branch_id`. Every existing enrolment has a group, so
   every row gets a value; the statement is a single `UPDATE … FROM`.
3. **Contract** — `branch_id` `SET NOT NULL`, and add the composite FK.

No row is deleted, no column is dropped, and the old
`(administrative_group_id, level_id)` FK stays exactly as it is — still correct,
and now null-safe for ungrouped enrolments by the same PostgreSQL rule.

## 66.7 — Audit against the live architecture

| Claim | Status |
|---|---|
| `Enrollment` already carries `level_id`, so a Level is not derived | **[CODE]** `schema.prisma` |
| `administrative_group_id` is NOT NULL today | **[CODE]** `schema.prisma` |
| A student's branch is read through the group at 13 sites | **[CODE]** grep across `backend/src` |
| §5.2 and R43.3 both name that one path | **[SRS]** §5.2, Revision 43.3 |
| A composite FK with a NULL column is not enforced in PostgreSQL | **[INFER]** MATCH SIMPLE, the default — the same behaviour R43's existing composite FK already has |
| §7 already makes Teaching Groups optional in the identical way | **[SRS]** §7 |
| 18 of 20 live Levels have no group | **[CODE]** measured against the running database |
| `ENROLMENTS_EXIST` already refuses deleting a group with students | **[CODE]** `administrative-group.service.ts` |

**No new entity, no new concept, no change to authorization.** Branch-scoped
authority reads the same fact from a column instead of a join.
