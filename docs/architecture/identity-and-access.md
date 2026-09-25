[Documentation](../README.md) › [Architecture](README.md) › **Identity and access**

# Identity and access

Request order: [Authentication](#authentication) → [Sessions](#sessions) → [Authorization](#authorization) → [Child context](#child-context).

## Authentication

- Google OAuth is the only identity provider: no passwords, hashes, reset flows or password columns; minor students have no login identity.
- `UserIdentity` (provider + subject id) abstracts the provider so local credentials can be added post-MVP without restructuring `User` ([Risk R-1](../overview/scope-and-roadmap.md#open-risks)).
- Scope is `openid email` only (Owner 2026-09-02, R121): `sub` binds the account; `email` feeds `UserIdentity.email` and the `email_verified` hard stop (§4.1b step 7); `profile` was never read by `verifyGoogleIdToken`, so removed. The privacy page names the same two scopes; `legal.test.ts` asserts it and `oauth.ts` agree.
- Always: PKCE S256, `state`, HMAC-sealed flow cookie, `prompt=select_account`, subject binding; no Google token is ever persisted and no Google API is called after login.

### Onboarding sequence

OAuth-first: the registration form is never shown before Google authentication completes; its email field is pre-filled and read-only.

1. `GET /auth/google`: state + PKCE verifier in a short-lived signed HttpOnly cookie scoped to the callback; redirect to Google.
2. `GET /auth/google/callback?code&state`: validate state + PKCE, exchange the code, verify the ID token (below), extract verified email + subject id.
3. Resolve against the LOWERCASED email: `UserIdentity(google, subject_id)` → else `User.pre_provisioned_email` regardless of `deleted_at` → else nobody known.
4. Identity exists → session, routed on the condition below. Pre-provisioned match → lock the `User`, re-read status/deletion/roles, create and bind the identity transactionally only if still eligible. Nobody known → onboarding token → registration form.

- Resolution is not credential authority: before an Active/Pending result mints anything, one final transaction locks the `User` row, re-reads status + live roles, creates `RefreshSession`, first refresh generation and `auth.login` audit; token and cookie leave only after commit; a suspension committed meanwhile routes to the deactivated screen with no credential.
- First binding: the email lookup only discovers a candidate; the binding transaction takes the User lock and re-runs the routing condition before creating `UserIdentity` or `auth.identity_bound`.

### The Google identity trust boundary

- Code exchange and ID-token validation are two separate steps; TLS does not make an unverified JWT payload an identity.
- `id_token` goes to the Google Auth Library before `sub`/`email` are read: `RS256` header with non-empty key id, signature against Google's fetched and cached certificates, lifetime, the two documented Google issuers, this deployment's client id as audience; then non-empty subject and email plus `email_verified = true`.
- Malformed, bad-signature, expired, wrong-issuer/audience, unknown-key tokens and certificate retrieval failures fail closed as `oauth_unavailable` without touching an account; false or missing `email_verified` → `email_unverified`. Neither the token nor provider error details are logged.
- Pure code flow (`response_type=code`): no ID token reaches the browser, so no nonce (signed flow state binds the callback, PKCE the code); revisit if the flow ever becomes hybrid/implicit.

### Routing condition

```
Active  AND deleted_at IS NULL → role dashboard
Pending AND deleted_at IS NULL → approval-status screen, zero data access
Rejected|Suspended OR deleted_at IS NOT NULL → "Account deactivated"
```

- Both terms required: a soft delete sets `deleted_at` without necessarily moving status.
- The pre-provisioned lookup is NOT scoped to `deleted_at IS NULL` (that once offered a deleted person the registration form); refusal is solely the routing condition's job (R20).

### One registration, several roles (R168 §1)

One form: four checkboxes in any combination — مستفيدة · تسجيل الأبناء · هيئة التدريس · هيئة الإدارة — and who she is, once.

| Piece | Where | Rule |
|---|---|---|
| Request | `validators/registration.validators.ts` (`kind: 'roles'`) | A section per role asked and no other; date of birth exactly when `student` is asked (R130); no field names an administrative role — `administration` carries only where she would prefer to serve |
| Write | `services/registration.service.ts` | All three request shapes normalise into one write: `User`, one `RoleRequest` per role, `CirclePreference` rows (checked against the offer — `CIRCLE_NOT_OFFERED`), framing preference, child applications |
| Rankable circles | `services/registration-circle-slots.service.ts` | Read from the SCHEDULE every time: live weekly memorisation classes for a حلقة of her Category's FIRST Level at her branch; anonymous, so name, days, times only; never a «مخفي» class |
| One role decided | `services/role-request.service.ts` | `student` = placement (`enrolAtPlacement`); `teaching`/`administration` = a grant the APPROVER states; `guardian` = nothing granted. Roles ADDED via `ensureRoleAssignment`, never `applyRoleAssignments` (replaces the set) |
| Account | same | `pending → active` on the FIRST approval; `rejected` (sessions revoked in the same transaction, R102) only when EVERY request was declined |
| Whole-account act | `services/approval.service.ts` | Kept for a registration asking one ordinary thing, mirroring its decision onto the request; several requests, or a lone `administration` one, answer `DECIDE_PER_ROLE` |

- Asking grants nothing: a `RoleRequest` is never read for authority; authority is `UserBranchRole`, written only by the audited approval behind `assertFreshActive`, the User row lock (TD-15.3 first-wins) and the one role-management privilege guard.
- Administration is a Super Admin decision on both paths: the per-role act refuses an Admin with `403`; the whole-account act refuses a lone `administration` request.
- A guardian is accepted by accepting a child: `parent` is granted with her first approved child (R62); approving a child application approves a pending `guardian` request, blocked only when it was declined (`GUARDIAN_REQUEST_DECLINED`); declining `guardian` rejects her pending child applications (`not_eligible`).
- After admission, one role at a time (R169 §1): `requestFurtherRole` (`POST /profile/role-requests`) lets an ACTIVE account ask for a role not held or declined; writes no authority; opens or re-opens the `RoleRequest` row (UNIQUE `(user_id, kind)`; audit keeps both decisions); replaces ranked circles and framing preference; completes a missing date of birth, never corrects one; raises `registration_review_required`; the queue marks it `account_active`, per-role review only. Registering a child re-opens a declined `guardian` request.
- The decline reason is never returned (`GET /profile/role-requests` omits it by projection); the same read answers `held[]` from live role rows because «صفاتي وطلباتي» is always on «حسابي» (R170 §1).
- Token renewal (R172 §5, `lib/token-refresh.ts`): `api()` retries a bearer 401 ONCE with a refreshed token (an ended session yields none; anonymous requests never trigger it); `SessionProvider` renews five minutes before expiry and when a hidden tab becomes visible; single-flight; announced to the session context (`api.test.ts`).
- A granted role is hers at her next page (R169 §2): the token lives in memory only; every page load calls `POST /auth/refresh`, which reads live `UserBranchRole` rows; adding a role revokes nothing (`auth-refresh.http.integration.test.ts`).
- The self-managed claim (R132) is not a role; its form entry stays withdrawn (R160 §8), reached by `/register?mode=self-managed`.

### Account deletion: recoverable tombstone, then de-identification

- R133 supersedes R111. `DELETE /profile` (owner) and `DELETE /admin/users/{id}` (Super Admin) stamp `deleted_at`, revoke every refresh session and write a seven-day Trash snapshot in one transaction; no identity, role, family, enrolment or staffing-history row is removed in that window; restore clears the tombstone; revoked credentials stay revoked.
- `?permanent=true` de-identifies now: User id, sex, account lifecycle, beneficiary fact and institutional relationships survive; names and split parts, contact/public identity, registration-request fields, notes, spoken and QR identifiers, Google binding, roles, live credentials, quota rows, notifications, safeguarding case-file detail and teaching-planning rows are cleared; the Trash snapshot is deleted in the same transaction; the address is released (re-registration tested); the [keyed-lock design](../development/email-lock-keying.md) keeps only a stable HMAC coordinate; no post-commit lock-retirement loop.
- `minimizeSelfManagedClaimIdentity` (User repository, erasure-only, User-locked, tombstoned claims included) clears claim `email`, provider subject and decision text (related Trash snapshots too); an approved claim keeps its structural self-management fact so removing authentication cannot restore guardian authority; pending claims withdrawn; claim writers take the beneficiary User lock and re-read; erasure returns counts, not claim records.
- R141: rejection rationale is never copied into audit detail (event keeps claim/beneficiary ids, actor, timestamp, type); a data-only migration removed historical copies under the narrow TD-8 exception.
- Live responsibilities and the last active Super Admin block the first step, time-aware: ended periods and past occurrences are history; live/future schedules, Sessions, responsible Events and Exams must be reassigned; Event liveness reads `start_date`/`end_date`/`recurrence_end_date`; Session regeneration selects only the assignment effective on that date; a schedule split validates only assignments whose dated interval can staff its successor.
- Serialized: every staffing mutation locks its distinct User ids in UUID order and revalidates active/non-deleted state; deletion takes the same lock first; a future Exam restore does too before reviving `ExamStaff`; the loser refuses `STAFF_ACCOUNT_UNAVAILABLE`; the last-Super-Admin count locks the stable `super_admin` Role row after the target User lock.
- Satellite writers (admin teaching-profile replacement, teacher availability, safeguarding-profile writes, upload initiation/publication) revalidate after the User lock; notification delivery locks recipients in UUID order and omits a committed tombstone; a published upload remains institutional history, its retry idempotently readable.
- De-identification locks email → PlatformOwner → User, re-reads the tombstone, refuses `NOT_DELETED` if restoration won; a converged retry is a no-op (QR coordinate kept, no second `user.deidentify` event); sweep work names the exact `Trash.id` and revalidates under the User lock; restoration re-reads the exact entry and refuses at/after its deadline.
- Permanent purge destroys the beneficiary's own educational/personal record and FamilyLinks; consent/audit and shared accountability keep pointing at the tombstone; the User row is never hard-deleted.

### Onboarding token

- 10 minutes, signed, single-use; carries verified email + subject id to the form submission; identity comes exclusively from the token payload and the endpoint schema accepts no email/OAuth fields.
- Single-use by constraint: unique `jti` inserted into `ConsumedToken` inside the registration transaction; replay → `409`.

### Callback failures are redirects, never JSON

- `/login?error=<key>`: `user_denied` · `state_mismatch` (also a security-event log) · `oauth_unavailable` · `email_unverified` (hard stop, no account touched); no partial state on any failure path.
- The flow-state cookie is single-use: Back onto a consumed callback URL renders the standalone `state_mismatch` screen; its missing app header does not mean the refresh session was lost.

### Email normalization and the cross-table lock

- Every Google email is lowercased before every lookup and write; a DB `CHECK` enforces lowercase storage.
- An address lives in `User.pre_provisioned_email` or, after binding, `UserIdentity.email`; two same-table unique indexes cannot protect the absent-row race between them.
- `NormalizedEmailLock` ([design](../development/email-lock-keying.md)): a domain-separated keyed digest + creation time, no owner id; `INSERT … ON CONFLICT DO NOTHING` then `SELECT … FOR UPDATE` held through the cross-table re-read and write.
- Writers via one repository primitive: onboarding registration, staff pre-provisioning, first-login binding, self-managed claim approval, Super Admin bootstrap; email lock first, then the User lock.
- The onboarding token is a routing snapshot, not a reservation: staff provisioning first → duplicate conflict, `ConsumedToken` insert rolled back; the next OAuth attempt binds via the pre-provisioned path.
- Rejected: a persisted owner/claim row (duplicates the two SRS fields); a transaction advisory lock (unbounded email into finite key space). An HMAC collision merely serializes two addresses.
- The digest is not an email claim and does not block OD-07 re-registration; never delete lock rows during erasure; rotation uses the stopped-writer boundary with a shared operator-provisioned key.

## Sessions

| Token | Lifetime | Transport |
|---|---|---|
| Access | 1 hour | `Authorization: Bearer` header — never a cookie |
| Refresh | 30 days | `HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth` cookie |

### CSRF

- Access token in a header → ordinary mutations are structurally immune to CSRF.
- Only `POST /auth/refresh` and `POST /auth/logout` read the cookie; both require `X-Requested-With` and validate `Origin` against the public base URL BEFORE reading it; no double-submit token; frontend JS never receives the cookie.
- Same-origin routing is never CSRF protection.

### Rotation: three outcomes

Refresh tokens are stored hashed, never raw; lookup is by hash:

| Presented | Outcome |
|---|---|
| Current, live | ROTATE: revoke, insert a successor in the same session, new access token |
| Immediate predecessor within 10 s of its successor | ACCEPT: fresh access token, RE-SEND the issued successor; no third token (a fork would defeat reuse detection) |
| Older, or revoked | REUSE DETECTED: revoke EVERY live token in the session, refuse, two audit rows |

- The client single-flights refreshes with a mutex.
- Refresh, logout and maintenance serialize on the chain: the hash discovers `session_id`; the transaction locks the stable `RefreshSession` row and re-reads before deciding (first read = discovery, never authority).
- Login, Pending → Rejected, suspension and revoke-all serialize on the `User` row; hierarchy always User → `RefreshSession` anchors in UUID order; the issuer re-reads Active/Pending under that lock.
- The User lock is `FOR NO KEY UPDATE`: compatible with the implicit `KEY SHARE` from refresh/logout inserting a `RefreshToken`/`AuditLog` row; `FOR UPDATE` would deadlock Session → User against User → Session.
- Rotation commits as the TD-4.13 unit; HTTP refresh re-takes the session lock, verifies a live generation, reads authoritative account + assignments and signs under the lock; logout in between → `401`, no credential; only authoritative `Active`/`Pending` accounts are eligible; holding a transaction across response delivery was rejected.
- Reuse ends the whole session; never accepted, never resurrected.
- Every refusal is `401` in the standard envelope; no new error code; the distinction lives in the audit log.
- Revoke-all is internal (rejection, suspension, deletion); no user-facing "log out everywhere" route or nav node; locks User, then session rows in UUID order.
- Pending → Rejected: reason `rejection`; `user.reject` + `auth.token_revoked` in the status transaction; audit failure rolls the decision back; Rejected is terminal; an issued access token keeps only its TTL and per-request freshness.

### Logout

- `POST /auth/logout` revokes every live token with the cookie's `session_id`, writes `auth.logout` in the same transaction (mandatory: if unwritable, the revocation rolls back and the cookie stays), then expires the cookie; another browser stays signed in.
- Idempotent: valid CSRF context + absent/unknown/cleared cookie → `204`; missing or foreign CSRF context → `401` before the cookie is inspected.
- R101 moved the Path from `/api/v1/auth/refresh` to `/api/v1/auth`: stop the old API first, invalidate all pre-cutover refresh rows with `cookie_path_migration` + system audit, apply the new code, users re-authenticate.

### Freshness (TD-12)

- An unexpired token is not sufficient for presigned URL minting, approval actions, consent-gate overrides and staff-recorded consent, pass/fail overrides, user-management mutations: each asserts per request (one indexed read) that the caller is still `Active` with the invoked role and scope; parent → child access is fresh by construction.

### JWT claims

```
sub            user id
roles[]        derived from role_scopes at issue time, so the two cannot disagree
role_scopes[]  one entry per role held: { role, branches }; branches: null ⇒ ALL branches
account_status
iat / exp
```

- No flat `branch_scopes[]`: it cannot express "all branches" and a union extends one role's authority to another's branches.
- No PII beyond these; no email; the active child is never a claim.

## Authorization

- Branch is the sole access-control axis; everything else is a capability.
- A role assignment is `(user, role, branch)`, unique; `branch = NULL` = all branches for that assignment, not a Super Admin marker.
- Scope resolves per role: role R is constrained by R's OWN assignments' branches, never by another role's (flat union until R24); `branch_id IS NULL` is never an empty scope.
- Teachers reach students only through effective `CourseScheduleStaff`/`SessionStaff` assignments and their resolved audience (exam authoring, Quran logging, content upload, case-file access).
- Quran memorisation requires the schedule's single live `tracks_quran_progress` marker (R107–R108), owned only by حفظ القرآن; أحكام القرآن, ترتيل وتجويد القرآن, تفسير القرآن and any unmarked Quran-domain Subject never authorise it; structural, not a name comparison; absence fails closed.

### Permission matrix

Normative in [TD-2](../reference/technical-design.md#td-2), enforced server-side on every endpoint; UI hiding is never enforcement. See [Users and roles](../overview/users-and-roles.md).
- Reference data (branches, rooms, levels, categories, subjects, academic year, academic periods, settings, display order, Hijri calendar): Super Admin writes; Admin reads in scope; Teacher no access (R30).
- A Level target does not override branch authorization (R125): a branch-scoped Admin may create, use or publish a Level-targeted assessment only when the resolved audience is entirely within her branches; one check for all five arms via `examAudienceWhere` (enrolment is the branch fact, §20 rule 22); re-asked at publish.
- A مؤطِّرة addresses THIS student, not a Level (R125): `studentsTaughtBy` (§4.4c); outside her teaching → `404`, never `403`.
- `GET /assessments/targets`: staff only, scoped per caller, not the boundary — every refusal is re-made on the write.
- An online paper carries no branch, and «no branch to check» is not «no check» (R124, corrected 2026-09-04): a named individual is checked against her enrolment branches, `NOT_FOUND` not `403` (§20 rule 17); other target arms are deliberately unchecked; whether a branch-scoped Admin may author a Level-wide online paper is an open Owner question.
- The assessment builder (§4.6, R124) uses the exam rule (TD-2 as split by R70.4): Super Admin, Admin in scope, Teacher within own teaching; grading is `/exams/{id}/grades`; a student writes only her own answers (no student id accepted; subject = JWT `sub` via the §4.3 middleware); a guardian reaches her child only via an approved `FamilyLink`; a parent reads a paper, never writes one; unpublished grades invisible per `Grade.status`.
- Assessments and attendance are deliberately NOT TD-12 freshness surfaces; the catalogue is approvals, consent overrides, pass/fail overrides, user management, settings and presigned minting.
- Attendance (§4.7, R123) delegates per occurrence kind: Session → whoever staffs it on its date (R91 `staffsSession`); Event → whoever may edit it (R71 responsible person, Admin in scope, Super Admin); Exam → its supervisor or an Admin in the branch. Self check-in is not a role: the occurrence's `attendance_marking` + the caller's Category flag authorise marking exactly herself.
- Branch event backfill stays Admin (operational work).
- Routes are not the boundary: checks live in services; `/admin/*` is not a permission boundary; `/superadmin/*` was rejected as churn.

### Who sees which branches

| Role | Reaches |
|---|---|
| Super Admin | Every branch |
| Admin | Own `admin` assignments (`branches: null` = all, R24) |
| Teacher | Branches of the schedules they staff (§4.4c, R43.3) via `teacherBranchIds`; the role row is never consulted |
| Anyone else | Refused |

- An unassigned teacher sees an empty list, not an error; this closed a gap against R26 (a test pinning the refusal was corrected).
- Rooms follow the branch; out of reach → `404`, never `403` (§20 rule 17).
- Branch/room writes are Super Admin only (R26); the screen is Super-Admin-only (R61).

### Legal consent wording

- Create, edit, activate `LegalConsentText` (R119): Super Admin only via `assertFreshActive` (R60 freshness); the read is refused to Admin too, and the negative half is tested.
- `GET /registration/consent-text` is anonymous; publishes id, label, text — never provenance, status or usage counts.

## Active role

- Several roles per person (§2.1); the header switcher chooses; R60 made it the JWT claim `active_role`: a Super Admin acting as مؤطِّرة loses Super Admin authority until switching back (safety, not containment: switching back is instant).
- `issueAccessToken` emits `role_scopes[]` narrowed to the active role and derives `roles[]` from it; all 103 `Actor.roleScopes` references (28 files, five helpers in `branch-scope.ts`) narrow with no downstream edit; `isSuperAdmin(scopes) === false` at 44 call sites; §4.2 untouched — the one entry keeps its own `branches`.
- `assertFreshActive` takes the active role, checks it is still assigned and returns scopes narrowed to it (`active-role.http.integration.test.ts` mutation-proves it); `/me` reads live rows, not the token, so the switcher never shrinks to one.
- Not persisted server-side (no column on `User`/`RefreshToken`); client mirror `contexts/active-role.tsx`; the list comes from `/me` and `setActiveRole` refuses anything outside it.
- `POST /auth/switch-role` re-issues after a User-locked re-read; no logout or new session; `exp` capped at the presented bearer's `exp`; then navigates to `homeForRole`.
- `POST /auth/refresh` re-asserts the role on every page load and returns the one granted (load-bearing: token in memory, switching is a full page load); a revoked active role falls back to the most privileged still-valid assignment and says so, never a silent widening.
- Every §14.1 role has a portal; `/dashboard/student` (R62.10) serves the student's own record or the active child's; `/dashboard/parent` is `not-found` (R62 removed it; `screen-pending` promises a coming page).
- Active role and active child persist in `sessionStorage`; `localStorage` refused; a revoked link is absent from the next `GET /me` and `ActiveChildProvider` drops it; the server re-checks the `FamilyLink` on every request (§4.3); neither is ever a token claim.
- R117: a child coordinate is valid only while the active role is Parent; any switch to a non-Parent role clears it; a Parent-only account never gains a synthetic self-beneficiary context.
- The Trash is TD-12 fresh: restore, permanent delete and the list read use `assertFreshSuperAdmin` (§5.6).

## Child context

`X-Active-Child-ID: <child user id>` on every request by a parent acting for a minor (SRS §4.3 · [BR-5](../reference/business-rules.md#br-5) · §20 rule 6).

| Situation | Behaviour |
|---|---|
| Header present | Verify an `Approved` family link matching BOTH the authenticated parent AND the child |
| Absent + caller holds Student | Bypass; ownership verified against the token subject |
| Absent + Parent-only | `400` |

- Every other failure (no such child, another parent's child, pending, rejected, deleted) → `404`, indistinguishable.
- Per request so revocation is instant: soft-deleting the link IS the revocation; no `Approved → Revoked` transition exists or should be added.
- Downstream policies/repositories receive the resolved acting-student id and never trust a student id from body or query; client switching is presentation, the server decides.

## Platform Owner and initial bootstrap

- A protected singleton lifecycle relationship, not an RBAC role; the owner must be active, undeleted and hold a live global Super Admin assignment; DB and application refuse suspension, deletion, de-identification or demotion until transfer.
- Initial Owner (R115): `safae.elmessoussi@gmail.com`, صفاء المسوسي, female. The seed creates or claims that account as active Global Super Admin with `both`/all-current-and-future-branches framing willingness, no weekly hours; stores `pre_provisioned_email`; never fabricates a `UserIdentity` or Google subject.
- Bootstrap gate: before the singleton exists the seed requires the exact email and `female`, takes an advisory transaction lock, fails atomically on an address conflict; once it exists every rerun is a no-op (after transfer, wrong env, admin changes); the seed never reclaims the original Owner, creates a successor or reopens when no other Super Admin remains.
- Transfer: current-owner-only, to an already-active Global Super Admin; one transaction locks the singleton then both Users in id order, updates the relationship, increments its version, audits previous/new UUIDs; roles unchanged; concurrent attempts yield one winner, one stale refusal.
- Ownership freezes only the required global Super Admin assignment: `PUT /admin/users/{id}/roles` may change the Owner's other roles; omitting or rescoping the global one fails in the singleton-locked transaction.
- `/admin/users` = live Active and Suspended (incl. valid pre-provisioned Active); `/admin/directory` = live Active only; Pending/Rejected never appear as users, staffing candidates or roster choices.

**Next:** [Security](security.md) · **Related:** [Users and roles](../overview/users-and-roles.md), [API](api.md#authentication-semantics-decided-once)
