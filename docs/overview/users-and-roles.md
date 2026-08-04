[Documentation](../README.md) › [Overview](README.md) › **Users and roles**

# Users and roles

## The six user classes

| Role | Arabic | Who they are | What they can do |
|---|---|---|---|
| **Super Admin** | — | The association's system owner | Everything. Sole manager of reference data: branches, rooms, levels, categories, subjects, the academic year, system settings, display ordering, and the official Hijri calendar |
| **Admin** | — | A branch coordinator | **Operational** work within their assigned branches: users, approvals, groups, enrolments, content, events, consent overrides. Reads reference data; cannot change it |
| **Teacher** | مؤطِّرة | An instructor | Works with their **assigned groups**: logs Quran progress, authors and marks exams, uploads teaching materials, schedules events |
| **Student** | — | An adult learner, or a minor's record | Views their own schedule, progress, resources, and published grades. Takes online exams |
| **Parent** | — | A guardian | Views linked children's data; acts as the login vehicle for minors |
| **Pending** | — | Registered, not yet approved | **Nothing.** A status screen and the public tier — no application data at all |

A single person may hold **several roles at once** — a mother who is both a Student and a
Parent is the common case — and switches context in the header.

> Normative matrix: SRS **TD-2**, indexed at
> [Technical design § TD-2](../reference/technical-design.md#td-2).

## Access is scoped by branch, and only by branch

This is the one axis of authorization in the system, and getting its shape right took
several revisions.

A role assignment is a triple: **(user, role, branch)**. A person can hold the same role
several times, once per branch. The branch may also be `NULL`, which means **all branches
for that assignment** — not "unscoped Super Admin", which is a distinction that caused a
real bug (Revision 24).

**Scope resolves per role, never as a union across roles.** A Teacher in Casablanca who is
also an Admin in Marrakesh does **not** thereby administer Casablanca. Unioning the
branches a person can reach through *any* role silently extends one role's authority to
another role's territory — which is exactly what the implementation did until Revision 24
caught it.

Super Admin's bypass is a property of **the role**, not of a null scope.

```
Fatima
├── Teacher  @ Marrakesh-Amerchich   → teaches only her assigned groups there
├── Teacher  @ Marrakesh-Targa       → teaches only her assigned groups there
└── Admin    @ Marrakesh-Amerchich   → administers Amerchich only
                                        (NOT Targa — different role, different scope)
```

**A teacher's reach is narrower still.** Holding the Teacher role does not grant access to
anyone. Teaching access resolves **exclusively** through the course schedules a person
staffs (`CourseScheduleStaff`), so a teacher sees the students of the courses they actually
teach and no others — and their branch scope is stated directly on the schedule rather than
inferred. The same table holds assistants, which is why there is no separate assistant role.

**What is deliberately not a scope.** Category and Level scoping are *reserved for future
revisions*, not forbidden — a category-wide administrator is anticipated. Functional
responsibilities (Tajweed, the literacy curriculum, events) are **capabilities**, not
scopes, and arrive as permissions without touching this model. A generic
`scope_type`/`scope_id` framework is prohibited absent a demonstrated need, because a
polymorphic scope column cannot carry a foreign key and would forfeit the referential
integrity every other relation relies on.

> SRS §4.2 · Revisions 24, 25 · [Identity and access](../architecture/identity-and-access.md#authorization)

## Reference data versus operational data

Revision 26 introduced a split that explains most "why can't an Admin do this?" questions:

| | **Reference / configuration** | **Operational** |
|---|---|---|
| What | Branches, rooms, levels, categories, subjects, academic year, system settings, display order, the Hijri calendar | Users, approvals, groups, teacher assignments, enrolments, Quran progress, exams, content, events |
| Changes | Rarely — it defines the shape of the organisation | Constantly — it is the daily work |
| Who writes | **Super Admin only** | **Admin**, within branch scope |
| Who reads | Super Admin, and Admin for their branches | Per the matrix |

The reasoning: creating a branch is an *organisational* decision, not a coordinator's. It
also removed an incoherence — branch creation could not be scope-checked, since no branch
yet exists to check against, and it produced a branch its own creator then could not see.

**Teachers do not browse reference data at all** (Revision 30). They receive branch, room,
and level information through the operational APIs they are authorised to use — their
groups, their schedule — never by querying reference endpoints directly.

The routes stay under `/admin/*` regardless. Permission is enforced **server-side**; a URL
prefix is not a permission boundary, and moving endpoints to `/superadmin/*` purely because
of who may call them was rejected as pointless churn.

## Minors have no account

This is the single most consequential rule in the access model.

A teenager or child is a `User` row with **no identity record** — nothing to log in with.
Their data is reachable in exactly two ways:

1. **Through an approved parent link.** The parent authenticates as themselves, then
   asserts which child they are acting for using the `X-Active-Child-ID` header on every
   request. The server verifies an `Approved` link matching **both** the authenticated
   parent **and** the named child. Matching the child alone would be a vulnerability.
2. **Through a staff role**, subject to the ordinary matrix.

Three properties fall out of this design, all intentional:

- **Revocation is instant.** Because the link is checked per request rather than baked into
  a token, revoking it takes effect on the very next call — not at token expiry.
- **Client-side switching is presentation only.** The header is an assertion; the server
  decides.
- **Every failure looks identical.** No such child, not your child, link pending, link
  rejected, link deleted — all return `404`. A parent cannot enumerate children.

**Adult students bypass the header entirely.** A caller holding the Student role acting on
their own data is verified directly against the token subject. Demanding a child header
from an adult student would be nonsense; letting the bypass apply to a parent-only caller
would be a hole.

> SRS §4.3 · [`BR-5`](../reference/business-rules.md#br-5) ·
> [Identity and access](../architecture/identity-and-access.md#child-context)

## Sensitive records: need to know

Minors' social and case-file data — health conditions, family situation, parents' names and
professions, siblings, home address — is restricted to **Admins, Super Admins, and the
student's own assigned teachers**.

Explicitly *not* to: other teachers, students themselves, or **guardians, including the
child's own linked parents**.

That last exclusion looks surprising and is deliberate. An earlier wording said "never
unrelated guardians", whose qualifier implied a related guardian might qualify; Revision 28
corrected it. The restriction is **field-level, not page-level**, and **reads are audited
as well as writes** — viewing a child's case file is itself a security-sensitive act, so
the trail answers *who looked at this, and when*.

> [`BR-16`](../reference/business-rules.md#br-16) · SRS §4.10 · Revision 28

## Pending means nothing

A registered but unapproved account reaches a status screen and stops. No endpoint except
`GET /me` and logout returns data to a Pending session, and the client additionally
hard-redirects before any authenticated route renders — so a Pending user never even sees
an empty application shell.

Both layers are tested independently. The client guard is UX; the server denial is the
security boundary.

> [`BR-4`](../reference/business-rules.md#br-4) · SRS TD-1, §14.4

---

**Next:** [Business processes](business-processes.md) · **Related:**
[Identity and access](../architecture/identity-and-access.md),
[Technical design § TD-2](../reference/technical-design.md#td-2)
