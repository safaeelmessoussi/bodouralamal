# Tasks — بذور الأمل Platform
**Granular implementation checklist. Mutable — agents tick items (`[x]`) as work completes and may split items into sub-items, but never add tasks for post-MVP features (SRS §10.1) and never contradict the SRS. Milestone order: `docs/IMPLEMENTATION_PLAN.md`. Completion log: `docs/CHANGES.log`. SRS references in parentheses are the authority for each item.**

**Status notation.** `[x]` complete · `[ ]` not started · `[~]` **partial — and a partial item always names WHICH dimension is done**, because "partial" alone hides whether the remaining risk is unwritten code or merely an unbuilt screen. Dimensions used:

| Mark | Dimension | Means |
|---|---|---|
| ✓ | Backend implementation | Code exists and runs |
| ✓ | Tests | Automated coverage exists and passes |
| ✓ | Security verification | The SRS security property was exercised, not assumed |
| △ | Frontend integration | Needs the React shell (M2+) |
| △ | Later milestone | Needs an endpoint or component from a named later milestone |


## M0 — Bootstrap
- [x] Monorepo folders per §16.1 (backend/frontend/nginx/docs)
- [x] `/CLAUDE.md`, `/AGENTS.md`, `docs/CHANGES.log` committed (§16.3)
- [x] `.env.example` generated from TD-13 inventory; boot-time fail-fast validation for Required vars
- [x] Version pins per §3.1a (Node 22 LTS image, PG 17, Prisma 6, React 19, Vite 6, Express 5, pg-boss 10)
- [x] CI skeleton: lint, typecheck, test runners, TD-6a migration-presence check, `db push` ban check, `.env` commit check, DROP/RENAME migration lint (TD-6b), OpenAPI↔TD-3 conformance check (§3.1)

## M1 — Infrastructure & Platform Core
- [x] `docker-compose.yml`: api, db, minio, nginx (+certbot); TZ=Africa/Casablanca; tzdata pinned (TD-11)
- [x] Nginx same-origin path routing `/` `/api/v1/` `/storage/` + SSL + rate limits + storage error-page mapping + prefix-strip/Host rewrite + CSP/nosniff + `/storage/` client_max_body_size 110m + proxy_request_buffering off (API 2m) + gzip static (§3.1, TD-13)
- [x] Signed PUT + signed GET round-trip through the /storage proxy passes (§3.1, §18)
- [x] MinIO dual buckets (public/private) + policies (§3.1)
- [x] `schema.prisma` full §7 model incl. `version` columns on TD-15 entities; plain constraints in Prisma
- [x] `RateLimitCounter` entity + unique `(user_id, bucket, window_start)` (§7/TD-6, Revision 14) — added by a forward-only follow-up migration (TD-6b)
- [x] Hand-written SQL migrations via `migrate dev --create-only`: explicit `CREATE COLLATION "ar-x-icu"` registration, column collations, CHECKs (incl. bp score checks), partial unique indexes, cross-table ayah trigger (TD-6, TD-6a)
- [x] Production seed, idempotent (§15.1): roles, categories/levels, subjects, academic year, 114 Surahs, SystemSetting defaults, Super Admin allow-list (via `pre_provisioned_email`, Revision 15 — no placeholder identity)
- [x] Dev fixtures with `NODE_ENV` guard (§15.2)
- [x] Google OAuth: state+PKCE (flow state in a short-lived signed HttpOnly callback-scoped cookie, TD-12 Revision 16), callback branches 4a/4b/4c, onboarding token (10 min, `jti` + ConsumedToken replay guard) (§4.1b, TD-12)
- [x] Step-4a routing complete: Active / Pending / (Rejected|Suspended|deleted_at → deactivated screen), never reactivation (§4.1b, Revision 16)
- [x] Email lowercasing on all identity lookups/writes (TD-12) + DB `CHECK (email = lower(email))` (TD-6)
- [~] Registration identity extracted solely from onboarding-token payload; body fields excluded from schema (§4.1b, TD-12)
  - ✓ Backend — onboarding token carries the verified `email` + `provider_subject_id`; payload is the sole identity source
  - ✓ Tests — 8 unit tests
  - ✓ Security — a substituted-email token fails signature verification (§20 rule 9)
  - △ Later milestone (M2) — `POST /registrations` and the Zod schema that must not even accept those fields
- [x] Access token via Authorization header only; refresh = sole cookie route with custom header + Origin check (TD-12)
- [ ] High-risk endpoint fresh DB status assertions (presigned mint, social profile, approvals, overrides) (TD-12)
- [x] `RefreshToken` entity + unique `token_hash` + `session_id` chain (§7/TD-6, Revision 16) — forward-only migration
- [x] Session layer: 1 h access JWT, 30 d rotating refresh cookie (HttpOnly/Secure/SameSite=Lax), hashed-never-raw storage, revocation list (TD-12)
- [x] Rotation / logout / revoke-on-suspension transactions (TD-4.13/14/15); 10 s grace window is idempotent (no chain fork); reuse outside grace revokes the whole session
- [x] Token-lifecycle acceptance criteria T1–T12 green (§18, Revision 16)
- [x] Pending hard-redirect; zero data access except `GET /me` + logout (TD-1); client-side global Pending route guard (§14.4)
  - ✓ Backend · ✓ Tests · ✓ Security · ✓ Frontend — `PendingGuard` renders the §2.1 status screen before any authenticated route mounts, so no skeleton leaks
- [x] Error envelope middleware + canonical code catalog incl. VERSION_CONFLICT/SERVICE_UNAVAILABLE + i18n message keys (TD-3.8)
- [x] Optimistic-locking helper (conditional UPDATE + version bump) shared across TD-15 entities
  - ✓ Backend — `updateWithVersion` for any TD-15 delegate; distinguishes VERSION_CONFLICT from NOT_FOUND
  - ✓ Tests — exercised live through Branch/Room PATCH
  - ✓ Security — stale version returns 409, never a silent overwrite (§20 rule 12)
- [~] Outbound timeout discipline (5 s, no hidden retries) + degraded-mode 503 handling per TD-16
  - ✓ Backend — 5 s `AbortSignal.timeout` on both outbound calls (Google token exchange, MinIO health); no hidden retries
  - ✓ Tests — exercised through `/healthz` component states
  - ✓ Security — upstream failures leak no detail; they surface as the canonical envelope
  - △ Later milestone (M6) — the full TD-16 matrix needs the storage endpoints that must 503 while MinIO is down
- [x] request_id propagation, JSON logs, no-PII log policy (TD-14)
- [x] `GET /healthz` with component checks (TD-14)
- [~] pg-boss bootstrap + job runner; JobsRepository same-transaction job inserts (§16.2, TD-4); token.purge + ratelimit.purge + audit.purge crons (TD-7)
  - ✓ Backend — runner in the API container; all three crons scheduled in Postgres with the TD-7 retry policy
  - ✓ Tests — all three purges run against the live worker and their effects verified
  - ✓ Security — `audit.purge` allowlist mutation-tested; an equally-ancient security event survived
  - △ Later milestone (M3/M6) — `JobsRepository` same-transaction enqueue, which needs a job-triggering mutation to exist
- [x] Pool/memory pins: Prisma limit 10, pg-boss ≤5, PG max_connections 30, statement_timeout 10s; shared_buffers/GOMEMLIMIT/max-old-space (TD-13)
- [x] OAuth callback failure redirects (/login?error=…, 4 keys) + OAUTH_EXCHANGE_FAILED + single-flight refresh w/ 10s grace (§4.1b, TD-12)
  - ✓ Backend · ✓ Tests · ✓ Security · ✓ Frontend — all four keys render as i18n messages with a retry affordance; the client shares one in-flight refresh promise so concurrent tabs cannot race each other into a logout
- [x] AuditLog table + write helper (TD-8); auth.login / login_denied / identity_bound / refresh / logout / token_revoked rows
- [x] OpenAPI generation wired; contract = implementation (TD-3) — **enforced against the live Express router**, not merely intended
  - ✓ Reproducible — regeneration is byte-identical to the committed document
  - ✓ CI — a dedicated `contract` job regenerates it and fails on any drift, so the committed file cannot be hand-edited
  - ✓ Gate — the conformance check consumes that regenerated artifact, not a manually-maintained one
  - ✓ Router-reconciled — generation walks the real route stack and fails on any documented-but-unserved or served-but-undocumented operation. This gap was real: a route documented in both the registry and OpenAPI, but never mounted, passed every gate while returning 404.
- [x] Branch/Room CRUD — **reference data: writes Super Admin only, reads Admin (branch-scoped)** (§2.2, §5.6, TD-2 Revision 26)
  - ✓ Backend — 8 routes; Zod validation at the boundary; TD-5 deletion guards under `FOR UPDATE`; TD-4.8 soft-delete + Trash + audit
  - ✓ Tests — verified live: 401 unauthenticated, optimistic locking both ways, TD-5 room-blocks-branch, TD-9 length limit
  - ✓ Tests — 13 integration tests for the R26 permission boundary in both directions; five mutations caught, including reverting writes to Admin and restricting reads to Super Admin
  - ✓ Security — §2.2 display_order refused for a plain Admin **and** allowed when absent; out-of-scope is 404 not 403 (§20 rule 17)
  - △ Frontend integration — the `/admin/branches` screen (§14.2) needs the React shell
- [ ] §18 Authentication & Onboarding checklist green

- [x] Client shell: RTL-first Arabic-only (§3.1, §6), i18n keys for every string (§16.2), §14.4 state components, §14.1 public routes only, branding assets
  - ✓ Frontend · ✓ Security — CSP unchanged (`default-src 'self'`, no font/CDN host); access token in memory only, read from the URL fragment and stripped from history (TD-12)
  - △ Later milestone (M2) — authenticated layouts, the account switcher, and the unified registration form

- [x] Branch-scoped authorization model made precise (§4.2, SRS Revision 24)
  - ✓ Backend — `policies/branch-scope.ts`; per-role resolution; `branch_id IS NULL` = all branches; Super Admin bypasses by role
  - ✓ Tests — 15 unit tests; five mutations caught, one per original defect
  - ✓ Security — fixed an all-branches Admin seeing nothing (proved 0 of 2 → 2 of 2 over HTTP) and a cross-role over-grant; `roles[]` derived from scopes so a token cannot self-contradict
  - ⚠ Supersedes OPEN AMBIGUITY 4 — user-list branch scoping should now be decided under this model

## M2 — Registration, Approvals, Family
- [x] Unified parent+child registration transaction (TD-4.1) + adult path
  - ✓ Backend — `POST /registrations`; replay guard consumed FIRST so the `jti` is authoritative; both paths in one transaction
  - ✓ Tests — 11 integration tests incl. the §18 mid-transaction atomicity check and concurrent submission of one token
  - ✓ Security — schema **rejects** `email`/`provider_subject_id` outright (§20 rule 9); replay → `STATE_CONFLICT`; fails closed with no consent text version
  - △ Frontend integration (M2) — the unified registration form
- [~] ConsentRecord model + versioned text + staff-recorded method (§4.1a)
  - ✓ Backend — `online_form` consents written in the registration transaction with the active text version from `SystemSetting`
  - ✓ Tests — a declined media release is recorded with actor + timestamp, not omitted (BR-1)
  - △ Later milestone (M2) — the `staff_recorded` path and consent management UI
- [x] `POST /family-links` — staff-mediated link of an existing child (§4.3 Revision 23)
  - ✓ Backend — Admin/Super Admin only with the TD-12 freshness assertion; creates a `Pending` link decided in the §5.6 queue; duplicate answers `DUPLICATE`, never `FAMILY_LINK_PENDING`
  - ✓ Tests — 11 service + 6 HTTP tests; five mutations caught, including one reopening parent self-service
  - ✓ Security — there is no parent-facing path to an existing child; a parent caller is refused at the edge, not merely unlinked in the UI
- [~] Staff pre-provisioning UI/flow (bind-on-first-login) (§4.1b 4b, TD-4.10)
  - ✓ Backend — `POST /admin/users`; no placeholder identity (§7); lowercased + TD-6-unique address; role/branch scope in the same transaction
  - ✓ Tests — 13 integration tests incl. the full bind-on-first-login path through the repository the login flow calls; six mutations caught
  - ✓ Security — TD-2 admin-only with TD-12 freshness; only a Super Admin may create another Admin; a soft-deleted person's address is never reclaimed
  - △ Frontend integration — the §14.2 create form
- [x] Super Admin bootstrap semantics (§15.1, SRS Revision 22) — the last open specification ambiguity, resolved
  - ✓ Backend — gate is "an active Super Administrator exists", not "a row matching this email"; ignored permanently afterwards; grants rather than duplicates; activates a matched non-active account; fails loudly on a soft-deleted holder
  - ✓ Tests — 11 integration tests; six mutations of the gate all caught, including one restoring the exact pre-R22 bug
  - ✓ Security — reopening the gate on total lockout is the sanctioned recovery path and grants no new authority (the seed is a manual host step, §19.1 step 6)
- [~] Approval queue: bundles, approve (TD-4.2 atomic) / reject with reason
  - ✓ Backend — `GET /admin/approvals` + approve/reject; both item types (registration bundle, standalone §4.3 link); a pending child never appears as its own entry, so the family is approved once; TD-10 paginated
  - ✓ Backend — TD-12 freshness policy (`assertFreshActive`) re-reads the caller and rebuilds roles from live rows; it returns the fresh roles rather than a boolean so a caller cannot verify freshness and then act on the token's stale authority
  - ✓ Tests — 11 service-level + 10 HTTP-level integration tests; the HTTP layer covers route mounting, the TD-3.8 envelope and status codes, which service tests cannot see
  - ✓ Security — TD-2 admin/super-admin only; a *validly signed* token claiming `admin` for a non-admin user is refused; suspension and role revocation take effect on the next request; first-wins on concurrent decisions (TD-15.3) with 409, never a 500; rejection requires a reason within TD-9's 500 chars
  - ✓ Security — all five guards mutation-tested (freshness status check, freshness role check, bundle exclusion, child activation, mandatory reason); every mutant is caught
  - △ Frontend integration — the §5.6 queue screen and §14.2 columns
- [ ] FamilyLink lifecycle (TD-1); unique partial index enforced
- [~] `X-Active-Child-ID` middleware: (parent+child) match, Student-role self-bypass via JWT sub, 400/404 semantics, never from body/query (§4.3)
  - ✓ Backend — §4.3's ordered resolution in `middleware/child-context.ts`; returns the verified student id, not a boolean, so no caller can fall back to a body/query id
  - ✓ Tests — 15 integration tests incl. both §19.2 named regressions (Student-role bypass, foreign-parent 404); seven mutations all caught
  - ✓ Security — every no-match reason returns an indistinguishable 404; a malformed header no longer 500s (that difference was a side channel); the bypass is unreachable for a Parent-only caller
  - △ Later milestone (M3–M6) — mounting it on the child-scoped endpoints, which arrive with calendar, Quran progress, grades and content

- [x] Revoke an approved family link = soft-delete (§4.3, Revision 16); TD-2 row + `familylink.revoke` audit; middleware already 404s the next request
  - ✓ Backend — `DELETE /admin/family-links/{id}`; TD-4.8 transaction (soft-delete + Trash snapshot + audit); `Approved` stays terminal in TD-1
  - ✓ Tests — 10 service + 7 HTTP tests; asserted through the resolver (access gone on the next request), not merely that a column changed
  - ✓ Security — TD-2 admin-only with the TD-12 freshness assertion; revoking one link leaves the parent's other children and the child's other parent untouched

- [ ] ChildContextSwitcher component + API-client header injection (§14.3, §16.1)
- [~] GroupTeacher join + teacher-scoping resolution helpers (§4.2)
  - ✓ Backend — `policies/teacher-scope.ts`; reach resolves exclusively through `GroupTeacher`, never through a Teacher's branch assignment
  - ✓ Tests — 16 integration tests against real branches, groups and enrolments; six mutations caught
  - ✓ Security — out-of-scope is 404 not 403 (no existence leak for a minor's record); revoking an assignment, un-enrolling, or deleting the group each end reach on the next call
  - △ Later milestone (M3) — the admin UI that creates groups and assigns teachers arrives with Group CRUD
- [ ] StudentSocialProfile field-level restriction (assigned teachers only) (§4.10, TD-2)
- [~] User Management screen per §14.2 incl. normalized-shadow-column substring search, no fuzzy (TD-10)
  - ✓ Backend — `GET /admin/users`; §14.2 columns exactly; filters read live assignments; TD-10 envelope and ar-x-icu ordering
  - ✓ Tests — 14 list/search tests + a 38-entry parity corpus proving the TS normalizer matches the SQL function byte for byte; eight mutations caught
  - ✓ Security — §4.10 fields never leave the list (asserted on the row shape); TD-2 admin-only with TD-12 freshness
  - ✓ Visibility — RESOLVED by SRS Revision 25: branch-scoped Admins see only users assigned to their branches; unassigned users are Super Admin only; the branch filter narrows within scope and cannot escape it
  - ⚠ Open for a future decision — registration records no branch, so pending registrations are unassigned and Super-Admin-visible; the §5.6 queue is deliberately unscoped and remains the branch Admin's path to applicants
  - △ Frontend integration — the §14.2 table, filters and search box
- [ ] §18 Registration, Approvals & Family checklist green (incl. mid-transaction kill test)

## M3 — Scheduling & Calendar
- [ ] Group CRUD: wall-clock times, room/time conflict detection, capacity (FOR UPDATE, TD-15), co-teaching, optimistic version locking (§4.4, TD-11, TD-15)
- [ ] Roster management + consent re-evaluation enqueue on every mutation (TD-4.6)
- [ ] Event model: visibility enum, recurrence (none/daily/weekly/biweekly-alternating/yearly) (§4.4)
- [ ] Explicit four-way scope-join population at creation; operational-start filter (§4.4)
- [ ] Branch-activation manual backfill action + endpoint (§4.4, TD-3.4)
- [ ] Calendar views: month/week/agenda, filters, glance view, session popup, Monday start
- [ ] Three-tier visibility filtering per role incl. public tier for anonymous (§4.4, TD-2)
- [ ] Operational-start-date graying in branch-scoped views
- [ ] Hijri overlay: Morocco-tuned source + admin offset (−2..+2) + DualDateDisplay (§4.4, §5.7)
- [ ] §18 Scheduling & Calendar checklist green (incl. Ramadan DST regression test)

## M4 — Quran Progress
- [ ] QuranProgressLog CRUD (teacher-scoped) with soft delete (TD-5)
- [ ] Interval-merge union engine + percentage vs total_ayahs (BR-13)
- [ ] StudentSurahProgress cache: post-commit upsert + read-side stamp guard with self-heal (§4.5, §7)
- [ ] Synchronous per-surah recalc on create/update/soft-delete — derive-on-read immediately after commit, returned in response (§4.5, TD-4.11)
- [ ] Ayah bounds: CHECK + cross-table trigger + service validation (TD-6)
- [ ] Audit rows quranlog.update / quranlog.delete (TD-8)
- [ ] Student read-only per-surah expandable progress view (§5.3)
- [ ] p95 < 100 ms incl. recalc verified (TD-11a)
- [ ] §18 Quran Progress checklist green (incl. deletion-un-completes-level test)

## M5 — Exams & Grading
- [ ] Exam builder: immutable question UUIDs, MCQ + free-text (digital-only; print CSS post-MVP §10.1)
- [ ] Access policies single_submission / save_and_resume + submission lifecycle (TD-1)
- [ ] All scores as integer bp (0–10,000), round-half-up once at persistence; no float score columns (§4.6, TD-6)
- [ ] MCQ auto-grade → draft Grade; subjective grading flow; absent-zero rows initialized at first draft save (BR-7, §4.6)
- [ ] Grade.group_id sitting provenance + aggregation scoped to active-template exams × currently-enrolled students (§4.6)
- [ ] Grade + User optimistic versioning incl. recalc-job participation (TD-15)
- [ ] Postponement check: no template tables/UI/recalc anywhere (§10.1)
- [ ] Pass/fail override endpoint + audit (TD-8)
- [ ] LevelSurah/LevelSubject auto-draft components incl. Women's dual generation (BR-9, §4.6)
- [ ] §18 Exams & Grading checklist green (incl. both race tests)

## M6 — Content, Consent & Storage
- [ ] Upload initiate/complete/abort: single-shot presigned PUT, branch-scope validation, Teacher Global rejection (§4.9, TD-3.5)
- [ ] Authoritative per-user upload quota 30/hour in PostgreSQL (`RateLimitCounter`), locked + incremented in the initiate transaction (TD-4.12, TD-15.2); `429 RATE_LIMITED` envelope; never in-process memory, never pg-boss, never njs (§3.1 Revision 14)
- [ ] Magic-byte validation at /complete via ranged GET (bytes 0–511) to MinIO + HEAD size check; reject-and-delete (§4.9, TD-9)
- [ ] Hash-segmented immutable keys; replacement mints new key + quarantines old (TD-9)
- [ ] FileUploader: progress, failure, clean retry (R-9) (§14.3)
- [ ] Phone-recording upload guidance panel on /teacher/content (§4.9); cross-browser playback E2E for TD-9 containers (§14.7)
- [ ] Visibility transitions + bucket-migrate job + `/content-unavailable` (§3.1, TD-4.9)
- [ ] Consent re-evaluation engine wired to enrollment/consent/upload; consent_forced_private; empty-group → Category default (§4.1a, §4.9, BR-2)
- [ ] Admin-only consent-gate override with mandatory justification + audit (BR-3, TD-8)
- [ ] Presigned GET mint with full permission + child-context check, 10 min TTL (TD-12)
- [ ] Resources directory nesting: Category→Level→Year(current pinned)→Branch(Global top)→Subject (§5.2)
- [ ] upload.gc + content.quarantine-purge cron jobs (TD-7)
- [ ] §18 Content, Consent & Storage checklist green

## M7 — Hardening & Launch Data
- [ ] TD-11a targets measured against ceiling-scale fixtures (§2.4); no N+1 / unbounded scans audit
- [ ] Arabic RTL pass: complete ar catalog, error message_keys (fr/en post-MVP §10.1)
- [ ] Nginx rate limits verified live (TD-13); presigned-URL permission audit
- [ ] Locked CLI restore script (`npm run db:restore`) wrapping restore + cascades + audit in one transaction; executed once on fixtures (§4.10, TD-8)
- [ ] backup.replicate job + restic offsite target; restore drill < 1 h RTO documented (§6)
- [ ] Manual launch-data entry session(s) with coordinator: branches, rooms, groups, roster (R-5, §15.1)
- [ ] No-PII log audit pass (TD-14)
- [ ] §18 Data, Admin & Audit checklist green

## M8 — Rehearsal, UAT, Launch
- [ ] §19.1 pipeline executed on the production Moroccan VPS (steps 1–10)
- [ ] Full E2E suite J1–J8 green on rehearsal deployment (§17, §19.2)
- [ ] All §19.2 named regression tests green (incl. VERSION_CONFLICT, capacity race, double-approval, MinIO-down, worker-down)
- [ ] UAT with branch coordinator incl. low-digital-literacy registration drill (R-1)
- [ ] R-9 upload failure rate measured during UAT; escalation decision recorded
- [ ] Certificate automation (Let's Encrypt) verified on VPS (R-8)
- [ ] §18 Platform & Deployment checklist fully green
- [ ] Production launch; LAUNCH row in CHANGES.log
