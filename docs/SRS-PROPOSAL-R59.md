# SRS Revision 59 — proposal

**Title:** Deletion authority across the platform: every deliberate deletion reaches
the Trash, and permanent deletion exists as a Super Admin action

**Status:** proposed for the Document Owner
**Supersedes:** the closing paragraph of Revision 52 and its restatement in
Revision 53 and §5.6
**Author:** implementation session, 2026-08-09

---

## Why a revision is required at all

Revision 52 closes with a sentence that is normative and unambiguous:

> **No permanent-delete action exists, and none may be added without a further
> revision.**

Revision 53 restates it for content, and §5.6 restates it for the UI. The
Document Owner has now directed that *"only Super Admin can permanently delete a
soft-deleted item"*. That is a capability the specification currently forbids, so
it cannot be implemented as a detail — this revision is the *further revision*
Revision 52 asked for.

Everything else in the Owner's rule is already the specification. What follows
records the parts that are **restated for clarity** separately from the one part
that is genuinely **new**, because conflating them is how a document grows a
second home for a rule.

---

## 59.1 — Permanent deletion becomes a Super Admin action (NEW)

**`DELETE /admin/trash/{id}` destroys a soft-deleted record and its cascade
children irreversibly.** Super Admin only, asserted in the service against live
role rows — the `/admin/` prefix is not the boundary (TD-2, unchanged).

**Why the Revision 52 reasoning does not survive contact with the Owner's rule.**
That reasoning was: *a manual "delete now" would bypass a retention rule that
exists for legal and safeguarding reasons.* Two things about it were true and one
was not.

* True: destruction is a data-retention decision, not a convenience. It stays
  restricted to the one role that holds the platform's data authority, it is
  audited, and no other role can reach it under any circumstance.
* True: BR-15's ninety-day window remains the **default** path. Nothing about
  this revision shortens it for records nobody acts on.
* Not true: that the window can only be *bypassed* and never *exercised
  deliberately*. A safeguarding request to erase a person's data **now** is
  itself a legal obligation, and a platform whose only erasure path is "wait
  ninety days" cannot honour one. The retention rule protects against
  *accidental and unaccountable* destruction, which an audited Super-Admin-only
  action with an explicit confirmation is not.

**What it does not change.** BR-15's snapshot obligation, the ninety-day window,
the per-entity restore proof, the cascade guards, and the prohibition on any
*other* role destroying anything are all unchanged and remain binding.

**Refusals are loud and coded**, on the same principle as restore:

| Reason | Meaning |
|---|---|
| `DEPENDENTS_EXIST` | A live row still references it. Destruction would either orphan or cascade past what the entry describes; the referencing record is named. |
| `NOT_YET_SUPPORTED` | No destruction plan is written for this entity type. A type joins the purgeable set when its destruction is written and tested, never by inference. |
| `ALREADY_PURGED` | The record is gone; only the tombstone remains. Deleting the entry alone is permitted and is what the caller receives. |

**Destruction is complete or it does not happen.** It runs in one transaction:
the cascade children declared for the type, then the record, then the Trash
entry, then the `trash.permanent_delete` audit row. A partial destruction is the
one outcome that would leave the platform unable to say what was removed.

**An `EducationalContent` purge also removes its quarantined object.** The bytes
are the point of that entity; destroying the row and leaving the object is not a
deletion, it is an orphan nobody can find or reach.

---

## 59.2 — Every deliberate deletion reaches the Trash (RESTATEMENT + gap closure)

BR-15 already says *all deletions are soft with a restorable snapshot*. This
revision does not change the rule; it records that **four deletions did not obey
it** and states the test that distinguishes an obligation from a non-obligation,
because the absence of that test is what let the four through.

**The test: a deletion a person deliberately performed gets its own Trash entry.
Rows removed as a consequence of that deletion do not — they are described by the
parent's snapshot.** A `Session` removed because its schedule was deleted is part
of what the schedule's tombstone records. A `Room` deleted on its own is a
deletion.

By that test these four were defects, and are corrected:

| Deletion | Entity | Was |
|---|---|---|
| Un-enrolling a student from a group | `Enrollment` | Audited, no snapshot |
| Removing a student from a Teaching Group | `StudentTeachingGroup` | Audited, no snapshot |
| Unassigning a Subject from a Level | `LevelSubject` | Audited, no snapshot |
| Unlinking content from a Session | `SessionContent` | Audited, no snapshot |

**One of the four was a recorded DECISION, not an oversight.**
`trash-coverage.integration.test.ts` carried an explicit exemption for
`enrollment.service.ts`, reasoning that *un-enrolment is a membership ending, not
a record being deleted; there is nothing to restore that re-enrolling does not do
properly.* That was a defensible reading of TD-5, which soft-deletes the enrolment
row and leaves every academic record intact — so it is **reversed by the Owner's
rule, not corrected as a bug**. §7's restore runbook had already named
`Enrollment` among the rows a restoration must reinstate, rows it could not have
found. The other three were genuine oversights.

**A fifth, of a different kind:** replacing an exam's supervising staff
**hard-deleted** `ExamStaff` rows that carry `deleted_at`. Under TD-5 a row with
that column is never destroyed by an ordinary write, and the hard delete also
broke 59.3's restore — a restored exam could not say who had been supervising it.
It now reconciles exactly as `SessionStaff` and `UserBranchRole` do: tombstone
what is no longer wanted, revive what returns. It gets **no** Trash entry, for
the reason stated immediately below.

Each is a deliberate act by an Admin or a Teacher, each was invisible to the one
screen that exists to answer *what was deleted and by whom*, and §7's runbook
names `Enrollment` and `StudentTeachingGroup` explicitly among the rows a
restoration must reinstate — rows it could not have found.

**Not defects, and stated so they are not "fixed" later:** `SessionStaff`
reconciliation during a session edit, and `UserBranchRole` revocation during a
role change. Neither is a deletion; both are one field of an *update* expressed
as a tombstone, and giving each a Trash entry would fill the screen with rows no
administrator deleted.

---

## 59.3 — `Exam` joins the restorable set (NEW, narrow)

R58's deletion cascades to exactly one child table, `ExamStaff`, whose
reinstatement is a single well-defined statement. Restoring an exam therefore
reinstates the staff removed with it, and the type moves from
`NOT_YET_SUPPORTED` to restorable under the existing standard — *written and
tested, not inferred*.

No other type moves. The rest stay refused with their reasons.

---

## 59.5 — A recorded Hijri month can be withdrawn (NEW, narrow)

`HijriMonthStart` is the **only** entity a Super Admin can create through the
platform that had **no deletion at all**. It carries `deleted_at` already, every
read filters on it, and nothing could ever set it — a month recorded by mistake
was permanent.

**`DELETE /admin/hijri-calendar/{year}/{month}`** — Super Admin only, TD-15
version required, soft delete with a `Trash` snapshot like every other deletion.

**It refuses to punch a hole in a recorded run** (`LATER_MONTH_RECORDED`). The
months form a contiguous sequence and §5.7's conversion walks it; withdrawing one
from the middle would leave a span the platform cannot convert, reported as
missing data rather than as the deletion that caused it. Only the **last**
recorded month may be withdrawn, which is the ordering invariant `assertOrdered`
already enforces on writes, applied to removal.

**Publication is not a separate obstacle.** A published month may be withdrawn by
the same rule — §5.7 already treats a correction as returning the month to
`draft`, so removal is the stronger form of a correction the specification
permits, and a hole is refused whether or not the month was visible.

**Restorable and purgeable**, both: the deletion cascades to nothing, so
reinstatement is clearing the tombstone and destruction is one row.

---

## 59.4 — What this revision does NOT do

**It does not implement `content.quarantine-purge`.** Revision 52 and Revision 53
both assert that BR-15's ninety-day window *is enforced by* that TD-7 job. **No
such queue and no such worker exist** — `purge_after` is written on every
tombstone and nothing has ever read it. The window is therefore documented,
depended upon in two revisions, and **not in force**.

This is recorded here as a finding rather than closed, because switching on
automatic destruction of production records is a decision for the Document Owner
and not a consequence of adding a manual action. Until it ships, permanent
deletion is **exclusively** the deliberate Super Admin action in 59.1.

---

## Text changes

**Revision 52, final paragraph** — replaced:

> ~~**No permanent-delete action exists, and none may be added without a further
> revision.**~~ **Superseded by Revision 59.1**: permanent deletion exists as a
> Super Admin action, `DELETE /admin/trash/{id}`, audited and refused loudly
> where dependencies remain. BR-15's ninety-day window remains the default path
> and is unchanged.

**§5.6, Trash UI bullet** — *"Permanent deletion from the UI does not exist and
requires its own revision"* → *"Permanent deletion is a Super Admin action
(Revision 59.1); no other role sees it or can reach it."*

**Revision 53** — the trailing *"No permanent-delete route, consistent with
Revision 52"* gains *"superseded by Revision 59.1; a content purge also removes
the quarantined object."*
