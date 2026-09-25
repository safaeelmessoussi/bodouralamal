[Documentation](../README.md) › [Reference](README.md) › **Decision log**

# Decision log

Index of foundational Document Owner decisions and what each rejected. Full text: SRS §0 and the [SRS revision ledger](../archive/SRS-revisions-R1-R173.md) (each R<n> links there). ★ = read first.

| R | Date | Decision | Rejected / note |
|---|---|---|---|
| [119](../archive/SRS-revisions-R1-R173.md) | 2026-09-02 | Consent wording becomes `LegalConsentText`: versioned, immutable, one active version; calendar filters by scheduling-type catalogue | Service-check uniqueness (a race; partial unique index instead); fabricating legacy consent rows; backfilling legacy scheduling types (§4.4b); `legal.consent_text_version` retired from the allow-list, row left; form submits the id, mismatch refused |
| [108](../archive/SRS-revisions-R1-R173.md) | 2026-08-26 | Production Subject baseline: eight extensible atomic Subjects; only حفظ carries `tracks_quran_progress` | أحكام القرآن, حفظ القرآن, ترتيل وتجويد القرآن, تفسير القرآن, فقه, السيرة النبوية, العقيدة, الأذكار; محو الأمية not seeded fresh; additive seed rerun preserves additions; authority marker-based, never name-based |
| [107](../archive/SRS-revisions-R1-R173.md) | 2026-08-26 | القرآن الكريم is the Quran domain, never a Subject row; R73 marker belongs only to حفظ القرآن | تجويد as a second seed row; at-most-one partial unique index, absence fail-closed; `LevelSurah` is the حفظ syllabus, تفسير follows it without authority; bootstrap never renames/deletes, ambiguity fails loudly |
| [101](../archive/SRS-revisions-R1-R173.md) | 2026-08-21 | Logout consumes the refresh cookie to revoke its current session; cookie Path `/api/v1/auth`; exactly two consumers | Clearing as revocation (other devices stay live; chain revoked and audited); mixed legacy rollout (forward-only migration invalidates pre-cutover rows as `cookie_path_migration`) |
| [43](../archive/SRS-revisions-R1-R173.md) | 2026-08-04 | Organisation split from delivery: Category → Level → AdministrativeGroup → Enrollment; TeachingGroup; RecurringCourseSchedule → Session | `StudentLevel` withdrawn (composite FK instead); branch stays on AdministrativeGroup; teaching mode on the schedule, exactly one target; eager materialization (exact conflicts); scope via `CourseScheduleStaff`; Quran a Subject for scheduling only, no grading components; BR-23 capacity unenforced; attendance/announcements specified, not built (§20 rule 16) |
| [42](../archive/SRS-revisions-R1-R173.md) | 2026-08-02 | Platform Settings: `GET /admin/settings`, `PUT /admin/settings/{key}`, Super Admin, explicit allow-list, audited OLD/NEW, TD-15 | Superseded in subject by R119; never empty; a dev fixture is not a production mechanism; affects future registrations only (no restamping, §4.1a) |
| [41](../archive/SRS-revisions-R1-R173.md) | 2026-08-02 | French name split like Arabic; `name_french` server-composed, never by a client; optional as a pair | Half a name (both parts or neither, boundary + CHECK); no backfill |
| [40](../archive/SRS-revisions-R1-R173.md) | 2026-08-02 | Arabic name = الاسم الشخصي + الاسم العائلي; `name_arabic` retained, server-composed; nullable, no backfill | Replacing `name_arabic` (TD-10, BR-19, §7, §14.2, seeds); client composition (§1.1, `.strict()` rejects it); whitespace-split backfill (a guess); expand half of TD-6b |
| [39](../archive/SRS-revisions-R1-R173.md) | 2026-08-01 | Registration captures the chosen Branch as `intended_branch_id` (a request, not placement); supersedes R29 in part | No Level, Room or Group; nullable, no backfill (null = not stated); the queue's Branch control is a filter, never a scope (R25/R29 visibility retained) |
| [38](../archive/SRS-revisions-R1-R173.md) | 2026-08-01 | API contract is an interface (§16.2): allow-list DTOs, `snake_case`, TD-11 dates `YYYY-MM-DD`, no ORM entity | Compensating in the frontend adapter; generalises R35; enforced by `check-contract-dto.sh` and exact-key HTTP assertions |
| [37.2](../archive/SRS-revisions-R1-R173.md) | 2026-07-30 | Six-section completion report joins §16.3 for both agent files | Structure normative, prose not |
| [37.1](../archive/SRS-revisions-R1-R173.md) | 2026-07-29 | Reading relevant documentation before implementation joins §16.3 | Process stays in the handbook (§16.4) |
| ★ [37](../archive/SRS-revisions-R1-R173.md) | 2026-07-29 | Documentation maintenance binding (§16.4), same commit; SRS normative, handbook explanatory; §16.3 verbatim agent-file copies removed | `CHANGES.log` template retained |
| ★ [36.2](../archive/SRS-revisions-R1-R173.md) | 2026-07-29 | Public display identity is a platform-wide invariant, stated once in the data model; guardrail rule 21 | — |
| [36.1](../archive/SRS-revisions-R1-R173.md) | 2026-07-29 | `public_display_name` on the person, resolved in the backend only; no frontend fallback | Placement on a teacher profile |
| [36](../archive/SRS-revisions-R1-R173.md) | 2026-07-29 | One calendar bootstrap document: reference data only, never operational; self-sufficient occurrences | Four independent endpoints (round trips, four cache policies, public N+1) |
| [35](../archive/SRS-revisions-R1-R173.md) | 2026-07-29 | Public branch directory: five contact fields on a dedicated public route; opening hours free text | Admin route with permissions relaxed; parsed hours (Ramadan); coordinates (two representations drift) |
| ★ [34](../archive/SRS-revisions-R1-R173.md) | 2026-07-29 | Invalid credentials on a public endpoint are anonymous; never `401` | Login-walling a returning visitor |
| [33](../archive/SRS-revisions-R1-R173.md) | 2026-07-29 | Pre-frontend consistency sweep: four contradictions removed; a twice-stated requirement drifts, the fix is a cross-reference | — |
| [32](../archive/SRS-revisions-R1-R173.md) | 2026-07-29 | Hijri: the Super Admin records the Ministry's announcement; the importer leaves the MVP | Abstract importer interface (could only answer *not configured*); extensibility by data, not scaffolding |
| ★ [31](../archive/SRS-revisions-R1-R173.md) | 2026-07-28 | Official Hijri calendar is the source of truth; the platform computes nothing; unrecorded month renders nothing | ±2-day uniform offset (divergence varies month to month) |
| [30](../archive/SRS-revisions-R1-R173.md) | 2026-07-28 | Teachers do not browse reference data (the code was right, the specification wrong) | — |
| [29](../archive/SRS-revisions-R1-R173.md) | 2026-07-28 | Registration metadata is not reference data; registration never places a beneficiary | Superseded in part by R39 (Branch choice) |
| [28](../archive/SRS-revisions-R1-R173.md) | 2026-07-28 | Case-file write permission defined; reads and writes both audited | Wording implying related-guardian access |
| [27](../archive/SRS-revisions-R1-R173.md) | 2026-07-28 | Generic educational stages; `User.sex` added; real sex restrictions seeded | A restriction living only in Arabic category names |
| [26](../archive/SRS-revisions-R1-R173.md) | 2026-07-28 | Reference data vs operational data: only a Super Admin writes reference data | Scope-checked branch creation (creator could not see the branch) |
| [25](../archive/SRS-revisions-R1-R173.md) | 2026-07-28 | Category and Level scopes reserved, not prohibited; user-list visibility defined explicitly | Supersedes R24's "prohibited" wording |
| ★ [24](../archive/SRS-revisions-R1-R173.md) | 2026-07-26 | Branch-scoped authorization confirmed: `NULL` scope = all branches for that assignment; scope resolved per role | Polymorphic scope framework (no foreign key); flat-union scope across roles |
| [23](../archive/SRS-revisions-R1-R173.md) | 2026-07-26 | `SUPER_ADMIN_EMAIL` optional once an administrator exists; linking an existing child is staff-mediated | Parent search over children (enumeration) |
| [22](../archive/SRS-revisions-R1-R173.md) | 2026-07-26 | `SUPER_ADMIN_EMAIL` is a bootstrap value; lockout recovery is the intended path | An email-change gate creating a second Super Admin |
| ★ [21](../archive/SRS-revisions-R1-R173.md) | 2026-07-25 | TD-3 is the normative registry for documented milestones; documented-but-unimplemented endpoints report `PENDING` | Reading §3.1 as forbidding every CRUD screen TD-3 does not list |
| [20](../archive/SRS-revisions-R1-R173.md) | 2026-07-25 | Deleted-account login routing: one rule instead of two half-rules | A deleted account falling through to the registration form |
| [19](../archive/SRS-revisions-R1-R173.md) | 2026-07-25 | Audit purge selects on an enumerated allowlist AND age | A glob (`auth.*`) is not an allowlist |
| [18](../archive/SRS-revisions-R1-R173.md) | 2026-07-25 | Sizing follows the audit model (~800–900k authentication rows a year) | Weakening the audit trail to fit the estimate |
| [17](../archive/SRS-revisions-R1-R173.md) | 2026-07-25 | Audit attribution invariant stated; verified rather than asserted | Claim true in principle, not guaranteed in three respects |
| [16](../archive/SRS-revisions-R1-R173.md) | 2026-07-25 | Authentication state-machine audit: token entity, twelve acceptance criteria, idempotent grace window | A forked chain (makes reuse detection impossible); 17 of 21 paths verified, the rest not guessed |
| [15](../archive/SRS-revisions-R1-R173.md) | 2026-07-24 | Pre-provisioned account lookup; placeholder identity rows prohibited | — |
| [14](../archive/SRS-revisions-R1-R173.md) | 2026-07-24 | Grading scale /20; two-layer rate limiting; two-phase version lifecycle | Nginx alone (cannot read a token subject or an hourly rate); blanket freeze (could not absorb a CVE fix); replaces R10's policy |
| [13](../archive/SRS-revisions-R1-R173.md) | 2026-07-24 | Consistency sweep; registry no longer lists routes the guardrails forbade building | — |
| [12](../archive/SRS-revisions-R1-R173.md) | — | Deadline scope trim: weight engine, in-app recorder, translations, committees, audit page, print layout; narrow raw-SQL exception; images built in CI | Building images on the VPS |
| ★ [11](../archive/SRS-revisions-R1-R173.md) | — | Multi-tenancy removed entirely; reintroduction prohibited | A second institute means a separate deployment |
| [10](../archive/SRS-revisions-R1-R173.md) | — | Security hardening: access token in the header only; fresh database assertion on high-risk endpoints | — |
| [9](../archive/SRS-revisions-R1-R173.md) | — | Concurrency policy, migration compatibility, degraded operation, search semantics, scale envelope, browser matrix | — |
| [8](../archive/SRS-revisions-R1-R173.md) | — | Architectural audit: ranged-GET magic bytes, storage-proxy signature rules, onboarding replay protection, integer basis points | — |
| [7](../archive/SRS-revisions-R1-R173.md) | — | Configuration inventory, version policy, two mutable companion documents | — |
| [6](../archive/SRS-revisions-R1-R173.md) | — | Scope trim: notifications, CSV, multipart, Trash UI out; soft-delete columns, snapshots, immutable keys retained; Hijri overlay in scope | — |

- Recurring method: duplication drifts and is found by audit, never by a failing test (R33, R36.2, R37); verify rather than assert (R17, R30); reject the reflex and record why (R24, R32, R35, R36); name what is deliberately absent; supersede, never rewrite (R25 → R24, R14 → R10, R21 → R10).

**Related:** [Scope and roadmap](../overview/scope-and-roadmap.md), [Architecture](../architecture/README.md), [`SRS.md`](../SRS.md) §0
