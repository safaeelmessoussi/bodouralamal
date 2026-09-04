# Tasks — بذور الأمل Platform

## Controlled-UAT corrections — 2026-09-01

- [x] Registration now accepts the real multi-child consent shape: one required
  request-level data-processing decision and one explicit media-release decision per child.
  French names remain optional as a pair for every adult and child; both controls explain
  that rule and server validation identifies the missing counterpart.
- [x] Pending and Rejected registration accounts remain in طلبات الانضمام and are absent
  from ordinary account-management and operational-directory populations. Approval places
  every admitted beneficiary, sets the durable beneficiary fact and grants the structural
  branch-scoped Student role in the same transaction.
- [x] Platform ownership protects only the live global Super Admin assignment. The Owner may
  add, change and remove ordinary functional roles; the main user-form Save includes its
  visible role draft. The existing current-owner-only transfer action remains discoverable
  on eligible active Global Super Admin rows.
- [x] The public calendar sends the current access token when one exists, leaving visibility
  resolution to the server. Students/Parents receive the ratified private tier, staff remain
  scoped, role-less Active accounts fail closed to public, and hidden remains responsible-
  person/Super-Admin only. Day cells pin Hijri to the physical left and Gregorian to the
  physical right without changing either date.
- [x] Removed the user-facing file-replacement action while retaining the internal R53 upload
  primitive. New scheduling items default to المستوى كامل and new staffing rows to مؤطّرة
  مسؤولة; edits preserve stored values. The existing shared dirty-form guard already closes
  pristine forms immediately and confirms only genuine unsaved changes.
- [x] Calendar integration fixtures now own reserved Hijri years and remote Gregorian dates;
  teardown can no longer delete an operator-recorded 1447/1448 catalogue. The all-table
  isolation runner proves the restored local catalogue remains byte-stable.
- [x] **R116 — comprehensive actionable notifications.** The ratified catalogue extends the
  existing caller-owned inbox for registration/approval, family links, roles, ownership,
  enrolment, Session/Event restaffing and physical Exam lifecycle. Exact target FKs,
  transaction-local delivery, actor exclusion, dual-role semantic coexistence, real-transition
  resurfacing and hidden responsible-only withdrawal are enforced. Upload completion stays
  silent because it is storage finalization rather than a publication decision. The postponed
  tier/preference/channel framework and TD-7 job catalogue remain unchanged.
- [x] **R117 — registration/guardian controlled-UAT closure.** Registration-review notices
  open one exact authorized pending request and stale coordinates render safely. Reviewers see
  complete guardian contact/consent data and separate submitted details for every child.
  Sibling Category/Branch requests remain exact into their own placement decisions; a
  children-only guardian is activated without beneficiary/Student/Enrollment state. New
  registration requires phone while legacy null remains valid, Parent lands on the supported
  Student Dashboard, and non-Parent context clears any stored child coordinate. Focused local
  evidence is 41/41 real-browser plus 12/12 exact database assertions.

## Platform Owner and هيئة التأطير framing — R115, 2026-08-31

- [x] Platform ownership is a protected singleton lifecycle relationship, not a new Role.
  Transfer is current-owner-only to another active Global Super Admin; the singleton is locked
  before both Users in deterministic order, and suspension, deletion, permanent
  de-identification and demotion are refused until transfer.
- [x] The fresh bootstrap identity is exactly `safae.elmessoussi@gmail.com`, صفاء المسوسي,
  female, active Global Super Admin, with `both`/all-current-and-future-branches general
  framing and no invented weekly hours or Google provider subject. Once ownership exists,
  seed reruns are ownership no-ops and never reclaim a transfer.
- [x] A هيئة التأطير request records strict planning willingness: online, physical or both;
  physical modes support one, several, or durable future-inclusive all branches. Approval
  displays it, and approved teaching profiles retain the same value read-only. It never
  supplies authority or weekly availability.
- [x] Every weekly availability interval may state its own mode; legacy null remains honestly
  unknown. Candidate appraisal reports incompatibility/unknown as an advisory warning only.
- [ ] **Controlled-UAT Staging promotion:** only after this exact implementation commit passes
  complete hosted CI, take and validate the Staging backup, promote exact images, apply the
  migration/seed, prove exactly one unbound Owner and healthy synthetic-only educational data,
  then stop for the Owner's manual Google login. Production and DNS remain out of scope.

## Local authenticated navigation restored — 2026-08-31

- [x] The development Compose overlay now replaces the release Nginx port list with exactly
  the IPv4 and IPv6 loopback mappings `127.0.0.1:80:80` and `[::1]:80:80`. Local Nginx serves
  HTTP only, so it neither inherits a published but unserved port 443 nor refuses a later
  browser navigation when `localhost` resolves to `::1`. Staging/Production retain the
  release 80/443 topology and all cookie attributes stay unchanged.
- [x] The real Chrome regression now uses the production-shape Secure refresh cookie, clicks
  the rendered لوحة التحكم control, and covers HTTP arrival, Back/Forward, reload, logout,
  re-login, a consumed OAuth callback, a fresh tab and Admin/Super Admin authorization
  (**42/42**), after independently requiring both loopback families to reach the edge. The
  consumed-callback screen remains the intentional standalone auth status layout; it was not
  the transport failure.

## Staging promoted — 2026-08-30 (previous strict-synthetic release)

`https://staging.bodouralamal.com` is deployed and healthy at
`4fd620de2cf182aa8a8342d48641c054ea76002e`. Hosted run `33262358687`, attempt 2,
passed all six verification jobs and published both exact-commit images before promotion.
The real edge then passed the complete 15/15 anonymous browser smoke and a stateless-service
restart. The remaining count-only provenance finding was closed for that release: Staging
passed strict synthetic-only acceptance without changing the deployed release. Revision 115
now authorises one exact Owner identity for controlled UAT, but that later transition does not
retroactively change this evidence and is tracked above.

That deployment evidence belongs to that commit. Later `develop` commits are not thereby accepted on
Staging; current promotion state and blockers live in the
[deployment-readiness ledger](operations/deployment-readiness.md).

**Open items carried forward:**

- [x] **Strict Staging synthetic-only boundary — CLOSED 2026-08-30.** PII-redacted provenance
  evidence classified both untagged OAuth-bound accounts as **B (manually created/personal)**:
  one was the original bootstrap administrator later bound and manually expanded, and the other
  was a self-registered/approved account. Both were permanently de-identified through the exact
  deployed domain service after an owner-only, catalog-validated PostgreSQL backup; dependent
  identity/session credentials and the two unclaimed email synchronization coordinates were
  removed. The two untagged Branch rows are **A (authoritative reference/fixture data)**: every
  committed reference field matches and each has an exact tagged counterpart, so both were
  retained with their fixture relationships. Final count-only acceptance proves 8/8 active
  users match committed fixtures, zero OAuth identities/personal coordinates, 0 non-fixture
  beneficiaries, 0 fixture-email violations, and 4/4 live Branch rows match authoritative
  definitions. Release `4fd620de2cf182aa8a8342d48641c054ea76002e`, 61/61 migrations,
  `/healthz` 9/9 worker readiness, HTTPS, and the 15/15 browser smoke remain green. Production
  was not accessed or changed.

- **Rule AX, remaining instance:** the Content **Recorder** dialog still takes its scope from
  the page filters. Its own slice — R75's recorder has a separate submit path.
- **Rule AX, borderline:** `session-materials-dialog` takes the Session's scope as context and
  does not display it. Owner decision whether *"fixed → disabled, not hidden"* applies.
- **Automated authenticated Staging E2E** — the next bounded engineering task the Owner
  already scoped: it must preserve the real authentication boundary rather than minting
  unauthenticated sessions, which is why `issue-dev-session.ts` still refuses a non-loopback
  database and was never weakened.
- **Housekeeping:** the disposable `bodour_v` database, the stale `bodouralamal-db` container
  on port 5434, and the old `bodouralamal-*` volumes are all retained for a later cleanup task.

## ✅ FIXED — the Content Upload screen had no visibility selector (§14.1)

**Found 2026-08-25 by an Owner performing a real upload on Staging and being unable to mark
it private. Fixed the same day, before Staging acceptance.**

§14.1 specifies the node as:

> **Content Upload (`/teacher/content`)** — … **visibility selection honoring Category
> defaults and the consent gate** (consent-forced private state visible but not editable by
> Teachers; Global scope unavailable to Teachers, §4.9).

The selection does not exist. Everything around it does:

| Layer | State |
|---|---|
| `initiateUpload` | **accepts** `meta.visibility`, falling back to the Category default |
| `UploadMeta` (client type) | **declares** `visibility?: 'public' \| 'private' \| 'hidden'` |
| `content.tsx` | renders visibility as a **read-only column** and never sets it |
| i18n | `content.visibility.public/private/hidden` exist and are used — for the column |
| `docs/openapi.json` | already documented `visibility?` in prose — see the correction below |

So the platform silently always takes the Category default. On the staging fixtures that is
`public` for الكبار, which is why an Owner asking for private content got public content and
no control to change it.

**This is rule P again — a complete capability with no reach — and it is the seventh
instance.** The service, the client type and the copy were all built; the control was not.

> **Correction to the first report of this defect.** It said the OpenAPI document omitted
> `visibility` from `content_meta`. It does not: the `/uploads/initiate` description already
> lists `{ … visibility?, origin?, replaces_content_id? }` and states the Category fallback.
> What is true is that the generator emits **no request-body schema for any operation** —
> bodies are documented in prose throughout, by design, because TD-3 is canonical and OpenAPI
> is a generated artifact. So the contract was **not** incomplete here, and adding a schema
> for this one operation would have introduced a second convention into a document that
> uniformly has none. **No OpenAPI schema change was made.**

### What was built

A `SelectField` on the **upload** dialog only, offering the three tiers through the existing
`content.visibility.*` labels — no new terminology and no new i18n keys.

**The default rides the Level, not the Category, and that is the load-bearing decision.**
`GET /admin/categories` is Admin-only (TD-2 R26, R30) and the content page never requests it,
so resolving the default through a Category list would have returned `null` on every screen
that needs it — *the same defect in a new place*. It now travels on `LevelDto`
(`default_visibility`), which is the very list that offers the Level, so a screen that can
offer a Level can always honour its default. That also mirrors the server:
`categoryDefaultVisibility` is keyed on a **level id**.

Four properties the implementation holds deliberately:

- **Absent is never `public`.** No Level chosen, list not arrived, or a payload predating the
  field all resolve to `null` — the selector waits rather than proposing the open tier. A
  dialog that preselected `public` because a request was slow would publish content by
  accident.
- **A malformed settings row resolves to `private`**, server-side and client-side. Never
  widen on a surprise.
- **Replacement has no selector**, so R53 stays a file swap rather than becoming a
  publication decision; the row's own visibility remains authoritative.
- **`consent_forced_private` is not reachable from this form.** BR-2 owns it, a new upload
  starts `false`, and lifting it is BR-3's separate Admin-with-justification workflow —
  deliberately not this slice.

All three tiers are offered to everyone who can reach the screen, and that is *derived*:
`assertUploadScope` gates the Global/branch scope and nothing else, so §4.9 places no
per-role limit on the tier itself. §14.1's *"not editable by Teachers"* is about the
consent-forced state, which no new upload can be in.

## ✅ FIXED — CI had been red on `develop` since before 2026-08-20

**`prisma generate` never runs in the clean CI jobs.** The `backend` and `API contract` jobs
run `npm ci` → `npm run lint` → `npm run typecheck`, and `src/generated/prisma/**` is
gitignored, so typecheck cannot find the client:

```
TS2307: Cannot find module './generated/prisma/client.js'
```

followed by a cascade of `TS7006` on every parameter whose type came from it. It passes on a
developer machine only because the working tree already holds a generated client, which is
the same shape of blindness that hid the frontend lock-file break: **local green and CI green
were never the same thing, and nobody was comparing them.**

**Fixed 2026-08-25**: `npx prisma generate` now runs after `npm ci` in both the `backend` and
`contract` jobs. It was pulled into the staging slice after all, because the adopted release
flow makes **clean CI on the exact commit a precondition for deploying to Staging** — so
leaving it red would have blocked the very promotion it was recorded beside. Nothing further
was hiding behind it: the run went green on the first attempt.

> Discovered 2026-08-25 during the staging deployment. The other cause of the same red build
> — `frontend/package-lock.json` out of sync so `npm ci` failed on every clean checkout — was
> fixed in that slice because it blocked the deployment build itself.

> **Backend Release-Candidate status (2026-07-29, SRS Revision 33).** M0–M3 are **complete on the backend**:
> every TD-3 endpoint for those milestones is implemented, documented and router-reconciled, and both the
> §18 *Registration, Approvals & Family* and *Scheduling & Calendar* checklists are green. 97 unit + 473
> integration tests, six CI guards, zero contract drift. The only M0–M3 item still open is **frontend**
> (`ChildContextSwitcher`, owned by v0). M4–M8 below are future milestones and are genuinely unstarted.
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
- [x] CI: all 24 committed guards, lint, exact typecheck, default test runners, backend/frontend production builds, and ordinary OpenAPI↔TD-3 conformance (§3.1). Integration/browser/coverage infrastructure and fatal `TD3_REQUIRE_COMPLETE=1` remain separate slices

## M1 — Infrastructure & Platform Core
- [x] `docker-compose.yml`: api, db, minio, nginx (+certbot); TZ=Africa/Casablanca; tzdata pinned (TD-11)
- [x] Nginx same-origin path routing `/` `/api/v1/` `/storage/` + SSL + rate limits + storage error-page mapping + prefix-strip/Host rewrite + CSP/nosniff + `/storage/` client_max_body_size 110m + proxy_request_buffering off (API 2m) + gzip static (§3.1, TD-13)
- [x] Signed PUT + signed GET round-trip through the /storage proxy passes (§3.1, §18)
- [x] MinIO dual buckets (public/private) + policies (§3.1)
- [x] `schema.prisma` full §7 model incl. `version` columns on TD-15 entities; plain constraints in Prisma
- [x] `RateLimitCounter` entity + unique `(user_id, bucket, window_start)` (§7/TD-6, Revision 14) — added by a forward-only follow-up migration (TD-6b)
- [x] Hand-written SQL migrations via `migrate dev --create-only`: explicit `CREATE COLLATION "ar-x-icu"` registration, column collations, CHECKs (incl. bp score checks), partial unique indexes, cross-table ayah trigger (TD-6, TD-6a)
- [x] Production seed, idempotent (§15.1): roles, categories/levels, R107–R108 extensible eight-Subject baseline with exactly one حفظ القرآن memorisation marker, academic year, 114 Surahs, SystemSetting defaults, Super Admin allow-list (via `pre_provisioned_email`, Revision 15 — no placeholder identity)
- [x] Dev fixtures with `NODE_ENV` guard (§15.2)
- [x] Google OAuth: state+PKCE (flow state in a short-lived signed HttpOnly callback-scoped cookie, TD-12 Revision 16), cryptographically verified Google ID token (RS256/provider key, exact issuer, configured audience, lifetime, subject, verified email), callback branches 4a/4b/4c, first binding guarded by the authoritative User lock/status re-read, onboarding token (10 min, `jti` + ConsumedToken replay guard) (§4.1b, TD-12)
- [x] Step-4a routing complete: Active / Pending / (Rejected|Suspended|deleted_at → deactivated screen), never reactivation (§4.1b, Revision 16)
- [x] Email lowercasing on all identity lookups/writes (TD-12) + DB `CHECK (email = lower(email))` (TD-6)
- [x] Cross-channel normalized-email ownership: registration, staff pre-provisioning,
  first binding and production bootstrap share one collision-free row lock; stale onboarding
  snapshots and concurrent absent claims cannot create two intended accounts. Upgrade backfill
  refuses pre-existing ambiguity rather than choosing a person in migration SQL
- [~] Registration identity extracted solely from onboarding-token payload; body fields excluded from schema (§4.1b, TD-12)
  - ✓ Backend — onboarding token carries the verified `email` + `provider_subject_id`; payload is the sole identity source
  - ✓ Tests — 8 unit tests
  - ✓ Security — a substituted-email token fails signature verification (§20 rule 9)
  - △ Later milestone (M2) — `POST /registrations` and the Zod schema that must not even accept those fields
- [x] Access token via Authorization header only; refresh and logout are the only refresh-cookie consumers, both with the same custom-header + Origin checks; cookie Path `/api/v1/auth` (TD-12, R101)
- [~] High-risk endpoint fresh DB status assertions (presigned mint, social profile, approvals, overrides) (TD-12)
  - ✓ Covered on every surface that exists — approvals (5 assertions), consent overrides (3), social profile, user management, family links: a mid-session suspension or a revoked role assignment loses the capability on the **next call**, on the caller's still-valid token
  - △ *presigned mint* arrives with **M6 (Storage)**; the `/uploads/*` endpoints are not built, so this cannot be green before then
- [x] `RefreshToken` entity + unique `token_hash` + `session_id` chain (§7/TD-6, Revision 16) — forward-only migration
- [x] Session layer: 1 h access JWT, 30 d rotating refresh cookie (HttpOnly/Secure/SameSite=Lax/Path `/api/v1/auth`), hashed-never-raw storage, revocation list (TD-12, R101)
- [x] Rotation / logout / revoke-on-suspension transactions (TD-4.13/14/15); logout revocation + `auth.logout` audit are atomic; refresh/logout/purge serialize on a stable per-`session_id` row; identity binding, final login issuance, switch-role and revoke-all serialize on the User row before session anchors and re-read authoritative state; the explicit User `NO KEY UPDATE` is compatible with implicit child-FK `KEY SHARE`, closing the session→User/User→session deadlock; post-rotation access issuance permits only Active/Pending under its session lock; 10 s grace is idempotent (no chain fork) and cannot resurrect a logged-out chain
- [x] R102 Pending → Rejected closure: the approval transaction holds the User-first → RefreshSession-anchor hierarchy, revokes every live session as `rejection`, and atomically writes `user.reject` plus `auth.token_revoked`; refresh/login races cannot leave a live successor or new session, unrelated users remain independent, and later state changes never resurrect an old credential
- [x] R101 rollout: old API stops first; migration audits and invalidates every live legacy narrow-Path session as `cookie_path_migration`; users reauthenticate
- [x] Token-lifecycle acceptance criteria T1–T14 green (§18, Revisions 16, 101 and 102)
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
- [x] `GET /healthz` with truthful dependency and worker-readiness checks (TD-14)
  - ✓ Queue infrastructure is independent from process-local runner readiness; a surviving
    `pgboss` schema cannot make stopped/failed/unregistered workers healthy
  - ✓ Expected workers derive from the actual registration catalog; live pg-boss activity
    detects missing, inactive, and stale workers with an injected-clock test seam
- [~] pg-boss bootstrap + job runner; JobsRepository same-transaction job inserts (§16.2, TD-4); token.purge + ratelimit.purge + audit.purge crons (TD-7)
  - ✓ Backend — runner in the API container; all three crons scheduled in Postgres with the TD-7 retry policy
  - ✓ Tests — all three purges run against the live worker and their effects verified
  - ✓ Security — `audit.purge` allowlist mutation-tested; an equally-ancient security event survived
  - ✓ Backend — `JobsRepository` same-transaction enqueue implemented (§16.2 sanctioned raw SQL); first consumer is the §4.1a consent re-evaluation
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
  - ✓ Contract — explicit DTOs (§16.2, Revision 38): allow-list projection, `snake_case`, `operational_start_date` as a TD-11 **date**; the four internal columns no longer exposed. Replaces the raw Prisma rows this task originally shipped
  - ✓ Tests — 10 HTTP tests asserting the **exact key set** of every branch and room response. **There was no HTTP-level test here before**, which is how the contract drifted unnoticed
  - ✓ Frontend integration — the `/admin/branches` screen (§14.2), first consumer of the shared CRUD framework
- [~] §18 Authentication & Onboarding checklist — **backend green**, two items outstanding by milestone/ownership
  - ✓ **`state`, PKCE and Google identity verification tested** — 27 focused unit/controller tests cover verifier entropy and uniqueness, S256 derivation, signed-cookie tamper resistance and purpose separation, authorization URL constraints, code-exchange separation, and the real Google Auth Library path with local RSA keys: valid signature, invalid signature, expiry, exact issuer, configured audience, RS256/key id, required subject/email, `email_verified`, provider-certificate failure and callback refusal before account resolution. No live Google service or decoded fixture token stands in for verification
  - ✓ **§19.2 Pending-session data-access denial now asserted** — the whole guarded surface, **derived from the generated contract** rather than a hand-kept list, so a newly documented route is covered automatically. Suspended and rejected sessions too, with an active-token control. TD-1's two exceptions (`GET /me`, logout) are asserted **reachable**, keeping them decisions rather than holes. Mutation-tested: removing the gate fails 32 cases
  - ✓ **`/auth/refresh` CSRF posture now tested** — the custom header and Origin check were implemented but untested; 8 HTTP tests, and the check is proven to run **before** the cookie is read so a probe cannot learn whether a cookie was valid. Three mutations caught
  - ✓ §4.1b all three routing branches, pre-provisioned binding, `jti` replay → 409, email lowercasing, JWT role scopes, suspension revoking refresh, the Nginx same-origin round-trip, body-email substitution, the auth audit rows, and rejected/suspended/soft-deleted all reaching the deactivated screen
  - △ *client-side Pending route guard (no skeleton leak, §14.4)* — frontend (v0)
  - △ *high-risk endpoints re-assert Active* is green for every endpoint that exists; **presigned mint** arrives with M6

- [x] Client shell: RTL-first Arabic-only (§3.1, §6), i18n keys for every string (§16.2), §14.4 state components, §14.1 public routes only, branding assets
  - ✓ Frontend · ✓ Security — CSP unchanged (`default-src 'self'`, no font/CDN host); access token in memory only, read from the URL fragment and stripped from history (TD-12)
  - △ Later milestone (M2) — authenticated layouts, the account switcher, and the unified registration form

- [x] Branch-scoped authorization model made precise (§4.2, SRS Revision 24)
  - ✓ Backend — `policies/branch-scope.ts`; per-role resolution; `branch_id IS NULL` = all branches; Super Admin bypasses by role
  - ✓ Tests — 15 unit tests; five mutations caught, one per original defect
  - ✓ Security — fixed an all-branches Admin seeing nothing (proved 0 of 2 → 2 of 2 over HTTP) and a cross-role over-grant; `roles[]` derived from scopes so a token cannot self-contradict
  - ⚠ Supersedes OPEN AMBIGUITY 4 — user-list branch scoping should now be decided under this model

- [x] Generic educational stages + sex on the person (§4.4b, §7, §15.1, SRS Revision 27)
  - ✓ Backend — `User.sex` captured at registration inside the TD-4.1 transaction; seeded Levels carry real `gender_restriction`
  - ✓ Migration — DDL plus a data migration renaming categories in place, preserving all 21 Levels (verified before and after); seed re-run leaves 3 categories and 21 levels
  - ✓ Tests — 7 tests; four mutations caught (sex optional, sex as free string, applicant sex dropped, child sex dropped)
  - ✓ Architecture — sex never on Category; availability is which Levels exist, so opening Teen+Male is Super Admin data entry with no code change

- [x] Registration never places a beneficiary (§4.1, §4.1b, SRS Revision 29)
  - ✓ Backend — payload carries person fields and consents only; `personCore` is `.strict()` so placement fields are refused, not silently stripped
  - ✓ Tests — 2 regression tests; the strictness guard is mutation-tested
  - ✓ Architecture — reference data stays behind its own APIs under the R26 permission split; assignment is an administrative action after approval

- [~] Shared component registry: the pieces §14.3 lists that do not exist yet (§14.3, §14.2)
  - ✓ **`DataTable` built** with the first CRUD module (Branches) — columns, row actions, all §14.4 states, TD-10 pagination, wide-table scrolling. **Everything is configuration**: adding an entity means passing different columns, never editing the component. First column is a `<th scope="row">`; empty and no-results are distinct; an inapplicable row action is hidden rather than disabled
  - ✓ **Form field primitives built** — `TextField`, `TextArea`, `DateField`, `NumberField`, `SelectField`, `SearchInput`. Each owns label association (`useId`, so two instances cannot collide — the bug `Dialog` shipped with), `aria-describedby` error and hint wiring, `role="alert"`, and visible **plus** programmatic required marking
  - ✓ **`ConfirmDialog` built**, with TD-8's mandatory justification built in so the field cannot be forgotten on the screen that needs it. **Reason bounds are configurable** (approvals): TD-9 uses 10–1000 for a consent override and 1–500 for a §5.6 rejection, and the consent values stay the defaults, so hard-coding the floor would have made the client refuse what the server accepts (§1.1)
  - ✓ **`danger` added as a Button VARIANT**, not a second component (§2.5)
  - ✓ **`ApprovalCard` built** (§14.3) with the approval queue — bundle-aware, because §4.1 can create a parent, a child and a link, and §5.6 approves all three atomically (TD-4.2); a row showing only "the applicant" would hide two of the three
  - ✓ **`Badge` extracted** on its second use (§2.7) from the inline markup the Hijri screen carried. `VisibilityBadge` and `ConsentStatusBadge` become callers of it, not copies — the concept gets the component, not the entity (§2.1)
  - △ Still to come, each with its first consumer: autocomplete, file upload, checkbox, radio group, `StudentSelector`, `GroupSelector`/`LevelSelector`, `VisibilityBadge`, `ConsentStatusBadge`, `JobStatusIndicator`
  - ✓ Already built and shared: `Button` (variants), `Dialog` (+ `wide`), `Icon`, `Container`/`Section`, `Card`, the §14.4 `states.tsx` set, `BranchSelector` (calendar), `ContentPreviewDialog`
  - ⚠ Governed by [engineering-constitution §2](development/engineering-constitution.md): **one component per concept, never one per entity** — no `StudentTable`/`TeacherTable`; extract on the **second** use, never the third; never modify a copy
- [~] Back-office shell: §14.1 navigation, routing and role gating (§14.1, §14.2, TD-2)
  - ✓ **Module registry** (`lib/admin-modules.ts`) holds §14.1's hierarchy as data; the sidebar, the router and the role guard all read that one list, so a menu entry without a route, a route without a permission, or a module visible to an excluded role are impossible by construction. A test asserts the registry's paths against §14.1
  - ✓ **AdminLayout** — generated sidebar with §14.1's group order, `aria-current` on the open module, the §14.4 no-permission state for a module the session may not open, and the whole back office mounted **inside `PendingGuard`** (a sidebar is exactly the "empty skeleton layout" that guard prevents)
  - ✓ **Blocked modules render a NAMED reason**, in the page and as a sidebar badge — not "coming soon", which tells nobody whether the wait is a day or a milestone
  - ✓ **Path resolution** is longest-match and separator-aware, so a module owns its internal views (`/admin/groups/{id}/roster`) without registering each as a navigation node §14.1 does not list
  - ✓ Dashboard is a **launcher, not a statistics screen** — §5.6's counts have no endpoint, and inventing a number would be worse than omitting one
  - ✓ Tests — 15 registry tests (106 frontend total)
  - △ **6 of 11 modules ready** (dashboard, groups, users, approvals, calendar, branches, Hijri calendar); **5 blocked** on endpoints that do not exist: levels, taxonomy, content (M6), settings
  - ✓ **Superseded 2026-08-05:** schedules, settings, Hijri (M3b-24/R42), and **levels + taxonomy (M3b-29)** are now `ready`. Still blocked: users, calendar, content
  - ✓ **Module 2 — Branches (`/admin/branches`)**: list, create, edit, delete, search, TD-10 pagination. **Writing is Super Admin only** (R26) and the controls are hidden for an Admin, who reads this screen because Group management depends on it — the server enforces the matrix regardless. TD-15 optimistic locking with a named conflict message that reloads rather than overwriting; TD-5's "deletion prohibited while rooms or groups reference it" surfaced as its own reason rather than a generic failure
  - ✓ ~~**Finding — `GET /admin/branches` returns raw Prisma rows**~~ **RESOLVED by SRS Revision 38**: the endpoint now returns an explicit contract DTO and the adapter lost its wire types and its date converter. *Adapters adapt contracts to UI models; they do not repair inconsistent contracts* — the repair had left the contract wrong for the next client and hidden that it was wrong from everyone
  - ✓ **Module 3 — Approvals (`/admin/approvals`, طلبات الانضمام)**: both item types, server-side Type filter, TD-10 pagination, approve (atomic, no reason) and reject (reason required, TD-9 500). Reports `records_updated` — what actually changed, not what was requested; a 404/409 reads as *someone else decided first* and reloads. **Configuration of the framework, not a new one** — `DataTable` and the field primitives were unedited
  - ✓ ~~**§14.2 lists a "Branch" filter this queue cannot have**~~ **RESOLVED by SRS Revision 39**: the Owner corrected the specification, not the screen — §14.2 recorded the real intake and R29 had not. Registration now captures the applicant's chosen branch, the queue shows it, and the filter is built. **It filters, never scopes** — visibility stays unscoped so a branch Admin can still find and correct an applicant whose chosen branch is wrong
  - △ Remaining modules land one by one: groups, calendar/events, users

## M2 — Registration, Approvals, Family
- [x] Unified parent+child registration transaction (TD-4.1) + adult path
  - ✓ Backend — `POST /registrations`; replay guard consumed FIRST so the `jti` is authoritative; both paths in one transaction
  - ✓ Backend — **`branch_id` required and persisted as `User.intended_branch_id`** (Revision 39): validated inside the transaction against a live branch, refused for a soft-deleted one, accepted for a not-yet-opened one, written on the applicant only. Level/Room/Group still rejected outright
  - ✓ Frontend — the §5.5 form: adult **or** parent+child, **الاسم الشخصي + الاسم العائلي (R40)**, required Branch selector, consent with a Law 09-08 explanation in the shared Dialog, three-state media release for a minor. Built entirely from the shared field primitives; `/register` no longer a placeholder
  - ✓ Backend — **R40 name parts stored and `name_arabic` composed server-side**; a client-supplied `name_arabic` is rejected, not ignored (§1.1)
  - ✓ Tests — **`registration.http.integration.test.ts` added (11 tests)**. There had been NO HTTP-level test for registration, which is how a 503 reached a browser as "try again later"
  - ✓ ~~**`legal.consent_text_version` has no production mechanism**~~ **RESOLVED by SRS Revision 42**: Platform Settings (`/superadmin/settings`) now carries it — Super Admin only, validated non-empty, audited with its previous value, TD-15 locked, and affecting future registrations only. **No manual deployment step and no development seed is required in production**; the fixture remains a local convenience only
  - ✓ Frontend — **الاسم الشخصي/العائلي in Arabic AND French (R40, R41)**, both server-composed; French optional as a pair
  - ✓ UX — validation failures name the field: the server's `path` per issue is mapped onto the form's controls, and an issue the form cannot place is surfaced verbatim rather than dropped
  - ✓ Tests — 11 integration tests incl. the §18 mid-transaction atomicity check and concurrent submission of one token
  - ✓ Security — schema **rejects** `email`/`provider_subject_id` outright (§20 rule 9); replay → `STATE_CONFLICT`; fails closed with no consent text version
  - △ Frontend integration (M2) — the unified registration form
- [~] ConsentRecord model + versioned text + staff-recorded method (§4.1a)
  - ✓ Backend — `online_form` consents written in the registration transaction with the active text version from `SystemSetting`
  - ✓ Tests — a declined media release is recorded with actor + timestamp, not omitted (BR-1)
  - ✓ Backend — `staff_recorded` path complete: `GET`/`POST /students/{id}/consents`, Admin/Super Admin only (TD-2), append-only history, BR-1 effective status, §4.1a re-evaluation enqueued in-transaction
  - ✓ Tests — 20 integration tests; six mutations caught
  - ✓ B-01 — `consent.reevaluate` plus the consent-forced public → private bucket migration are durable workers; closure adds R92/deleted-schedule triggers, bounded startup convergence, one globally ordered shared-recording lock graph, exact-key retirement/recovery, retry-policy reconciliation and an exact-row public-origin gate whose external surface is limited to authorized GET/HEAD and SigV4 PUT, with bucket roots and all other S3 methods denied; the Admin override/consent-management UI remains M6
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
  - ✓ Frontend — the §5.6 queue screen with §14.2's columns (Applicant(s), Type, Bundle contents, Submitted) and both row actions; `ApprovalCard` renders the bundle. Verified live against a seeded parent+child bundle: `records_updated: 2` on approval, 409 on a second decision, `VALIDATION_FAILED` on a reason-less reject
  - ✓ §14.2's **Branch** filter built (Revision 39) — the queue carries `branch { id, name } | null` and `?branch_id=` narrows it, with `meta.total` following the filter and family-link items excluded wholesale since they carry no branch
- [x] FamilyLink lifecycle (TD-1); unique partial index enforced
  - ✓ Index — `family_link_student_parent_active_key` on (`student_id`, `parent_id`) `WHERE deleted_at IS NULL`, so a revoked link never blocks a fresh one
  - ✓ Lifecycle — pending → approved → revoked with TD-4.8 soft-delete, Trash snapshot and audit; a pending link cannot be revoked (it is decided in the approval queue); revoking twice is `NOT_FOUND` and writes exactly one audit row
  - ✓ Tests — 20 integration tests incl. the partial-index behaviour, per-child and per-parent isolation, and TD-12 freshness
- [~] `X-Active-Child-ID` middleware: (parent+child) match, Student-role self-bypass via JWT sub, 400/404 semantics, never from body/query (§4.3)
  - ✓ Backend — §4.3's ordered resolution in `middleware/child-context.ts`; returns the verified student id, not a boolean, so no caller can fall back to a body/query id
  - ✓ Tests — 15 integration tests incl. both §19.2 named regressions (Student-role bypass, foreign-parent 404); seven mutations all caught
  - ✓ Security — every no-match reason returns an indistinguishable 404; a malformed header no longer 500s (that difference was a side channel); the bypass is unreachable for a Parent-only caller
  - △ Later milestone (M3–M6) — mounting it on the child-scoped endpoints, which arrive with calendar, Quran progress, grades and content

- [x] Revoke an approved family link = soft-delete (§4.3, Revision 16); TD-2 row + `familylink.revoke` audit; middleware already 404s the next request
  - ✓ Backend — `DELETE /admin/family-links/{id}`; TD-4.8 transaction (soft-delete + Trash snapshot + audit); `Approved` stays terminal in TD-1
  - ✓ Tests — 10 service + 7 HTTP tests; asserted through the resolver (access gone on the next request), not merely that a column changed
  - ✓ Security — TD-2 admin-only with the TD-12 freshness assertion; revoking one link leaves the parent's other children and the child's other parent untouched

- [x] ChildContextSwitcher component + API-client header injection (§14.3, §16.1)
  - ✓ **The box was stale, not the work** — verified 2026-08-28. All three parts
    exist and are wired: `components/header/child-context-switcher.tsx` (rendered
    by `role-switcher.tsx`, so it has reach), `contexts/active-child.tsx`, and
    `lib/api.ts` sending `X-Active-Child-ID` per request — never in the token.
  - ✓ Tests — 3 component tests, plus the 15 middleware tests the contract
    already had. Consumed by `dashboard/student.tsx`, `dashboard/account.tsx`
    and `resources.tsx`.
- [~] GroupTeacher join + teacher-scoping resolution helpers (§4.2)
  - ✓ Backend — `policies/teacher-scope.ts`; reach resolves exclusively through `GroupTeacher`, never through a Teacher's branch assignment
  - ✓ Tests — 16 integration tests against real branches, groups and enrolments; six mutations caught
  - ✓ Security — out-of-scope is 404 not 403 (no existence leak for a minor's record); revoking an assignment, un-enrolling, or deleting the group each end reach on the next call
  - ✓ Abstraction — `taughtByTeacher()` composable predicate is the primary form; `teachesStudent`/`teacherStudentIds` are built on it (one query each). Adopted while zero production call sites existed
  - △ Later milestone (M3) — the admin UI that creates groups and assigns teachers arrives with Group CRUD
- [x] ~~StudentSocialProfile field-level restriction~~ — **FEATURE WITHDRAWN (SRS Revision 120, Owner 2026-09-02).** The entity, its table, its two endpoints, its permissions and its audit actions are removed: no product surface ever collected the data, and the Owner does not collect personal-data categories the association does not operationally need.
- [~] User Management screen per §14.2 incl. normalized-shadow-column substring search, no fuzzy (TD-10)
  - ✓ Backend — `GET /admin/users`; §14.2 columns exactly; filters read live assignments; TD-10 envelope and ar-x-icu ordering
  - ✓ Tests — 14 list/search tests + a 38-entry parity corpus proving the TS normalizer matches the SQL function byte for byte; eight mutations caught
  - ✓ Security — §4.10 fields never leave the list (asserted on the row shape); TD-2 admin-only with TD-12 freshness
  - ✓ Visibility — RESOLVED by SRS Revision 25: branch-scoped Admins see only users assigned to their branches; unassigned users are Super Admin only; the branch filter narrows within scope and cannot escape it
  - ⚠ Open for a future decision — registration records no branch, so pending registrations are unassigned and Super-Admin-visible; the §5.6 queue is deliberately unscoped and remains the branch Admin's path to applicants
  - △ Frontend integration — the §14.2 table, filters and search box
- [~] §18 Registration, Approvals & Family checklist — **backend green**, one frontend item outstanding
  - ✓ *unified atomic transaction incl. ConsumedToken* — and the **kill test is now literal**: a child process is parked inside the real transaction, past every write and before the commit, then **SIGKILL**ed. That is a different failure from an error-driven rollback, which was already covered: nothing is raised, no `finally` runs, no teardown happens — what protects the database is PostgreSQL discarding an uncommitted transaction when the connection dies
  - ✓ Proven non-vacuous **before** the kill: `pg_stat_activity.backend_xid` is asserted non-null on the parked backend, which is direct evidence the rows exist and are uncommitted. Without it, a Prisma that buffered writes until commit would make the whole test prove nothing
  - ✓ Falsifiable — letting the transaction commit before the kill makes it fail
  - ✓ *consent records versioned, both types* — parent `data_processing` + child `data_processing` + child `media_release`, all carrying the active text version; a declined media release is **recorded**, not omitted (BR-1)
  - ✓ *bundle approval atomic* — approve/reject act on parent+child together, never half; TD-15.3 double-approval first-wins and the concurrent-admin race both covered
  - ✓ *FamilyLink pending grants zero visibility* — pending and rejected links both resolve to nothing (BR-4)
  - ✓ *X-Active-Child-ID middleware* — all five specified cases plus soft-deleted link/child, malformed and empty headers, the dual-role ordering rule, and the Parent-only bypass being unreachable: **15 tests**
  - △ *child context switcher drives the header* — frontend (v0); the backend contract it consumes is complete

- [x] **Revision 35 — public branch directory** (§5.1, §7, TD-2, TD-3.9, TD-9)
  - ✓ `Branch` gains `address`, `phone`, `email`, `opening_hours_ar`, `google_maps_url`; nullable in the database (branches predating the revision need no invented address), *required* enforced at the write boundary by TD-9
  - ✓ **Opening hours are free multiline Arabic text and are never parsed** — Ramadan and exceptional weeks change them, and a structured model would make each change a schema conversation
  - ✓ No coordinates: `google_maps_url` serves the map action; lat/lng arrive only with embedded maps, since two representations of one fact means the unread one drifts
  - ✓ **Dedicated public `GET /branches`**, not a relaxed admin route — an endpoint's audience is part of its contract. Explicit `select` projection, soft-deleted excluded, `display_order` honoured, TD-10 envelope
  - ✓ Tests — 7 HTTP tests incl. *exposes nothing beyond the documented projection*; three mutations caught (soft-deleted leak, ordering ignored, a field dropped)
  - ✓ Frontend — «فروعنا ومعلومات التواصل» renders entirely from the endpoint; a branch added in the back office appears with no frontend change, and a null map URL disables the button rather than fabricating a link
  - ⓘ Seeding unchanged: §15.1 still prohibits production branch seeding; the **development fixtures** carry the two real premises

## M3 — Scheduling & Calendar
> **⚠ SUPERSEDED IN PART BY SRS REVISION 43 (2026-08-04).** The Group-driven scheduling built and signed off
> below is **retired**: `Group` becomes `AdministrativeGroup` (organisation only — no room, teacher, schedule or
> capacity), delivery moves to `RecurringCourseSchedule → Session`, and `GroupTeacher` is replaced by
> `CourseScheduleStaff`. **The ticks below stay ticked** — they record what was genuinely built and is now being
> replaced, and rewriting them would erase the history that explains why M3b exists. Everything still in force
> here is the **Event layer** (non-teaching activity, four-way scope joins, visibility tiers, branch-activation
> backfill) and the **Hijri overlay**. New work: **M3b**.

> **Carry-over from Revision 26 (recorded in the pre-M3 sweep):** Levels, Categories, Subjects, AcademicYear and
> SystemSettings are **reference/configuration data — writes are Super Admin only, reads are Admin (branch-scoped)**.
> **Applied 2026-08-05 (M3b-29):** `/admin/levels` and `/admin/taxonomy` are built and enforce exactly this — Admin
> reads, Super Admin writes, Teachers refused. SystemSettings did the same in R42; AcademicYear remains read-only.
> **Resolved by Revision 30:** Teachers are `⊘` for reading reference data. They receive branch, room, level and
> subject information only through the operational APIs they are authorised to use, never by browsing reference-data
> endpoints. The implementation already behaved this way and is unchanged.
>
> **M3 backend status (2026-07-29): complete.** Every TD-3.4 scheduling and calendar endpoint is implemented,
> documented and router-reconciled; the §18 Scheduling & Calendar checklist is green. The 16 TD-3 endpoints still
> pending all belong to **M4 (Quran), M5 (Exams/Grading) and Storage/Content** — none is scheduling work. Items below
> that remain `[~]` are held open **only** by frontend work owned by v0 (the roster screen, the month/week/agenda
> views, operational-start graying); the backend contracts they consume are finished and stable.
- [x] Group CRUD: wall-clock times, room/time conflict detection, capacity (FOR UPDATE, TD-15), co-teaching, optimistic version locking (§4.4, TD-11, TD-15)
  - ✓ Backend (service) — create/update/delete/list; half-open room/time conflict detection; TD-15 optimistic locking; TD-5 enrolment guard; R26 scoping
  - ✓ Tests — 18 integration tests; six of seven mutations caught
  - ⓘ Accepted by the Document Owner — the TD-15 lock is implemented as required and the test verifies observable behaviour; proving the mechanism itself is not MVP work
  - ✓ HTTP — `GET`/`POST /admin/groups`, `PATCH`/`DELETE /admin/groups/{id}`; wall-clock `HH:MM` at the boundary; conflict returns `STATE_CONFLICT` with structured `details` rather than a new error code
  - ✓ Co-teaching — `assignTeacher`/`unassignTeacher` with the §4.4 two-slot cap; assignment IS the §4.2 scope (asserted via `teachesStudent`)
- [~] Roster management + consent re-evaluation enqueue on every mutation (TD-4.6)
  - ✓ Backend — `max_students` under the TD-4.6 Group row lock; `CAPACITY_FULL` with structured details; TD-5 soft-delete of the enrolment row only
  - ✓ §19.2 named regression — concurrent adds at capacity − 1 admit exactly one
  - ✓ §4.1a — every roster change enqueues `consent.reevaluate` in-transaction; a refused enrolment enqueues nothing; un-enrolment names the group explicitly
  - ✓ HTTP — roster and instructor routes with `HH:MM` boundary validation and structured conflict details
  - ✓ Tests — 18 service + 12 HTTP tests; seven mutations caught
  - △ Frontend integration — the §5.6 roster screen
- [x] Event model: visibility enum, recurrence (none/daily/weekly/biweekly-alternating/yearly) (§4.4)
  - ✓ Backend — create/delete with all five recurrence types; unbounded recurrence refused; TD-5 delete removes the scope joins
  - ✓ Tests — 20 integration tests; seven mutations caught incl. a teacher privilege-escalation path
  - ✓ HTTP — `POST /events`, `DELETE /events/{id}` with `YYYY-MM-DD`/`HH:MM` boundary validation; response reports what was actually attached
  - ✓ HTTP — `PATCH /events/{id}` under TD-15 optimistic locking; **scope keys are rejected, not silently dropped** (§4.4 materialises scope at creation and backfill is the one sanctioned later attachment); edit rights are narrower than create rights
  - ⚠ For the Document Owner — an event's scope is therefore **not editable** in the MVP; a mis-scoped event is deleted and recreated. Widening this needs a decision on how a re-resolved global event avoids §4.4's silent auto-fill
- [x] Explicit four-way scope-join population at creation; operational-start filter (§4.4)
  - ✓ Backend — rows written at creation, never a runtime wildcard; only already-operational branches attached
  - ✓ Tests — asserts real rows in all four join tables and the exclusion of a future-opening branch
- [x] Branch-activation manual backfill action + endpoint (§4.4, TD-3.4)
  - ✓ Backend — list-then-attach, idempotent, branch-scoped; the gap is neither auto-filled nor ignored
  - ✓ HTTP — `GET`/`POST /admin/branches/{id}/event-backfill`; idempotence proven over HTTP
- [~] Calendar views: month/week/agenda, filters, glance view, session popup, Monday start
  - ✓ Backend — unified grid over Groups + Events; all five recurrence types; Monday-based week; branch/level/group filters; 366-day range guard
  - ✓ Tests — 20 integration tests; eight mutations caught
  - ✓ HTTP — `GET /calendar`, the one **public** route: mounted before the guarded router with optional authentication, so an anonymous visitor is served the public tier rather than a 401
  - △ Remaining — the frontend month/week/agenda views
- [x] Three-tier visibility filtering per role incl. public tier for anonymous (§4.4, TD-2)
  - ✓ Backend — resolved server-side for anonymous, Pending, Student, Parent, Teacher, Admin and Super Admin
  - ✓ Security — each SRS asymmetry pinned by test: student private unfiltered by branch (R-6), hidden unscoped for Admins, private branch-scoped, Pending = anonymous, timetable never public
- [~] Operational-start-date graying in branch-scoped views
  - ✓ Backend — nothing before a branch's `operational_start_date` is returned in a branch-scoped read
  - △ Remaining — the visual graying itself is a frontend concern
- [x] Hijri overlay: recording the Ministry's official announcements (`HijriMonthStart`) + Super Admin screen (§4.4, §5.7, Revisions 31–32)
  - ✓ SRS **Revision 31** — the official Ministry of Habous calendar is the source of truth; the global ±2-day offset is **removed** from the model, `SystemSetting`, TD-9 and every screen
  - ✓ SRS **Revision 32** — the Super Admin **records** the Ministry's announcement rather than deciding it; required vocabulary *record / publish official month / official Ministry announcement*, prohibited *choose / define / set*, applied across the SRS, the contract and the code (`setMonthStart` → `recordMonthStart`, audit `hijri.month_start.set` → `.record`)
  - ✓ Investigation (as instructed) — **no official machine-readable source exists**: the Ministry publishes each month start as a prose news announcement, with no API, feed or dataset, and because months are fixed by sighting on the evening of the 29th a year cannot be published in advance. Manual entry is therefore the primary path, not a fallback
  - ✓ Model — `HijriMonthStart` (year, month, Gregorian start, draft/published, source, version, audit/soft-delete) + TD-9 CHECK constraints; the offset constraint and its settings row are migrated away with a TD-6b contract-phase tag
  - ✓ `baseHijri()` is the single seam — every consumer reads recorded data; **nothing computes a Hijri date astronomically**
  - ✓ Endpoints — `GET /admin/hijri-calendar`, `PUT /admin/hijri-calendar/{year}/{month}` (TD-15), `POST …/{year}/publish`, `GET …/{year}/history`; Super Admin only
  - ✓ **Importer removed from the MVP (Revision 32)** — route, contract entry, provider interface, registry and tests all gone; moved to §10.1. There is no machine-readable Ministry source, so the endpoint could only ever answer *not configured*, and an endpoint that cannot succeed invites clients to build against a promise the system cannot keep
  - ✓ Extensibility kept **by data, not scaffolding** — `recordMonthStart` is the single write path a future importer would call (inheriting ordering, TD-15 locking, draft state and audit), and `HijriMonthStart.source` records provenance; no abstract provider interface ships without an implementation
  - ✓ Tests — 21 unit + 22 integration/HTTP; **twelve mutations caught**, two of which exposed real defects
  - ✓ §18 check green — the overlay reproduces the Ministry's recorded announcements, and an unpublished or unrecorded month renders nothing
  - ✓ **Public frontend — the dual calendar at `/calendar` is built** (see the item below); the Hijri side renders recorded official data only and nothing when a month is unrecorded
  - ✓ **Super Admin `/superadmin/hijri-calendar` recording screen is built** — the twelve months of a chosen year, a date input per month, TD-15 optimistic locking with a named conflict message on a stale version, publish-the-year, and two warnings a reader must not have to discover: **drafts render nowhere until published**, and **the last recorded month resolves only 29 days until its successor is recorded**. Revision 32's vocabulary is enforced in every label — *record* / *official announcement*, never *choose* / *define* / *set*. This closes the gap reported on 2026-07-30: the recurring §2.3 task is now performable through the product rather than only by API call
  - ⚠ For the Document Owner — a **recurring monthly** owner task exists (§2.3): each month must be recorded and published after the Ministry announces it, or dates in it carry no Hijri label. The task is transcription, not judgement
- [x] Public calendar page `/calendar` — the dual-calendar screen (§5.1, §4.4, TD-3.4, TD-3.10)
  - ✓ **Dual-calendar title** — Gregorian right in logo orange, Hijri left in logo green, both bold, spanning months rendered as `ذو الحجة / محرم 1448`. The client performs **no** month arithmetic and **no** Hijri computation: it renders `gregorian_months` and `hijri.months` exactly as the bootstrap assembled them (§20 rule 14)
  - ✓ **Both calendars in every day cell** — Gregorian top-right (orange, dominant), Hijri top-left (green, smaller), as a **fixed header outside the scrolling event list**, so a busy day still shows its date
  - ✓ **Category and Level filters** — options from the backend, never hardcoded (§4.4b). Selecting a Category **re-requests the bootstrap with `category_id`** so the narrowing is **server-side** per §4.4; changing Category **resets** the Level. `LevelSelector` has no category prop at all, which makes client-side filtering structurally impossible rather than merely forbidden
  - ✓ **Backend gap closed** — `GET /calendar/bootstrap` gained the optional `category_id` §4.4 already mandated but the implementation lacked; 10 HTTP integration tests, contract regenerated
  - ✓ **Layout** — the grid is the page: ~108rem inner width, cells 13.5rem (was 9.5rem), ruled hairlines instead of boxes, no shadows. The `برنامج اليوم` panel is **removed** — clicking a day opens a **wide dialog listing every activity in full**, which is what let the cells grow
  - ✓ **Events compact** — title then time on **one** line, no border, no shadow, colour-coded by kind; every occurrence renders and the area scrolls, so nothing is truncated at an arbitrary cap
  - ✓ **Event details** — description, date, time, kind, recurrence, category, level, branch, room, instructor display names, visibility. A field the backend did not send is **absent**, not blank; recurrence is omitted when `none`; an unknown enum value falls back to its raw form rather than vanishing
  - ✓ **Accessible logo colours** — the raw logo orange/green measure 2.5:1 and 1.9:1 on white and **cannot carry text**, so each exists twice: the true value for marks, a darkened same-hue variant for text (4.71:1 and 4.91:1, measured and recorded beside the tokens)
  - ✓ Defect found and fixed while building — the shared `Dialog` hardcoded `aria-labelledby="dialog-title"`; harmless with one dialog, **two elements with one id** once the calendar had two, so a screen reader would announce the wrong title. Now `useId`
  - ✓ Tests — 63 frontend (was 48), covering the spanning-month title, the omitted Hijri side, the per-cell absence, and that the level select does no filtering
- [x] Calendar navigation and visual hierarchy pass (§5.1, §14.4, §14.7)
  - ✓ **Month selector removed**, replaced by three prominent buttons — **السابق · اليوم · التالي** — centred beneath the title. `اليوم` is the primary variant (the action most often wanted, and the only one not reversible by its opposite); it returns to the current month and deliberately does **not** open the day dialog
  - ✓ **The month is named once.** The old selector carried its own copy of the Gregorian month beside the title's — two renderings of one fact; a test now asserts the nav contains no month name at all
  - ✓ **Page reads as four steps** — eyebrow → dual title (the headline) → navigation → filters → grid, each its own centred block with generous rhythm. The `<h1>` became an eyebrow so the *month* takes the visual weight
  - ✓ **Today redesigned.** The filled green disc **overwrote the Gregorian orange**, making today the one cell where the colour language broke. Now a ring in `currentcolor` plus a soft wash: the convention survives, the colour cannot drift from its numeral, and nothing is filled
  - ✓ **Cascade order fixed** — `is-today` → `:hover` → `is-selected`, all `0,2,0`, so order *is* priority. As first written, today's wash silently overrode both hover and selection
  - ✓ **Hierarchy: dates first, events second** — a hairline and padding separate the numbers row from the event list; chip washes lifted off full strength (80%→55%, 15%→10%) and chip titles dropped to 600 against the numerals' 700, so events no longer pull the eye before the dates
  - ✓ **Both numbers are first-class** — same row, same weight, opposite ends, own colours, with a real gap so two two-digit numbers never touch
  - ✓ **Accessibility regression avoided** — the deleted selector held the `aria-live` region announcing month changes; it moved to the title, and a test asserts it. The Gregorian side of the title also gained a fallback to the displayed month, so a failed chrome fetch cannot leave the page headless; **the Hijri side still has no fallback, by rule**
  - ✓ Dead `.month-selector` CSS removed with its component; no stale references remain
  - ✓ Tests — 72 frontend (was 63)
- [x] Hijri overlay made visible, and the brand colours applied (§4.4, Revisions 31–32)
  - ✓ **Diagnosed: not a code defect.** `hijri_month_start` was **empty** (0 rows), so the backend correctly returned `null` for every day and the frontend correctly rendered nothing — Revision 31 mandates silence and §20 rule 14 prohibits computing a substitute. Backend, adapter, model and components were each verified individually and all four were already correct
  - ✓ **Dev fixtures now carry the two announcements this project has on record** — 1 Dhu al-Hijja 1447 = 18 May 2026 and **1 Muharram 1448 = Wednesday 17 June 2026** (the date SRS Revision 31 itself records, contrasted with Umm al-Qura's 16 June). Both `published`, `source = manual`. Production is untouched: §15.1 seeds no Hijri data
  - ✓ **Verified live end to end** — June 2026 resolves **30/30 cells** and the title carries **both** Hijri months (ذو الحجة / محرم 1448), which is the spanning case working
  - ⚠ **Every cell of July 2026 cannot be filled without the Safar 1448 announcement**, which is real-world data nobody here has. Days 1–15 resolve (Muharram 1448's certain 29 days, 17 June – 15 July); from 16 July the overlay is silent by design. Fabricating the next month start would look authoritative and be wrong — exactly what Revisions 31–32 exist to prevent
  - ✓ **Brand colours applied exactly as instructed** — Gregorian `#f39200`, Hijri `#8dc63f`, verified in the built CSS. Contrast measured and **recorded as an accepted decision**: 2.35:1 and 2.02:1, below both the 4.5:1 and 3:1 floors. Defensible because the day cell is a `<button>` whose accessible name carries the full ISO date, so the colour is not the only channel; the residual risk is to low-vision sighted users and is accepted knowingly. The `-ink` variants remain as the correct choice for text with no alternative representation
  - ✓ **Tests — the suite asserted only the ABSENCE case.** Added the presence case (both months recorded → all 31 days resolve, both title months reported), the 29-day boundary (next month unrecorded → day 30 is `null`), and that a `draft` month renders nothing. Bootstrap suite 10 → 14; integration 483 → 487
  - ⚠ **For the Document Owner — no interface exists for recording a month.** `/superadmin/hijri-calendar` (§5.7) is unbuilt, so the only way to record an announcement today is an authenticated API call. Until that screen ships, the recurring §2.3 task cannot be performed through the product
- [x] §18 Scheduling & Calendar checklist green (incl. the Ramadan DST regression test)
  - ✓ group CRUD + half-open room/time conflict detection · co-teaching via `GroupTeacher` (two-slot cap) · all five recurrence types incl. biweekly-alternating · three visibility tiers per role · four-way scope joins written at creation · manual branch-activation backfill · the Hijri overlay from recorded official announcements
  - ✓ **§19.2 Ramadan DST regression** — a weekly 09:00 class expanded across both of Morocco's 2026 clock transitions reads 09:00–10:30 on every occurrence
  - ✓ *operational-start-date gating* — **and a weak assertion was found and fixed while signing this off**: `[].every()` is true, so the boundary check would have passed had the filter removed everything. It now proves the after-side survives and that the pre-boundary event is specifically gone; mutation-tested by ignoring the floor
  - △ The *graying* itself is frontend; the backend returns nothing before the boundary

## M3b — Educational Model (SRS Revision 43)

> **Inserted before M4 by Document Owner decision.** M4 and M5 both resolve students through the group model;
> building them against the retired `Group` would mean writing them twice. Nothing in M4+ starts until this is green.

**Schema & migrations (expand → migrate → contract, TD-6b — three deployments, never one)**
- [x] *Expand:* `AdministrativeGroup` (+ the redundant `UNIQUE (id, level_id)` the composite FK needs), `TeachingGroup`, `StudentTeachingGroup`, `Enrollment`, `RecurringCourseSchedule`, `CourseScheduleStaff`, `Session`, `SessionContent`; `Room.capacity`; `EducationalContent.subject_id` required (§7)
- [x] Hand-written SQL (TD-6a): **two** composite FKs (R43.2) — `(administrative_group_id, level_id) → AdministrativeGroup(id, level_id)` and `(teaching_group_id, subject_id, level_id) → TeachingGroup(id, subject_id, level_id)`; partial `UNIQUE (student_id, level_id)` and `UNIQUE (student_id, subject_id, level_id)`; the schedule mode/target and recurrence-shape CHECKs; time-order CHECK; `UNIQUE (schedule_id, date)`; `ar-x-icu` on both new `name` columns. R83.2 later retired the cancellation-reason CHECK and made the reason optional
  - ✓ **Proven, not assumed** — `prisma/verification/r43-constraints-proof.sql` applies the full current migration history to a scratch database from empty and attempts every live constraint boundary: **12 rejections fired on the named constraint, 6 legitimate rows accepted**, including R83's reasonless cancellation
  - ✓ **Independence between Subjects proven directly**: a ترتيل وتجويد seat for a student already holding a حفظ seat in the same Level is accepted; a second حفظ seat is refused
  - ⚠ **Historical:** the original proof caught a defect in the then-required cancellation-reason CHECK: `btrim(NULL) <> ''` evaluated to `NULL`, which a CHECK treats as satisfied. It was rewritten with an explicit `IS NOT NULL`; R83.2 later dropped that constraint when the Owner made the reason optional
- [ ] *Migrate:* backfill each existing `Group` into an `AdministrativeGroup` + one `RecurringCourseSchedule` carrying its slot; `StudentGroup` → `Enrollment`; `GroupTeacher` → `CourseScheduleStaff`; `EventGroup` → `EventAdministrativeGroup`; `Grade.group_id` → `administrative_group_id`
- [x] *Contract (separate, later migration):* the retired tables and columns dropped, tagged with the contract-phase justification
  - ✓ **No data migrated, by Document Owner decision** — no production deployment exists, and a backfill would have had to invent the Subject the old model never recorded
  - ✓ Verified on a **fresh database**: all 19 migrations apply from empty, and the four retired tables are absent
  - ✓ Migration is **idempotent** — a contract step that partially applied must be re-runnable, which this one had to be
- [x] *Migrate:* **superseded** — dev fixtures and the seed were rewritten under the new model instead of migrated (authorised)

**Domain**
- [x] Level creation **takes a required `branch_id` and** auto-creates المجموعة 1 at it, in the same transaction (TD-4.6b, §4.4b, R43.1) — the Branch is an input, **never a column on `Level`**
  - ✓ `level.service.ts`; proven by mutation — removing the first-group creation fails **31** tests
- [x] First-Branch bootstrap backfill: creating the deployment's first Branch creates المجموعة 1 for every Level that has none, atomically and idempotently (TD-4.6d, §15.1)
  - ✓ Keyed on the **condition**, not on "is this the first branch" — idempotent by construction, and correct if the first branch is later soft-deleted
  - ✓ Verified against the dev database's **21 seeded Levels**, which are the real bootstrap case; one audit row for the whole backfill
  - ⚠ **`createBranch` is no longer a single-row operation.** The existing branch suite's teardown could not delete its own branches afterwards — fixed there, and recorded because any future caller inherits the same side effect
- [x] Roster resolution — one implementation serving all three teaching modes (§4.4c); **Entire Level is branch-bound**
  - ✓ 17 integration tests; both claims mutation-proven (drop the branch bound → 2 fail; resolve a split to the administrative roster → 4 fail)
- [x] **Teacher scope from `CourseScheduleStaff` — COMPLETE.** Verified 2026-09-04:
      `teacher-scope.ts` no longer exists and `GroupTeacher` survives only in two
      historical schema comments; every staff-scope question composes
      `studentsTaughtBy` in `roster-resolution.ts`, which is the single §4.4c
      definition. R91 later added the occurrence arm and R123/R124 both compose it.
  - ✓ Backend — `studentsTaughtBy`, `teacherBranchIds`, `staffsSession` in `roster-resolution.ts`; branch scope now **stated** by the schedule instead of inferred through two hops
  - ✓ Tests — assistants have identical reach; a teacher with no schedules reaches nobody; revoking a staffing ends reach on the next call
  - ✓ **Consumers migrated** — `calendar`, `event` and `consent` services all resolve through `roster-resolution.ts`; **no production code reads `GroupTeacher`**
  - ✓ Event scoping moved with it (`EventAdministrativeGroup`), because the two id spaces could never have intersected
  - ✓ `consent.service` now emits `{ session_id }`, so both producers agree before M6 writes the handler
  - ✓ `test-support/educational-fixture.ts` — one fixture for the four suites that each need "a group, a student in it, and a teacher who reaches them"
- [x] Teaching Groups + membership, and the **`unassigned` list** (BR-22)
  - ✓ R43.3 authority split: CRUD is Super Admin, membership is Admin scoped by the **student's** enrolment branch
  - ✓ `unassigned` returns `split: false` for an unsplit Subject — deliberately distinguishable from "everyone is assigned"
  - ✓ Proven by mutation: making uniqueness per-Level instead of per-(Subject, Level) breaks independence between subjects
- [x] Enrolment service — enrol · un-enrol · **move within a Level as one action** (§5.6) · roster · `levelsForStudent`
  - ✓ `level_id` read from the group, never the caller; no capacity check anywhere (BR-23)
  - ✓ Gender restriction enforced, with a **null `sex` not eligible** rather than a wildcard (R27)
  - ✓ Consent enqueue emits `{ session_id }`; the live worker resolves the current R43/R92 Session audience and safely drains historical queue-only work
- [x] Course schedule CRUD with conflict detection **against materialized Sessions** — room, teacher **and assistant** — under the TD-4.6c row lock; `SCHEDULE_CONFLICT`
  - ✓ Touching boundaries are **not** a conflict, so back-to-back classes stay legal; a **cancelled** session frees its room while keeping the row
  - ✓ Branch agreement enforced for group targets and rooms; BR-23 confirmed — a capacity of 1 refuses nothing
  - ✓ Proven by mutation: making the check ignore dates (rule-comparison behaviour) fails the alternating-week tests
- [x] `session.materialize` (TD-7): idempotent per `(schedule_id, date)`, academic-year horizon, nightly cron; **never rewrites an overridden session or one carrying work** (§20 rule 24)
  - ✓ Materializes **inside** the schedule-write transaction, so the calendar is never briefly empty
  - ✓ **Snapshots room + staff onto each occurrence (R43.4)**; re-syncs **future, un-overridden** sessions only, so a held class keeps the people who actually taught it
  - ✓ **`policies/session-protection.ts` is the single authority** (R43.6) — a *semantic* rule, not a feature list: protected whenever the session holds data whose loss would change historical truth
  - ✓ Modules **contribute** rules (`registerSessionProtectionRule`) knowing nothing about scheduling; built-ins are unconditional, evaluation is bulk, rules may only *add* protection
  - ✓ Materialization, schedule edit, schedule delete and regeneration all ask that one function; work-carrying sessions are protected **whatever their date**
  - ✓ `regenerateSessions([ids])` is the explicit, Admin-only, audited path — sessions must be **named**, there is no blanket option, and regeneration never discards attached work
  - ✓ Reports what it left alone and why; proven by mutation — removing the protection fails 3 tests
  - ✓ **Recurrence expansion extracted to `lib/recurrence.ts`** and shared with `Event` rather than duplicated (§4.4); 25 unit tests incl. the alternating-week parity
- [x] Session lifecycle (TD-1) + override/cancel/restore + `SessionContent` linking
  - ✓ Transition table written verbatim; anything absent is `STATE_CONFLICT`. A reschedule is a **field edit**, not a transition
  - ✓ Cancellation demands a reason and records the **audience size at that moment**; restore refused after the date
  - ✓ Content is **referenced, never owned** — unlinking leaves the file untouched, and one item may be referenced by many sessions
- [ ] Approval assigns Levels and one Administrative Group each, in the approval transaction (TD-4.2, §4.1)
- [ ] حفظ القرآن and تفسير القرآن as schedulable atomic Subjects **with the BR-9 carve-out** — their `LevelSubject` rows generate no generic grading components because both follow the LevelSurah selection; only حفظ is progress-tracked (§4.4b, R107); the postponed grading-template engine remains unbuilt
- [x] Consent gate re-subjected to the session's resolved audience; `consent.reevaluate` payload `{ session_id }` (BR-2, TD-7)
- [ ] Retire `CAPACITY_FULL` and the roster row-lock; `Room.capacity` informational (BR-23, TD-15.2)

**API & screens**

> The contract phase removed the nine `/admin/groups` routes and added none back, so
> every service below was built, tested and **unreachable over HTTP**. TD-3.12 is
> being mounted one resource at a time, each complete — controller, DTOs, routes,
> OpenAPI, HTTP suite — before the next begins.

- [x] TD-3.12 **Administrative Groups** — `GET`/`POST /admin/administrative-groups`, `PATCH`/`DELETE /admin/administrative-groups/{id}`
  - ✓ Explicit DTO: exactly `id`, `name`, `level_id`, `branch_id`, `display_order`, `version`; 18 HTTP tests asserting the **exact key set**, not field presence
  - ✓ The write boundary **refuses** `max_students`, `room_id`, `teacher_id` and a weekly slot rather than dropping them (§20 rule 22, BR-23) — a `201` after sending a capacity would claim a limit was recorded
  - ✓ `level_id`/`branch_id` rejected on `PATCH`: moving a group between Levels or Branches is a re-creation, not an edit
  - ✓ Proven by mutation — dropping `.strict()` fails 2 tests; leaking `created_at` through the DTO fails the **build** (TS2353), which is the stronger guard
  - ✓ TD-9/TD-15 primitives extracted to `validators/common.ts` and the Zod-failure boundary to `controllers/parse.ts`, rather than copied a second time
- [x] TD-3.12 Administrative Group **roster** — `GET`/`POST /admin/administrative-groups/{id}/roster`, `DELETE .../roster/{studentId}`
  - ✓ `level_id` is **not accepted** on enrolment — read from the group, so the composite FK stays a backstop rather than the only thing between a typo and a mis-filed student
  - ✓ BR-21 refused with an explanation, not a raw constraint error: same group is `DUPLICATE`, another group of the same Level is `ALREADY_ENROLLED_IN_LEVEL` **naming the group that holds them**
  - ✓ `id` on a roster entry is the **enrolment** id, not the student's; un-enrolment leaves the tombstoned row and the academic record intact (TD-5)
  - ✓ No capacity check anywhere (BR-23); 6 HTTP tests, 24 in the file
- [x] TD-3.12 **Teaching Groups** (incl. `unassigned[]`, BR-22) and their membership verbs
  - ✓ Addressed by `(Level, Subject)` because that pair **is** the split; both refused in a body and on `PATCH`, so a cohort can never be silently re-filed under another curriculum item
  - ✓ `GET` returns `{groups, split, unassigned}` in one read — the unassigned list is unreadable without the groups beside it — and is **unpaginated**, since a page boundary through an alarm hides half of it
  - ✓ `split` kept distinct from `groups.length`: *the question does not apply* must not render like *everyone is placed*
  - ✓ `DELETE` answers `200 {released_students}`, not `204` — BR-22 forbids a silent release, and the count exists only at that moment
  - ✓ R43.3 authority split proven over HTTP: group CRUD `403` for a branch Admin, membership `201` for their own student, `404` (never `403`) for a student enrolled elsewhere
  - ✓ 21 HTTP tests; `pending-denial` rose 44 → 50 on its own from the generated document
- [x] TD-3.12 **Course Schedules** (incl. `/conflicts` and `/roster`) — 6 operations
  - ✓ `teaching_mode` + `target_id` on the wire, never three nullable columns — one field cannot be ambiguous
  - ✓ TD-11 wall-clock `HH:MM` in and out; an ISO instant is **refused**, since a class starts at 15:00 at its branch
  - ✓ Writes return `{ schedule, materialization }` **nested, not flattened**, so a list row and a write response share one shape
  - ✓ `protected_sessions` and `retained` report what was deliberately *not* touched (§4.4, R43.6)
  - ✓ Subject, target, branch and academic year rejected on `PATCH` — each would re-point already-materialized history
  - ✓ **Two service functions did not exist** and were written here: `listCourseSchedules` and `resolveScheduleRoster`
  - ✓ 17 HTTP tests; full sweep 648 passing across 36 files
- [x] **Fixed the `auth-refresh` integration flake** — it was `429 RATE_LIMITED`, not data interference: `limit_req_zone` keys on the client IP and the whole suite arrives from one host. Dev overlay replaces the zone *rates* only; every `limit_req` directive and burst stays as production has it ([why](development/testing.md#the-auth-refresh-flake-and-what-it-actually-was)). Verified by three consecutive clean sweeps
- [x] TD-3.12 **Sessions** (override / cancel / restore / content) — 5 operations
  - ✓ `status` **refused** on `PATCH` — a transition carries a mandatory reason and an audience count recorded while still answerable; a field assignment carries neither
  - ✓ `overridden` set by **any** override, including a no-op one: the flag records that a human decided, which is what survives the next schedule edit (R43.4)
  - ✓ `staff` supplied replaces the snapshot, omitted leaves it — an empty array is a real instruction, not an omission
  - ✓ Restore refused after the date (`SESSION_IN_PAST`) — a past class cannot be asserted back onto the timetable
  - ✓ Unlinking content **never deletes the file**; the link row tombstones (TD-5)
  - ✓ Not under `/admin/`: TD-2 gives a Teacher their own staffed sessions, so the prefix would misdescribe the audience; a teacher who staffs nothing gets `404`, never `403`
  - ✓ 14 HTTP tests, green first run; full sweep 667 passing across 37 files
  - ✓ **TD-3.12 is complete** — 64/81 TD-3 endpoints implemented, 0 undocumented
  - Split from Course Schedules deliberately: ten operations in one slice does not fit a fresh context budget, and splitting at the resource boundary is cheaper than compacting halfway through ([why](development/engineering-efficiency.md#capacity-not-only-value))
- [x] TD-3.13 **public library** — `GET /library`
  - ✓ Public and anonymous; **never answers `401`** (an invalid credential is ignored), mounted before the guarded router like `/calendar`
  - ✓ Signing in **reorders, never unlocks**: own branch → Global → other branches (§5.2). `branch_id IS NULL` is *Global*, not *unknown*, so it sorts second
  - ✓ §4.9's three tiers filter every result set — reconciled with TD-3.13's "nothing hidden" via §5.2's *identical filters never means identical results*
  - ✓ Parents of enrolled students get the private tier **without** `X-Active-Child-ID` — the library is one shared reading surface
  - ✓ BR-2 enforced by explicit exclusion, not by trusting the re-evaluation engine to have moved `visibility`
  - ✓ DTO omits `storage_key`/`storage_bucket`/`original_filename`/`consent_forced_private`
  - ✓ 16 HTTP tests; `pending-denial` grew to 62 and gained a positive exemption assertion
- [x] `/calendar` **filter set + `prefilled_filters`** (TD-3.4, R43)
  - ✓ Full set accepted: `academic_year_id`, `subject_id`, `teacher_id` added; **`group_id` corrected to `administrative_group_id`** — the name TD-3.4 spells out, and the schema refused the documented one (same defect class as M3b-14b)
  - ✓ **A filter no Event can satisfy narrows the grid to Sessions** rather than being ignored — ignoring it would return Events that do not match the request
  - ✓ `teacher_id` matches the **session's own staffing snapshot**, not the schedule's (R43.4)
  - ✓ Sessions gained `subject_id`, `subject_name`, `teaching_mode`, `audience_label`, `status`; `audience_label` stops impersonating `description`
  - ✓ `prefilled_filters` is `null` for anonymous **and** Pending; a value is prefilled **only when unambiguous** — plural yields `null`, never *first*
  - ✓ Proven not to change the result set: a signed-in member with no enrolments sees exactly what an anonymous visitor sees
- [x] `/calendar/sessions/{id}` — the §5.2 Session page
  - ✓ The `occurrence` is **byte-identical to the grid's** — one `include` and one mapper, extracted so the two cannot drift; asserted field for field
  - ✓ `recordings` and `linked_content` are **disjoint**, split on the file being audio (§4.9: video is excluded entirely), so no second column has to be kept true
  - ✓ Both lists reuse **the library's §4.9 tier predicate itself**, exported rather than restated — one rule, one rendering
  - ✓ Public at the caller's tier: anonymous sees the public recording, never the private one; a teacher also sees hidden
  - ✓ **`notes` ships `null`** — TD-3.4 names it but §7 defines no storage; a §7 schema decision, deferred, and visible rather than silent
  - ✓ Registered in `scripts/ci/td3-routes.txt`, which caught its absence (66/82 TD-3, 0 undocumented)
  - ✓ 9 HTTP tests green first run; `pending-denial` grew to 63 with a positive exemption assertion
- [x] `/admin/schedules` — Course Schedules screen (read · conflicts · resolved roster · delete)
  - ✓ **The §14.1 node was missing from the module registry entirely** — and from the test pinning that registry, so the two agreed with each other while neither agreed with the sitemap
  - ✓ Conflicts panel states it compares **materialized Sessions, not recurrence rules**; roster panel states it is **resolved now, not stored** — "no conflicts" from a rule comparison is a different assurance
  - ✓ Delete surfaces `retained` — Sessions holding real work outlive the schedule, and the count is unavailable afterwards
  - ✓ `timeLabel` exported and tested: TD-11 wall-clock rendered verbatim, never parsed through `Date`
  - ✓ Client-side contract guard mirroring the server's key set, so an adapter rename is a typecheck failure rather than a blank page
  - ✓ Write form deliberately deferred to its own slice — half a form would claim a capability the module lacks
- [ ] `/admin/schedules` **write form** (subject · mode + single target · room · staff · times · recurrence, with conflict reporting on save)
- [x] **Portal separation** — `TEACHER_MODULES` beside `ADMIN_MODULES`, shared mechanics extracted
  - ✓ `lib/portal-modules.ts` owns the *behaviour* (status vocabulary, role gating, longest-match path resolution); each portal owns its *list*
  - ✓ `components/portal/` owns the shared shell and nav rendering; `AdminLayout` and `TeacherLayout` differ only in their sidebar, which is the part that genuinely differs
  - ✓ **`section` deliberately stayed admin-only** — §14.1 groups the back office and gives the teacher portal no equivalent; hoisting it would make the shared layer the first caller's shape
  - ✓ A test asserts the registries **share no path**, so resolution cannot depend on which registry a caller asked
- [x] `/teacher/schedules` **screen** — consumes the **same** `GET /admin/course-schedules`, role-scoped
  - ✓ Document Owner decision: `/admin/` is a **routing namespace, not an authorization boundary**; one endpoint with role-scoped data beats two returning an identical representation
  - ✓ Super Admin all · branch Admin their branches · **Teacher the schedules they staff** (`CourseScheduleStaff`, §4.4c) · everyone else `403`
  - ✓ **Reading is not managing:** create/edit/delete/`conflicts` stay Admin (§14.1 — teachers do not create or edit schedules)
  - ✓ A teacher staffing nothing gets an **empty list, not `403`**; an explicit filter narrows but never widens
  - ✓ `/roster` follows the same rule (§5.6 line 753); a schedule they do not staff is `404`, never `403`
  - ✓ Screen shares the adapter and both cell renderers with `/admin/schedules` — no create/edit/delete controls
  - ✓ **SRS wording proposed, not written:** `docs/SRS-PROPOSAL-R45.md`
- [x] `/admin/groups` (+ roster) — Administrative Groups screen
  - ✓ Level and Branch chosen at creation and **disabled on edit**, matching what the server accepts rather than offering fields it refuses
  - ✓ Each of the three delete refusals names its own cause (`ENROLMENTS_EXIST` · `SCHEDULES_EXIST` · `LAST_GROUP_IN_LEVEL`) instead of a generic failure
  - ✓ BR-21 surfaced as *already in another group of this Level*, which is the information needed to decide on a move
  - ✓ Roster uses `GET /admin/users` for the picker; the enrolment id is kept distinct from the student id, asserted in a test
  - ✓ Level list read from the **public calendar bootstrap** — no `/admin/levels` exists and inventing one would be a new public contract
- [x] **Reference-data selectors** — `GET /admin/subjects`, `GET /admin/academic-years` (TD-3 extension, Owner-authorised)
  - Canonical source for every admin selector needing either; widening `/calendar/bootstrap` and a screen-specific payload both rejected, with reasons recorded
  - Unpaginated (a selector offering a subset misrepresents the choice) and carrying no `version` (no write exists)
  - Admin+ read (TD-2 R26); Teacher refused (R30) — asserted
  - 8 HTTP tests; SRS wording drafted in `SRS-PROPOSAL-R46.md`
- [x] `/admin/schedules` **write form** — create and edit
  - Edit disables Subject, mode, target, branch and year — the server rejects them, so the form does not offer them
  - The target picker follows the mode (one target of the kind the mode names); `teaching_group` withheld until Subject Organisation can supply its target
  - Times are plain text, not a native time control — TD-11 wall-clock travels as `HH:MM`
  - Every save opens a materialization report, so `protected_sessions` is seen rather than swallowed
  - `SCHEDULE_CONFLICT` gets its own message: the remedy is to free a named room or person
- [x] `/admin/levels/{id}/subjects/{subjectId}` — Subject Organisation (Teaching Groups)
  - Routed by pattern, not a registry entry: the path carries ids, so no menu can link to it — it is an internal view of the Levels module, reached by drilling in from a group
  - `split: false` is its own state, never rendered as *everyone is placed* — a Subject with no groups is taught to the whole Level, so the question does not apply
  - The unassigned list leads the page and is unpaginated: BR-22 says a student with no group has **no sessions in that subject**, and a page boundary through an alarm hides half of it
  - Each refusal names its cause: `ALREADY_IN_SUBJECT_SPLIT`, `NOT_ENROLLED_IN_LEVEL`, `SUBJECT_NOT_IN_LEVEL`, `SCHEDULES_EXIST`
  - Deletion reports how many students returned to *unassigned* — the count exists only at that moment
  - R43.3 authority split honoured: group CRUD Super Admin, placement Admin
- [x] **Session page frontend** — `/calendar/sessions/{id}` (§5.2)
  - Public at the caller's tier; **no client-side filtering** — a client that filters is a second implementation of a permission rule
  - A cancelled session is **shown and announced**, not hidden or merely coloured (§14.4)
  - Recordings and materials stay separate lists, because a recording is what BR-2's consent gate acts on
  - An empty list renders **nothing**, not an empty heading: on a public page *there are none* and *there are some you may not see* must not look alike
  - Items link **into the Library** (§5.2 — one reader, one permission path), never to a download
  - **Fixed live drift found here:** the calendar adapter still declared `kind: 'group'`, so every session had been rendering as an Event since Revision 43
- [x] **Public Calendar frontend** — consumes `prefilled_filters` (TD-3.4, R43)
  - Applied **once per visit, not once per fetch**, and only to filters the reader has not set — re-applying would drag a filter back the moment someone cleared it, which is the opposite of *freely changeable*
  - A suggestion, never a scope: the server does not narrow by it and neither does the client
  - `null` for anonymous and Pending is distinct from an object of nulls, and the page uses that to decide whether to prefill at all
- [x] **Level ↔ Subject assignment** — `GET`/`PUT`/`DELETE /admin/levels/{levelId}/subjects[/{subjectId}]`
  - **Root cause of the "إضافة فوج" failure, found by measurement:** the database held **zero `LevelSubject` rows and no write path existed**, so every teaching-group creation answered `SUBJECT_NOT_IN_LEVEL`
  - Super Admin writes (curriculum structure, R26/R43.3); Admin+ reads
  - `PUT` revives a removed assignment rather than duplicating it — one row, so *is this Subject taught here* has one answer
  - Removal refused while Teaching Groups exist: members would otherwise hold seats in a subject the Level does not offer
  - 5 new HTTP tests including the end-to-end assertion that a teaching group can now be created
- [x] **Curriculum taxonomy CRUD** — Categories, Subjects and Levels (§5.6, §14.1; drafted as `SRS-PROPOSAL-R47.md`)
  - **The audit came first and most of it said *reuse*:** Branches & Rooms, Subject Organisation and the Level↔Subject assignment all had complete backends and needed frontend only. `createLevel` already implemented TD-4.6b **with no route to reach it**
  - `GET /admin/subjects` gained `version` so the editor could reuse the selector — **one list, not two reads of one table**; this narrows R46's wording, whose premise was that the endpoint had no write
  - **Deleting a Level cascades its Administrative Groups** — the inverse of TD-4.6b, and a rule the SRS did not have: every Level owns at least one group by construction, so a guard counting them would make deletion unreachable. The audit row names the cascaded ids
  - A Category **never** cascades its Levels — those carry people's records
  - `PATCH /admin/levels/{id}` **refuses** `category_id` (the one `.strict()` schema here): dropping it silently would let a client believe a move succeeded
  - `/admin/levels`, `/admin/taxonomy` and the new `/admin/levels/{id}/subjects` screen are live; the contract-derived Pending-denial suite grew by 11, one per operation
- [x] **Room CRUD frontend** — zero new backend: all eight Branch/Room routes already existed
  - A dialog behind each branch row, not a sibling list: §14.1 names one node, and a room has no meaning apart from its branch
  - Offered to an Admin as well as a Super Admin — an Admin reads this screen because scheduling depends on knowing which rooms exist
- [x] **User management backend** — `PATCH /admin/users/{id}`, `POST .../suspend`, `POST .../reactivate`, `PUT .../roles` (drafted as `SRS-PROPOSAL-R48.md`)
  - **Suspension is a verb, not a field**: TD-4.15 binds it to revoking every live session in the same transaction, so `account_status` is refused on the edit rather than dropped
  - `PUT .../roles` replaces the whole set — one call, one decision, one audit row, and no window where a user holds half a change
  - **`super_admin` is grantable here** (R22: administrator changes happen exclusively through the application), guarded by `LAST_SUPER_ADMIN` and `SELF_SUSPENSION`
  - A role change deliberately does **not** revoke sessions — R10 accepts the window, and §7's `RefreshRevokedReason` has no value that honestly describes a demotion
  - `check-display-identity.sh`'s exception is now **symbol-scoped rather than file-scoped**, proven by reintroducing the bug
- [x] **`/admin/users` screen** — search, filter, create, edit, roles, suspend, reactivate. **Zero backend change**
  - Suspension is a separate control from edit, mirroring the API: it ends every live session (TD-4.15), so it asks for a reason and says so
  - Roles edited as a **set**, matching the `PUT` — one decision, no window where a person holds half a change
  - TD-10's two-character floor applied before the request; every filter change resets to page 1
  - Each `409` reason gets its own sentence — the remedies differ completely
  - **P1 found while probing the running stack:** the `LAST_SUPER_ADMIN` test had revoked real seeded `super_admin` assignments and left the dev database with **none**, all tests green. Fixed three ways (borrow `account_status` not the grant · restore in `finally` · `afterAll` asserts the platform is still administrable) and recorded in `development/testing.md`
- [x] **Staff registration workflow** — audited first; **no endpoint added** (drafted as `SRS-PROPOSAL-R49.md`)
  - Admins/Super Admins creating staff was **already complete** via `POST /admin/users` pre-provisioning (§4.1's first-class staff path)
  - The only missing datum was **what the applicant asked to be**, so the queue could not tell a teacher applicant from a family registration
  - `requested_role` accepts only `teacher`, enforced by Zod **and** a database CHECK — widening it is a revision, not a code change
  - **Branch scope is never collected at registration:** a role's scope is an authorization boundary (TD-2), and collecting it would let an applicant propose the extent of their own permissions
  - Role + scope granted **in the approval transaction**, through the same `applyRoleAssignments` the Users screen uses — approval cannot become a weaker path to authority
- [x] **§4.1 (R43): approval assigns Levels, Groups and writes the Enrollments** — the gap found in the R49 audit
  - Built by extracting `enrolInGroup` from `enrolStudent`, so approval places students by the **same rules the roster screen uses** — branch scope, §4.4b sex restriction, BR-21, consent re-evaluation
  - **An approval that would leave a student unplaced is refused** (`ENROLLMENT_REQUIRED`, naming who). Who must be placed is derived from the bundle; a staff request enrols nobody
  - Only people in the bundle may be named (`NOT_IN_BUNDLE`), or approval would be an unscoped enrolment endpoint
  - ✓ **Deviation closed (Owner decision, 2026-08-05):** registration now records `intended_category_id`, so §4.1 step 1's preselection works — the Level list filters to the stated Category and its first Level is preselected, with *any Category* one click away
  - Category dropdown is the **live Categories ordered by `display_order`**, read from the public `/calendar/bootstrap` — no new endpoint, no hardcoded list
  - Required for a student, **refused for a staff request** (a teacher is admitted to no Level)
  - **Deleting a Category is refused while pending requests reference it**; decided ones never block, and the soft delete keeps them readable
- [x] **Public Educational Library frontend** — the mock adapter replaced by `GET /library`
  - The mock's promise held: **only its two exported functions changed** — no component, page or test touched it
  - `GET /library` now resolves the §5.2 headings (`category_name`, `level_name`, `subject_name`, `academic_year_label`, `branch_name`) because **no public endpoint publishes Subject or Academic Year names**; self-sufficient, as TD-3.4 already requires of the calendar
  - **No per-level counts** (no aggregate exists — a count from page one would be a claim) and **no teacher attribution** (`EducationalContent` records no uploader; deferred Owner decision)
  - `kind` derived client-side from the MIME type: §14.6 is a *presentation* rule, and presentation is the client's job
  - Note: the public calendar's *screen* filters (branch · category · level) stay identical for everyone and are compliant. Adding TD-3.4's `subject_id`/`teacher_id`/`academic_year_id` to a **public** screen would need public reference lists that do not exist — `/admin/subjects` is Admin-only by design

### R91 — effective-dated teaching staffing (2026-08-19)
- [x] **SRS Revision 91** + migration `20260819230000_r91_effective_staffing`. `effective_from`/`effective_until`, inclusive calendar dates, `NULL` open-ended
- [x] **No backfill, nothing fabricated** — a pre-R91 row's two NULLs already meant *the schedule's whole life*. Proved by **1349 existing integration tests passing unchanged** on the migrated schema
- [x] `@@unique(schedule_id, user_id)` **withdrawn** — it refuses the case R91 exists for. Replaced by two interval invariants under a `FOR UPDATE` lock; `btree_gist` declined per §28
- [x] **One shared resolver** `policies/effective-staffing.ts` — `effectiveOn` · `effectiveWithin` · `staffForScheduleOn` · `effectiveSchedulesForTeacher`. No second date predicate anywhere
- [x] **History is never rewritten**: materialization snapshots per occurrence date; resync reaches only future un-overridden ones; `SessionStaff` overrides the schedule always
- [x] Every consumer time-aware, **each one's date documented** in the new [teaching-authority](development/teaching-authority.md) page
- [x] **Defect closed:** `studentsTaughtBy` gained an occurrence arm — R87 §J opened «إدخال الحفظ» for a cover while the resolver handed her an empty roster (rule P inverted)
- [x] UI: `StaffingPeriods` for a class · «مؤطّرة هذه الحصة» for a one-off cover · three refusals each in Arabic. New rule **AS**
- [x] R90's conflict query now needs **both** halves — the limitation R90 recorded is closed
- [x] 222 backend unit · 1373 integration · 613 frontend · 13/13 new browser checks · 18 CI guards · OpenAPI current
- [x] **`verify-staff-picker` closed 2026-08-20 — 13/13.** Harness defect (`===` against the shared add-Button's `＋` prefix) on top of R91's intentional control change. Fixing it exposed a **real regression**: the periods editor rendered bare names, dropping R90's *marked before the choice* half. `markedLabel`/`Warnings` now shared and guarded
- [x] **All 20 harnesses green in one pass — 460 checks** (plus `measure-page-header`'s 9 widths)
### Teacher scheduling merge + responsible=self (2026-08-20)
- [x] **One node «الجدولة»** — the shared `PersonalCalendar` plus her classes table; `/teacher/calendar` still renders it so links survive
- [x] **Responsible = self, enforced server-side** (`RESPONSIBLE_MUST_BE_SELF`); she may now set assistants on the event she answers for, and only that one
- [x] **`GET /me/event-staff-options`** — the narrow read that makes it reachable; `/admin/users` still refuses her (rule O)
- [x] Four guards restated with their reasons: registry list · R84 filter matrix source · two portal checks
- [x] 643 frontend · 222 backend unit · 1403 integration · TD-3 + OpenAPI current
- [x] **The activity SAVE is proven — `verify-teacher-scheduling` 6/6** (2026-08-20). Three causes, all captured from the wire: an unset scope submitted as an empty id · her scope selector fed by `/admin/levels` (403 for her) · the assistants control disabled for her. Plus a platform-wide defect: the shared `Button` had no `type`, so every one inside a form submitted it
- [x] **R93 — assistant-assignment notification** (2026-08-20): `event_staff_assigned`, automatic, newly-assigned only, re-assignment resurfaces, actor excluded. Proven in the assistant's own bell (9/9)
### R94 — the مؤطرة's scheduling types (2026-08-20)
- [x] `＋ إضافة عنصر` offers **نشاط + امتحان**; `حصة` stays Admin-only, and the reason is §4.4c self-escalation rather than caution
- [x] Her exam's scope comes from **«الحصة المعنية»** — one of her own classes — because the curriculum chain answers 403 for her. No new endpoint
- [x] She supervises the sitting she organises, locked to one name; the server refuses anything else
- [x] `verify-teacher-scheduling` **12/12** · 643 frontend · 222 backend unit · 1412 integration
### Shared occurrence details + direct content (2026-08-20)
- [x] **The dialog was never duplicated — it was never opened.** Three of four calendars discarded the click; all four now open the shared component. New rule **AT**
- [x] **التسجيلات** and **المواد المرفقة** are separate sections with separate empty states, and neither claims anything before a 200
- [x] «فتح صفحة الحصة وموادها» removed from the dialog; the combined sentence deleted from the catalogue
- [x] `verify-occurrence-details` **13/13** across public/Admin/مؤطرة/beneficiary · 655 frontend
### Section C — Quran progress entry (2026-08-20)
- [x] **إدخال الحفظ in the back office** — `/admin/quran`, the same workspace the teaching portal renders. Rule P, seventh instance
- [x] **مراجعة no longer inflates memorisation** — the canonical engine, not the UI. ⚠ needs an SRS revision to become normative wording
- [x] **R92's Quran occurrence arm actually connected** — it was named in a docstring and never wired
- [x] `LevelSurah` normative for entry; `level_id` validated and audited, deliberately not stored
- [x] Shared `ProgressBar`; حفظي shows the whole syllabus, grouped by Level
- [x] **Backend CI typecheck was red on `develop`** — 12 pre-existing errors fixed
- [x] 26 new integration cases · 16 frontend guards + 1 CI shell guard (the CSS invariant cannot live in vitest) · `verify-quran-entry` **24/24** · 19 CI guards · 25 browser harnesses / 556 checks
- [x] **SRS Revision 95** ratifies the memorisation-vs-revision semantics — `new_memorization` alone feeds coverage, `revision` is recorded and never inflates it, BR-13's merge and BR-11 unchanged in substance
### R99 — an online class MAY be recorded (2026-08-21) — SRS gate only

- [x] **BR-2 checked against the Owner's STOP condition** — it governs ACCESS, not capture (`SRS.md:813-818`, `:1079`), so **no** per-participant consent workflow
- [x] **§4.9's "Video remains excluded entirely" qualified IN PLACE**, not rewritten — still in force for uploads; R99 admits a **provenance**, not a file type
- [x] **TD-9 +1 row**, reachable only by the ingestion pipeline: `video/mp4`, 500 MB, same magic-byte + delete-on-mismatch verification. `/uploads/*` still refuses `video/*`
- [x] **`EducationalContent.origin`** (`uploaded` | `session_recording`) specified — reusable semantic field, **no separate recording table**
- [x] **Backfill rule specified**: audio + live `SessionContent` link → `session_recording`; everything else `uploaded` — reproduces today's screens exactly
- [x] Recording is **optional and explicit**; `دخول الحصة` never records; `جاري التسجيل` visible to every participant including latecomers
- [x] Provider output is temporary; **a provider URL is never the content asset**
- [x] **C1 — COMPLETE (2026-08-21)**
  - [x] Migration `20260821090000_r99_recording`; backfill verified **12 uploaded + 1 session_recording**
  - [x] `SessionRecording` lifecycle entity + written-out state machine; **partial unique index** = one live recording per occurrence
  - [x] **Redis + real LiveKit Egress** in the dev overlay; LiveKit moved to a config file for Redis + webhooks
  - [x] Optional and explicit — **a class ran with three people and nobody recorded it: no row, no job, no file**
  - [x] مؤطِّرة/assistant parity; administrator in scope; **beneficiary 403 but still sees «جاري التسجيل»**
  - [x] **Server-side capture proven**: the harness closes the starter's tab and the recording keeps running
  - [x] **Real media both ways**: صوت وصورة → 5.6 MiB MP4 · صوت فقط → 141 KiB OGG, verified by extension and byte count
  - [x] Signature-verified callback over the raw body; idempotent against duplicate and out-of-order delivery
  - [x] Defects: browser-vs-server provider URL · simultaneous start · orphaned egress · a failure path that could itself fail · missing `starting → stopping`
  - [x] 23 backend lifecycle · 17 HTTP wire · 30 frontend · `verify-livekit-join` **61/61**
- [x] **C2 — COMPLETE (2026-08-21)** — ingestion, storage import, `EducationalContent` + `SessionContent`, «التسجيلات» rendering, beneficiary visibility ladder, failure/retry
  - [x] **R75.6 naming is SERVER-computed** (2026-08-21) — one algorithm, one namespace per Session; the browser composes nothing and shows an editable suggestion. Latent UTC-date defect fixed on the way
  - [x] **«التسجيلات» is `origin`, not MIME** — an uploaded audio file is a material; a `video/mp4` session recording is a recording. Three guards restated
  - [x] **R99.12 upload marker** — `content_meta.origin`, bound into the ticket, describes and never permits: `video/*` still refused for both values
  - [x] **Migration `20260821140000_r99_recording_ingestion`** — nullable UNIQUE `educational_content_id` + `ingestion_failure_reason`. «متاح» is DERIVED from the relation, never a stored status
  - [x] **Shared TD-9 validator** — `verifyObject` decoupled from `UploadTicketClaims`; one whitelist behind two doors, `video/*` still refused at `/uploads/*`
  - [x] **Server-side storage primitives** — stat · ranged head · `CopyObject` **inside MinIO** · delete. No 500 MB through Node
  - [x] **`session-recording-ingest`** — same-transaction enqueue from the verified callback, singleton per recording; the webhook persists and returns
  - [x] **Worker** — verify actual bytes (incl. media family) → durable copy → `EducationalContent` + `SessionContent` → link → sweep staging last
  - [x] **R99 staging-cleanup recovery** — a post-commit delete failure now keeps the existing ingest job retryable; relation-first retries perform only the exact idempotent staging delete, survive worker restart, and never target canonical or unrelated objects
  - [x] **Idempotent under duplicate callback, retry and concurrency** — one object, one content row, one link, no false suffix increment
  - [x] **Defect found by C2's tests:** the transition table conflated *already there* with *just moved*, so a re-delivered completion enqueued a second job
  - [x] **`verify-livekit-ingest` 27/27** — the real «بدء التسجيل» button; a **27 s / 338 KB OGG** and an **11.4 s MP4** genuinely decoded by a real media element (`readyState`/`duration`), not merely fetched
  - [x] **Tab closed WHILE recording, and she never returns** — capture continues and the whole import happens with nobody watching
  - [x] **The URL is Bodour's, never `recordings-staging`**; a reload mints a fresh one and it still plays
  - [x] **The negative is a DIFFERENT Level** — same-Level-other-branch is a positive under §4.9, so the scenario gained مستفيدة ج. 404, never 403
  - [x] **R99.8 from both sides in one run** — the imported MP4 plays; an uploaded MP4 is refused, `origin` marker or not
  - [x] **SRS Revision 100 (2026-08-21) — the TD-7 gap C2 reported is CLOSED.** R99 authorised the pipeline without naming a queue and §20 rule 1 forbids every in-memory substitute, so C2 built `session-recording-ingest` and **reported the omission instead of inventing a normative row**. R100 adds that row and nothing else, and makes normative what C2 already did: the callback **persists and enqueues, never ingests**; the order **verify → server-side copy → content → link → relation → staging swept last**; retries idempotent on the nullable UNIQUE `educational_content_id`. **Documentation-only — the implementation already conformed, and was not touched to manufacture a diff**

### R98 — entering a class عن بُعد (2026-08-20)

- [x] **The durable rule:** بذور الأمل authorizes; the media provider executes the media session. Never the reverse.
- [x] **`POST /sessions/{id}/online-join`** — one route, **empty `.strict()` body**; identity, room, role, permissions and expiry all derived server-side
- [x] **Room DERIVED from the Session, never stored** — no column, no `OnlineRoom` table, no migration (R97.9 holds by construction)
- [x] **One narrow provider seam** (`lib/online-class-provider.ts`) + `check-provider-seam.sh`, proved against all three defects it exists for
- [x] **Authorization reuses the canonical resolvers** — `audienceForSession` (R92), `staffsSession` (R91), `resolveActingStudent` (§4.3), branch scope (TD-2). No second audience query.
- [x] **Refusals proved, each for its own reason** — expired مؤطِّرة · future مؤطِّرة · R88 capability-only · unrelated beneficiary · forged/revoked child · in-person occurrence · outside the window
- [x] **Assistant parity** and a **one-off cover** confined to its occurrence
- [x] **Guardian enters AS THE CHILD**; no beneficiary role granted
- [x] **Join window** −15 min … +30 min, server time; no timeless credential; window checked **after** authorization so a stranger learns nothing about the timetable
- [x] **Minimum permissions**: no moderation for a beneficiary or an administrator; `audio_only` permits **the microphone alone**, on the credential
- [x] **One classroom for every portal** at `/classroom/{id}`; audio-only is a listening surface and never requests a camera
- [x] **Defect found only in a browser: §3.1's CSP blocked the media server** — and needed BOTH schemes, because the client validates over HTTP before upgrading. `nginx/snippets/media-origin.conf`.
- [x] **Defect: a `SessionStaff` cover on a non-overridden occurrence is resynced away** — the fixture was writing a state the platform cannot reach
- [x] **Defect: a fixture's «today» was UTC's, not the association's** — local weekday, UTC date; broken for the first hour after local midnight
- [x] Tests: 38 backend integration · 9 HTTP wire · 23 frontend · 1 new CI guard
- [x] Browser: `verify-livekit-join` **46/46** against a **real local LiveKit** — a genuine three-party room through the real screens
- [x] `livekit-server-sdk` 2.18.0 · `livekit-client` 2.22.0 · `@livekit/components-react` 2.9.24 · `@livekit/components-styles` 1.2.0, all exact, no new advisories
- [x] TD-13 gains three **grouped-optional** settings — all three or none; half-configured is refused at boot

**Deliberately NOT built (next section):** Egress, Redis, recording start/stop, webhooks, a recording job entity, import of recordings as `EducationalContent`.

### R97 — a class is delivered حضوري or عن بُعد (2026-08-20)

- [x] **Delivery domain, provider-independent** — `delivery_mode` + `online_media_mode` on schedule and occurrence, migration `20260820180000_r97_delivery_mode`, 14 schedules / 773 sessions backfilled to `in_person`
- [x] **One inheritance mechanism reused** — schedule default → materialize snapshot → `Session.overridden`; no `delivery_overridden` column
- [x] **An online occurrence holds no room**, by CHECK — so room-collision detection needs no special case; staff-time conflicts unchanged
- [x] **R91 staffing and R92 audience proved untouched**; Branch remains administrative scope
- [x] **One shared `DeliverySection`** for the class form and the occurrence editor; hidden means cleared
- [x] **Defect: the calendar wire DTO dropped the new fields** — found in the browser, fixed, and now guarded by an exact key-set assertion
- [x] Tests: 32 backend integration · 21 frontend · 2 new wire-contract cases · 4 exact-key guards restated
- [x] Browser: `verify-delivery` **24/24**; all 29 harnesses green (**612 checks**)
- [x] **Provider decision recorded, not implemented** — LiveKit for MVP (`online-class-provider.md`), with the Egress/Redis and MinIO-reachability findings
- [x] `qrcode`/`@types/qrcode` re-pinned exact, per repository dependency policy

**Deliberately NOT built (next section):** rooms, tokens, joining, recording, egress, import of recordings as `EducationalContent`.

### R96 — one QR identity per platform person (2026-08-20)
- [x] **Beneficiary-only QR rejected before implementation** — the unit of identity is the person
- [x] Audit cleared the STOP condition: children and teens are already full `User` rows
- [x] `user_qr_ref` `NOT NULL UNIQUE` on every User, DB-defaulted so no creation path can forget
- [x] Backfill: 15 users · 15 with QR · 0 NULL · 0 duplicate
- [x] Role-, enrolment- and family-link-independent; stable across soft delete and restore
- [x] One shared `UserQr`; `/profile` = account holder, beneficiary view = acting student
- [x] 7 unit · 15 integration · `verify-user-qr` **11/11** · 19 CI guards
- [ ] **Owner decision**: should every beneficiary carry a spoken `referenceCode`? (R62 gap)
- [x] **Fixed (R96.1)** — a `parent`-only account acting for a linked child now reaches every beneficiary screen through the shared gate; no role widened, new rule **AW**, `verify-guardian-child` **12/12**
- [ ] **NEXT**: one shared occurrence-details dialog (§9–§10) · direct Session recordings/materials (§11–§15) · beneficiary QR (§16–§25)

### Notification root causes + landing pages (2026-08-20)
- [x] **Level cancellation root cause**: the resolver was right. The only beneficiary in that Level+Branch was the Owner's own account, excluded as the actor (R78.3) — so the send reached nobody and said «أُرسل الإشعار إلى 0» which reads as success. **Zero now answers explicitly.**
- [x] **Grade republish root cause**: two blockers — only newly-drafted rows were offered to the notifier, and `skipDuplicates` absorbed the rest. New semantics: one row per (student, exam), **unread again when the score changed**, silent when it did not
- [x] Student landing = title + lede only; مؤطرة landing loses «ستُضاف لوحة مختصرة هنا لاحقاً», from the page and the catalogue
- [x] `verify-notify-ui` **32/32**; 643 frontend · 222 backend unit · 1399 integration; all 23 browser scripts green (508 checks)
- [ ] **NOT STARTED — the rest of this brief**: merged Teacher calendar/scheduling (§8), Teacher event creation with responsible=self (§9, §21), assistant assignment notification (§10, §11), one shared occurrence-details dialog across all four calendars (§12, §22), direct Session content in that dialog (§13, §14), beneficiary QR identity (§15–§19). Each is its own slice with its own migration/UI/tests

### Notifications — verified through the UI (2026-08-20)
- [x] **`verify-notify-ui` — 27/27.** Real dialog, real button, recipient's own bell. Cancel (with and without reason) · decline · reschedule · Event · grade draft/publish · R91 replacement recipients · R92 cross-branch · mark-read · reload
- [x] **Defect fixed:** a failed notice could not be retried — the copy said «يمكنك المحاولة لاحقاً» while `finally` closed the dialog. Both notice dialogs now stay open on failure
- [x] **Guard added:** the Prisma enum, the frontend union and the Arabic headlines must agree — proved against the defect
- [x] **`verify-notifications`'s real scope stated**: it POSTs to `/notify`, so it proves the audience and not the flow. That gap is why it was green while manual use was not
- [x] All 23 browser scripts green — **503 checks**

### C-01 — Event cancellation notification (2026-08-21)
- [x] The ordinary Event delete commits first; only an activity then offers the optional R82.5 notification decision. Decline sends no request. Classes/exams and Session R77/R83 behavior are unchanged
- [x] `event_cancelled` reuses the existing route, adapter and Event audience resolver. The deleted Event's authoritative Trash scope and live Event staff freeze the audience without a schema, migration or second Event copy
- [x] Only the recorded deleter can send after deletion; an unrelated valid administrator gets `404`. Repeat sends are idempotent and unrelated recipients receive nothing
- [x] Focused verification: 27 backend HTTP integration tests · 8 frontend decision-flow tests · `verify-notify-ui` **37/37**, including the real DELETE-before-notify request order and the recipient's own bell

### R92 — cross-branch occurrence audiences (2026-08-20)
- [x] **SRS Revision 92** + migration `20260820010000_r92_session_audience_branch`. `SessionAudienceBranch (session, branch)`, **replacement** semantics
- [x] **Physical location and audience are separate facts** — `Session.branch_id` untouched; the roster reports venue and audience side by side
- [x] **One resolver** `audienceForSession`, composed by calendar · roster · notifications · audit count. No independent cross-branch `OR` anywhere
- [x] Whole-Level only; the other modes are **refused**, and the Group/Circle variant is an open Owner question rather than an invention
- [x] **The counterpart Session is never guessed** — two schedules are structurally independent, so the administrator cancels it explicitly
- [x] Admin UI «الحضور من الفروع» on the occurrence, seeded with the inherited branch; roster shown, not inferred
- [x] 20 API tests · 10 frontend guards · **16/16** `verify-cross-branch` across six identities · concurrency on the Session's own version
- [x] 1395 integration · 222 backend unit · 623 frontend · 18 CI guards · OpenAPI current, TD-3 +2 routes
- [ ] ~~NEXT — cross-branch occurrence audience (§D)~~ **DONE.** Deliberately NOT started: the Owner's brief instructs re-checking capacity before D and stopping after C with a clean tree if D cannot be completed whole. It needs its own migration (a `Session` audience override), one shared audience resolver, the counterpart-Session decision, UI, tests, browser verification and docs

### R90 — staff-picker planning warnings (2026-08-19)
- [x] **SRS Revision 89** closes the §14.1 gap: `/admin/teachers` is in the sitemap, with the three ownerships stated
- [x] **SRS Revision 90 + `GET /admin/teaching-candidates`** (TD-3 registered, OpenAPI generated). Four appraisals; **the list is never shortened and nothing is disabled**
- [x] Rendered on the **shared `StaffPicker`** — marker on the option before the choice, named chips under the control after it, silence for a clean candidate
- [x] **Recurrence-aware**: every occupied weekday must be covered, `daily` = seven, `monthly`/`yearly` = *indeterminate*, alternating series collide only on shared anchor parity. No second recurrence engine
- [x] **Both halves of R88.3 proved** in the API and in real Chrome: هـ with no profile teaches once assigned; أ with a flawless profile teaches nothing unassigned
- [x] **Defect fixed:** class staffing was refused on UPDATE while the form offered the controls — now replaced whole, future occurrences resynced, past ones untouched
- [x] **Defect fixed:** `ClassSection` hand-wrote the picker (rule C) — the extraction had been written down and only two thirds applied
- [x] QA inventory reconciled: **447 checks across 19 harnesses**, every count measured. Three harnesses were repaired first — see CHANGES.log
- [ ] **NEXT SLICE — effective-dated staffing.** `CourseScheduleStaff` is time-blind: conflicts are bounded only by the schedule's `deleted_at` and R50's `effective_until`, and *A until 15 November, B from 16 November* cannot be expressed. R90 takes the proposed class as input and reads staffing through **one** query, so bounding that query by a date range is the whole of the change

### R88 correction — إدارة المؤطِّرات gets its own screen (2026-08-19)
- [x] **The row action left `المستخدمون`.** A teaching profile was offered on a screen whose population is every account — guardians, minors, administrators. The backend is untouched; only ownership moved. New rule **AQ** in [ux-architecture](development/ux-architecture.md)
- [x] `/admin/teachers` under الشؤون التعليمية, beside `التسجيلات`: the section now holds the people being **taught** and the people **doing the teaching**
- [x] **Population asked of the server** (`role=teacher`), never `is_beneficiary` as an exclusion — a مؤطِّرة who also studies is listed, proved in the browser and at the API. `role=teacher` and `beneficiaries_only` are **complements**
- [x] **The R88 dialog reused unchanged** — one teaching-profile editor, asserted by a source scan
- [x] **Weekday i18n root-caused:** `calendar.weekday.*` never existed (labels live at `scheduling.weekday.*`), and `resolves.test.ts` scanned only *quoted literals*, so a computed key was invisible to it. The guard now resolves every **computed** key's namespace, and was proved against the defect before the fix
- [x] Time inputs use the platform's `TextField` + `scheduling.timeHint` — the same control `RecurrenceEditor` uses for the same value; a hard-coded «HH:MM» is gone
- [x] 13/13 browser checks; 14 frontend tests; 5 backend HTTP tests. **Two harness defects found and fixed**: it searched the whole document for the row action and opened the wrong مؤطِّرة's profile, then read her stale data as persistence; and it clicked each row's last button to "open a menu" that `DataTable` does not have — on `المستخدمون` that button is «إيقاف الحساب»
- [x] **§14.1 gap closed — SRS Revision 89** (2026-08-19): the node joins the Academic group, and the revision states the three ownerships (`المستخدمون` = accounts · `التسجيلات` = beneficiary placement · `إدارة المؤطِّرات` = teacher planning). **R88 semantics untouched**; TD-2 gains no row and TD-3 no route

### Admin Dashboard — session management and content (Owner priority, 2026-08-05)
- [x] **Recurrence edit scopes — APPLIED to `docs/SRS.md` as Revision 50** (Owner-authorised direct edit, 2026-08-05). The SRS is the source of truth; `SRS-PROPOSAL-R50.md` is retained for the rationale
  - *This session only* and *all sessions* are **already built**; only *this and all future* lacked a mechanism
  - Implemented as a **schedule split**, not an exception model: the platform already materializes every occurrence and marks the overridden ones, and §4.4 computes conflicts against sessions rather than rules
  - Needs one column: `effective_until` (nullable calendar date; `NULL` = open-ended)
  - **No new endpoint** — `scope` + `from_date` on `PATCH /admin/course-schedules/{id}`
- [x] **Admin Calendar — Event CRUD** (`/admin/calendar`). **Zero backend change**
  - The list dedupes `GET /calendar` occurrences by event id — **no `GET /events` was invented** (§20 r16)
  - The date window is a real input: the endpoint is date-bounded, and the screen says what it is showing
  - Scope on create only, mirroring the server's refusal of scope keys on `PATCH`
- [x] **R50 backend — `effective_until` and the schedule split**
  - The bound lives in `expandSchedule()` **and nowhere else**; it is a second upper bound beside `horizonFor()` and the earlier wins
  - One transaction: close the original, create the successor, **copy the staff**, release the unprotected future sessions
  - The original is closed **before** the successor's conflict check, or it collides with the half it replaces
  - The successor **inherits** `effective_until`, so splitting a bounded series does not make its tail unbounded
  - 7 tests including the §18 criteria; `all_sessions` proven unchanged
- [x] **Session management UI** — all three R50 scopes, at `/admin/schedules/{id}/sessions`
  - Needed one endpoint: `GET /admin/course-schedules/{id}/sessions`, a **sibling of `/conflicts` and `/roster`**. `GET /calendar` could not serve it — it omits `schedule_id` on the public surface, and widening a public payload for an admin need is the pattern rejected twice before
  - Rows carry `protected_reasons`: §4.4 requires the dialog to say what will change, which needs knowing what will be spared
  - The scope is asked before **every** operation that can reach a series, with a live count, and stated before confirming
  - The date moves only under *this session only* — the wider scopes edit a rule, and a rule has times but no date
- [x] **TD-3.5 storage endpoints** — **the note was stale**, verified 2026-08-28.
  All four are mounted in `app.ts`: `POST /uploads/initiate`,
  `POST /uploads/{uploadId}/complete`, `POST /uploads/{uploadId}/abort` and
  `GET /content/{id}/download-url`.
- [x] **Educational Content upload UI** — also stale. `ContentUploadForm` ships on
  مكتبة المحتوى and `SessionMaterialsDialog` attaches to a Session.
  `verify-content-visibility.sh` performs a **real upload** end to end and removes
  its own row afterwards (24/24).

- [x] **Rooms CRUD** — verified complete (shipped M3b-30); added the missing delete confirmation that every other destructive action already had
- [x] **Trash UI (`/admin/trash`)** — SRS Revision 52 applied; list, filter by type and date, search, restore **per entity type**
  - `restorable` is a **server** decision on every row: a client cannot know which deletions cascade
  - Restorable: `User` (R111), `Branch`, `Category`, `Subject`, `Room`, `Exam` and
    `HijriMonthStart`; future Exam staff are revalidated transactionally before revival
  - Blocked types state **why**, rather than silently omitting the action
  - Guards the SRS did not name: `PARENT_DELETED` and `ALREADY_PURGED`
  - R59.1 later added server-declared, audited permanent deletion; User remains
    de-identification, never row destruction
- [ ] **Widen the remaining restorable set** — each type needs its TD-5 cascade reinstated and
  tested before it joins: `Level` (its Administrative Groups), `TeachingGroup` (member seats),
  and `RecurringCourseSchedule` (future Sessions). Until then the screen says so per row

**Gates
- [ ] §18 *Educational Model* checklist green — including the §19.2 named regressions: composite-FK rejection **attempted directly in SQL**, weekly-vs-biweekly conflict on the alternating week, double-`materialize` idempotency, schedule edit sparing an overridden session, and anonymous-vs-authenticated parity on `/calendar` and `/library`

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
- [x] **Exam builder — BUILT by R124**, in the shape the ratified revision states
      rather than this line's: **four** question kinds (short text, long text,
      UCQ, MCQ) with an optional or required justification on a choice question,
      each question an immutable **row** with an explicit `display_order` rather
      than a UUID inside a JSON array — a blob could not make ordering stable,
      could not let an answer reference the option it chose, and could not refuse
      the deletion of an answered question. Print CSS remains post-MVP §10.1.
- [~] **Submission lifecycle — BUILT by R124; `access_policy` is NOT consumed.**
      `in_progress → submitted` is live, save is separate from submit, and
      submitted is final for the student (no reopen in v1). **`single_submission`
      vs `save_and_resume` is a column nothing reads**: v1 gives every assessment
      save-and-resume, and enforcing the other mode is unbuilt. Recorded as a gap
      rather than ticked, because the column exists and would read as honoured.
- [x] ~~All scores as integer bp~~ — **SUPERSEDED by R81.** `Grade.score` is
      `NUMERIC(6,2)`, the mark as given out of the exam's own `max_grade`; there
      is nothing to normalise against and so nothing to round. §20 rule 3's
      prohibition on **float** arithmetic stands and is better served by exact
      decimal.
- [~] **Absent-zero rows — BUILT** (BR-7): initialised at the teacher's first
      draft save, against the exam's audience. **MCQ auto-grade — EXPLICITLY
      EXCLUDED by R124**: v1 marks everything by hand, and §4.6 now says so. The
      subjective grading flow is the existing sheet.
- [x] **`Grade.administrative_group_id` sitting provenance — BUILT** (R43); it is
      selected and written by `grade.service`. Template-scoped aggregation
      belongs to the postponed engine (§10.1) and is deliberately absent.
- [x] **Grade optimistic versioning — BUILT** (TD-15), and proved by the
      stale-version test on the sheet. Recalc-job participation belongs to the
      postponed engine.
- [x] **Postponement check — VERIFIED 2026-09-04:** no `GradingTemplate` table,
      service, route or UI exists anywhere; the only occurrence of the name in
      the repository is the schema comment recording that it is post-MVP.
- [x] ~~Pass/fail override endpoint + audit~~ — **RETIRED by R81**, which removed
      the endpoint, dropped the columns and retired `grade.passfail_override`
      from TD-8: with nothing computing a verdict there is nothing to override.
      The two stale TD-3 registry lines were removed on 2026-09-04.
- [ ] LevelSurah/LevelSubject auto-draft components incl. the Adult-stage dual generation (BR-9, §4.6)
- [ ] §18 Exams & Grading checklist green (incl. both race tests)

### R57 — a class carries its own name (2026-08-09)
- [x] `title` (required, 1–120, `ar-x-icu`) and `description` (optional) on `RecurringCourseSchedule`
- [x] TD-6b expand → backfill from the Subject's name → contract to `NOT NULL`; DB CHECK refuses a blank title
- [x] Both editable after creation, unlike the scope fields §4.4 freezes; a split successor inherits the name
- [x] **Two silently-dropped fields fixed on the update path**: `title` and — since R55 — `effective_until`. The regression tests read the ROW, never the status code
- [ ] The remaining fixture titles from before the seed fix still read `[تجريبي] حدث …`; they are data and were not rewritten. Say the word and they can be cleaned

### R62 — parent/child registration (2026-08-11, in progress)
- [x] SRS applied; `ChildApplication`, 4 enums, `FamilyLink.relationshipType`, `User.referenceCode`, `User.schoolingStage`; migration applied
- [x] `child-application.service.ts` — submit, per-child decide, duplicate proposals, a parent's own list
- [x] HTTP surface: 4 routes, TD-3 registered, OpenAPI 79 paths / 106 operations
- [x] **Approval queue reads child applications** — one item per request, one decidable block per child
- [x] Registration flow → multi-child, through the same service; `phone` and child `notes` cease to be collected as a consequence of R62.1's shape
- [x] **Registration form → multi-child**; it was sending the pre-R62 shape and every family registration through the UI returned `400`. Per-child media release, `schooling_stage` collected, indexed server-issue paths
- [x] `GET /me` names the children; `/dashboard/parent` removed (a parent's home is `/dashboard/student`); active child persists across the navigation a role switch causes
- [x] 11 HTTP integration tests for the child-application endpoints — including submit → approve → `/me` names the child
- [x] **R63 — `GET /students/me`**, the identity block R62.10 needs. Drafted, Owner-authorised, applied to the SRS, registered in TD-3, 8 HTTP tests. First mount site of the `X-Active-Child-ID` middleware
- [x] **R63 — §14.1's stale `/dashboard/parent` corrected**
- [x] `ولي الأمر` is a group, not a clickable role: children by name + persistent «＋ تسجيل طفل»; one switcher, not two; a parent-only account gets it
- [x] «＋ تسجيل طفل» dialog → `POST /child-applications`
- [x] `/dashboard/student` — identity block, today's and upcoming sessions, persistent banner naming whose data is shown
- [x] **Identity binding → non-blocking review item** (R68). Stamped inside the binding transaction; a fourth queue type, one item per student; approve = the links stand, reject = revoke. **R62 is complete.**

### R64 — the child-registration flow reconciled (2026-08-11)
- [x] **The reported `NOT_FOUND` root-caused**: a child-application request id names no `User` and no `FamilyLink`; there is no bundle decision (R62.2). Server refuses it by name (`DECIDE_PER_CHILD`); the queue decides per child
- [x] **Approving a child was revoking the parent's other roles** — found end-to-end, not by any test. The grant is additive now, pinned by a regression test
- [x] `ChildApplication.requested_branch_id` written by both paths; queue reports the branch and the filter reaches the type
- [x] §4.1 placement rule restored on the per-child path (`ENROLLMENT_REQUIRED`); linking an existing account stays exempt
- [x] «＋ تسجيل طفل» → `/dashboard/student/register-child`, same fields as `/register`; `ولي الأمر` hidden until a child is approved
- [x] نوع التسجيل relabelled so it stops naming a Category
- [x] Table rule established and applied (branches +4 columns, levels +1); `إضافة مجموعة` converted to `FormDialog`
- [ ] **OWNER DECISION — Categories and Levels have no `description`, and NEW K/L supplied one for each.** The Owner's canonical dataset gives every Category a description (المرأة: *النساء من سن الجامعة الى ما فوق*, and so on) and every Level one of the form *المستوى N - برنامج X*. **Neither entity has a column to store it**, and §7 defines Category as carrying only `name` and `display_order`, and Level only those plus `gender_restriction` — the seed says so in a deliberate comment. Storing the descriptions is a schema addition against a normative §7 clause, which is the Document Owner's call and not the agent's. Everything else in NEW J/K/L shipped on 2026-08-27. **In simple words: do you want the platform to store and show a short description under each Category and Level? If yes, that is a small change to §7 and to the database, and the descriptions you already wrote are ready to load.**
- [x] **R130 — a full date of birth for every beneficiary (Owner, 2026-09-03).**
      `User.birth_date` is the durable answer and `ChildApplication.birth_date`
      the submitted one, materialised unchanged at approval. Required at the
      write boundary on the adult beneficiary path and on **every** child;
      **not asked** of a guardian (R129) and **refused** on a staff request.
      `lib/birth-date.ts` owns the parse, the calendar check, the future bound,
      the plausibility floor and the eighteen-year predicate — no age is stored
      anywhere, asserted against `information_schema`. **18 establishes
      eligibility and triggers nothing**: no birthday job, guarded by asserting
      no job source names the column.
      - [ ] **CONTRACT PHASE PENDING, and honestly so — `birth_date` cannot
            become `NOT NULL` until every live beneficiary has a real recorded
            date.** 25 have none (Localhost, 2026-09-03) and none was
            fabricated. Completion is a Super Admin recording the real date on
            `/admin/users`: **completion, never correction**
            (`BIRTH_DATE_ALREADY_RECORDED`). Revisit the contraction only when
            the count of live beneficiaries with a null date reaches zero.
- [x] **RESOLVED AND BUILT (Owner, 2026-09-03) — the minor→adult transition (R132).**
      The trusted channel is **the association itself**: Google OAuth proves
      control of a Google identity, her **reference code** names which record is
      claimed — it grants nothing on its own (R62.5), which is why quoting it is
      safe — and a **Super Admin** performs the identity match with the
      recognition the association already practises. **No CIN, no document
      scans, and no invented automated identity proofing.** Only the approval
      binds, and it binds to the **existing** `User`: no second account, and her
      whole educational history stays on the one id. `PATCH /admin/users/{id}`
      still refuses `pre_provisioned_email` — R132 is the controlled path that
      refusal was protecting, not a general capability.
      **The guardian is excluded by construction**: she cannot choose, type,
      attest, bind or approve the identity, and her own address never becomes
      the beneficiary's — which was precisely the blocker.
      **Age is eligibility only** (R130): no birthday job, guarded.
      **After the transition a former guardian loses current authority** while
      the link row survives as evidence — derived from R62.9's own definition of
      a minor (*an account with no login identity*) rather than a second flag.
      28 focused tests; `docs/SRS-PROPOSAL-R132.md` is **APPLIED to `SRS.md`** (2026-09-03).
- [ ] **OWNER DECISION — nothing marks the adult Category.** §2.1 says adults hold logins and minors do not, but R27 made the Categories renameable generic rows, so no form can enforce it and matching by name would hardcode reference data. Recommendation: a `Category.holds_own_login` marker. Until then a self-registering adult can request الطفل, and an approver corrects it

### R65 — the personal section is role-independent (2026-08-11)
- [x] **Audit finding: §5.2 already places `/profile` under *Shared / Cross-Role*** and it had never been built — which is why R64 hung child registration off a role's dashboard
- [x] `/profile` ships: own details, editable contact info, child registration, the status of own requests. Reached from the account menu, not role-gated
- [x] `/profile/register-child` replaces `/dashboard/student/register-child`; the dashboard link is removed — one entry point, not one per role
- [x] `GET`/`PATCH /profile` registered in TD-3; `PATCH` accepts `phone` and `nickname` only, refused not ignored; TD-15 versioning; `user.update` audit
- [x] **No authorization change** — `POST /child-applications` never checked a role; only the door was missing
- [x] `ولي الأمر` untouched: about already-approved children, and no registration action inside it
- [x] **Account deletion settled by ratified R111/R112, superseding the R54 draft.** The control
  ships on `/profile`; the remaining authoritative-SRS/TD-7 synchronization is recorded under
  M7 below rather than reopened as a product decision.

### R69 — the two hierarchies get their own navigation (2026-08-12)
- [x] **Audit first: the model and the authorization were already correct.** No schema, service, policy or TD-2 change
- [x] `/admin/level-subjects` and `/admin/teaching-groups` join §14.1, ids as query parameters (the `/resources` pattern); old paths redirect
- [x] `المستويات` → الإدارة, Super Admin screen; **read endpoint stays Admin-accessible** (the R61 branches rule)
- [x] Both borrowed Subject row actions removed from `المستويات` and `مجموعات المستويات`
- [x] Verified live: R66 direct + grouped enrolment, `entire_level` with no Circle, and R43.3's Super-Admin-structure / Admin-membership split
- [x] **Breadcrumb across المستويات → مواد المستوى → حلقات المادة** — `PortalShell` takes an optional trail; passed in by the page, never derived from the URL, so it can only link nodes that exist
- [x] **Post-R69 audit (2026-08-12):** the drill-down out of مواد المستوى still used the legacy path and navigated twice; «تنظيم المادة» survived as a row-action label for a screen now called «حلقات المواد»; `pickSubject` was substituted into the heading as if it were a Subject name

### The R66 group-less-enrolment bug class (2026-08-14)
- [x] **P0 consent re-evaluation** — the `entire_level` arm skipped group-less students, so BR-2/§4.9's gate never re-ran for their sessions
- [x] **P1 circle candidates** — `listUnassignedStudents` required a live group and scoped branches *through* it; now `Enrollment.branch_id`
- [x] **P1 private library** — 3 sites hid a group-less student's own Level from her and her parent
- [x] **Guard for the class**, proven to fail on reintroduction; states its blind spot (nested `enrollments.some`)
- [x] All 14 enrolment queries classified; group-specific ones deliberately untouched
- [ ] **Left deliberately:** `calendar.service.ts:676` prefill (P2, Owner-scoped out) — in the guard's allowlist with its reason

### End-to-end verification of the educational chain (2026-08-14)
- [x] 30 assertions through the HTTP API: مستفيدة → مستوى → مقر → مجموعة → مادة → حلقة → امتحان → نقاط
- [x] **Found and fixed:** a group-less student could join **no circle** — `studentBranchInLevel`'s `where` still required a live `administrativeGroup`, and a relation filter never matches a NULL relation
- [x] Confirmed Administrative Group ≠ Teaching Circle, and that circle membership has **no** effect on exam eligibility in either direction

### R74 — enrolment gets a screen (2026-08-13)
- [x] **The gap the audit named:** R66's `enrolInLevel` was reachable only through approval; the sole endpoint required a group
- [x] `التسجيلات` (`/admin/enrollments`) joins §14.1 — the Level view of the rows the group roster shows per group
- [x] `enrolAtLevel` is a call to `enrolAtPlacement`; every rule stays in the service the approval path already uses
- [x] Live-verified the exam consequence: enrolling a مستفيدة takes a whole-Level exam's sheet from 0 rows to 1, gradeable
- [x] **Group-less unenrolment built** (`unenrolById`), sharing one `releaseEnrollment` with the group-keyed path
- [x] **Enrolment editing built** — into/out of/between groups and branch; `level_id` refused, because BR-21 makes the enrolment the (student, level) pair
- [x] Enrolment rows show circles read-only; membership stays on حلقات المواد (§4.4c)
- [ ] **Open gap, reported not invented:** nothing structurally identifies a beneficiary — minors hold no role, `intended_category_id` is unset, and one account is both teacher and student. The picker offers every active account. Needs an Owner decision, like R64.7 and R73.4
- [x] **Assistant multi-select built** — `MultiSelectField`, a new atomic control, wired into `StaffPicker` so the exam, class and event forms all changed together

### UX slice — atomic components and the management-overview principle (2026-08-13)
- [x] Student Quran view linked from the dashboard; **one Level selector** (`{Category} — {Level}`) with three screens migrated
- [x] **`إضافة حساب` kept** — TD-2 grants it and R68 depends on it — and its **duplicate-email defect fixed**: an address already signed in collided with nothing and was accepted
- [x] `states.tsx` and `Pagination` converged on the shared `Button`; they were the platform's only unstyled controls
- [x] **`حلقات المواد` rebuilt as a management overview** — no dropdown gate, Groups read-only, circles CRUD inline, BR-22 preserved. No normative change

### M4 — Quran Progress (2026-08-12)
- [x] **R73 applied:** navigation node · `quranlog.create` · TD-2's Quran qualifier · `Subject.tracks_quran_progress` · TD-15.5's stale reason corrected
- [x] **M4a:** BR-13 union (pure, tested against §4.5's own example) · synchronous recalculation · self-heal guard · Trash on delete · `/teacher/quran?student=`
- [x] Authorization exactly as approved: only the structurally marked حفظ القرآن teaching scope; **teaching and assisting count equally**; Admin/Super Admin unchanged; **fails closed** when no Subject is marked (R107)
- [x] Invariant: at most one live Subject may carry the memorisation marker — partial unique index, proven to refuse a second; the Production seed establishes exactly one on حفظ القرآن
- [x] **M4b — `/dashboard/student/quran`**, read-only. `GET /students/me/quran` carries no id: the subject comes from `childContext`, so a parent sees the child they act for and nobody else
- [x] The read is split (`coverageFor`) and shared — the staff path and the student path differ only in how the subject was established
- [x] **M4c — `LevelSurah` + BR-11.** Syllabus management (Super Admin writes, Admin reads) and completion read from the existing engine
- [x] Three states: no syllabus -> `complete: null`, deliberately not `false`
- [x] **BR-11's final-exam clause is unreachable and reported as such** — nothing marks an exam as final (`round` is explicitly non-semantic, §4.6). No marker invented
- [ ] **Owner decision, reported not invented:** a *final exam* marker on `Exam`, if BR-11's second clause is ever to fire. Same shape as R64.7, R73.4 and the beneficiary gap

### R72 — the Teacher's الجدولة write access (2026-08-12)
- [x] **R72 applied:** §14.1's `/teacher/schedules` clause said *"do not create or edit schedules"* and gave TD-2's event grant no node. Clarified to mean Course Schedules; Activities are authored here
- [x] Reuses `SchedulingDialog` with `types={['activity']}` — no second screen (R56)
- [x] **Found live:** the form sent `branchIds` into a snake_case `.strict()` contract, so **every non-Global event creation returned 400**
- [x] **Found live:** no form ever offered a `group` scope, the only one a Teacher may use — the server has accepted `group_ids` since R43
- [x] A Teacher is offered `group` and nothing else, and it is their default
- [ ] **Not built:** a Teacher edits an activity only from the calendar; this list is Course Schedules and shows no activity rows

### R71 — an event has somebody responsible for it (2026-08-12)
- [x] **Audit first:** the role model already separates person · capability · scope. No new Role, no capability table, no parallel authorization
- [x] `EventStaff` + `EventStaffPosition` (`responsible | assistant`), shaped like `ExamStaff`, R59 tombstone-and-revive, no Trash entry
- [x] **Event scope is a union** — events staffed ∪ §4.4c teaching scope — as one arm in `roster-resolution.ts`
- [x] `responsible` edits; `assistant` sees only. The one place a `*Staff` position is authorization-bearing, and why
- [x] Assigning staff is Admin+; **creating an event records the creator responsible**; deletion stays Admin (`Event` has no `created_by`)
- [x] Six existing teardowns updated — `event_staff` is RESTRICT like every other event child
- [x] **Terminology slice:** أستاذة → مؤطِّرة · طالبة → مستفيدة (9 places, incl. the privacy notice) · مشرف عام → مشرفة عامة · two drifted role dictionaries unified · **15th CI guard**
- [x] **UI shipped:** the responsible مؤطرة and her assistants are assigned on the scheduling form's `نشاط` branch
- [x] `StaffPicker` **extracted** from the exam section and shared by both — one control, each caller's own vocabulary
- [x] Event DTO carries `staff` (live rows only) so the form prefills who already answers for it

### Platform-wide UX & information-architecture pass (2026-08-17)
- [x] **Audit first, and it decided the size:** the atomic foundation already existed — `Button`, `DataTable`, the five §14.4 states, `levelLabel`, `MultiSelectField`, `FormDialog`, `ConfirmDialog`. **The defects were drift at the edges**, so this was a migration, not a construction. Audit: `docs/development/audit-2026-08-17-ux-architecture.md`
- [x] **Five dropdown-gated pages converted to data-first:** `نقاط الامتحانات` · `حلقات المواد` · `مقرر الحفظ` · `مواد المستوى` · `/teacher/quran`. Deep links survive as **focus, never as gates**
- [x] **A second complete button system removed** — `.button` / `.button.primary` in `status-pages.css`, ten call sites, its own padding and none of `ghost`/`danger`/`add`. Plus five files hand-writing `btn btn--*`, including a `<span>` styled as a disabled button
- [x] **`Button variant="add"`** — the `＋` had lived in a *translation string* for exactly one screen. The variant emits it, so a caller cannot forget it
- [x] **`SearchableSelect`** — one choice from many, **options visible on open**. It replaced two typed-search workflows that returned nothing until two characters were entered
- [x] **Three copies of the Level label reduced to one**; `withCategoryNames` completes the label from the payload the caller already had. The calendar filter and the groups page had rendered bare names
- [x] **No pass/fail verdict on the grade sheet.** `Grade.passed`, `manual_pass_fail_override` and BR-12 **untouched in the model** — the override is still surfaced, because provenance is not a verdict
- [x] **§5.3's `/dashboard/student/grades` finally rendered.** In §14.1 since R62 with nothing implementing it. `GET /students/me/grades` selects `published` **in the query**, so a draft is absent rather than hidden
- [x] **Optional circles in the placement workflow** — two existing calls in order, keyed on the **Level alone**. No Group↔Circle relationship, no schema change
- [x] **«إنهاء التسجيل» audited: the implementation was already correct.** Copy now distinguishes it from changing a placement and states what survives; `ConfirmDialog` gained one optional `details` slot
- [x] **The «66» was one string** — a revision number on a form hint. A sweep of every catalogue *value* found no other leak
- [x] **الإدارة reordered** to الفئات → المستويات → المواد → **مواد المستوى → مقرر الحفظ** — §14.1's own dependency order for the first four
- [x] **The مؤطرة's labels aligned with the back office's** («الجدولة», «مكتبة المحتوى») and her sidebar grouped like it. **No access changed**; `/admin/content` deliberately not offered
- [x] **`إضافة حساب` removed from المستخدمون**, with its dialog and six orphaned catalogue strings. `POST /admin/users` and the adapter untouched
- [x] **19 lettered rules documented and guarded** — `docs/development/ux-architecture.md`, plus a *Platform UX & Atomic Design Rules* section in `CLAUDE.md`
- [x] **Two defects found while wiring, neither in scope:** `fetchMyCoverage` never sent `X-Active-Child-ID` (a parent-only account got a `400`; one holding both roles saw its own progress); `admin.users.create` survived as an orphaned catalogue entry shipping in the bundle
- [x] **Three guards restated rather than deleted** — they pinned the accordion's implementation, and one read the redesign's *use* of `LevelSelect` as a filter as a violation of the rule it fulfils
- [ ] **Awaiting Owner decision (non-blocking):** `GET /admin/teaching-groups` and `GET /students/me/grades` are unlisted in TD-3 — see the audit's §Z, which also records that **`/admin/level-surahs` is not in §14.1**
- [ ] **Not done, and stated:** a مؤطرة's Quran list shows names only — a coverage column needs `/quran-students` widened. `DataTable` still hand-writes its row-action button classes. Three editable tables remain outside the shared primitive, with their reasons in the guard's allowlist; **a fourth is the signal to build an editable-table primitive**

### M5a — in-school exam grading + Teacher scope (2026-08-12)
- [x] **Audit first:** §4.6's model complete, R58's exam half built, §4.4c resolver already live. `Grade` had no service/route/adapter/screen — that was the whole gap
- [x] **R70 drafted and applied:** `/admin/exam-grades?exam=` joins §14.1 · BR-7 reworded to *the exam's audience* · `grade.enter` joins TD-8 · TD-2's exam row splits in four
- [x] Owner decisions: Course Schedules stay Admin (scope self-reference); Teachers create exams in §4.4c scope; **deletion stays Admin** — `Exam` has no `created_by`
- [x] **R66 defect fixed:** `studentsTaughtBy` + `assertCanAccessStudent` resolved branch through the GROUP — ungrouped students were invisible to their own teacher
- [x] **Found live, not by tests:** pre-R58 exams (null branch/subject) answered 500; now `EXAM_INCOMPLETE`, with the type narrowed so it cannot recur
- [x] One shared `GradeSheetView` rendered by both entry points, with a source guard asserting neither page reimplements it
- [x] Empty ≠ absent ≠ zero, structurally; /20 ↔ bp converted once on the server; BR-7 · BR-8 · BR-12 · TD-15 all covered
- [ ] **Not implemented, and stated:** no UI for a Teacher to CREATE an Event — the server has supported it since R43 (`teacherEventScope`), and `/teacher/schedules` is read-only by design. الجدولة write access for Teachers needs its own slice

### Post-R69 UI fixes (2026-08-12)
- [x] **`SUBJECT_NOT_IN_LEVEL` root-caused to the CLIENT.** The Subject selector listed every Subject on the platform instead of the Level's own; validation untouched
- [x] A Level teaching nothing gets a named empty state linking to مواد المستوى, not an empty dropdown
- [x] The form's refusal rendered behind the open dialog — passed into it now
- [x] The circle form was the last hand-rolled `Dialog`; it uses `FormDialog`, which fixes the button alignment
- [x] **R66's retired `LAST_GROUP_IN_LEVEL` removed from the interface** — warning text and the dead refusal string. Service already correct
- [x] `SCHEDULES_EXIST` deletion guard tested for the first time; `ENROLMENTS_EXIST` added at service level

### R67 + UX pass (2026-08-12)
- [x] **R67 — a child's branch and stage are the CHILD's.** Drafted, applied, implemented. No migration: `child_application` has held both per row since R62/R64
- [x] Parent's `intended_branch_id`/`intended_category_id` derived from the first child (R67.3); adult path untouched
- [x] **Found end-to-end, not by tests:** `POST /child-applications` had both optional while `/registrations` required them. Required on both now, 2 HTTP cases
- [x] `.form__row` aligns on controls — fixes تاريخ بدء العمل / ترتيب العرض and إضافة دور / نطاق الفرع with one rule
- [x] الفئات and المواد under الإدارة, Super-Admin-only; READ endpoints stay Admin-accessible (R61's `GET /admin/branches` precedent); Levels stays Admin-readable
- [x] **مواد المستوى / تنظيم المادة audited: the problem was vocabulary.** «فوج» removed (22 strings) — one word per concept; headings name the Level and the Subject
- [x] Breadcrumb for those two screens — delivered in the post-R69 audit above

### R66 — a student is enrolled in a Level; a Group is a subdivision (2026-08-11)
- [x] SRS drafted, applied. §7 Enrollment amended; §5.2 and R43.3 corrected to `Enrollment.branch_id`
- [x] Migration `20260811210000` — TD-6b expand → backfill → contract, derived values, fails loudly rather than relaxing the column
- [x] `administrative_group_id` nullable; composite FK `(administrative_group_id, branch_id)` null-safe by construction
- [x] TD-4.6b, TD-4.6d and `LAST_GROUP_IN_LEVEL` retired; `ENROLMENTS_EXIST` untouched
- [x] `enrolInLevel` — direct enrolment in an unsubdivided Level; 13 branch reads moved off the join
- [x] Level creation drops the branch end to end (service, validator with `.strict()`, DTO, controller, adapter, form)
- [x] 995 backend tests green; the ten encoding retired rules rewritten to the new rule, not deleted
- [x] **Approval placement into a group-less Level** — `enrolAtPlacement` dispatches one `PlacementInput` union for both approval paths; both wire schemas refuse a mixture and half a placement by name; the dialog offers every Level again with a branch selector where there is no group. TD-4.6d's backfill removed from code with it

### UI/product pass 2 (2026-08-11)
- [x] Arabic-Indic digits removed platform-wide + `check-western-digits.sh` (14th guard). **Arabic text, Western numerals**
- [x] Approval button traced: the DATA violates TD-4.6b's invariant — 18 of 20 Levels have no group, so `complete` could never be true and the control was disabled. Unassignable Levels are now excluded, with a route to fix
- [x] «＋ تسجيل طفل» removed from the account menu; `/profile/register-child` unchanged
- [x] `.field--choice` had no CSS rule at all — one rule fixes five usages (RTL-safe)
- [ ] **AUDITED, NOT IMPLEMENTED — see [audit-2026-08-11.md](development/audit-2026-08-11.md):**
  - **Level creation's branch** conflicts with TD-4.6b (Level + first group, atomic). Three resolutions costed; **A recommended** (retire the invariant). Needs a revision + a decision on the 18 existing group-less Levels
  - **Per-child branch/category** needs **no migration** — `child_application` already holds both per row. Only the validator and two forms treat them as request-level. Needs a revision amending R62/R64.2
  - **Deletion**: 28 of 45 models soft-delete; 7 are currently restorable and the purgeable
    set remains deliberately narrower. **Recommendation: do NOT draft a generic "delete anything"
    revision** — three smaller decisions instead (widen RESTORABLE per type · switch on retention ·
    settle the backup statement)
  - **Deployment**: `bodouralamal.vercel.app` is a **mock-backed frontend preview by design** (§19.0). Same-origin routing is load-bearing for TD-12 cookies and the OAuth callback, so a split deploy is ruled out by the SRS. **Do not deploy.** Needs a VPS
  - **Educational structure** (addendum): 4 of the 6 statements are ALREADY the specification — a Subject needs no change at all (§7 states it verbatim). The conflict is one rule R43 took explicitly: *"exactly one Administrative Group inside each enrolled Level"*. **Smallest revision: the branch moves from the group to `Enrollment`**, which makes the group nullable with no other structural change, keeps groups branch-owning as the Owner's example requires, and makes the 18 group-less Levels legal instead of broken. Retires TD-4.6b, TD-4.6d and `LAST_GROUP_IN_LEVEL`. Backfill is derivable

### UI/product pass (2026-08-11)
- [x] Child section extracted to one shared component; the personal page gains multi-child. 9 tests through both entry points
- [x] `المستخدمون` filter row aligns on the controls (`align-items: start`) — one rule, every toolbar
- [x] `الشؤون التعليمية` ordered general → specific; `/admin/groups` relabelled «مجموعات المستويات» (§20 rule 22 — it was calling an Administrative Group a حلقة)
- [x] One Arabic date formatter at every `<time>`; `DateField` gains a format hint and an Arabic echo. **The native control's placeholder is the user agent's and cannot be overridden** without abandoning the native picker — stated, not worked around
- [x] Hero: association's own motto and mission wording; logo made transparent (border flood fill) and cropped to its artwork; `object-fit: contain`
- [x] Mission section removed (strings kept — removed *for now*); footer city removed (key deleted); sticky-footer layout on `#root`
- [ ] **OWNER DECISION — الفئة offers الكبار in child registration, and the model cannot honour it.** Traced end to end: approval creates a login-less account (no `UserIdentity`, no email), linked to the requester, with consent recorded as given by the requester — contradicting §2.1 (adults hold their own accounts), §4.3/R62.9 (an adult consents for themselves) and §4.1a. The Owner's future cases are already served by adult self-registration (§4.1b). **Removing the option requires R64.7's `Category.holds_own_login` marker** — R27 made the Categories renameable, so filtering by name would hardcode reference data

### R62 — deferred by scope, not forgotten
- [ ] `/dashboard/student/calendar`, `/grades`, `/quran` are §14.1 nodes belonging to later milestones; the dashboard deliberately does not stub them
- [ ] Still pending the Owner: guardianship verification · right to an actual rejection reason · the three compliance fields · CNDP declaration · Arabic privacy notice

### R61 — الإدارة is Super Admin only (2026-08-11)
- [x] Section rule, enforced by a test over `section: 'administration'` rather than per module
- [x] `/admin/branches` joins the other three; writes were already Super Admin only
- [x] `GET /admin/branches` stays Admin-readable as a selector feed — verified that groups, scheduling and content depend on it
- [ ] **Open for the Owner:** this is a visibility boundary, not a data one. An Admin can still *see* branch names through selectors. Withholding the data too means re-feeding every branch selector in the back office — a larger decision, not a consequence of this one

### R60 follow-up — the active role drives the interface (2026-08-11)
- [x] `useActiveRole().activeRoles` is what presentation reads; `me.roles` is for the switcher's menu only
- [x] `لوحة التحكم` opens the active role's home — teacher → `/teacher`, admin → `/admin`
- [x] Both portal sidebars, the header (desktop + mobile) and 9 write affordances converted
- [x] The missing `roles.wrongRole*` strings added; the screen kept for deep links only
- [x] **Enforced** by `scripts/ci/check-active-role-presentation.sh` — three forms caught, mutation-proved, wired into CI

### R60 — the Active Role as a security context (2026-08-11)
- [x] `active_role` JWT claim; the token is **already narrowed** when it is present
- [x] `POST /auth/switch-role` — User-locked authoritative Active state and live assignments decide, 403 otherwise, audited; replacement expiry is capped at the presented bearer's verified expiry so switching cannot become refresh
- [x] TD-12 freshness narrows too — the split that would have left high-risk endpoints unrestricted
- [x] Refresh re-asserts, returns the granted role, and fails safe to the most privileged remaining
- [x] `/me` reads live rows so the switcher keeps its menu
- [x] `active_role` on every audit row where a capacity exists
- [x] nginx exception so switching is not rate-limited as a credential surface
- [x] 16 security tests: switching, tampering, revoked roles, concurrent devices, privilege boundaries, branch scope
- [ ] §4.3 Student/Parent now follows the active role — **worth a QA pass with a real dual-role account** once a parent portal exists
- [ ] Audit rows omit the capacity where none exists (login, registration, system-initiated). Stated in R60.8 rather than forced

### Role switching (§2.1) — 2026-08-09
- [x] Active-role context, defaulting to the most privileged role held, persisted and validated against `/me`
- [x] Switching redirects to that role's home; the back office resolves modules from the active role
- [x] A portal the active role does not own renders a named state offering the switch, never a blank page
- [x] A role the person does not hold cannot be selected — the list comes from the server-issued token
- [x] Trash restore, purge and list made TD-12 fresh: a revoked Super Admin loses them at once
- [ ] **Server authority does NOT narrow to the active role** — a Super Admin acting as مؤطِّرة still holds Super Admin authority on every endpoint. Making the server honour the active role is a new normative concept; Owner decision required (draft R60)
- [ ] Roles come from the JWT, so a newly assigned role appears only after re-login. Worth stating on the Users screen

### R59 — deletion authority across the platform (2026-08-09)
- [x] **Permanent delete exists**: `DELETE /admin/trash/{id}`, Super Admin only, one transaction, `trash.permanent_delete` audit row retained indefinitely. Cascade children **declared per type**; anything else refuses with `DEPENDENTS_EXIST` naming the constraint
- [x] Four deliberate deletions now reach the Trash: `Enrollment`, `StudentTeachingGroup`, `LevelSubject`, `SessionContent` — each with a composed label, since a join row has no name
- [x] `HijriMonthStart` gains a deletion (R59.5) — it was the only Super-Admin-creatable entity with none. Last month only, TD-15 versioned
- [x] Exam staff replacement made a **soft** delete + revive, matching `SessionStaff`/`UserBranchRole` — it was hard-deleting rows that carry `deleted_at`
- [x] `Exam` and `HijriMonthStart` join the **restorable** set; restore reinstates declared children
- [x] Server-side authority proven against crafted requests from admin/teacher/student/parent, for read, restore and purge
- [x] Structural guards: every soft-deleting service writes a snapshot; every read of a soft-deletable model filters `deletedAt` — folded into the guard that already existed rather than shipped beside it
- [x] Fixed a silent half-restore: one timestamp per deletion, and the restore keys on the record's own tombstone rather than the Trash entry's
- [x] ~~A branch created after Levels exist cannot be deleted~~ — **closed by R66**: TD-4.6d's backfill and `LAST_GROUP_IN_LEVEL` both retired, so a new branch gets no groups and deletes cleanly. Measured against the running stack with 20 Levels present
- [~] **`content.quarantine-purge` exact-operation worker is built; automatic retention is not** (R59.4) — replacement/deletion quarantine and deliberate R59.1 storage retirement are durable and retryable, while nothing reads `purge_after`. **OWNER DECISION REQUIRED — AUTOMATIC QUARANTINE DESTRUCTION:** switch on a tested 90-day record/object policy, or continue deliberate manual purging
- [x] `User` and `RecurringCourseSchedule` are not row-purgeable — `ACCOUNTABILITY_RECORD` and
  `CASCADE_CHILDREN`. R111 now supplies User de-identification without destroying the tombstone;
  the schedule remains blocked on its materialized history
- [x] **R59 lifecycle closure (2026-09-01):** Subject and Level deletion snapshots now name
  the exact owned `LevelSubject`, `LevelSurah`, and empty `AdministrativeGroup` rows that followed
  the parent; restoration/purge never sweep an earlier independent deletion. `LevelSurah`,
  `QuranProgressLog`, unused `SchedulingType`, and `Partner` have explicit permanent-purge plans, and reviving
  a unique curriculum pair atomically removes its stale Trash entry. The UI filter now names every
  entity that can actually reach Trash. Real PostgreSQL FK/rollback regressions own the proof.
- [ ] **OWNER DECISION REQUIRED — SCHEDULE HISTORY IN TRASH:** keep every deleted
  `RecurringCourseSchedule` indefinitely as `CASCADE_CHILDREN`, or permit permanent purge only when
  it has never materialized a Session (and decide separately whether derived future Session
  tombstones may follow it). Historical/held Sessions and their venue coordinates remain retained.
- [x] **DECIDED AND IMPLEMENTED (Owner, 2026-09-03) — TERMINAL REJECTED FAMILY LINKS.** *(This
  entry was already stale before it was closed: R118.3 supplied a removal transition on
  2026-09-02, and the text above was never updated. R128 supersedes both.)* A rejection is now
  **soft-deleted with its decision** — status, instant, decider, reason, Trash snapshot and a
  `familylink.reject` audit row, atomically — so the live partial unique index releases the pair
  and the same adult may make a **corrected** request, which is a NEW `pending` row with its own
  id. No `rejected → pending` transition exists. Retention is BR-15's ninety days, like every
  other soft-deleted record, so no second window was invented. `DELETE
  /admin/family-links/{id}/rejected`, `familylink.purge_rejected` and `NOT_TERMINAL_REJECTED` are
  **withdrawn**: they existed only because the row stayed live, and two competing deletion
  lifecycles for one entity is how a destructive verb reaches the wrong row. A generic Trash
  restore still cannot resurrect one into live authority (`CASCADE_RELATIONSHIPS`, proved by
  test). `docs/SRS-PROPOSAL-R128.md` is **APPLIED to `SRS.md`** (2026-09-03).
- [ ] **OWNER DECISION REQUIRED — HISTORICAL REFERENCE RETENTION/PRESENTATION:** Branch/Room/
  Level/Subject/Category/AdministrativeGroup rows still referenced by retained schedules or
  Sessions remain FK-protected. Decide whether those tombstones stay visibly non-purgeable in Trash
  or move to a separate archive presentation before changing the historical FK/snapshot model.

### R58 — physical exam scheduling (2026-08-09)
- [x] `Exam.mode` discriminator; `physical` carries date, wall-clock window, branch, room, optional group and supervising staff. Migration + boot-time CHECK ("all four place columns or none", so one legacy row survives without inventing a room)
- [x] `POST/GET/PATCH/DELETE /exams` — TD-15 versioning, TD-5 soft delete with a Trash snapshot, identity fields **refused** on edit rather than dropped
- [x] `عن بُعد` offered disabled with its reason, and refused by the server (`STATE_CONFLICT` / `ONLINE_NOT_AVAILABLE`). **No online endpoint, field or screen exists**
- [x] `kind: 'exam'` in `GET /calendar` — read, not expanded; physical only
- [x] `ExamSection` composed into the unified form; the shell, the recurrence editor, the list and the grid were unchanged — one registry entry, one section, one adapter arm
- [x] `--color-exam` violet on all four surfaces (chip, badge, details, indicator), with weight and words as well as hue
- [x] `SchedulingItem.ids` — the edit form seeds itself from the row it already has, so a re-title cannot silently clear the audience
- [x] 16 HTTP integration tests + the client contract guard; full flow exercised against the real API and database
- [ ] Exams are **not restorable from Trash** (`NOT_YET_SUPPORTED`) — part of the standing restorable-set gap, not specific to R58

### R56 — unified scheduling (2026-08-07)
- [x] One `/admin/schedules` screen replacing `/admin/calendar` and the old schedules page; type is a field, not a destination
- [x] `GET /events` — definitions, so the List view manages rules rather than occurrences
- [x] List view (definitions) + Calendar view (occurrences), one query parameter, no second navigation node
- [x] One `RecurrenceEditor` — the two `weekly` semantics reconciled without a backend change
- [x] `SchedulingForm` shell with composable type sections — **cashed by R58**: Exams became a third section with nothing in the shell moving
- [x] `/admin/schedules/{id}/sessions` unchanged, keeping R50's three scopes
- [ ] **`RoomDto` publishes no `capacity`** — BR-23 makes it informational and enforced nowhere, so the form's capacity hint renders nothing. Publishing it is a small contract change, recorded rather than taken unilaterally
- [x] Sweep `approvals`, `levels` and `users` for hand-rolled filter rows (unchanged from R55) — **verified clean 2026-09-04**: all three use `DataTable`'s toolbar with `SearchInput`/`SelectField`/`BranchSelector` and contain no raw `<select>`/`<input>`. The sweep found a different rule-C drift instead — four hand-written `field field--choice` copies — now owned by `ChoiceField` and guarded (rule AM)
- [ ] **`schedule-sessions.tsx` keeps its own choice markup** — it renders the hint *inside* the label beside a `<strong>`, so converting it moves a hint on a live screen. Needs a browser measurement, not a rewrite; named as the one exception in the rule AM guard

### R55 cross-cutting (2026-08-06)
- [x] **Every selector is dependent** (§14.4, R55) — one module (`hooks/use-scope-options.ts`) owns the graph; screens declare which fields they need and never how they relate
- [x] **`LevelSubject` enforced on all three surfaces** — scheduling did not check at all, and the two that did used different reason codes (`policies/curriculum.ts`, `SUBJECT_NOT_IN_LEVEL`)
- [x] الفئات / المواد split into two §14.1 nodes, one implementation
- [x] Users table: `email` + the Branch scope column §14.2 already required
- [x] Sessions: Arabic weekdays, `anchor_date` and `effective_until` in the shared recurrence editor, one primary teacher + assistants
- [ ] **Backfill the curriculum data — now blocking class scheduling too, not just uploads.** `level_subject` is empty on the live database, so no Level teaches anything and no content can be attached anywhere. Assign subjects per Level from *المستويات ← مواد المستوى* — a data task, not a code one, and the reason the upload appeared broken
- [x] الأنشطة / الحصص parity — one `FormDialog`, one `ListDialog`, one action placement, one notice style; pinned structurally by `scheduling-parity.test.tsx`
  - ✓ **The table's CONTENT was the last difference**, not its wrapper: `CourseScheduleDto` published five ids and no labels, so the timetable led with a clock time and printed a raw UUID for the room. The DTO now resolves `subject_name`, `target_name`, `branch_name`, `room_name` — `libraryItemDto`'s precedent
  - ✓ `MaterializationDialog` was the last bare `<Dialog>`, and printed R43.6 codes untranslated
  - ✓ **The guard now asserts ABSENCE, not just presence** — a page can use the shared components and keep custom UI beside them, and one did for a whole revision. Mutation-proved
- [x] مواد المستوى made findable — the screen existed; the count column is now the link to it
- [x] **Sweep for raw `<select>`/`<label>` pairs — COMPLETE.** Verified 2026-09-04: `approvals.tsx`, `levels.tsx` and `users.tsx` contain **no raw `<select>`** and all three import `SelectField`. The line was stale, not outstanding.

## M6 — Content, Consent & Storage
- [x] Upload initiate/complete/abort: single-shot presigned PUT, branch-scope validation, Teacher Global rejection (§4.9, TD-3.5)
  - ✓ `upload_id` is a **signed ticket, not a table** — §7 defines no pending-upload entity, so `upload.gc` reaps objects no content row claims rather than reconciling a table against a bucket. The ticket binds every phase-one authorization decision so `/complete` cannot restate them
  - ✓ Teacher branch scope resolves through `CourseScheduleStaff` (§4.4c), never the role assignment
  - ✓ **Replace and delete** shipped with it (R53): replacement extends `/uploads/initiate` via `replaces_content_id`; `DELETE /content/{id}` soft-deletes, snapshots and quarantines
  - ✓ **B-02 visibility/storage invariant:** `EducationalContent.visibility` is authoritative; creation derives its bucket, replacement inherits the existing row's tier, and completion rejects/discards a contradictory or pre-fix ticket before changing storage coordinates. Real PostgreSQL/MinIO coverage asserts database rows, both buckets, anonymous/public bytes, signed private reads, unrelated content and `SessionContent` links
  - ✓ **B-03 immutable finalization (R103):** the presigned PUT targets `staging/content/...`; one full stable source read validates magic/length and hashes the exact accepted bytes into private server staging, then a re-hashed server-controlled PUT creates the 32-hex SHA-256-based canonical key. MD5 ETag is only an optional race optimization, never identity. Transactional audit publication, same-ticket convergence across different stable snapshots, replacement compare-and-swap, idempotent retry/restart and retained-PUT isolation are proven against real PostgreSQL/MinIO; unsafe legacy replacements without `replaces_version` fail closed and must be re-initiated. `upload.gc` remains the separate abandoned-object collector
  - ⚠ **Video is refused**, per TD-9's whitelist and §4.9 Revision 12. The Owner's brief asked for video support; widening the list is an SRS revision, not an implementation choice
- [x] Authoritative per-user upload quota 30/hour in PostgreSQL (`RateLimitCounter`), locked + incremented in the initiate transaction (TD-4.12, TD-15.2); `429 RATE_LIMITED` envelope; never in-process memory, never pg-boss, never njs (§3.1 Revision 14)
- [x] Magic-byte validation at /complete via ranged GET (bytes 0–511) to MinIO + HEAD size check; reject-and-delete (§4.9, TD-9)
- [x] Hash-segmented immutable canonical keys; clients write staging only, completion canonicalizes one fully read SHA-256-verified byte stream, and replacement mints a new key + quarantines old (TD-9, R103)
- [x] FileUploader: progress, failure, clean retry (R-9) (§14.3) — `XMLHttpRequest` for the PUT, because `fetch` cannot report upload progress
- [~] Phone-recording upload guidance panel on /teacher/content (§4.9) — **panel shipped**; cross-browser playback E2E for TD-9 containers (§14.7) still to run
- [x] **Visibility transitions + bucket-migrate job + `/content-unavailable` — COMPLETE.**
      Verified 2026-09-04: the consent-forced worker and the Nginx fail-closed gate
      were already done, and **both items listed as remaining are built**.
      *General visibility editing* — `VisibilityField` on the content edit dialog,
      `PATCH /content/{id}` accepting `visibility`, and a transition that **copies
      to the target bucket, verifies size and SHA-256, commits under an optimistic
      version guard and only then retires the old key**; a failed copy is discarded
      and the original left alone. *The stale-link page* — `/content-unavailable`
      is routed in `route.ts` and rendered in `main.tsx`.
- [x] Consent re-evaluation engine wired to enrollment/Teaching Group membership, consent, R92 audience changes, retained Sessions after schedule deletion, recording upload/import/replacement and Session-content links; bounded startup sweep; monotonic `consent_forced_private`; **empty resolved audience disengages the gate** (§4.1a, §4.9, BR-2 as restated by R43)
- [ ] Admin-only consent-gate override with mandatory justification + audit (BR-3, TD-8)
- [x] Presigned GET mint with full permission + child-context check, 10 min TTL (TD-12)
- [~] Resources directory nesting: Category→Level→Year(current pinned)→Branch(Global top)→Subject (§5.2)
  - ✓ **Frontend complete against a MOCK adapter** — `/resources` with both §5.2 views: the level index grouped by category (الكبار → اليافعون → الطفل, fixed editorial order, unknown categories sorted last rather than dropped) and one level's contents grouped **academic year (newest first) → branch**. Level cards carry name, optional description and both counts, with correct Arabic plural agreement; levels with no content never appear
  - ✓ **Content cards** — title, type in words *and* icon, publication date, file size in Arabic units, teacher display name rendered **verbatim** (§20 rule 21 — the type carries no other name field), optional description clamped to two lines, optional subject badge. A field the backend did not send is **absent, not blank**
  - ✓ **Preview architecture built** — one viewer implementing the whole §14.6 table: PDF in an `<iframe>`, native `<video>`/`<audio controls>`, full-width image, **office documents download-only**. Native elements rather than a player library (the CSP admits no external script host). The URL is minted **when the dialog opens**, never with the list, because a 10-minute presigned GET attached to every card would expire before most were clicked
  - ✓ **Filters** — year, branch (with بدون فرع as a real choice), type, and title search folding Arabic variants as TD-10 does. Every option derives from content actually present, so no control can offer a combination that yields nothing. Groups a filter empties are **dropped**, not rendered as bare headings
  - ✓ **All §14.4 states** — skeletons shaped like the cards they replace, empty, error, and **no-results distinct from empty** with a clear-filters action. RTL throughout, responsive, tested at 360 px
  - ✓ **Reuses the existing design language** — `.cal-toolbar`/`.cal-filter` for the filter row (one filter appearance platform-wide), `Container`, `Dialog`, `Icon`, and the shared `states.tsx`. No second design language; file-type icons joined the one shared icon set
  - ✓ **Two views on one navigation node** — §14.1 lists exactly one resources node, so the drill-down is `?level=` rather than an invented path segment (§20 rule 16). Documented as the pattern for every future drill-down screen
  - ✓ Tests — 19 new (91 frontend total): the link-not-button distinction, plural agreement, verbatim display name, absent-vs-blank fields, each filter, group-dropping, Arabic search folding, and that a download-only kind renders **no** media element
  - ⚠ **BLOCKED on backend, Phase 2 reported separately:** no content listing endpoint exists **or is specified anywhere in the SRS**; `EducationalContent` has **no uploader field**, so the teacher name has no source; `GET /content/{id}/download-url` is specified but unimplemented. Two §5.2 divergences also need settling — the **Subject** tier (rendered as a card badge) and **`is_current` pinned** vs strict newest-first
- [x] Wire the library to real endpoints once the revision lands (delete the mock; the interface does not change)
  - ✓ **Preview and download now mint through `GET /content/{id}/download-url`** — `fetchContentUrl` was a stub returning `null` since the library shipped. Credentials travel as **props, not context**, because the same dialog serves the public library where both are legitimately absent
  - ⚠ Still open from the original investigation: **`EducationalContent` has no uploader field**, so the teacher display name on a card has no source (a §7 change plus a migration), and the two §5.2 divergences — the Subject tier and `is_current` pinning — remain for the Owner
  - ⚠ **Investigated 2026-07-30 and reported, not built.** Four hard blockers, all needing a Document Owner decision:
    **(1) No content LISTING endpoint exists or is documented anywhere in the SRS.** TD-3.5 defines only `POST /uploads/initiate|/complete|/abort` and `GET /content/{id}/download-url`; there is no `GET` route that lists content. Building one is inventing an endpoint (§20 rule 16) and needs a revision (Revision 21: later milestones add endpoints through subsequent revisions).
    **(2) `EducationalContent` has no uploader field**, so the requested *teacher display name* has no source. §7's field list does not define one either — this is a §7 change plus a forward-only migration.
    **(3) The presigned GET mint is unimplemented** (PENDING, M6), so private content cannot be previewed or downloaded at all.
    **(4) No content rows exist** and `/uploads/*` is unbuilt, so there is nothing to display.
  - ⚠ Three points where the requested design and §5.2 differ, for the Owner to settle: §5.2 mandates a **Subject** tier and a **"Global / بدون فرع"** container at the top of the branch tier (the brief omits both), and pins the **current** academic year at top (the brief asks strict newest→oldest).
  - ✓ **Previews need no architectural change** — §14.6 already specifies them (PDF inline, `<audio>`, image lightbox, office download-only) and public content sits behind stable same-origin URLs the CSP already allows. The one open question is that private content is served via 10-minute presigned URLs, so a long video can expire mid-playback.
- [~] storage lifecycle jobs (TD-7): `upload.gc` is complete as a daily bounded 250-object
  continuation chain over public/private browser staging and private server-finalization,
  with strict `LastModified < 48 h` deletion. `content.quarantine-purge` is registered and
  healthy for transactionally committed exact old-key quarantine transitions and deliberate
  R59.1 permanent-delete retirement; storage failure retries and a missing queue rolls the
  database purge back. **OWNER DECISION REQUIRED — AUTOMATIC QUARANTINE DESTRUCTION:** no
  handler reads `purge_after` and no age-based destruction is scheduled until the Owner
  authorises it after the object-store/backup decisions and Production-scale restore drill
- [ ] §18 Content, Consent & Storage checklist green

## M7 — Hardening & Launch Data
- [x] **Hosted real-stack integration gate** — every push/PR now builds a uniquely named
  disposable PostgreSQL/MinIO/pg-boss/Nginx stack, deploys every migration, runs the actual
  Production and fixture seeds, waits for whole-application health, and executes the complete
  integration/API suite through the same all-table logical-isolation runner used locally.
  Release publication depends on this fifth verification job. The first run passed **1887**
  active assertions but correctly failed on a leaked normalized-email lock and an inexact
  scheduling-order restore; both fixtures now clean only their exact owned coordinates, and
  focused disposable reruns are isolation-clean. The final complete disposable rerun passed
  **1887/1887 active assertions** with an identical all-table logical snapshot. Hosted CI then
  exposed a pre-existing clean-checkout mismatch: the syntax-aware no-PII guard needs the
  TypeScript compiler but had been placed in the dependency-free job. It now runs after the
  backend's locked install, with a portability guard pinning that exact boundary.
  The corrected hosted run `33246930840` then passed guards, contract, backend, frontend and
  the full disposable integration job, and published both exact-commit images for
  `9e0b303c27e77ec731e3afee936dcb31cd165504`.
- [x] **GitHub Actions Node 24 runtime majors.**
  The Document Owner approved the bounded
  tooling upgrade on 2026-08-30. Every checkout and setup-node invocation now uses the
  maintained v7 line, whose official metadata declares `node24`; the workflow retains its
  explicit Node-version file and npm-cache inputs. The portability guard rejects a regression
  to an unapproved runtime major, so GitHub's compatibility override is no longer relied on.
  Hosted run `33287083470` passed all six verification jobs under v7 and published both
  exact-commit images for `09ecd09b83d52b2159ab21c3b022d22577167b22`.
- [x] **Fail-closed deployment readiness** — the API container healthcheck exercises the real
  DB/storage/queue/worker `/healthz` contract, and deployment verification treats every 503 as
  command failure with a bounded timeout; a running Node process is not called ready. A separate
  isolated Production-mode drill now applies all migrations, executes and byte-compares the real
  seed twice, proves the clean initial inventory and internal MinIO policies, loads the actual TLS
  Nginx edge, drives the built login/public routes in a real anonymous Chrome session without
  fixture authentication, then stops MinIO and requires HTTPS `503` plus Docker `unhealthy` before
  recovery. The drill is now a sixth hosted verification job and release publication waits for it.
  This closes the repository-side bootstrap evidence, not the still-open real-VPS certificate,
  authenticated Staging, resource-budget, backup/restore and rollback rehearsal.
- [x] **Bounded graceful API shutdown** — SIGTERM now closes HTTP and stops pg-boss polling
  concurrently; active handlers have 105 seconds to finish or return durably to retry, inside a
  two-minute Docker grace period. The Production drill asserts the resolved Compose value, and
  focused tests prove readiness becomes `stopping` before the worker drain completes.
- [x] **Disposable restart and persistent-recreation proof** — the Production-mode drill now
  proves a job inserted with the worker stopped drains after start, a real active handler finishes
  across SIGTERM, PostgreSQL and Nginx recover independently, a full stack stop/start retains state,
  and all long-running containers can be force-recreated over the exact database/object volumes.
  Seed rows, migration history, private object bytes, durable job states and the non-seeding API
  startup command are rechecked. Both candidate images now carry repository HEAD and every running
  API/Nginx container is pinned to its exact image ID. The same drill creates an encrypted recovery
  point from the Production-mode graph, writes later database/object state, destroys both volumes,
  restores the earlier point into empty replacements and requires exact-release health plus the
  pre-change values without implicit migration/seeding. Real-host pressure, selected Moroccan
  storage/backup targets and realistic-volume RTO remain open.
- [x] **Executable clean-VPS preflight** — the deployment now stops before runtime mutation unless
  the target is a supported Ubuntu LTS/AMD64 host with local boot-enabled Docker, Compose ≥2.24.4,
  NTP, persistent/adequately sized Docker storage, an exact detached clean checkout, private
  secret files, exact IPv4/no-AAAA DNS, valid same-origin configuration, the audited service/
  port/volume/log/restart graph and both exact GHCR manifests. The disk floor remains an explicit
  Owner capacity input rather than an invented default; passing is readiness, never a deployment
  or backup claim. A real Staging run found that unprivileged `sshd -T` cannot read correctly
  root-only host material; preflight now uses a pinned non-interactive root inspection command
  instead of weakening SSH file permissions. The same run proved both exact GHCR packages are
  publicly readable and found no Docker credential file; the gate now accepts that legitimate
  state while still protecting any installed credential and requiring both exact manifests.
- [~] **Production provider/capacity decision packet** — one authoritative
  [quotation evidence matrix](operations/provider-acceptance.md) now covers Morocco-only primary
  and secondary residency, compute/memory growth, ~200-GB NVMe, access/network/recovery, offsite
  backup failure domain, maintained S3 compatibility and administration, platform restrictions,
  costs and exit terms. Engineering recommends a **50 GiB deployment floor**, **60 GiB warning**
  and **50 GiB critical state** for the planned disk; this reserves rollback/restore and runtime
  headroom but does not prove the disk is large enough. **OWNER INPUT REQUIRED:** supply the SRS
  recording/week and average-size budget, approve or replace the thresholds, and select a provider
  only from actual written quotation/residency evidence.
- [x] **Bounded Production container logs** — every base-Compose service uses one shared
  Docker `local` policy (10 MB × 5), retaining `docker compose logs` without allowing the
  engine's unrotated `json-file` default to exhaust the single VPS disk. A CI guard counts
  services and fails if any new or existing service omits the policy.
- [x] **Production configuration boundary** — the Production overlay structurally forces
  `NODE_ENV=production` while Staging structurally remains fixture-permitting; boot rejects
  non-canonical/cross-origin storage routing, non-HTTPS external origins, and reuse of one
  signing key for access and onboarding tokens. The checked-in Development default can no
  longer silently become the Production runtime tier; its `NODE_ENV` guidance enumerates all
  three TD-13 values and explicitly preserves Revision 104's uniform error boundary. The
  older fresh-Production-seed harness was found still exporting direct MinIO as the public
  storage origin; the real validator correctly refused it after all migrations. Its browser
  coordinate now uses the mandatory same-origin `/storage` path and the complete disposable
  seed/authorization/scenario drill passes again.
- [x] **Exact-commit release artifacts** — after all six verification jobs pass on a
  `develop` push, CI publishes API and environment-independent web images to GHCR under the
  immutable 40-character commit tag and revision label. Staging/Production select both
  through `docker-compose.release.yml` plus exactly one explicit tier overlay; a missing
  tag/image stops the run and documented deployment uses `--no-build`. This closes the
  repository-side artifact gap, not the open
  host/access, object-store, backup, or clean-host rehearsal blockers in the
  [readiness ledger](operations/deployment-readiness.md).
- [~] **P0.1 object-store security** — the affected final MinIO OSS pin is launch-blocking;
  Nginx now applies the vendor-advised unsigned-trailer defence at every storage proxy path
  without weakening valid presigned GET/PUT. Application readiness is now provider-independent:
  it performs authenticated S3 `HeadBucket` against public, private and recording staging with
  the same credentials used by real work, and fails if any required bucket/authority is absent.
  The replacement contract also requires versioning disabled and refuses unapproved lifecycle
  or Object Lock behavior because exact-key deletion carries no storage version ID. The Compose
  image, initializer, container probe and raw-volume backup remain vendor integration points.
  **OWNER DECISION REQUIRED — OBJECT STORE:** select
  and fund a maintained patched replacement, then run the full compatibility/safeguarding/
  retention/backup regression listed in [Storage](architecture/storage.md#owner-decision-required--object-store)
- [ ] **DOCUMENT OWNER ACTION REQUIRED — OPERATIONAL ALERT SURFACE.** TD-14/TD-16 require
  terminal job failures, queue lag, backup failure and TLS expiry to surface on the Admin
  dashboard. The implementation has no such read, TD-3 names no route, and R77–R93 deliberately
  constrain `Notification` to targeted Session/Event/Exam facts. Define the smallest route/DTO
  and whether this is a new entity or a derived projection; do not overload personal inboxes or
  invent an undocumented endpoint. Until then failed jobs are durable and runbook-visible only.
- [ ] TD-11a targets measured against ceiling-scale fixtures (§2.4); no N+1 / unbounded scans audit
- [ ] Arabic RTL pass: complete ar catalog, error message_keys (fr/en post-MVP §10.1)
- [ ] Nginx rate limits verified live (TD-13); presigned-URL permission audit
- [ ] Locked CLI restore script (`npm run db:restore`) wrapping restore + cascades + audit in one transaction; executed once on fixtures (§4.10, TD-8)
- [~] backup + restore — pinned encrypted restic recovery-point creation, empty-target restore,
  portable `pg_dump`, raw data/TLS/config volumes, fail-safe exact-container restart and destructive
  disposable drill are complete (under one minute, raw DB + actual clean-database `pg_restore` +
  object + config recovered). Repository authority is checked before writers stop, and a wrong
  credential is proven visible without stopping/recreating the running services. The complete
  Production-mode graph additionally becomes healthy after an empty-volume recovery and proves
  that later DB/object state is rolled back under the exact source-labelled image IDs. **OWNER DECISION
  REQUIRED — BACKUP TARGET AND RETENTION:** provision the second Moroccan SFTP location,
  escrow keys/password, and set retention. Still release-blocking: `backup.replicate` nightly
  pg-boss automation (an unmonitored cron substitute is explicitly not implemented), critical
  alert/staleness visibility, object-volume adaptation after the
  P0.1 vendor decision, and realistic Production-host RTO drill
- [~] **P0.3 permanent purge and staging lifecycle** — independently solvable safety work is
  complete: exact replacement/deletion obligations are transactionally durable; manual content
  purge cannot erase its last storage coordinates; retry after ambiguous delete is idempotent;
  old-key work cannot touch a newer canonical key; and bounded `upload.gc` covers every browser
  and server-finalization staging scope but not R100 provider staging. A disposable real
  PostgreSQL/MinIO/pg-boss drill passes. **OWNER DECISION REQUIRED — AUTOMATIC QUARANTINE
  DESTRUCTION:** select/approve the automatic 90-day record/object policy before scheduling any
  `purge_after` scan
- [ ] **DOCUMENT OWNER ACTION REQUIRED — R111 account-purge reconciliation.** The ratified
  R111 design and shipped UI promise automatic de-identification after the account's three-day
  restoration window, but the authoritative SRS still says account deletion is unapproved in
  §5.2/§14.1, excludes User from the complete restorable set in §0/§4.10, lists neither
  `DELETE /profile` nor `DELETE /admin/users/{id}` in TD-3, and has no account-purge job in
  TD-7. The routes are present only in the derived `td3-routes.txt`, so the
  conformance guard cannot detect this drift. Reconcile those clauses and define the job name,
  payload, trigger and singleton rule; until then manual `?permanent=true` is complete, while an
  untouched soft-deleted account remains identifiable past `purge_after`. Do not invent the
  missing TD-7 row in implementation.
- [x] **R131 POLICY RATIFIED (Owner, 2026-09-03) — deletion and retention.**
      *(Policy and architecture only; nothing is implemented and no behaviour
      changed.)* Ten-year retention of identifiable educational history after
      the **derived** last educational activity — the association's own
      purpose-based policy, **never described as CNDP-prescribed**. Two distinct
      requests: **Option A** account closure keeping the minimal educational
      archive, and **Option B** full educational deletion, **Super Admin only**,
      a request rather than a cascade, with the attestation warning stated
      before confirmation and no preselected destructive option. For a minor the
      request comes from a live approved guardian and still needs Super Admin
      review; a self-managed adult exercises her own rights and a historical
      link makes nobody her owner. Rejected and never-admitted applications:
      **twelve months maximum**. The **R111 ↔ R122 contradiction is resolved** —
      `referenceCode` survives Option A as protected pseudonymous data and is
      deleted by Option B, never a back door into deleted history.
      `docs/SRS-PROPOSAL-R131.md` and
      [personal-data-map](development/personal-data-map.md).
      - [ ] **IMPLEMENTATION BLOCKED BY DESIGN until the seven reconciliations in
            the data map are closed** — `ChildApplication`'s copied identity
            fields (now including R130's birth date), Trash snapshots, audit
            detail, consent evidence, `NormalizedEmailLock`, backups, and the
            12-month application purge that touches the same rows. **A partial
            purge that claims data is gone while obvious copies remain is worse
            than none.** No purge job is to be written before then.
      - [x] **DONE (2026-09-04) — Option A now keeps `referenceCode`.**
            `deIdentifyAccount` no longer clears it, and `hadIdentitySurface`
            stopped counting it in the same change: leaving it in that predicate
            while the field is deliberately kept would have made an idempotent
            job rotate `qr_ref` and write a second audit row on every retry.
            Preserving it opens no way back in — the one surface that takes a
            code resolves `WHERE deleted_at IS NULL` and a closed account is
            soft-deleted — and it is never reissued, because
            `allocateReferenceCode` counts rows regardless of `deleted_at`.
            13 focused tests; proved against the defect. **Option B remains
            unimplemented and the rest of the R131 map is untouched.**
      - [x] **DONE (Owner, 2026-09-04) — self-managed authority is DURABLE.** R132 read
      it as *an account with no active login identity*; Option A deletes
      `UserIdentity`, so that reading broke the moment closure shipped — and held
      only because the resolver separately requires a live student. Authority is
      now derived from the **approved `SelfManagedClaim`**, which survives
      identity removal, logout, closure and re-binding. `DOB ≥ 18` is eligibility
      only; a credential is a mechanism only. Three paths corrected, including
      the **linking write**, where a closed self-managed adult would otherwise
      have been accepted as a linkable child and a guardian handed authority over
      an adult who had taken it away (`ACCOUNT_SELF_MANAGED`). One additive
      index; no column, backfill or fabricated status. 11 policy tests + 126
      across the affected suites; proved against the defect.
- [x] **DONE (2026-09-04) — Option B REQUEST/REVIEW control plane.**
      `FullDeletionRequest` + four routes. A person may always ask about herself;
      an adult may ask for a minor only while holding a **live approved
      `FamilyLink`**; **a former guardian of a self-managed adult has no basis** —
      a rule only expressible because authority is now the durable approved
      claim. Refusals about somebody else are uniform. **Approval records a
      decision and DELETES NOTHING** (`executed: false` on the wire and in the
      audit). Refusal follows R128's shape. 14 tests; the queue and the audit
      carry no educational fact.
- [ ] **BLOCKED — Option B DESTRUCTIVE EXECUTION.** The control plane is built
      and an approved request is a decision waiting to be carried out. Execution
      needs every classification in §4.10a's map settled, and at least these are
      not: **(a)** the birth date (below); **(b)**
      `notification.subject_user_id`, which §4.10a marks provisional — a
      notification in *another person's* inbox whose subject is the deleted
      person must be de-identified rather than destroyed, and exactly what to
      rewrite in its rendered content is undecided; **(c)** `ChildApplication`'s
      copied identity fields, whose own 12-month rule has no settled reference
      point; **(d)** Trash snapshots of rows that will be deleted; **(e)**
      consent evidence, which §4.10a keeps under its own rule while forbidding
      audit from becoming a hiding place — the boundary between the two is not
      drawn. **A partial purge that claims completion is worse than none**, so
      execution stays unimplemented rather than partially correct.
- [x] **DONE (2026-09-04) — the guardian-only cleanup GUARD.** R131's §4.3
      clause was ratified but had **not been carried into `SRS.md`** by the
      reconciliation pass; it is there now. `policies/guardian-purpose.ts`
      answers *does this account still have a purpose?* across all seven §4.3
      conditions plus two the platform gained since (a self-managed adult is
      never a guardian-only account; an undecided full-deletion request preserves
      both parties). The predicate is **inclusive by design**: a missed purpose
      closes an account that should have lived, while a spurious one merely
      leaves one alive. 11 tests, including §4.3's named case of a rejected link
      beside a pending application.
- [x] **RESOLVED AND BUILT (Owner, 2026-09-04) — guardian-only closure is an
      EXPLICIT SUPER ADMIN ACTION.** The three candidate triggers — revoking the
      last approved link, purging it from Trash, fully deleting the last child —
      are **none of them**. Closing an account is severe and irreversible in
      practice, and attaching it to whichever operation somebody happened to pick
      would be inventing policy. `POST /admin/users/{id}/close-guardian-only`,
      Super Admin only, refuses with `ACCOUNT_HAS_PURPOSE` while any reason to
      exist remains, and **names the purposes on `blocked_by`** so the refusal
      says what to resolve first. **Not a second closure path**: it is the
      ordinary soft delete plus de-identification with one extra refusal, and the
      guard runs **under the deletion's own row lock** so a purpose created
      concurrently cannot slip between the check and the act. No scheduling, no
      grace period beyond the existing three-day window, and no child record is
      touched — purposes are read, never removed to qualify.
      Proved in a browser (`verify-guardian-cleanup.sh`, 19/19) with the database
      asserted afterwards: the spent guardian closed, the guarded one untouched,
      the child intact.
- [x] **DONE (2026-09-04) — the ten-year retention COMPUTATION and dry run.**
      `educational-retention.service.ts` derives the boundary from §4.10a's five
      canonical facts, names which one decided it, and **deletes nothing**. No
      history yields `null` rather than "elapsed"; soft-deleted rows still count
      as history; a grade's date is the sitting's. 13 tests including the exact
      boundary and an `updated_at` control. **Destructive purge remains gated on
      the same open classifications as Option B execution.**
- [x] **DONE (2026-09-04) — the 12-month REJECTED-application eligibility.**
      `application-retention.service.ts` reports rejected child applications past
      twelve months from `decided_at`, the one reference point §4.10a makes
      precise. **A dry run: it deletes nothing**, and the rows it names still
      carry the child's copied identity fields — which is exactly why execution
      waits. 6 tests including the exact boundary.
- [x] **RESOLVED AND ENFORCED (Owner, 2026-09-04) — the PENDING-application
      reference point is `created_at`.** Twelve months from when she asked, and
      **deliberately not `updated_at`**: an administrator opening a record would
      otherwise postpone its expiry, which is a retention clock nobody controls.
      Rejected applications keep `decided_at`. Both clocks now EXECUTE —
      `purgeElapsedApplications`, scheduled daily beside the other purges — and
      execution deletes the whole row rather than stripping it: a husk with every
      identifying column nulled and a `consent_text_version` recording consent
      for a child who never existed is an evidence shape with nothing left to
      evidence. **The Trash snapshot goes in the same transaction**, or the
      erasure is cosmetic. There is no renewal lifecycle; a family who still
      wants a place submits a fresh application.
- [ ] **BLOCKED ON SCHEMA — rejected-registration retention (12 months).** The
      Owner has decided the policy: a `User` with `account_status = 'rejected'`
      is retained for a maximum of twelve months after rejection. **It cannot be
      implemented as specified, because `User` carries no rejection timestamp.**
      The decision writes `account_status` and nothing else
      (`approval.service.ts`); `updated_at` is bumped by any later edit and is
      therefore not the rejection instant, and the Owner's own instruction
      forbids silently substituting it.
      **THE SMALLEST CORRECTION:** one nullable column,
      `user.account_status_decided_at` (`timestamptz`), written in the same
      transaction as the status change, never cleared, plus a backfill decision
      for the rows that already carry `rejected` — and **backfilling from
      `updated_at` is the one thing it must not do**, since that would fabricate
      a rejection date. Leaving those rows `NULL` and excluding them from the
      clock is honest; deciding between that and an Owner-supplied cutoff is the
      remaining call. `AuditLog` is not the answer: `user.reject` rows are purged
      on their own schedule, so a retention clock reading them would silently
      stop working.
- [x] **RESOLVED BY AUDIT, not by decision (2026-09-04) — `notification.subject_user_id`.**
      §4.10a kept it PRESERVE provisionally and warned that a surviving
      notification must not become a covert store of deleted data. **In this
      schema it cannot**: a `Notification` stores a type enum and foreign keys and
      **no text at all**, and the title is composed at read time from the subject
      relation — so de-identifying a person de-identifies every notification about
      her automatically. The provisional classification is therefore safe as a
      **consequence of the schema**, not as a policy guess, and no Owner decision
      is needed. **The conclusion depends on that shape**, so a guard asserts the
      table has no free-text column and says in its failure message to reopen the
      classification if one appears.
- [x] **DECIDED AND IMPLEMENTED — the birth date's Option A classification.**
      *(Owner decision 2026-09-04.)* **The birth date is ACCOUNT data and Option
      A clears it.** The audit that preceded the decision had already established
      the engineering half — no retained educational record reads a birth date,
      nothing else depends on it, and nothing exposes it after closure — leaving
      only the policy question of whether a future attestation must name one.
      The Owner's answer: it need not, because `reference_code` is already the
      protected pseudonymous locator that reconnects a returning person with her
      history, so a birth date adds nothing the archive needs while being one of
      the most identifying fields the row holds.
      **Removed, never transformed** — no year-only truncation and no age
      snapshot, each of which would invent a new fact at the moment of erasure.
      `sex` still survives, and the asymmetry is the test this list applies:
      §4.4b evaluates Level restrictions against it, so a preserved enrolment
      stops making sense without it, while nothing reads a date of birth.
      Audit names the field and never the value.
      - [ ] **OPEN — the return/reactivation workflow.** *(Audited 2026-09-04;
            deliberately NOT implemented.)* The **identity-proofing** half needs
            nothing new: R132's approved model — the claimant names the archived
            record, proves control of a Google identity through the existing
            OAuth+PKCE flow, and a Super Admin performs the association-side
            match — transfers directly, and its enumeration-resistance,
            replay-protection and no-duplicate-User guarantees come with it.
            **What is NOT settled is whether a de-identified row may be
            reactivated at all, and where the restored identity would come
            from.** De-identification sets `name_arabic` to «حساب محذوف», nulls
            every name part, and **deletes the User's Trash snapshot in the same
            transaction** — deliberately, so the erased name does not live on in
            JSONB. **Nothing in the platform holds her name afterwards.** So
            reactivation cannot *restore* an identity; it can only *acquire* a
            new one from the person or an administrator, and re-attach it to a
            record the association deliberately stripped. That is new product
            behaviour, not an application of an approved rule.
            **THE PRECISE DECISIONS NEEDED:** *(1) may a de-identified account be
            reopened at all, or is a return a fresh registration that an
            administrator links to the retained archive?* *(2) if reopened, who
            supplies the identity it lost, and what makes that supply
            trustworthy?* Until both are answered, **no reactivation path
            exists** — and the current state is safe by construction: a closed
            account is soft-deleted, the claim lookup excludes it, and the
            reference code authenticates nobody.
      - [ ] **SUPERSEDED by the entry above — what happens when a former
            beneficiary legitimately returns.** Option A keeps the reference code so her archive can be
            found, but **no return workflow exists and none was created**: the
            code authenticates nobody, a closed account cannot be claimed
            (`deleted_at` excludes it), and there is no path from knowing a code
            to an account. Whether a return is a fresh registration matched by
            an administrator, or something else, is an Owner decision.
      - [ ] **LEGAL WORDING PENDING, NOT DRAFTED AUTONOMOUSLY.** The active
            `LegalConsentText` is **untouched**. R131 requires the privacy notice
            to state: the ten-year educational retention and its purposes; that
            it is the association's own policy and not a CNDP-prescribed
            duration; the Option A / Option B distinction; that the archive is
            pseudonymous rather than anonymous; that Option B may end the
            association's ability to issue an attestation; and that backups
            expire rather than being erased on request. Drafting, review and
            activation belong to the Document Owner.
      - [x] **DESIGNED (2026-09-04) — restore suppression, and most of it already
            exists.** A restore undoes any deletion applied after its restore
            point, silently. The minimum mechanism is a durable ledger of
            deletions carrying **no deleted content** — and the platform already
            keeps one: `AuditLog`'s `user.deidentify` (target id and the **field
            names** cleared, never their values), `familylink.reject`/`.revoke`,
            and an approved `FullDeletionRequest`. Each names which row and when,
            none holds the erased data, and audit rows outlive their subject on
            their own retention clock. The replay procedure is written down in
            [personal-data-map](development/personal-data-map.md);
            `deIdentifyAccount` is already idempotent, so re-applying a deletion
            that survived the restore is harmless.
      - [ ] **REMAINING (operational, small).** Make the replay a step in the
            restore runbook rather than something somebody remembers, and add a
            check that it ran. **No provider-specific backup pruning is designed
            or deployed**, and none should be until hosting is settled.
- [x] **DIRECTION SETTLED (Owner, 2026-09-03) — the normalized-email lock is to be
  keyed, not raw.** The design is ratified and complete in
  [email-lock-keying](development/email-lock-keying.md):
  `HMAC-SHA-256(EMAIL_LOCK_KEY, "bodour.email-lock.v1|" + normalized)` as the primary
  key — **HMAC and not bare SHA-256**, because the space of real addresses is
  enumerable and an unkeyed digest is the address in a thin disguise. Rotation and
  secret loss are both *truncate and continue*: a lock row carries no ownership and no
  history, so nothing is lost, and there is deliberately **no dual-key lookup** (a
  digest is a lookup key, and recomputing one needs the plaintext this design stops
  storing). The migration is forward-only and truncates rather than backfilling, for
  the same reason. `deIdentifyAccount` still must **not** delete lock rows.
  - [ ] **BLOCKED ON ONE OPERATIONAL PRECONDITION — the secret must exist before the
        code does.** `EMAIL_LOCK_KEY` joins `REQUIRED_ENV_VARS`, and a missing required
        variable **throws at boot** by design (TD-13 gives secrets no defaults), so
        shipping first would break the next Staging deploy — a mutation this work is
        not authorised to make, with a secret it must not invent. **Making the variable
        optional is the one worse option**: a raw-email fallback produces two key spaces
        and breaks the invariant in whichever environment fell back. **Order: generate
        and install `EMAIL_LOCK_KEY` in Localhost and Staging, then implement.**
        Everything else is ready and testable in one pass.
- [x] **TEST ISOLATION (2026-09-03) — the refresh-token suite destroyed audit rows it did not
  own.** Its cleanup deleted `auditLog` where `{ targetEntity: 'User', actorUserId: null }`
  **with no ownership term at all**, so every run swept every system-written User audit row in
  the database, whoever wrote it and whenever — caught by the all-table guard as `audit_log`
  losing two pre-existing rows across a full run. System rows carry a null actor and cannot be
  found through the tagged actor the rest of the cleanup uses, so they are now scoped by
  **target**, resolved from the suite's own users first — the shape the P1.2 fix below used for
  staffing. **Proved against the defect**: an unowned probe row survives the fixed cleanup
  (1 → 1) and is destroyed by the old predicate (1 → 0).
- [x] **P1.2 TEST ISOLATION — the integration sweep now leaves shared Local Development state
  unchanged.** The staffing loss reproduced in `branch.integration.test.ts` alone: its first
  `beforeEach` cleared with `userId: actorUserId ?? undefined` before the id existed, and Prisma
  omitted the undefined predicate, deleting all staffing. Cleanup now resolves suite-tagged user
  ids first; the shared teaching helper rejects unsafe ownership tags before querying.

  **The durable guard is broader than the incident.** `scripts/dev/test-integration.sh` compares
  privacy-safe logical hashes for every application base table before and after the sweep, while
  a source test rejects unscoped/undefined-filter `deleteMany` cleanup. Deliberately restoring the
  bad predicate left **17/17** branch tests green but made the wrapper fail on the exact **2 → 0**
  staffing loss. The same guard exposed and drove exact `finally` restoration for whole-set
  Branch/Category/Subject reorder tests, Morocco-local association dates for online-class tests,
  fail-safe recording teardown, and three browser authorization probes that could mutate ambient
  Teacher, Admin, Level, Category, beneficiary, or enrolment state. Those probes now use exact
  tagged, fail-safe-cleaned identities and coordinates. B-01 retry assertions now distinguish
  equivalent live-worker convergence from a dedicated exact-job pg-boss retry proof, eliminating
  competition with the running Production worker without weakening final row/object checks. The
  final sweep passed **1802** active tests and its complete logical database snapshot was identical
  before and after. Fixture reseeding is no longer the remedy or the definition of success.

  **Reviewed and hardened on integration (Claude, 2026-08-27).** The root cause was reproduced
  independently — the pre-fix file alone passes 17/17 and takes staffing 2 → 0, and the new
  wrapper catches it — which also **corrects this document's own earlier claim** that a preceding
  suite was required. That claim was a mismeasurement and is withdrawn. Three additions, each
  closing a way a guard could pass while proving nothing:

  1. **The state snapshot refuses to emit an empty catalogue**, and the wrapper refuses an empty
     digest file. `cmp -s` on two empty files succeeds, so a snapshot that returned nothing would
     have reported every run clean — the same fail-open shape as the three CI guards that
     depended on an absent `rg`.
  2. **The source guard now falsifies itself.** Its only assertion read the real tree and expected
     `[]`, which a detector that matched nothing would satisfy forever. It is now aimed at both
     unsafe constructs and required to report them, at their safe counterparts and required to
     stay quiet, and at parentheses inside strings and comments.
  3. **One B-01 race survived**, in a sibling of the test that was isolated: *«a transient
     public-delete failure stays fail-closed and retryable»* still reached the live queue through
     `decide` + `reevaluate`, so the running worker could delete the public object before the
     assertion that it was still there. It now sets its precondition directly, which is the
     isolation the replacement, deletion and pg-boss retry tests in the same file already use.
     No assertion changed.
  4. **A fourth, found by the review rather than by either author.**
     `check-prisma-mass-write.sh` has scanned `backend/src` since R39b and covered the offending
     file, yet reported nothing: its pattern was `:\s*undefined`, which matches `id: undefined`
     and misses `userId: actorUserId ?? undefined` — the shape that shipped. **The hole was the
     pattern, not the coverage.** Broadened to `\bundefined\b` and proven by restoring the
     pre-fix file, which it now reports. The two guards are complementary: this one covers every
     Prisma mass write in `backend/src` and `backend/prisma`; Codex's covers integration suites
     and shared helpers including a missing `where` entirely.

- [x] **P1.2 follow-up — every named shared-state leak is closed (2026-08-28).**
  The setting fixture restores the complete logical row (`value`, `version`, `updated_by_id`),
  not merely its JSON value. Registration, approval and staff-registration suites record exact
  random onboarding-token JTIs at issue time and delete only those coordinates; neither a
  purpose-wide delete nor a before/after delta can erase a real user's replay guard. The final
  full sweep exposed the previously masked staff-registration issuer as `consumed_token 0 → 14`;
  its 14/14 focused run now leaves the snapshot unchanged. R76's whole-set Category/Subject
  ordering is restored from exact captured ids in `finally`.

  The later `[تجريبي]` soft-delete signature was independently resolved by making the deletion
  suites own the rows they target; seeded groups/schedules are never selected as convenient
  ambient examples. The audit-purge repository proof now uses a unique per-run marker and fixed
  clock inside a deliberately rolled-back transaction, so it exercises the production-wide
  query without consuming an ambient historical fact. These are fixture corrections, not a
  reseed or an Owner-data rewrite; the logical-table isolation guard remains the acceptance
  condition. Final sweep: **89 files / 1857 active tests passed, 10 skipped**, with every
  application-table digest identical before and after.

## OWNER RATIFICATIONS OD-01 … OD-07 — 2026-08-26 · all answered, none open

**OD-01 · Catalogue management — Admin AND Super Admin.** Admin may manage ordinary
operational/reference catalogues **subject to the Admin's branch/scope where the catalogue is
scoped**. Platform-wide security, authorization, compliance and destructive-retention
configuration stays Super-Admin-only. **The UI is never the authorization boundary.** Applies
to the activity-type catalogue and Partners rather than hardcoding either.

> **OD-01 sub-decision (Owner, final): the split is by AXIS, not by visibility.**
>
> | catalogue | authority | vs R61 |
> |---|---|---|
> | الفئات · المستويات · المواد · مواد المستوى · مقرر الحفظ | **Super Admin only** | **unchanged** |
> | global platform / security / compliance settings | **Super Admin only** | unchanged |
> | scheduling types · Partners | **Super Admin only** until a later Owner decision | new — no supersession |
> | genuinely operational/scoped catalogues | **Admin + Super Admin**, where the write can be scoped safely | see below |
>
> **So R61 survives almost entirely.** The reversal is narrow, and two consequences must be
> settled inside the reconciling revision rather than assumed:
>
> **(1) Branch itself may not be scopable, and Rooms are.** The Owner's own criterion is
> *"where the existing authorization model can scope the write safely"*. A **Room** belongs to
> a Branch, so an Admin's branch scope bounds the write naturally. **Creating or deleting a
> Branch is inherently platform-level** — there is no existing branch to scope it by, and
> `GET /admin/branches` is Admin-*readable* precisely because selectors need it (R61.2), which
> is not an argument about writes. Recommend: **Rooms → Admin; Branch create/delete → Super
> Admin**; Branch *edit* is the genuinely open sub-case.
>
> **(2) R105's heading must stay truthful.** الإدارة means *Super-Admin-only by placement*. If
> any node inside it becomes Admin-manageable, either that node **leaves الإدارة** (a menu
> change the Owner must approve — **do not reshuffle silently**) or the heading stops being a
> fact about permission, which is exactly what R105 forbids. The Owner's framing — *«a
> truthful Super-Admin-only permission section for global curriculum/platform management»* —
> points at the first option for Rooms if they are delegated.
>
> **Neither blocks NEW B §C.**

**OD-02 · Parent edits preserve occurrence overrides.** `overridden = true` continues to
protect an individually-changed occurrence from a later parent update; *this and following*
keeps R50's split. Already the built behaviour — no change, now ratified for visibility too.

**OD-03 · عطلة is an ordinary Event**, `attendance_required = false`, schedulable and shown on
the calendar like any other. **Concrete §D requirement:** attendance-specific controls are
**not presented** when the chosen type does not require attendance — the catalogue's
`attendance_required` drives the form, which is why it is a stored column and not display text.

**OD-04 · Level orthography — the Subjects procedure, authorized.** Read-only semantic
reconciliation → in-place normalization only where identity is unambiguous → same id, all
relationships preserved → never a duplicate → **stop and ask on any genuinely ambiguous row.**

**OD-05 · حسابي shows no guardian personal or contact data by default.** The existence, type
and status of the relationship may be shown where useful; private guardian fields may not.

**OD-06 · Account retention — NO blanket decision.** NEW O's 35-relationship classification
comes first (DELETE · ANONYMIZE · PRESERVE · TRANSFER/REASSIGN · BLOCK). **Safeguarding,
consent and audit evidence are not physically deleted** merely because an account is, pending
an established legal/operational retention rule. The account may disappear while the necessary
historical record survives anonymized or retained.

**OD-07 · Re-registration.** During the 3-day window the identity/email gets **no new account**
— the original is in a recoverable deletion state, and restoration restores **that** account
rather than creating another. After permanent purge a genuinely new registration is allowed,
subject to whatever preserved/anonymized records remain. Consistent with §4.1's *"never
silently re-register or reactivate"*.

## READINESS AUDIT — 2026-08-26 (final planning pass)

### Supersessions the next session must write (all four are NEW B §C's first commit)

`Visibility` already exists as `public | private | hidden`; the **next free revision number is
109**. Four ratified clauses are contradicted by the Owner's NEW B decisions and must be
superseded explicitly, not silently reconciled:

| clause | says today | superseded by |
|---|---|---|
| **R43** | *"Sessions are PUBLIC — anonymous visitors browse the timetable"* | حصة gains a tier; legacy backfill `public` **preserves** this exact behaviour |
| **§4.6** | *"An exam has no visibility tier of its own"* | امتحان gains one |
| **§4.4** | `hidden` = staff + scope; **Admins see ALL hidden regardless of branch** | `hidden` = responsible + Super Admin — this **narrows** Admin reach |
| **`Event.visibility` default** | `private` (schema) | `public` for new rows only |

**§4.4's change is a NARROWING, not a widening** — today every Admin sees every hidden Event.
Say so in the revision; it is the one place where the new rule removes access somebody has.

### THE TWO RETENTION POLICIES ARE DIFFERENT — do not merge

* **Trash today: `PURGE_WINDOW_DAYS` = 90** (`trash.repository.ts`), BR-15's default window.
* **NEW O: 3 days**, for a **self-deleted account** only.
* **Automatic quarantine destruction of Educational Content remains an OPEN Owner decision**
  (R59.4) and is **not** authorised by the 3-day account rule.

⇒ NEW O introduces a **second, shorter window for one entity type**. It must not change
`PURGE_WINDOW_DAYS`, must not start the quarantine scanner, and must be visibly distinct in
Trash so a Super Admin can tell a 3-day account from a 90-day record.

### Resolved — do NOT re-ask

visibility semantics · default `public` · `hidden` = responsible + Super Admin ·
Event responsible = `EventStaff.responsible` (R71.3) · حصة responsible =
`CourseScheduleStaff.position='teacher'` **effective on the occurrence's own date** ·
امتحان responsible = `ExamStaff.supervisor` · legacy backfill `public` ·
occurrence-only = `overrideSession` + `overridden=true` · this-and-following = R50 split,
**no other mechanism authorised** · overridden rows protected from parent edits (already built,
`protected_sessions`) · Event × Content independence (already built, *"the content gates, the
sessions do not"*) · `الكل` = `UserBranchRole.branch_id IS NULL`, never a Branch row ·
Teacher phone/email stay blank.

## OWNER ADDENDUM — 2026-08-26 · manageable reference data, account deletion, legal pages

### Global rule (binding)

**Seeded does not mean immutable.** Any business/reference catalogue shown to users must have
an Admin/Super Admin management path; the seed is the initial state, never a whitelist, and a
seed rerun must preserve Owner-created rows. **Excluded**: internal ids, security policy, audit
records, tokens/hashes, migration metadata, authorization internals, immutable historical
evidence. **Reuse existing primitives** — `DataTable`, `FormDialog`, R76 ordering/reorder,
TD-5 blocked-delete + `BlockedNotice`, Trash/restore. No parallel management architecture.

### Management audit — result

| catalogue | managed today | action |
|---|---|---|
| Branches · Rooms · Categories · Subjects · Level Subjects · مقرر الحفظ | ✔ node + CRUD | none |
| **Academic Years** | ✖ **seeded, user-visible in scheduling/content forms, NO screen** | **new finding — add to plan** |
| **Scheduling types** | ✖ frontend constant `SCHEDULING_TYPE_SPECS` | NEW H |
| **Partners** | ✖ model does not exist | NEW N |
| Quran Surahs (114) | ✖ read-only | **deliberately excluded** — religious canon, not association data |
| Roles (5) | ✖ | **deliberately excluded** — §7: *roles are seeded, no CRUD in the MVP* |

### NEW H — DONE 2026-08-26 (R110)

Shipped as designed. `SchedulingType` is a seeded reference entity — `name`,
`structural_kind`, `attendance_required`, `display_order`, TD-15 `version`, TD-5 soft delete —
with a Super-Admin screen **أنواع الجدولة** (a NEW الإدارة node, not a reshuffle of R105's
order; two order guards restated). Five rows, three entities, no fifth model:
`class` → `RecurringCourseSchedule`, `activity` → `Event`, `exam` → `Exam`, **stored** and never
read off the Arabic name. `Event.scheduling_type_id` is nullable + required at the boundary
(R35) with `ON DELETE RESTRICT` and a blocked delete. Read = any staff who may schedule
(مؤطِّرة included, R93/R94); write = Super Admin only (OD-01). The **open question is answered**:
a seeded reference table, and OD-03's *"stored column, not display text"* is what settled it.
**R56 is exercised, not contradicted** — it named `attendance_required`'s exact condition — and
its other half stands: a holiday cancels no class. `docs/SRS-PROPOSAL-R110.md` is written for
the Owner; `SRS.md` untouched. Frontend registry **split, not deleted**: the catalogue is server
data, `STRUCTURAL_KIND_SPECS` keeps only what an entity can express.

### NEW H (original plan) — catalogue becomes a seeded reference MODEL + management

Five rows, each carrying **`attendance_required`** and **`structural_kind`**
(`RecurringCourseSchedule` | `Exam` | `Event`) — the kind is **stored, never inferred from the
Arabic name**. Order is a column, not a UI constant. Super Admin manages; **whether Admin may
write is an open question** — reference-taxonomy writes are Super-Admin-only today (R26/R61),
so granting Admin would widen an existing permission and needs ratification.
Historical scheduling rows must still resolve their type after it is deactivated/deleted →
use TD-5 blocked-delete + soft delete, never a hard delete. **Precedes §D.**

### NEW L — normalization protocol (same standard as the Subjects)

Inspect row + all relationships → verify no canonical duplicate → normalize **in place**,
same id, all relationships → never delete/recreate for spelling → never leave a near-duplicate
beside the historical row → **stop and report** any row whose semantic identity is uncertain.

### NEW G — privacy constraints (binding on the redesign)

Show: her own profile · registrations · enrolment (Category/Level/Branch) · teaching groups ·
account relationship/status. **Never by default**: guardian email, guardian phone, internal
account ids, identity/provider data, audit data, administrative notes, unrelated guardian
fields. A guardian field required by a business rule is **reported, not assumed**.

### NEW N — `Partner` model + landing section

New reference entity: `name`, `display_order`, active/visible state, soft delete. Four seeded
rows. **No logos, URLs, descriptions or contacts invented.** Landing reads from the database
and **renders no section at all when zero partners are visible.** Seed must not clobber
Owner-created rows.

### NEW O — self-service account deletion · **DESIGN SECTION FIRST, NO SCHEMA**

**Scale, measured: 35 foreign keys reference `"user"`** — audit_log, child_application (×4),
consent_record (×3), course_schedule_staff, enrollment, event_staff, exam_staff, family_link
(×2), grade, notification, quran_progress_log (×2), rate_limit_counter, refresh_session,
refresh_token, session_recording (×2), session_staff, student_exam_submission,
student_surah_progress, student_teaching_group, teacher_availability,
teacher_category_capability, teacher_subject_capability, trash.deleted_by, user.deleted_by,
user_branch_role, user_identity.

Every one must be classified: **delete · detach · anonymize · preserve as institutional record
· block purge until reassigned.** Deleting a login must **not** destroy grades, Quran progress,
attendance, safeguarding evidence or audit history. **Never `CASCADE DELETE User`.**

Already available to reuse: R102 revokes every session on rejection (same mechanism needed
here) · TD-5 Trash + `purge_after` · the pg-boss `content.quarantine-purge` worker is the
**exact template** for a durable, idempotent, retryable 3-day purge · `assertFreshActive`
already fails closed on suspended/deleted accounts.

**Known tension to resolve in design**: hidden scheduling items are owned by a *responsible
person* (NEW B §3). A deleted responsible principal must not orphan a hidden item →
likely category 5 (block until reassigned).

### NEW P — legal pages · **must follow NEW O**

`/privacy` and `/terms` **do not exist**. The policy must describe what the platform actually
does, so it cannot be drafted before the retention model is settled. Anything not supplied by
the Owner — registration numbers, legal entity, addresses, CNDP references, governing law —
is marked **OWNER/LEGAL INPUT REQUIRED**, never invented. Verify Google's current OAuth
requirements against Google's own documentation, not repository notes. **Do not submit
verification.**

### Production blockers — STILL OPEN, not closed by this batch

object-store replacement · backup target/retention · backup automation/alerting · Production
RTO drill · automatic quarantine destruction · ~~P1.2 test isolation~~ **CLOSED 2026-08-27** ·
manual Production launch data · no-PII audit · §18/M8 rehearsal. **Production undeployed.**

## NEXT BATCH — planned 2026-08-26, ready to execute after reset

**Order is dependency-safe. Do not reorder without re-reading the reasons.**

| # | section | kind | why here |
|---|---|---|---|
| 1 | **NEW B §C** backend visibility | feature + migration | design ratified; precondition audit below |
| 2 | ~~**NEW H** scheduling-type catalogue~~ **DONE (R110)** | reconciliation → feature | precedes §D, as planned — §D now builds on a picker that already reads the catalogue |
| 3 | ~~**NEW B §D** frontend Add/Edit + scope prompt~~ **DONE 2026-08-26** | feature | R50's scope prompt already shipped, so the tier joined the fields those three scopes already carry — no second recurrence mechanism |
| 4 | ~~**NEW B §E** full authorization matrix~~ **DONE 2026-08-26 — NEW B is CLOSED** | tests | 35 HTTP assertions; proven against four reintroduced defects; shared dev state measured identical before/after |
| 5 | ~~**NEW D** Teacher content-library lookups~~ **DONE 2026-08-27** | defect (backend authz) | `GET /me/scope-options` (R93.4's pattern); admin reads untouched and still refused |
| 6 | ~~**NEW E** الملف التدريسي false dirty~~ **DONE 2026-08-27** | **defect** | `dirty` meant *has content*, not *has changed*. Fixed via the shared `isDirty`; recorded as **UX rule AY.1**; guarded in `teachers.test.tsx` (proved against the reintroduced defect) and in the browser at check 14 |
| 7 | ~~**§8** table columns audit~~ **DONE 2026-08-27** | feature | Owner supplied the brief; recorded permanently as **UX rule BA**. الجدولة, حصص الجدول, المستويات, الفئات, المجموعات الإدارية and طاقم التأطير all gained the fields their rows already carried |
| 8 | ~~NEW I~~ **DONE** · ~~**NEW J/K/L**~~ **DONE 2026-08-27** | data | Owner supplied the dataset. Seeded for a fresh install and **reconciled in place** for an initialized one via `backend/scripts/reconcile-reference-data.ts`. **Category/Level descriptions are the one part not done** — see the open Owner decision below |
| 9 | **§9A–D/F** edit-form audit | feature | includes NEW E and NEW F |
| 10 | ~~**NEW F** availability page gains capabilities~~ **DELIVERED BY R106** | feature | `/teacher/availability` already shows her Subjects and Categories as **text**, and already compares `dirty` against the loaded record. Covered by `verify-teacher-portal.sh` (24/24). **Making them editable is not this item** — R88.2 refuses it in terms, so that would be a new Owner decision, not a carry-forward |
| 11 | ~~**§10** Rule AX carry-forwards~~ **DONE 2026-08-27** | feature | Recorder dialog converted onto the **shared** `useContentScope`. `session-materials-dialog` deliberately untouched — the audit marks it *Borderline, Owner decision*, and changing it would pre-empt that. The conversion uncovered a real seeding race in `useScopeOptions` (see below) |
| 12 | **NEW M** Teacher baseline import | **data, Production only** | after §9 so the profile form is correct |
| 13 | ~~**NEW O** account deletion — design only~~ **DESIGN DELIVERED 2026-08-27** | reconciliation | `docs/SRS-PROPOSAL-R111.md` classifies all 35, enumerated from the **live database**. Central finding: 26 must survive, so deletion is the **de-identification of a row that continues to exist**. **All four questions ANSWERED by the Owner 2026-08-27** and folded into §7; implementation (#14) is unblocked |
| 14 | ~~**NEW O** implementation~~ **DONE 2026-08-28** | feature (no migration needed) | **UNBLOCKED 2026-08-27** — R111's design is ratified. Self-deletion for every user including مؤطِّرات; admin-initiated deletion on the same 3-day window; tombstone «حساب محذوف»; BLOCK refuses **with an explanation naming what must be reassigned**, and does not reassign in the same action |
| 15 | **NEW M** Teacher import | data, **Production only** | R104 — never Staging |
| 16 | ~~**NEW G** حسابي redesign~~ **DONE 2026-08-27** | UX | The page said who she is and not where she is. `GET /profile` now carries `enrolments`, `circles` and `guardians`; the guardian block is **a name and a status, enforced by the projection**. Guarded in `pages/profile/privacy.test.ts`, proved against a reintroduced phone leak |
| 17 | ~~**NEW N** Partner model + landing~~ **DONE 2026-08-28 (R113)** | feature | Model, Super-Admin CRUD, public `GET /partners`, الشركاء screen, landing section that renders **nothing** when none is visible. **The four names are not seeded** — they are not recorded anywhere in this repository and the brief forbids inventing them; Owner decision: enter them through the screen |
| 18 | ~~**NEW P** privacy/terms + OAuth readiness~~ **DONE 2026-08-28** | docs + UX | `/privacy` and `/terms`, public, linked from the footer of every public page. Google's requirements verified against **Google's own documentation**; the platform requests only non-sensitive scopes, so app verification is not triggered. **Not submitted.** Everything legal is marked ⚠ rather than invented |
| — | **Academic Years management** | feature | fold into #8 (reference-data batch) |

### Findings that change the work (established, not assumed)

* **NEW C — CLOSED 2026-08-27, browser proof included.** Root cause was **not** the
  three-source union: `sort` was missing from `approvals.tsx`'s loader dependency array, so
  the header updated state and never re-requested. Fixed, with `sorted-pages-refetch.test.ts`
  covering all four server-sorted pages. The owed browser confirmation is now
  `scripts/dev/browser/verify-approvals-sorting.sh` (**7/7**). It seeds **three
  scenario-owned pending applicants** — the fixture work that was the honest reason to leave
  it open — whose name order (أ ب ج) and oldest-first submission order (ج أ ب) are neither the
  same list nor reverses of each other, so a screen returning its default order cannot satisfy
  both assertions. It asserts on its own rows' relative order only and removes exactly what it
  created; the queue was verified empty afterwards.
* **NEW D — the incorrect layer is the SHARED HOOK, not the page.** `useScopeOptions` calls
  `listLevels`, `listSubjects`, `listAcademicYears` — all `403` for a Teacher (R93.4) — while
  `listBranches` correctly returns `200` (branch.service admits teachers). R93.4 already set
  the precedent and the mechanism: **`GET /me/event-scope-options`** answers *what may I
  address this to* without widening any admin endpoint. **Do the same for content scope; do
  not grant Teachers the admin reads.** Fix is backend + hook, not per-page.
* **NEW H — there is NO `EventType` table.** The catalogue lives in
  `frontend/src/adapters/scheduling-types.ts` as `SCHEDULING_TYPE_SPECS`, a frontend registry.
  The five Owner types map onto three entities: **حصة دراسية → RecurringCourseSchedule ·
  اختبار → Exam · محاضرة/حفل/عطلة → Event**. `حضور اجباري` is a real property with nowhere
  to live today. **Decide before §D**: seeded reference table vs. extending the registry.
  Recommend a **seeded reference table** — the Owner calls the order canonical, and a
  frontend constant cannot be seeded or ordered by an administrator.
* **NEW I — DONE 2026-08-27.** `branch.phone_secondary` added (one additive nullable
  `VARCHAR(20)`), validated by the same rule as `phone`, mapped on both write paths, surfaced as
  its own management column/field and published on the §5.1 allowlist. Both contract key guards
  restated. **`phone` was not overloaded**, as instructed.
* **NEW M — "all branches" is already structural.** `UserBranchRole.branch_id IS NULL` means
  every branch (`branch-scope.ts`). **Never encode «الكل» as a Branch row.**

### Real-data / environment policy (binding)

* **NEW I, J, K, L** = Production **reference** data → `prisma/seed/production.ts`, additive
  and idempotent, matching R107's fail-closed style. Safe in Local Development.
* **NEW M (30 named real people)** = **Production only.** R104 forbids real person data in
  Staging and the Owner has **not** superseded it. **Never seed into fixtures, never into
  Staging.** Recommend an **Owner-controlled import file + a one-shot import script**, not a
  migration: a migration would replay real personal data into every environment that runs it.
* Keep `production.ts` (reference) and `fixtures.ts` (synthetic) strictly separate — the
  §15.2 firewall already exists; do not blur it.
* Phone/email for Teachers are unknown. **Do not invent placeholders.**

### BLOCKED FOR LACK OF A RECORDED BRIEF (found 2026-08-27, while continuing the roadmap)

Two roadmap rows carry a one-line label and nothing else. Neither can be implemented without
guessing, and guessing here produces rework rather than a wrong answer that shows up in a test:

* **§8 — "table columns audit".** Which tables, which columns, and what each is for is recorded
  **nowhere** in this repository — only the roadmap row. Its stated dependency (NEW I's column)
  is now satisfied, so the brief is the only thing missing. It came from an Owner message that
  was never written down.
* **NEW J, NEW K, NEW L — the reference-data baseline.** NEW I's *schema* half is done. J and K
  are **not defined anywhere in TASKS.md**, and no authoritative dataset — branch addresses,
  phones, opening hours, the Level orthography list — is recorded. The real-data policy is
  explicit that placeholder contact data must not be invented, so this cannot proceed on a guess
  either. NEW L's *protocol* is recorded; the rows it applies to are not.

**What would unblock them:** for §8, the list of screens and the columns to add; for J/K/L, the
actual values, which are Production reference data the Owner holds.

### Needs Owner decision before its section starts

1. ~~**NEW H** — reference table vs frontend registry, and whether `عطلة` is
   schedulable-with-attendance.~~ **ANSWERED and shipped (R110).** OD-03 settled both:
   `attendance_required` is *"a stored column and not display text"*, which requires a table;
   and عطلة is an ordinary schedulable Event with `attendance_required = false`.
2. ~~**NEW N** — static content vs Super-Admin-managed reference data.~~ **ANSWERED: Super-Admin-managed reference data (R113).** The landing page reads the table, so a partner is added without a deployment.
3. **NEW L** — existing Level names differ in spelling from the baseline; the same
   orthography question as the Subject normalization. Audit before touching.
4. ~~**NEW G** — which guardian fields may a beneficiary see?~~ **ANSWERED BY THE CONSTRAINT ITSELF, 2026-08-27.** The recorded rule already excludes guardian email, guardian phone and every unrelated guardian field *by default*, and requires that a field a business rule needs be **reported, not assumed**. So the conservative reading was implemented — **name and relationship status only** — and the projection is what enforces it. If the Owner wants more shown, that is an additive decision against a screen that currently discloses nothing extra.

- [x] **NEW B §C — scheduling visibility — DONE 2026-08-26 (R109).** Shipped: `visibility` on
  `RecurringCourseSchedule` (template), `Session` (snapshot), `Exam` (one column, no snapshot);
  `event.visibility` default `private` → `public` for new rows only; hand-written migration
  `20260826120000_r109_scheduling_visibility` backfilling every legacy row `public`, verified in
  the dev database (775 / 15 / 6 rows, events unchanged at 8/2/4). `hidden` narrowed from scope
  to **ownership** — responsible party + Super Admin — in one policy,
  `policies/scheduling-visibility.ts`, for all three kinds. The precondition below was honoured
  as designed: **`SessionStaff` is the resolution**, because it IS `CourseScheduleStaff`
  effective on the occurrence's own date, materialized. Tier gates publication
  (`/calendar`, `/me/calendar`, the §5.2 page, content→sessions), **not** the management lists.
  23 new integration assertions, **proven against the pre-R109 behaviour** (9 fail on it), plus
  HTTP-level assertions in the calendar and session-page suites. Three superseded §4.4 guards
  **restated, not deleted**. `docs/SRS-PROPOSAL-R109.md` written for the Owner — SRS.md untouched.
  ~~**Still owed by §D:** the frontend adapter maps `null` for a class and a sitting.~~
  **CLOSED by §D (2026-08-26):** both mappers hydrate, one shared `VisibilityField` renders for
  every kind and in the occurrence editor, and the three R50 scopes carry the tier to the
  endpoints they already owned. 19/19 in the browser.
- [ ] ~~**NEW B §C — scheduling visibility (schema + migration + recurrence integration).**~~ Design
  ratified in §B; **not started** — the capacity checkpoint refused it at 19% session remaining.
  **Precondition audit COMPLETE (Owner question 3b), and it changes the design:**
  `@@unique([scheduleId, userId])` was withdrawn by R91, so a schedule may hold **several**
  `position = 'teacher'` rows — but *"at most one main مؤطِّرة active on any date"* is an
  **enforced invariant**, not an assumption: `course-schedule.service.ts` refuses overlapping
  mains with `OVERLAPPING_MAIN_TEACHER`, and `effective-staffing.ts` resolves `main` as a single
  `find`. **So the responsible party is unambiguous on any given DATE and ambiguous across the
  series.** The consequence for §C: hidden visibility of a **Session** must resolve its
  responsible teacher **effective on that occurrence's own date** (R91), never as of *now* —
  resolving as of today would strip a replaced مؤطِّرة of the occurrences she actually taught and
  hand her ones she did not. **This is the exact defect Codex caught in R106's exam scope**, so it
  is written down here rather than rediscovered. For an امتحان the responsible party is
  `ExamStaff.position = 'supervisor'`, which carries no effective dating and is therefore
  date-independent.
  Entry points: `course-schedule.service.ts` (`splitCourseSchedule`, `regenerateSessions`),
  `session.service.ts` (`overrideSession`), `calendar.service.ts` (`visibilityFilter`).
  **A second symptom of the same family, observed 2026-08-26:**
  `consent-safeguarding.integration.test.ts` passes **19/19 in isolation** and failed once inside a
  full sweep on `expected { state: 'completed' }` — a **pg-boss job-state timing assertion** under
  concurrency, in a file §6 did not touch. Both symptoms say the suite is not isolated: one loses
  shared fixture rows, the other races a background worker. **Fix them together.**
- [x] **P1.1 Quran-domain Production seed (R107–R108)** — القرآن الكريم is the domain, not
  a Subject. The additive initial baseline is أحكام القرآن, حفظ القرآن,
  ترتيل وتجويد القرآن, تفسير القرآن, فقه, السيرة النبوية, العقيدة, الأذكار; محو الأمية is
  not seeded fresh. Only حفظ carries `tracks_quran_progress`; runtime authorization resolves
  that marker rather than a name, so every other initial or later Quran-domain Subject remains
  ordinary unmarked curriculum. The seed preflights duplicate حفظ rows and conflicting live
  markers, asserts its exactly-one launch postcondition, and never deletes, renames or rewrites
  Super-Admin additions or historical rows. تفسير follows the Level's مقرر الحفظ Surahs but
  remains outside memorisation authorization and coverage. The disposable fresh-stack drill
  applies every migration, runs the actual Production seed twice, proves exact/stable baseline
  data plus additive preservation and fail-closed conflicts, and exercises marked-versus-unmarked
  teacher authorization through the real Quran policy/service before running the affected suites
- [ ] Manual launch-data entry session(s) with coordinator: branches, rooms, groups, roster (R-5, §15.1)
- [~] **No-PII log audit (TD-14) — independently determined code paths are closed.** Nginx now
  generates (rather than trusts) the request id and logs no URI/client address; Express logs the
  registered route template or `<unmatched>`; API and job-start logs copy no raw exception text;
  and the shared AuditLog repository recursively refuses copied identity/display fields and exact
  storage locators. Catalogue actions use target ids/changed field names; content audit uses a
  non-reversible exact-coordinate id while exact actionable keys remain in governed domain/Trash/job
  rows. Current finalization retry derives its immutable key from the accepted SHA-256 and grant id,
  retaining a read-only fallback for legacy audit rows. Unit, real PostgreSQL/MinIO behavior tests
  and the CI guard pin these boundaries. **DOCUMENT OWNER DECISION
  REQUIRED — AUTH AUDIT IDENTITY:** TD-8 says `auth.login` / `auth.login_denied` detail includes
  identity email, while TD-14 and §20 rule 18 say never log emails. Current implementation follows
  the stricter no-email rule. Reconcile TD-8 by either removing `identity email` (recommended;
  actor/target User id + provider + reason remain attributable) or explicitly defining a narrowly
  controlled AuditLog exception and its access/retention basis. **DOCUMENT OWNER DECISION REQUIRED
  — CONTENT AUDIT COORDINATES:** TD-8 R53 literally requires previous/new/raw deletion storage keys,
  while TD-14 prohibits filename-derived values in logs. Replace that wording with non-reversible
  storage-coordinate ids (recommended; exact locators remain recoverable in the authoritative
  lifecycle records), or define a controlled exact-key exception. **OWNER DECISION REQUIRED —
  AUDIT FREE TEXT:** TD-8 mandates reasons/justifications and setting old/new values, and consent
  audit accepts an optional note; each can contain personal data. Decide whether these are a
  governed AuditLog exception with explicit access/retention/input notice, or whether actions use
  structured reason codes while governed source-record text stays outside AuditLog. Until these
  decisions are reconciled, the audit remains partial rather than falsely marked complete.
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

### Owner clarification — account administration vs operational work (2026-08-28)

Recorded authoritatively in `docs/SRS-PROPOSAL-R111.md` §6a; the route and its
normative wording are proposed in `docs/SRS-PROPOSAL-R112.md`.

- [x] **المستخدمون is Super-Admin-only**, enforced in `user.service.ts` for the
      list and **every write beneath it**; proved with forged requests.
- [x] **`GET /admin/directory`** — the operational people-picker, Admin+, exactly
      `id`, `name_arabic`, `nickname`, `roles`. Five screens moved onto it.
- [x] **TD-3 line added by the Document Owner's instruction 2026-08-28** — R112 is
      in `docs/SRS.md` (§5.6, §5.7, TD-2) and all 27 CI guards are green. Was: `check-openapi-td3.sh` enforces
      §20 rule 16 and is **correctly failing**: an endpoint in the API document
      that TD-3 does not list is forbidden. `docs/SRS.md` is the Owner's; the
      exact proposed entry is in `SRS-PROPOSAL-R112.md` §3, with the TD-2 change
      in §4. **This is the only red guard.**
- [x] **Account deletion (R111 #14) — DONE 2026-08-28.** No migration was needed:
      a fifth `account_status` value was drafted and **reverted**, because the
      schema already records that TD-1's Deleted state is `deleted_at IS NOT NULL`
      so the two cannot disagree. Was: The
      authorization split above is its precondition. Still to build: the
      `AccountStatus` terminal value and its migration, self-delete for every
      user, the last-active-Super-Admin refusal (reusing the existing
      `LAST_SUPER_ADMIN` guard), Super-Admin delete of another account, permanent
      delete as R111's de-identification performed now, the 3-day window as a
      **second** retention window that must not disturb `PURGE_WINDOW_DAYS = 90`,
      and R111's BLOCK on live staff responsibilities.


### Found while building NEW N, not fixed — the Owner's edit

`/admin/scheduling-types` (R110) is in `admin-modules.ts` and in the navigation
harness, and **§14.1's sitemap does not list it**. `admin-modules.test.ts` did not
catch it because its expected list is hand-maintained against the registry rather
than against the SRS — the exact failure its own comment warns about. R113's
approved scope covers Partners only, so this is reported rather than taken.

### Owner decisions and open items from the 2026-08-28 batch

- [x] **A role is held once per account** — partial unique index
      `user_branch_role_one_live_role_per_user`, service refusal
      (`DUPLICATE_ROLE`), dropdown filtered. **Multi-branch scoping withdrawn
      deliberately** (ratified): a role carries one scope, a single branch or all
      of them. No account used the multi-branch form when measured.
- [x] **R80 point 6 amended** — `sex` is published on the Super-Admin-only
      `/admin/users` read so §5.6's edit form can hydrate it, and **nowhere
      else**. R80.3/R80.4 unchanged.
- [x] **عطلة is a `holiday` structural kind**; محاضرة corrected to `class`;
      `نشاط` added. Corrected in place with ids preserved.
- [x] **RESOLVED by the Owner, 2026-09-03 — minors and guardian emails (R129).**
      The earlier reading — *a minor signs in through her guardian's address* —
      is **superseded**. The model stands as §4.3 already had it: a minor is a
      **login-less row** reached through an approved `FamilyLink`, with no
      identity and no address of any kind, and R62.9 makes exactly that the
      definition. The guardian's authenticated email **may also be her own
      contact address** — there is no second column and none is to be added —
      but it is **never** copied into the child's identity, the child's
      pre-provisioned address, `ChildApplication` or `FamilyLink`, and it never
      means the child authenticates as her. A message concerning a child
      resolves the **live approved guardian** and reads her current address;
      there is still no email, SMS or push provider. The generic `email`
      projection keeps its wire name — the screen labels it «بريد Google», so it
      already reads as the login address — and the invariant is documented
      instead. `docs/development/account-and-membership.md`;
      `docs/SRS-PROPOSAL-R129.md` is **APPLIED to `SRS.md`** (2026-09-03).
- [x] **RESOLVED by the Owner, 2026-09-03 — a platform account is not membership
      (R129).** A guardian authenticating to manage children is **guardian-only**:
      not a beneficiary, not a Student, not enrolled, not staff, not a member,
      and absent from every beneficiary list. This is what the platform already
      did — R62 leaves `mustEnrol` empty for her and R79.3 writes
      `isBeneficiary` from the set the approval *enrols* — but nothing asserted
      it end to end. Now pinned by six tests. A guardian who later joins uses
      the **same** `User`; no second account and no second membership system.
- [ ] Codex's four open Owner questions (audit identity email, exact storage-key
      wording, required free-text audit evidence, the R111 3-day purge job)
      remain open and were **not** touched by this batch.
- [x] **R122 — an enrolment belongs to an academic period.** `AcademicPeriod`
      added; `Enrollment.academic_period_id` nullable in the schema and
      **required at the write boundary**; the live-row unique index becomes
      `(student_id, level_id, academic_period_id)`, narrowing BR-21 to *within a
      period*. Currency is derived from the period's dates — `deleted_at` keeps
      its single meaning of *ended early by a person*. **No historical row is
      backfilled and the seed creates no periods**: guessing a semester the
      association never recorded would be indistinguishable from a real one a
      year later. `Level` remains the studies year; no `StudiesYear` entity was
      created.
- [x] **الفصول الدراسية — the management screen** (`/admin/academic-periods`,
      الإدارة, Super Admin). Built with the model rather than after it: the seed
      creates no periods, so without it approval would have refused every
      applicant with nothing an administrator could do. List · create · edit;
      **no delete**, because a semester the association ran is a fact and
      enrolments point at it under RESTRICT.
- [ ] **Owner data task, not an engineering one:** the periods of the current
      academic year must be entered on that screen. Until one covers today,
      approval refuses with `NO_CURRENT_ACADEMIC_PERIOD` — which is the intended
      behaviour, not a defect.
- [x] **R123 — attendance (§4.7) is built.** `Attendance` on the three dated
      occurrence carriers; `attendance_mode` replaces `attendance_required`;
      `attendance_marking` on the class and the activity;
      `Category.self_attendance_allowed` makes «a minor never self-marks»
      machine-readable. The register lives in the shared occurrence dialog, the
      beneficiary gets «تسجيل حضوري» and never the roster, and عطلة/حفل are
      refused server-side on every path. **No analytics, no QR.**
- [x] **SRS Revision 123 RATIFIED** by the Document Owner, 2026-09-04. §4.7 is
      replaced, §20 rule 16 no longer names attendance, §10.1's roadmap bullet is
      retired and §7 carries `Attendance`. Both sub-decisions were answered:
      **حفل stays `disabled`** and **اختبار is `required`** — and exam attendance
      is normatively independent of exam submission and exam grade.
- [x] **R124 — the online assessment builder.** `exam.mode = 'online'` activated;
      `ExamQuestion`/`ExamQuestionOption`/`StudentExamAnswer`/`StudentExamAnswerOption`
      replace two `jsonb` blobs; five targets behind one resolver; draft →
      published → closed; حفظ ≠ إرسال; the paper freezes on the first
      submission. **Grading is the existing sheet** — no second scale, no
      automatic scoring, no analytics.
- [x] **SRS Revision 124 RATIFIED** by the Document Owner, 2026-09-04. §4.6's
      *«online is declared and refused»* is superseded, its question-type and
      auto-grading clauses are narrowed to v1, and §7 carries the four new
      entities. Both sub-decisions were answered: **the first submission freezes
      the paper** (no question versioning in v1) and **there is no staff reopen,
      reset or resubmit action in v1**.

### Open questions from the autonomous session of 2026-09-04

- [x] **ANSWERED AND IMPLEMENTED — SRS Revision 125 (2026-09-05).** A Level
      target **does not** override branch authorization: a branch-scoped Admin
      may create, use or publish one only when the resolved audience is entirely
      within her branches — checked through §4.4c's single audience definition,
      re-asked **at publish**, and refused with `TARGET_OUTSIDE_BRANCH_SCOPE`. A
      Super Admin is unaffected.
- [x] **ANSWERED AND IMPLEMENTED — SRS Revision 125 (2026-09-05).** A مؤطِّرة may
      address an individual beneficiary **within her own teaching**, answered by
      `studentsTaughtBy` — *may she address THIS student*, never *this whole
      Level*. She gains no association-wide beneficiary lookup, and out of scope
      answers `404` rather than `403`.
- [x] **The R124 target picker is built** (R125). `GET /assessments/targets` is
      server-scoped per caller and staff-only; the builder composes the existing
      `SearchInput` and `SelectField` rather than a second generic picker. **The
      list is not the boundary** — every refusal is made again on the write.
- [x] **DECIDED AND FIXED (Owner, 2026-09-03) — `DELETE /exams/{id}` now refuses
      an assessment holding student educational evidence.** Any
      `StudentExamSubmission` in any state, or any `Grade` in any status, is
      sufficient: the refusal is a `STATE_CONFLICT` carrying
      `STUDENT_EVIDENCE_EXISTS` and the two counts, and the scheduling screen
      names what is there instead of «تعذّر الحذف». **Publication does not
      block** — a published paper nobody sat is still a plan (R118.1's rule for
      schedules) — and **attendance does not block**, because R123 makes it an
      occurrence fact rather than achievement. No `cancelled` state was added
      and grade visibility was not touched. The guard is the first statement in
      the transaction, so a refusal rolls back before the cancellation
      notification, the tombstones, the Trash snapshot and the audit row.
      `docs/SRS-PROPOSAL-R126.md` carries the clauses and is **APPLIED to
      `SRS.md`** (2026-09-03) — including the correction of R59 clause (3), whose
      *"cascades to exactly one child table"* rationale R123 and R124 made false.
- [x] **DECIDED AND REMOVED (Owner, 2026-09-03) — `Exam.access_policy` and the
      `single_submission` policy are withdrawn.** Save-and-resume is the only
      response policy in v1, which resolves §17's contradiction with R124 in
      R124's favour. The column, the `ExamAccessPolicy` enum, the unused
      `SINGLE_SUBMISSION_FINAL` code and its Arabic fallback are gone;
      `20260904100000_drop_exam_access_policy` is a TD-6b contract-phase drop
      that **refuses** while any exam reads `single_submission` and passes
      default rows without comment. Proved against the existing local database
      and against a fresh disposable one. `errors.test.ts` now pins
      `CAPACITY_FULL` and `SINGLE_SUBMISSION_FINAL` as retired **by name**.
      `docs/SRS-PROPOSAL-R127.md` lists the six current normative references to
      withdraw, and is **APPLIED to `SRS.md`** (2026-09-03).
