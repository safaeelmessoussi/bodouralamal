[Documentation](../README.md) › [Reference](README.md) › **API endpoints**

# API endpoints

**156 operations across 120 paths**, all under `/api/v1` except `/healthz` and the Nginx storage hook; the generator reconciles against the live router, so `openapi.json` wins over this line.
- Schemas: [`openapi.json`](../openapi.json), generated, never hand-edited. Conventions: [API](../architecture/api.md). Every response is a contract DTO, never an ORM entity ([why](../architecture/api.md#the-contract-is-an-interface-not-a-serialisation)).
- Audience: 🌐 public/anonymous · 🔒 authenticated · 👤 Super Admin only (enforced in the service, not by the URL prefix) · 🍪 refresh cookie.

## Health and internal

| | Path | Audience · semantics |
|---|---|---|
| `GET` | `/healthz` | 🌐 Origin root, not under the prefix. Readiness for database, storage, pg-boss (`queue`) and registered workers (`jobs`; reasons/counts under `details.jobs`; schema presence alone insufficient) |
| `GET` | `/internal/storage/public-authorize` | Nginx `internal` auth subrequest only; checks the exact current public storage coordinate against BR-2/TD-4.9; no browser or client calls it |

## Authentication

| | Path | Audience · semantics |
|---|---|---|
| `GET` | `/auth/google` | 🌐 Redirect to Google with state + PKCE |
| `GET` | `/auth/google/callback` | 🌐 Routes by identity resolution; failures redirect, never JSON |
| `POST` | `/auth/refresh` | 🍪 One of exactly two refresh-cookie consumers; custom header and `Origin` match required; rotates the session |
| `POST` | `/auth/logout` | 🍪 The other consumer, same CSRF checks; revokes the current server-side session only, expires the cookie; idempotent `204` |
| `GET` | `/me` | 🔒 Identity, roles, scopes, status, approved child links; one of only two endpoints a Pending session may call |

## Notifications

Bounded types admitted by R77, R78, R82, R83, R93 and R116; the postponed framework stays postponed: no tier, `NotificationPreference`, delivery channel or per-child preference.

| | Path | Audience · semantics |
|---|---|---|
| `GET` | `/notifications` | 🔒 The caller's own only; no role widens it. Paginated (TD-10), newest first, `id` tiebreaker; `?unread_only=true`; `meta.unread` travels with the list |
| `POST` | `/notifications/{id}/read` | 🔒 Idempotent; a retry does not move the timestamp; another user's row is `404`, never `403` (§20 rule 17) |
| `POST` | `/events/{id}/notify` | 🔒 Optional Event announcement after the saved create/reschedule/cancellation; body `{ change }`; recipient ids refused |
| `POST` | `/sessions/{id}/notify` | 🔒 R83's independent occurrence decision after a cancellation or reschedule; body `{ change }` |

R116 adds no route; automatic notices join the domain writes:

| Type(s) | Trigger → recipient | Privacy and retry rule |
|---|---|---|
| `registration_review_required` | Complete submission → live Admin/Super-Admin approvers | Targets the applicant; submitter/actor excluded; one row per approver/applicant/type |
| `registration_approved`, `registration_rejected` | Adult activation → applicant; child approval/rejection → active parent, child as exact target | Adult rejection uses the deactivated-status screen (TD-1 gives it no inbox); distinct children stay distinct; decision and notice commit together |
| `family_link_requested`, `family_link_approved`, `family_link_rejected`, `family_link_revoked` | Link lifecycle → parent, targeting the child | No child search/list exposed; actor excluded; stale opposite state not duplicated |
| `role_assignments_changed` | Real role/scope set change → affected User | Same-set saves silent; no role/scope inferred from the notice |
| `platform_ownership_received` | Atomic transfer → new Platform Owner | Written only after eligibility/locking succeeds; former Owner gets no self-report |
| `enrollment_changed` | Placement create/move/material edit/removal → student | Uses the committed placement fact; unchanged writes silent |
| `session_assigned`, `session_unassigned` | Exact occurrence restaffing → added/removed person | Hidden Sessions: only `teacher` eligible; stale target rows withdrawn from students/assistants |
| `event_staff_assigned`, `event_staff_unassigned` | Event staffing change → added/removed person | Hidden Events: only `responsible` eligible; automatic, distinct from the optional announcement |
| `exam_teacher_assigned`, `exam_teacher_unassigned` | Exam staffing change → eligible staff | Hidden Exam exposes no target to an assistant; supervisor-only; remove/re-add withdraws the opposite fact |
| `exam_scheduled` | Physical Exam creation or audience entry → grade-sheet student audience | Hidden produces no student row; exact Group or Level+Branch scope only |
| `exam_rescheduled` | Date/start/end change → retained authorized students and staff | Time changes only; no-op save silent |
| `exam_changed` | Material non-time detail change → retained authorized students and staff | A title/room edit is not a reschedule; hidden is supervisor-only |
| `exam_cancelled` | Exam deletion or audience departure → current/removed authorized recipient | Deletion leaves current recipients only cancellation; hidden stays supervisor-only |

- Pre-R116 types remain exact: `session_cancelled`, `session_restored`, `session_rescheduled`; `event_created`, `event_rescheduled`, `event_cancelled`; `grade_published`. A dual-role Exam recipient keeps both assignment and scheduling rows.
- Idempotency coordinate `(recipient, exact target, type)`: a retry/no-op creates nothing and does not resurface a read row; a proved new transition reuses the row as unread and withdraws stale opposite facts; exactly one of `session_id`, `event_id`, `exam_id`, `subject_user_id` is populated.
- Upload completion emits no content notice (storage finalization is not publication).
- An optional send is a separate request after the change commits (R82.5, R83.3); declining is its absence; a notification failure never rolls back the change.
- Session changes keep their R77/R83 audience resolver; Event create/reschedule resolve the live scope; Event cancellation (soft deletion hard-removes the four scope joins) reads ids from the Trash snapshot and requires the actor to be the recorded deleter; no second Event copy, `purge_after` unchanged.
- Recipient sets server-resolved, actor excluded, partial unique indexes make repeats idempotent; Event recipients = scoped enrolments ∪ live Event staff; a global Event has no audience (R82.7).
- Restoring reconciles: an *unread* stale notice is withdrawn; a *read* one becomes `session_restored`.

## Public

| | Path | Audience · semantics |
|---|---|---|
| `GET` | `/calendar` | 🌐 Occurrences at the caller's tier; optional token, invalid/Pending/role-less callers get public only; self-sufficient; uncached |
| `GET` | `/calendar/sessions/{id}` | 🌐 Dialog data `{ occurrence, notes, recordings, linked_content, suggested_recording_name }` at the caller's tier (never a public session's private recordings); not a frontend page route |
| `GET` | `/calendar/bootstrap` | 🌐 Calendar reference data only, one read; cached 5 min + strong ETag; `?category_id=` narrows only the Level list (§4.4); unknown id → empty list |
| `GET` | `/clock` | 🌐 Morocco's current offset (R167 §2): `{ now, zone, utc_offset_minutes, in_force_since, next_change_at, source }`; cacheable five minutes |
| `GET` | `/site-config` | R175 §2 — `{ sign_in_offered }`. Public, anonymous, no personal data, no cookie, `no-store`. Driven by `SIGN_IN_OFFERED`; absent means offered |
| `GET` | `/branches` | 🌐 Landing directory: id, name, address, phone, email, opening hours, map link, display order; never version, operational start date, timestamps |

- `/clock` reads the HOST zone file (a decree needs no release); `source` is `host-zoneinfo` or `icu-fallback` (file unreadable, and says so); the browser formats with this offset, not its own zone data; `next_change_at` names only a real offset change.
- `GET /branches` is not the admin route relaxed: audience is part of the contract.
- Calendar filters (TD-3.4): `from`, `to`, `academic_year_id`, `category_id`, `level_id`, `subject_id`, `branch_id`, `administrative_group_id`, `teacher_id`; identical for anonymous and authenticated (§5.2). A filter a kind cannot satisfy excludes that kind: `subject_id`, `academic_year_id`, `teacher_id` narrow to Sessions; the other four filter both kinds (Events carry them via scope joins). `teacher_id` matches the session's own staffing snapshot (R43.4).
- Sessions carry `subject_id`, `subject_name`, `teaching_mode`, `audience_label` (Administrative Group, Teaching Group or Level name by mode; formerly inside `description`), `status`; cancelled sessions still appear.
- `prefilled_filters` is `null` for anonymous/Pending; a value is prefilled only when unambiguous; plural yields `null`, never *first*.
- Occurrence link: `/calendar?occurrence=<kind>:<id>&date=YYYY-MM-DD` (date is part of the coordinate for recurring Events); the calendar re-reads that day at the caller's tier, then opens the shared dialog. `occurrence` is byte-identical to the grid's (one `include`, one mapper, asserted by test).
- `recordings`/`linked_content` split by `origin` (R99.10): `session_recording` = «التسجيلات», else material; MIME decides only player/download. The replaced `audio/*`-is-a-recording rule called every audio a recording and made a video recording of a صوت وصورة class unrepresentable; `origin` survives replacing the media platform (§7, R99.9).
- `suggested_recording_name` (R75.6): server-composed default for the NEXT recording, class + date, numbered ` 2`, ` 3` against titles this caller can see (§20 rule 17) whatever produced them; the ingestion worker allocates its own under a row lock; a suggestion, never an invariant.
- Both lists use the library's exported §4.9 tier predicate (R170 §3: tier alone); items are exactly `id`, `title`, `subject_id`, `level_id`, opened inside the Library (§5.2), never the object location.
- `notes` is always `null` and the key ships: TD-3.4 names it, §7 gives `Session` no notes column (`User.notes` is different); adding one is a §7 Document Owner decision, like the deferred `EducationalContent` uploader.

## Trash (§7, TD-5, BR-15 — R52)

| | Path | Audience · semantics |
|---|---|---|
| `GET` | `/admin/trash` | 👤 Soft-deleted records: entity, label, deleter, when, `purge_after`; filters `entity` `deleted_by` `from` `to` `q` |
| `POST` | `/admin/trash/{id}/restore` | 👤 Per entity type; cascading types refused loudly; answers `seats_restored`/`seats_not_restored`, `sessions_restored`/`sessions_not_restored`, `event_links_restored`/`event_links_unknown` (R169 §8) |
| `DELETE` | `/admin/trash/{id}` | 👤 R59.1 permanent deletion of server-declared purgeable types; audited |

- `restorable` is published per row by the server. Restorable: `User` (R111; three-day soft-delete removes no relationship row; revoked credentials stay revoked), `Branch`, `Category`, `Subject`, `Room`, `Exam` (reinstates exactly its staff rows; a future Exam revalidates every supervisor under lock, refusing whole with `STAFF_ACCOUNT_UNAVAILABLE`), `HijriMonthStart`, and since R169 §8 `Level`, `TeachingGroup`, `RecurringCourseSchedule` (room/staff booked since → `409 SCHEDULE_CONFLICT`).
- Everything else `409` with a stable reason the screen states; guards `PARENT_DELETED` (Room whose Branch is binned), `ALREADY_PURGED` (BR-15 removed the row).
- `DELETE`: `purgeable` per row; deletes only a declared entity/owned-child plan; independent FK referrers → `DEPENDENTS_EXIST`; retains the `trash.permanent_delete` audit row; `User` is not hard-purgeable (R111 de-identifies). The `snapshot` (whole row) is never on the wire.

## Registration and approvals

| | Path | Audience · semantics |
|---|---|---|
| `POST` | `/registrations` | 🌐 + signed onboarding token (sole identity source); new applicants require phone; adult and each child carry own Branch/Category; grants nothing |
| `GET` | `/admin/approvals` | 🔒 Unscoped; rows carry `role_requests[]` (`kind`, `status`, `first_time`), `circle_preferences[]` (R168 §1), `account_active` (R169 §1); authorized complete-details projection |
| `POST` | `/admin/approvals/{id}/approve` | 🔒 Adult-beneficiary approval atomically activates and places; guardian activates the parent only; `assignments` carries approved staff roles |
| `POST` | `/admin/approvals/{id}/reject` | 🔒 Body carries a reason; both whole-account acts answer `DECIDE_PER_ROLE` for several role requests or a lone `administration` (R168 §1) |
| `POST` | `/admin/approvals/{id}/roles/{kind}/approve` | 🔒 One role on its own (R168 §1); `{kind}` ∈ `student · guardian · teaching · administration`; `administration` 👤; answers `{ status, account_status }` |
| `POST` | `/admin/approvals/{id}/roles/{kind}/decline` | 🔒 `{ reason }` (§5.6); declining `guardian` rejects pending child applications with it; `rejected` only when every request is declined |
| `GET` | `/profile/role-requests` | 🔒 R169 §1: own requests (`kind`, `status`, `decided_at`), `askable` (not held, not waiting, never `guardian`), `held[]` (R170 §1, live role rows) |
| `POST` | `/profile/role-requests` | 🔒 R169 §1: an ACTIVE account asks for a further or declined role; opens or re-opens one `RoleRequest`, notifies approvers, grants nothing |
| `GET` | `/registration/circle-slots` | 🌐 `?category_id=&branch_id=`: SCHEDULED weekly classes of the Category's first Level (`{ level, circles[], fixed[] }`); name, days, times only; never a hidden class |
| `POST` | `/family-links` | 🔒 Staff-mediated link of an existing child; parents have no child search |
| `DELETE` | `/admin/family-links/{id}` | 🔒 Soft delete is the revocation, effective next request |

- `POST /registrations`: `requested_role: 'teacher'` requires R115 framing and is the only accepted value; `kind: 'roles'` (R168 §1) asks for any combination of `student · guardian · teaching · administration` with ONE `applicant` and a section per role (`student.first_time`; first registration's ranked `circle_preferences`); no field names an administrative role.
- `GET /admin/approvals`: an ACTIVE account with a pending request stays listed (`account_active`), decided per role, never whole; `review_user_id` returns at most that applicant's pending review, stale → empty page; compact Branch/Category only when unambiguous.
- Guardian registration creates no beneficiary/Student/Enrollment; each child is decided through the child endpoint.
- `roles/{kind}/approve` `.strict()` body: `student` → `{ enrollment }` (R66.5: a group, or Level + branch); `teaching`/`administration` → `{ grant: { role, branch_id \| null } }` (approver's choice); `guardian` → `{}`; the account turns `active` on the first approval.
- `POST /profile/role-requests`: `student` (consent; `birth_date` only where none recorded), `teaching { framing }`, `administration { branch_id \| null }`; `409 ROLE_ALREADY_HELD` / `ALREADY_PENDING` / `BIRTH_DATE_ALREADY_RECORDED`; `400 BIRTH_DATE_REQUIRED` / `CIRCLE_NOT_OFFERED`. The decline reason is never projected to the applicant.
- Approval is admission (§4.1, R43): an approval leaving an admitted student unplaced is refused `400 ENROLLMENT_REQUIRED`, naming who is missing; who must be placed is derived (the lone adult beneficiary, or the one child); nobody is placed for a staff request; `level_id` is not accepted (the group names its Level, composite FK); exactly one group per Level (BR-21); Teaching Groups never assigned at approval; placement uses the roster function (branch scope, §4.4b `gender_restriction` vs `User.sex`, BR-21, consent re-evaluation enqueue).
- Preselection (§4.1 step 1) reads `User.intended_category_id` / `ChildApplication.requested_category_id` and preselects that Category's first Level (a default); a legacy null renders *not stated* with all Categories; one sibling's request is never reused. `category_id` is required for a student, refused for staff; Categories come from `/calendar/bootstrap` by `display_order`; deleting a Category is refused while pending requests reference it (`blocked_by.pending_requests`); decided requests never block.
- Staff registration needed no new endpoint: the adult form with `requested_role: 'teacher'` shows in طلبات الانضمام; a Super Admin approves and grants role + scope in one transaction via `PUT /admin/users/{id}/roles`' function (administrator roles Super-Admin-only; a refused grant takes the activation with it; rejection grants nothing); `POST /admin/users` pre-provisions staff (§4.1 first-class path); a database `CHECK` makes widening `requested_role` an SRS revision.
- Branch scope is never collected at registration: a learner's `branch_id` is the branch requested (R39); a هيئة التأطير applicant states physical/online willingness (possibly several/all branches); the approver chooses the scope (TD-2); the preference stays read-only on both profile reads and in neither profile write.

## Users, consents, case files

| | Path | Audience · semantics |
|---|---|---|
| `GET` `POST` | `/admin/users` | 🔒 `?beneficiaries_only=true` returns the institute's مستفيدات (R79), independent of role and enrolment; the flag is never published |
| `GET` `POST` | `/admin/users` | 🔒 Live Active/Suspended rows, excluding Pending/Rejected; list carries `version`; create pre-provisions an Active account against a Google address |
| `GET` | `/admin/directory` | 🔒 People-picker: live Active rows only, so Pending/Rejected/Suspended accounts cannot be staffed or rostered |
| `PATCH` | `/admin/users/{id}` | 🔒 Own fields; `account_status`, `pre_provisioned_email`, `public_display_name` refused, not dropped |
| `POST` | `/admin/users/{id}/suspend` | 🔒 TD-1 `Active → Suspended`; revokes every live session in the same transaction (TD-4.15); reason mandatory |
| `POST` | `/admin/users/{id}/reactivate` | 🔒 TD-1 `Suspended → Active`; sessions stay revoked; `Rejected` is terminal |
| `PUT` | `/admin/users/{id}/roles` | 🔒 Replaces the whole set; administrator roles Super-Admin-only; the Platform Owner's global Super Admin assignment must remain |
| `POST` | `/admin/platform-owner/transfer` | 🔒 Current Platform Owner only; exact confirmation; target an active Global Super Admin; atomic, both roles unchanged |
| `DELETE` | `/profile` | 🔒 Deletes the caller only (R111); revokes sessions; three-day restoration window |
| `DELETE` | `/admin/users/{id}` | 👤 R111, same window; `?permanent=true` de-identifies now |
| `GET` `POST` | `/students/{id}/consents` | 🔒 Versioned records; staff-recorded grants carry the actor |

- Suspension is a verb (TD-4.15 revokes every live `RefreshToken` in-transaction); the same rule makes `PATCH /sessions/{id}` refuse `status`.
- Out of a branch Admin's §4.2 R25 visibility → `404`, never `403` (§20 rule 17).
- `LAST_SUPER_ADMIN` (last active Super Admin cannot be stripped or suspended) and `SELF_SUSPENSION` keep the platform out of R22's lockout recovery (`DATABASE_URL` + manual seed).
- `super_admin` is grantable via `PUT .../roles`, not `POST /admin/users` (R22; R48 draft superseded, see SRS R55+).
- A role change does not revoke sessions (R10 accepts the ≤1-hour window; safeguarding-sensitive operations re-assert assignments per request; no `RefreshRevokedReason` describes a demotion).
- `?permanent=true`: the User tombstone and its educational, consent, safeguarding and accountability relationships survive; personal fields, credentials, planning data erased; live responsibilities and the last active Super Admin refused with named `409` reasons; re-reads the tombstone under the normalized-email and User locks, `409 STATE_CONFLICT` / `NOT_DELETED` if a concurrent restore won.

## Reference data

Writes 👤; Admins read within scope; Teachers have no access (reference data reaches them through operational APIs). Taxonomy follows the §5.6 screens and §14.2 standard (R21 pattern; R47 draft superseded, see SRS R55+).

| | Path | Audience · semantics |
|---|---|---|
| `GET` `POST` | `/admin/branches` | 👤 write · 🔒 read |
| `PATCH` `DELETE` | `/admin/branches/{id}` | 👤 |
| `GET` `POST` | `/admin/branches/{id}/rooms` | 👤 write · 🔒 read |
| `PATCH` `DELETE` | `/admin/rooms/{id}` | 👤 `capacity` (`number \| null`, R169 §3) on every read; positive whole number or `null`; informational only (BR-23, §20 rule 22) |
| `PATCH` | `/admin/branches/order` | 👤 `{ ids }`, the whole live set |
| `GET` `POST` | `/admin/categories` | 👤 write · 🔒 read |
| `PATCH` `DELETE` | `/admin/categories/{id}` | 👤 Deleting a Category never cascades its Levels |
| `POST` | `/admin/subjects` | 👤 (the `GET` is a selector below) |
| `PATCH` `DELETE` | `/admin/subjects/{id}` | 👤 |
| `GET` `POST` | `/admin/levels` | 👤 write · 🔒 read; `?eligible_for_student=` narrows to Levels that beneficiary may enter (R27 sex restriction, BR-21, server-side); no `sex` published |
| `PATCH` `DELETE` | `/admin/levels/{id}` | 👤 `PATCH` refuses `category_id` (a move re-files every student; §2.2 scopes `display_order` within Category); `DELETE` cascades the groups (guards proved them empty; audit names ids) |
| `PATCH` | `/admin/categories/order` | 👤 `{ ids }` |
| `PATCH` | `/admin/subjects/order` | 👤 `{ ids }` |
| `PATCH` | `/admin/levels/order` | 👤 `{ within: categoryId, ids }`, one Category's Levels |

- `POST /admin/levels` creates the Level *and* its first Administrative Group (TD-4.6b) in one transaction, hence takes a `branch_id` the Level never stores; a `branch_id` column would break `entire_level` mode (§4.4c).

## Reference-data selectors

TD-3 extension (Document Owner, 2026-08-05): `POST /admin/course-schedules` needs `subject_id` and `academic_year_id`, which nothing in TD-3 listed.

| | Path | Audience · semantics |
|---|---|---|
| `GET` | `/admin/subjects` | 🔒 `id`, `name`, `display_order`, `version` |
| `GET` | `/admin/academic-years` | 🔒 `id`, `label`, `is_current` |
| `GET` `POST` | `/admin/academic-periods` | 👤 `id`, `academic_year_id`, `sequence`, `start_date`, `end_date`, `is_current` (derived from dates, never stored), `version`; `?academic_year_id=` optional |
| `PATCH` | `/admin/academic-periods/{id}` | 👤 `sequence`, `start_date`, `end_date` with TD-15 `version`; `academic_year_id` not accepted (would rewrite every enrolment's year) |
| `GET` | `/admin/levels/{levelId}/subjects` | 🔒 Which Subjects a Level teaches (§4.4b) |
| `PUT` `DELETE` | `/admin/levels/{levelId}/subjects/{subjectId}` | 👤 Assign / remove; `PUT` idempotent in effect; removal refused while Teaching Groups exist |

- Canonical source for every admin selector needing a Subject or Academic Year; widening `/calendar/bootstrap` (publicly cached calendar contract) and a screen-specific payload (second source of truth) were rejected.
- Unpaginated (a subset misrepresents the choice); no `version` (no write). Admin and above (TD-2 R26); Teachers excluded (R30).

## Educational organisation and delivery

R43 split the retired `Group` into organisational and delivery units ([Scheduling](../overview/business-processes.md#3-scheduling)); an Administrative Group has no room, teacher or capacity. Admin-managed within branch scope, asserted in the service: `/admin/` authenticates, not authorises.

| | Path | Audience · semantics |
|---|---|---|
| `GET` `POST` | `/admin/administrative-groups` | 🔒 `?level_id=` `?branch_id=` narrow within the caller's scope; a malformed filter is `400`, not an empty list |
| `GET` `POST` | `/admin/administrative-groups/{id}/roster` | 🔒 Enrolment reads the Level from the group, requires `academic_period_id` (R122), enqueues consent re-evaluation per session; no capacity check |
| `DELETE` | `/admin/administrative-groups/{id}/roster/{studentId}` | 🔒 Soft-deletes the enrolment only (grades, submissions, Quran logs survive); the Level's subject-split seats go with it |
| `PATCH` | `/admin/administrative-groups/order` | 🔒 `{ within: levelId, ids }`, one Level's groups within branch scope |
| `PATCH` | `/admin/teaching-groups/order` | 🔒 R78.1 `{ within: { level_id, subject_id }, ids }`; `within` is an object (a circle's position exists only within one Subject+Level, §2.2); supersedes R76.7 |
| `PATCH` `DELETE` | `/admin/administrative-groups/{id}` | 🔒 Only `name`, `display_order`; deletion blocked by enrolments, a targeting schedule, and being the Level's last group |

- A group is exactly `id`, `name`, `level_id`, `branch_id`, `display_order`, `version`; `max_students`, `room_id`, `teacher_id` and a weekly slot are refused, not dropped; `branch_id` answers *which branch is this person at* (`intended_branch_id` deliberately does not).

### «إتمام المستوى» and its certificate (R167 §3)

Admin or Super Admin within the branch of her enrolment at that Level; out of reach `404`; BR-11 stays derived, these record a separate fact.

| | Path | Audience · semantics |
|---|---|---|
| `GET` | `/admin/students/{id}/level-completions` | 🔒 One row per enrolled Level in reach: `requirements` (BR-11 read NOW; `complete` `null` without «مقرر الحفظ») beside `mark` (attestation + certificate) or `null` |
| `PUT` `DELETE` | `/admin/students/{id}/level-completions/{levelId}` | 🔒 Record / remove; unmet Level → `409 REQUIREMENTS_NOT_MET` until `acknowledge_unmet: true` (mark keeps `requirements_met: false`); `DELETE` → `409 CERTIFICATE_ISSUED` while issued; idempotent, audited |
| `PUT` `DELETE` | `/admin/students/{id}/level-completions/{levelId}/certificate` | 🔒 Confirm / withdraw (the SECOND confirmation); number drawn once, reused on re-issue; `409 LEVEL_NOT_COMPLETED` without a mark |
| `GET` | `/students/me/certificates` | 🔒 The ACTING student's CONFIRMED certificates (§4.3, no id): number, recorded name, Level, Category, branch, two Morocco calendar dates; page-rendered and printed, no file |

### Assessment builder (§4.6, R124)

The ONLINE half of `Exam` (R58 refused a second entity): `Grade` keyed `(exam_id, student_id)` already carries the 20-point scale, draft/published split, sheet and results screen.

| | Path | Audience · semantics |
|---|---|---|
| `POST` | `/assessments` | 🔒 A `draft` paper; `target` ∈ `level · administrative_group · session · teaching_group · student`; `date` refused on a session target, required otherwise |
| `POST` `PATCH` `DELETE` | `/assessments/{id}/questions[/{questionId}]` | 🔒 short text · long text · single choice · multiple choice; appended, never inserted; choice needs two options; text refuses options and justification |
| `PATCH` | `/assessments/{id}/questions/order` | 🔒 The whole sequence (R76) |
| `POST` | `/assessments/{id}/publish` · `/close` | 🔒 draft → published → closed; an empty paper is refused; closing stops answers, hides nothing |
| `GET` | `/assessments/{id}/submissions[/{studentId}]` | 🔒 Who answered, and one submitted paper; a draft in progress is not readable |
| `GET` | `/me/assessments` · `/assessments/{id}/paper` | 🔒 Hers; no student id anywhere, the subject is the JWT `sub` (§4.3) |
| `PUT` `POST` | `/assessments/{id}/responses` · `/submit` | 🔒 حفظ ≠ إرسال: a draft may be incomplete, a submission may not and is final |

- A session-target quick test takes the occurrence's day; eligibility resolves against the covering `AcademicPeriod` (R122). The paper freezes on the first submission (`ASSESSMENT_HAS_SUBMISSIONS`); no versioning scheme. A submission stays readable by its author after eligibility lapses. Grading is `/exams/{id}/grades`.

### Attendance (§4.7, R123)

Entity-rooted like `/sessions/{id}/roster`; the kind is bound where the route is mounted, never read from the path.

| | Path | Audience · semantics |
|---|---|---|
| `GET` `POST` | `/sessions\|events\|exams/{id}/attendance` | 🔒 Sheet and staff mark; `required` opens on the expected roster, `optional` empty; `?date=` required for an activity, a produced date; عطلة/حفل → `ATTENDANCE_NOT_AVAILABLE` |
| `GET` | `/sessions\|events\|exams/{id}/attendance/candidates` | 🔒 Beneficiaries at the occurrence's branch not yet marked; a picker for one sheet, not a directory (`/admin/directory` stays Admin-only) |
| `POST` | `/sessions\|events/{id}/attendance/self` | 🔒 «تسجيل حضوري»; empty `.strict()` body (nowhere to name anybody else); no `self` route on an exam (invigilated) |
| `DELETE` | `/sessions\|events\|exams/{id}/attendance/{studentId}` | 🔒 Staff withdraw a mistaken mark; soft delete with Trash snapshot (TD-5) |

- Enrolment decides who is EXPECTED, never ALLOWED: any live beneficiary may be marked, `beyond_roster` if not enrolled; the roster resolves against the `AcademicPeriod` covering the occurrence's date (R122); an enrolment recording no period never appears.

### Teaching Groups — the subject split

Exists only where a Subject needs a division other than the administrative roster; no groups = whole Level; splits independent between Subjects.

| | Path | Audience · semantics |
|---|---|---|
| `GET` `POST` | `/admin/levels/{levelId}/subjects/{subjectId}/teaching-groups` | `GET` 🔒 `{groups, split, unassigned}`, unpaginated; `POST` 👤, Subject must be assigned to the Level, body names the circle's `branch_id` (R172 §15) |
| `PATCH` `DELETE` | `/admin/teaching-groups/{id}` | 👤 Only `name`, `display_order`, `branch_id` (R172 §15); `DELETE` answers `200 {released_students}`, blocked by a targeting schedule |
| `POST` | `/admin/teaching-groups/{id}/members` | 🔒 Scoped by the student's enrolment branch; one seat per (student, Subject, Level) |
| `DELETE` | `/admin/teaching-groups/{id}/members/{studentId}` | 🔒 The student returns to `unassigned` |

- `unassigned` is BR-22 made visible (no seat in a split Subject = no sessions for it), hence unpaginated; `split` ≠ `groups.length`: empty `unassigned` means *not applicable* unsplit, *everyone placed* split.
- Authority is split (R43.3): a Teaching Group belongs to a Subject and Level spanning branches, so CRUD is Super Admin; membership is Admin scoped by the *student's* branch; a branch Admin's `unassigned` is deliberately partial.

### Course Schedules — the unit of delivery

Carries the Subject, one teaching mode with exactly one target, branch, room, staff, times and a recurrence rule.

| | Path | Audience · semantics |
|---|---|---|
| `GET` `POST` | `/admin/course-schedules` | `GET` role-scoped (Super Admin all; branch Admin their branches; Teacher the schedules they staff); `POST` Admin; a write returns `{ schedule, materialization }` |
| `PATCH` `DELETE` | `/admin/course-schedules/{id}` | 🔒 Admin; only the *when* and the *room* are editable; `DELETE` answers `200 { future_removed, retained }` |
| `GET` | `/admin/course-schedules/{id}/conflicts` | 🔒 Admin; computed against materialized Sessions, never recurrence rules |
| `GET` | `/admin/course-schedules/{id}/roster` | 🔒 Resolved audience, recomputed per request; a teacher's staffed schedule (§5.6), otherwise `404`, never `403` |

- One role-scoped endpoint (Document Owner, 2026-08-05): *My Teaching* (§14.1, §5.6 line 753) reads it through `CourseScheduleStaff` (§4.4c); a second teacher route was rejected (byte-identical); reading is not managing (§14.1); a teacher staffing nothing gets an empty list, not `403`; a filter narrows, never widens.
- `teaching_mode` + `target_id`, never three nullable columns. Times are TD-11 wall-clock `HH:MM`; an ISO instant is refused.
- Materialization is eager for conflict detection: room, teacher and assistant checked against existing Sessions with governing rows `FOR UPDATE` (TD-15.2); a clash is [`SCHEDULE_CONFLICT`](error-codes.md), not `STATE_CONFLICT`; room capacity never consulted (BR-23).
- Writes report what they did not do: `materialization.protected_sessions` with every reason; `retained` on delete.
- Subject, target, branch and academic year are not editable (re-creations). `PATCH` `scope` (§4.4, R50): `all_sessions` (default, future un-overridden Sessions rewritten) or `this_and_future` with `from_date`: the current schedule closes at `from_date − 1 day` via `effective_until`, a successor with the new values and copied staff is anchored at `from_date`; past/overridden Sessions untouched (R43.6); the response is the successor plus `split_from_schedule_id`. "This session only" is `PATCH /sessions/{id}`.

### Sessions — the individual occurrence

Not under `/admin/`: TD-2 gives a Teacher write access to sessions they staff; scope asserted in the service; out of reach `404`.

| | Path | Audience · semantics |
|---|---|---|
| `PATCH` | `/sessions/{id}` | 🔒 A field edit, not a transition; always marks `overridden`; `status` and `schedule_id` refused |
| `POST` | `/sessions/{id}/cancel` | 🔒 Reason mandatory, not blank; records the audience size while answerable |
| `POST` | `/sessions/{id}/restore` | 🔒 Refused once the date has passed |
| `POST` | `/sessions/{id}/content` | 🔒 Links an existing library item; body key `educational_content_id` (TD-3.12) |
| `DELETE` | `/sessions/{id}/content/{contentId}` | 🔒 Unlinks (soft-deletes the link row); never deletes the file |

- One verb per TD-1 transition; `PATCH` is not one; `schedule_id` refused (moving an occurrence detaches it from its recurrence).
- `overridden` = a human decided about this occurrence, set by *any* override even one matching the schedule; it survives the next schedule edit.
- `staff` supplied replaces the snapshot; omitted leaves it; `[]` means *no staff*. A linked item makes a Session protected against schedule edits.
- No route sets `held` (TD-3.12 documents none; §20 rule 16).

## The public Educational Library

| | Path | Audience · semantics |
|---|---|---|
| `GET` | `/library` | 🌐 `?category_id=` `?level_id=` `?academic_year_id=` `?subject_id=` `?whole_category=` `?page=`; paginated (TD-10); `suggested_recording_name` beside `data`/`meta` (R75.6, server-owned since R99, `null` without a Subject); items carry `additional_levels[]` (R169 §10) |

- `whole_category` (R167 §5, «كل مستويات الفئة»): addressed to EVERY Level of its Category, `level_id` only where filed; a private one is readable by a member of ANY Level of that Category and nobody else; `?level_id=` returns that Level's items AND its Category's whole-category ones; `?whole_category=true|false` isolates either; the ingest sets it for a class addressing every live Level of exactly one Category; staff set it via `PATCH /content/{id}`.
- R169 §10: `PATCH /content/{id}` `additional_level_ids` REPLACES the other Levels, each a live Level teaching its Subject, never the home (`LEVEL_IS_HOME`); a recording is filed under the first Level addressed and names the rest unless whole-category.
- Items carry §5.2 headings server-side: `category_id`/`category_name`, `level_name`, `subject_name`, `academic_year_label`, `branch_name` (labels, never identifiers; `null` `branch_name` = Global); no other public endpoint publishes Subject/Academic Year names (R30).
- Never `401`: an invalid credential is ignored; mounted before the guarded router like `/calendar`; Pending sees the public tier (TD-1).
- Signing in reorders, never unlocks: own branch → Global → other branches (§5.2); `branch_id IS NULL` is Global (§7); own branch via `Enrollment → AdministrativeGroup.branch_id` or role scopes.
- §4.9 tiers filter every result set (who the caller is, not personalisation — TD-3.13 vs §5.2):

| Tier | Who sees it in a listing |
|---|---|
| `public` | Everyone, including anonymous |
| `private` | Logged-in students enrolled in the target Level, and their parents |
| `hidden` | Admins and Teachers only |

- No `X-Active-Child-ID` needed here (one shared reading surface, §5.2).
- Listing is not the download gate: items carry `visibility`; `GET /content/{id}/download-url` (TD-3.5) checks §4.9 before minting; the DTO omits `storage_bucket`, `storage_key`, `original_filename`; `media_consent_missing` is projected for staff, `null` otherwise (R170 §3).

## Storage — uploads, replacement, deletion and the mint (TD-3.5)

| | Path | Audience · semantics |
|---|---|---|
| `POST` | `/uploads/initiate` | 🔒 Phase one: `{ upload_id, key, put_url, expires_in }`; `content_meta.origin` (R99.12) `uploaded` or `session_recording`, a description, never a permission |
| `POST` | `/uploads/{upload_id}/complete` | 🔒 Phase two; body `{ title, description? }` only |
| `POST` | `/uploads/{upload_id}/abort` | 🔒 Best-effort; deletes the object |
| `DELETE` | `/content/{id}` | 🔒 R53: soft delete + Trash snapshot + quarantine |
| `GET` | `/content/{id}/download-url` | 🌐/🔒 Optional-auth short-lived GET; anonymous only for an exact live public coordinate; private keeps §4.9/TD-12 checks; `Cache-Control: no-store`; out of scope `404` |

- The file never passes through the API: the browser PUTs to MinIO via the presigned URL (§2.3).
- Decided at `/initiate`: §4.9 branch scope, TD-9 whitelist and size cap, per-user quota. `/complete` decides only what the object answers: ranged GET `bytes=0-511` for magic bytes, HEAD for size (§4.9, R8), never streamed; a mismatch deletes the object, creates no row, answers `409 VALIDATION_FAILED` (TD-3.8's only status-varying code).
- `upload_id` is a signed ticket, not a row (§7 has no pending-upload entity); `upload.gc` (TD-7) reaps unclaimed objects older than 48 h; the ticket binds caller, key, bucket, declared size/type and §4.9 scope fields, not title/description; key derived from `JWT_SIGNING_KEY` by HKDF under its own label (TD-13 token-class separation, no new variable).
- Replacement (R53): `content_meta.replaces_content_id`, same two phases; completion writes a new key with a new hash segment, quarantines the old object, increments `version`; keys never reused (TD-9, §20 rule 15); not a separate route; the target resolves at `/initiate`. Internal/API capability only; the content page offers upload/create and delete, no user-facing replacement.
- Video is not accepted: TD-9 lists audio, documents, slides, images; §4.9 (R12) "video remains excluded entirely"; the client maps `video/*` for presentation only; accepting video is a Document Owner SRS revision.
- The mint: TD-12 freshness (`account_status` and role re-read every request); §4.9 tiers via the same predicate as `GET /library`; child context (§4.3) narrows the private tier to that one child, with the resolver called directly rather than mounting `childContext`.
- Quota (TD-4.12): 30 per hour, counted in PostgreSQL inside the initiating transaction under a row lock (not process memory, not pg-boss, R14); `429 RATE_LIMITED` in the standard envelope.

## Events

| | Path | Audience · semantics |
|---|---|---|
| `POST` | `/events` | 🔒 Writes the four-way scope joins explicitly at creation |
| `PATCH` `DELETE` | `/events/{id}` | 🔒 |
| `POST` | `/events/{id}/notify` | 🔒 Optional post-change announcement, see [Notifications](#notifications) |
| `GET` `POST` | `/admin/branches/{id}/event-backfill` | 🔒 Manual backfill on branch activation; an Admin capability (operational work) |

## Hijri calendar

👤 only, enforced in the service; no import route ships (no machine-readable source exists).

| | Path | Audience · semantics |
|---|---|---|
| `GET` | `/admin/hijri-calendar?year=` | 👤 The twelve months, draft and published |
| `PUT` | `/admin/hijri-calendar/{year}/{month}` | 👤 Records an official announcement; optimistic locking |
| `POST` | `/admin/hijri-calendar/{year}/publish` | 👤 Only published months render anywhere |
| `GET` | `/admin/hijri-calendar/{year}/history` | 👤 The audit trail for that year |

## Specified, not yet built

Reported `PENDING` by the contract check until their milestone lands: a work-in-progress signal, not invented endpoints.

| Milestone | Endpoints |
|---|---|
| **M4 — Quran** | `POST /students/{id}/quran-logs` · `PATCH` / `DELETE /quran-logs/{id}`, each returning the synchronously recalculated coverage |
| **M5 — Exams** | `POST /exams` · `POST /exams/{id}/publish` · `POST /exams/{id}/submissions` · `PATCH /submissions/{id}` · `POST /submissions/{id}/submit` · `POST /grades/{id}/publish` · `/republish` · `/pass-fail-override` |
| **Jobs** | `GET /jobs/{id}`; any enqueuing endpoint returns `202` with a job id |

- Post-MVP, deliberately absent: grading-template routes, multipart upload endpoints, CSV import/export, the Hijri importer.
- Library screen (R43 superseded the claim that no route lists content; TD-3.13 `GET /library` is built): `GET /content/{id}/download-url` is built; an **uploader** on `EducationalContent` (teacher display name on cards) is not in §7's field list and needs a revision plus a forward-only migration.
- Per-level counts derive from `GET /library?level_id=` + TD-10 `meta.total`; no separate level index/read endpoint.
- Any listing endpoint resolves visibility server-side from the live actor (§4.4), no query parameter widens it; a warned recording is as visible as its `visibility` says (R170 §3), the warning reaches staff only.
- Divergences from §5.2 for the Document Owner: a **Subject** tier beneath Branch (rendered as a card badge); the **`is_current`** year pinned at top (the page sorts newest-first).

## Conventions at a glance

| | |
|---|---|
| Prefix | `/api/v1`, same origin as the client |
| Auth | `Authorization: Bearer`, never a cookie, except `/auth/refresh` |
| Child context | `X-Active-Child-ID`, verified per request against both parties |
| Lists | `?page=1&page_size=25`, default 25, max 100, `{ data, meta }` |
| Errors | One envelope → [Error codes](error-codes.md) |
| Out of scope | `404`, never `403` |
| Public endpoints | Never `401`; an invalid credential is ignored |

**Related:** [API](../architecture/api.md), [Error codes](error-codes.md), [`openapi.json`](../openapi.json)
