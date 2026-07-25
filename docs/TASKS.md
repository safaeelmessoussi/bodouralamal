# Tasks — بذور الأمل Platform
**Granular implementation checklist. Mutable — agents tick items (`[x]`) as work completes and may split items into sub-items, but never add tasks for post-MVP features (SRS §10.1) and never contradict the SRS. Milestone order: `docs/IMPLEMENTATION_PLAN.md`. Completion log: `docs/CHANGES.log`. SRS references in parentheses are the authority for each item.**

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
- [~] Registration identity extracted solely from onboarding-token payload — **token side done** (payload is the sole identity source, substitution test green); the `POST /registrations` endpoint that must exclude body fields is M2
- [x] Access token via Authorization header only; refresh = sole cookie route with custom header + Origin check (TD-12)
- [ ] High-risk endpoint fresh DB status assertions (presigned mint, social profile, approvals, overrides) (TD-12)
- [x] `RefreshToken` entity + unique `token_hash` + `session_id` chain (§7/TD-6, Revision 16) — forward-only migration
- [x] Session layer: 1 h access JWT, 30 d rotating refresh cookie (HttpOnly/Secure/SameSite=Lax), hashed-never-raw storage, revocation list (TD-12)
- [x] Rotation / logout / revoke-on-suspension transactions (TD-4.13/14/15); 10 s grace window is idempotent (no chain fork); reuse outside grace revokes the whole session
- [x] Token-lifecycle acceptance criteria T1–T12 green (§18, Revision 16)
- [~] Pending hard-redirect; zero data access except `GET /me` + logout (TD-1) — **server side done**; the client-side global route guard (§14.4) needs the frontend shell
- [~] Error envelope + canonical code catalog incl. VERSION_CONFLICT/SERVICE_UNAVAILABLE + i18n message keys (TD-3.8) — catalog, typed domain errors and envelope done + tested; Express middleware lands with the app
- [ ] Optimistic-locking helper (conditional UPDATE + version bump) shared across TD-15 entities
- [~] Outbound timeout discipline (5 s, no hidden retries) **done** for Google + MinIO; the full TD-16 degraded-mode 503 matrix needs the storage endpoints (M6)
- [x] request_id propagation, JSON logs, no-PII log policy (TD-14)
- [x] `GET /healthz` with component checks (TD-14)
- [~] pg-boss bootstrap + job runner; token.purge + ratelimit.purge + audit.purge crons **done and verified live** (TD-7). `JobsRepository` same-transaction job inserts (§16.2, TD-4) lands with the first job-triggering mutation (M3 roster / M6 consent)
- [x] Pool/memory pins: Prisma limit 10, pg-boss ≤5, PG max_connections 30, statement_timeout 10s; shared_buffers/GOMEMLIMIT/max-old-space (TD-13)
- [~] OAuth callback failure redirects (4 keys, all verified live) + OAUTH_EXCHANGE_FAILED **done**; the 10 s server grace is **done** (T3); the **client-side single-flight refresh mutex** needs the frontend
- [x] AuditLog table + write helper (TD-8); auth.login / login_denied / identity_bound / refresh / logout / token_revoked rows
- [x] OpenAPI generation wired; contract = implementation (TD-3)
- [ ] Branch/Room CRUD + display_order (Super Admin only) (§2.2, §5.6) — unblocked by Revision 21; 8 routes registered with SRS citations
- [ ] §18 Authentication & Onboarding checklist green

## M2 — Registration, Approvals, Family
- [ ] Unified parent+child registration transaction (TD-4.1) + adult path
- [ ] ConsentRecord model + versioned text + staff-recorded method (§4.1a)
- [ ] Staff pre-provisioning UI/flow (bind-on-first-login) (§4.1b 4b, TD-4.10)
- [ ] Approval queue: bundles, approve (TD-4.2 atomic) / reject with reason
- [ ] FamilyLink lifecycle (TD-1); unique partial index enforced
- [ ] `X-Active-Child-ID` middleware: (parent+child) match, Student-role self-bypass via JWT sub, 400/404 semantics, never from body/query (§4.3)
- [ ] Revoke an approved family link = soft-delete (§4.3, Revision 16); TD-2 row + `familylink.revoke` audit; middleware already 404s the next request
- [ ] ChildContextSwitcher component + API-client header injection (§14.3, §16.1)
- [ ] GroupTeacher join + teacher-scoping resolution helpers (§4.2)
- [ ] StudentSocialProfile field-level restriction (assigned teachers only) (§4.10, TD-2)
- [ ] User Management screen per §14.2 incl. normalized-shadow-column substring search, no fuzzy (TD-10)
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
