[Documentation](../README.md) › [Reference](README.md) › **API endpoints**

# API endpoints

**59 operations across 43 paths**, all under `/api/v1` except the health check.
The count comes from the generator, which reconciles against the live router — if this line
disagrees with `openapi.json`, this line is the one that is wrong.

> Exact schemas: [`openapi.json`](../openapi.json) — **generated, never hand-edited.**
> Conventions and governance: [API](../architecture/api.md).
> Every response is an explicit contract DTO, never an ORM entity
> ([why](../architecture/api.md#the-contract-is-an-interface-not-a-serialisation)).

**Audience:** 🌐 public/anonymous · 🔒 authenticated · 👤 Super Admin only (enforced in the
service, not by the URL prefix).

---

## Health

| | Path | Audience |
|---|---|---|
| `GET` | `/healthz` | 🌐 Component health for database, storage, and job queue. Served at the **origin root**, not under the API prefix |

## Authentication

| | Path | Audience | Notes |
|---|---|---|---|
| `GET` | `/auth/google` | 🌐 | Redirect to Google with state + PKCE |
| `GET` | `/auth/google/callback` | 🌐 | Routes by identity resolution. **Failures redirect, never JSON** |
| `POST` | `/auth/refresh` | 🍪 | **The only cookie-authenticated route.** Requires a custom header and an `Origin` match |
| `POST` | `/auth/logout` | 🔒 | Revokes **the current session only** — other devices keep working |
| `GET` | `/me` | 🔒 | Identity, roles, scopes, status, approved child links. **One of only two endpoints a Pending session may call** |

## Public

Three anonymous endpoints, each a deliberate decision about what may be public.

| | Path | Returns |
|---|---|---|
| `GET` | `/calendar` | Occurrences at the caller's visibility tier. **Self-sufficient** — opening an event costs no further request. **Uncached** |
| `GET` | `/calendar/bootstrap` | The calendar screen's reference data in one read. **Cached 5 min + strong ETag.** Reference data only — never operational data. `?category_id=` narrows **only** the Level list, server-side (§4.4); an unknown id yields an empty list rather than falling back to all |
| `GET` | `/branches` | The landing-page branch directory: id, name, address, phone, email, opening hours, map link, display order. **Never** version, operational start date, or timestamps |

`GET /branches` is deliberately **not** the admin route with permissions relaxed — an
endpoint's audience is part of its contract.

## Registration and approvals

| | Path | Audience | Notes |
|---|---|---|---|
| `POST` | `/registrations` | 🌐 + token | Gated by the signed onboarding token; no session exists yet. **Identity comes solely from the token payload** |
| `GET` | `/admin/approvals` | 🔒 | Deliberately **unscoped** — the permanent path by which a branch Admin meets applicants |
| `POST` | `/admin/approvals/{id}/approve` | 🔒 | Atomic bundle activation |
| `POST` | `/admin/approvals/{id}/reject` | 🔒 | Body carries a reason |
| `POST` | `/family-links` | 🔒 | **Staff-mediated** link of an existing child. Parents have no search over children |
| `DELETE` | `/admin/family-links/{id}` | 🔒 | Soft delete **is** the revocation — effective on the next request |

## Users, consents, and case files

| | Path | Audience | Notes |
|---|---|---|---|
| `GET` `POST` | `/admin/users` | 🔒 | List with search; create pre-provisions against a Google address |
| `GET` `POST` | `/students/{id}/consents` | 🔒 | Versioned records; staff-recorded grants carry the actor |
| `GET` `PUT` | `/students/{id}/social-profile` | 🔒 | **Both reads and writes audited.** Out of scope answers `404`, never `403` |

## Reference data

Writes are Super Admin only; Admins read within scope. **Teachers have no access at all** —
they receive reference information through the operational APIs they are authorised to use.

| | Path | Audience |
|---|---|---|
| `GET` `POST` | `/admin/branches` | 👤 write · 🔒 read |
| `PATCH` `DELETE` | `/admin/branches/{id}` | 👤 |
| `GET` `POST` | `/admin/branches/{id}/rooms` | 👤 write · 🔒 read |
| `PATCH` `DELETE` | `/admin/rooms/{id}` | 👤 |

## Educational organisation and delivery

Revision 43 split the retired `Group` into an **organisational** unit and a **delivery** one, and
this section follows that split — see [Scheduling](../overview/business-processes.md#3-scheduling)
for why. Nothing here schedules anything: an Administrative Group has no room, no teacher and
**no capacity**.

Operational — Admin-managed within branch scope, asserted in the service. The `/admin/` prefix
authenticates; it does not authorise.

| | Path | Notes |
|---|---|---|
| `GET` `POST` | `/admin/administrative-groups` | `?level_id=` `?branch_id=` narrow **within** the caller's scope and can never reach outside it. A malformed filter is `400`, not an empty list |
| `GET` `POST` | `/admin/administrative-groups/{id}/roster` | Enrolment reads the Level **from the group** and **enqueues consent re-evaluation** per session. **No capacity check exists** |
| `DELETE` | `/admin/administrative-groups/{id}/roster/{studentId}` | Soft-deletes the enrolment **only** — grades, submissions and Quran logs survive. Subject-split seats for that Level go with it |
| `PATCH` `DELETE` | `/admin/administrative-groups/{id}` | Only `name` and `display_order` are editable. Deletion is blocked by enrolments, by a schedule targeting the group, and by the **last group in a Level** — a Level created with one must never be emptied back to none |

A group is exactly `id`, `name`, `level_id`, `branch_id`, `display_order`, `version`. The write
boundary **refuses** `max_students`, `room_id`, `teacher_id` and a weekly slot rather than
dropping them: a `201` after sending a capacity would tell a client a limit had been recorded,
and there is none to record. `branch_id` is load-bearing — it is the single answer to *which
branch is this person at*, which `intended_branch_id` deliberately does not give.

### Teaching Groups — the subject split

A **Teaching Group** exists only where a Subject needs students divided differently from the
administrative roster. A Subject with no groups is taught to the whole Level, so creating these is
never a prerequisite for teaching anything. The splits are **independent between Subjects**: one
student sits in Administrative Group 1, Quran Group 2 and Tajweed Group 1 at once.

| | Path | Notes |
|---|---|---|
| `GET` `POST` | `/admin/levels/{levelId}/subjects/{subjectId}/teaching-groups` | `GET` returns `{groups, split, unassigned}` — the whole split in one read, **unpaginated**. `POST` is 👤; the Subject must actually be assigned to the Level |
| `PATCH` `DELETE` | `/admin/teaching-groups/{id}` | 👤. Only `name` and `display_order`. `DELETE` answers **`200 {released_students}`**, not `204`, and is blocked by a schedule targeting the group |
| `POST` | `/admin/teaching-groups/{id}/members` | 🔒 scoped by the **student's** enrolment branch. At most one seat per (student, Subject, Level) |
| `DELETE` | `/admin/teaching-groups/{id}/members/{studentId}` | The student returns to `unassigned` |

**`unassigned` is BR-22 made visible.** A student enrolled in the Level who holds no seat in a
split Subject has **no sessions for it at all**, and nothing else in the platform would say so.
That is also why the list is unpaginated — a page boundary drawn through an alarm hides half of it.
**`split` is not redundant with `groups.length`:** an empty `unassigned` on an unsplit Subject means
*the question does not apply*; on a split one it means *everyone is placed*. The two render
identically without the flag and only one of them is fine.

**The authority is split, and the reason is structural** (Revision 43.3). A Teaching Group carries
**no branch** — it belongs to a Subject and a Level, and a Level spans branches — so *"within your
branch scope"* has no referent for the group itself. Group CRUD is therefore Super Admin, alongside
the Levels and Subjects it organises; **membership** is Admin, scoped by the branch the *student* is
enrolled at, which is a referent that exists. Without the split a Marrakesh Admin could delete the
Quran split Targa's students depend on while the unassigned list showed them only Marrakesh
students: authority over everyone, visibility of some. It follows that a branch Admin's `unassigned`
list is deliberately **partial** — they may place only the students they are responsible for.

### Course Schedules — the unit of delivery

A schedule carries the Subject, **one teaching mode with exactly one target**, the branch, the
room, its staff, the times and a recurrence rule. Everything the retired `Group` used to hold
about delivery lives here.

| | Path | Notes |
|---|---|---|
| `GET` `POST` | `/admin/course-schedules` | `?branch_id=` `?subject_id=` `?academic_year_id=` narrow within scope. A write returns `{ schedule, materialization }` |
| `PATCH` `DELETE` | `/admin/course-schedules/{id}` | Only the *when* and the *room* are editable. `DELETE` answers `200 { future_removed, retained }` |
| `GET` | `/admin/course-schedules/{id}/conflicts` | Computed against **materialized Sessions**, never against recurrence rules |
| `GET` | `/admin/course-schedules/{id}/roster` | The **resolved** audience — recomputed per request, never a stored snapshot |

**`teaching_mode` + `target_id`, never three nullable columns.** A body or a response carrying
two targets has no correct reading, and the database CHECK that refuses it would report an
ambiguity as a constraint violation. One field cannot be ambiguous.

**Times are TD-11 wall-clock `HH:MM`, and an ISO instant is refused.** A class starts at 15:00
at its branch; an instant would let a client shift it.

**Conflict detection is why materialization is eager.** Comparing recurrence rules cannot see
that a weekly and a biweekly-alternating Tuesday 15:00 collide only on alternate weeks — so
room, teacher and assistant are each checked against the Sessions that actually exist, with the
governing rows taken `FOR UPDATE` first (TD-15.2) so two administrators booking one room at one
instant cannot both succeed. A clash is [`SCHEDULE_CONFLICT`](error-codes.md), not the generic
`STATE_CONFLICT`: the remedy is to free a named room or person. **Room capacity is never
consulted** (BR-23).

**Writes report what they did not do.** `materialization.protected_sessions` lists Sessions
left alone because they hold data whose loss would change historical truth, with every
applicable reason; `retained` on delete counts the ones that outlive the schedule. A response
that reported only what changed would claim the timetable is consistent when part of it
deliberately is not.

**Subject, target, branch and academic year are not editable.** Each would change what is
taught, to whom, or where, while the Sessions already materialized against the old answer
remain — silently re-pointing a term of history. Those are re-creations, not edits.

### Not yet mounted

Every service below is **built and tested**; the contract phase removed the old routes and these
replace them one resource at a time.

`/sessions/{id}` (+ `/cancel`, `/restore`, `/content`) · `GET /library`

## Events

| | Path | Notes |
|---|---|---|
| `POST` | `/events` | Writes the four-way scope joins **explicitly at creation** |
| `PATCH` `DELETE` | `/events/{id}` | |
| `GET` `POST` | `/admin/branches/{id}/event-backfill` | Manual backfill on branch activation. Stays an **Admin** capability — it is operational work |

## Hijri calendar

Super Admin only, enforced in the service.

| | Path | Notes |
|---|---|---|
| `GET` | `/admin/hijri-calendar?year=` | The twelve months, draft and published |
| `PUT` | `/admin/hijri-calendar/{year}/{month}` | **Records** an official announcement. Optimistic locking |
| `POST` | `/admin/hijri-calendar/{year}/publish` | Only published months render anywhere |
| `GET` | `/admin/hijri-calendar/{year}/history` | The audit trail for that year |

**No import route ships.** There is no machine-readable source to import from, so an endpoint
could only ever answer *not configured*.

---

## Specified, not yet built

Documented in the specification, reported as `PENDING` by the contract check until their
milestone lands. **They are a work-in-progress signal, not invented endpoints.**

| Milestone | Endpoints |
|---|---|
| **M4 — Quran** | `POST /students/{id}/quran-logs` · `PATCH` / `DELETE /quran-logs/{id}` — each returns the **synchronously recalculated** coverage |
| **M5 — Exams** | `POST /exams` · `POST /exams/{id}/publish` · `POST /exams/{id}/submissions` · `PATCH /submissions/{id}` · `POST /submissions/{id}/submit` · `POST /grades/{id}/publish` · `/republish` · `/pass-fail-override` |
| **M6 — Storage** | `POST /uploads/initiate` · `/complete` · `/abort` · `GET /content/{id}/download-url` |
| **Jobs** | `GET /jobs/{id}` — any endpoint that enqueues returns `202` with a job id |

**Post-MVP, deliberately absent:** grading-template routes, multipart upload endpoints, CSV
import/export, the Hijri importer.

### Not specified at all — the educational library's gap

The `/resources` library (§5.2) is **built and reviewable** against a mock adapter, and cannot
be wired because **no endpoint exists to wire it to**. This is a genuine specification gap
rather than an unimplemented milestone item: TD-3.5 defines the three upload routes and
`GET /content/{id}/download-url`, and **no route anywhere in the SRS lists content.**

| Needed | For | Status |
|---|---|---|
| A **level index** with per-level content and year counts | Page 1's cards. One request, not one per level — otherwise an N+1 on a public page | **Not specified.** Needs a revision |
| A **level content read**, grouped year → branch | Page 2's whole hierarchy | **Not specified.** Needs a revision |
| `GET /content/{id}/download-url` | Every preview and download | **Specified (TD-3.5), unimplemented** — M6 |
| An **uploader** on `EducationalContent` | The teacher display name the cards show | **Not in §7's field list.** Needs a revision plus a forward-only migration |

**Two constraints any listing endpoint must satisfy**, recorded because they are easy to miss
and impossible to add safely later:

- **Visibility is resolved server-side from the live actor**, exactly as `GET /calendar` does
  (§4.4) — an anonymous visitor receives the public tier only, and no query parameter may widen
  it.
- **`consent_forced_private` recordings never appear on a public surface** (BR-2). That is a
  filter no client may be trusted to apply.

**Two divergences from §5.2** for the Document Owner to settle: §5.2 specifies a **Subject**
tier beneath Branch (rendered as a card badge instead) and pins the **`is_current`** academic
year at top (the page sorts strictly newest-first).

---

## Conventions at a glance

| | |
|---|---|
| Prefix | `/api/v1`, same origin as the client |
| Auth | `Authorization: Bearer` — **never a cookie**, except `/auth/refresh` |
| Child context | `X-Active-Child-ID`, verified per request against **both** parties |
| Lists | Paginated: `?page=1&page_size=25`, default 25, max 100, `{ data, meta }` |
| Errors | One envelope, always → [Error codes](error-codes.md) |
| Out of scope | **`404`, never `403`** |
| Public endpoints | **Never return `401`** — an invalid credential is ignored |

---

**Related:** [API](../architecture/api.md), [Error codes](error-codes.md),
[`openapi.json`](../openapi.json)
