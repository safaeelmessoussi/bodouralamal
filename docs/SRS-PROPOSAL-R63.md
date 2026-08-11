# SRS Proposal — Revision 63

**Status: authorised by the Document Owner (2026-08-11) with its scope pinned in
the instruction itself** — *"Add the Student Dashboard read endpoint required by
R62.10 and register it properly through the SRS revision process … Keep it
strictly limited to the identity block fields required by R62.10: name,
reference code, Category, Level, and branch"* and *"correct the stale
`/dashboard/parent` sitemap reference in the SRS through the appropriate revision
process."*

This document exists because §3.1 requires an endpoint to be **documented before
it is implemented**, and because §20 rule 16 forbids inventing one. It records
what is added, what was rejected, and why — so the decision survives the commit
that implements it.

---

## 63.1 — Why an endpoint is needed at all

R62.10 ships a **minimal Student Dashboard**, and names its content exactly:

> the student identity block — name, **reference code**, Category, Level, branch;
> today's and upcoming sessions; basic student information.

Everything but the identity block is already reachable:

* **today's and upcoming sessions** — `GET /calendar` (TD-3.4) already returns
  occurrences with every field the screen needs, filtered by visibility;
* **basic student information** — the same identity block, so not a second
  surface.

The identity block is **not** reachable. `GET /me` answers *which account is
this* and deliberately carries no placement; the child's `reference_code`,
Category, Level and branch exist nowhere a student or a parent may read them.
`GET /students/{id}/social-profile` (§4.10) is a **safeguarding case file**,
staff-only by TD-2, and is not this.

So R62.10 is currently unbuildable. This revision registers the one route that
makes it buildable and no more.

---

## 63.2 — The route

```
GET /students/me     → the ACTING student's identity block (§4.3, §5.3, R62.10)
```

**Placed in TD-3.3 (Child-context requests), not TD-3.2**, because that clause
already states the rule this endpoint obeys: the acting student is resolved per
§4.3 — header present → an approved `FamilyLink` matching **both** the JWT
parent and the header child; header absent + Student role → the caller
themselves; header absent + Parent-only → `400`. This is the **first** route to
mount that resolution, which until now existed as middleware with no caller.

### Why there is no `{id}` in the path

TD-12 forbids trusting a student identifier from the request for authorization,
and §4.3 requires downstream code to receive the *verified* id. A path parameter
would be a second place a caller could name a student, and the endpoint would
then have to prove that the path id and the header id agree — a check that has
to be right on every future edit. Resolving the acting student **once, in
middleware, from the header or the JWT `sub`** means the identity of the subject
is never in the caller's hands.

### `/me` and `/students/me` are different questions, deliberately

`GET /me` answers **which account is this** — roles, scopes, account status, the
approved child links. `GET /students/me` answers **which student am I acting
for** — which, for a parent, is *not* their own account. The distinction is the
same one R60.9 already drew between `/me` and authorization, and it is stated
here so the two are not later "harmonised" into one endpoint that would have to
mean both.

### Response

```jsonc
{
  "id": "…",
  "name_arabic": "…",
  "reference_code": "BA-7K4M2",       // null until a child is approved (R62.6)
  "enrollments": [                     // R43: Category → Level → Group → Enrollment
    {
      "category": { "id": "…", "name": "…" },
      "level":    { "id": "…", "name": "…" },
      "branch":   { "id": "…", "name": "…" }
    }
  ]
}
```

**Exactly the five R62.10 fields and nothing else.** No sex, no schooling stage,
no French name, no consent state, no account status, no dates. Each omission is
a decision: this is a screen a parent looks at, and every field added to it is
personal data published to one more surface for no stated purpose (see
`docs/compliance/personal-data-audit.md`).

**`enrollments` is a LIST because the model permits several.** `Enrollment` is
unique on `(student_id, level_id)`, so a student may hold one enrolment per
Level. R62.10's wording is singular because the common case is one, but a
singular field would have to *choose* which enrolment to show and silently
discard the rest. The list carries the same five fields; the screen renders the
first and is honest when there are two. Soft-deleted enrolments are excluded.

`reference_code` is `null` for accounts created before R62 and for adult
students, who have never been through the child-application path. That is a real
answer, not a missing one, and the screen renders the block without it.

### Errors

Nothing new. `404 NOT_FOUND` for a header that resolves to no approved
`(parent, child)` link — pending, revoked, soft-deleted, nonexistent, or another
parent's child, with **no distinction between them** (§4.3, §20 rule 17).
`400 VALIDATION_FAILED` for a caller who is Parent-only and sends no header:
the request is genuinely ambiguous without a child.

**A staff caller receives the `400` too**, and that is correct rather than a gap:
staff reach a student's record through §14.2 and the TD-2 matrix, which is a
different authorization path (§4.3 — *"through an approved `FamilyLink` **or**
through staff roles"*). An endpoint serving both audiences would have to get the
difference right on every future change, which is the argument Revision 35
already made for `GET /branches`.

### Not audited

Reads of a student's own name and placement by that student or their approved
parent are ordinary use, not a security-sensitive act. This is deliberately
**unlike** `StudentSocialProfile`, whose reads §4.10/Revision 28 audit because
the question *who looked at this child's case file* has to be answerable. TD-8
gains no row.

---

## 63.3 — §14.1's stale `/dashboard/parent`

R62.9 removed the Family Dashboard and §14.1's `Family` line records it:

```
│   └── Family ........................ role switcher → ولي الأمر → child (R62; /dashboard/parent removed)
```

but the `Dashboard` line four rows above still reads:

```
├── Dashboard ......................... role-specific home (/dashboard/student, /dashboard/parent, /teacher, /admin)
```

Two lines of one section disagreeing is exactly the §12 conflict this document
resolves by revision order — the later revision governs, so the implementation
already follows R62. **The stale line is corrected rather than left to be
rediscovered**, because a sitemap is read as a list of what exists, and a reader
who finds `/dashboard/parent` there has no reason to look four rows down.

Corrected to:

```
├── Dashboard ......................... role-specific home (/dashboard/student, /teacher, /admin);
│                                       a parent's home is their child's dashboard (R62.9)
```

No other clause changes. `/dashboard/parent` appears nowhere else in §14.1.

---

## 63.4 — Audit against the live architecture

| Claim | Status |
|---|---|
| `childContext` middleware exists and implements §4.3 exactly | **[CODE]** `backend/src/middleware/child-context.ts` — case order, uniform `404`, UUID shape-check before the query |
| It currently has **no mount site** | **[CODE]** grep across `app.ts` and controllers: zero callers. This endpoint is its first |
| `Enrollment` reaches Category, Level and branch without a second query | **[CODE]** `enrollment.level.category` and `enrollment.administrativeGroup.branch` |
| `User.referenceCode` is nullable | **[CODE]** `schema.prisma` — allocated at child approval only (R62.6) |
| TD-3.3 is the clause that already states the resolution rule | **[SRS]** TD-3.3 |
| §14.1's two lines disagree | **[SRS]** §14.1, verified by reading both |
| No new error code, no new audit action, no schema change, no migration | **[INFER]** from the above — the endpoint is a read over existing rows |

**Nothing here is pending legal confirmation.** The five fields were all already
collected and all already justified; this revision publishes none of them to a
new audience — a parent seeing their own child's Level is the purpose the data
was collected for.
