[Documentation](../README.md) › [Reference](README.md) › **API endpoints**

# API endpoints

**66 operations across 50 paths**, all under `/api/v1` except the health check.
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
| `GET` | `/calendar/sessions/{id}` | The §5.2 **Session page**: `{ occurrence, notes, recordings, linked_content }`. Public at the caller's tier — a public session's details, never its private recordings |
| `GET` | `/calendar/bootstrap` | The calendar screen's reference data in one read. **Cached 5 min + strong ETag.** Reference data only — never operational data. `?category_id=` narrows **only** the Level list, server-side (§4.4); an unknown id yields an empty list rather than falling back to all |
| `GET` | `/branches` | The landing-page branch directory: id, name, address, phone, email, opening hours, map link, display order. **Never** version, operational start date, or timestamps |

`GET /branches` is deliberately **not** the admin route with permissions relaxed — an
endpoint's audience is part of its contract.

### The calendar's filters, and `prefilled_filters`

The full TD-3.4 set: `from`, `to`, `academic_year_id`, `category_id`, `level_id`,
`subject_id`, `branch_id`, `administrative_group_id`, `teacher_id`. **Identical for anonymous
and authenticated callers** (§5.2) — signing in changes where the dropdowns *start*, never
what they offer and never what the results are.

**A filter a kind cannot satisfy excludes that kind rather than being ignored.** An Event has
no subject, no academic year and no instructors, so `subject_id`, `academic_year_id` or
`teacher_id` narrows the grid to Sessions. Ignoring them would return Events that do not match
what was asked, which is the more misleading answer. **`branch_id`, `level_id`, `category_id`
and `administrative_group_id` are deliberately not in that list** — an Event carries each
through its explicit scope joins, so those filter both kinds.

**`teacher_id` matches the session's own staffing snapshot**, not the schedule's (R43.4): a
teacher who covered one occurrence finds it, and one later removed from the schedule does not
lose the occurrences they actually took.

**Sessions carry `subject_id`, `subject_name`, `teaching_mode`, `audience_label` and
`status`.** `audience_label` is who the class is *for* — the Administrative Group's name, the
Teaching Group's, or the Level's, by mode. It previously travelled inside `description`, which
meant a Session's description field held something that was not a description. A **cancelled**
session still appears: the calendar's job is to say a class is not happening, not to hide that
it was scheduled.

**`prefilled_filters` is `null` for an anonymous or Pending caller** — *there is nothing to
prefill* and *nothing was unambiguous* are different answers, and an object of nulls would
conflate them. **A value is prefilled only when it is unambiguous:** a student enrolled in
three Levels has no single "own Level", and picking one would open their calendar on a third of
their own timetable while looking like it showed all of it. **Plural yields `null`, never
*first*.**

### The Session page

`GET /calendar/sessions/{id}` returns `{ occurrence, notes, recordings, linked_content }`.

**The `occurrence` is byte-identical to the grid's.** TD-3.4 says *the occurrence above,
plus …*, so one `include` and one mapper serve both — two that agree today are two that drift,
and a test asserts they match field for field.

**`recordings` and `linked_content` are disjoint, and the split is a fact about the file.**
§4.9's recording resources are exactly the **audio** items among the linked content, since
teachers upload phone recordings and video is excluded from the MVP entirely. Deriving it
avoids a second column that would have to be kept in step with reality.

**Both lists pass the same §4.9 tier rule the library applies** — literally the same predicate,
exported rather than restated, so a change to the tiers cannot reach one surface without the
other. BR-2's `consent_forced_private` exclusion holds here too. Each item is exactly `id`,
`title`, `subject_id`, `level_id`: enough to open it **inside the Educational Library** (§5.2 —
one reader, one permission path), and deliberately not the object location, which only
`GET /content/{id}/download-url` hands out after its own check.

**`notes` is always `null`, and the key ships on purpose.** TD-3.4 names it and §5.2 lists notes
on the page, but **§7 gives `Session` no notes column and defines no note entity** —
`User.notes` is a different field on a different model. Adding one is a §7 schema decision and
therefore the Document Owner's, the same class as the deferred `EducationalContent` uploader
field. Shipping the key null lets a client coded against TD-3.4 find the field where the
specification says it is, and keeps the gap **visible rather than silent**.

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

### Sessions — the individual occurrence

A Session is the materialization of a schedule on one date. **These routes are deliberately not
under `/admin/`:** TD-2 gives a Teacher write access to the sessions they staff, so the prefix
would misdescribe the audience. Scope is asserted in the service, the only place that knows who
staffs what, and anything out of reach answers `404`.

| | Path | Notes |
|---|---|---|
| `PATCH` | `/sessions/{id}` | A **field edit**, not a transition. Always marks `overridden` |
| `POST` | `/sessions/{id}/cancel` | Reason **mandatory** and may not be blank |
| `POST` | `/sessions/{id}/restore` | Refused once the date has passed |
| `POST` | `/sessions/{id}/content` | Links an existing library item. Body key is `educational_content_id`, as TD-3.12 names it |
| `DELETE` | `/sessions/{id}/content/{contentId}` | **Unlinks; never deletes the file** |

**One verb per TD-1 transition, and `PATCH` is not one of them.** `status` is *refused* on the
edit endpoint, because a transition carries obligations a field assignment cannot: a
cancellation must state a reason and records the audience size **while it is still answerable**,
and a restore is refused after the date. Accepting `status` would give the state machine a
second entrance with none of that attached. `schedule_id` is refused for a related reason —
moving an occurrence to another schedule detaches it from the recurrence that explains it.

**`overridden` means a human decided about this occurrence** — not "differs from the schedule".
It is set by *any* override, including one whose values match the schedule exactly, because
inferring it from a difference would silently un-protect a session whose schedule later moved
to match it. That flag is what survives the next schedule edit.

**Supplying `staff` replaces this occurrence's snapshot; omitting it leaves the snapshot
untouched.** An empty array is therefore a real instruction — *this session has no staff* — and
deliberately not the same as omission.

**Unlinking content never destroys it.** The content is a library item with its own lifecycle
(§4.9); removing it from one session's materials must not remove it from every other session,
screen and download URL. The link row is soft-deleted, so the fact it once existed survives.
Linking or unlinking changes what a later schedule edit may do, since a linked item is one of
the things that makes a Session protected.

**No route sets `held`.** The service can, TD-3.12 documents no endpoint for it, and §20 rule 16
forbids inventing one.

## The public Educational Library

| | Path | Notes |
|---|---|---|
| `GET` | `/library` | 🌐 **Public and anonymous.** `?category_id=` `?level_id=` `?academic_year_id=` `?subject_id=` `?page=`. Paginated (TD-10) |

**It never answers `401`.** An invalid credential is *ignored*, not refused — a public
surface that can `401` is not public. It mounts before the guarded router with optional
authentication, exactly as `/calendar` does, and a **Pending** account sees the public tier
just as an anonymous visitor does (TD-1: the account exists and grants nothing).

**Signing in reorders; it never unlocks.** The §5.2 order is **own branch → Global → other
branches**. `branch_id IS NULL` is *Global*, not *unknown* (§7), which is why it sorts second
rather than last — a platform-wide resource is more relevant to a reader than another branch's
local one. Own branch resolves through `Enrollment → AdministrativeGroup.branch_id` for a
member and through role scopes for staff. A caller with no branch context has no first bucket
and the ordering degrades without a special case.

**§4.9's three tiers still filter every result set, and that is not a contradiction of
"nothing hidden".** TD-3.13's sentence is about *personalisation*; §5.2's *"identical filters
never means identical results"* is about the tiers, which are a property of **who the caller
is** rather than a personalisation:

| Tier | Who sees it in a listing |
|---|---|
| `public` | Everyone, including anonymous |
| `private` | Logged-in students enrolled in the target Level, **and parents of such students** |
| `hidden` | Excluded from Student/Parent directories — Admins and Teachers only |

A parent's access needs **no `X-Active-Child-ID`**: that header governs acting *as* a child on
student-context endpoints, while the library is one shared reading surface (§5.2, *one reader
and one permission path*). A parent forced to switch context could not compare two children's
materials at all.

**Listing is not the download gate.** A restricted item appears with its `visibility` so a
client can badge it; `GET /content/{id}/download-url` (TD-3.5) performs the §4.9 check before
any presigned URL is minted. The item DTO therefore **omits `storage_bucket`, `storage_key`,
`original_filename` and `consent_forced_private`** — the first three are the object's location,
and publishing them here would hand every anonymous visitor the input that check exists to
protect; the fourth is a fact about a child.

**BR-2 is enforced by an explicit exclusion**, not by trusting the re-evaluation engine to have
moved `visibility` already. A hard constraint that holds only while a background job is current
is a race, not a constraint.

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

### What the library screen still needs

**This section previously claimed no route anywhere in the SRS lists content.** That was true
when it was written and **Revision 43 superseded it**: TD-3.13 specifies `GET /library`, which
is now built and mounted. The remaining items are genuine, and smaller than the gap once was.

| Needed | For | Status |
|---|---|---|
| `GET /content/{id}/download-url` | Every preview and download | **Specified (TD-3.5), unimplemented** — M6 |
| An **uploader** on `EducationalContent` | The teacher display name the cards show | **Not in §7's field list.** Needs a revision plus a forward-only migration |

The per-level counts the §5.2 cards show are derivable from `GET /library` with a
`?level_id=` filter and its TD-10 `meta.total`, so the *"level index"* and *"level content
read"* the earlier note asked for are no longer separate endpoints — one filtered, paginated
route answers both, which is why TD-3.13 specifies one.

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
