[Documentation](../README.md) › [Overview](README.md) › **Users and roles**

# Users and roles

## The six user classes

| Role | Arabic | Who | Can do |
|---|---|---|---|
| Super Admin | — | System owner | Everything; sole manager of reference data (branches, rooms, levels, categories, subjects, academic year, settings, display order, official Hijri calendar) |
| Admin | — | Branch coordinator | Operational work in assigned branches: users, approvals, groups, enrolments, content, events, consent overrides; reads reference data only |
| Teacher | مؤطِّرة | Instructor | Assigned groups: Quran progress, exams, teaching materials, events |
| Student | — | Adult learner or minor's record | Own schedule, progress, resources, published grades; online exams |
| Parent | — | Guardian | Linked children's data; login vehicle for minors |
| Pending | — | Registered, not approved | Nothing: status screen and public tier |

- One person may hold several roles (Student + Parent is common) and switches context in the header.
- Normative matrix: SRS TD-2 ([Technical design § TD-2](../reference/technical-design.md#td-2)).

## Access is scoped by branch, and only by branch

- Assignment = (user, role, branch); same role may repeat once per branch; `NULL` branch = all branches for that assignment, not "unscoped Super Admin" (R24 bug).
- Scope resolves per role, never as a union across roles (Teacher @ Casablanca + Admin @ Marrakesh ≠ Admin @ Casablanca).
- Super Admin bypass is a property of the role, not of a null scope.
- Teacher role grants access to nobody; teaching access resolves only through staffed schedules (`CourseScheduleStaff`), branch stated on the schedule; assistants live in the same table, so no assistant role.
- Category and Level scoping are reserved, not forbidden; functional responsibilities (Tajweed, literacy, events) are capabilities, not scopes.
- Generic `scope_type`/`scope_id` prohibited absent demonstrated need (no foreign key, no referential integrity).

> SRS §4.2 · R24, R25 · [Identity and access](../architecture/identity-and-access.md#authorization)

## Reference data versus operational data

| | Reference / configuration | Operational |
|---|---|---|
| What | Branches, rooms, levels, categories, subjects, academic year, settings, display order, Hijri calendar | Users, approvals, groups, teacher assignments, enrolments, Quran progress, exams, content, events |
| Changes | Rarely | Constantly |
| Who writes | Super Admin only | Admin, within branch scope |
| Who reads | Super Admin; Admin for their branches | Per the matrix |

- Branch creation is organisational (R26); it cannot be scope-checked before the branch exists.
- Teachers never browse reference data (R30); they receive branch/room/level via their operational APIs.
- Routes stay under `/admin/*`; permission is server-side; `/superadmin/*` rejected as churn.

## Minors have no account

- A minor is a `User` row with no identity record; reachable only (1) through an approved parent link or (2) through a staff role.
- Parent authenticates as herself and sends `X-Active-Child-ID` on every request; server verifies an `Approved` link matching both parent and child.
- Revocation is instant (checked per request, not baked into a token); client switching is presentation only; every failure returns `404` (no such child, not yours, pending, rejected, deleted) so children cannot be enumerated.
- Adult students bypass the header; verified against the token subject; the bypass never applies to a parent-only caller.

> SRS §4.3 · [`BR-5`](../reference/business-rules.md#br-5) · [Identity and access](../architecture/identity-and-access.md#child-context)

## Sensitive records: need to know

- Minors' case-file data (health, family situation, parents' names/professions, siblings, address) is restricted to Admins, Super Admins and the student's own assigned teachers.
- Not to other teachers, students, or guardians including the child's own linked parents (R28 removed the "unrelated" qualifier).
- Field-level, not page-level; reads are audited as well as writes.

> [`BR-16`](../reference/business-rules.md#br-16) · SRS §4.10 · R28

## Pending means nothing

- Only `GET /me` and logout answer a Pending session; the client hard-redirects before any authenticated route renders.
- Both layers tested independently; client guard is UX, server denial is the boundary.

> [`BR-4`](../reference/business-rules.md#br-4) · SRS TD-1, §14.4

**Next:** [Business processes](business-processes.md) · **Related:** [Identity and access](../architecture/identity-and-access.md), [Technical design § TD-2](../reference/technical-design.md#td-2)
