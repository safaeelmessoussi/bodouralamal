[Documentation](../README.md) › [Reference](README.md) › **Error codes**

# Error codes

Canonical catalogue; every service uses exactly these identifiers; extensible only by specification revision, so a client switches on `code`.
- Envelope on every non-2xx ([API](../architecture/api.md#the-error-envelope)): `{ "error": { code, message_key, message, details, request_id } }`. `code`: stable closed set. `message_key`: i18n, Arabic primary. `message`: log fallback, not display. `request_id`: same id in server logs and any enqueued job; show discreetly.
- Never in a response: stack traces, SQL, internal paths. Toasts: no PII beyond first names, no raw internals.
- Not envelopes: OAuth callback failures redirect to `/login?error=<key>` (`user_denied`, `state_mismatch`, `oauth_unavailable`, `email_unverified`); concurrency conflicts are coded 409s, never 500s.
- Deletion blocked by references carries `details.blocked_by` `{ relationship: count }`, every blocker at once.

## Codes

| HTTP | Code | When | Client |
|---|---|---|---|
| 400 | `VALIDATION_FAILED` | Field validation; missing child header from a parent-only caller; `details.reason` below | Inline field errors, sticky |
| 400 | `CONSENT_REQUIRED` | Registration without a mandatory consent checkbox | Highlight the checkbox |
| 401 | `AUTH_REQUIRED` | No/expired session; every refresh refusal (expired, revoked, unknown, purged, reuse) deliberately indistinguishable, the audit log knows | Single-flight refresh, then login. Never on a public endpoint: an invalid credential is ignored, request proceeds anonymously |
| 403 | `FORBIDDEN` | Permission-matrix violation, consent gate, global-scope violation; only where the caller may know the resource exists | Red toast, message key, 6 s |
| 404 | `NOT_FOUND` | Missing or out of scope (branch, family), never distinguished: [security control](../architecture/security.md#no-existence-leaks) | "Not found"; never speculate about permissions |
| 409 | `STATE_CONFLICT` | Transition the state machine forbids; onboarding-token replay; `details.reason` discriminates (below) | Branch on `reason`; else "already handled", refresh |
| 409 | `VERSION_CONFLICT` | Optimistic-lock mismatch on a staff-edited entity | "Changed by someone else"; reload, re-apply |
| 409 | `DUPLICATE` | Unique-constraint race loser; a duplicate staff-created family link (status to a non-owner would leak existence) | Treat as already created |
| 409 | `SCHEDULE_CONFLICT` | Room, teacher or assistant already committed for an overlapping session (§4.4), against materialized sessions | Name the clash (`details`: resource, date); offer to move one |
| 409 | ~~`CAPACITY_FULL`~~ | Retired by R43: BR-23 capacity refuses nothing; unraisable, removed from TD-3.8 | — |
| 409 | `SINGLE_SUBMISSION_FINAL` | Resume on a single-submission exam | Explain the policy |
| 409 | `UPLOAD_INCOMPLETE` | Completion on a missing or partial object | Retry from the start |
| 409 | `WEIGHT_SUM_EXCEEDED` | Template items exceed 10,000 bp | post-MVP |
| 409 | `TEMPLATE_NOT_ACTIVE` | Requires an active template | post-MVP |
| 409 | `FAMILY_LINK_PENDING` | Own-resource contexts only (a parent's own unapproved request); never from the child-context middleware, where an unapproved link is `404` | Explain it awaits approval |
| 413 | `PAYLOAD_TOO_LARGE` | Upload caps exceeded | Show the cap; suggest splitting recordings |
| 429 | `RATE_LIMITED` | Nginx per-IP or the per-user quota; one shape for both | Back off |
| 500 | `INTERNAL` | Anything else; no internals leaked | Error state |
| 502 | `OAUTH_EXCHANGE_FAILED` | Google code exchange failed; browser sees only the `/login?error=oauth_unavailable` redirect | — |
| 503 | `SERVICE_UNAVAILABLE` | Required dependency down (storage, OAuth upstream); [degraded-operation matrix](../operations/resilience.md#degraded-operation); success never fabricated | Error state with retry; the rest works |
| 503 | `CONSENT_TEXT_VERSION_NOT_CONFIGURED` | Registration; owner task (§2.3); message names the setting | — |

## `409 STATE_CONFLICT` — `details.reason`

| `reason` | Raised by | Next step |
|---|---|---|
| `SUBJECT_NOT_IN_LEVEL` | Teaching Group creation, scheduling, filing content | Assign the Subject to the Level (§4.4b); details name `level_name`, `subject_name` (since 2026-09-22) |
| `NON_CANONICAL_COORDINATE` | `DELETE /content/{id}`, any storage obligation on a key not `content/<id>/…` | Repair the key; only pre-2026-09-22 seed fixtures had one (migration `20260925110000`); formerly a 500 |
| `TEACHING_GROUPS_EXIST` | Removing a Subject from a Level | Delete the splits first |
| `SCHEDULES_EXIST` | Deleting a Teaching Group | Move/delete the schedules targeting it |
| `ALREADY_IN_SUBJECT_SPLIT` | Placing a student | In another split of that Subject; intent is a move |
| `NOT_ENROLLED_IN_LEVEL` | Placing a student | Enrol first (BR-22) |
| `ALREADY_HELD` · `SESSION_IN_PAST` | Session edits | Held: no reschedule; past: no restore |
| `INVALID_TRANSITION` | Suspend / reactivate | TD-1 forbids it from `details.account_status` |
| `SELF_SUSPENSION` | Suspend | No self-suspension |
| `LAST_SUPER_ADMIN` | Suspend, `PUT .../roles` | Appoint another Super Admin first (R22 recovery needs a VPS shell) |
| `GENDER_RESTRICTION` | Enrolment, incl. approval | Level admits one sex (§4.4b); `details.required_sex`; the student's sex is never echoed |
| `ALREADY_ENROLLED_IN_LEVEL` | Enrolment | BR-21: one group per Level per academic period (R122, *this semester*); `current_administrative_group_id` named |
| `ACADEMIC_PERIOD_OVERLAP` | Academic period create/edit | Two periods of one year may not share a day; `details` names the covering one; service-checked (no `btree_gist`) |
| `NO_CURRENT_ACADEMIC_PERIOD` | Approval, child decision | No period covers today; Super Admin opens one (`POST /admin/academic-periods`); fails closed, never fabricates |
| `ATTENDANCE_NOT_AVAILABLE` | Attendance on an excluded occurrence | R123: عطلة, حفل, unrecorded scheduling type have no sheet; also `self_or_staff` configured on such a type |
| `SELF_CHECK_IN_NOT_ALLOWED` | «تسجيل حضوري» | R123: `staff_only`, or the caller's Category forbids self-marking (teen/child refused even on `self_or_staff`) |
| `SELF_CHECK_IN_OTHER_PERSON` | Self route with another id | R123: only herself; the route accepts no id (backstop) |
| `OCCURRENCE_DATE_REQUIRED` (`400`) | Activity sheet without a date | R123: the date is half a recurring نشاط's identity |
| ~~`ONLINE_NOT_AVAILABLE`~~ | ~~`POST /exams` `mode: online`~~ | Retired by R124; `/assessments` writes papers; `/exams` still refuses `online` (a sitting) |
| `ASSESSMENT_HAS_SUBMISSIONS` | Editing a paper after a submission | R124 freeze; no versioning; a draft freezes nothing |
| `NO_QUESTIONS` | Publishing an empty paper | Add questions |
| `ALREADY_SUBMITTED` | Save/re-submit after إرسال | Final; no reopen route in v1 |
| `NOT_YOUR_SUBMISSION` | Student write path | Own only; routes accept no student id (backstop) |
| `INCOMPLETE_SUBMISSION` · `SINGLE_CHOICE_ONLY` · `JUSTIFICATION_REQUIRED` · `ANSWER_REQUIRED` | إرسال | Completeness required only on submit |
| `TEXT_NOT_ALLOWED` · `OPTIONS_NOT_ALLOWED` · `OPTIONS_REQUIRED` · `UNKNOWN_OPTION` · `UNKNOWN_QUESTION` · `DUPLICATE_ANSWER` · `DUPLICATE_OPTION` · `JUSTIFICATION_NOT_ALLOWED` | Response or question writes | One reason per mistake; `UNKNOWN_OPTION` = option from another question |
| `INCOMPLETE_ORDER` | Reordering questions | Whole sequence or nothing (R76) |
| `TARGET_ID_REQUIRED` · `DATE_REQUIRED` | Creating an assessment | Four of five targets name something; the date fixes the `AcademicPeriod` (R122) |
| `GUARDIAN_REQUEST_DECLINED` | `POST /admin/child-applications/{id}/decide` | Her children request was declined; PENDING is no obstacle |
| `ROLE_ALREADY_HELD` | `POST /profile/role-requests` (R169 §1) | Already held; the form offers only `askable` (race or stale tab) |
| `ALREADY_PENDING` | Same | Already waiting |
| `BIRTH_DATE_ALREADY_RECORDED` | Same | Completion, never correction |
| `REQUIREMENTS_NOT_MET` | `PUT /admin/students/{id}/level-completions/{levelId}` (R167 §3) | BR-11 unmet; details `configured_surahs`, `memorised_surahs`, `examined_surahs`, `exams_required`; resend with `acknowledge_unmet: true` |
| `LEVEL_NOT_COMPLETED` | `PUT …/level-completions/{levelId}/certificate` | Record the completion first |
| `CERTIFICATE_ISSUED` | `DELETE …/level-completions/{levelId}` | `DELETE …/certificate` first |

## `400 VALIDATION_FAILED` — `details.reason`

| `reason` | Raised by | Next step |
|---|---|---|
| `ENROLLMENT_REQUIRED` | Approval | §4.1: Level and group in the approval itself; `missing_user_ids` names who |
| `DECIDE_PER_ROLE` | `POST /admin/approvals/{id}/approve\|reject` (R168 §1) | Several roles or an administration place: decide each via `…/roles/{kind}/approve\|decline` («البتّ في الصفات المطلوبة») |
| `ROLE_NOT_GRANTABLE_HERE` | `POST …/roles/{kind}/approve` | Own roles only: `teaching` → `teacher`; `administration` → `admin`/`super_admin` (`details.allowed`) |
| `SUPER_ADMIN_IS_UNSCOPED` | Same | `super_admin` never branch-scoped; send `null` |
| `CIRCLE_NOT_OFFERED` | `POST /registrations`, `POST /profile/role-requests` | Ranked حلقة no longer offered (rescheduled); `details.teaching_group_id`; choose again |
| `LEVEL_IS_HOME` | `PATCH /content/{id}` (R169 §10) | `additional_level_ids` named the home Level; OTHER Levels only |
| `NO_LEVEL_TEACHES_SUBJECT` | `POST`/`PATCH /admin/course-schedules` (R169 §7) | «الكل» on Level, group, circle = every Level teaching the Subject, and none does; replaces `MULTI_DIMENSION_NEEDS_A_LEVEL` |
| `BIRTH_DATE_REQUIRED` | `POST /profile/role-requests` | Beneficiary request without a recorded birth date must bring one (R130) |
| `NOT_IN_BUNDLE` | Approval | Placement named somebody this approval does not admit |
| `SURAHS_REQUIRED` | Class, occurrence or exam writes (R165 §2) | Surah Subject: a class names one or more, an exam exactly one; empty «مقرر الحفظ» is set by the Super Admin first |
| `SURAH_NOT_IN_SYLLABUS` | Same | `details.surah_ids` outside every addressed Level's «مقرر الحفظ» |
| `SURAHS_NOT_APPLICABLE` | Same | Surah named for a non-Surah Subject; remove it (never stored as an extra) |
| `TRACKER_REQUIRES_SURAHS` | Editing a Subject | The memorisation Subject always works by Surah; un-mark tracker first |

**Related:** [API](../architecture/api.md#the-error-envelope), [API endpoints](api-endpoints.md), [Resilience](../operations/resilience.md)
