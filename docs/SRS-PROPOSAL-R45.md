[Documentation](README.md) › **SRS proposal — Revision 45**

# Draft SRS Revision 45 — one endpoint, role-scoped

> **Status: PROPOSED. Not in force.** `docs/SRS.md` is immutable to implementing agents;
> this file is a drafted revision for the **Document Owner** to apply, amend or reject.
> **Delete it once that decision is made.**
>
> **The behaviour it describes is already implemented and shipped** (2026-08-05), on the
> Document Owner's explicit instruction. This proposal exists because that instruction was
> *"if you believe the SRS should explicitly state this behavior, record it as a documentation
> proposal"* — the code is not waiting on it.

---

## What was decided

`GET /admin/course-schedules` is **role-scoped internally** rather than duplicated per
audience:

| Caller | Sees |
|---|---|
| Super Admin | Every schedule |
| Branch Admin | Schedules in their branches |
| **Teacher** | **Exactly the schedules they staff** (`CourseScheduleStaff`, §4.4c) |
| Anyone else | `403 FORBIDDEN` |

`GET /admin/course-schedules/{id}/roster` follows the same rule, which §5.6 line 753 already
grants a teacher. **`POST`, `PATCH`, `DELETE` and `/conflicts` remain Admin**, because §14.1
states that teachers *"do not create or edit schedules"*.

## Why the SRS should say so

Three sentences in the specification are each individually true and, read together, leave a
reader unable to answer *"may a Teacher call this?"*:

- **§14.1** defines `/teacher/schedules` — *"the Recurring Course Schedules this teacher staffs
  … and roster access to its resolved audience"*.
- **TD-3.12** lists `GET /admin/course-schedules` and no teacher-facing equivalent.
- **Revision 30** says teachers receive information *"only through the operational APIs they
  are authorised to use — Groups, assignments, schedule"* — naming a schedule API without
  saying which.

An implementer reading only TD-3.12 concludes the teacher screen has no endpoint. An
implementer reading only §14.1 concludes it must. **Both readings are defensible, and that is
the defect** — the same class §20 rule 20 exists to catch.

## Exact wording to apply

Two edits.

### 1. New entry in §0, after Revision 44 (or after 43.6 if 44 is not applied)

> **Revision 45 (Document Owner decision — `/admin/` is a routing namespace, not an
> authorization boundary, 2026-08-05):** the specification says in a dozen places that the
> `/admin/` prefix *authenticates but does not authorise*, and then leaves one question
> unanswered: §14.1 defines a Teacher screen listing *the Recurring Course Schedules this
> teacher staffs*, TD-3.12 documents `GET /admin/course-schedules` and nothing else, and
> Revision 30 promises teachers reach *"schedule"* through an operational API it does not name.
> An implementer reading TD-3.12 alone concludes the screen has no endpoint; one reading §14.1
> alone concludes it must have one. Both readings were defensible.
>
> **The resolution is scope, not a second route.** `GET /admin/course-schedules` and
> `GET /admin/course-schedules/{id}/roster` are **role-scoped in the service**: Super Admin
> sees every schedule, a branch Admin sees their branches, and a **Teacher sees exactly the
> schedules they staff**, resolved through `CourseScheduleStaff` (§4.4c — the single teacher
> scope resolution). Any other caller is refused.
>
> **A duplicate endpoint was rejected, and the general rule is stated here because it will
> recur:** *prefer one endpoint with role-scoped data over several returning the same resource;
> a second route is justified when the resource or the behaviour genuinely differs, never
> merely because the consumers hold different roles.* Two routes returning a byte-identical
> representation are duplication rather than separation, and the copy is what drifts.
>
> **Reading is not managing.** `POST`, `PATCH`, `DELETE` and `/conflicts` stay Admin, because
> §14.1 is explicit that teachers *do not create or edit schedules*. Widening the read did not
> widen the write, and that distinction is the point of scoping by role rather than by route.
>
> **Two consequences worth stating**, both because they are easy to get wrong: a Teacher who
> staffs nothing receives an **empty list, not `403`** — they may ask the question and their
> scope resolves to nothing, which is a different fact from being refused; and an explicit
> `branch_id` filter can **narrow** a caller's reach but never widen it, because the filter and
> the scope must both hold.

### 2. TD-3.12 — amend the two read lines

> `GET /admin/course-schedules` — **role-scoped (R45):** Super Admin all; Admin within branch
> scope; **Teacher, the schedules they staff (`CourseScheduleStaff`, §4.4c)**. `POST` remains
> Admin.
>
> `GET /admin/course-schedules/{id}/roster` — the resolved audience, never a snapshot;
> **role-scoped exactly as the list is (R45)**, which is the roster access §5.6 grants a
> teacher for a schedule they staff. A schedule they do not staff is `404`, never `403`
> (§20 rule 17).

---

## Consistency check

| Touched | Effect |
|---|---|
| §0 | One new entry |
| TD-3.12 | Two read lines amended; the write lines unchanged |
| TD-2 | **Unchanged** — the matrix's *manage* rows still exclude Teacher, which is what the implementation does |
| §14.1, §5.6 | **Unchanged** — this makes their existing sentences reachable rather than altering them |
| §20 rule 16 | **Unchanged and respected** — no endpoint was invented |

**If this revision is rejected, the implementation must change**, unlike the R44 proposal: the
behaviour is live. Rejecting it means either restoring Admin-only reads and re-blocking the
teacher screen, or adding a documented teacher endpoint to TD-3.12.

---

**Related:** [API endpoints](reference/api-endpoints.md),
[Engineering efficiency](development/engineering-efficiency.md)
