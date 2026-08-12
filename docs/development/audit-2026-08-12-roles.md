[Documentation](../README.md) › **مؤطرات, responsibilities and scope — audit**

# Roles vs responsibilities — can the model represent the association's domain?

**Status: audit only. Nothing implemented. One SRS revision identified as
genuinely required — awaiting Document Owner approval.**

The Document Owner's clarification (2026-08-12):

> مؤطرة = any non-beneficiary person working with the association · مستفيدة =
> the person receiving the service. A مؤطرة may hold several responsibilities at
> once — teaching, assisting, administration, organising, being the main
> responsible for an event, assisting the responsible person. **Do not model
> Teacher / Teacher Assistant / Admin as mutually exclusive job identities.**
> The separation should be **Person → responsibilities/capabilities → scope**.

---

## 1 — How the SRS models مؤطرات and roles

Two layers, already distinct:

**Capability — `Role` + `UserBranchRole`.** `Role` is a seeded set
(`super_admin, admin, teacher, student, parent`) with **no CRUD** in the MVP
(R26). `UserBranchRole (user_id, role_id, branch_id)` is a **join table** with
`@@unique([user_id, role_id, branch_id])` and a nullable `branch_id` meaning *all
branches*.

**Responsibility on one assignment — the `*Staff` tables.** `position` lives on
the assignment, never on the person:

| Table | Position enum | Added by |
|---|---|---|
| `CourseScheduleStaff` | `teacher \| assistant` | R43(8) |
| `SessionStaff` | `teacher \| assistant` | R43 |
| `ExamStaff` | `supervisor \| assistant` | R58 |

**Scope — §4.4c, stated once.** *"A Teacher's scope is derived from the schedules
they staff"*, and `schedule.branch_id` states their branch scope directly.
`policies/roster-resolution.ts` is its single implementation.

## 2 — Does the model already support multiple responsibilities?

**Yes — and it is already the Person → capability → scope shape asked for.**

* **Roles are not exclusive.** §2.1 says so in as many words: *"A single person
  may hold multiple roles concurrently (e.g., a mother who is both a Student and
  a Parent), switching context via an account switcher in the header."*
  Revision 60 built the Active Role on top of that, as a **safety** mechanism
  rather than containment.
* **Each capability already carries its own scope.** `branch_id` sits on the
  *assignment row*, not on the person — so one مؤطرة can be Admin at one branch
  and hold the teaching capability elsewhere. That is exactly *"each capability
  may have its own scope"*.
* **Assisting is already a position, not a job.** There is deliberately **no
  `assistant` Role**: R43(8) introduced `CourseScheduleStaff` precisely to give
  assistants *"a home without inventing a Role"*. The same person is `teacher` on
  one schedule and `assistant` on another, with no contradiction.
* **Staffing does not require the teacher role.** The validator takes any
  `user_id` plus a position; nothing asserts the person holds `teacher`. Role and
  staffing answer different questions — *what may this person do* and *where*.

**The one place the association's language and the schema disagree is a label,
not a structure:** the enum value is spelled `teacher`, which reads as a job
title. It is a *position on one schedule*, which is what the domain calls it.

## 3 — Where teacher / assistant / admin are used today

| Used as | Where |
|---|---|
| **Capability** | `Role`, `UserBranchRole`, TD-2's matrix, `policies/branch-scope.ts` (`hasRole`, `isSuperAdmin`, `branchesForRole`), every service assertion |
| **Responsibility on one assignment** | `CourseScheduleStaff`, `SessionStaff`, `ExamStaff` |
| **Scope derivation** | `policies/roster-resolution.ts` (§4.4c) — `studentsTaughtBy`, `teacherBranchIds`, `teacherEventScope`, `assertExamInTeacherScope` |
| **Presentation** | the role switcher, `/admin/users`, the teacher portal registry |

## 4 — Does the clarification conflict with the SRS?

**On the model: no conflict.** Every element of the intended separation is
already specified and implemented. Nothing needs redesigning, and the
authorization system must not be rebuilt to say what it already says.

**On coverage: one real gap.**

> **`Event` has an audience but nobody responsible for it.**

`Event` carries four audience joins — `EventBranch`, `EventCategory`,
`EventLevel`, `EventAdministrativeGroup` — and **no staff table at all**. There
is no `EventStaff` in the schema, the code or the SRS, and no
responsible/organiser concept anywhere. So *"a main responsible مؤطرة and one or
more assistant مؤطرات for a celebration"* **cannot be recorded**.

**The consequence is an authorization one, not merely a missing field.** TD-2
grants *"Schedule/edit Events — Teacher ✔ (own scope)"*, and that scope resolves
through `teacherEventScope`, which derives **from teaching schedules**. A مؤطرة
who is responsible for a celebration but teaches nothing therefore has **empty
event scope** and can schedule nothing — which is precisely the domain case the
Owner describes, and the model cannot express it.

**On terminology: two defects, both real, neither needing a revision.**

1. **Two role dictionaries that disagree**, for the same concept:

   | Key | Role switcher | `/admin/users` |
   |---|---|---|
   | `teacher` | **مؤطِّرة** | **أستاذة** |
   | `super_admin` | مشرف عام *(masculine)* | مديرة عامة |

   One source of truth per concept; these are two, and they have drifted.

2. **«طالبة/طالبات» survives in 9 places** against 28 uses of
   «مستفيدة/مستفيدات» — including the role label, the student-dashboard title,
   a Levels column header, and **the privacy notice**, which is text a family
   reads before consenting.

**The SRS is silent on the beneficiary's Arabic name** — it says *Student*
throughout and contains «مستفيد» zero times, while using «مؤطرة» eight times. So
«مؤطرة» is already the SRS's own word, and «مستفيدة» is a UI convention this
handbook should record. **Neither needs an SRS revision**; both are i18n fixes
plus a note in the handbook.

## 5 — The smallest coherent change

**One table, mirroring two that already exist.**

```
EventStaff (event_id, user_id, position)
    position: responsible | assistant
    @@unique([event_id, user_id])          one person, one position, one event
    deleted_at / deleted_by                 tombstoned like ExamStaff (R59)
```

* **Shaped exactly like `ExamStaff` and `CourseScheduleStaff`**, including R59's
  rule that these rows are tombstoned and revived rather than hard-deleted, and
  that reconciliation is an *update* and earns no Trash entry.
* **A new enum rather than reusing `ScheduleStaffPosition`**, because
  `teacher | assistant` would call the person responsible for a celebration a
  teacher — the conflation §20 rule 22 exists to prevent, and the reason
  `ExamStaffPosition` is already separate.
* **Event scope for a مؤطرة becomes a union**: the events they staff **∪**
  `teacherEventScope`'s existing derivation. One added arm in
  `roster-resolution.ts` — **not** a parallel authorization system.
* **No new Role, and no change to `UserBranchRole`.** Responsibility for an event
  is a position on that event, exactly as teaching is a position on a schedule.

**What this requires from the Document Owner**, because it is a new entity, a new
enum and a new TD-2 row:

| Change | Section |
|---|---|
| `EventStaff` + `EventStaffPosition` | §7 |
| Who may be assigned, and who may assign | TD-2 (one row) |
| Event responsibility as event scope for a مؤطرة | §4.4 / §4.4c pointer |
| `event.staff_change` or reuse of `event.update` | TD-8 |

**Deliberately NOT proposed:** no capability table, no per-capability permission
engine, no renaming of `Role`, no `assistant` role, and no change to §4.4c's
derivation for teaching — all of which the current model already handles.

---

## Terminology, recorded for the handbook

| Use | Not |
|---|---|
| **مؤطِّرة** — any non-beneficiary person working with the association | معلمة · أستاذة |
| **مستفيدة / مستفيدات** — the person receiving the educational service | طالبة · طالبات |

Both are the association's own words. The first is already §2.1's; the second is
a convention this document records because the SRS names the beneficiary only in
English.
