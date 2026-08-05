[Documentation](README.md) › **SRS proposal — Revision 46**

# Draft SRS Revision 46 — reference-data selectors in TD-3

> **Status: PROPOSED. Not in force.** `docs/SRS.md` is immutable to implementing
> agents; this is drafted wording for the **Document Owner** to apply, amend or reject.
> **Delete it once decided.**
>
> **The endpoints are already implemented and shipped** (2026-08-05) on the Owner's explicit
> instruction — *"this is an intentional TD-3 extension rather than an ad hoc workaround"*.
> This proposal records the wording; the code is not waiting on it.

---

## The gap that forced it

`POST /admin/course-schedules` requires `subject_id` and `academic_year_id`. **Nothing in TD-3
could list either.** The §5.6 Course Schedules form was therefore unbuildable — not difficult,
*impossible* — and the same gap blocks the §14.1 Subject Organisation screen, which needs a
Subject picker to reach `/admin/levels/{id}/subjects/{subjectId}`.

`/calendar/bootstrap` (TD-3.10) carries categories, levels and branches, and neither subjects
nor academic years.

## What was added

```
GET /admin/subjects        → [{ id, name, display_order }]          (Admin+; read-only)
GET /admin/academic-years  → [{ id, label, is_current }]            (Admin+; read-only)
```

**Both are unpaginated.** A selector that offers a subset is lying about the choice available,
and a paged `<select>` is a control with a hidden second page. Both sets are bounded by the
curriculum — tens of rows — which is the condition that makes TD-10 the wrong tool.

**TD-2 unchanged:** Revision 26 already says Admins *read* reference data and Super Admins
write it; there is no write here at all. Revision 30 already excludes Teachers from browsing
reference data, and these endpoints refuse them.

### Two alternatives, rejected

| Rejected | Why |
|---|---|
| **Widen `/calendar/bootstrap`** | Its contract is *the calendar screen's* reference data, cached five minutes with a strong ETag. Adding fields an admin form needs would let an unrelated screen shape a public cached endpoint, and the cache TTL is wrong for a form that has just created a Subject |
| **A screen-specific payload** (e.g. `/admin/schedules/form-data`) | A second source of truth for one concept, and the next screen needing a Subject would either call it — inheriting a name that lies — or grow a third list |

**These two endpoints are therefore the canonical source for every admin selector needing a
Subject or an Academic Year.** A screen that needs one reads these; it does not grow its own.

## Exact wording to apply

### 1. New entry in §0

> **Revision 46 (Document Owner decision — reference-data selectors are part of TD-3,
> 2026-08-05):** `POST /admin/course-schedules` requires `subject_id` and `academic_year_id`,
> and TD-3 documented no way to list either, so the §5.6 Course Schedules form could not be
> built at all. Two read-only endpoints join TD-3: **`GET /admin/subjects`** and **`GET
> /admin/academic-years`**, Admin-and-above, returning only what a selector needs.
>
> **They are the canonical source for every admin selector requiring a Subject or an Academic
> Year** — a screen needing either reads these rather than growing its own list. Widening
> `/calendar/bootstrap` was rejected because its contract is *the calendar screen's* reference
> data and an unrelated screen must not shape a public cached endpoint; a screen-specific
> payload was rejected because it is how a second source of truth for one concept begins.
>
> **Both are unpaginated**, deliberately: a selector offering a subset misrepresents the choice
> available, and both sets are bounded by the curriculum. **Neither carries a `version`,** since
> neither has a write — a version field would have no possible use and would become something a
> client depends on.
>
> **TD-2 is unchanged.** Revision 26 already grants Admins the *read* of reference data and
> reserves writes to Super Admin — and there is no write here; Revision 30 already excludes
> Teachers from browsing reference data, which these endpoints enforce.

### 2. TD-3 — add a section

> **3.14 Reference-data selectors (Revision 46)**
> ```
> GET /admin/subjects        → [{ id, name, display_order }]
>                  Admin+ (TD-2 R26 read; R30 excludes Teacher). Read-only —
>                  Subjects are seeded and managed outside this surface.
>                  Unpaginated: a selector must offer every option.
>                  Ordered by display_order then the ar-x-icu collated name.
> GET /admin/academic-years  → [{ id, label, is_current }]
>                  Admin+. Newest first — `label` sorts correctly because TD-6
>                  constrains it to YYYY-YYYY. `is_current` lets a form default
>                  to the live year rather than asking someone to recall it.
> ```
> These are the **canonical source** for admin selectors requiring either entity.

---

## Consistency check

| Touched | Effect |
|---|---|
| §0 | One new entry |
| TD-3 | One new subsection, 3.14 |
| TD-2 | **Unchanged** — R26 and R30 already say who may read reference data |
| TD-10 | **Unchanged** — the exemption is stated as a property of selectors, not a change to pagination |
| §20 rule 16 | **Respected**: the endpoints were authorised by the Document Owner *before* implementation, which is the rule's actual requirement |

**If rejected, the implementation must change** — the endpoints are live and two screens depend
on them.

---

**Related:** [API endpoints](reference/api-endpoints.md), [`SRS-PROPOSAL-R45.md`](SRS-PROPOSAL-R45.md)
