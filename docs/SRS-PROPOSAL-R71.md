[Documentation](README.md) › **SRS proposal — Revision 71**

# Draft SRS Revision 71 — an event has somebody responsible for it

**Status: authorised by the Document Owner (2026-08-12).** The audit
([`audit-2026-08-12-roles.md`](development/audit-2026-08-12-roles.md)) found the
role model already correct and one gap: an `Event` carries four audience joins
and **nobody responsible for it**.

> *"For events such as celebrations, the concept is a main responsible مؤطرة and
> one or more assistant مؤطرات."* · *"Event responsibility grants event scope on
> its own."* · *"Do not create a new Role or parallel authorization system."*

---

## 71.0 — What does NOT change, because the audit found it already right

* **Roles are not job identities and never were.** §2.1: *"A single person may
  hold multiple roles concurrently … switching context via an account switcher"*.
  `UserBranchRole` is a join, unique per `(user, role, branch)`, so **each
  capability already carries its own scope**.
* **Assisting is already a position on an assignment, not a role.** R43(8)
  introduced `CourseScheduleStaff` precisely to give assistants *"a home without
  inventing a Role"*. **No `assistant` Role is created here either.**
* **§4.4c's teaching derivation is untouched.** Educational scope keeps resolving
  from the schedules a مؤطرة staffs, and this revision adds nothing to it.
* **The `teacher` enum value keeps its spelling.** It names a *position on one
  schedule*, and renaming a stored value to improve a label would be a migration
  paying for presentation.

## 71.1 — `EventStaff`, shaped like the two that already exist

```
EventStaff (event_id, user_id, position)
  position        EventStaffPosition — responsible | assistant
  @@unique([event_id, user_id])     one person holds one position on one event
  created_at, deleted_at, deleted_by
```

Identical in shape to `ExamStaff` (R58) and `CourseScheduleStaff` (R43), **and
identical in lifecycle to `ExamStaff` under Revision 59**: staff are reconciled
by **tombstoning what is no longer wanted and reviving what returns**, never
hard-deleted — the `@@unique` pair is not filtered on `deleted_at`, so an insert
would be refused. Reconciliation is one field of an *update* expressed as a
tombstone and therefore earns **no Trash entry**, exactly as R59 states for
`SessionStaff` and `UserBranchRole`.

**A new enum rather than reusing `ScheduleStaffPosition`.** `teacher | assistant`
would call the مؤطرة running a celebration a *teacher*, which is the conflation
§20 rule 22 exists to prevent — and it is the same reason `ExamStaffPosition`
was given its own values rather than borrowed.

## 71.2 — Responsibility grants event scope on its own

**The gap this closes is an authorization one.** TD-2 grants a Teacher
*"Schedule/edit Events (own scope)"*, and that scope resolves through
`teacherEventScope`, which derives **from teaching schedules**. A مؤطرة
responsible for a celebration who teaches nothing therefore had **empty event
scope** and could manage nothing — the exact case the association describes.

**Event scope becomes a union, in the module that already owns the derivation:**

```
events a مؤطرة may reach
    = events she staffs through EventStaff          ← new
    ∪ events her §4.4c teaching scope reaches       ← unchanged
```

**Added as one arm to `policies/roster-resolution.ts`, not as a second
resolver.** §4.4c is the single definition of what a member of staff may reach;
a parallel answer is the drift this document keeps paying for.

## 71.3 — What each position may do

The existing `*Staff` tables record a position that **no authorization reads** —
`staffsSession` counts co-teachers and assistants identically, because both
deliver the same class and R43 deliberately gave them one rule.

**An event is asymmetric where a class is not**, and this revision follows the
association's own words: there is **one main responsible** مؤطرة, and *responsible*
means answerable. So position is authorization-bearing here, and the divergence
from the schedule convention is stated rather than left to be discovered:

| | See the event, Hidden included | Edit its attributes | Assign its staff | Delete it |
|---|---|---|---|---|
| **responsible** | ✔ | ✔ | ⊘ | ⊘ |
| **assistant** | ✔ | ⊘ | ⊘ | ⊘ |
| Admin (own branches) / Super Admin | ✔ | ✔ | ✔ | ✔ |

**Assigning staff is Admin and above.** Being answerable for an event is not
authority to decide who else answers for it — and allowing it would let a مؤطرة
with momentary edit rights make herself permanently responsible. **The one
exception is structural, not a grant:** a مؤطرة who *creates* an event is
recorded `responsible` for it **in the same transaction**, because creating it
is what makes her answerable.

**Deletion stays Admin and above**, for the reason R70.4 gave about exams:
`Event` carries no `created_by`, so *"her own but not another person's"* is not
expressible against this schema, and **no column is added to make it sayable**.

**Creation scope is unchanged.** A مؤطرة still may not scope an event to a
branch, category, level or the Global scope, and still must name groups she
teaches (TD-2, §4.9). A مؤطرة with no teaching scope therefore cannot conjure an
event from nothing — **an Admin creates it and names her responsible**, which is
how the association actually assigns the work.

## 71.4 — TD-2 gains one row; TD-8 gains one action

| Row | Super Admin | Admin | Teacher / مؤطرة |
|---|---|---|---|
| **Assign event staff — responsible and assistants** | ✔ | ✔ (own branches) | ⊘ |

`event.staff_change` joins TD-8, detail *event, positions assigned*. It is a
distinct decision from `event.update` — *who answers for this celebration* is
not an attribute edit — and, like every non-`auth.*` type, Revision 19's
allowlist keeps it out of `audit.purge`.

## 71.5 — Deliberately NOT in this revision

* **No new Role, and no capability table.** The audit found the Person →
  capability → scope separation already implemented.
* **No change to §4.4c's teaching derivation**, to `UserBranchRole`, or to any
  educational authorization.
* **No `created_by` on `Event`.**
* **No renaming of the `teacher` position value.**
* **No event-scope editing on update** — §4.4's rule that the four join tables
  are populated at creation, with backfill as the one sanctioned later path, is
  untouched.

## 71.6 — Audit against the live architecture

| Claim | Status |
|---|---|
| `Event` has four audience joins and no staff table | **[CODE]** `schema.prisma` |
| No responsible/organiser concept exists anywhere | **[CODE]**, **[SRS]** — zero matches |
| `position` is recorded but authorization-blind today | **[CODE]** `staffsSession`, `roster-resolution.ts` |
| A teacher's event scope derives from teaching schedules only | **[CODE]** `teacherEventScope` |
| Event editing already gates on that scope | **[CODE]** `event.service.ts` |
| Event deletion is already Admin-only | **[CODE]** `event.service.ts` |
| `ExamStaff` is tombstoned and revived, with no Trash entry | **[SRS]** R59; **[CODE]** `exam.service.ts` |

---

**One table, one enum, one union arm, one TD-2 row, one TD-8 action. No new
Role, no parallel authorization, and no change to educational scope.**
