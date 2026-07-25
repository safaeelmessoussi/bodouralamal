# Software Requirements Specification
## بذور الأمل — Institute Management Platform

**Status:** Final MVP Blueprint (Revision 17 — audit attribution invariant: revocation is reconstructable from the AuditLog alone), **immutable source of truth** — changed only by an explicit Document Owner revision, never by an implementing agent
**Revision date:** 2026-07-24
**Canonical location:** `docs/SRS.md` in the project repository
**Document Owner:** [assign]

---

## 0. How to Read This Document

This is a standalone, self-contained specification. It does not reference external source files or prior drafts — everything relevant from prior planning, the security/architecture audit, the technical-readiness audit, the external implementation reviews, and the Revision-6 scope trim has been folded directly into the sections below. Where a decision needed explicit reasoning (because the obvious-seeming alternative is wrong for this project), that reasoning is included inline so an implementer — human or AI — doesn't accidentally regress it.

**Document structure:**
* **§1–§11** — product scope, functional requirements, data model, delivery plan, roadmap, risks (business-facing).
* **§12 — Business Rules Register (BR-x):** every invariant domain rule, stated technology-independently. These rules survive any future migration away from Node.js/Prisma/PostgreSQL.
* **§13 — Technical Design Constraints (TD-x):** state machines, permission matrix, API contract, transaction boundaries, cascade rules, database constraints, job catalog, audit coverage, validation limits, pagination/search, time policy, auth/session policy, configuration, observability.
* **§14 — UI/UX Standards:** sitemap/navigation map, screen CRUD standards, shared component registry, UI state standard, toast rules, file preview behavior.
* **§15 — Seed Data Specification** (production seed vs development fixtures).
* **§16 — Project Structure, Coding Conventions & Agent Workspace Files.**
* **§17 — End-to-End User Journeys.**
* **§18 — Module Acceptance Checklists.**
* **§19 — Environments, Deployment Pipeline & Testing Strategy.**
* **§20 — AI Implementation Rules:** hard guardrails for any autonomous coding agent. §20 closes the document deliberately: it is the last thing an agent reads before writing code.

**Revision 17 (Document Owner-authorised audit-attribution verification, 2026-07-25):** Revision 16 removed `revoked_by` from `RefreshToken` on the grounds that `AuditLog.actor_user_id` already carries the actor. The Document Owner required that claim to be **verified rather than asserted**, and verification found it true in principle but **not yet guaranteed** in three respects, all corrected here. **(1)** `auth.token_revoked` recorded only a *count* of affected sessions, so a revoke-all touching several sessions could not attribute a **specific** session from the audit trail alone — the detail now carries the **list of affected `session_id`s**. **(2)** `AuditLog.actor_user_id` is now explicitly **nullable**, because two mandated actions have no human actor by nature: replay-detected revocation (triggered by an unauthenticated request presenting a stolen secret) and the consent re-evaluation job's forced visibility changes. A null actor means *system-initiated*, not *attribution lost*; the `action_type` and `detail` carry the "why". **(3)** An **attribution invariant** is stated in §7: for anything revocable, who/when/why must be reconstructable **from the `AuditLog` alone**, without reading the affected row — which may have been purged by TD-7 or overwritten. That is the actual justification for having no `revoked_by` column: a duplicated actor is two records that can disagree. A revocation path that mutates state without its mandated audit row **in the same transaction** is therefore non-compliant, not merely under-logged. TD-4.13's wording is aligned with the Revision-16 implementation note that rotation leaves `revoked_reason` NULL.

**Revision 16 (Document Owner decisions — authentication state-machine audit, 2026-07-25):** resolves the four blocking findings of a pre-implementation state-machine review that verified 17 of 21 authentication paths and refused to guess at the rest. **(F1) `POST /auth/refresh` joins the TD-3.1 registry** — TD-12 mandated the route while TD-3 omitted it, so §3.1's CI conformance gate would have failed the very endpoint the session policy requires; TD-3 remains the single canonical route surface. **(F2) `RefreshToken` is added to §7** and its full surface with it: tokens stored **hashed, never raw**, unique on `token_hash` (TD-6); a `session_id` per rotation chain so "revoke this session" and "revoke the chain" are indexed updates rather than recursive walks that §16.2 would forbid; rotation, logout, and revoke-on-suspension as atomic transactions **TD-4.13/14/15** (suspension previously had *no* TD-4 row at all — a specification gap this revision closes); `auth.refresh`, `auth.logout`, `auth.token_revoked` added to TD-8; `token.purge` extended to expired tokens (TD-7); and the grace window pinned in TD-12 as **idempotent — the predecessor is accepted without minting a third token**, because a forked chain makes reuse detection impossible, while **any older or revoked token revokes the whole session** as a security event. Twelve numbered **token-lifecycle acceptance criteria (T1–T12)** are added to §18 and three named regression tests to §19.2. **Field evaluation (as instructed, lean-MVP):** `revoked_reason` and `session_id` are **in** because behaviour depends on them; `created_at`, `revoked_by`, `created_by_ip`, `last_used_at`, and `user_agent_hash` are **out**, each with its reason recorded in §7 so they are not re-added by reflex. **(F3 + F6) §4.1b step 4a routing is now complete:** `Rejected` — terminal and therefore still able to authenticate — routes to the existing "Account deactivated" screen with no new route and no new i18n key, and the condition names **`deleted_at` explicitly**, since status alone would hand a soft-deleted user a dashboard. **(F4) Soft-deleting an approved `FamilyLink` is declared the revocation mechanism** in §4.3: TD-1's `Approved` terminality is left intact because enforcement already exists — the child-context middleware returns `404` for a deleted link on the very next request — with a TD-2 permission row and a `familylink.revoke` audit row added. **(F5) OAuth flow state** (the `state` value and PKCE verifier) is specified as a short-lived signed `HttpOnly` cookie scoped to the callback, explicitly *not* an exception to the cookie-authentication rule. **(F7)** an `Active` account holding no role renders §14.4's `NoPermissionState`. §14.1 additionally clarifies that status interstitials are redirect targets rather than navigation nodes, so implementing them is not an invented section — and that no "log out everywhere" node exists or may be added.

**Revision 15 (Document Owner decision — pre-provisioned account lookup, 2026-07-24):** closes a genuine gap found while implementing the §15.1 Super Admin seed. §15.1 requires an account pre-provisioned against an email whose identity binds on first login, and §4.1b step 3 required "matching a pre-provisioned account by verified email" — but §4.1b step 4b **creates** the `UserIdentity` row at binding time, so no identity exists beforehand, and §7 defined `User` with **no email column**. There was literally nowhere to store the authorized address, making the documented flow unimplementable. **Resolution (Option (a)):** `User` gains a nullable **`pre_provisioned_email`** — the address authorized to claim an account *before any external identity exists* — stored lowercase with a database `CHECK` backstop and **unique among non-null values** via a partial unique index (TD-6). **`UserIdentity` continues to represent completed bindings only; placeholder or stub identity rows are explicitly prohibited** (§7), because a half-populated identity would break the "has an identity ⇒ has authenticated" predicate the whole login routing rests on. §4.1b now states the resolution order normatively — provider identity first (every login after the first), then the `pre_provisioned_email` fallback scoped to non-deleted users, then transactional binding (TD-4.10) with the column **retained rather than cleared**, so provenance survives and the address cannot be claimed twice. TD-10 email search now spans **both** `UserIdentity.email` and `User.pre_provisioned_email`, since the accounts staff most need to find are precisely the unclaimed ones. §15.1 seeds the Super Admin through this field, with no placeholder identity.

**Revision 14 (Document Owner decisions taken during M1, 2026-07-24):** three approved decisions, each resolving an item an implementing agent had escalated rather than assumed. **(1) Grading scale fixed:** the association scale is **/20** and the default passing grade is **10/20**, expressed canonically as `grading.display_scale = 20` and `grading.passing_grade_bp = 5000` and stored in **`SystemSetting` only** — §7 defines `Level`/`Category` as carrying no such column, so per-level overrides are settings rows, not schema (§4.6, §15.1, TD-13). **(2) Rate limiting is now explicitly two-layer:** Nginx keeps coarse **per-IP** edge protection, while quotas that must be counted **per authenticated user** move into the application, because `limit_req` keys on connection variables and cannot read a JWT subject, and its grammar admits only `r/s`/`r/m` so an hourly quota is inexpressible there. The **30 uploads/hour/user** quota is therefore enforced in the application with **PostgreSQL as the authoritative store** (`RateLimitCounter`, §7; unique key in TD-6; `ratelimit.purge` in TD-7), incremented inside the same transaction as the action it gates. **In-process memory is prohibited** (dies with the container, wrong across replicas), **pg-boss is prohibited** (a job queue is asynchronous; a quota decision must be synchronous and transactional), and **njs/lua must not be introduced** to drag this back to the edge (§3.1, §6, TD-13, §18). **(3) The version policy is replaced by a two-phase lifecycle** (§3.1a): during **Active Development**, patch-level dependency and image updates are permitted — each in its own dedicated commit, with a stated reason, a full CI re-run, the version table updated, and a ledger row — while major and minor upgrades and new frameworks remain prohibited without approval; at **MVP Feature Freeze**, everything freezes, image digests lock, lockfiles regenerate, a full dependency and security review runs, and the release candidate is cut, after which even patches require a dedicated approved upgrade task. The former blanket freeze-at-M0 rule left the build unable to absorb a CVE fix mid-implementation; this scopes the freeze to the phase where it earns its keep.

**Revision 13 (implementation-phase consistency sweep — Document Owner approved, 2026-07-24):** an M0 implementation review found the Revision-12 postponement sweep left the weight-template engine referenced without postponement annotations in several MVP sections; this created one operational contradiction — TD-3 §3.6 still listed the three grading-template routes, so the §3.1 CI conformance rule would have *required* endpoints §20 rule 16 *forbids* building. Resolutions, all documentation-consistency only (zero scope change): (A) the three grading-template routes are moved out of the active TD-3 registry into a postponement note (matching the §3.5 multipart pattern) — they are excluded from the MVP OpenAPI contract and the §3.1 CI conformance check until the engine ships; (B) remaining leftovers annotated or trimmed: §5.8 exam-lifecycle flow (formula-integration/recalc tail), the TD-2 grading-template permission row (removed; rejoins with the engine like the CSV/Trash rows), §15.2 fixture templates (deferred with the engine — §7 forbids pre-creating its tables), TD-8 `template.activate`/`template.demote` rows (marked post-MVP), §4.6 Interactive Grading Flow wording, the §2.1 Admin role description, and the §2.3 owner task (exam list stays a launch task; calculation templates follow the engine); (C) **TD-13: `NODE_ENV` officially admits `test`** as the §19.2 test-runner value — a non-production tier for every guard (§15.2 fixture firewall, TD-13 production-only rules, error verbosity); boot validation enumerates exactly `production | development | test` so typos fail fast rather than silently passing the non-production guard.

**Revision 12 (implementation-audit resolutions & deadline scope trim — Document Owner approved):** (B1) a sanctioned, narrow raw-SQL exception inside repositories for row locks and same-transaction pg-boss job inserts — the TD-4/TD-15 contradiction with the raw-SQL ban is resolved (§16.2, §20 rule 8); (B2) Nginx `/storage/` location must set `client_max_body_size 110m` and `proxy_request_buffering off` — scoped there only, API stays at 2m (§3.1, TD-13); (B3) OAuth callback failures are redirect flows with defined error keys, never JSON envelopes; `OAUTH_EXCHANGE_FAILED` added; single-flight client refresh mandated (§4.1b, TD-3.8, TD-12); (B4) production images are built in CI and pulled — never built on the 4 GB VPS (§19.1); connection-pool budget pinned (TD-13). **Postponed to §10.1 (deadline protection, fully additive later):** the dynamic basis-point weight-template engine and everything downstream of it (activation lifecycle, freeze/stale machinery, `grade.recalculate`, aggregation, `/admin/grading`) — MVP grades are per-exam and informational, which is a coherent state of the existing model since every exam already defaults to 0 bp; the in-app audio recorder (file upload of phone-made recordings stays fully supported — R-4 retired); FR/EN interface translation (Arabic-only launch; i18n keys remain mandatory); Committees; the `/admin/audit` browsing page (audit *writing* stays mandatory; reads via SQL runbook); the print-ready exam CSS layout. **Performance:** audio cap reduced 500→100 MB; `StudentSurahProgress` self-heal guard executed as one joined query on lists; container memory pins in TD-13; Vercel staging reviews UI against MSW mocks only — zero CORS allow-listing anywhere (§19.0).

**Revision 11 (dedicated single-tenant simplification — Document Owner decision):** the multi-tenant-ready architecture is **removed entirely**. The platform is a strict, dedicated single-tenant application operated exclusively for جمعية بذور الأمل: the `Tenant` entity, every `tenant_id` column, tenant-led composite indexes, the JWT `tenant_id` claim, tenant-scoped repository injection, and the multi-tenant roadmap item are all deleted. All state machines (TD-1), the permission matrix (TD-2), child-context verification (§4.3), consent enforcement, freshness checks, and every other security guard remain fully intact — they simply operate without a tenant dimension. **Recorded trade-off:** onboarding a second institute in the future means a separate dedicated deployment (own VPS, database, domain) or a deliberate re-architecture — there is no dormant tenancy layer to switch on. Do not speculatively reintroduce tenant columns.

**Revision 10 (security hardening & contract clarifications):** SRS TD-3 registry declared canonical over the generated OpenAPI artifact (§3.1); dependency majors locked at project initialization (§3.1a — **superseded by Revision 14's two-phase version policy**); fresh database assertion of `account_status`/authorization on high-risk endpoints regardless of unexpired access tokens (TD-12); staging never exercises authenticated flows through the Vercel origin — cookie attributes identical in every environment, `SameSite` downgrades prohibited (§19.0); registration identity fields extracted exclusively from the verified onboarding-token payload, request-body values ignored (§4.1b, TD-12); `StudentSurahProgress` self-healing cache for O(1) coverage reads (§4.5, §7); grade aggregation scoping + `group_id` provenance on Grade (§4.6, §7); absent-zero draft rows initialized at first draft save (§4.6); locked CLI restore script mandate (§4.10); `CHECK (email = lower(email))` at the database layer (TD-6); `Grade` and `User` added to the optimistic-locking registry (TD-15); access token carried in the `Authorization` header only — the refresh endpoint is the sole cookie-authenticated route and requires a custom header (CSRF posture, TD-12). A triage of the same review confirmed its demotion-recalculation, magic-byte, adult-student-bypass, and token-replay findings were already resolved in Revision 8 — recorded here so they are not re-litigated.

**Revision 9 additions:** global Concurrency Policy (TD-15: optimistic `version` locking on staff-edited entities, `SELECT … FOR UPDATE` on invariant-bearing transactions, first-wins state transitions); Migration Compatibility Policy (TD-6b: forward-only, expand–migrate–contract, no direct renames, data preservation mandatory); Degraded-Operation matrix for external dependencies (TD-16); explicit search semantics (TD-10: normalized substring, no fuzzy matching in MVP); Expected Operational Scale envelope (§2.4: ~900 launch users, 5,000-user design ceiling); Browser Support Matrix incl. per-browser recording containers and `audio/ogg` (§14.7, TD-9); expanded canonical error-code catalog incl. `VERSION_CONFLICT` and `SERVICE_UNAVAILABLE` (TD-3.8). A final six-term leftover sweep (import/export/multipart/resumable/notification/dashboard) confirmed every remaining occurrence is an intentional postponement annotation, §10.1 roadmap text, or in-scope usage.

**Revision 8 (architectural audit corrections):** ranged-GET magic-byte verification on upload complete (§4.9, TD-9); Nginx storage-proxy signature/Host/CORS/CSP rules (§3.1); onboarding-token replay protection via `jti` + `ConsumedToken` (§4.1b, TD-12, §7); adult-student bypass of the child-context header with strict Parent matching (§4.3, TD-12); grading-template demotion now **freezes** computed averages as stale — recalculation runs only on activation (§4.6, TD-1, TD-4, TD-7); Quran synchronous recalculation defined as derive-on-read immediately after commit — no materialized staleness, no long write locks (§4.5, TD-4.11); un-enrollment never deletes grades/submissions (TD-5); exam scores stored as integer basis points with round-half-up (§4.6, TD-6); Teacher Hidden-event visibility tightened to assigned-group scope (§4.4, TD-2); email lowercasing and explicit `CREATE COLLATION` registration (TD-6a, TD-12); empty-group uploads fall to Category defaults (§4.9); client-side Pending route guard (§14.4); restore runbook must reinstate cascaded link/role rows (§4.10). An audit-driven scrub confirmed no password-flow or password-audit remnants exist in MVP sections.

**Revision 7 additions:** the machine-readable configuration inventory (TD-13), the explicit Version Policy (§3.1a), and two mutable companion documents — `docs/IMPLEMENTATION_PLAN.md` (milestone build order) and `docs/TASKS.md` (granular agent-updated checklist). **Precedence is strict: this SRS is immutable and authoritative; the companion documents are derived working artifacts that agents update freely but that never override, reinterpret, or extend the SRS.** A Revision-7 consistency audit confirmed the four Revision-6 postponements (notifications, CSV import/export, multipart uploads, Trash UI) appear in MVP sections only as explicit postponement annotations — those annotations are intentional and must be kept (they are what AI rule §20.16 enforces against).

**Revision 6 scope changes (deliberate, do not silently revert):** In-app notifications, CSV/Excel import/export, S3 multipart resumable uploads, and the Trash restoration UI are **moved out of the MVP** to §10.1. Soft-delete columns, Trash snapshots, and hash-segmented immutable storage keys are **retained**. The Morocco-tuned Hijri overlay with admin offset **remains an active in-scope MVP requirement**. Structural entities use a **single Arabic `name` column** collated `ar-x-icu`. Parent→child context is verified per request via the **`X-Active-Child-ID`** header. The environment topology (Vercel staging frontend / local containerized backend / Moroccan production VPS) is defined in §19.0 with a hard fixture-data-only rule for anything outside Morocco.

Where §4 (functional) and §12–§20 (rules/constraints) describe the same behavior, they must agree; if an implementer ever finds a conflict, **§12 Business Rules win**, and the conflict must be reported, not silently resolved.

MVP authentication is Google OAuth only (§3.1, §4.1), with local username/password auth in the post-MVP roadmap (§10.1). The risk this creates for low-digital-literacy beneficiaries is deliberately recorded in §11 (Risk R-1) — do not remove that risk entry while it remains unmitigated.

**For AI coding agents:** do not re-read this entire document on every task. Read `docs/CHANGES.log` for current status, then only the sections relevant to the task at hand (§16.3). This document is the source of truth; `CLAUDE.md` / `AGENTS.md` are pointers to it, never overrides of it.

---

## 1. Introduction

### 1.1 Purpose
Digitize the day-to-day academic operations of **جمعية بذور الأمل**, a Marrakesh-based nonprofit association running Quran memorization, Islamic studies, and adult-literacy programs for women, teens, and children, currently run on paper and spreadsheets. The MVP replaces manual scheduling, account approvals, and grade tracking for the association's first live branch cohort.

### 1.2 Product Framing
This is a **strict, dedicated single-tenant application**, built, hosted, and operated exclusively for جمعية بذور الأمل. There is no tenancy dimension anywhere in the system: no tenant tables or columns, no tenant claims in tokens, no per-tenant configuration machinery (Revision 11). Should a second institute ever be onboarded, it would run as a **separate dedicated deployment** (its own VPS, database, and domain) or would justify a deliberate re-architecture at that time — the codebase carries no speculative multi-tenancy affordances.

### 1.3 Scope Boundary
This document covers the **MVP** (8-week delivery target, assuming AI-accelerated scaffolding for CRUD/boilerplate work — see §3.3) and a **fully detailed post-MVP roadmap** (§10) so nothing discussed during planning gets lost.

### 1.4 Definitions
| Term | Meaning |
|---|---|
| Association / الجمعية | بذور الأمل, the operating nonprofit |
| Branch / فرع | A physical location running sessions |
| Category / الفئة | One of the three tracks: Women (المرأة), Teens (اليافعات), Children (الطفل) |
| Level / مستوى بالجمعية | An academic tier within a Category |
| Group / مجموعة | A cohort within a Level with its own fixed weekly meeting time, room, and instructor(s) — the actual scheduling unit |
| Event / حدث | A one-off or exception calendar item (holiday, special activity, exam) layered on top of Groups' fixed schedules |
| Round / الدورة | A grading period within the academic year (roughly: a semester) — manually selected, not calendar-bound |
| Committee / لجنة | A cross-cutting organizational tag for teachers/levels (postponed to post-MVP, §10.1) |
| Follow-up | The informal process of an Admin noticing a student's drop-in engagement and checking in — not an automated system action |
| Basis points (bp) | Grading weight unit; 10,000 bp = 100%. 3,333 bp = 33.33% |
| Consent Record | An auditable database record of a specific consent grant/revocation (§4.1a) |
| BR-x / TD-x | Numbered Business Rule (§12) / Technical Design constraint (§13) |
| Global / No Branch (بدون فرع) | Content or events mapped to no specific branch (`branch_id = null`); write access restricted per §4.9 / TD-2 |
| Active child context | The linked minor a Parent is currently acting for, asserted per request via `X-Active-Child-ID` (§4.3, TD-12) |

---

## 2. Overall Description

### 2.1 User Classes
| Role | Description |
|---|---|
| Super Admin | Full system access, audit, application-level config, exclusive management of `display_order` values. Seeded at deployment by allow-listing a specific Google account email — no credential is ever hardcoded or documented in plaintext. |
| Admin | Scoped to one or more branches; manages users, groups, levels, approvals, content, consent overrides (grading templates: post-MVP, §10.1, Revision 13). May assign content/events to the Global (no-branch) scope. |
| Teacher / مؤطرة | Scoped to assigned groups (via `GroupTeacher`); logs Quran progress, grades, educational resources, and schedules/grades exams. Cannot override consent-driven privacy defaults (§4.9) and cannot assign content to the Global scope. |
| Student | Views own schedule, Quran progress, resources, and published grades. Takes remote online exams. **Adult students (Women's track) hold their own Google-authenticated accounts. Minor students (Teens/Children) do not have separate logins** — their records are accessed through a linked Parent's account context (§4.3). |
| Parent | Views linked children's data via a Family Dashboard; may hold other roles simultaneously. Acts as the login vehicle for minor students; asserts the active child per request via `X-Active-Child-ID` (§4.3). |
| Pending | Registered, awaiting Admin approval. On Google login, a `Pending` user is immediately redirected to a dedicated, prominently styled full-page status screen ("Your account is awaiting administrator approval") — **zero application data access** (TD-1). |

A single person may hold multiple roles concurrently (e.g., a mother who is both a Student and a Parent), switching context via an account switcher in the header.

### 2.2 Operating Constraints
* **Data Residency & Deployment Strategy:** All personal data must reside on Moroccan infrastructure (Law 09-08 / CNDP compliance). **Production** runs fully dockerized (multi-container `docker-compose`: Node.js/Express, PostgreSQL, MinIO) on a standard Ubuntu VPS hosted by a Moroccan provider (Inwi, MTDS, Orange, etc.) with zero manual cloud-vendor configuration. **Development and staging environments outside Morocco (Vercel frontend hosting, developer machines) must never contain real beneficiary data — fixture data only (§15.2, §19.0, Risk R-10).**
* **Connectivity:** Target users include people on unreliable mobile connections. Large-file operations must be kept to a minimum; in-app recording uses native browser codecs with no client-side transcoding (§4.9). MVP uploads are standard single-shot presigned uploads (multipart resumable uploads are the first storage item post-MVP, §10.1; fragility recorded as Risk R-9).
* **Digital Literacy & Google Account Constraint (MVP decision):** MVP authentication is **Google OAuth only** (§4.1). A meaningful share of beneficiaries are enrolled in adult-literacy programs and may not own a smartphone, email, or Google account. This is a **known, accepted MVP trade-off**, recorded as Risk R-1 (§11) with mitigations: staff-assisted Google account creation during in-person registration, and local username/password auth as the first post-MVP auth item (§10.1). The auth layer must be built pluggable (provider-abstracted identity table, §7) so local credentials can be added later without schema surgery. Do not silently reintroduce password flows into MVP; do not silently delete this constraint note.
* **Arabic-Only Entity Naming (single `name` column):** the structural master entities — **Branch, Category, Level, Subject** (and Committee when it ships post-MVP, §10.1) — each carry a **single `name` text column** (no `name_ar`/`name_fr` split). This column is **natively collated `ar-x-icu` at the database level via hand-written migration SQL** (TD-6a). Entity names are entered and displayed in Arabic in all UI languages; interface chrome is Arabic at launch, trilingual once the FR/EN catalogs ship (§10.1). This removes bilingual-name drift and guarantees correct Arabic sorting everywhere the column is ordered.
* **Admin-Defined Display Ordering Constraint:** Branch, Category, Level, and Subject carry an optional integer `display_order` field.
  * Whenever these entities are listed in the platform — select dropdowns, directory indices, navigation listings, dashboards — they sort ascending by `display_order`.
  * If `display_order` is null, blank, or equal, the system falls back to alphabetical sorting on the `name` column, which is correct automatically because the column itself is collated `ar-x-icu`. Default `C`/`en_US` collation sorts Arabic by codepoint and produces orderings that look wrong to every user — never use it.
  * **Scope of ordering:** Branches and Categories order application-wide, Levels within their parent Category, Subjects application-wide.
  * **Management:** `display_order` values are editable by **Super Admins only**.

### 2.3 Owner-Assignment Tasks (not engineering blockers, but real and currently unassigned)
| Task | Why it matters | Effort |
|---|---|---|
| Enter starter list of exams per level (calculation templates follow the post-MVP template engine, §10.1 — Revision 12 made MVP grades per-exam/informational; Revision 13 annotation) | Exam list needed at launch; without templates, round averages cannot be calculated once the engine ships | ~15 min per level |
| Confirm Moroccan-region hosting account exists and is provisioned (min 4 GB RAM + a second Moroccan location for offsite backups, §6) | Blocks production deployment entirely if missing | Procurement |
| Legally verify the explicit Parental Consent text (Arabic) for media/recordings, and version it | `ConsentRecord` stores the text version signed | Compliance |
| Create the Google Cloud project, OAuth consent screen, and production OAuth client credentials | Google-only auth cannot function without it; verification can take days–weeks | Procurement/admin |
| Collect or create Google accounts for all launch staff and first-cohort adult beneficiaries | Google-only MVP auth (Risk R-1) | Field/admin work |
| Confirm domain + DNS control for Let's Encrypt SSL (app + storage path) | Blocks the secure MinIO pipeline (§3.1) | Procurement |
| Estimate audio storage budget (recordings/week × avg size) against VPS disk sizing | 500 MB per-file cap (TD-9) can outgrow a small VPS disk within months | Planning |
### 2.4 Expected Operational Scale (design envelope)

Sizing reality, so implementers neither under-build nor gold-plate:

| Dimension | Launch (Year 1 start) | Design ceiling (build for this without re-architecture) |
|---|---|---|
| Total users (students + parents + staff) | **~900**, growing through the academic year | **5,000** |
| Branches / Rooms / Groups | 1–3 / ~10 / ~40 | 10 / 60 / 200 |
| Concurrent active sessions | ~50 | 300 |
| QuranProgressLog rows | ~30k/year | 200k total |
| Grades + submissions | ~15k/year | 100k total |
| EducationalContent objects | ~1k/year (audio-dominant; storage budget §2.3) | 10k |
| AuditLog rows | ~100k/year | 1M total |

**Implementation guidance (binding):** the single-VPS topology (§3.1, R-3) is the correct architecture for this entire envelope — do **not** introduce caching layers, read replicas, sharding, search engines, or horizontal scaling machinery for MVP (premature optimization is a defect here). Conversely, do not write code that dies at the ceiling: every list is paginated (TD-10), every hot path is index-backed (composite indexes matched to their query patterns, TD-6), no endpoint performs unbounded full-table scans or N+1 query loops, and the TD-11a latency targets are measured against **ceiling-scale fixture data**, not a ten-row dev database. Growth beyond the ceiling (a second institute) means a separate dedicated deployment or a deliberate re-architecture (§3.2) — not something MVP code should speculatively absorb.

---

## 3. Architecture

### 3.1 Stack
* **Frontend:** React (RTL-first). **Arabic-only at launch (Revision 12):** every UI string flows through i18n keys from day one (hardcoded text stays prohibited, §16.2), but only the `ar` catalog ships in MVP — FR/EN chrome translation is a post-launch content task (§10.1), not build work. Entity names are Arabic data (§2.2). Project structure and conventions: §16.
* **Backend:** Node.js/Express with Prisma ORM, OpenAPI-documented REST API. **Contract precedence (Revision 10, unambiguous):** the **SRS TD-3 route registry is the canonical API contract** — it defines which endpoints exist and their semantics. The OpenAPI document is a **generated artifact** of the implementation, useful for client generation and review, and **must conform to TD-3**: CI fails if the generated document contains an endpoint absent from TD-3 or omits a TD-3 endpoint (§19.2). The implementation is never the source of truth for the API surface, and the OpenAPI file is never hand-edited to "fix" a mismatch — mismatches are implementation bugs or SRS revisions, nothing else.
* **Database:** PostgreSQL, with `ar-x-icu` collation applied natively to the single `name` column of structural entities and to person-name columns used for sorting (§2.2, TD-10). **PostgreSQL-specific elements (custom collations, CHECK constraints, partial/functional unique indexes, triggers) cannot be declared in Prisma's `.prisma` schema syntax and must be implemented in hand-written SQL migration files** — see the migration workflow in TD-6a and the binding rule in §20.
* **Background Jobs:** **`pg-boss`** — a lightweight, Postgres-backed job queue for Node.js. Chosen deliberately over Redis/BullMQ to keep the single-VPS container count and memory footprint low. All async work runs through pg-boss with persistent, restart-safe job state (full catalog: TD-7). In-process fire-and-forget async is prohibited for anything that mutates grades or visibility (§20).
* **File Storage — Dual-Bucket MinIO Architecture:** Local S3-compatible object storage (MinIO) run inside Docker.
  * **`public` bucket:** holds only content whose `visibility = public`. Objects are served via stable URLs behind the Nginx reverse proxy.
  * **`private` bucket:** holds all `private` and `hidden` content, plus every group recording under a consent restriction (§4.9). Objects in this bucket are **never** exposed via stable URLs. Every read is served via a **short-lived presigned URL** (TTL: TD-12) minted by the API only after a server-side authentication + permission check against the requesting user's roles, links, active child context, and group enrollments.
  * **Visibility transitions move the object between buckets.** When public content is switched to private/hidden, the object is migrated to the private bucket and its old public key removed. Any user following a stale cached public link receives a **friendly platform error page** ("This content's access has changed — please log in or contact your branch administrator"), implemented as an Nginx error-page mapping on storage 403/404 responses. Never a raw XML S3 error.
  * Storage keys are immutable once written and include a short random path segment to defeat caching collisions (TD-9) — this key design is retained even though multipart resumable uploads are deferred (§10.1).
* **Nginx Same-Origin Routing (mandatory for cookies):** Nginx serves **the React client and the Express API under the same root domain using path prefixes** — client at `/`, API at `/api/v1/`, storage at `/storage/` (e.g., all under `https://platform.bodour.ma`). This guarantees the `HttpOnly; Secure; SameSite=Lax` refresh cookie (TD-12) is first-party on every API call — **no cross-subdomain or cross-origin split between client and API is permitted**, as it would break SameSite cookie delivery. Both the API and MinIO are wrapped under one Let's Encrypt SSL envelope.
  * **Storage-proxy signature integrity (S3 presigned URLs through Nginx):** presigned URLs are **generated against the public storage origin (`STORAGE_BASE_URL`)** so the signature matches exactly what the browser sends through the proxy. The Nginx `/storage/` location must: strip the `/storage` prefix when forwarding to the MinIO upstream, and **rewrite the `Host` header consistently with the endpoint the signature was computed for** — any mismatch between signed host/path and proxied host/path produces `SignatureDoesNotMatch` failures. A signed PUT + signed GET round-trip through the proxy is a mandatory acceptance test (§18) — never "verified" by direct-to-MinIO access.
  * **Upload passthrough (binding — the two directives that decide whether uploads work at all):** the `/storage/` location sets **`client_max_body_size 110m`** (Nginx defaults to 1 MB — without this every recording upload dies with an Nginx-level 413) and **`proxy_request_buffering off`** (default buffering spools the entire body to Nginx’s disk before forwarding to MinIO — doubled disk I/O and a disk-fill vector on a small VPS). **Both are scoped to `/storage/` only; the `/api/v1/` location stays at `client_max_body_size 2m`** — never raise the body limit globally to “fix” uploads. Static assets are served with `gzip` (and `brotli` if available) for weak mobile links.
  * **CORS & CSP:** because client, API, and storage share one origin, cross-origin requests are not part of normal operation — Nginx therefore does **not** emit permissive CORS headers (no `Access-Control-Allow-Origin: *`); with no exceptions in any environment — Vercel staging runs on MSW mocks and calls no real backend (§19.0). Nginx sets a restrictive `Content-Security-Policy` on client responses (`default-src 'self'`; media/img/connect sources limited to `'self'` — which covers `/storage/` by same-origin — plus Google OAuth endpoints), along with `X-Content-Type-Options: nosniff` and `frame-ancestors 'none'`.
* **Auth — Google OAuth only (MVP):** All human logins (Super Admin, Admin, Teacher, Parent, adult Student) authenticate exclusively via Google OAuth, following the exact onboarding sequence in §4.1b. No passwords, no password hashes, no password-reset flows in the MVP. Minor students have no login identity at all (§4.3). The identity layer is provider-abstracted (`UserIdentity` table keyed by provider + provider subject ID, §7) so that local credentials can be added post-MVP (§10.1) without restructuring `User`. Session/token policy: TD-12.
  * **Staff-assisted registration under Google-only auth:** staff pre-provision an account by entering the beneficiary's details plus their Google email; the account binds to the Google identity on that email's first successful login (§4.1b step 4b). Where the beneficiary has no Google account, staff assist in creating one during in-person registration (Risk R-1, §11).
* **Rate Limiting — two layers with distinct jobs (Revision 14):**
  * **Edge (Nginx):** coarse **per-IP** burst protection for login and general API traffic (values in TD-13). Never in-process memory — limits survive container restarts and remain correct if the API is ever scaled to multiple containers.
  * **Application (authoritative, per-user quotas):** quotas that must be counted **per authenticated user** cannot be enforced at the edge, because Nginx's `limit_req` keys on connection variables and cannot read a JWT subject; its rate grammar also accepts only `r/s` and `r/m`, so an hourly quota has no representation there. The **upload-initiation quota of 30 per hour per user (TD-13)** is therefore enforced **in the application**, where the identity is known.
  * **The authoritative quota store is PostgreSQL** (`RateLimitCounter`, §7). This is a deliberate, Document-Owner-approved choice: in-process memory is prohibited (it dies with the container and is wrong across replicas), and pg-boss is prohibited (it is a job queue, not a counter store — TD-7 jobs are asynchronous, whereas a quota decision must be synchronous and transactional with the request it gates). **Do not introduce the njs/lua module to move this back to Nginx.**
  * A quota rejection returns `429 RATE_LIMITED` in the standard envelope (TD-3.8), identically to an edge rejection, so clients handle one shape.
* **Environments & Deployment:** three-tier topology defined normatively in §19.0 — local containerized development, Vercel-hosted staging frontend against a local containerized backend (fixture data only), and a unified Moroccan-region production VPS.

### 3.1a Version Policy (binding — replaced in Revision 14)

Pinned major versions at specification time. **Target the latest stable versions available at implementation time unless an incompatibility is documented in `docs/CHANGES.log`** — but never drop below the floors here, and never substitute a different technology (the frontend is React + Vite; **Next.js is not part of this stack** and must not be introduced by an agent, as it would break the same-origin Nginx routing model §3.1).

| Component | Version floor | Notes |
|---|---|---|
| Node.js | 22 LTS | Even-numbered LTS lines only; pin the exact version in the Docker base image |
| PostgreSQL | 17 | ICU support required for `ar-x-icu` (TD-6a) |
| Prisma | 6 | Migration workflow per TD-6a; `db push` prohibited |
| React | 19 | — |
| Vite | 6 | Build/dev tooling for the React client (§19.0) |
| Express | 5 | — |
| TypeScript | 5.x strict | §16.2 |
| pg-boss | 10 | TD-7 catalog |
| MinIO | latest stable server release | Dual-bucket + presigned URLs (§3.1) |
| Nginx | stable branch | Same-origin path routing, rate limits, SSL (§3.1) |

Exact patch versions are locked by `package-lock.json` and the Docker image digests. **Major and minor versions are evaluated exactly once, at project initialization (M0)**, when the lockfiles are first created.

**Two-phase lifecycle (Revision 14 — Document Owner decision, replacing the blanket freeze-at-initialization rule).** The former policy froze *everything* at M0, which left the build unable to absorb a security patch during a multi-week implementation. The freeze is now scoped to the phase where it earns its keep:

**Phase 1 — Active Development (from M0 until MVP feature freeze; the phase in force during M1–M7).**
* **Permitted:** patch-level updates to dependencies and container images — e.g. Node `24.11.0 → 24.15.0`, PostgreSQL `18.3 → 18.4`, Prisma `7.9.0 → 7.9.2`.
* **Prohibited:** **major** version upgrades · **minor** version upgrades · introducing any new framework or infrastructure component without Document Owner approval.
* Every patch update must, without exception: (a) be made in **its own dedicated commit** touching nothing else; (b) **state the reason** — bug fix, CVE remediation, compatibility; (c) **re-run the complete CI pipeline** (§19.2); (d) **update the version table below** wherever exact versions are documented; (e) be **recorded in `docs/CHANGES.log`**.
* A patch update is never a side effect of another task, and never an agent's unprompted initiative — it is a task in its own right, whose ledger row states why it was needed.

**Phase 2 — MVP Feature Freeze (once all MVP functionality is complete, i.e. entering M8).**
* Freeze **every** dependency version; **lock container image digests** (not merely tags); **regenerate lockfiles**; perform a **full dependency and security review**; produce the **MVP release candidate**.
* After the feature freeze, any dependency change — patch included — is permitted only through a **dedicated, Document-Owner-approved upgrade task**.

The floors in the table below are absolute in both phases: no update may drop below them, and no update may substitute a different technology.

### 3.2 Multi-Tenancy Posture
**Revision 11 — the multi-tenant posture is removed.** The platform is a dedicated single-tenant system for one association; the schema, tokens, repositories, and configuration carry **no tenant dimension whatsoever**. This is a deliberate simplification: one association at §2.4 scale gains nothing from dormant tenancy plumbing, and deleting it removes an entire class of scoping bugs. **Consequence, accepted knowingly:** onboarding a second institute in the future means either (a) a **separate dedicated deployment** of this same codebase — its own Moroccan VPS, database, MinIO, and domain, operationally cheap given the fully-containerized §19.1 pipeline — or (b) a deliberate, owner-approved re-architecture. No implementer may reintroduce tenant columns, claims, or scoping speculatively.

### 3.3 What AI-Accelerated Development Does and Doesn't Compress
CRUD scaffolding, schema migrations, standard REST endpoints, and UI layout generation are fast under AI-assisted workflows — hours, not days. **Business-logic-heavy components are not compressed by this** and must be planned as full engineering effort regardless of tooling: the Quran coverage interval-merge calculation, the dynamic grading/exam engine (basis-point invariants, recalculation lifecycle), the auth/permission boundary logic (especially the child-safeguarding approval gate, the `X-Active-Child-ID` verification middleware, and the consent re-evaluation engine), the presigned-URL permission layer, and the dual calendar rendering.

### 3.4 Payments — Deferred, with a Concrete Direction
Online fee/donation collection is post-MVP (§10.2). **Stripe is not a viable option for this project and is removed entirely** — Stripe does not accept Moroccan-issued bank cards directly for local entities. The Moroccan market is built around **CMI** (Centre Monétique Interbancaire — the interbank gateway backed by Moroccan banks, standard 3D Secure hosted-page integration) or an aggregator layer on top of it such as **PayZone**, which typically onboards faster for smaller organizations. **Recommended direction when this phase starts:** open a CMI merchant account through the association's bank if the onboarding timeline is acceptable; use a CMI-aggregator like PayZone as a faster-to-launch alternative if not. This is a vendor/banking decision requiring re-verification at that time.

---

## 4. Functional Requirements

### 4.1 Authentication & Registration
* **Single login mode (MVP): Google OAuth.** Every active account is keyed to a unique Google email. Minor students (Teens/Children) have **no login of their own**; they exist as student records accessed exclusively through an approved linked Parent's account context (§4.3).
* **Unified Parent + Child Registration (public self-service):**
  * A parent who already has a platform account logs in and submits a child-registration request from the Family Dashboard.
  * A parent with no account follows the OAuth-first onboarding sequence (§4.1b), landing on a **unified registration form** capturing both Parent details (Arabic name, optional French name, nickname, phone — non-unique, families share phones — notes with a server-enforced length cap, TD-9) and Child details in one pass. Submission creates the Parent account (already bound to their verified Google identity) and the linked child student record **in a single database transaction** (TD-4) — never a parent without their child or vice versa.
  * Adult students (Women's track) register themselves directly with their own Google account via the same OAuth-first sequence.
* **Consent capture at registration:** every form carries the generic data-processing consent checkbox; registration forms for Teens and Children additionally carry the **explicit, separate Parental Media Release checkbox**: *"I consent to my child's voice/recordings being published on public class content."* Each checkbox decision is persisted as a **`ConsentRecord`** (§4.1a) — never as a bare boolean column on the user row (§20).
* **Staff-assisted registration** remains a first-class path: staff register any beneficiary directly (including recording consent choices declared in person), pre-provisioning the account against the beneficiary's Google email (§3.1, §4.1b step 4b).
* All new registrations enter `Pending` status; Admin approval is required before any role-bearing access is granted. A `Pending` user who authenticates via Google is hard-redirected to the dedicated approval-status screen (§2.1) — the `Pending` state grants **zero** access to any authenticated visibility tier (§4.4, TD-1).
* Soft-deleted/deactivated accounts show "Account deactivated — contact your branch admin" on login attempt. Never silently re-register or reactivate. **This one screen also serves `Rejected` accounts (Revision 16)** — rejection is terminal (TD-1), so a rejected applicant who authenticates lands here rather than on a dashboard; the routing condition is spelled out in §4.1b step 4a and reuses this existing message and i18n key.

### 4.1a Consent Records (safeguarding data model)
* **`ConsentRecord` entity** (§7): one row per consent decision, carrying: student, consent type (`media_release` | `data_processing`), granted/revoked state, who granted it (parent user or staff actor on behalf of an in-person declaration), the exact **consent text version** agreed to, method (`online_form` | `staff_recorded`), and timestamps. Revocation creates a state change with its own actor + timestamp — history is never overwritten.
* A student's *effective* media-consent status is derived from their most recent `media_release` record. **Absence of any record = no consent** (BR-1).
* **Dynamic re-evaluation trigger (hard requirement):** the group-level media-consent gate (§4.9) is **not** a point-in-time upload check. It must be re-evaluated automatically on every one of these events:
  1. a student **enrollment change** in any Group (add or remove),
  2. any **`ConsentRecord` change** (grant or revocation) for a currently-enrolled student,
  3. every **recording/content upload** to a Group's sessions.
  Each event enqueues a pg-boss consent re-evaluation job (TD-7) for the affected Group(s), which recomputes the group's consent state and force-corrects the visibility of all affected session-recording resources (public → private migration through the bucket-transition mechanism, §3.1). A recording published while all students consented **must** flip to private if a non-consenting student later enrolls or a parent revokes.

### 4.1b Google OAuth Onboarding Sequence (normative flow)

The registration/login entry is **OAuth-first**: the registration form is never shown before Google authentication, so the verified Google identity is always captured at account creation. Exact sequence:

1. Visitor clicks **"Register / Continue with Google"** (on `/register` or `/login` — same OAuth entry).
2. The Google OAuth flow executes (`state` + PKCE, TD-12). Google returns the verified `email` and `provider_subject_id`.
3. **Resolution order (normative, Revision 15).** The server resolves the account in exactly this order, always against the **lowercased** verified email (TD-12):
   1. `UserIdentity (google, provider_subject_id)` — the provider identity. **Every login after the first takes this path**, which is why it is consulted first.
   2. Failing that, `User.pre_provisioned_email = <verified email>` among **non-deleted** users (§7) — the staff pre-provisioned account awaiting its first binding. `UserIdentity` is never consulted for this fallback, because unbound accounts have no identity row at all (§7, Revision 15).
4. Routing decision:
   * **4a — Identity exists:** establish session and route on the **complete** condition below (Revision 16 — the earlier enumeration omitted `Rejected` and did not name `deleted_at`, leaving two reachable states undefined):
     * `account_status = Active` **AND** `deleted_at IS NULL` → role dashboard.
     * `account_status = Pending` **AND** `deleted_at IS NULL` → approval-status screen, zero data access (TD-1).
     * `account_status ∈ {Rejected, Suspended}` **OR** `deleted_at IS NOT NULL` → the **"Account deactivated" screen** (§4.1), which serves rejected, suspended and soft-deleted accounts alike. **Never reactivation** — authenticating does not change any status (§4.1, TD-1: `Rejected` is terminal and re-registration requires staff action). Rejected reuses the existing screen and message: no new route, no new i18n key.
     * Routing on `account_status` alone would hand a soft-deleted user a dashboard, because a soft-delete sets `deleted_at` without necessarily moving the status — hence both terms.
   * **4b — No identity, but a pre-provisioned account matches the verified email:** **create** the `UserIdentity` row and bind it **transactionally** (TD-4.10), then route by that account's `account_status` (typically `Pending` → status screen, or `Active` if staff pre-approved). `pre_provisioned_email` is **retained, not cleared** (§7). From this point the account is bound, so every subsequent login resolves at step 3.1 and never touches the fallback. A `Suspended`/deleted match routes to "Account deactivated" and is never reactivated by the act of logging in (§4.1).
   * **4c — No identity, no pre-provisioned match (brand-new person):** the client redirects to the **Unified Parent + Child Registration form** (or the adult self-registration form, chosen by the visitor), with the parent's Google **email pre-populated and read-only**. A short-lived, single-use signed onboarding token (10 min TTL) carries the verified `email` + `provider_subject_id` to the form-submission endpoint — the client can never substitute a different email. **Single-use is enforced mechanically, not aspirationally:** every onboarding token carries a unique **`jti` claim**; at submission, the `jti` is inserted into the **`ConsumedToken`** table (§7) **inside the registration transaction** (unique constraint on `jti`, TD-6) — a replayed token hits the uniqueness violation, the transaction aborts, and the request fails with `409 STATE_CONFLICT`. Consumed rows expire naturally and are purged by the daily token-purge job (TD-7).
5. On form submission, the server verifies the onboarding token (signature, TTL, unconsumed `jti`) and **extracts the parent `email` and `provider_subject_id` exclusively from the verified token's payload — any email or OAuth identifier present in the HTTP request body is ignored entirely** (the Zod schema for this endpoint does not even accept those fields; a client cannot bind a different identity than the one Google verified). It then executes the registration transaction (TD-4.1), creating the User(s), `FamilyLink`, `ConsentRecord`(s), the `UserIdentity` row, **and the `ConsumedToken` row** atomically. The new account enters `Pending`. Emails are **normalized to lowercase** before every lookup and write (TD-12), and the database independently enforces lowercase storage (TD-6).
6. Abandonment: if the form is never submitted, nothing is persisted — no orphan identities, no partial users.
7. **Callback failure handling (Revision 12 — redirects, never JSON):** the OAuth callback is a browser redirect flow; its failures never emit the TD-3.8 envelope. Every failure redirects to **`/login?error=<key>`**, rendered as a friendly i18n message with a retry affordance: `user_denied` (consent refused at Google), `state_mismatch` (state/PKCE validation failed — also logged as a security event), `oauth_unavailable` (Google unreachable / timeout / 5xx on code exchange — server-side this surfaces as `OAUTH_EXCHANGE_FAILED`, TD-3.8), `email_unverified` (Google reports the email unverified — hard stop, no account touch). No partial state is ever persisted on any failure path.

### 4.2 Roles & Scoped Access Control
* Multi-role support per user (e.g., simultaneously Parent and Student).
* **Branch-level scoping only for MVP.** Admin accounts are scoped to one or more branches. Committee-based or category/level-based admin scoping exists conceptually (§4.4b) but is not built as a permission-control layer in MVP — branch scoping is the sole access-control axis.
* Teacher-to-group assignment (including co-teaching) is stored in the **`GroupTeacher`** join table (§7); all teacher scoping (exam authoring, Quran logging, sensitive social-data access §4.10) resolves through it.
* The full action-by-role permission matrix is defined in **TD-2** and is normative.
* JWT includes user roles and branch scope assignments (claims detail: TD-12). The active child context is **never** stored in the JWT — it is asserted per request via the `X-Active-Child-ID` header and verified server-side (§4.3).

### 4.3 Family Model & Child Safeguarding
* Unlimited parent-child linking (many-to-many).
* Minor students are login-less records; **every access path to a minor's data flows through an approved `FamilyLink`** or through staff roles.
* **Dynamic child-context verification (`X-Active-Child-ID`) — normative:**
  * When a Parent switches children in the account switcher, the client sends the **`X-Active-Child-ID` HTTP header** on every subsequent request that reads or acts on child data (child calendar, Quran progress, grades, exam-taking, child-scoped resources).
  * **Acting-student resolution (middleware, in order):**
    1. **Header present** → the caller is acting as a Parent: middleware verifies an **`Approved` `FamilyLink` row matching BOTH the authenticated Parent (`sub` from the JWT) AND the header's child ID**. Matching on the child alone is never sufficient.
    2. **Header absent + caller holds the `Student` role** → **the child-context check is bypassed entirely**: the acting student is the caller themself, and ownership is verified directly against the JWT `sub` (an adult student reads/writes only rows keyed to their own user ID). Adult students never need — and never send — the header.
    3. **Header absent + caller is Parent-only** (no Student role) on a student-context endpoint → `400 VALIDATION_FAILED` (the request is ambiguous without a child).
  * Server-side verification is the enforcement; client-side context switching is presentation only.
  * Failure semantics (TD-3.8): case 3 above → `400`; header present but no approved (parent, child) link — pending, rejected, deleted, nonexistent, or a link belonging to a *different* parent → `404 NOT_FOUND` (never distinguish "no such child" from "not your child" — no existence leaks).
  * The resolved acting-student ID (own `sub` or verified child) is what downstream policies and repositories receive; they never trust a student ID from the request body or query string for authorization purposes.
* **Revoking an approved link (normative, Revision 16):** **soft-deleting the `FamilyLink` row IS the revocation mechanism.** `Approved` stays terminal in TD-1 — no `Approved → Revoked` transition exists or should be added — because the enforcement is already complete: the `X-Active-Child-ID` middleware re-checks the row on every request, and a deleted link is already among the conditions returning `404 NOT_FOUND` (failure semantics below). Revocation therefore takes effect **on the very next request**, which is exactly what TD-12 promises. Revocation is an Admin/Super Admin action (TD-2), writes `familylink.revoke` (TD-8), and follows the ordinary soft-delete transaction (TD-4.8: `deleted_at/by` + `Trash` snapshot + audit). The partial unique index on `(student_id, parent_id)` covers non-deleted rows only (TD-6), so a revoked link can be requested again later as a fresh `Pending` record.
* **New parent-child link requests enter a pending state requiring Admin/staff approval** before granting any visibility into the child's record — self-service link creation is never immediately active.
* Children created through the unified registration transaction (§4.1) still enter the approval queue as a (parent + child + link) bundle — approval activates all three atomically (TD-4).
* The Family Dashboard reflects only approved links, and lets a parent switch between linked children's contexts.

### 4.4 Scheduling & Calendar
* **Scheduling is Group-driven, not Event-driven.** A Group carries its own fixed `day_of_week`, `start_time`, `end_time`, `room_id`, `branch_id`, and `max_students`. Students enroll into a Group, and that enrollment implies their standing weekly class time — there is no separate "recurring session" object per group.
* **Events are the exception/special-activity layer:** holidays, one-off activities, exams, makeup sessions, ceremonies — anything that isn't "this group's normal weekly slot."
* Group CRUD with conflict detection (same room/time overlap), co-teaching (two instructor slots per group via `GroupTeacher`), room assignment, capacity.
* **Branch Operational Boundary & Date Strategy:** The system uses the Gregorian calendar to calculate schedules and recurrence patterns, on **local Moroccan wall-clock time** (timezone policy: TD-11). **The Hijri overlay is an active, in-scope MVP requirement (Revision-6 reaffirmation — do not descope):** Hijri dates render as a decorative UI overlay, calculated via a **Morocco-tuned Hijri source** (Morocco's Ministry of Habous determines Hijri dates by local moon sighting and regularly differs from Umm al-Qura and generic library algorithms), plus a **global Admin-adjustable day-offset parameter (−2 to +2 days)** in System Settings (§5.7).
  * Each `Branch` carries an `operational_start_date`. In calendar views scoped to a branch, any date grid prior to this date is visually grayed out with no scheduling data or events rendered.
* **Three-Tier Calendar Event Visibility** — stored as a strict `visibility` enum (`public | private | hidden`) on `Event` (never a boolean):
  1. **Public:** Visible to unauthenticated visitors and all logged-in, **approved** users.
  2. **Private:** Hidden from the public. Visible to **any logged-in approved Student** (accepted decision: not filtered by the student's own branch/group — deliberate, recorded trade-off, Risk R-6 §11), to Parents in the context of linked students, and to Staff **within their branch scope**.
  3. **Hidden:** Hidden from all Student and Parent accounts. Visible to **Teachers only for events whose scope intersects their assigned groups** (an event scoped to the group itself, to the group's level, category, or branch, or a global event — resolution via `GroupTeacher` → Group; a Teacher never sees Hidden events belonging exclusively to groups/levels/branches they are not assigned to), and to **all Admins regardless of branch scope** (accepted decision), plus Super Admins.
  * `Pending` users see only the Public tier (effectively nothing beyond the public calendar — hard-redirect on login, §4.1).
* Full dual-date (Hijri/Gregorian) calendar: Monthly/Weekly/Agenda views, branch/level/group filters, a unified grid rendering both the recurring Group timetable and one-off Events, and a session detail popup. Week starts Monday. The calendar supports a quick "day + morning/evening" glance view in addition to exact times.
* Event recurrence must support: none, daily, weekly, **biweekly-alternating ("week on/week off")**, and yearly. The alternating-week pattern must be modeled and tested explicitly.
* **Multi-scope events:** An Event may apply to multiple branches, categories, levels, or groups simultaneously. When a global/multi-scope event is created, **the system explicitly populates the join tables** — `EventBranch`, `EventCategory`, `EventLevel`, `EventGroup` (§7) — at creation time (only for branches whose `operational_start_date` has occurred or is in the past), never runtime null/wildcard evaluation.
* **Branch-activation backfill:** when a Branch's `operational_start_date` arrives (or a new branch is created), Admins have a **manual backfill action** listing applicable global/recurring events to attach — or knowingly skip. The gap is never silently auto-filled and never silently ignored.

### 4.4b Categories, Levels & Subjects
* Three Categories: Women (المرأة), Teens (اليافعات), Children (الطفل).
* Seed data: Women 8 levels (0–7, level 0 = literacy), Teens 6 levels (1–6, no level 0), Children 7 levels (0–6). **Level numbering is not structurally uniform across categories** — no UI or progression logic may assume every category has a level 0.
* **Naming:** Category, Level, Branch, and Subject each carry a **single Arabic `name` column, natively collated `ar-x-icu`** (§2.2, TD-6a). No bilingual name columns exist on structural entities.
* Levels, Categories, and Groups are fully Admin-editable (create/edit/delete/reorder — reorder via `display_order`, Super Admin only §2.2). Deletion guarded per TD-5.
* A `gender_restriction` field (`any | girls_only | boys_only`) lives on the Level entity, checked generically by certification/progression logic rather than hardcoded against a level name.
* **Committees — POSTPONED to §10.1 (Revision 12):** a purely informational tag with zero permission function; its entity and join tables are not built in MVP.
* **Subject** exists for non-Quran curriculum items (Tafsir, Fiqh, etc. — the Quran itself is never a Subject; Quran memorization is tracked exclusively by the dedicated progress engine §4.5). Subject-to-Level assignment: **`LevelSubject`**; Surah-to-Level assignment: **`LevelSurah`** (§7).
* Creating a `LevelSubject`/`LevelSurah` row auto-creates draft grading components, preventing curriculum assignment and grading configuration from silently drifting apart (BR-9).

### 4.5 Quran Memorization Tracking
* Teacher-logged ayah ranges per student, tagged `category` (new_memorization / revision).
* **Storage:** discrete records of Surah + closed ayah range (e.g., `(surah_id: 2, start_ayah: 10, end_ayah: 20)`), validated per TD-6.
* **Pre-Seeded Surah Lookup Metadata:** static, read-only table of all 114 Surahs: `surah_id` (1–114), `name_arabic`, `name_transliterated`, `total_ayahs` (the definitive denominator).
* **Interval-Merge Algorithm (BR-13):** coverage percentage = the mathematical union of all merged, non-overlapping logged intervals per Surah. Overlapping logs must not inflate progress.
  * *Example:* `[10–20]`, `[10–30]`, `[30–123]` merge to `[10–123]` = 114 ayahs. Percentage = `(merged ayah count / total_ayahs) × 100`.
* **Log mutation → immediate synchronous recalculation (Revision-6 clarification, Revision-8 mechanics):** creating, **updating, or soft-deleting** any `QuranProgressLog` record triggers a **synchronous recalculation** of that student's merged coverage for **that specific Surah**, inside the same request — never deferred to a background job. **Mechanics (binding, Revision 10 — self-healing cache):** the source of truth is always the logs; a **`StudentSurahProgress` cache row** (§7) provides O(1) reads. The mutation request (a) commits the log write in a short transaction — no aggregate computation inside it, so no long-held locks; then (b) **immediately after commit, in the same request**, computes the fresh union from the committed rows, **upserts the cache row** (merged coverage %, merged interval set, and a `last_log_id`/`last_log_at` stamp of the newest governing log), and returns the fresh value in the response. **Read-side correctness guard:** every consumer of the cache (dashboards, list pages, level-completion checks BR-11) compares the row's stamp against the student+surah's latest log (a cheap indexed max) and, on mismatch — e.g., a crash in the window between commit and cache upsert — **recomputes from the logs and repairs the row in place** before using the value. **List pages execute the guard as ONE joined query** (cache rows LEFT JOIN each pair's latest log id) — never as per-row cache-read + per-row max(log) lookups, which would be a stealth N+1 wearing a cache costume; the union merge runs only on writes and on self-heal. This preserves the BR-13 no-staleness invariant (the guard makes stale reads structurally impossible) while eliminating the O(n·logs) read cost the pure derive-on-read design would have incurred at §2.4 scale. Rationale: a teacher correcting a mis-logged range must see the corrected percentage immediately; a stale figure after a deletion would misreport progress and could wrongly signal level completion (BR-11). Log edits/deletions are Teacher/Admin actions on their own students, soft-deleted per BR-15.
* **Auto-exam trigger — removed from MVP.** 100% coverage does **not** auto-create an exam; teachers create exams manually. The automated, idempotent trigger is post-MVP (§10.1).
* Student dashboard shows a per-surah expandable progress view (coverage %, log history). Students view read-only; only teachers log entries.

### 4.6 Grading & Exam Engine (Online Exam Builder)
* **Exam Independence & Floating Rounds:** Exams are created independently of strict calendar bounds or rounds; each carries a `date`, optional `subject_id`, optional `surah_id`, and a `level_id`. Rounds are optional, non-restricting logical selectors used solely for sorting on transcripts and dashboards.
* **Women's Program Level Generation:** creating a `LevelSurah` row for a Women's level (excluding literacy) auto-generates two draft, floating components: `[Surah Name] Memorization` and `[Surah Name] Tafsir`.
* **Weight-template engine — POSTPONED to §10.1 (Revision 12, deadline protection):** the dynamic basis-point template allocator, its activation lifecycle, the freeze/stale machinery, `grade.recalculate`, and aggregation/averages are **not built in MVP**. This is a coherent state of the existing model, not a hack: every exam already defaults to **0 bp / informational**, so “no templates exist” simply means *all* grades are per-exam informational entries — exactly what the association needs for the first months of the semester. Students/parents see published per-exam grades; no averages are displayed anywhere. The engine lands post-MVP as a **purely additive layer** (`GradingTemplate`/`GradingTemplateItem` reference exams by FK; nothing in MVP references them back), with its full specification preserved in §10.1. **Do not hardcode an interim average formula** — an interim formula is a second grading engine that would have to be ripped out.
* **Absent / missing grade semantics (BR-7):** when a weighted exam's grades are published and an enrolled student has no submission/mark, the student's grade is **`0`, flagged `absent = true`**. **Initialization timing (Revision 10):** the absent-zero draft rows are created at the moment the teacher **first saves the grade sheet as a draft** — every student on the Group roster without a score gets a draft `0`/`absent` row immediately, so intermediate draft averages shown on teacher dashboards already include absentees and are never inflated by their omission. Rows remain replaceable (late entry or makeup) up to and after Publish; otherwise 0 counts as 0. No silent weight renormalization, no permanently-pending averages.
* **Pass/fail:** default minimum passing grade configurable per level. **The association grading scale is /20 and the default passing grade is 10/20 (Revision 14, Document Owner decision)** — expressed canonically as `grading.display_scale = 20` and `grading.passing_grade_bp = 5000`, i.e. 50% of the exam total in basis points, so the comparison stays integer-only end to end (§20 rule 3). Both values live in **`SystemSetting` only** — neither `Level` nor `Category` carries a passing-grade or display-scale column, because §7 defines those entities as carrying only `name`, `display_order`, and (for Level) `gender_restriction`. Display converts basis points to the /20 scale at render time only. **Teachers/Admins can manually override pass/fail per student**, stored separately with actor/timestamp capture in the `AuditLog` (TD-8).
* **Draft/Publish:** grades/exams are draft (invisible to students/parents) until an explicit Publish action (BR-8). (Re-publish after recalculation belongs to the post-MVP engine, §10.1.)
* **Exam scoring in integer basis points (Revision 8):** all exam scores — question max-points, MCQ auto-scores, subjective marks, and the final combined score — are stored as **integer basis points of the exam's total (0–10,000 bp)**; no floats anywhere in scoring storage or arithmetic. MCQ auto-grading computes in integers; any division applies **round-half-up** exactly **once, at final persistence** of each score — never per-intermediate-step. Display converts bp to the association's grading scale (e.g., /20) at render time only; the per-level passing threshold is converted to bp for comparison. This matches the weight engine's bp arithmetic end-to-end, so weighted averages are pure integer math until the single display conversion.
* **Online Exam Builder:**
  * **Format (Revision 12):** digital exams only in MVP; the standardized print-ready CSS layout is postponed to §10.1 — paper sittings are prepared outside the platform until then, and their marks entered as grades normally.
  * **Question Types:** MCQs (auto-graded) and free-text/short-answer (manually graded).
  * **Stable question identity (TD-6):** every question carries an **auto-generated, immutable UUID**; `StudentExamSubmission` answers reference question UUIDs — never array positions.
  * **Interactive Grading Flow:** on submission, MCQs auto-score into a draft grade; teacher scores subjective parts; Publish makes the per-exam grade visible (formula integration is post-MVP — template engine, §10.1, Revision 13).
  * **Access Policy:** `single_submission` vs `save_and_resume`, per exam, changeable on the fly.
  * **No system-enforced time limits** in MVP.
* **Certificate/Transcript Snapshot Rule (BR-10):** at certificate generation (post-MVP), exact grade values are snapshot into the record; later template edits cannot retroactively invalidate an issued document.
* **Level completion (BR-11):** coverage 100% and, only if a final exam is configured for that level, that exam passed. If no final exam is configured, coverage alone suffices.

### 4.7 Attendance Overview (Postponed)
* **Postponed to Post-MVP:** attendance registers, checking sheets, and manual session logs are removed entirely from MVP; the association continues paper/spreadsheet tracking.
* **The Fluid Engagement Model:** all students are assigned to a Group; a student may attend physically, watch recordings, or switch modes fluidly at any time with no administrative changes.

### 4.8 In-App Notifications (Postponed — Revision 6)
* **Postponed to Post-MVP (§10.1):** the bell icon, notification dropdown, notification list page, critical-banner tier, per-child notification preferences, and the `Notification` / `NotificationPreference` entities are **removed entirely from the MVP**.
* In MVP, operational communication (session cancellations, approvals, published grades) happens through the existing channels the association already uses (in person, phone, WhatsApp groups managed manually) and through state visible on dashboards (pending screens, published grades appearing, calendar changes).
* Transactional side effects that previously inserted notification rows (registration approval, grade publish) now write **only** their `AuditLog` rows (TD-4, TD-8).
* The full in-app notification framework (five-event catalog, critical/normal tiers, per-child composite preferences) is specified in §10.1 for the immediate next phase; nothing in the MVP schema may pre-create its tables.

### 4.9 Educational Content
* **Pre-Event Preloading & Post-Event Follow-up:** a Teacher/Admin can attach educational files (PDFs, images, slides, audio recordings) to a Calendar Event — pre-event or post-event. `EducationalContent` carries an optional `event_id` FK and a `level_id` FK (§7) so the directory (§5.2) can group by Level.
* **Three-Tier Content Visibility** — strict `visibility` enum (`public | private | hidden`) on `EducationalContent`:
  1. **Public:** visible to everyone; object lives in the public bucket (§3.1).
  2. **Private:** visible only to logged-in Students and Parents of linked students in the target Level/Group (child context verified via `X-Active-Child-ID`, §4.3); served exclusively via short-lived presigned URLs after server-side permission checks.
  3. **Hidden:** excluded from Student/Parent directories; visible only to Admins and Teachers, who can toggle to Public or Private (subject to the consent gate).
* **Global (No-Branch) content scope authorization:** content with `branch_id = null` surfaces in the "Global / بدون فرع" container across every branch (§5.2). **Only Super Admins and Admins may assign content to the Global scope. Teachers are strictly locked to `branch_id` values within their assigned branch scope** (derived via `GroupTeacher` → Group → Branch); a Teacher upload with `branch_id = null` or an out-of-scope branch is rejected with `403 FORBIDDEN`. Enforced server-side per TD-2 — this prevents a single-branch teacher from accidentally publishing files platform-wide.
* **Consent-Gated Recording Privacy (hard constraint, not a default) (BR-2, BR-3):**
  * Admin configures default content visibility *per Category* (e.g., Children = private-by-default, Women/Teens = public-by-default).
  * If a Group has even one enrolled student without effective `media_release` consent, **all session-recording resources for that Group are forced `private`**, maintained continuously by the re-evaluation engine (§4.1a). **Edge case (Revision 8): a Group with zero enrolled students has no non-consenting student, so the gate does not engage** — uploads to an empty group's sessions simply take the Category default visibility; the first enrollment of a non-consenting student triggers re-evaluation and forces the flip (§4.1a event 1).
  * **Teachers cannot override the consent-driven private state.** Making such a resource public is **Admin-only, requiring a mandatory free-text justification**, logged to the `AuditLog` (TD-8). Ordinary resources keep the normal Teacher/Admin toggle.
* **In-app audio recorder — POSTPONED to §10.1 (Revision 12):** the browser MediaRecorder component (per-browser containers, iOS screen-lock suspension handling, duration integrity checks) was the most cross-browser-fragile piece of the build. In MVP, **teachers record with their phone’s native voice-recorder app and upload the file** — the upload pipeline, consent gate, and the full TD-9 audio-container whitelist (webm/mp4/ogg/mpeg/wav) already accept everything phones produce. The teacher content page shows brief guidance (record in your phone app → upload here; prefer mono/low-bitrate voice settings; keep files well under the 100 MB cap). Video remains excluded entirely. Risk R-4 (iOS recording suspension) is retired with this deferral.
* **Uploads (Revision 6 — single-shot for MVP):** uploads use a **standard single-shot presigned PUT** to the target bucket, followed by a server-side completion check (MIME magic bytes, size limits TD-9). **S3 multipart resumable uploads are deferred to post-MVP** (§10.1, first storage item) — a failed upload restarts from zero in MVP (Risk R-9). Mitigations: the recording UI displays upload progress and clear retry affordances, advises teachers to upload on stable connections, and encourages splitting very long sessions into multiple shorter recordings. The **hash-segmented immutable key structure (TD-9) is retained unchanged** — it defeats browser/Nginx caching collisions independently of the upload mechanism, and makes the later multipart upgrade a drop-in change to the upload path only.
* Server-side MIME-type validation and size limits (TD-9) enforced on upload completion. **Verification mechanics (Revision 8):** at `/complete`, the server issues a **ranged GET (`Range: bytes=0-511`)** directly to MinIO against the just-uploaded object and inspects the magic bytes from that 512-byte window — the server never streams or buffers the full file to validate it. Size is verified from the object's HEAD metadata against the declared size and TD-9 caps. Mismatch → `409 VALIDATION_FAILED`, object deleted, no `EducationalContent` row created.

### 4.10 Data Integrity, Portability & Sensitive Data
* Soft delete + audit trail (`deleted_at`, `deleted_by`, JSON snapshot) on all core entities; cascade behavior per TD-5. **Retained in full for MVP** — soft-delete columns, `Trash` snapshots, and the 90-day window are not descoped.
* **Trash restoration UI — deferred (Revision 6):** the `/admin/trash` page and its restore/permanent-delete UI are **post-MVP** (§10.1). In MVP, restoration of a soft-deleted record is performed by the developer/Super Admin via **manual SQL against the `Trash` snapshot**, following a documented runbook (restore = clear `deleted_at/deleted_by` + reinstate cascaded rows from the snapshot; **the runbook must explicitly capture and reinstate the relationship rows the TD-5 cascade removed — `FamilyLink`, `GroupTeacher`, `UserBranchRole`, and `UserIdentity` deactivations — a User restored without their links and roles is a half-restored, silently broken account**; every manual restore is executed **exclusively through a locked CLI maintenance script checked into the repository** — e.g. `npm run db:restore -- --entity=User --id=<uuid>` — which wraps the snapshot restoration, the cascaded-row reinstatement, and the `trash.manual_restore` `AuditLog` insert **in a single Prisma transaction**; running restoration SQL directly in psql is prohibited, because a raw session enforces nothing and BR-15 accountability would depend on developer goodwill). The `content.quarantine-purge` job (TD-7) still enforces the 90-day permanent-delete window automatically.
* **First-class `AuditLog` table** (§7): coverage grid in TD-8. The `Trash` snapshot mechanism is for restoration; the `AuditLog` is for accountability. Both exist. Audit browsing UI (`/admin/audit`) remains in MVP.
* **CSV/Excel/PDF import/export — postponed (Revision 6):** all bulk import/export features, template downloads, and their pg-boss jobs are **removed from MVP** (§10.1). Launch data (branches, rooms, groups, roster) is entered **manually through the admin UI** (§2.3 owner task, §15.1). This removes the Week-7 CSV sanitation dependency and replaces it with budgeted manual data-entry hours.
* Two-step account self-deletion.
* **Sensitive social/case-file data on children/teens** (health condition, family situation, parents' names/professions, number of siblings, home address) restricted by default to Admin/Super Admin and the student's specifically-assigned teacher(s) (via `GroupTeacher`) — never other students or unrelated guardians. Field-level/section-level restriction, not just page-level (BR-16, TD-2).
* Guardian contact data keeps the father/mother-split model (separate name and profession per parent). **Known duplication:** the same parent may exist as a `StudentSocialProfile` text field and a linked Parent `User`. The **linked Parent `User` (via approved `FamilyLink`) is authoritative** for contact identity; `StudentSocialProfile` text is case-file context only. Merge tooling post-MVP (§10.3).
* `academic_year` values constrained to validated **`YYYY-YYYY`** format via the **`AcademicYear` lookup table** with an `is_current` flag. Free-text year strings prohibited (TD-6).
* No credentials, real or example, ever hardcoded or stored in plaintext. Super Admin seeded by Google-email allow-listing (§2.1, §15) — the MVP stores no passwords of any kind.

### 4.11 Legal Compliance
* Privacy notice and consent checkboxes on all data-collection forms, with the distinct parental media release opt-in for minors, persisted as versioned `ConsentRecord`s (§4.1a).
* Data residency enforced at the infrastructure level via containerized Moroccan VPS production deployment (§3.1, §19.0), including the offsite backup location (§6). Non-Moroccan dev/staging environments carry fixture data only (§19.0, Risk R-10).

---

## 5. Pages, Features & Navigation Flows

(The authoritative sitemap and navigation hierarchy is §14.1; this section describes each page's content and behavior. End-to-end journeys connecting these pages: §17.)

### 5.1 Public (unauthenticated)
* **Landing Page (`/`)** — Association identity, mission, branch list, read-only public calendar, unrestricted public resources. Login/Register CTAs. (Language switcher ships with the FR/EN translations post-MVP, §10.1 — MVP is Arabic-only.)
* **Registration Page (`/register`)** — "Continue with Google" entry executing the OAuth-first sequence (§4.1b); adult self-registration form or unified Parent + Child form with read-only pre-populated Google email; generic consent checkbox and explicit Parental Media Consent checkbox for minors; submits into `Pending`.
* **Login Page (`/login`)** — Google OAuth button only. No password fields. Deactivated and Pending states per §4.1/§2.1.
* **Content Access Changed Page (`/content-unavailable`)** — friendly error page for stale public links to now-private content (§3.1).

### 5.2 Shared / Cross-Role
* **Account Switcher** — header control for parent→child context switching (sets the client's `X-Active-Child-ID` header state, §4.3) and dual-role switching.
* **Profile (`/profile`)** — view/edit own basic contact info (sensitive profiling fields remain restricted).
* **Educational Content Directory Page (`/resources`)** — drilling folder system, public-accessible (restricted resources require login):
  * **Level List Grouped by Category:** Categories by `display_order`; active Levels under each by Level `display_order` (fallback: alphabetical on the natively `ar-x-icu`-collated `name` column).
  * **Level Resources View:** cascading grouping — Tier 1 **Academic Year** (`is_current` pinned top) → Tier 2 **Branch** (`display_order`, with **"Global / No Branch" (بدون فرع)** container at top; write access to this scope restricted per §4.9) → Tier 3 **Subject** (optional, `display_order`; uncategorized in "General").

### 5.3 Student (adult students directly; minors via Parent context with `X-Active-Child-ID`)
* **Dashboard (`/dashboard/student`)** — today's/upcoming sessions, most recent published grade, quick links.
* **My Calendar (`/dashboard/student/calendar`)** — personal view of Group schedules + Public and Private events (Hidden invisible).
* **My Quran Progress (`/dashboard/student/quran`)** — per-surah expandable cards, union-merged coverage %, log history (read-only).
* **My Grades & Exams (`/dashboard/student/grades`)** — published grades and pending online exams; take / save-progress / submit per exam access policy.

### 5.4 Parent
* **Family Dashboard (`/dashboard/parent`)** — approved linked children; selecting one switches the active child context (§4.3) to that child's read-only views (minors take online exams through this context).
* **Link a Child (`/family/link-child`)** — new link request (or new-child registration, §4.1); `pending` until Admin approval.

### 5.5 Teacher
* **Dashboard (`/teacher`)** — today's assigned sessions, draft grades awaiting publish/re-publish, scheduled exams.
* **My Groups (`/teacher/groups`)** — assigned Groups (via `GroupTeacher`) with roster access.
* **Quran Progress Logging (`/teacher/students/{id}/quran`)** — log new-memorization/revision ayah ranges; corrections (edit/soft-delete a log) recalculate the surah's coverage synchronously (§4.5).
* **Exam Authoring & Grading (`/teacher/exams`)** — form builder (stable question UUIDs), access-policy toggle, MCQ auto-grading, subjective grading, absent-zero handling, Draft/Publish.
* **Content Upload (`/teacher/content`)** — file attach (incl. phone-recorded audio, with in-page guidance §4.9), single-shot upload with progress and retry, visibility selection honoring Category defaults and the consent gate (consent-forced private state visible but not editable by Teachers; Global scope unavailable to Teachers, §4.9).

### 5.6 Admin (also accessible to Super Admin, with wider scope)
* **Admin Dashboard (`/admin`)** — pending-approval counts, overview stats.
* **Approval Queue (`/admin/approvals`)** — pending registrations (incl. parent+child bundles) and family links; approve/reject with reason.
* **User Management (`/admin/users`)** — search (fields: TD-10), filter, list, create (staff pre-provisioning against a Google email), edit, approve, reject, deactivate, role/branch-scope assignment, consent-record management.
* **Branches & Rooms (`/admin/branches`)** — CRUD, `operational_start_date`, branch-activation event backfill action. (`display_order`: Super Admin only.)
* **Groups & Levels (`/admin/groups`, `/admin/levels`)** — CRUD, `gender_restriction`, weekly timetable and co-teacher assignment.
* **Group Enrollment (`/admin/groups/{id}/roster`)** — add/remove students; enforces `max_students`; every roster change enqueues consent re-evaluation (§4.1a).
* **Categories & Subjects (`/admin/taxonomy`)** — reference-data CRUD (single Arabic `name` column). (Committees: post-MVP, §10.1.)
* **Calendar & Events (`/admin/calendar`)** — Events with explicit four-way join population, visibility tier selection, Vacation events.
* **Content Library (`/admin/content`)** — content management, Category privacy defaults, Global-scope assignment, consent-gate overrides (Admin-only, mandatory justification, audit-logged).
* *(Revision 12)* The `/admin/audit` **browsing page is post-MVP (§10.1)** — writing the TD-8 audit rows remains fully mandatory in MVP; reads happen via a documented SQL runbook until the page ships. (Trash restoration UI and CSV import/export pages: also post-MVP, §4.10.)

### 5.7 Super Admin Only
* **System Settings (`/superadmin/settings`)** — branding assets, legal/consent text versions, **Hijri day-offset (−2 to +2, in-scope MVP)**, `display_order` management, `AcademicYear` management (incl. `is_current`).

### 5.8 Key Navigation Flows
* **Registration → Access:** Landing → Continue with Google (§4.1b) → unified/adult form (read-only email) → Pending status screen → [Admin approval] → Login → role-based dashboard redirect.
* **Child Linking:** Family Dashboard → Link a Child → submit → Pending → [Admin approval] → child appears in Family Dashboard → switching to the child sets `X-Active-Child-ID` for subsequent requests.
* **Exam Lifecycle & Grading:** Teacher authors Exam (stable question UUIDs) → Publishes exam → Student takes it online (adults directly; minors via parent context) or on paper → MCQ auto-saves as draft → Teacher grades subjective parts, absent students receive default 0 → Publish. (Formula integration and the template-edit → async-recalc → Re-publish loop are post-MVP — template engine, §10.1, Revision 13.)
* **Consent lifecycle:** consent granted/revoked (online or staff-recorded) → `ConsentRecord` written → pg-boss re-evaluation job → affected group recordings' visibility force-corrected (bucket migration if needed) → stale public links land on `/content-unavailable`.

(Full step-by-step journeys with state annotations: §17.)

---

## 6. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Security | Google OAuth as sole MVP identity provider (no stored passwords); two-layer rate limiting — coarse per-IP at Nginx plus authoritative per-user quotas in PostgreSQL (§3.1, TD-13); RBAC enforced server-side per TD-2 including per-request `X-Active-Child-ID` FamilyLink verification (§4.3); presigned-URL reads gated by server-side permission checks; MIME validation (TD-9); field-level social-data restriction; versioned `ConsentRecord` tracking; consent-gate overrides Admin-only with logged justification; Global content scope restricted (§4.9). |
| Performance | Concrete targets in TD-11a: standard API reads p95 < 300 ms; Quran progress writes **including the synchronous interval-merge recalculation** p95 < 100 ms; presigned-URL mint p95 < 150 ms; full-level grade recalculation (100 students × 10 exams) completes < 60 s as a background job. Interval-merge optimized via DB indexes. |
| Availability & Backup | Automated Docker-volume backups and nightly `pg_dump` dumps, replicated **offsite to a second Moroccan location** via `restic` over SFTP/SSH (both inside Morocco for Law 09-08). **RPO ≤ 24 h (nightly), RTO < 1 hour** with a documented, periodically **tested restore procedure** as a launch requirement. |
| Localization | RTL-first UI; **Arabic-only chrome at launch** via mandatory i18n keys (FR/EN catalogs post-MVP §10.1); structural entity names Arabic-only on natively `ar-x-icu`-collated columns (§2.2); all user-facing API error messages resolved through i18n keys (TD-3.8). |
| Accessibility | Responsive mobile-first layout; low-end-device-friendly (no heavy client-side processing); mandatory UI states per §14.4. |
| Auditability | First-class `AuditLog` per the TD-8 coverage grid: actor, timestamp, action type, target, detail payload (incl. mandatory justifications). |

---

## 7. Data Model — Key Entities

**Migration implementation note (binding):** PostgreSQL-specific elements of this model — the native `ar-x-icu` collation on the structural `name` columns and sortable person-name columns, all CHECK constraints, partial/functional unique indexes, and any triggers (TD-6) — **cannot be expressed in Prisma's `.prisma` schema syntax**. They must be added in hand-written SQL inside Prisma migration files using the `prisma migrate dev --create-only` workflow (TD-6a). An implementation that omits them because "Prisma didn't generate them" is non-compliant.

* **User** — core identity; `account_status` (pending/active/rejected/suspended, lifecycle TD-1) separate from branch `user_status` (active/left/paused). Minor students are `User` rows with **no identity records** (login-less), accessed via approved `FamilyLink` context only (`X-Active-Child-ID`, §4.3).
  * **`pre_provisioned_email` (nullable) — Revision 15.** The email address **authorized to claim this account before any external identity exists**. Staff set it when pre-provisioning an account (§3.1, §4.1b step 4b); it is the *only* way an unbound account can be found by email, because `UserIdentity` rows exist solely for **completed** bindings. Stored lowercase (application-normalized per TD-12, with a database `CHECK` backstop) and **unique among non-null values** via a partial unique index (TD-6). **Null for every self-registered account** — those receive their `UserIdentity` in the same transaction that creates them (§4.1b step 5), so they never pass through a pre-provisioned state.
  * **Retained, not cleared, after binding (binding rule):** once the identity is bound the column keeps its value. Clearing it would destroy the provenance of how the account was created and would release the address for a second account to claim; retention is harmless because the login lookup consults `UserIdentity` **first** (§4.1b step 3). The partial unique index therefore also guarantees one email maps to at most one account, bound or not.
  * **The pre-provision fallback matches only live accounts:** the lookup is scoped to `deleted_at IS NULL`, and the match then routes by `account_status` (TD-1) — so a suspended or deleted account yields the "Account deactivated" screen and is **never silently reactivated** (§4.1).
* **UserIdentity** — provider-abstracted auth linkage: `(user_id, provider, provider_subject_id, email)`. MVP: `provider = google` only. Unique on `(provider, provider_subject_id)` (TD-6). Created atomically with the User in self-service registration (§4.1b step 5) or bound on first login for pre-provisioned accounts (§4.1b step 4b). **A `UserIdentity` row represents a COMPLETED external identity binding and nothing else (Revision 15): placeholder rows — a row with a null, empty, or synthetic `provider_subject_id` standing in for an unbound account — are prohibited.** An account awaiting its first binding is represented by `User.pre_provisioned_email`, never by a half-populated identity row; a stub identity would make "has an identity" stop meaning "has authenticated", which is the predicate the entire login routing rests on.
* **Role**, **UserBranchRole** — many-to-many with branch scope.
* **Branch** — physical locations with single Arabic `name` (collated `ar-x-icu`), `operational_start_date`, optional integer `display_order`.
* **Room** — rooms linked to specific branches.
* **Category** — academic track with single Arabic `name` (collated) and optional `display_order`.
* **Level** — level sub-track with single Arabic `name` (collated), `gender_restriction`, optional `display_order` (scoped within its Category).
* **Subject** — curriculum subject with single Arabic `name` (collated) and optional `display_order` (non-Quran items only, §4.4b).
* **LevelSubject** — join: Subject↔Level; creation auto-generates draft grading components.
* **LevelSurah** — join: Surah↔Level; creation auto-generates the two Women's-program draft components.
* *(post-MVP, §10.1 — do not pre-create)* **Committee** / **TeacherCommittee** / **LevelCommittee** — informational tagging.
* **Group** — fixed weekly schedule unit: `level_id`, `branch_id`, `room_id`, `day_of_week`, `start_time`, `end_time` (local wall-clock, TD-11), `max_students`.
* **GroupTeacher** — join: teacher↔Group (co-teaching, two instructor slots); resolution table for all teacher scoping.
* **StudentGroup** (enrollment) — many-to-many Student↔Group; every mutation enqueues consent re-evaluation.
* **FamilyLink** — Parent↔Student with `status` (pending/approved/rejected, lifecycle TD-1); unique `(student_id, parent_id)` among non-deleted rows (TD-6). **The approved row is the authorization record checked by the `X-Active-Child-ID` middleware on every child-scoped request (§4.3).**
* **ConsumedToken** — replay guard for single-use tokens: `(jti UNIQUE, purpose [onboarding], consumed_at, expires_at)`; written inside the registration transaction (§4.1b); purged daily past TTL (`token.purge`, TD-7).
* **RefreshToken** *(Revision 16)* — one row per **issued** refresh token, making the TD-12 session policy implementable: rotation on use, the server-side revocation list, immediate revocation on suspension, and the 10-second predecessor grace window all need per-token server state, which no other entity holds. Fields, each with a named consumer:
  * `id` · `user_id` (FK) — the session's owner.
  * **`session_id`** — the stable identifier of one **rotation chain**, stamped on the chain's first token and copied to every successor. It is what makes "revoke this session" and "revoke the whole chain on reuse" a single indexed `UPDATE`; without it, walking `rotated_from_id` would require a recursive CTE, and §16.2 permits application raw SQL only for row locks and pg-boss inserts. Logout revokes one `session_id`; suspension revokes every live token of the user.
  * **`token_hash`** — the token is stored **hashed, never raw** (a stolen database dump must not yield usable 30-day credentials). Unique (TD-6).
  * `issued_at` · `expires_at` — 30-day TTL enforcement and the `token.purge` horizon (TD-7).
  * **`rotated_from_id`** (self-FK, nullable) — the immediate predecessor. This single field decides all three refresh outcomes: current token → rotate; immediate predecessor inside the grace window → accept; anything older → reuse detected.
  * `revoked_at` · **`revoked_reason`** (`logout | suspension | user_deleted | reuse_detected`) — the revocation-list check is `revoked_at IS NULL`; the reason distinguishes a normal logout from a **detected replay**, which is a security event rather than routine housekeeping.
  * **Deliberately NOT in MVP** (evaluated, Revision 16 — each was considered and rejected on lean-MVP grounds, so a later implementer does not re-add them by reflex): `created_at` (the same instant as `issued_at`); `revoked_by` (duplicates `AuditLog.actor_user_id`, TD-8, and two actor records will drift); `created_by_ip` and `user_agent_hash` (both personal data on a beneficiary population that includes minors, with **no MVP consumer** — there is no session-management screen in §14.1 — and no retention rule in §6; a UA hash would additionally impose a session-binding rule TD-12 does not state, breaking legitimate browser upgrades); `last_used_at` (under mandatory rotation a token is used exactly once, so its use instant is its successor's `issued_at`).
* **RateLimitCounter** *(Revision 14)* — the authoritative store for **per-user** quotas that Nginx cannot enforce (§3.1): `(user_id, bucket, window_start, count)`, unique on `(user_id, bucket, window_start)` (TD-6). `bucket` names the quota (MVP: `upload.initiate`, 30/hour, TD-13); `window_start` is the truncated start of the fixed window. The counter is incremented **inside the same transaction as the action it gates**, under the TD-15.2 row-lock discipline, so a quota decision can never be raced. Rows for elapsed windows are removed daily (`ratelimit.purge`, TD-7). Never held in process memory and never routed through pg-boss (§3.1).
* **ConsentRecord** — `(student_id, consent_type [media_release | data_processing], granted, granted_by_user_id, method [online_form | staff_recorded], consent_text_version, granted_at, revoked_at, revoked_by_user_id)`. Append/state-change only; history preserved. Absence of a record = no consent.
* **Event** — exception-layer calendar item with `visibility` enum (`public | private | hidden`), recurrence config (none/daily/weekly/biweekly-alternating/yearly), local-time date fields (TD-11).
* **EventBranch**, **EventCategory**, **EventLevel**, **EventGroup** — explicitly populated scope join tables, written at event creation.
* **QuranSurah** — static pre-seeded lookup: `surah_id` (PK, 1–114), `name_arabic`, `name_transliterated`, `total_ayahs`.
* **QuranProgressLog** — `(student_id, surah_id FK, start_ayah, end_ayah, category [new_memorization | revision], logged_by, logged_at, deleted_at, deleted_by)`; check `start_ayah <= end_ayah` (TD-6). Any create/update/soft-delete triggers synchronous per-surah recalculation (§4.5).
* **StudentSurahProgress** — self-healing coverage cache (§4.5): `(student_id, surah_id)` unique; merged coverage %, merged interval set (JSONB), `last_log_id`, `last_log_at`; upserted post-commit on every log mutation; repaired in place by the read-side guard on stamp mismatch. Never the source of truth — the logs are.
* *(post-MVP, §10.1 — do not pre-create)* **GradingTemplate** / **GradingTemplateItem** — the weight-template engine’s tables, fully specified in the roadmap.
* **Exam** — `level_id`, optional `subject_id`, optional `surah_id`, `date`, optional `round`, access policy (`single_submission | save_and_resume`), structured question array where **every question carries an immutable auto-generated UUID**. Soft-deletion blocked while referenced by an active template (TD-5).
* **StudentExamSubmission** — answers keyed by **question UUID**, grading status, save-and-resume progress state (lifecycle TD-1).
* **Grade** — per student, per exam: `value_bp` (integer basis points of exam total, 0–10,000, §4.6), **`group_id`** (the Group in which the student sat the exam — sitting provenance, Revision 10), `status` (draft/published, lifecycle TD-1), `absent` flag, `manual_override` pass/fail field with actor/timestamp, `version` (optimistic locking, TD-15).
* **EducationalContent** — files / native-codec recordings with `visibility` enum, optional `event_id` FK, `level_id` FK, optional `branch_id` (null = Global scope, write-restricted §4.9), optional `subject_id`, `academic_year_id` FK, storage bucket/key reference (naming: TD-9), `consent_forced_private` state flag maintained by the re-evaluation engine.
* **AcademicYear** — lookup: validated `YYYY-YYYY` label, `is_current` flag (exactly one current row application-wide, TD-6).
* **AuditLog** — `(actor_user_id, action_type, target_entity, target_id, detail JSONB [incl. mandatory justifications], created_at)`; coverage grid TD-8. **`actor_user_id` is nullable (clarified in Revision 17): a null actor means the action was system-initiated, not that attribution was lost.** Some mandated actions have no human actor by nature — replay-detected session revocation (`auth.token_revoked`, reason `reuse_detected`) is triggered by an unauthenticated request presenting a stolen secret, and the consent re-evaluation job forces `content.visibility_change` with no operator involved. For those rows the `action_type` and `detail` carry the "why", and `target_entity`/`target_id` carry the "to whom".
* **Attribution invariant (Revision 17, binding).** For every entity whose state can be revoked, disabled, or destroyed, the answers to **who, when, and why** must be reconstructable **from the `AuditLog` alone** — without reading the affected row, which may itself have been purged (TD-7) or overwritten. This is why revocation-bearing entities carry no `revoked_by`-style column: duplicating the actor invites two records that disagree, and `AuditLog.actor_user_id` + `created_at` + `action_type` + `detail` is the single authoritative account. A revocation path that mutates state without writing its mandated audit row inside the **same transaction** is therefore non-compliant, not merely under-logged (TD-4.13/14/15).
* **Trash** — JSON snapshot of any soft-deleted record (restoration; distinct from AuditLog). **Retained in MVP; restoration UI post-MVP — manual-SQL runbook applies (§4.10).**
* **StudentSocialProfile** — restricted-access table: minors' health, home address, family situation, father/mother-split names/professions (case-file context; linked Parent `User` authoritative for contact identity).
* **SystemSetting** — application-level key-value config (branding, legal text versions, Hijri day offset −2…+2).

**Concurrency columns (TD-15):** `Group`, `Level`, `Category`, `Subject`, `Branch`, `Room`, `Event`, `Exam`, `EducationalContent`, `SystemSetting`, `Grade`, and `User` each carry an integer `version` column for optimistic locking. (`GradingTemplate` joins the registry with the post-MVP engine, §10.1.)

**Removed from the MVP schema (Revision 6):** `Notification` and `NotificationPreference` — specified for the post-MVP notification phase (§10.1); do not pre-create their tables.

---

## 8. MVP Delivery Plan (8 Weeks)

| Wk | Focus |
|---|---|
| 1 | Dockerized multi-container setup (`docker-compose`: Node.js, PostgreSQL, MinIO dual-bucket, Nginx same-origin path routing + SSL + rate limiting §3.1). Google OAuth with the §4.1b onboarding sequence (`UserIdentity`), Super Admin Google-email seeding, RBAC middleware per TD-2, pg-boss infrastructure, native `ar-x-icu` collation + CHECK constraints via hand-written migration SQL (TD-6a), 114-Surah production seed (§15), branch CRUD with `display_order`. OpenAPI contract scaffold matching TD-3, standard error envelope (TD-3.7), health endpoints (TD-14). Project skeleton + agent workspace files per §16. |
| 2 | Unified Parent+Child registration transaction (TD-4) with onboarding token flow (§4.1b), `ConsentRecord` capture (versioned text), Pending redirect (TD-1), approval queues (bundles), family dashboard switcher with **`X-Active-Child-ID` middleware** (§4.3), `GroupTeacher` scoping, sensitive-field security, `AuditLog` foundation (TD-8). |
| 3 | 🔴 Group scheduling (weekly timetable + co-teaching, wall-clock time policy TD-11) + Event exception layer (visibility enum, four-way join population, operational-start-date gating, branch-activation manual backfill). Morocco-tuned decorative Hijri overlay + admin day-offset setting (in-scope, §4.4). |
| 4 | 🔴 Quran progress logging with union interval-merge against the static Surah table, **including synchronous recalculation on log create/update/soft-delete** (§4.5); student progress visualizers. (No auto-exam trigger.) |
| 5 | 🔴 Online Exam Builder (stable question UUIDs, MCQ auto-grading, access policies, submission lifecycle TD-1) & per-exam grading: bp scoring, absent-zero draft initialization, pass/fail vs per-level threshold, manual overrides, Draft/Publish. (Template engine, averages, recalculation, print layout: post-MVP §10.1 — slack recovered here protects the mid-September date.) |
| 6 | Content management & Directory nesting, Global-scope authorization (§4.9), phone-recording upload guidance (recorder itself post-MVP §10.1), **single-shot presigned uploads with progress + retry** (§4.9) on hash-segmented immutable keys (TD-9), Nginx /storage passthrough directives (§3.1 B2), dual-bucket visibility transitions + `/content-unavailable`, consent re-evaluation engine wired to enrollment/consent/upload events, Admin-only consent-gate override with justification. |
| 7 | Arabic RTL pass over every screen (all strings through i18n keys; ar catalog complete). **Manual launch-data entry through the admin UI with the branch coordinator** (branches, rooms, groups, roster — CSV import is post-MVP). Production hardening (MIME validation TD-9, Nginx rate limits TD-13, presigned-URL permission audits, Trash manual-restore runbook §4.10). Offsite backup pipeline (`pg_dump` + `restic`) with a tested restore drill against the RTO target. Module acceptance checklists (§18) executed per completed module. |
| 8 | Integration dress rehearsal **on the production Moroccan VPS** via the §19.1 pipeline (staging topology §19.0 does not exercise the VPS — this step does). UAT with live branch coordinator (incl. staff-assisted Google-account registration drill). E2E journey suite (§17/§19.2) green. Production launch. |

---

## 9. MVP Scope Summary

**IN:** Docker-compose production deployment on Moroccan VPS · **Google-OAuth-only auth** (provider-abstracted, OAuth-first onboarding §4.1b) · Unified parent+child registration transaction · Registration approvals & versioned `ConsentRecord` Parental Media Consent (continuous re-evaluation, forced-private enforcement, Admin-only justified overrides) · Branch-scoped RBAC with `GroupTeacher` resolution, normative permission matrix (TD-2), Global content scope restriction, and **per-request `X-Active-Child-ID` FamilyLink verification** · Group schedule + Event exceptions with four-way explicit joins and branch-activation backfill · Dual Gregorian-first calendar (**Morocco-tuned Hijri overlay + admin offset — in scope**, inactive-branch gating, visibility enum tiers) · Parental roles, linking queues, family dashboards, login-less minors · Quran interval-merge on pre-seeded surah metadata **with synchronous recalculation on any log mutation** · Online Exam Builder (stable question UUIDs, digital-only) · Per-exam bp grading (absent-zero draft initialization, pass/fail thresholds, manual overrides — no averages in MVP) · Dual-bucket MinIO with presigned private reads, immutable hash-segmented keys, single-shot uploads, and friendly stale-link handling · Category privacy defaults · Phone-recorded audio upload (in-app recorder post-MVP) · Folder Resources Directory with `AcademicYear` lookup · **Single Arabic `name` columns with native `ar-x-icu` collation** + `display_order` sorting · **Nginx same-origin path routing (client `/`, API `/api/v1/`, storage `/storage/`)** · pg-boss background jobs (TD-7 catalog) · First-class `AuditLog` (TD-8 grid) + Trash snapshots (restore via manual-SQL runbook) · Restrictive social-data controls · Offsite Moroccan backups with tested restore · Standardized API contract & error envelope (TD-3) · Deterministic state machines (TD-1) · UI sitemap, screen standards, seed data, conventions, journeys, acceptance checklists, environment topology, deployment pipeline, testing strategy, agent workspace files (§14–§19) · Legal compliance checklists

**OUT (post-MVP — §10):** **Basis-point weight-template engine (activation lifecycle, freeze/stale, recalculation, averages)** · **In-app audio recorder** · **FR/EN interface translation (Arabic-only launch)** · **Committees** · **`/admin/audit` browsing page** · **Print-ready exam CSS layout** · **In-app notifications (bell, tiers, per-child preferences)** · **CSV/Excel data import/export** · **S3 multipart resumable uploads** · **Trash restoration UI** · **Local username/password auth & staff-assisted password resets** · Auto-created exams on 100% Quran coverage · Attendance logging and dropout analytics · Certifications PDF generation · Live video streaming · Remote paper photo-uploads (Virtual Exam Desk) · Online card payments (CMI/PayZone) · Offline cash ledger digitization · QR-code self-check-ins · WhatsApp/Email notifications · Analytics dashboards · News bulletin boards · Public Quran reading tools · Discussion forums · Duplicate-account merge/reconciliation tooling

---

## 10. Post-MVP Roadmap — Full Detail

### 10.1 Immediate Next Phase
* **Basis-Point Weight-Template Engine (Revision-12 deferral — full preserved spec):** `GradingTemplate`/`GradingTemplateItem` tables (unique `(template_id, exam_id)`; `weight_bp` 1–10,000 with CHECK); the self-limiting dropdown allocator (`/admin/grading`, filtering, disable at exactly 10,000 bp); the Draft↔Active machine — activation transactionally verifies 10,000 bp under `FOR UPDATE` and same-transaction-enqueues `grade.recalculate` (singleton key `template_id`); demotion **freezes** computed averages as `stale` (Grade regains its `stale` flag), never deletes or recomputes; recalculation updates computed values only, manual overrides win, published grades revert to draft and require Re-publish; aggregation scoped to active-template exams × currently-enrolled students; exam soft-delete guard while referenced by an active template. Purely additive: MVP grades stay valid informational per-exam records, and nothing in the MVP schema references these tables.
* **In-App Audio Recorder (Revision-12 deferral):** MediaRecorder with feature detection (`isTypeSupported`), native containers per browser (webm/Opus, mp4/AAC, ogg/Opus), **`audioBitsPerSecond: 32000`, `channelCount: 1`** for speech (~14 MB/hour), iOS screen-lock warning banner + post-recording duration integrity check, Web Worker for any client-side processing. Reintroduces (and re-scopes) risk R-4.
* **FR/EN Interface Translation:** populate the `fr` and `en` i18n catalogs and re-enable the language switcher — content work only; every key already exists.
* **Committees:** `Committee`/`TeacherCommittee`/`LevelCommittee` (single Arabic `name`, collated), taxonomy-page tagging; informational only.
* **`/admin/audit` Browsing Page:** the §14.2 audit table (Timestamp/Actor/Action/Target + filters), replacing the SQL read runbook.
* **Print-Ready Exam Layout:** the standardized print CSS for paper sittings of platform-authored exams.
* **S3 Multipart Resumable Uploads (first storage item — retires Risk R-9):** upgrade the single-shot upload path to S3 multipart presigned uploads with resume, natively supported by MinIO (initiate / part-urls / complete / abort endpoints; incomplete-upload GC after 48 h). The hash-segmented immutable key structure (TD-9) is already compatible — this is a drop-in change to the upload mechanism only.
* **In-App Notifications:** bell icon, dropdown, `/notifications` page; event catalog `session_cancelled`, `session_rescheduled` (critical — persistent banner, non-disableable), `registration_approved`, `registration_rejected`, `exam_graded` (fires on Publish and Re-publish); Critical (locked) and Normal (toggleable) tiers; parents receive linked children's notifications by default with per-child disable via composite `NotificationPreference (user_id, event_type, child_id)`; notification inserts join the TD-4 transactions they belong to.
* **CSV/Excel Data Import/Export:** bulk import/export with template download, run as pg-boss jobs (`import.csv`, `export.csv`) with row-level error reports; export outputs to the private bucket with presigned links; both audit-logged (`data.import`, `data.export`).
* **Trash Restoration UI:** the `/admin/trash` page — list soft-deleted records with entity type, deleted-by, days remaining; one-click restore from the `Trash` snapshot; permanent delete (Super Admin only) ahead of the 90-day auto-purge; replaces the MVP manual-SQL runbook.
* **Local Username/Password Authentication (retires Risk R-1):** staff-assisted username/password accounts (no email required) for beneficiaries without Google accounts, with staff-assisted (in-person / verified phone call) password reset logged to the `AuditLog`. The `UserIdentity` abstraction makes this an additive provider.
* **Automated Quran-Completion Exam Trigger:** on 100% Surah coverage, auto-create a pending exam in the Teacher queue. Idempotent under co-teaching concurrency — direction: partial unique index on `(student_id, surah_id)` for auto-created exams, insert-on-conflict-do-nothing.
* **Attendance System:** informational present/absent registers, checking sheets, manual session logs.
* **Certifications:** bilingual (Arabic/French) PDF certificates on level completion, with grade-value snapshots at generation time (BR-10).
* **Offline Cash-Fee Bookkeeping:** manual ledger for monthly physical dirham contributions, receipts, supervisor logging.
* **Notification Delivery Upgrades:** WhatsApp Business API integration and transactional email dispatch, layered on the in-app notification framework once built.

### 10.2 Payments & Donations
* **Local Payment Gateway (CMI / PayZone):** CMI hosted pages or PayZone SDK for Moroccan card payments into the association's bank account. Requires an active CMI merchant agreement; re-verify vendor landscape at phase start (§3.4).

### 10.3 Later Phases
* **Duplicate-Account Merge Tool:** reconcile duplicate beneficiary records and the `StudentSocialProfile`-vs-linked-Parent duplication (§4.10).
* **QR-Code Self-Check-In:** printed student ID cards with unique QR codes for front-desk scan attendance.
* **Second-Institute Onboarding (if ever requested):** a separate dedicated deployment of this codebase (own VPS/database/domain via the §19.1 pipeline), or an owner-approved re-architecture — multi-tenant provisioning was removed from the platform’s future entirely in Revision 11 (§3.2).

---

## 11. Open Risks Requiring Attention Before/During Build

* **R-1 (HIGH) — Google-only auth vs. beneficiary digital reality:** the Google-OAuth-only decision structurally excludes beneficiaries without smartphones/Google accounts — a population the association explicitly serves (adult-literacy track). *Mitigations:* staff-assisted Google account creation during in-person registration drives (§2.3); local username/password auth is in the first post-MVP phase (§10.1) on a provider-pluggable auth layer (§7); Week-8 UAT must include a registration drill with a real low-digital-literacy beneficiary. *If the registration drive surfaces a large excluded population before launch, escalate — do not launch a system the first cohort cannot log into.*
* **R-2 (MEDIUM) — Google OAuth external verification lead time:** consent-screen verification can take days to weeks. *Mitigation:* create the Google Cloud project and submit verification in Week 1.
* **R-3 (MEDIUM) — Moroccan VPS performance limits:** dockerized PostgreSQL + Express + MinIO + pg-boss on local VMs may hit memory ceilings. *Mitigation:* minimum 4 GB RAM, swap allocation, MinIO object caching; pg-boss workers run inside the API container.
* **R-4 — RETIRED (Revision 12):** iOS recording suspension no longer applies — the in-app recorder is post-MVP (§10.1); teachers upload phone-made recordings. The risk re-enters scope with the recorder.
* **R-5 (MEDIUM) — Manual launch-data entry burden:** with CSV import postponed (Revision 6), all launch data (branches, rooms, groups, roster with paper-roster spelling variances) is typed into the admin UI by hand. *Mitigation:* budget dedicated data-entry hours with the branch coordinator in Week 7; Arabic search normalization (TD-10) softens spelling-variant pain; import tooling and merge tooling arrive post-MVP (§10.1, §10.3).
* **R-6 (LOW, accepted) — Cross-branch Private event visibility:** any logged-in approved student sees every Private event across all branches (§4.4). Accepted deliberately; revisit if branches request isolation.
* **R-7 (LOW, accepted) — Hidden-event existence leakage via conflict detection:** room-conflict checks against Hidden events reveal that *something* occupies a room/time. Accepted consciously.
* **R-8 (LOW) — Mixed content / SSL:** if MinIO were referenced via unsecured HTTP, mobile browsers would block uploads. *Mitigation (designed-in):* Nginx wraps client, API, and storage under one same-origin SSL envelope (§3.1); verify certificate automation during the Week-8 VPS dress rehearsal.
* **R-9 (MEDIUM→LOW, accepted) — Single-shot uploads on unreliable networks:** with multipart resume deferred, a failed upload restarts from zero — but the 100 MB cap (Revision 12) and phone voice-recorder files (typically 10–30 MB/session) shrink the blast radius substantially. *Mitigations:* upload progress + clear retry UI, guidance to upload on stable connections and split long sessions into shorter recordings; multipart resume is the **first** post-MVP storage item (§10.1). If field failure rates during UAT are severe, escalate the multipart upgrade into the launch window.
* **R-10 (MEDIUM — Revision 6) — Non-Moroccan dev/staging vs. data residency:** staging's frontend is hosted on Vercel (outside Morocco) and dev backends run on developer machines. *Hard rule:* **no real beneficiary data ever enters dev or staging — fixture data only (§15.2)**, enforced by the environment guard on fixtures and by never copying production dumps outside Moroccan infrastructure. Production data, backups, and restores exist only on the two Moroccan locations (§6).

---

## 12. Business Rules Register (technology-independent)

These rules define the domain. They are stated without reference to Node.js, Prisma, PostgreSQL, MinIO, or pg-boss, and must survive any future re-platforming intact. Where any other section of this document appears to conflict with a BR, **the BR wins and the conflict must be reported**.

* **BR-1 — Consent default:** absence of a media-release consent record means **no consent**. Consent is never assumed, inferred, or defaulted to true.
* **BR-2 — Group consent gate:** if any currently-enrolled student in a Group lacks effective media-release consent, every session-recording resource of that Group is non-public. This is a continuously-maintained invariant, re-evaluated on enrollment change, consent change, and upload — not a point-in-time check.
* **BR-3 — Consent override authority:** releasing a consent-gated resource to the public is an Admin-level decision requiring a recorded justification. Teachers can never perform it.
* **BR-4 — Approval before access:** no registered account (person or parent-child bundle) gains any data access before explicit staff approval. Parent-child links grant no visibility until approved. Pending users see nothing beyond public content.
* **BR-5 — Minors are login-less, and child access is verified per action:** minor students have no credentials of their own; all access to a minor's data flows through an approved parent link or a staff role, and the parent-child relationship is verified on every individual access — never assumed from an earlier action in the session.
* **BR-6 — Grading formula completeness:** a grade formula only takes effect when its weights total exactly 100%. Incomplete formulas compute nothing — partial denominators are never used.
* **BR-7 — Absent means zero:** a weighted exam with no mark for an enrolled student records a zero flagged as absent, replaceable via makeup. Weights are never silently renormalized around missing grades.
* **BR-8 — Draft until published:** no grade or exam is visible to students/parents before an explicit publish action. Recalculated grades require explicit re-publish before the new values are visible.
* **BR-9 — Curriculum drives grading components:** assigning a Surah or Subject to a Level automatically creates its draft grading components, so curriculum and grading configuration cannot drift apart.
* **BR-10 — Issued documents are immutable:** certificates/transcripts snapshot exact values at generation time; later formula edits never retroactively change an issued document.
* **BR-11 — Level completion:** 100% Quran coverage, plus passing the level's final exam only if one is configured. No configured final exam → coverage alone completes the level.
* **BR-12 — Manual overrides win:** a manual pass/fail override always takes precedence over computed results and is never clobbered by recalculation.
* **BR-13 — Coverage is a union, always current:** Quran progress is the union of non-overlapping logged intervals per Surah; re-logging or revising a range never inflates coverage. **Any change to the underlying logs — including corrections and deletions — is reflected in the student's displayed coverage immediately and synchronously**; a stale coverage figure must never survive a log mutation, because coverage drives level completion (BR-11).
* **BR-14 — Visibility tiers:** content and events have exactly three visibility states — public (everyone), private (authenticated, scope-relevant students/parents plus staff), hidden (staff only). Consent gating can force non-public regardless of the chosen tier.
* **BR-15 — Nothing is destroyed silently:** all deletions are soft with a restorable snapshot and a 90-day permanent-delete window; every destructive or sensitive action is attributable to an actor and timestamp. (The *restoration interface* may be manual in early phases; the snapshot and the window are non-negotiable.)
* **BR-16 — Sensitive case-file data is need-to-know:** minors' social/health/family data is visible only to admins and the student's specifically-assigned teachers — never to other students, unrelated guardians, or teachers at large.
* **BR-17 — Group-driven scheduling:** a student's weekly class time is implied by group enrollment; events are exceptions layered on top, never the source of the routine schedule. Week starts Monday.
* **BR-18 — Data residency:** all real personal data (including backups) resides on Moroccan infrastructure. Environments outside Morocco hold fixture data only.
* **BR-19 — Ordering is intentional:** structural entities display in admin-defined order, falling back to correct Arabic alphabetical order — never codepoint order.
* **BR-20 — Global reach is a privilege:** publishing content or events across all branches (the Global / no-branch scope) is reserved to administrators; branch-scoped teaching staff can only ever publish within their own assigned scope.

---

## 13. Technical Design Constraints

### TD-1 — State Machines (deterministic lifecycles)

All state transitions below are exhaustive. **Any transition not listed is prohibited and must be rejected with `STATE_CONFLICT` (TD-3.7).** State changes are performed only through service-layer methods that validate the transition — never by raw column updates.

**User `account_status`:**
```
Pending   → Active | Rejected | Deleted
Active    → Suspended | Deleted
Suspended → Active | Deleted
Rejected  → (terminal; re-registration requires staff action, never silent reactivation)
Deleted   → restorable to prior state within 90 days (MVP: manual-SQL runbook, §4.10)
```
`Pending` users authenticating via Google are hard-redirected to the status screen with **zero application data access** — no API endpoint other than `GET /me` and logout returns data to a Pending session.

**GradingTemplate `status`:** — postponed with the template engine (§10.1); the Draft↔Active machine, its 10,000 bp activation gate, and the freeze-on-demotion rule are specified there and must not be pre-built.

**FamilyLink `status`:**
```
Pending → Approved | Rejected
Approved / Rejected → (terminal; a new request creates a new link record)
```

**Grade `status`:**
```
Draft → Published            (explicit Publish)
```
(The Published→Draft revert + Re-publish loop exists only under the post-MVP recalculation engine, §10.1.)

**StudentExamSubmission `state`:**
```
in_progress → submitted      (student submit; save-and-resume loops within in_progress)
submitted   → auto_graded    (MCQ engine, immediate)
auto_graded → fully_graded   (teacher completes subjective scoring)
```
`single_submission` exams skip resume: the first submit is final.

**EducationalContent `visibility` (+ consent flag):**
```
public ↔ private ↔ hidden    (staff-initiated, triggers bucket migration where needed)
any → private (forced)        (consent re-evaluation job sets consent_forced_private = true)
consent_forced_private = true → public   ONLY via Admin override with justification (TD-8)
```

### TD-2 — Role-Permission Matrix (normative)

✔ = allowed within scope · ⊘ = never. Admin actions are always constrained to assigned branch scope; Super Admin is unscoped. Teacher actions are constrained to groups assigned via `GroupTeacher` — including Hidden-event visibility, which extends only to events whose scope intersects those assigned groups (§4.4). **Parent actions on child data additionally require the per-request `X-Active-Child-ID` verification matching BOTH the authenticated parent AND the child in an `Approved` `FamilyLink` (§4.3) — role alone is never sufficient. Users holding the `Student` role acting on their own data bypass the header entirely: ownership is verified directly against the JWT `sub` (§4.3).**

| Action | Super Admin | Admin | Teacher | Parent | Student | Pending |
|---|---|---|---|---|---|---|
| Manage system settings, `display_order`, AcademicYear, Hijri offset | ✔ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ |
| Manage branches/rooms; branch event backfill | ✔ | ✔ (own branches) | ⊘ | ⊘ | ⊘ | ⊘ |
| Approve/reject registrations & family links | ✔ | ✔ | ⊘ | ⊘ | ⊘ | ⊘ |
| Revoke an approved family link (soft-delete, §4.3) *(Revision 16)* | ✔ | ✔ | ⊘ | ⊘ | ⊘ | ⊘ |
| Create/edit users; assign roles & branch scopes | ✔ | ✔ | ⊘ | ⊘ | ⊘ | ⊘ |
| Record staff-declared consent grants/revocations | ✔ | ✔ | ⊘ | ⊘ | ⊘ | ⊘ |
| Override consent gate (with justification) | ✔ | ✔ | ⊘ | ⊘ | ⊘ | ⊘ |
| Override pass/fail | ✔ | ✔ | ✔ (own students) | ⊘ | ⊘ | ⊘ |
| Schedule/edit Events (all visibility tiers) | ✔ | ✔ | ✔ (own groups; hidden allowed) | ⊘ | ⊘ | ⊘ |
| Assign content/events to Global (no-branch) scope | ✔ | ✔ | ⊘ | ⊘ | ⊘ | ⊘ |
| Author exams; publish/re-publish grades | ✔ | ✔ | ✔ (own groups) | ⊘ | ⊘ | ⊘ |
| Log / correct / soft-delete Quran progress | ✔ | ✔ | ✔ (own students) | ⊘ | ⊘ | ⊘ |
| Upload content; set visibility (non-consent-gated) | ✔ | ✔ | ✔ (own groups' branches only) | ⊘ | ⊘ | ⊘ |
| Take online exams | ⊘ | ⊘ | ⊘ | ✔ (as linked minor's vehicle, verified child context) | ✔ (own) | ⊘ |
| View own schedule/progress/published grades | ✔ | ✔ | ✔ | — | ✔ | ⊘ |
| View linked child's data | — | — | — | ✔ (approved link + `X-Active-Child-ID` check per request) | ⊘ | ⊘ |
| View StudentSocialProfile | ✔ | ✔ | ✔ (only own assigned students) | ⊘ | ⊘ | ⊘ |
| Browse AuditLog | ✔ | ✔ | ⊘ | ⊘ | ⊘ | ⊘ |
| Restore soft-deleted records | ✔ (MVP: manual-SQL runbook §4.10) | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ |

Every endpoint enforces this matrix **server-side**; UI hiding is never the enforcement mechanism. (CSV import/export, Trash-UI, and grading-template rows will be added when those features ship post-MVP, §10.1 — the template row was `Super Admin ✔ / Admin ✔ / Teacher ✔ own levels' groups`, preserved here for the engine's return; Revision 13.)

### TD-3 — API Route Registry (contract blueprint)

All routes are prefixed `/api/v1` **on the same origin as the client** (§3.1 Nginx path routing — mandatory for cookie delivery), JSON request/response, JWT bearer auth unless marked public. Plural nouns, kebab-case paths. The generated OpenAPI document is the binding contract; **no endpoint may be implemented that is not in the OpenAPI doc, and this registry is the seed for it.** Representative critical operations:

**3.1 Auth & identity**
```
GET  /auth/google            (public) → redirect to Google (state + PKCE)
GET  /auth/google/callback   (public) → §4.1b routing: existing identity → session by status;
                               pre-provisioned email match → bind identity → session by status;
                               unknown → issue onboarding token → redirect to registration form
POST /auth/refresh           (cookie-authenticated — the ONLY such route, TD-12) → rotates the
                               refresh token and returns a fresh access token; requires the
                               X-Requested-With header and an Origin matching PUBLIC_BASE_URL
POST /auth/logout            → revokes the CURRENT session's refresh token (TD-4.13)
GET  /me                     → identity, roles, branch scopes, account_status, approved child links
```

**3.2 Registration & approvals**
```
POST /registrations                    (public + onboarding token, §4.1b) → unified adult or parent+child submission (TD-4)
GET  /admin/approvals?type=registration|family-link&page=…
POST /admin/approvals/{id}/approve     → atomic bundle activation (TD-4)
POST /admin/approvals/{id}/reject      → body: { reason }
POST /family-links                     → parent-initiated link request (Pending)
```

**3.3 Child-context requests (Parent acting for a minor)**
```
Student-context reads/actions (calendar, quran, grades, submissions, resources) resolve
the acting student per §4.3: header present → verify Approved FamilyLink matching BOTH
JWT parent AND header child; header absent + Student role → act as self
(JWT sub), no header required; header absent + Parent-only → 400 VALIDATION_FAILED.
No approved (parent, child) match → 404 NOT_FOUND (no existence leak).
```

**3.4 Calendar**
```
GET  /calendar?from=&to=&branch_id=&level_id=&group_id=   (public sees public tier only)
POST /events                          → creates event + explicit scope joins (Global scope: Admin+ only)
PATCH /events/{id}    DELETE /events/{id}
POST /admin/branches/{id}/event-backfill   → manual backfill action (§4.4)
```

**3.5 Storage (single-shot uploads, MVP)**
```
POST /uploads/initiate      → { filename, size, mime, content_meta } → { upload_id, key, put_url }
                              (branch scope validated here per §4.9 — Teachers cannot pass branch_id null;
                               single presigned PUT, TTL TD-12)
POST /uploads/{upload_id}/complete  → server-side validation via ranged GET (Range: bytes=0-511)
                                      to MinIO for magic bytes + HEAD for size (§4.9), creates EducationalContent
POST /uploads/{upload_id}/abort
GET  /content/{id}/download-url     → permission check (incl. child context where applicable) → short-lived presigned GET (private bucket)
```
(Multipart initiate/part-urls/complete/abort arrive with the post-MVP resumable upgrade, §10.1.)

**3.6 Exams & grading**
```
POST /exams                POST /exams/{id}/publish
POST /exams/{id}/submissions              → creates in_progress submission
PATCH /submissions/{id}                   → save-and-resume answer patch (rejected for single_submission)
POST /submissions/{id}/submit             → final; MCQ auto-grade → draft Grade
POST /grades/{id}/publish  POST /grades/{id}/republish
POST /grades/{id}/pass-fail-override      → body: { status, reason }
POST /students/{id}/quran-logs            PATCH /quran-logs/{id}   DELETE /quran-logs/{id}
                                          → each returns the synchronously recalculated surah coverage (§4.5)
```
(Grading-template routes — `POST /levels/{id}/grading-template/items` [add `{ exam_id, weight_bp }`, constraint-checked], `DELETE /grading-template-items/{id}`, `POST /grading-templates/{id}/activate` [transactional 10,000 bp validation, TD-4] — arrive with the post-MVP weight-template engine (§10.1, Revision 13); they are excluded from the MVP OpenAPI contract and the §3.1 CI conformance check until then.)

**3.7 Background jobs**
```
GET /jobs/{id}   → { state: created|active|completed|failed, progress, result|error }
```
Any endpoint that enqueues a job returns `202 Accepted` with `{ job_id }`.

**3.8 Standard error contract (all endpoints)**

Every non-2xx response uses one envelope:
```json
{ "error": { "code": "WEIGHT_SUM_EXCEEDED", "message_key": "errors.grading.weight_sum",
             "message": "…localized fallback…", "details": { }, "request_id": "…" } }
```
HTTP status usage: `400` validation failure (incl. missing `X-Active-Child-ID` on child-scoped endpoints) · `401` unauthenticated · `403` forbidden (TD-2 violation, consent gate, Global-scope violation) · `404` not found *or out of branch/family scope (never distinguish — no existence leaks)* · `409` state/constraint conflict · `413` payload too large · `429` rate-limited · `500` internal (no stack traces, no SQL, no internal paths ever leaked).

Machine-readable `code` enum — this is the **canonical application error-code catalog**; all services use exactly these identifiers (extensible only by SRS revision):

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Zod/TD-9 violations; missing `X-Active-Child-ID` (Parent-only caller, §4.3); MIME/size mismatch (409 variant on upload complete) |
| `AUTH_REQUIRED` | 401 | No/expired session |
| `FORBIDDEN` | 403 | TD-2 violation, consent gate, Global-scope violation |
| `NOT_FOUND` | 404 | Missing **or out-of-scope** (branch/family — never distinguished, no existence leaks) |
| `STATE_CONFLICT` | 409 | TD-1 transition violations; onboarding-token replay (§4.1b) |
| `VERSION_CONFLICT` | 409 | Optimistic-lock mismatch — stale `version` on a staff-edited entity (TD-15); client must reload and re-apply |
| `DUPLICATE` | 409 | Unique-constraint race loser (TD-6) |
| `WEIGHT_SUM_EXCEEDED` | 409 | Template items would exceed 10,000 bp |
| `TEMPLATE_NOT_ACTIVE` | 409 | Operation requires an active template (covers "template invalid" cases together with `WEIGHT_SUM_EXCEEDED`) |
| `CAPACITY_FULL` | 409 | Group roster at `max_students` (the "group full" condition — one code, not two) |
| `CONSENT_GATE_LOCKED` | 403 | Teacher attempting to lift a consent-forced private state (BR-3) |
| `CONSENT_REQUIRED` | 400 | Registration submitted without a mandatory consent checkbox (§4.1) |
| `FAMILY_LINK_PENDING` | 409 | **Own-resource contexts only** (a parent acting on their *own* not-yet-approved link request, e.g. duplicate submission). Never returned by the child-context middleware — there, an unapproved link is `404 NOT_FOUND` (§4.3); returning link status to a non-owner would leak existence |
| `SINGLE_SUBMISSION_FINAL` | 409 | Resume attempt on a single-submission exam |
| `UPLOAD_INCOMPLETE` | 409 | `/complete` on a missing/partial object |
| `PAYLOAD_TOO_LARGE` | 413 | TD-9 caps |
| `RATE_LIMITED` | 429 | Nginx/TD-13 limits |
| `OAUTH_EXCHANGE_FAILED` | 502 | Google code-exchange failure (timeout/5xx) during callback — surfaced to the browser only as the `/login?error=oauth_unavailable` redirect (§4.1b step 7) |
| `SERVICE_UNAVAILABLE` | 503 | A required external dependency (MinIO, OAuth upstream) is down — degraded-operation matrix TD-16 |
| `INTERNAL` | 500 | Anything else; no internals leaked |

User-facing messages resolve through i18n `message_key`s (AR primary).

### TD-4 — Transaction Boundaries (atomic sequences)

The following must each execute in **one database transaction** — all-or-nothing:

1. **Unified parent+child registration (§4.1b step 5):** Parent `User` + child `User` + `FamilyLink(pending)` + `ConsentRecord`(s) + Parent `UserIdentity` + **`ConsumedToken` (onboarding `jti`)** — the token-consumption insert inside this transaction is the replay guard (§4.1b).
2. **Registration approval (bundle):** parent activation + child activation + link approval + `AuditLog` row.
3. *(post-MVP — template engine, §10.1)* Template activation: lock items → verify 10,000 bp → activate → same-transaction `grade.recalculate` enqueue.
4. *(post-MVP — template engine, §10.1)* Active-template item mutation: demote to draft + freeze affected averages as stale; no recalc enqueue.
5. **Grade publish / re-publish:** grade status flip + `AuditLog` row.
6. **Roster mutation:** `StudentGroup` insert/delete + capacity check + consent re-evaluation job enqueue.
7. **Consent change:** `ConsentRecord` state change + re-evaluation job enqueue + `AuditLog` row (if staff-recorded).
8. **Soft delete (any entity):** `deleted_at/by` set + `Trash` snapshot insert + `AuditLog` row.
9. **Visibility change on content:** row update (+ `consent_forced_private` handling) + bucket-migration job enqueue.
10. **Pre-provisioned identity binding (§4.1b step 4b):** `UserIdentity` creation + any status-driven side effects + the `auth.identity_bound` audit row (TD-8), atomic with the login routing decision. Two concurrent first logins for one pre-provisioned account resolve first-wins on the `(provider, provider_subject_id)` unique constraint (TD-15.3); the loser re-reads and finds the account already bound.
11. **Quran log mutation (§4.5):** log insert/update/soft-delete commits in a short transaction; the fresh union coverage is **derived from the committed rows immediately after commit, within the same request**, and returned in the response — coverage is computed-on-read, so no aggregate write joins the transaction and no long lock is held (§4.5).

12. **Upload initiation under the per-user quota (§3.1, Revision 14):** lock the caller's `RateLimitCounter` row for the current window → verify the count is below the `upload.initiate` limit → increment → create the upload record. Check-then-write on a quota is exactly the TD-15.2 invariant pattern; evaluating the count outside the transaction would let two concurrent initiations both pass at the limit boundary. **Appended as item 12 deliberately — TD-4.11 is cross-referenced as the Quran-log transaction (§4.5, §17 J8) and must keep its number.**

13. **Refresh rotation (§4.1b, TD-12, Revision 16):** revoke the presented token (`revoked_at` set; **`revoked_reason` stays NULL — the four reasons in §7 name *deliberate* revocations, and rotation is mechanical supersession, so a revoked row with a null reason reads as "rotated"**, Revision 17) + insert its successor carrying the same `session_id` and `rotated_from_id` = the presented token + the `auth.refresh` audit row — **atomic**. A committed revocation with a lost successor logs the user out spuriously; a committed successor with an unrevoked predecessor leaves two live tokens and defeats reuse detection. Both halves must land or neither.
14. **Logout (Revision 16):** revoke every live token of the **current `session_id` only** + the `auth.logout` audit row. Other sessions of the same user are untouched — logging out of one browser must not end a session on another device.
15. **Suspension / deletion revokes sessions (TD-12, Revision 16):** the `account_status` transition to `Suspended` (and a User soft-delete, TD-5) **must, in the same transaction**, revoke **every** live `RefreshToken` of that user (`revoked_reason = suspension | user_deleted`) and write the `user.suspend`/`user.delete` and `auth.token_revoked` audit rows. TD-12 requires suspension to take effect on refresh **immediately**; a suspension that commits without revoking leaves a 30-day credential alive, which is the exact safeguarding failure the freshness rule exists to prevent.

**General rule:** wherever a mutation triggers a pg-boss job (items 6, 7, 9 above), the enqueue is a Postgres insert into the pg-boss job table **through the transaction client via `JobsRepository`** (§16.2 sanctioned raw-SQL exception — `boss.send()` is outside the transaction and prohibited here) and **must join the same transaction** as the mutation — a committed mutation with a lost job, or a job for an uncommitted mutation, are both prohibited states.

(Notification-row inserts rejoin transactions 2 and 5 when the notification framework ships post-MVP, §10.1.)

Bucket object moves themselves are eventually consistent via the migration job (object storage can't join a DB transaction); the DB row is the source of truth, and the presigned-URL mint endpoint checks the DB row, so a not-yet-migrated object is already unreachable through legitimate paths.

### TD-5 — Deletion & Cascade Rules

| Entity | Rule |
|---|---|
| Branch | **Prohibited** while Rooms or Groups reference it (`409 STATE_CONFLICT`). |
| Room | **Prohibited** while Groups reference it. |
| Category | **Prohibited** while Levels reference it. |
| Level | **Prohibited** while Groups or Exams reference it (GradingTemplates join this rule post-MVP). |
| Group | **Prohibited** while `StudentGroup` enrollments exist; deleting an empty group also removes its `GroupTeacher` rows. |
| Exam | Soft-delete; grades remain as informational records. (The active-template deletion guard applies when the post-MVP engine ships, §10.1.) |
| Subject | Soft-delete; referencing `EducationalContent.subject_id` and `Exam.subject_id` set to null (content falls into "General"). |
| User | **Soft-delete only** (`deleted_at = now()`): anonymize sensitive profile fields (phone, notes, social-profile fields) in the live row (full snapshot preserved in `Trash`), deactivate `UserIdentity` rows, **revoke every live `RefreshToken` in the same transaction (`revoked_reason = user_deleted`, TD-4.15, Revision 16 — otherwise a deleted user keeps a working session for up to 30 days)**, and cascade-remove `FamilyLink` and `GroupTeacher` rows. Grades/QuranProgressLog rows are retained (historical record) but detached from directories. |
| StudentGroup (un-enrollment) | Soft-delete of the enrollment row only. **Never deletes or modifies the student's Grades, StudentExamSubmissions, or QuranProgressLog rows — completed and draft academic records survive un-enrollment intact** (historical record; a re-enrolled or transferred student keeps their history). Triggers consent re-evaluation (TD-4.6). |
| QuranProgressLog | Soft-delete by Teacher/Admin (own students); triggers synchronous coverage recalculation (§4.5). |
| Event | Soft-delete; scope join rows removed; attached content keeps `event_id` for provenance but no longer surfaces under the event. |
| EducationalContent | Soft-delete; object moved to a quarantine prefix in the private bucket pending the 90-day window. |

Hard (permanent) deletion happens only via the `content.quarantine-purge` job after the 90-day window (and, when the Trash UI ships post-MVP, via the Super Admin permanent-delete action). MVP restorations follow the manual-SQL runbook (§4.10) and are always audit-logged.

### TD-6 — Database Constraints (schema-enforced)

**Uniqueness:**
* `UserIdentity (provider, provider_subject_id)` — unique.
* `UserIdentity (provider, email)` — unique among active identities; **emails are lowercased on every write and lookup** (application-normalized before persistence, TD-12) so uniqueness is effectively case-insensitive.
* `ConsumedToken (jti)` — unique (the onboarding-token replay guard, §4.1b).
* `FamilyLink (student_id, parent_id)` — unique among non-deleted rows (partial unique index `WHERE deleted_at IS NULL`).
* `AcademicYear`: exactly one `is_current = true` row application-wide (partial unique index).
* `StudentGroup (student_id, group_id)` — unique among non-deleted rows.
* `RateLimitCounter (user_id, bucket, window_start)` — unique (Revision 14); the constraint is what makes the increment safe under concurrency.
* `User.pre_provisioned_email` — **unique among non-null values** (partial unique index `WHERE pre_provisioned_email IS NOT NULL`, Revision 15). Two accounts must never both claim the same address, or a first login would be ambiguous about which account it binds.
* `RefreshToken.token_hash` — **unique** (plain, not partial — Revision 16). Expired and revoked rows are retained until `token.purge` collects them, and a hash collision is not a scenario worth modelling, so the index needs no predicate. The constraint is what makes "presented token → exactly one row" a lookup rather than a scan.

**Check constraints:**
* `QuranProgressLog`: `start_ayah >= 1 AND start_ayah <= end_ayah` (upper bound vs `total_ayahs` enforced in the service layer + DB trigger, since it crosses tables).
* `Grade.value_bp` and all `StudentExamSubmission` stored scores: `>= 0 AND <= 10000` — scores are integer basis points of the exam total (§4.6); no float score columns exist anywhere.
* `display_order >= 0` on Branch, Category, Level, Subject.
* `Group`: `max_students > 0` and `start_time < end_time`.
* `AcademicYear.label` matches `^\d{4}-\d{4}$` (and second year = first + 1, service-enforced).
* `SystemSetting` Hijri offset: `-2 <= value <= 2`.
* `User.pre_provisioned_email`: **`CHECK (pre_provisioned_email = lower(pre_provisioned_email))`** (Revision 15) — the same backstop as below, for the same reason: the column is matched against a lowercased OAuth email, so a mixed-case row would be permanently unmatchable and the partial unique index would not collapse case variants.
* `UserIdentity.email`: **`CHECK (email = lower(email))`** — the database refuses mixed-case storage outright, so a single unlowered code path (a pre-provisioning form, an import) can never create a case-variant duplicate that bypasses the unique index; application-layer lowercasing (TD-12) remains the normal path, this is the backstop.

**Collations:** the single `name` column on Branch, Category, Level, Subject (and Committee when it ships), and sortable person-name columns on User, are **natively collated `ar-x-icu` at the column level** (TD-6a) — sorting is correct by default in every query without per-query COLLATE clauses.

**Referential integrity:** every FK explicit; no implicit orphaning. All soft-deletable tables carry `(deleted_at, deleted_by)`. Hot query paths carry composite indexes matched to their access patterns (e.g., `(student_id, surah_id)` on progress logs, `(group_id, deleted_at)` on enrollments).

### TD-6a — Prisma Migration Workflow for PostgreSQL-Specific Elements (binding)

Prisma's `.prisma` schema syntax **cannot natively declare** custom collations (`ar-x-icu`), CHECK constraints, partial/functional unique indexes (the `WHERE deleted_at IS NULL` indexes above), or triggers. An agent attempting to write them into `schema.prisma` will fail to compile — or worse, silently drop the validations.

**Mandatory workflow:**
1. Model tables, columns, enums, FKs, and plain unique indexes in `schema.prisma` as normal.
2. For every PostgreSQL-specific element in TD-6: run **`prisma migrate dev --create-only`** to generate an empty migration, then **hand-write the SQL** into that `migration.sql` before applying. **The very first hand-written migration must explicitly register the collation locally** — `CREATE COLLATION IF NOT EXISTS "ar-x-icu" (provider = icu, locale = 'ar', deterministic = true);` — before any column references it (do not rely on the collation being predefined in every PostgreSQL image; explicit registration makes the migration history self-contained and portable). Subsequent statements then apply it (`ALTER TABLE … ALTER COLUMN name TYPE text COLLATE "ar-x-icu"`), add CHECK constraints (`ALTER TABLE … ADD CONSTRAINT … CHECK`), partial unique indexes (`CREATE UNIQUE INDEX … WHERE …`), and triggers.
3. These hand-written migrations are version-controlled and applied in order via `prisma migrate deploy` (§19.1). They are part of the contract: a CI check (§19.2) asserts their presence in the migration history.
4. **`prisma db push` is prohibited in every environment** — it bypasses the migration history and will silently drop the hand-written SQL.

### TD-6b — Migration Compatibility Policy (binding)

* **Forward-only in production.** Down-migrations are never written or run against production; rollback = restore from the pre-deployment backup (§6, §19.1). Prisma's migration history is append-only.
* **Migrations must preserve production data — always.** A migration that loses rows or column contents is a defect regardless of what it enables. Every deployment runs a **`pg_dump` immediately before `prisma migrate deploy`** (§19.1) so the rollback point matches the pre-migration state exactly.
* **Destructive operations follow expand–migrate–contract.** Dropping a column/table or tightening a constraint on populated data is allowed **only** as the final *contract* step of a three-phase sequence: (1) *expand* — add the new structure alongside the old; (2) *migrate* — backfill and switch application code to the new structure (deployed and verified); (3) *contract* — drop the old structure in a **separate, later migration**, after no released code references it. A single migration that adds-and-drops in one step is prohibited.
* **No direct column or table renames.** A rename is expand–migrate–contract (add new name, backfill/dual-write, drop old) — Prisma renders naive renames as DROP+ADD, which silently destroys data.
* **New NOT NULL columns** on populated tables ship with a DEFAULT or an in-migration backfill — never a bare NOT NULL that fails or nulls-out on existing rows.
* **Every migration is rehearsed** against a staging database seeded to ceiling-scale fixtures (§2.4) before touching production; migration duration matters on populated tables (an `ALTER` that rewrites 1M audit rows must be known about beforehand, not discovered during a deploy window).
* CI enforces: append-only migration history, no `db push` (TD-6a), and a lint that flags `DROP`/`RENAME` statements for mandatory human review tagged with their contract-phase justification.

### TD-7 — Background Job Catalog (pg-boss)

All jobs carry retry: exponential backoff, max 5 attempts, then dead-letter with an Admin-visible failure. Singleton keys prevent duplicate concurrent runs. (Note: Quran coverage recalculation is **not** a job — it is synchronous, §4.5.)

| Job | Trigger | Payload | Concurrency/idempotency |
|---|---|---|---|
| `consent.reevaluate` | roster change, consent change, upload (§4.1a) | `{ group_id }` | singleton per group; full recompute — idempotent |
| `content.bucket-migrate` | visibility change (TD-4.9), consent forcing | `{ content_id, target_bucket }` | idempotent (copy-verify-delete; skip if already in target) |
| `backup.replicate` | cron (nightly) | — | `pg_dump` + `restic` push to second Moroccan location; failure raises Admin-visible alert |
| `content.quarantine-purge` | cron (daily) | — | permanently removes storage objects past the 90-day trash window |
| `upload.gc` | cron (daily) | — | deletes initiated-but-never-completed uploads **strictly older than 48 h** (never younger — an in-progress slow upload must not be reaped) |
| `token.purge` | cron (daily) | — | deletes `ConsumedToken` rows past their TTL horizon (keeps the replay-guard table small) **and `RefreshToken` rows past `expires_at` (Revision 16), so a table that gains a row per refresh does not grow unbounded**. Purging is fail-closed: a presented token with no row is simply invalid, so collecting expired rows can never widen access |
| `ratelimit.purge` | cron (daily) | — | deletes `RateLimitCounter` rows for elapsed windows (Revision 14). Housekeeping only — the quota decision itself is synchronous and never depends on this job |

(`import.csv` / `export.csv` and `grade.recalculate` join this catalog with their post-MVP phases, §10.1.)

Prohibited: any in-memory/`setImmediate` substitute for these jobs (§20).

### TD-8 — Audit Log Coverage Grid

Every action below writes an `AuditLog` row (actor, timestamp, action_type, target, JSONB detail). This list is the minimum; adding coverage is allowed, removing it is not.

| action_type | Detail payload includes |
|---|---|
| `auth.login` / `auth.login_denied` | provider, identity email, denial reason (pending/deactivated) |
| `auth.identity_bound` | pre-provisioned binding (§4.1b step 4b) |
| `auth.refresh` *(Revision 16)* | session id, rotated-from token id — the rotation trail (TD-4.13) |
| `auth.logout` *(Revision 16)* | session id revoked (TD-4.14) |
| `auth.token_revoked` *(Revision 16; detail tightened in Revision 17)* | reason (`suspension` \| `user_deleted` \| `reuse_detected`), **the list of affected `session_id`s**, and their count (TD-4.15). A count alone cannot attribute a *specific* session when several are revoked at once, which would break the §7 attribution invariant — so the ids are recorded, not just the total. A `reuse_detected` row is a **security event**: it means a rotated token was replayed outside the grace window |
| `user.approve` / `user.reject` / `user.suspend` / `user.delete` | reason where applicable |
| `familylink.approve` / `familylink.reject` | link parties, reason |
| `familylink.revoke` *(Revision 16)* | link parties, actor, reason — the soft-delete of an approved link (§4.3) |
| `consent.grant` / `consent.revoke` | consent_type, method, text version, on-behalf actor if staff-recorded |
| `consent_gate.override` | resource, **mandatory justification text** |
| `grade.publish` / `grade.republish` | exam, students affected count |
| `grade.passfail_override` | student, old→new, reason |
| *(post-MVP — template engine, §10.1, Revision 13)* `template.activate` / `template.demote` | sum at time of action; rows join the grid when the engine ships |
| `quranlog.update` / `quranlog.delete` | log reference, old→new range, recalculated coverage |
| `group.delete` / `branch.delete_blocked` etc. | entity snapshot reference |
| `content.visibility_change` | old→new tier, consent-forced flag state |
| `content.global_scope_assigned` | actor role, content reference (BR-20) |
| `trash.manual_restore` | entity reference, runbook script id (MVP manual-SQL restores, §4.10) |
| `settings.change` | key, old→new |

(`data.export` / `data.import` and `trash.restore` / `trash.permanent_delete` UI actions join the grid with their post-MVP features.) Login audits retain 12 months; all other audit rows retained indefinitely for MVP. Audit rows are append-only — no update or delete path exists in the application.

### TD-9 — Data Validation Limits & File/Storage Naming

**Field limits (server-enforced; UI mirrors them):**
* Phone: 5–20 characters, digits/`+`/spaces only; non-unique.
* Arabic name: max 120 chars. French name (person profiles only): max 120 chars. Nickname: max 60 chars. Structural entity `name`: max 120 chars, Arabic.
* Notes: max 2,000 chars. Consent-override justification: 10–1,000 chars (mandatory).
* Rejection/approval reasons: max 500 chars.

**Upload limits & MIME whitelist:**
* Audio recordings: max **100 MB** (Revision 12 — reduced from 500 MB: ≈14 MB/hour at 32 kbps mono speech, so 100 MB ≈ 6+ hours; shrinks the R-9 single-shot blast radius, the disk budget, and the Nginx body limit together); MIME `audio/webm`, `audio/mp4`, `audio/ogg`, `audio/mpeg`, `audio/wav`.
* Documents/slides/images: max **50 MB**; MIME `application/pdf`, `image/jpeg`, `image/png`, `image/webp`, common office types (docx/pptx/xlsx).
* MIME validated server-side at upload completion (magic bytes, not just declared header); mismatch → `409 VALIDATION_FAILED` and object deleted.

**Deterministic, immutable storage keys** (visibility never encoded in the key — the bucket carries it; a **short random hash segment** defeats browser/Nginx/CDN caching collisions when a file with the same name is re-uploaded — retained unchanged despite the single-shot upload simplification):
```
content/{content_id}/{short-random-hash}/{original-filename-slugified}.{ext}
quarantine/{content_id}/…        (soft-deleted objects)
```
* `short-random-hash`: 8 hex chars, generated at key creation.
* **Keys are immutable once written.** Replacing a file on an existing content record generates a *new* key (new hash segment) and updates the DB reference; the old object is quarantined. Cached URLs of the old object can therefore never mask a newer upload.
* Original filenames are slugified (Arabic preserved via transliteration slug + stored display name in DB).

### TD-10 — Pagination, Sorting & Search Standards

* Every list endpoint is paginated: `?page=1&page_size=25`; **default 25, max 100**; response envelope `{ data: […], meta: { page, page_size, total } }`.
* All sorts include a deterministic tiebreaker (`id`) to keep pagination stable.
* Structural entities sort by `display_order ASC NULLS LAST`, then by `name` — which is correct Arabic order automatically because the column is natively collated `ar-x-icu` (TD-6a). Never add per-query COLLATE workarounds; fix the column.
* **Student search** (`GET /admin/users?role=student&q=…`) matches across: Arabic name, French name, nickname, phone, linked parent's name, and Google email. **Email search covers both `UserIdentity.email` and `User.pre_provisioned_email` (Revision 15)** — a pre-provisioned account has no identity row until its first login, so searching only `UserIdentity` would make exactly the accounts staff most need to find (the ones not yet claimed) invisible. Both columns are already lowercase (TD-6), so email matching needs no shadow column. **Search semantics (normative, Revision 9):**
  * **Substring matching**, not prefix-only and not whole-word (`سعاد` matches `أم سعاد`); minimum query length 2 characters; case-insensitive.
  * **Normalization applied identically to the query and the stored value:** Arabic — strip tashkeel/diacritics and tatweel, normalize alef variants `أإآ→ا`, `ة→ه`, `ى→ي`; Latin — lowercase and fold accents (`é→e`, for French names); phone — strip spaces and `+` before matching.
  * **Implementation:** each searchable column is paired with a **generated normalized shadow column** (populated via the normalization function in a TD-6a migration), indexed, and queried with `ILIKE '%…%'` against the shadow — normalization is never applied per-row at query time.
  * **No typo tolerance / fuzzy matching in MVP** — no trigram similarity, no Levenshtein, no search engine. Paper-roster spelling variance is absorbed by the normalization rules above (which collapse the dominant variant classes); genuine misspellings are a data-entry correction problem (R-5), not a search-engine problem. Fuzzy matching may be revisited post-MVP if UAT shows normalization is insufficient — as an explicit decision, not an agent's initiative.

### TD-11 — Time, Timezone & Date Policy

* All persisted timestamps (`created_at`, `logged_at`, audit rows, job times) are **UTC `timestamptz`**.
* **Group weekly times and Event times are local Moroccan wall-clock values** (`time`/`date` + implicit `Africa/Casablanca`), *not* UTC instants. Rationale — this is a known agent trap: Morocco observes UTC+1 but **suspends DST during Ramadan every year**; a weekly class stored as a UTC instant would silently shift by an hour twice a year. A class at 17:00 is at 17:00 on the wall clock, always.
* Rendering, recurrence expansion, and "today" boundaries are computed in `Africa/Casablanca` (IANA tz database keeps the Ramadan transitions current — pin tzdata updates in the Docker image).
* Week starts Monday everywhere (BR-17). Hijri display is decorative only, Morocco-tuned, admin-offset-adjustable, and **in MVP scope** (§4.4).

### TD-11a — Non-Functional Targets (measurable)

| Metric | Target |
|---|---|
| Standard API reads (dashboard, lists) | p95 < 300 ms |
| Quran progress log write **including synchronous interval-merge recalculation** | p95 < 100 ms |
| Presigned URL mint | p95 < 150 ms |
| Full-level grade recalculation (100 students × 10 exams) | < 60 s (background) |
| Backup RPO / RTO | ≤ 24 h / **< 1 h**, restore drill passed before launch |
| Availability (single-VPS realistic target) | 99% monthly |

### TD-12 — Auth Session, Child Context & Presigned URL Policy

* JWT **access token TTL: 1 hour**; **refresh token TTL: 30 days**, stored in an `HttpOnly; Secure; SameSite=Lax` cookie; refresh rotation on use; server-side revocation list checked on refresh (suspension/deletion takes effect within one access-token TTL at worst — suspension additionally revokes refresh immediately). **Single-flight refresh (Revision 12):** rotation makes concurrent refreshes from multiple tabs a logout race — the client therefore serializes refresh through a single-flight mutex (one in-flight refresh; concurrent callers await its result), and the server accepts the immediately-previous rotated token within a 10-second grace window to absorb unavoidable races.
* **Refresh token storage and rotation mechanics (Revision 16 — the state above lives in `RefreshToken`, §7).** Tokens are persisted **hashed, never raw**; the presented value is hashed and looked up against the unique `token_hash` (TD-6). Exactly three outcomes, decided by `rotated_from_id` and `revoked_at`:
  1. **Current, live token** → rotate (TD-4.13): revoke it, insert a successor in the same `session_id`, return a fresh access token and the new refresh cookie.
  2. **Immediate predecessor of the live token, within 10 s of the successor's `issued_at`** → **accept without rotating again**. The server returns a fresh access token and re-sends the **already-issued** successor; it does **not** mint a third token. Rotating here would fork the chain into two live tokens, and a forked chain makes reuse detection impossible — so the grace window is deliberately idempotent, not a second rotation.
  3. **Any older token in the chain, or any revoked token** → **reuse detected**: revoke **every live token sharing that `session_id`** (`revoked_reason = reuse_detected`), refuse the request, and write **both** `auth.token_revoked` and `auth.login_denied` (TD-8). A replayed rotated token is the signature of a stolen cookie, so the response is to end the whole session rather than to extend grace. Never accepted, never resurrected.
  * **Revoke-all is an internal capability, not a screen.** Suspension and user deletion revoke every live token of the user (TD-4.15). MVP exposes **no user-facing "log out everywhere" control** — §14.1 defines no such node and TD-3.1 no such route; the capability exists because safeguarding requires it, not because a user can invoke it.
  * A purged or unknown `token_hash` is simply invalid — the failure mode is fail-closed in every direction.
  * **Refusal response:** every refresh refusal — expired, revoked, unknown, purged, or reuse-detected — answers `401 AUTH_REQUIRED` in the standard envelope (TD-3.8, "No/expired session"). **No new error code is introduced**, and the refused paths are deliberately indistinguishable to the caller: telling a holder of a stolen cookie *why* it failed would confirm that the token was once real. The distinction is recorded in the audit log, not in the response.
* **Token transport & CSRF posture (Revision 10):** the access token is carried **exclusively in the `Authorization: Bearer` header** — it is never placed in a cookie, so ordinary API mutations are structurally immune to CSRF (a cross-site attacker cannot set the header). **The refresh endpoint (`POST /auth/refresh`) is the only cookie-authenticated route** and must additionally require a custom header (`X-Requested-With: XMLHttpRequest`) and validate the `Origin` against `PUBLIC_BASE_URL`; combined with `SameSite=Lax` this closes the remaining CSRF surface without a double-submit token system. Same-origin routing (§3.1) is a delivery mechanism, not a security shield — never treat it as CSRF protection by itself.
* **High-risk endpoint freshness (Revision 10 — statelessness ends where safeguarding begins):** an unexpired access token is *not* sufficient authorization for the following operations; each must **assert against the database, per request**, that the caller's `account_status = Active` (and that the invoked role/scope assignment still exists): presigned GET minting (`/content/{id}/download-url`), any `StudentSocialProfile` read, approval actions (`/admin/approvals/*`), consent-gate overrides, staff-assisted consent recording, pass/fail overrides, and user-management mutations. Rationale: a Teacher or Admin suspended mid-session must lose access to minors' case files and private recordings **immediately**, not at token expiry — the ≤1-hour stateless window is acceptable for reading one's own schedule, not for safeguarding-sensitive reads. (Parent→child access is already fresh by construction: the `X-Active-Child-ID` middleware checks the `FamilyLink` row on every request, §4.3 — link revocation takes effect instantly.) The DB assertion is one indexed read; the affected endpoints are low-frequency, so TD-11a targets are unaffected.
* **Verified-token identity extraction:** wherever a signed token carries identity fields (the onboarding token's `email` + `provider_subject_id`, §4.1b), the server uses **only the token payload** — identity fields arriving in a request body alongside such a token are ignored and excluded from the endpoint's schema. **Cookie delivery depends on the same-origin Nginx path routing (§3.1)** — the client at `/` and the API at `/api/v1/` on one domain; splitting them across subdomains/origins breaks SameSite and is prohibited.
* JWT claims: `sub` (user_id), `roles[]`, `branch_scopes[]`, `account_status`, `iat/exp`. No PII beyond these; no email in the token. **The active child is never a JWT claim** — child context is asserted per request via the **`X-Active-Child-ID` header** and verified by middleware against an `Approved` `FamilyLink` **matching both the authenticated parent and the header child** (§4.3). **Callers holding the `Student` role acting on their own data bypass the header entirely — ownership is verified directly against the JWT `sub`** (§4.3). This keeps child switching instant (no re-issue) and keeps authorization evaluation fresh on every request (a link revoked mid-session takes effect immediately).
* **OAuth flow state (Revision 16 — closes an implementation gap):** the `state` value and the PKCE **code verifier** must survive the redirect to Google and back. They are held in a **short-lived, signed, `HttpOnly` cookie scoped to the callback path**, cleared on use, and are **not** an exception to the rule above: that rule governs cookie-based *authentication*, and transient flow state authenticates nobody. No table is created for it — the values are worthless once the callback completes.
* **Onboarding token (§4.1b):** short-lived (10 min), single-use, signed; carries verified `email` + `provider_subject_id` from the OAuth callback to the registration submission, plus a **unique `jti` claim**. Single-use is enforced by inserting the `jti` into the **`ConsumedToken`** table inside the registration transaction (unique constraint, TD-6); a replay aborts on the uniqueness violation with `409 STATE_CONFLICT`. Consumed rows are purged daily after their TTL horizon (`token.purge`, TD-7). Never stored client-readable beyond the redirect.
* **Email normalization:** every Google OAuth email is **lowercased before every lookup and every write** — identity binding (§4.1b step 4b), pre-provision matching **against `User.pre_provisioned_email`, including when staff first write that column** (Revision 15), `SUPER_ADMIN_EMAIL` comparison, and `UserIdentity` persistence all operate on the lowercased form, so case variants of one mailbox can never create or match distinct identities.
* Presigned **GET** URLs (private bucket): TTL **10 minutes**, single content object, minted only after the TD-2 permission check (including child-context verification where the requester is a Parent).
* Presigned single-shot **PUT** URLs: TTL **1 hour**; initiated-but-never-completed uploads garbage-collected after 48 h (`upload.gc`, TD-7).
* Google OAuth: `state` + PKCE enforced; only the configured client ID accepted; email must be verified by Google.

### TD-13 — Configuration & Environment Catalog

All runtime configuration flows through environment variables (docker-compose `.env`, never committed) or the `SystemSetting` table — nothing hardcoded.

**Machine-readable environment variable inventory** (this table is the single authoritative list; `.env.example` is generated from it and must stay in lockstep; the app **fails fast at boot** with a named error if any Required variable is missing):

| Variable | Required | Default | Example | Purpose |
|---|---|---|---|---|
| `DATABASE_URL` | Yes | — | `postgres://app:***@db:5432/bodour` | PostgreSQL connection (Prisma + pg-boss) |
| `GOOGLE_CLIENT_ID` | Yes | — | `1234…apps.googleusercontent.com` | OAuth client (§4.1b) |
| `GOOGLE_CLIENT_SECRET` | Yes | — | `GOCSPX-…` | OAuth client secret |
| `JWT_SIGNING_KEY` | Yes | — | `openssl rand -base64 48` output | Access-token signing (TD-12); rotatable |
| `ONBOARDING_TOKEN_KEY` | Yes | — | `openssl rand -base64 48` output | Onboarding-token signing (§4.1b); distinct from JWT key |
| `MINIO_ENDPOINT` | Yes | — | `http://minio:9000` | Internal S3 API endpoint |
| `MINIO_ACCESS_KEY` | Yes | — | `bodour-app` | MinIO credential |
| `MINIO_SECRET_KEY` | Yes | — | `openssl rand -base64 32` output | MinIO credential |
| `PUBLIC_BASE_URL` | Yes | — | `https://platform.bodour.ma` | Canonical origin (client `/`, API `/api/v1/`, §3.1) |
| `STORAGE_BASE_URL` | Yes | — | `https://platform.bodour.ma/storage` | Public storage path prefix (§3.1) |
| `SUPER_ADMIN_EMAIL` | Yes | — | `admin@bodour.ma` | Super Admin allow-list seed (§15.1) |
| `NODE_ENV` | Yes | — | `production` \| `development` \| `test` | Fixture guard (§15.2), error verbosity. `test` is the §19.2 test-runner value — a non-production tier for every guard; boot validation enumerates exactly these three values (Revision 13) |
| `BACKUP_TARGET_SSH` | Prod only | — | `restic@backup.ma:/srv/bodour` | Offsite Moroccan backup target (§6) |
| `TZ` | No | `Africa/Casablanca` | `Africa/Casablanca` | Container wall-clock alignment (TD-11) |
| `PORT` | No | `3000` | `3000` | API listen port (behind Nginx) |
| `LOG_LEVEL` | No | `info` | `info` \| `debug` | Structured log verbosity (TD-14); `debug` prohibited in production |

Secrets have **no defaults by design** — a secret that silently defaults is a vulnerability, not a convenience. Generation guidance in the Example column is documentation, not an auto-generation mechanism.

* **SystemSetting (application-level, runtime-editable):** branding assets, legal/consent text versions, Hijri offset, Category default visibilities, and the grading scale and passing-grade defaults (`grading.display_scale = 20`, `grading.passing_grade_bp = 5000` — 10/20, §4.6 Revision 14) plus any per-level overrides. These are settings rows, never columns on `Level`/`Category` (§7).
* **Rate limits (starting values, tunable) — split by layer per §3.1 (Revision 14):**
  * **Nginx, per IP:** auth endpoints 10 req/min/IP; general API 120 req/min/IP. A coarse per-IP guard also sits on upload initiation as defence in depth; because `limit_req` cannot express an hourly rate, it is set at the nearest expressible floor (`1r/m`) and is **explicitly not** the quota.
  * **Application, per user:** **upload initiations 30 per hour per user** — the authoritative quota, counted in PostgreSQL (`RateLimitCounter`, §7) and evaluated synchronously in the request that it gates.
  * `/storage/` location: `client_max_body_size 110m`, `proxy_request_buffering off`; `/api/v1/`: `client_max_body_size 2m` (§3.1).
* **Connection-pool budget (Revision 12, pinned — the real concurrency risk on this box is pool exhaustion, not deadlock):** Prisma `connection_limit=10`; pg-boss pool ≤ 5; Postgres `max_connections=30`; `statement_timeout=10s` (interactive transactions must finish well inside it). These numbers are configuration, not suggestions — an agent must not leave any of them at defaults.
* **Container memory pins (4 GB VPS budget):** Postgres `shared_buffers=256MB`, `work_mem=8MB`; MinIO `GOMEMLIMIT=512MiB`; Node `--max-old-space-size=768`. Steady-state target ≈ 2.2 GB, leaving headroom only because production images are CI-built (§19.1).
* Secrets never appear in logs, error payloads, or the OpenAPI doc.

### TD-14 — Observability & Health Minimums

* `GET /healthz` (public, unauthenticated): checks DB connectivity, MinIO reachability, pg-boss queue heartbeat → `200` or `503` with component detail.
* Structured JSON logs with `request_id` propagated into every error envelope (TD-3.8) and job record — a user-reported error is traceable end-to-end.
* **No PII in logs:** log user IDs, never names/phones/emails; never log request bodies on registration/consent endpoints; never log `X-Active-Child-ID` values alongside identifying data.
* Job failures past max retries surface on the Admin dashboard; backup job failure is treated as critical.

### TD-15 — Concurrency Policy (global)

PostgreSQL default **READ COMMITTED** isolation everywhere; correctness comes from the three mechanisms below, not from escalating isolation levels (no global SERIALIZABLE — the retry machinery isn't justified at §2.4 scale).

1. **Optimistic locking on staff-edited entities.** `Group`, `Level`, `Category`, `Subject`, `Branch`, `Room`, `Event`, `Exam` (draft), `EducationalContent` metadata, `SystemSetting`, **`Grade`** (concurrent co-teacher scoring and admin overrides on the same row must not clobber each other; the post-MVP recalculation job will participate in the same version discipline), and **`User`** (staff-edited profile, role, and branch-scope changes) each carry an integer **`version`** column. Every edit form loads the current `version` and sends it back; the UPDATE is conditional (`WHERE id = ? AND version = ?`, incrementing `version`). Zero rows updated → **`409 VERSION_CONFLICT`** — the client shows "this record was changed by someone else," reloads, and the user re-applies. **Silent last-write-wins on these entities is prohibited.** (Two admins editing the same Group: first save wins, second gets the conflict — nothing is merged, nothing is lost silently.)
2. **Pessimistic row locks on invariant-bearing transactions.** TD-4 transactions that *check-then-write* an invariant take `SELECT … FOR UPDATE` on the governing rows before the check (via the sanctioned repository-level `$queryRaw`, §16.2): roster mutation locks the Group row (capacity check vs `max_students`, TD-4.6); per-user quota enforcement locks the `RateLimitCounter` row for the active window before the count is compared to the limit (Revision 14, TD-4.12); `display_order` reordering executes as one transaction locking the parent-scope rows (batch update; concurrent batches serialize; Super-Admin-only so contention is negligible). Lock ordering is consistent (parent before children) to prevent deadlocks; lock scope is rows, never tables.
3. **State transitions and unique races are first-wins.** Two admins approving the same registration, two decisions on the same family link, double-publish of a grade: the first transaction commits the TD-1 transition; the second finds the state already advanced and receives `409 STATE_CONFLICT` — a benign outcome the UI treats as "already handled, refreshing." Unique-constraint races (TD-6: family-link creation, template items, enrollment, consumed `jti`) resolve the same way: first insert wins, loser gets `409 DUPLICATE`. **Concurrency conflicts are never surfaced as 500s** — they are expected, coded outcomes.
4. **Jobs:** pg-boss singleton keys (TD-7) are the concurrency control for background work — never in-process mutexes or advisory-lock improvisations.
5. **Quran logs need no special handling:** appends by co-teachers interleave freely; coverage is derived-on-read from committed rows (§4.5), so there is no aggregate to race on.

### TD-16 — External Dependency Failure & Degraded Operation

`/healthz` (TD-14) reports per-component state; the matrix below defines behavior while a component is down. **The system never fabricates success**: a failed dependency yields `503 SERVICE_UNAVAILABLE` (TD-3.8) on the affected operations and the §14.4 Error/Offline states in the UI — never blank screens, never silent data loss.

| Dependency down | Blast radius | Required behavior |
|---|---|---|
| **Google OAuth** | New logins and new registrations only | **Active sessions are unaffected** — access-token refresh is local (TD-12) and never calls Google. `/login` shows a friendly "sign-in temporarily unavailable, try again shortly" state with retry; no queuing of registrations. |
| **MinIO** | Uploads, downloads/previews, bucket migrations | Upload initiate/complete and presigned mints return `503`; content pages render their Error state with retry (§14.4); all non-content functionality (scheduling, grading, Quran, approvals) continues fully. `content.bucket-migrate` jobs retry per TD-7 — DB visibility rows remain the source of truth, so no window of wrong exposure opens (§3.1, TD-4). |
| **PostgreSQL** | Everything | Total API outage: `/healthz` 503; Nginx serves the static client shell and maps API failures to a friendly maintenance interstitial (never raw 502 pages). Recovery is restore/restart per §6 — there is no read-only or cached mode. |
| **pg-boss workers** (DB up, workers down/crashed) | Background processing latency | Enqueues keep succeeding (they are DB inserts inside TD-4 transactions) — **jobs are delayed, never lost**. Recalculations, consent re-evaluations, and migrations catch up on worker restart. Queue-lag alarm past 10 minutes surfaces on the Admin dashboard. |
| **Backup target (second Moroccan location)** | Backup redundancy only | `backup.replicate` fails → **critical Admin-visible alert** (TD-7); production continues; nightly retry. Two consecutive failures escalate to the owner — running without offsite backup is an accepted emergency state measured in days, not weeks (§6 RPO). |
| **Let's Encrypt renewal** | Future TLS validity | Certbot renews well before expiry; renewal failure alerts at 21 days remaining — never discovered as a browser error. |

Timeout discipline: every outbound call (Google, MinIO) carries an explicit timeout (5 s default) and no automatic in-request retries beyond one — retry belongs to the user action or the job layer, not hidden loops that stack latency.

---

## 14. UI/UX Standards

### 14.1 Sitemap / Navigation Map (authoritative)

AI agents must implement exactly this navigation hierarchy — no invented sections, no reshuffling. Items render only for roles permitted by TD-2; the sidebar is RTL-first.

```
PUBLIC (no auth)
├── / ................................. Landing
├── /login ............................ Google OAuth entry
├── /register ......................... OAuth-first registration (§4.1b)
├── /resources ........................ Public resource directory (restricted items gated)
├── /calendar ......................... Public calendar (public tier only)
└── /content-unavailable .............. Stale-link friendly error

AUTHENTICATED (role-gated; header: account switcher incl. child context, language switcher)
├── Dashboard ......................... role-specific home (/dashboard/student, /dashboard/parent, /teacher, /admin)
├── Academic
│   ├── Groups ........................ /admin/groups (staff) · /teacher/groups (teacher view)
│   ├── Levels ........................ /admin/levels
│   ├── Subjects ...................... /admin/taxonomy (subjects tab)
│   ├── Exams ......................... /teacher/exams (author/grade) · /dashboard/student/grades (take/view)
│   └── Quran Progress ................ /teacher/students/{id}/quran · /dashboard/student/quran
├── People
│   ├── Users ......................... /admin/users
│   ├── Approvals ..................... /admin/approvals
│   └── Family ........................ /dashboard/parent · /family/link-child
├── Calendar .......................... /admin/calendar (manage) · /dashboard/student/calendar (view)
├── Content
│   ├── Resources ..................... /resources (all roles)
│   ├── Upload / Record ............... /teacher/content
│   └── Content Library ............... /admin/content
├── Administration
│   ├── Branches & Rooms .............. /admin/branches
│   ├── Categories & Subjects ......... /admin/taxonomy
│   └── System Settings ............... /superadmin/settings (Super Admin only)
└── Profile ........................... /profile
```
(Removed from the MVP sitemap by Revision 6: `/notifications`, `/admin/data`, `/admin/trash` — they return with their features post-MVP, §10.1.)

**Status interstitials are redirect targets, not navigation nodes (clarified in Revision 16).** The approval-status screen (§2.1, §4.1b) and the "Account deactivated" screen (§4.1 — which also serves rejected accounts) are reached only by a server or guard redirect and appear in no menu, which is why they are absent from the hierarchy above. Their absence is **not** licence to omit them, and building them is **not** an invented section under §20 rule 16. Equally, no session-management or "log out everywhere" node exists here, and none may be added (TD-12).

### 14.2 Screen CRUD Standard + Key Screen Definitions

**Every list/management screen follows one pattern:** paginated table (TD-10) · search box where TD-10 defines search · filters row · primary "Create" action (role-gated) · per-row actions (Edit / role-gated destructive actions behind a confirm dialog) · all states from §14.4. Definitions for the core screens (columns are the minimum set; RTL column order):

| Screen | Columns | Row actions | Filters |
|---|---|---|---|
| Groups (`/admin/groups`) | Name, Level, Branch, Room, Day+Time, Teacher(s), Enrolled/Capacity | Edit, Roster, Delete (guarded TD-5) | Branch, Level, Teacher |
| Users (`/admin/users`) | Arabic name, Nickname, Role(s), Branch scope, Status, Phone | Edit, Approve/Reject (if pending), Deactivate, Consents | Role, Branch, Status |
| Approvals (`/admin/approvals`) | Type (registration/link), Applicant(s), Submitted date, Bundle contents | Approve, Reject (reason) | Type, Branch |
| Exams (`/teacher/exams`) | Title, Level, Subject/Surah, Date, Round, Policy, Status | Edit, Publish, Grade submissions | Level, Round, Status |
| Content Library (`/admin/content`) | Title, Level, Branch (or Global), Year, Visibility, Consent-forced flag | Change visibility (gated), Move scope, Delete | Level, Branch, Year, Visibility |
| Events (`/admin/calendar` list mode) | Title, Date(s), Recurrence, Visibility, Scope summary | Edit, Delete | Branch, Visibility, Date range |
| Branches (`/admin/branches`) | Name, Operational start, Rooms count, Groups count | Edit, Rooms, Event backfill | — |

### 14.3 Shared Component Registry (build once, reuse)

An agent must implement these as single shared components and never duplicate them per page:

| Component | Used by |
|---|---|
| `StudentSelector` (searchable, TD-10 normalization) | Roster management, exam grading, Quran logging, family links |
| `GroupSelector` / `LevelSelector` / `BranchSelector` (display_order-aware, `ar-x-icu` fallback) | Group CRUD, event scoping, content upload, filters everywhere |
| `PaginatedTable` (TD-10 envelope, states §14.4) | Every list screen in §14.2 |
| `DualDateDisplay` (Gregorian + decorative Hijri with offset — in scope) | Calendar, dashboards, event details, exam dates |
| `VisibilityBadge` + `VisibilitySelect` (three-tier enum, consent-lock aware) | Content, events, upload flows, admin library |
| `ConsentStatusBadge` | User management, roster views, content library |
| `FileUploader` (single-shot presigned PUT, progress bar, retry affordance, TD-9 limits) | Content upload |
| `ChildContextSwitcher` (sets client `X-Active-Child-ID` state; renders approved links only) | Header account switcher, parent dashboard |
| `ApprovalCard` (bundle-aware: parent+child+link) | Approval queue |
| `ConfirmDialog` (destructive actions, reason/justification field when TD-8 requires it) | All destructive/override actions |
| `EmptyState` / `ErrorState` / `NoPermissionState` (§14.4) | Every page |
| `JobStatusIndicator` (polls TD-3.7) | Bucket migrations |

### 14.4 UI State Standard (mandatory on every page)

Every page and every data-bearing component implements all of: **Loading** (skeleton, not spinner-only, for tables) · **Empty** (friendly Arabic-first empty state with the relevant "create" action if permitted) · **Error** (envelope `message_key` rendered, `request_id` shown discreetly, retry button) · **No permission** (`NoPermissionState`, never a blank page or a crash) · **No data / filtered-out** (distinct from Empty: "no results match your filters" + clear-filters action) · **Offline/retry** (failed fetches show a retry affordance; failed uploads show a clear retry that restarts the single-shot upload, §4.9). Forgetting empty states is the most common agent failure mode — CI E2E checks assert them (§19.2).

**No-role landing (Revision 16):** an `Active` account carrying **no** role assignment is reachable only through staff error (approval is what grants roles, §4.1), and it renders the `NoPermissionState` above — never a blank page, never a crash, and never a dashboard, since no endpoint would authorize it under TD-2. No separate screen is added for this.

**Pending route guard (Revision 8):** the client implements a **global router guard** that intercepts any user with `account_status = Pending` (from `GET /me`) and hard-redirects them to the approval-status screen before any authenticated route renders — a Pending user must never see empty skeleton layouts, sidebars, or loading shells of the application. This guard is a UX layer only; the server-side denial (TD-1: no endpoint beyond `GET /me` + logout returns data to a Pending session) remains the security enforcement, and both are tested independently (§19.2).

### 14.5 Toast Rules

* **Success** → green toast, auto-dismiss 4 s.
* **Validation failure** → yellow/amber toast or inline field errors (field errors preferred), sticky until corrected.
* **Permission denied / consent-gate lock** → red toast with the `message_key` text, auto-dismiss 6 s.
* **Background job queued** (202 + job_id) → blue toast "queued", then `JobStatusIndicator` reflects progress; completion raises a success toast.
* Toasts never contain PII beyond first names, and never contain raw error internals.
* (Persistent critical notification banners belong to the post-MVP notification framework, §10.1 — not built in MVP.)

### 14.6 File Preview Behavior

| Type | Behavior |
|---|---|
| PDF | Inline browser preview (iframe/viewer) + download |
| Audio (webm/mp4/mpeg/wav) | Embedded native `<audio>` player + download |
| Images (jpeg/png/webp) | Thumbnail in lists; click → modal lightbox + download |
| Office files (docx/pptx/xlsx) | **Download only** — no in-browser rendering in MVP |

Previews of private content use the same presigned-URL mint path as downloads (TD-12) — no separate preview endpoint, no relaxed permissions for thumbnails.

### 14.7 Browser Support Matrix (Revision 9)

| Browser | Minimum | General app | Audio playback of TD-9 containers |
|---|---|---|---|
| Chrome / Edge (desktop & Android) | Last 2 major versions | Full | ✔ |
| iOS Safari / iOS WebView | iOS 16+ | Full | ✔ (webm/ogg support verified in E2E; if a container fails on iOS, download link is the fallback) |
| macOS Safari | Last 2 major versions | Full | ✔ |
| Firefox (desktop & Android) | Last 2 major versions | Full | ✔ |
| Anything older / other | — | Best-effort rendering, untested | Download link fallback; file upload always works |

Rules: playback of all TD-9 audio containers is verified cross-browser in E2E (§19.2), with a download-link fallback where a container won't play inline. (MediaRecorder feature-detection rules ship with the post-MVP recorder, §10.1.) Mobile-first responsive layout (§6) is tested at 360 px width minimum. No support for browsers without ES2020 — no legacy transpilation targets, no IE.

---

## 15. Seed Data Specification

Two seed tiers. **Production seed** runs on every fresh deployment (idempotent — safe to re-run). **Development fixtures** run only when `NODE_ENV != production` (this guard is also the Law 09-08 firewall — Risk R-10: non-production environments contain fixture data exclusively).

### 15.1 Production Seed (mandatory, idempotent)
* **Super Admin:** 1 `User` (status `active`) whose **`pre_provisioned_email` is set to the lowercased `SUPER_ADMIN_EMAIL`** env var (TD-13, §7 Revision 15), holding the `super_admin` role; its `UserIdentity` is **created on first Google login** (§4.1b step 4b). **No placeholder identity row is seeded** (§7), and no password exists anywhere. Idempotent: re-running matches the existing row on `pre_provisioned_email` rather than creating a second Super Admin.
* **Roles:** `super_admin`, `admin`, `teacher`, `student`, `parent`.
* **Categories** (single Arabic `name`, with `display_order`): 1 المرأة, 2 اليافعات, 3 الطفل.
* **Levels:** Women 0–7 (level 0 = literacy), Teens 1–6, Children 0–6 — each with `display_order` = level number within its Category; `gender_restriction` = `any` unless the association specifies otherwise at data entry.
* **Subjects:** تفسير (Tafsir), فقه (Fiqh), محو الأمية (Literacy) — *the Quran is deliberately not a Subject* (§4.4b); extendable by Admins.
* **AcademicYear:** `2026-2027`, `is_current = true`.
* **QuranSurah:** all 114 rows (`surah_id`, `name_arabic`, `name_transliterated`, `total_ayahs`) from a verified static dataset checked into the repo.
* **SystemSetting defaults:** Hijri offset 0; Category default visibility — Children `private`, Teens `private`, Women `public`; grading scale and passing grade — `grading.display_scale = 20` and `grading.passing_grade_bp = 5000` (10/20, Revision 14 §4.6). Per-level overrides, when an Admin sets one, are stored as `SystemSetting` entries keyed per level — never as a column on `Level` (§7).
* **Branches/Rooms/Groups/Roster:** **not** seeded with placeholders in production — entered **manually through the admin UI** by the owner/coordinator from real data (§2.3, Week 7; CSV import is post-MVP). Seeding fake branches into production is prohibited.

### 15.2 Development Fixtures (non-production only)
* 2 sample branches (each with `operational_start_date` in the past + 2 rooms), 3 sample groups per branch, sample teachers/parents/students (minors login-less), approved and pending family links, consent records in both states, sample exams (grading-template fixtures — one active at exactly 10,000 bp, one draft — join with the post-MVP engine, §10.1, Revision 13; its tables must not be pre-created, §7), sample content in all three visibility tiers including one consent-forced-private recording, and sample events covering every recurrence type including biweekly-alternating.
* Fixture emails use the reserved `example.com` domain; fixtures never run in production (guarded by env check). **Fixtures are the only data permitted in dev/staging environments (R-10).**

---

## 16. Project Structure, Coding Conventions & Agent Workspace Files

### 16.1 Repository Layout (monorepo)
```
/CLAUDE.md           Claude Code CLI agent instructions (§16.3, File 1)
/AGENTS.md           Codex / Cursor / Blackbox agent instructions (§16.3, File 2)
/backend
  /prisma            schema.prisma, /migrations (incl. hand-written SQL, TD-6a), /seed
  /src
    /controllers     HTTP layer only — no business logic
    /services        business logic, transaction boundaries (TD-4), state machines (TD-1)
    /repositories    all DB access; the single mandated data-access layer (uniform soft-delete filtering, consistent query construction)
    /policies        TD-2 permission checks (one policy module per resource), incl. child-context middleware (§4.3)
    /validators      Zod schemas mirroring TD-9 limits; applied at the API boundary
    /jobs            pg-boss job handlers (TD-7 catalog, one file per job)
    /middleware      auth, child-context (X-Active-Child-ID), request-id, error envelope (TD-3.8), rate-limit passthrough
    /lib             storage (MinIO), oauth, hijri, i18n, time (TD-11)
/frontend
  /src
    /components      shared registry (§14.3) + feature components
    /pages           one folder per sitemap node (§14.1)
    /layouts         public / authenticated / print (exam paper layout)
    /hooks           data fetching, pagination, upload
    /contexts        auth/session, active-child context (drives the X-Active-Child-ID header), i18n/RTL
    /services        typed API client generated from the OpenAPI contract (injects X-Active-Child-ID from context)
    /types           shared TS types (generated where possible)
    /i18n            ar (shipped in MVP); fr/en catalogs added post-MVP (§10.1); entity names are Arabic data
/nginx               reverse proxy config: same-origin path routing (client /, API /api/v1/, storage /storage/), SSL, rate limits, error-page mappings
/docker-compose.yml  api, db, minio, nginx (+ certbot)
/docs
  SRS.md                    THIS DOCUMENT — the immutable single source of truth
  IMPLEMENTATION_PLAN.md    milestone-by-milestone build order (mutable, derived from §8/§18; never overrides the SRS)
  TASKS.md                  granular implementation checklist, updated by agents as work progresses (mutable; never overrides the SRS)
  CHANGES.log               append-only task ledger (§16.3, File 3)
  openapi.json              exported API contract
```

### 16.2 Coding Conventions (binding)
* TypeScript strict mode everywhere; no `any` in service/repository layers.
* Naming: `camelCase` variables/functions, `PascalCase` components/classes/types, **`snake_case` database columns**, kebab-case file names and API paths.
* **UUID primary keys** for all application entities; the only exceptions are static lookups with natural keys (`QuranSurah.surah_id` 1–114).
* **No business logic in controllers** — controllers validate (Zod), call one service method, map the result to the response envelope.
* **Repository pattern mandatory:** services never touch Prisma directly; repositories are the sole data-access layer, applying soft-delete filtering and consistent query construction uniformly (no tenant injection — the platform is dedicated single-tenant, §3.2).
* **Service layer mandatory:** all TD-1 transitions and TD-4 transactions live in services; services write explicit transactional queries and never bypass repositories.
* **Validation through Zod** at every API boundary; Zod schemas are the single place TD-9 limits are encoded (constants shared with the frontend).
* **Raw SQL lives in migration files (TD-6a) plus exactly one sanctioned application-side exception:** reviewed `$queryRaw` fragments are permitted **inside repositories only**, for exactly two purposes — (a) `SELECT … FOR UPDATE` row locks (TD-15; Prisma has no lock API) and (b) inserting pg-boss job rows through the *transaction client* via a dedicated `JobsRepository` using pg-boss’s documented job-table format (TD-4 same-transaction enqueue; `boss.send()` uses its own connection and sits **outside** the transaction, so it must never be used for job-triggering mutations). Raw SQL anywhere else in application code remains prohibited.
* Errors are thrown as typed domain errors mapped centrally to TD-3.8 codes; no ad-hoc `res.status(...)` scattering.
* i18n keys for every user-facing string; no hardcoded UI text.
* Commits are atomic per sub-task; completed sub-tasks are pushed to the `develop` branch and logged in `docs/CHANGES.log` (§16.3).

### 16.3 Agent Workspace Files (token-efficient AI collaboration)

Three files keep coding agents effective without re-reading this entire SRS on every task, and two mutable companion documents (`docs/IMPLEMENTATION_PLAN.md`, `docs/TASKS.md`) carry the working build order and checklist. **Precedence rule: all of these are pointers and process aids — none of them ever overrides the SRS.** The SRS is immutable to agents: if an agent believes the SRS is wrong, it stops and reports to the Document Owner; it never edits `docs/SRS.md`. If an agent file or companion document and the SRS conflict, the SRS wins and the conflict is reported (§20 rule 20). Agents keep `TASKS.md` checkboxes and the `CHANGES.log` ledger current as work progresses; `IMPLEMENTATION_PLAN.md` changes only when the Document Owner re-sequences milestones.

**File 1 — `/CLAUDE.md` (Claude Code CLI instructions):**
```markdown
# Claude Code Instructions

## Project Context
You are working on the بذور الأمل Platform.
- Framework: React (frontend) & Express with Prisma (backend).
- Database: PostgreSQL.
- Storage: MinIO.
- Source of truth: `docs/SRS.md`. This file never overrides it.

## Execution Guardrails
- Always read `docs/CHANGES.log` and `docs/TASKS.md` to see the latest progress and
  the current checklist before starting a task.
- NEVER read `docs/SRS.md` fully unless explicitly asked. Refer only to the
  section(s) you are implementing (the SRS is cross-referenced by §/BR-x/TD-x
  identifiers for exactly this purpose).
- `docs/SRS.md` is IMMUTABLE to you. Never edit it. If you believe it is wrong,
  stop and report to the Document Owner.
- The binding AI guardrails are `docs/SRS.md` §20 — read §20 once per session.
- Build order comes from `docs/IMPLEMENTATION_PLAN.md`; tick off items in
  `docs/TASKS.md` as you complete them.
- Write explicit transactional queries in services; do not bypass repositories.
- Keep commits atomic. Push any completed sub-task to the `develop` branch.
- Document what you built in `docs/CHANGES.log` immediately after completing a task.
- If the SRS is silent or two sections conflict: stop and ask; report the conflict.
```

**File 2 — `/AGENTS.md` (Codex / Cursor / Blackbox instructions):**
```markdown
# AI Agent Instructions (Codex/Cursor/Blackbox)

- Read `docs/CHANGES.log` to understand what was completed in the prior session.
- Follow the guidelines in `/CLAUDE.md` (repository root). The source of truth is
  `docs/SRS.md`; neither this file nor CLAUDE.md overrides it.
- When writing database schema changes, remember PostgreSQL-specific CHECK
  constraints and ICU collations are hand-written in `backend/prisma/migrations/`
  SQL files (SRS TD-6a). Do not try to write them in `schema.prisma`.
  Never run `prisma db push`.
- When modifying backend routes, always use the unified error response format
  defined in `docs/SRS.md` under section TD-3.8.
- Log your output directly into the next empty row of `docs/CHANGES.log`.
```

**File 3 — `/docs/CHANGES.log` (append-only task ledger, initial state):**
```markdown
# Project Changes Ledger

## Active Status
- CURRENT TASK: Week 1 Setup
- COMPLETED TASKS: None (Initial state)
- NEXT TASK: Configure docker-compose and Prisma schema.

## Progress History
| Date | Task Ref | What Was Built | System Impacts | DB Migrations |
| :--- | :--- | :--- | :--- | :--- |
| 2026-07-22 | SETUP | Created repository layout | None | None |
```

Ledger rules: append-only (matching the AuditLog philosophy); every completed sub-task adds exactly one row; the Active Status block is the only mutable region and always reflects reality before a session ends.

---

## 17. End-to-End User Journeys (normative integration paths)

Each journey names the screens (§14.1), states (TD-1), and side effects (TD-4/TD-7/TD-8) an implementation must connect. The E2E test suite (§19.2) automates every journey below.

**J1 — New parent registration → family dashboard**
```
Visitor → /register → Google OAuth (§4.1b) → no match → unified form (email read-only)
→ submit (TD-4.1: parent + child + link + consents + identity, atomic) → Pending status screen
→ Admin: /admin/approvals → Approve bundle (TD-4.2; audit) → parent informed via existing channels
→ Parent logs in → /dashboard/parent → child visible → switch to child context
→ subsequent child-scoped requests carry X-Active-Child-ID; middleware verifies the approved link
```

**J2 — Add a second child to an existing parent**
```
Parent → /family/link-child → submit → FamilyLink(pending) → Admin approves → child appears
(no visibility at any point before approval — BR-4; X-Active-Child-ID for the new child
returns 404 until the link is Approved)
```

**J3 — Exam lifecycle end-to-end**
```
Teacher → /teacher/exams → author (question UUIDs) → Publish exam
→ Adult student (or parent-as-vehicle for minor, child context verified) → take exam
  (save_and_resume: PATCH loops; single_submission: one final submit)
→ submit → MCQ auto-grade → Grade(draft, or absent=0 for no-shows at publish time)
→ Teacher grades subjective → Publish (TD-4.5: audit)
→ students/parents see the published per-exam grade (no averages in MVP — template engine §10.1)
```

**J4 — Consent revocation ripple**
```
Parent (or staff-recorded) revokes media_release → ConsentRecord state change (TD-4.7)
→ consent.reevaluate job → group recordings forced private → bucket-migrate jobs
→ public visitor with stale link → /content-unavailable
→ Admin may override per resource with justification (TD-8 consent_gate.override)
```

**J5 — Teacher publishes a class recording**
```
Teacher records in phone voice-recorder app → /teacher/content → select file
→ upload initiate (branch scope validated; Global rejected for teachers §4.9)
→ single-shot presigned PUT with progress (retry restarts on failure — R-9)
→ complete (MIME magic-byte check) → EducationalContent created (hash-segmented key)
→ visibility per Category default, consent gate may force private → appears in /resources tree
```

**J6 — Weekly schedule + exception event**
```
Admin → /admin/groups → create Group (wall-clock time, conflict detection)
→ enroll students (capacity + consent job per roster change)
→ /admin/calendar → create holiday Event (visibility tier, explicit scope joins)
→ student calendar shows group slot + event (with Hijri overlay); hidden events invisible to students
```

**J7 — Suspension takes effect**
```
Admin suspends user (TD-1) → refresh revoked immediately → next access-token expiry ends session
→ login attempt → "Account deactivated" screen → audit auth.login_denied
```

**J8 — Quran log correction ripple (Revision 6)**
```
Teacher → /teacher/students/{id}/quran → notices a mis-logged range → edits (or soft-deletes) the log
→ same request synchronously recalculates the surah's merged coverage (§4.5, TD-4.11)
→ response returns the corrected percentage → student dashboard reflects it immediately
→ audit quranlog.update / quranlog.delete (TD-8)
→ if the correction drops coverage below 100%, level-completion status (BR-11) reflects that immediately
```

---

## 18. Module Acceptance Checklists

A module is "done" only when every box is checked, its §19.2 tests pass, and its journeys (§17) run green. Definition of done is per-module, not per-week.

**Authentication & Onboarding**
☑ Google OAuth with state+PKCE ☑ §4.1b routing all three branches (existing / pre-provisioned bind / new) ☑ **pre-provisioned account is found by `User.pre_provisioned_email` with no identity row present, binds transactionally on first login, and resolves via `UserIdentity` on every later login; no placeholder identity is ever written; a suspended pre-provisioned account gets "Account deactivated", not a binding** (Revision 15) ☑ onboarding token single-use enforced via `jti` + `ConsumedToken` — replay test returns 409 ☑ emails lowercased on all lookups/writes (case-variant identity test) ☑ Pending hard-redirect with zero data access ☑ client-side Pending route guard (no skeleton leak, §14.4) ☑ JWT carries roles/branch_scopes ☑ suspension revokes refresh ☑ same-origin cookie delivery verified through Nginx path routing ☑ signed PUT + signed GET round-trip through the /storage proxy passes (§3.1) ☑ registration endpoint ignores body-supplied email/OAuth IDs — identity comes solely from the token payload (substitution test) ☑ high-risk endpoints re-assert Active status against the DB (suspended-mid-session test) ☑ access token via Authorization header only; refresh endpoint requires custom header + Origin check ☑ audit rows (auth.login, login_denied, identity_bound, **refresh, logout, token_revoked**) ☑ **rejected/suspended/soft-deleted all reach the deactivated screen and none is reactivated by authenticating** (§4.1b 4a) ☑ tests pass.

**Token lifecycle acceptance criteria (Revision 16 — normative; each line is one test).** The refresh chain is the only part of the system where a single missing check silently extends a 30-day credential, so it is specified as pass/fail conditions rather than prose:

| # | Criterion | Expected |
|---|---|---|
| T1 | Refresh with the current live token | New access token **and** a new refresh token; predecessor revoked; both in one transaction (TD-4.13); `auth.refresh` written |
| T2 | Tokens are never stored raw | Only `token_hash` is persisted; a database dump yields no usable credential |
| T3 | Immediate predecessor presented **within** 10 s of its successor's `issued_at` | Accepted; a fresh access token returned; **no third token minted** — the chain does not fork |
| T4 | Immediate predecessor presented **after** the 10 s window | Refused as reuse (T5 applies) |
| T5 | Any token older than the immediate predecessor, or an already-revoked token | **Whole session revoked** (`reuse_detected`); request refused; `auth.token_revoked` **and** `auth.login_denied` written |
| T6 | Logout | Revokes **only** the current `session_id`; a session on another device keeps working (TD-4.14) |
| T7 | Revoke-all (internal) | Every live token of the user revoked; **no user-facing route or screen exists** for this (TD-12, §14.1) |
| T8 | User suspension | All live refresh tokens revoked **in the suspension transaction** (TD-4.15) — verified by refreshing immediately after suspension and being refused |
| T9 | User soft-delete | Same as T8 with `revoked_reason = user_deleted` (TD-5) |
| T10 | Token past `expires_at` | Refused, and collected by `token.purge` (TD-7); a purged token is refused identically — fail-closed |
| T11 | Revoked token, any age | Never accepted, never resurrected by any path |
| T12 | Concurrent refresh from two tabs | Exactly one rotation occurs; the loser is absorbed by the T3 grace window, not logged out |

**Registration, Approvals & Family**
☑ unified atomic transaction incl. ConsumedToken (kill the process mid-transaction in a test — nothing partial persists) ☑ consent records versioned, both types ☑ bundle approval atomic ☑ FamilyLink pending grants zero visibility ☑ **X-Active-Child-ID middleware: approved (parent+child) match passes; another parent's child, pending/rejected/nonexistent → 404; Parent-only with absent header → 400; Student-role self-access bypasses the header (verified against JWT sub) — all tested on every student-context endpoint** ☑ child context switcher drives the header ☑ tests pass.

**Scheduling & Calendar**
☑ group CRUD + conflict detection ☑ co-teaching via GroupTeacher ☑ wall-clock times survive a simulated Ramadan DST transition ☑ all five recurrence types incl. biweekly-alternating ☑ three visibility tiers filtered per role ☑ four-way scope joins populated at creation ☑ operational-start-date graying ☑ manual backfill action ☑ **Hijri overlay renders with admin offset applied (in-scope check)** ☑ tests pass.

**Quran Progress**
☑ interval-merge union correct on overlapping/duplicate/adjacent ranges ☑ percentage vs total_ayahs ☑ ayah bounds validated (constraint + service) ☑ **create/update/soft-delete each synchronously recalculates and returns fresh coverage** ☑ **a deletion dropping coverage below 100% immediately un-completes the level (BR-11)** ☑ read-only student view ☑ p95 write target met including recalculation ☑ tests pass.

**Exams & Grading**
☑ question UUIDs immutable, referenced by submissions ☑ all scores stored as integer bp (0–10,000) with round-half-up applied once — no float score columns (schema audit) ☑ single_submission vs save_and_resume enforced ☑ MCQ auto-grade → draft ☑ absent-zero rows initialized at first draft save ☑ pass/fail vs per-level threshold + manual override ☑ un-enrollment leaves grades/submissions intact (TD-5 test) ☑ no template/average UI or tables exist (postponement check, §10.1) ☑ tests pass.

**Content, Consent & Storage**
☑ three tiers + consent_forced_private ☑ empty-group upload takes Category default (gate disengaged, §4.9) ☑ teacher cannot lift consent lock (API test, not just UI) ☑ Global scope rejected for teachers ☑ dual-bucket migration on visibility change ☑ presigned mint permission-checked (incl. child context), 10-min TTL ☑ stale public link → /content-unavailable ☑ single-shot upload: progress, failure, clean retry; upload.gc reaps only >48 h ☑ magic-byte validation via ranged GET (bytes 0–511) — no full-file streaming (verified in implementation review) ☑ immutable hash-segment keys on re-upload ☑ audio recorder on Chrome/Android + iOS Safari ☑ tests pass.

**Data, Admin & Audit**
☑ TD-8 grid fully covered (test asserts a row per action, incl. quranlog.update/delete) ☑ social-profile field-level restriction (assigned-teacher-only, API test) ☑ Arabic search normalization hits variant spellings ☑ structural `name` columns natively collated (query plan shows no per-query COLLATE) ☑ Trash snapshots written on every soft delete; manual-restore runbook executed once against staging fixtures ☑ tests pass.

**Platform & Deployment**
☑ §19.1 pipeline from clean VPS to healthy /healthz ☑ §19.0 topology respected (fixtures-only outside Morocco — checked in fixtures guard) ☑ hand-written migration SQL present in history (CI check) ☑ `db push` absent from all scripts ☑ backup job + restore drill under RTO ☑ per-IP rate limits active at Nginx ☑ **per-user upload quota (30/hour) enforced in the application against PostgreSQL, proven by a test that exhausts it and receives `429 RATE_LIMITED` in the standard envelope** (Revision 14) ☑ same-origin path routing serves client, API, and storage under one domain ☑ no PII in logs (log audit) ☑ tests pass.

---

## 19. Environments, Deployment Pipeline & Testing Strategy

### 19.0 Environment Topology (normative — Revision 6)

| Tier | Frontend | Backend / DB / MinIO | Data | Residency note |
|---|---|---|---|---|
| **Development** | Local Vite dev server | **Developer's local machine, inside the containerized `docker-compose` environment** (same images as production) | §15.2 fixtures only | Non-Moroccan hardware permitted because no real data exists here (R-10) |
| **Staging** | **Vercel Free tier**, auto-deployed from the GitHub **`develop`** branch | Local containerized environment (developer machine or a disposable container host), reachable by the staging frontend for integration testing | §15.2 fixtures only | Vercel is outside Morocco — acceptable **only** because staging never contains real beneficiary data (hard rule, R-10) |
| **Production** | Served by Nginx from the **unified Moroccan-region VPS** (same origin as API, §3.1) | Same Moroccan VPS: full `docker-compose` stack | Real data | Law 09-08: all real data + backups on Moroccan infrastructure only (§6, BR-18) |

Hard rules: production dumps are never copied to dev/staging; the staging frontend build must not embed production URLs; the Week-8 dress rehearsal runs on the **production VPS itself** (§8) because the Vercel+local topology exercises none of the VPS realities (memory ceilings R-3, SSL R-8, backup pipeline).

**Staging authentication boundary (Revision 10):** the Vercel origin and the local backend are cross-origin, so the `SameSite=Lax` refresh cookie **will not flow between them — by design, and this is not a bug to fix.** Authenticated flows (login, sessions, cookie refresh, E2E journeys) are **never tested through the Vercel origin**; they run against the local same-origin compose stack — which serves the identical built frontend through Nginx exactly as production does — and against the Week-8 VPS rehearsal. The Vercel staging deployment exists for UI/visual review **against MSW (Mock Service Worker) fixture mocks only — it calls no real backend, and nothing is CORS-allow-listed anywhere, in any environment** (Revision 12; this also deletes the one CORS exception §3.1 previously carried). **Cookie attributes are identical in every environment; environment-conditional downgrades (`SameSite=None`, `Secure` removal, wildcard CORS with credentials) are prohibited** — an agent "fixing" staging cookies by weakening them is introducing a CSRF vulnerability, not fixing a bug.

### 19.1 Deterministic Deployment Pipeline (production VPS)

```
1. git clone <repo> && cd <repo>
2. cp .env.example .env        # fill TD-13 values; SUPER_ADMIN_EMAIL mandatory
3. docker pull <registry>/bodour-api:<tag> …             # images are BUILT IN CI and pulled — never built on the
                                                            # 4 GB VPS (Vite/Rollup build peaks ~2 GB and will OOM/thrash
                                                            # a box already running Postgres+MinIO+Node). Emergency-only
                                                            # fallback: stack fully down, then compose build.
4. docker compose up -d db minio
5. docker compose run --rm api npx prisma migrate deploy    # applies ALL migrations incl. hand-written SQL (TD-6a)
                                                            # on an EXISTING deployment: run a pg_dump immediately
                                                            # before this step — the rollback point (TD-6b)
6. docker compose run --rm api npm run seed:production      # idempotent §15.1
7. docker compose up -d                                     # api, nginx, certbot
8. curl https://<domain>/healthz                            # must return 200 with all components green
9. Super Admin performs first Google login (identity binds, §4.1b 4b)
10. Smoke test: J1 journey; backup job dry-run + restore drill before go-live
```
Rollback: `docker compose down` + restore latest `pg_dump` via the documented restore procedure (§6); migrations are forward-only in production. Staging frontend deploys are automatic: push to `develop` → Vercel build (fixture-pointing configuration only).

### 19.2 Testing Strategy

| Layer | Scope | Tooling | Gate |
|---|---|---|---|
| Unit | Services: interval-merge (incl. mutation-triggered recalc), weight-sum validation, state machines (TD-1), consent evaluation, time/DST logic, Arabic normalization | Vitest/Jest | per-PR |
| Integration | Repositories against real PostgreSQL (testcontainer): TD-6 constraints actually reject bad writes; partial unique indexes; native collation ordering; soft-delete filtering | Vitest + testcontainers | per-PR |
| API | Every TD-3 endpoint against the OpenAPI contract; **permission-matrix tests generated from TD-2** (every action × every role, expecting ✔/403/404); **child-context header tests** (approved/pending/absent/foreign link); error envelope conformance | Supertest | per-PR |
| E2E | Every §17 journey (J1–J8), RTL rendering, §14.4 states (incl. empty states), upload retry | Playwright | pre-merge to main |
| Coverage | **≥ 80% on /services and /policies**; no coverage gate on generated/boilerplate code | c8 | CI |
| CI checks | migration history contains the TD-6a hand-written SQL; `prisma db push` appears nowhere; no `.env` committed; OpenAPI doc up to date; fixtures guarded by env check | custom scripts | CI |

Mandatory named regression tests (the traps this document exists to prevent): Ramadan DST wall-clock stability · consent revocation ripple through to bucket migration · teacher Global-scope rejection · re-upload cache-key immutability · Pending-session data-access denial across all endpoints (server) + Pending route-guard redirect (client) · **X-Active-Child-ID verification on every student-context endpoint incl. the Student-role bypass and the foreign-parent 404** · **Quran log deletion synchronously un-completing a level** · **onboarding-token replay → 409** · **presigned PUT/GET signature round-trip through the Nginx /storage proxy** · **case-variant Google email resolves to one identity** · **stale-version edit → 409 VERSION_CONFLICT (two-admin Group edit)** · **concurrent roster adds at capacity − 1 admit exactly one (FOR UPDATE)** · **double-approval of one registration: first wins, second 409** · **MinIO-down: content 503s while scheduling/grading endpoints stay fully functional** · **worker-down: enqueues succeed and jobs drain on restart** · **body-email substitution against a valid onboarding token is ignored (registration binds the token identity)** · **suspended Teacher denied presigned mint within the unexpired-token window** · **StudentSurahProgress self-heal repairs a deliberately stale cache row** · **first draft save initializes absent-zero rows for the full roster** · **concurrent teacher-score vs admin-override on one Grade → second writer gets VERSION_CONFLICT** · **per-user upload quota: the 31st initiation within one hour is refused with `429 RATE_LIMITED` in the TD-3.8 envelope, and two concurrent initiations at the limit boundary admit exactly one (TD-4.12 row lock)** (Revision 14) · **replayed rotated refresh token outside the grace window revokes the entire session and is refused (§18 T5)** · **suspension revokes live refresh tokens inside its own transaction, so the next refresh is refused immediately (§18 T8)** · **concurrent two-tab refresh rotates exactly once and logs nobody out (§18 T12)** (Revision 16).

---

## 20. AI Implementation Rules (binding guardrails for any autonomous developer agent)

Any AI or human implementer working from this document operates under these non-negotiable rules. They exist because each one blocks a plausible-looking shortcut that would cause data corruption, a safeguarding failure, or a security vulnerability.

**Never do the following:**
1. **Never replace pg-boss with in-memory queues**, `setImmediate`, unawaited promises, or ad-hoc timers for anything in the TD-7 catalog. Job state must survive container restarts. (Conversely: never move the Quran coverage recalculation *into* a job — it is synchronous by rule, §4.5.)
2. **Never store parental media consent as a boolean on the student/user table.** Consent exists only as versioned `ConsentRecord` rows (§4.1a); effective status is always derived.
3. **Never compute grade or score arithmetic with floats.** Weights AND exam scores are integer basis points (0–10,000); sums are validated transactionally against the DB constraints (TD-6); divisions round half-up exactly once at final persistence; display conversion happens once at render (§4.6).
4. **Never expose private-bucket resources via static URLs**, public bucket policies, or long-lived presigned links. Private reads flow exclusively through the permission-checked mint endpoint (TD-3.5, TD-12).
5. **Never declare `ar-x-icu` collations, CHECK constraints, partial/functional unique indexes, or triggers in `schema.prisma`** — Prisma cannot express them; they will fail or be silently dropped. Implement them exclusively via hand-written SQL in `prisma migrate dev --create-only` migrations (TD-6a), and **never run `prisma db push` in any environment.**
6. **Never trust child context from the client without verification.** When the `X-Active-Child-ID` header is present, the middleware must match **both** the authenticated parent and the child in an `Approved` `FamilyLink` (§4.3) — matching the child alone is a vulnerability. When the caller holds the `Student` role and acts on their own data, bypass the header and verify ownership against the JWT `sub` — never demand a child header from an adult student, and never let the bypass apply to a Parent-only caller. Never cache the check in the JWT, never accept a student ID from the body/query for authorization, and never let a client-side context switch substitute for the server-side check.
7. Never allow Teachers to lift a consent-forced private state (BR-3), never allow Teachers to assign the Global/no-branch scope (BR-20), and never widen the TD-2 matrix without an explicit SRS revision.
8. Never bypass the repository layer with ad-hoc Prisma or raw queries in services or controllers (§16.2). Raw SQL is confined to migration files plus the two sanctioned repository-level uses (`FOR UPDATE` locks; same-transaction pg-boss job inserts via `JobsRepository` — never `boss.send()` for job-triggering mutations, §16.2). Never reintroduce tenant columns, claims, or scoping — the platform is dedicated single-tenant by explicit decision (§3.2, Revision 11).
9. Never show a registration form before the Google OAuth flow has completed (§4.1b) — the verified email and `provider_subject_id` must exist before any account data is collected, and the email field is read-only on the form. Never read identity fields from a request body when a verified token carries them — the onboarding token's payload is the sole source of the registered email and OAuth subject (TD-12), and the endpoint schema must not even accept those fields.
10. Never implement an auth provider other than Google in MVP, and never add password columns "for later" (§2.2).
11. Never hard-delete outside the sanctioned paths (quarantine-purge job; post-MVP Trash UI); every destructive path writes Trash + AuditLog in the same transaction (TD-4.8). Never drop the soft-delete columns or Trash snapshots because the restoration UI is deferred.
12. Never perform state transitions not listed in TD-1; reject with `STATE_CONFLICT`. Never implement silent last-write-wins on `version`-carrying entities (TD-15 — stale versions get `409 VERSION_CONFLICT`), never check-then-write an invariant without `SELECT … FOR UPDATE` on the governing rows, and never surface a concurrency conflict as a 500 or escalate isolation to SERIALIZABLE to paper over a missing lock.
13. Never sort Arabic names with per-query workarounds or non-Arabic collations — the `name` columns are natively collated `ar-x-icu` (BR-19, TD-6, TD-10); never add `name_ar`/`name_fr` splits to structural entities.
14. Never store Group/Event schedule times as UTC instants (TD-11) — Morocco's Ramadan DST suspension will corrupt every weekly schedule. Never descope the Hijri overlay (§4.4 — in-scope by explicit decision).
15. Never reuse or overwrite a storage key (TD-9) — keys are immutable; replacements mint a new hash-segmented key. Never encode visibility into the key. Never split the client and API across different origins/subdomains — same-origin Nginx path routing is mandatory for cookie delivery (§3.1, TD-12).
16. Never add an endpoint absent from the OpenAPI contract, never invent navigation outside the §14.1 sitemap, never build MVP UI, schema, or logic for postponed features (weight-template engine, in-app recorder, FR/EN catalogs, Committees, audit page, print layout, notifications, CSV import/export, Trash restore, multipart resume — §10.1), and never return errors outside the TD-3.8 envelope (no stack traces, SQL, or internal paths in any response).
17. Never distinguish "not found" from "outside your scope" in API responses (both are `404 NOT_FOUND` — no existence leaks; this includes unapproved family links, §4.3).
18. Never log PII or request bodies on registration/consent endpoints (TD-14), never commit secrets or `.env` files, never seed placeholder branches/users into production (§15.1), and never move real beneficiary data into dev/staging environments or outside Moroccan infrastructure (§19.0, BR-18, R-10).
19. Never duplicate a §14.3 shared component per page, and never ship a page missing the §14.4 states.
20. Never resolve an ambiguity or SRS conflict silently, and **never edit `docs/SRS.md`** — it is immutable to implementing agents; only the Document Owner revises it. If two sections disagree, §12 Business Rules win **and the conflict must be reported to the Document Owner**; if the SRS is silent on a needed decision, stop and ask — do not invent. `CLAUDE.md`, `AGENTS.md`, `docs/IMPLEMENTATION_PLAN.md`, and `docs/TASKS.md` are process aids and derived working artifacts — they never override this document.

**Always do the following:** enforce permissions server-side per TD-2 on every endpoint, including the per-request child-context verification; use the TD-4 transaction boundaries verbatim (including same-transaction pg-boss enqueue and the synchronous Quran recalculation); validate all TD-9 limits server-side through the shared Zod schemas (§16.2); follow the §16 structure and conventions; read `docs/CHANGES.log` before starting and append to it after finishing every task (§16.3); implement the §17 journeys end-to-end and prove them with the §19.2 test gates; check off §18 before declaring any module complete; keep the OpenAPI doc, the TD-3 registry, and the implementation in lockstep; and treat this document — Business Rules foremost — as the sole source of truth.
