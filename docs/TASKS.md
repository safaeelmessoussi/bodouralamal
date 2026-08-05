# Tasks — بذور الأمل Platform

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
- [~] High-risk endpoint fresh DB status assertions (presigned mint, social profile, approvals, overrides) (TD-12)
  - ✓ Covered on every surface that exists — approvals (5 assertions), consent overrides (3), social profile, user management, family links: a mid-session suspension or a revoked role assignment loses the capability on the **next call**, on the caller's still-valid token
  - △ *presigned mint* arrives with **M6 (Storage)**; the `/uploads/*` endpoints are not built, so this cannot be green before then
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
  - ✓ **`state` + PKCE now tested** — `lib/oauth.ts` had **no test at all**; 18 unit tests now cover verifier entropy and uniqueness, S256 derivation, seal/open round-trip, tampered payload and signature, a foreign signing key, the purpose-separated key (a payload signed with the *raw* JWT key must not open), malformed cookie shapes, the authorization URL's `S256`/`state`/`prompt`, and `exchangeCode`'s audience check, `email_verified` refusal, lowercasing and single `oauth_unavailable` failure mode. **Eight mutations all caught**, including PKCE downgraded to `plain` and the audience check removed
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
  - △ Later milestone (M6) — the `consent.reevaluate` worker (recompute + bucket migration) and the consent-management UI
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

- [ ] ChildContextSwitcher component + API-client header injection (§14.3, §16.1) — **frontend (v0)**; the backend contract it drives is complete and covered by 15 middleware tests
- [~] GroupTeacher join + teacher-scoping resolution helpers (§4.2)
  - ✓ Backend — `policies/teacher-scope.ts`; reach resolves exclusively through `GroupTeacher`, never through a Teacher's branch assignment
  - ✓ Tests — 16 integration tests against real branches, groups and enrolments; six mutations caught
  - ✓ Security — out-of-scope is 404 not 403 (no existence leak for a minor's record); revoking an assignment, un-enrolling, or deleting the group each end reach on the next call
  - ✓ Abstraction — `taughtByTeacher()` composable predicate is the primary form; `teachesStudent`/`teacherStudentIds` are built on it (one query each). Adopted while zero production call sites existed
  - △ Later milestone (M3) — the admin UI that creates groups and assigns teachers arrives with Group CRUD
- [~] StudentSocialProfile field-level restriction (assigned teachers only) (§4.10, TD-2, SRS Revision 28)
  - ✓ Backend — `GET`/`PUT /students/{id}/social-profile`; authorization server-side via the §4.2 predicate + TD-12 freshness
  - ✓ Tests — 19 integration tests asserting the matrix in both directions, the audit trail for reads and writes, and 404-not-403
  - ✓ Security — seven mutations caught; audit records field names never values; `socialprofile.*` excluded from the R19 purge allowlist (verified with a 2099 horizon)
  - △ Frontend integration — the §14 case-file screen
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
> None of them has an endpoint yet, so the rule is currently unenforced for want of a surface; it must be applied when
> `/admin/levels` and `/admin/taxonomy` are built here.
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
- [x] Hand-written SQL (TD-6a): **two** composite FKs (R43.2) — `(administrative_group_id, level_id) → AdministrativeGroup(id, level_id)` and `(teaching_group_id, subject_id, level_id) → TeachingGroup(id, subject_id, level_id)`; partial `UNIQUE (student_id, level_id)` and `UNIQUE (student_id, subject_id, level_id)`; the schedule mode/target and recurrence-shape CHECKs; time-order and cancellation-reason CHECKs; `UNIQUE (schedule_id, date)`; `ar-x-icu` on both new `name` columns
  - ✓ **Proven, not assumed** — `prisma/verification/r43-constraints-proof.sql` applies both migrations to a scratch database from empty and attempts every row each constraint exists to refuse: **13 rejections fired on the named constraint, 5 legitimate rows accepted**
  - ✓ **Independence between Subjects proven directly**: a Tajweed seat for a student already holding a Quran seat in the same Level is accepted; a second Quran seat is refused
  - ⚠ **The proof run caught a defect in my own CHECK.** The cancellation-reason constraint was first written so that `btrim(NULL) <> ''` evaluated to `NULL`, which a CHECK treats as satisfied — it silently accepted the row it existed to refuse. Rewritten with an explicit `IS NOT NULL`, re-proven, and the reasoning left as a comment above it
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
- [~] Teacher scope from `CourseScheduleStaff` (§4.4c, TD-2) — **replaces `teacher-scope.ts`'s `GroupTeacher` resolution**
  - ✓ Backend — `studentsTaughtBy`, `teacherBranchIds`, `staffsSession` in `roster-resolution.ts`; branch scope now **stated** by the schedule instead of inferred through two hops
  - ✓ Tests — assistants have identical reach; a teacher with no schedules reaches nobody; revoking a staffing ends reach on the next call
  - ✓ **Consumers migrated** — `calendar`, `event`, `consent` and `social-profile` services all resolve through `roster-resolution.ts`; **no production code reads `GroupTeacher`**
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
  - △ **Consent enqueue emits `{ session_id }` and currently finds no sessions** — schedules are a later M3b task. The retiring `roster.service.ts` still emits `{ group_id }`; both shapes sit in the queue during the expand phase, and `consent.reevaluate` has **no consumer until M6**
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
- [ ] Quran as a schedulable Subject **with the BR-9 carve-out** — a Quran `LevelSubject` generates no grading components (§4.4b)
- [ ] Consent gate re-subjected to the session's resolved audience; `consent.reevaluate` payload `{ session_id }` (BR-2, TD-7)
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
- [ ] `/calendar` filter set + `prefilled_filters`; `/calendar/sessions/{id}`
- [ ] `/admin/groups` (+ roster), `/admin/schedules`, `/admin/levels/{id}/subjects/{subjectId}`, `/teacher/schedules`, Session page (§14.1)
- [ ] Public calendar and public Educational Library — **same filters, same items, ordering only** for signed-in users (§5.2)

**Gates**
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
- [ ] Exam builder: immutable question UUIDs, MCQ + free-text (digital-only; print CSS post-MVP §10.1)
- [ ] Access policies single_submission / save_and_resume + submission lifecycle (TD-1)
- [ ] All scores as integer bp (0–10,000), round-half-up once at persistence; no float score columns (§4.6, TD-6)
- [ ] MCQ auto-grade → draft Grade; subjective grading flow; absent-zero rows initialized at first draft save (BR-7, §4.6)
- [ ] `Grade.administrative_group_id` sitting provenance (R43) + aggregation scoped to active-template exams × currently-enrolled students (§4.6)
- [ ] Grade + User optimistic versioning incl. recalc-job participation (TD-15)
- [ ] Postponement check: no template tables/UI/recalc anywhere (§10.1)
- [ ] Pass/fail override endpoint + audit (TD-8)
- [ ] LevelSurah/LevelSubject auto-draft components incl. the Adult-stage dual generation (BR-9, §4.6)
- [ ] §18 Exams & Grading checklist green (incl. both race tests)

## M6 — Content, Consent & Storage
- [ ] Upload initiate/complete/abort: single-shot presigned PUT, branch-scope validation, Teacher Global rejection (§4.9, TD-3.5)
- [ ] Authoritative per-user upload quota 30/hour in PostgreSQL (`RateLimitCounter`), locked + incremented in the initiate transaction (TD-4.12, TD-15.2); `429 RATE_LIMITED` envelope; never in-process memory, never pg-boss, never njs (§3.1 Revision 14)
- [ ] Magic-byte validation at /complete via ranged GET (bytes 0–511) to MinIO + HEAD size check; reject-and-delete (§4.9, TD-9)
- [ ] Hash-segmented immutable keys; replacement mints new key + quarantines old (TD-9)
- [ ] FileUploader: progress, failure, clean retry (R-9) (§14.3)
- [ ] Phone-recording upload guidance panel on /teacher/content (§4.9); cross-browser playback E2E for TD-9 containers (§14.7)
- [ ] Visibility transitions + bucket-migrate job + `/content-unavailable` (§3.1, TD-4.9)
- [ ] Consent re-evaluation engine wired to enrollment/teaching-group membership/consent/upload; consent_forced_private; **empty resolved audience → Category default** (§4.1a, §4.9, BR-2 as restated by R43)
- [ ] Admin-only consent-gate override with mandatory justification + audit (BR-3, TD-8)
- [ ] Presigned GET mint with full permission + child-context check, 10 min TTL (TD-12)
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
- [ ] Wire the library to real endpoints once the revision lands (delete the mock; the interface does not change)
  - ⚠ **Investigated 2026-07-30 and reported, not built.** Four hard blockers, all needing a Document Owner decision:
    **(1) No content LISTING endpoint exists or is documented anywhere in the SRS.** TD-3.5 defines only `POST /uploads/initiate|/complete|/abort` and `GET /content/{id}/download-url`; there is no `GET` route that lists content. Building one is inventing an endpoint (§20 rule 16) and needs a revision (Revision 21: later milestones add endpoints through subsequent revisions).
    **(2) `EducationalContent` has no uploader field**, so the requested *teacher display name* has no source. §7's field list does not define one either — this is a §7 change plus a forward-only migration.
    **(3) The presigned GET mint is unimplemented** (PENDING, M6), so private content cannot be previewed or downloaded at all.
    **(4) No content rows exist** and `/uploads/*` is unbuilt, so there is nothing to display.
  - ⚠ Three points where the requested design and §5.2 differ, for the Owner to settle: §5.2 mandates a **Subject** tier and a **"Global / بدون فرع"** container at the top of the branch tier (the brief omits both), and pins the **current** academic year at top (the brief asks strict newest→oldest).
  - ✓ **Previews need no architectural change** — §14.6 already specifies them (PDF inline, `<audio>`, image lightbox, office download-only) and public content sits behind stable same-origin URLs the CSP already allows. The one open question is that private content is served via 10-minute presigned URLs, so a long video can expire mid-playback.
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
