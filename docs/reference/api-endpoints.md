[Documentation](../README.md) › [Reference](README.md) › **API endpoints**

# API endpoints

**156 operations across 120 paths**, all under `/api/v1` except the health check and the
Nginx-only storage authorization hook.
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
| `GET` | `/healthz` | 🌐 Readiness for database, storage, pg-boss infrastructure (`queue`), and this process's registered workers (`jobs`). Stable worker reasons/counts live under `details.jobs`; schema presence alone is insufficient. Served at the **origin root**, not under the API prefix |

## Internal infrastructure

| | Path | Audience |
|---|---|---|
| `GET` | `/internal/storage/public-authorize` | Nginx `internal` auth subrequest only. Checks the exact current public storage coordinate against BR-2/TD-4.9; no browser or generated client calls it |

## Authentication

| | Path | Audience | Notes |
|---|---|---|---|
| `GET` | `/auth/google` | 🌐 | Redirect to Google with state + PKCE |
| `GET` | `/auth/google/callback` | 🌐 | Routes by identity resolution. **Failures redirect, never JSON** |
| `POST` | `/auth/refresh` | 🍪 | One of exactly two refresh-cookie consumers. Requires a custom header and an `Origin` match; rotates the session |
| `POST` | `/auth/logout` | 🍪 | The other refresh-cookie consumer, with the same CSRF checks. Revokes **the current server-side session only**, expires the cookie, and leaves other devices working; idempotent `204` |
| `GET` | `/me` | 🔒 | Identity, roles, scopes, status, approved child links. **One of only two endpoints a Pending session may call** |

## Notifications

The MVP carries the bounded notification types admitted by R77, R78, R82, R83
and R93. The postponed framework remains postponed: there is no tier,
`NotificationPreference`, delivery channel, or per-child preference.

| | Path | Notes |
|---|---|---|
| `GET` | `/notifications` | 🔒 **The caller's own, and nobody else's.** No id names a user, so there is nothing to tamper with and no role widens it. Paginated (TD-10), newest first with the `id` tiebreaker. `?unread_only=true` narrows. `meta.unread` travels with the list rather than as a second endpoint that would disagree with it |
| `POST` | `/notifications/{id}/read` | 🔒 Idempotent, and it does **not** move the timestamp on a retry. Another user's row answers **`404`, never `403`** (§20 rule 17) |
| `POST` | `/events/{id}/notify` | 🔒 Optional Event announcement after the saved create, reschedule, or cancellation. Body `{ change }`; recipient ids are refused |
| `POST` | `/sessions/{id}/notify` | 🔒 R83's independent occurrence decision after a cancellation or reschedule. Body `{ change }` |

**An optional send is a separate request after the change commits** (R82.5,
R83.3). Declining is the absence of that request; a notification failure never
rolls back the saved change. Session changes retain their own R77/R83 audience
resolver and lifecycle. Event creation and rescheduling resolve the live Event
scope. Event cancellation is the Event's soft deletion: because deletion
hard-removes its four scope joins, the send reads those same ids from the
authoritative Trash snapshot and requires the current actor to be its recorded
deleter. It creates no second Event copy and does not change `purge_after`; the
existing Notification foreign key and Trash lifecycle remain unchanged.

All recipient sets are server-resolved; the actor is excluded, and the partial
unique indexes make repeat sends idempotent. An Event recipient is the union of
its scoped enrolments and live Event staff. A global Event has no notification
audience (R82.7).

**Restoring reconciles rather than deleting.** An *unread* notice of something no
longer true is withdrawn; one already *read* becomes `session_restored`, because
silently removing something a person has acted on leaves them believing a class
is cancelled with nothing to correct them.

## Public

Three anonymous endpoints, each a deliberate decision about what may be public.

| | Path | Returns |
|---|---|---|
| `GET` | `/calendar` | Occurrences at the caller's visibility tier. **Self-sufficient** — opening an event costs no further request. **Uncached** |
| `GET` | `/calendar/sessions/{id}` | The §5.2 **Session page**: `{ occurrence, notes, recordings, linked_content, suggested_recording_name }`. Public at the caller's tier — a public session's details, never its private recordings |
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

`GET /calendar/sessions/{id}` returns
`{ occurrence, notes, recordings, linked_content, suggested_recording_name }`.

**The `occurrence` is byte-identical to the grid's.** TD-3.4 says *the occurrence above,
plus …*, so one `include` and one mapper serve both — two that agree today are two that drift,
and a test asserts they match field for field.

**`recordings` and `linked_content` are disjoint, and the split is the item's `origin`**
(R99.10). «التسجيلات» are the linked contents with `origin = session_recording`; everything
else is a material, and **the MIME type decides only which player and which download the
reader gets**.

The rule this replaced — *linked content whose MIME begins `audio/` is a recording* — was
wrong in both directions, and the two directions are why it had to go rather than be patched:
it called **every attached audio file a recording** whether or not it was one, and it made a
**video recording of a صوت وصورة class unrepresentable**. `origin` is a fact about the
association's own world (§7, R99.9), so it survives replacing the media platform.

**`suggested_recording_name` is R75.6's default name for the NEXT recording of this
occurrence.** It is composed by the server from the class and this occurrence's date and
numbered ` 2`, ` 3` against what is already linked — **whatever produced it**. That is the
point: a مؤطِّرة's browser recording and the platform's own server-side capture of the same
lesson are two recordings of one class, and numbering them in separate sequences would produce
two files called the same thing.

It is numbered against **the titles this caller can see**, not the whole namespace: a suffix
derived from an item the caller may not see would report that the item exists (§20 rule 17).
The unattended path does not depend on it — the ingestion worker allocates its own name under
a row lock. This is a **suggestion and never an invariant**; nothing reads it back.

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

## Trash (§7, TD-5, BR-15 — Revision 52)

| | Path | Audience | Notes |
|---|---|---|---|
| `GET` | `/admin/trash` | 👤 | Soft-deleted records: entity, label, who deleted it, when, `purge_after`. Filters `entity` `deleted_by` `from` `to` `q` |
| `POST` | `/admin/trash/{id}/restore` | 👤 | **Per entity type.** Refused loudly for anything that cascades |

**`restorable` is a server decision, published per row.** A client cannot know which deletions
cascade, and one that guessed would offer a button that silently half-restores a person.
**Restorable today: `Branch`, `Category`, `Subject`, `Room`** — the types whose deletion is
*guarded* rather than cascading, so nothing was removed alongside them. Everything else answers
`409` with `CASCADE_RELATIONSHIPS` or `CASCADE_CHILDREN`, and the screen states the reason
rather than merely hiding the action.

**Two further guards:** `PARENT_DELETED` (a Room whose Branch is still binned would be alive but
unreachable) and `ALREADY_PURGED` (BR-15 removed the row; the snapshot alone cannot safely
recreate it, since every foreign key it names may have gone too).

**There is no permanent-delete route.** BR-15's window is enforced by `content.quarantine-purge`;
a manual override is a data-retention decision and needs its own revision. **The `snapshot` is
never on the wire** — it is the whole row, including columns no screen is entitled to.

## Registration and approvals

| | Path | Audience | Notes |
|---|---|---|---|
| `POST` | `/registrations` | 🌐 + token | Gated by the signed onboarding token; no session exists yet. **Identity comes solely from the token payload.** `category_id` (the stage asked for) and optional `requested_role: 'teacher'` — **a hint that grants nothing** (R49) |
| `GET` | `/admin/approvals` | 🔒 | Deliberately **unscoped** — the permanent path by which a branch Admin meets applicants |
| `POST` | `/admin/approvals/{id}/approve` | 🔒 | Atomic bundle activation, **plus the §4.1 placement**: `enrollments: [{ user_id, administrative_group_id }]`, and optional `assignments: [{ role, branch_id }]`, all in **one transaction** |
| `POST` | `/admin/approvals/{id}/reject` | 🔒 | Body carries a reason |
| `POST` | `/family-links` | 🔒 | **Staff-mediated** link of an existing child. Parents have no search over children |
| `DELETE` | `/admin/family-links/{id}` | 🔒 | Soft delete **is** the revocation — effective on the next request |

## Users, consents, and case files

| | Path | Audience | Notes |
|---|---|---|---|
| `GET` `POST` | `/admin/users` | `?beneficiaries_only=true` returns the institute's مستفيدات (R79) — the durable fact, **independent of role and of enrolment**. The flag is never published |
| `GET` `POST` | `/admin/users` | 🔒 | List with search (carries `version`, so the edit form needs no second read); create pre-provisions against a Google address |
| `PATCH` | `/admin/users/{id}` | 🔒 | The person's own fields. **`account_status`, `pre_provisioned_email` and `public_display_name` are refused, not dropped** |
| `POST` | `/admin/users/{id}/suspend` | 🔒 | TD-1 `Active → Suspended`; **revokes every live session in the same transaction** (TD-4.15). Reason mandatory |
| `POST` | `/admin/users/{id}/reactivate` | 🔒 | TD-1 `Suspended → Active`. Sessions stay revoked; `Rejected` is terminal and unreachable |
| `PUT` | `/admin/users/{id}/roles` | 🔒 | **Replaces** the whole assignment set. Administrator roles are Super-Admin-only to grant or revoke |
| `GET` `POST` | `/students/{id}/consents` | 🔒 | Versioned records; staff-recorded grants carry the actor |
| `GET` `PUT` | `/students/{id}/social-profile` | 🔒 | **Both reads and writes audited.** Out of scope answers `404`, never `403` |

### Approval is the act that admits somebody (§4.1, Revision 43)

**`enrollments` is not an optional extra — it is what approval *is*.** §4.1: *"Approval and
every resulting `Enrollment` row are written in one transaction — an approved account with no
enrollment is a person the platform admitted and then lost."* An approval that would leave an
admitted student unplaced is **refused** (`400`, `reason: ENROLLMENT_REQUIRED`), naming who is
missing.

**Who must be placed is derived, never asked for**: the children of a family registration (the
parent's access comes through the family link), or a lone applicant, and **nobody for a staff
request** — a teacher is not admitted to a Level. Only people in the bundle may be named
(`NOT_IN_BUNDLE`), or approval would be an unscoped enrolment endpoint.

**`level_id` is not accepted** — the group already names its Level, and `Enrollment.level_id` is
read from the group so a composite FK keeps them agreeing rather than a caller. **Exactly one
group per Level**, with BR-21's partial unique index as the backstop. **Teaching Groups are
never assigned here**: at approval nobody yet knows how each Subject will be split.

Placement runs through the **same function the roster screen uses**, so it carries the
branch-scope check, §4.4b's `gender_restriction` vs `User.sex` rule, BR-21 and the consent
re-evaluation enqueue.

**§4.1 step 1's preselection works** because registration records the stage the applicant asked
for (`User.intended_category_id`, R49). The approval screen filters the Level list to that
Category and preselects its first Level — **a default, not a decision**, so *"any Category"*
stays one click away for an applicant who chose the wrong stage. An applicant registered before
R49 has no Category, rendered as *not stated* rather than guessed.

**`category_id` is required for a student and refused for a staff request** — a teacher is
admitted to no Level. The form populates it from the **live Categories ordered by
`display_order`**, read from `/calendar/bootstrap`, which already publishes exactly that list
publicly. **Deleting a Category is refused while pending requests reference it**
(`blocked_by.pending_requests`); decided requests never block, and the TD-5 soft delete keeps
them readable.

### The staff registration workflow needed no new endpoint

A prospective teacher self-registers through the adult form with
`requested_role: 'teacher'`; the request appears in طلبات الانضمام, distinguishable from a
family registration for the first time; a Super Admin approves and grants the role and its
branch scope in one transaction. **Admins creating staff directly was already complete** —
`POST /admin/users` pre-provisions with role and scope, which §4.1 calls the first-class staff
path.

**`requested_role` grants nothing** and accepts only `teacher`: administrator accounts arrive
by pre-provisioning, an authenticated path with a named actor, and a database `CHECK` makes
widening the set an SRS revision rather than a code change.

**A role's branch scope is never collected at registration.** `branch_id` is the branch the
applicant *asked for* (R39 — a request, not a placement); a role's scope is an authorization
boundary (TD-2), and collecting it from the applicant would let a person propose the extent of
their own permissions.

**The grant runs through the same function `PUT /admin/users/{id}/roles` uses**, so approval
cannot become a weaker path to authority: administrator roles stay Super-Admin-only, and a
refused grant takes the activation with it. Rejection grants nothing whatever the caller sends.
Drafted in [SRS-PROPOSAL-R49](../SRS-PROPOSAL-R49.md).

**Suspension is a verb, not a field**, because TD-4.15 binds the transition to revoking every
live `RefreshToken` in the same transaction — a client that set `account_status` on the edit and
received `200` would believe access had been withdrawn while a 30-day credential was still
live. It is the same rule that makes `PATCH /sessions/{id}` refuse `status`.

**A user outside a branch Admin's §4.2 R25 visibility answers `404`, never `403`** (§20 rule
17) — *exists, but not yours* is itself the disclosure that rule prevents.

**Two guards keep the platform out of its own lockout-recovery path.** The last active Super
Admin cannot be stripped of the role or suspended (`LAST_SUPER_ADMIN`), and nobody may suspend
their own account (`SELF_SUSPENSION`). Revision 22 documents that lockout as a recovery needing
`DATABASE_URL` and a manual seed run — not something a back-office control may cause.

**`super_admin` is grantable through `PUT .../roles` but not through `POST /admin/users`.**
Revision 22 requires administrator changes to happen *exclusively through the application*;
pre-provisioning an unclaimed account straight into the highest role is a different risk from
promoting one that already exists and has been approved. Drafted in
[SRS-PROPOSAL-R48](../SRS-PROPOSAL-R48.md).

**A role change deliberately does not revoke sessions** — Revision 10 accepts the ≤1-hour
stateless window for everything that is not safeguarding-sensitive, and those operations
re-assert live assignments per request. §7's `RefreshRevokedReason` values describe logout,
safeguarding action, replay, and R101's one-time cookie-Path rollout; none honestly describes
a demotion.

**There is no user-delete endpoint.** §5.6 lists *deactivate*; a person's soft delete reaches
grades, submissions, Quran logs and consent records, which is its own decision.

## Reference data

Writes are Super Admin only; Admins read within scope. **Teachers have no access at all** —
they receive reference information through the operational APIs they are authorised to use.

| | Path | Audience |
|---|---|---|
| `GET` `POST` | `/admin/branches` | 👤 write · 🔒 read |
| `PATCH` `DELETE` | `/admin/branches/{id}` | 👤 |
| `GET` `POST` | `/admin/branches/{id}/rooms` | 👤 write · 🔒 read |
| `PATCH` `DELETE` | `/admin/rooms/{id}` | 👤 |
| `PATCH` | `/admin/branches/order` | 👤 — `{ ids }`, the whole live set |

### Curriculum taxonomy — Categories, Subjects, Levels

Documented by the §5.6 screens and the §14.2 screen standard, exactly as Branches and Rooms
are (the Revision 21 pattern). SRS wording is drafted in
[SRS-PROPOSAL-R47](../SRS-PROPOSAL-R47.md).

| | Path | Audience |
|---|---|---|
| `GET` `POST` | `/admin/categories` | 👤 write · 🔒 read |
| `PATCH` `DELETE` | `/admin/categories/{id}` | 👤 |
| `POST` | `/admin/subjects` | 👤 (the `GET` is the selector below) |
| `PATCH` `DELETE` | `/admin/subjects/{id}` | 👤 |
| `GET` `POST` | `/admin/levels` | 👤 write · 🔒 read. `?eligible_for_student=` narrows to the Levels **that beneficiary** may enter — R27's sex restriction and BR-21's uniqueness, both resolved server-side. **No `sex` is published**: the eligible set travels and the fact behind it does not |
| `PATCH` `DELETE` | `/admin/levels/{id}` | 👤 |
| `PATCH` | `/admin/categories/order` | 👤 — `{ ids }` |
| `PATCH` | `/admin/subjects/order` | 👤 — `{ ids }` |
| `PATCH` | `/admin/levels/order` | 👤 — `{ within: categoryId, ids }`, one Category's Levels |

**`POST /admin/levels` creates the Level *and* its first Administrative Group** (TD-4.6b) in
one transaction, which is why it takes a `branch_id` the Level itself never stores: a Level
with no group is a Level nobody can be admitted to, so that state never exists rather than
existing until something fills it in. A `branch_id` **column** would instead make a Level
branch-local and break `entire_level` teaching mode (§4.4c).

**`DELETE /admin/levels/{id}` is the inverse and takes those groups with it.** Every Level owns
at least one group by construction, so a guard that counted groups would make deletion
unreachable; the enrolment, schedule and grade guards have already established the groups are
empty, and the audit row names the cascaded ids.

**`PATCH /admin/levels/{id}` refuses `category_id` rather than ignoring it.** A move would
re-file every enrolled student into a different educational stage, and §2.2 scopes
`display_order` *within* the Category. Dropping the key silently would let a client believe the
move succeeded.

**Deleting a Category never cascades its Levels** — a Level carries enrolments, groups and
schedules, and cascading would delete a live curriculum from a control labelled *delete
category*.

## Reference-data selectors

**TD-3 extension, Document Owner decision 2026-08-05.** `POST /admin/course-schedules`
requires `subject_id` and `academic_year_id`, and nothing in TD-3 could list either — the
§5.6 schedule form was unbuildable.

| | Path | Returns |
|---|---|---|
| `GET` | `/admin/subjects` | `id`, `name`, `display_order`, `version` |
| `GET` | `/admin/academic-years` | `id`, `label`, `is_current` |
| `GET` | `/admin/levels/{levelId}/subjects` | Which Subjects a Level teaches (§4.4b) |
| `PUT` `DELETE` | `/admin/levels/{levelId}/subjects/{subjectId}` | 👤 Assign / remove. `PUT` is idempotent in effect; removal is refused while Teaching Groups exist |

**These are the canonical source for every admin selector needing a Subject or an Academic
Year.** A screen that needs one reads these; it does not grow its own list. Widening
`/calendar/bootstrap` was rejected — its contract is *the calendar screen's* reference data,
publicly cached, and an unrelated screen must not shape it — as was a screen-specific payload,
which is how a second source of truth for one concept begins.

**Both are unpaginated**, deliberately: a selector offering a subset misrepresents the choice
available, and both sets are bounded by the curriculum. **Neither carries a `version`** — there
is no write, so the field would have no use and would become something a client depends on.
Admin and above (TD-2 R26); **Teachers are excluded** (R30 — reference data is an
administrative concern).

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
| `PATCH` | `/admin/administrative-groups/order` | `{ within: levelId, ids }` — one Level's groups, within the caller's branch scope |
| `PATCH` | `/admin/teaching-groups/order` | R78.1 — `{ within: { level_id, subject_id }, ids }`. **`within` is an object**: a circle's position is meaningful only among the circles splitting the same Subject at the same Level (§2.2), so neither half alone names the collection. Supersedes R76.7's exclusion |
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
| `GET` `POST` | `/admin/course-schedules` | **`GET` is role-scoped:** Super Admin sees all, a branch Admin their branches, a **Teacher the schedules they staff**. `POST` is Admin. Filters narrow within scope. A write returns `{ schedule, materialization }` |
| `PATCH` `DELETE` | `/admin/course-schedules/{id}` | Only the *when* and the *room* are editable. `DELETE` answers `200 { future_removed, retained }` |
| `GET` | `/admin/course-schedules/{id}/conflicts` | Computed against **materialized Sessions**, never against recurrence rules |
| `GET` | `/admin/course-schedules/{id}/roster` | The **resolved** audience — recomputed per request, never a stored snapshot |

**One endpoint, role-scoped — `/admin/` is a routing namespace, not an authorization
boundary** (Document Owner decision, 2026-08-05). A Teacher's *My Teaching* screen (§14.1,
§5.6 line 753) consumes this same route and receives the schedules they staff, resolved through
`CourseScheduleStaff` (§4.4c). A second teacher route was rejected: the representation is
byte-identical, so it would have been duplication rather than separation. **Reading is not
managing** — `POST`, `PATCH`, `DELETE` and `/conflicts` stay Admin, because §14.1 says teachers
*do not create or edit schedules*. A teacher who staffs nothing gets an **empty list, not a
`403`**: they may ask the question, and their scope resolves to nothing. An explicit filter can
**narrow** a caller's reach but never widen it. The same rule governs `/roster`, which §5.6
grants a teacher for a schedule they staff; one they do not staff is `404`, never `403`.

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

**Editing asks which occurrences it applies to (§4.4, Revision 50).** `PATCH` takes `scope`:
`all_sessions` (default — future un-overridden Sessions are rewritten) or `this_and_future`,
which requires `from_date` and **splits the schedule**. The current one is closed at
`from_date − 1 day` via `effective_until`; a **successor** carrying the new values is anchored
at `from_date`, **with its staff copied** — without that the teacher silently disappears from
every future Session. Past Sessions are untouched and overridden ones keep their overrides,
because the split asks the same protection predicate every other scheduling path asks (R43.6).

**The response is the successor**, plus `split_from_schedule_id` naming the closed half, so a
client can tell its list now holds two rows where it held one.

**"This session only" is not a scope here** — it is `PATCH /sessions/{id}`, a different endpoint
on a different resource, because it edits one occurrence rather than the rule that produced it.

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
| `GET` | `/library` | 🌐 **Public and anonymous.** `?category_id=` `?level_id=` `?academic_year_id=` `?subject_id=` `?page=`. Paginated (TD-10). Carries `suggested_recording_name` beside `data`/`meta` (R75.6, server-owned since R99) — `null` with no Subject in view |

**Each item carries the §5.2 headings resolved server-side** — `category_id`/`category_name`,
`level_name`, `subject_name`, `academic_year_label`, `branch_name`. That view groups
Category → Level → Academic Year → Branch, and **no public endpoint publishes Subject or
Academic Year names**: `/admin/subjects` and `/admin/academic-years` are Admin-only by design
(R30), and `/calendar/bootstrap` carries Categories, Levels and Branches but neither of those.
Carrying them makes the response self-sufficient, which TD-3.4 already requires of the calendar;
the alternatives were widening that cached payload for an unrelated screen, or a new public
reference surface exposing the whole curriculum to anonymous callers. **They are labels, never
identifiers.** `branch_name` is `null` exactly where `branch_id` is, and that means **Global**.

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

## Storage — uploads, replacement, deletion and the mint (TD-3.5)

| | Path | Notes |
|---|---|---|
| `POST` | `/uploads/initiate` | Phase one. Returns `{ upload_id, key, put_url, expires_in }`. `content_meta.origin` (R99.12) states `uploaded` or `session_recording` — a description, never a permission |
| `POST` | `/uploads/{upload_id}/complete` | Phase two. Body `{ title, description? }` only |
| `POST` | `/uploads/{upload_id}/abort` | Best-effort; deletes the object |
| `DELETE` | `/content/{id}` | R53. Soft delete + Trash snapshot + quarantine |
| `GET` | `/content/{id}/download-url` | Short-lived presigned GET after the §4.9 check |

**The file never passes through the API.** The browser PUTs straight to MinIO through the
presigned URL, which is why the flow has two phases at all — the server sees the object only
after it exists. On a 4 GB VPS with mobile users, proxying a 100 MB upload through the API
container is not an option (§2.3).

**Everything decidable before a byte moves is decided at `/initiate`:** the §4.9 branch scope,
the TD-9 whitelist, the TD-9 size cap, and the per-user quota. A teacher on a phone connection
must learn they cannot publish Globally *before* uploading eighty megabytes, not after.

**`/complete` decides only what the object itself can answer.** A **ranged GET of
`bytes=0-511`** for the magic bytes and a **HEAD** for the true size (§4.9, Revision 8) — the
server never streams or buffers the file. A mismatch deletes the object, creates no row, and
answers **`409 VALIDATION_FAILED`**: the request was well-formed, the object was not what it
claimed. TD-3.8 records that status as the *"409 variant on upload complete"*, and it is the
only place in the catalog where a code's status varies.

### `upload_id` is a signed ticket, not a database row

§7 defines **no pending-upload entity**, and inventing one would have been a schema decision
the specification never took — plus a table that can disagree with the bucket, and a
reconciliation problem where there was none. The ticket carries the state instead, and
`upload.gc` (TD-7) then reaps *objects* older than 48 h that no content row claims, which is
the thing that actually needs collecting.

**It binds every authorization decision taken at phase one** — the caller, the key, the bucket,
the declared size and type, and the §4.9 scope fields. Without that, a Teacher could initiate
inside their branch and complete into the Global scope, and the check at phase one would be
decorative. **Title and description are deliberately *not* bound**: they are free text no
authorization turns on, and keeping them out of a URL path segment holds the ticket to a few
hundred bytes.

The signing key is derived from `JWT_SIGNING_KEY` by HKDF under its own label, so an upload
ticket and an access token can never be exchanged for one another — the separation TD-13
requires between token classes, without a configuration variable TD-13 does not list.

### Replacement extends the upload flow (R53)

`content_meta.replaces_content_id` targets an existing record. The same two phases run, and
completion updates that row: **a new key with a new hash segment, the previous object
quarantined, `version` incremented.** Keys are never reused or overwritten (TD-9, §20 rule 15),
so a cached URL of the old object can never mask a newer upload.

It is **not** a route of its own, because a replacement *is* an upload — the same presigned PUT,
whitelist, cap, magic-byte check and quota. A second route would be that flow written twice, and
resolving the target at `/initiate` means an unauthorized replacement is refused before a URL is
ever minted.

### Video is not accepted

TD-9's whitelist names audio, documents, slides and images and **no video type at all**, and
§4.9 (Revision 12) states *"video remains excluded entirely"*. The library client still maps
`video/*` for **presentation**, because the two lists answer different questions — what may be
stored, versus how a stored thing is shown. Accepting video is a Document Owner decision and an
SRS revision, not an implementation detail.

### The mint is where three rules meet

1. **TD-12 freshness.** *"Statelessness ends where safeguarding begins."* `account_status` and
   the role assignment are re-read from the database on **every** request, so a Teacher
   suspended mid-session loses access to a private recording at once rather than at token expiry.
2. **The §4.9 tiers**, applied through **the same predicate `GET /library` uses**. The rule that
   decides what a person may see in a list is the rule that decides what they may open; a second
   expression of it is the duplication this project has been bitten by before.
3. **Child context** (§4.3) for a Parent acting on a minor's behalf — and here, unlike the
   library listing, the private tier narrows to **that one child**. The two surfaces genuinely
   differ, and they differ in the direction that is safe: browsing is a shared reading surface,
   while minting a URL for a private recording is the safeguarding-sensitive act TD-12 singles
   out. The `childContext` middleware is **not** mounted on the route, because staff reach
   content by a different path and would be asked for a header they have no reason to send; the
   resolver is called directly for exactly the callers the rule is about.

The response carries `Cache-Control: no-store` — a shared cache would hand one caller's grant to
another — and out-of-scope content answers **404, never 403** (§20 rule 17).

### The per-user upload quota (TD-4.12)

**30 per hour**, counted in PostgreSQL **inside the initiating transaction** under a row lock.
Reading the count outside it would let two initiations at the boundary both see 29 and both
pass. Revision 14 is equally explicit about where it may *not* live: not in process memory (dies
with the container, wrong across replicas) and not in pg-boss (a quota decision is synchronous).
Exhaustion is `429 RATE_LIMITED` in the standard envelope, identical in shape to an Nginx edge
rejection so a client handles one thing.

## Events

| | Path | Notes |
|---|---|---|
| `POST` | `/events` | Writes the four-way scope joins **explicitly at creation** |
| `PATCH` `DELETE` | `/events/{id}` | |
| `POST` | `/events/{id}/notify` | Optional post-change announcement; see [Notifications](#notifications) |
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
| **Jobs** | `GET /jobs/{id}` — any endpoint that enqueues returns `202` with a job id |

**Post-MVP, deliberately absent:** grading-template routes, multipart upload endpoints, CSV
import/export, the Hijri importer.

### What the library screen still needs

**This section previously claimed no route anywhere in the SRS lists content.** That was true
when it was written and **Revision 43 superseded it**: TD-3.13 specifies `GET /library`, which
is now built and mounted. The remaining items are genuine, and smaller than the gap once was.

| Needed | For | Status |
|---|---|---|
| `GET /content/{id}/download-url` | Every preview and download | **Built** — see *Storage* above |
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
