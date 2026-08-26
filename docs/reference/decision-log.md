[Documentation](../README.md) › [Reference](README.md) › **Decision log**

# Decision log

The authoritative SRS is currently through **Revision 101**. This page is a navigation index
for the foundational decisions and the latest security decision, not a second copy of every
revision's normative text. Each entry records a decision, **and what was rejected** — which is
usually the more valuable half.

*(A hard count used to sit here. It was replaced with the current head, because a number that
must be incremented by hand is a number that drifts — the hazard this log itself documents
five times over.)*

> Authoritative text: SRS §0, where each revision is stated in full with its reasoning. This
> page is an index and a summary.

**How to use this:** when something in the codebase looks strange, the explanation is
probably here. Most non-obvious choices were argued once, in writing, by someone with context
you may not have.

---

## Latest owner decision

| # | Date | Decision |
|---|---|---|
| **101** | 2026-08-21 | **Logout uses the browser-managed refresh cookie to revoke its current server-side session.** Revision 10's one-cookie-route rule and Revision 16's current-session logout rule could not both hold when the cookie Path admitted refresh but excluded logout. Exactly two routes may now consume the cookie: refresh and logout, both behind the same custom-header, Origin and SameSite protections. The Path is the narrowest shared prefix, `/api/v1/auth`; no credential reaches JavaScript and no session id is added to the access token. **Clearing was rejected as revocation:** logout resolves the persisted rotation chain, revokes that chain only, audits it, then expires the cookie, while another device remains live. **A mixed legacy rollout was also rejected:** the old issuer stops first and a forward-only migration atomically audits and invalidates every pre-cutover live refresh row as `cookie_path_migration`; users authenticate again. |

## The most consequential

If you read only six, read these.

| | Decision | Why it matters |
|---|---|---|
| **11** | **Multi-tenancy removed entirely** | Explains the absence of any tenant dimension, and why reintroducing one is prohibited |
| **24** | **Branch-scoped authorization confirmed and made precise** | Two real bugs: `NULL` scope meaning "all branches", and scope resolving **per role** rather than as a flat union |
| **31** | **The official Moroccan Hijri calendar is the source of truth** | Removed the algorithm and the adjustable offset. The platform **computes nothing** |
| **21** | **What the route registry *is*** | Resolved a contradiction that had blocked every CRUD screen |
| **34** | **Invalid credentials on a public endpoint are anonymous** | A public endpoint must **never** return `401` |
| **36.2** | **Public display identity is a platform-wide invariant** | The backend decides which name is published; clients render it verbatim |
| **37** | **Documentation maintenance is binding** | A feature is not done until its documentation is; and the SRS stopped carrying verbatim copies of files that had already drifted from it |

---

## All revisions

### Recent — documentation, public surfaces, and the calendar

| # | Date | Decision |
|---|---|---|
| **108** | 2026-08-26 | **The initial Production Subject baseline is eight extensible atomic Subjects.** R107's domain model stands, but the single recitation/correct-pronunciation row is canonically ترتيل وتجويد القرآن. The baseline is أحكام القرآن, حفظ القرآن, ترتيل وتجويد القرآن, تفسير القرآن, فقه, السيرة النبوية, العقيدة, الأذكار; محو الأمية is not seeded fresh. This is not a closed Quran department or platform curriculum: Super Admins may add further Subjects, including Quran-domain Subjects, and rerunning the additive seed preserves them and historical rows without marking, renaming or deleting them. Only حفظ carries `tracks_quran_progress`; runtime authority remains marker-based and never name-based. |
| **107** | 2026-08-26 | **القرآن الكريم is the Quran curriculum/domain, never a Subject row.** R43 solved the real scheduling gap but named the aggregation rather than the atomic things delivered. The schedulable Subjects are أحكام القرآن, حفظ القرآن, ترتيل القرآن, and تفسير القرآن; تجويد is the same curriculum Subject as ترتيل rather than a second seed row. R73's marker survives with one precise meaning and belongs only to حفظ القرآن: staffing that Subject authorises §4.5 memorisation for the resolved audience. The database keeps its at-most-one partial unique index and absence remains fail-closed; the Production seed establishes exactly one. `LevelSurah` records the حفظ syllabus and تفسير follows the same per-Level Surahs, without acquiring memorisation authority or coverage. Existing runtime-edited reference data is not renamed, deleted, or reclassified by bootstrap; ambiguity makes the seed fail loudly. |
| **43** | 2026-08-04 | **The educational model separates organisation from delivery.** A `Group` had been four facts in one row — a roster, a weekly timetable slot, a room booking, and a teacher assignment — which is why a student could sit in only one slot per level, why a level could not teach two subjects at different times to differently-split students, and why R39 needed a whole revision to explain that `intended_branch_id` is a request rather than a placement. The association's real model (one level, several subjects, each split differently; Tafsir taught whole while Quran runs in three parallel groups) **could not be expressed at all**. Now: **Category → Level → AdministrativeGroup → Enrollment**, with **TeachingGroup** as an optional per-subject split and **RecurringCourseSchedule → Session** as delivery. **Key calls and why.** *Branch stays on the AdministrativeGroup* — delivery moves away from it, place does not, and without it "which branch is this person at" becomes many-valued and R39's distinction collapses. *No separate `StudentLevel`* (the proposal drafted under this number is **withdrawn**): level membership is `Enrollment → AdministrativeGroup → Level`, and a second table would drift; the two-hop "exactly one group per level" rule is instead enforced by a **composite foreign key** that makes a denormalized `level_id` provably honest, which is what permits a real `UNIQUE (student_id, level_id)`. *Teaching mode lives on the schedule and nowhere else* — the same level teaches one subject whole and another split, so it cannot be a property of subject or level; a schedule targets **exactly one** entity, since plural targeting buys nothing a second row does not while forcing three separate queries to take sets. *Sessions are materialized eagerly* because conflict detection against real rows is **exact**, where comparing recurrence rules cannot see a weekly/biweekly collision on alternate weeks; each session carries its own date, time, room and teacher, which makes a cancellation or room change an **edit to a session** rather than a parallel Event mechanism, and `Event` narrows to non-teaching activity. *Teacher scope moves from `GroupTeacher` to `CourseScheduleStaff`* — the single most load-bearing authorization derivation in the platform — which also generalises the two-slot co-teaching rule and gives assistants a home without inventing a Role. *The Quran becomes a Subject **for scheduling only***: §4.4b's exclusion was about tracking and stays true of tracking, but a timetable must be able to say "this session is Quran"; a Quran `LevelSubject` generates **no** grading components, or one body of work would have two competing sets. *Room capacity stops being enforced* (BR-23), which deletes a CHECK, an error code, and the only roster-side row-lock. *Attendance and session announcements are **specified and deliberately not built*** — the Session entity is being designed now and a model that cannot carry them would have to be rebuilt; §20 rule 16 gains an explicit line that a specification written ahead of its build is not permission to build it |
| **42** | 2026-08-02 | **Platform Settings becomes a real, audited surface.** `legal.consent_text_version` is required before any registration is accepted (§4.1a), §15.1 deliberately does not seed it (§2.3 owner compliance task), and the screen meant to carry it had **no API in TD-3** — so the value could be set by nothing in the product and a first deployment would refuse every applicant with no in-product remedy. A development fixture is **not** a production mechanism. `GET /admin/settings` + `PUT /admin/settings/{key}`, **Super Admin only**, over an **explicit writable allow-list** (a `SystemSetting` also holds grading scales and category visibilities — different audiences, different consequences), validated per key and **never empty** (a blank version would *look* configured while reproducing the exact failure it prevents), **audited with OLD and NEW value** (a row carrying only the new value cannot answer *"what text was in force when this person consented"*), and TD-15 locked. **Changing it affects future registrations only** — stored `ConsentRecord`s keep the version captured at agreement, because §4.1a's requirement that each record carry the exact text agreed to is what forbids restamping |
| **41** | 2026-08-02 | **The French name is split like the Arabic one.** Revision 40 split Arabic and explicitly left French as one field; this is the separate revision it called for. One reason: a person has one name, and recording half of it as two fields and half as one is an inconsistency every screen and export would have to reason about. The design **mirrors R40 exactly** so there is one rule rather than two — parts collected, `name_french` retained and server-composed, never composed by a client, nullable with no backfill. **Unlike Arabic it stays entirely optional — but as a pair:** both parts or neither, enforced at the boundary *and* by a database CHECK, because half a name is not a name and would store a value nothing can render |
| **40** | 2026-08-02 | **The Arabic name is captured as الاسم الشخصي + الاسم العائلي.** The form asked for one opaque *"full name"*, which cannot be sorted, searched or addressed by either half without guessing where one ends — and Moroccan administrative practice records the two separately. **`name_arabic` is retained and becomes SERVER-COMPOSED** from the parts rather than replaced: replacing it would touch TD-10 search, the `ar-x-icu` ordering BR-19 requires, the §7 display-identity fallback, the §14.2 approval contract, both seeds and every screen showing a person — for no gain, since the composed name is exactly what those consumers want. **A client never composes it** (§1.1): two clients would disagree about order and separator, and the wrong answer is a person's name rendered backwards, which nobody reviewing a list would catch. `.strict()` therefore *rejects* a client-supplied `name_arabic` rather than ignoring it. **Nullable with no backfill:** splitting an existing full name on whitespace would be a guess — compound personal names and multi-word family names are routine — and afterwards nothing could distinguish a guessed part from a typed one. This is the expand half of expand–migrate–contract (TD-6b); a later contract phase may drop `name_arabic`. The French name is **unchanged** and stays a single optional field; splitting it would be a separate revision |
| **39** | 2026-08-01 | **Registration captures the applicant's chosen Branch** (supersedes R29 in part). The §14.2 Approvals *Branch* filter had no data behind it; an end-to-end trace showed the value was not collected-and-lost but **never collected**, with the payload schema rejecting `branch_id` outright. Two readings were possible — §14.2 was wrong, or R25/R29 were — and **the Document Owner confirmed the latter**: §14.2 recorded the association's real intake, and R29 had written down a workflow it does not use. **The implementation was faithful to the document throughout; the document was wrong.** The applicant now chooses **exactly one** organisational value: Branch. **No Level, Room or Group** — that prohibition is retained verbatim and narrowed by exactly one field. **The column is `intended_branch_id`, not `branch_id`, and the name is the design:** it records **what was asked for**, while **where the person ends up** remains their Group (`StudentGroup → Group.branch_id`), because an administrator may place an approved applicant elsewhere when the requested branch is full. One name for two facts is how a second source of truth starts (§16.4). Nullable with **no backfill possible** — nobody knows what earlier applicants would have chosen, so null means *not stated*, never *no branch*. The queue's Branch control is a **filter, never a scope**: visibility stays unscoped (R25, R29 retained) so a branch Admin can still find and correct an applicant whose chosen branch is wrong |
| **38** | 2026-08-01 | **The API contract is an interface, not a serialisation (new §16.2 rule).** `GET /admin/branches` had returned raw Prisma rows since M1.12 — `camelCase` names inside a `snake_case` envelope, an *instant* where TD-11 defines a **calendar date**, and four internal columns no screen consumes — and the frontend adapter had been absorbing all of it. The Document Owner rejected the repair rather than the symptom: *"Do not keep an inconsistent API and compensate in the frontend adapter. The backend contract is the source of truth."* **The rule:** no endpoint may expose an ORM entity directly; every endpoint returns an explicit contract DTO built by an **allow-list projection**; `snake_case`; a TD-11 date serialises `YYYY-MM-DD`. **The load-bearing consequence is the third one** — a column added to a model never reaches a response by default, so growth in the schema is not silent growth in the contract. **Why it needed a revision and not a fix:** nothing was *wrong* with `res.json(branch)`; nobody had **chosen** the shape at all, and a client then depended on it. Generalises Revision 35, which established allow-list projection for the public branch directory alone (*"an endpoint that returns everything except what we remembered to strip is one careless `select` away from leaking"*) — a staff endpoint leaking `deleted_by` is not a privacy breach, but it is still a contract nobody designed. Enforced twice over, because the drift is silent by nature: `check-contract-dto.sh` fails a build where a controller hands a service result straight to `res.json`, and the HTTP suites assert the **exact key set** of each response. `GET /admin/branches` had **no HTTP-level test at all**, which is precisely how it drifted |
| **37.2** | 2026-07-30 | **The completion-report structure joins §16.3's mandatory contents**, for both agent files. Six sections, in order: user-visible changes · engineering highlights · documentation updates · additional defects discovered · verification · remaining work. The second of the two durability pins, and the same shape as 37.1 — the convention was adopted in `CLAUDE.md` and the handbook, but nothing required it, so it would not have survived a rewrite. **What is normative is the *structure*, not the prose:** the Document Owner reads reports to *decide*, so *"what changed for users"*, *"what did it cost"* and *"what is still open"* must sit in fixed places. Two sections carry obligations the document already imposes, which is what lifts this above formatting — **additional defects** is where §16.4's *discovered knowledge is debt paid immediately* becomes visible instead of buried in a diff, and **remaining work** keeps a scope reduction the Owner's decision rather than an implementer's silence. Applies to `AGENTS.md` too, since an agent that never reads `CLAUDE.md` would otherwise pick its own shape |
| **37.1** | 2026-07-29 | **Reading the relevant documentation before implementation joins §16.3's mandatory contents.** One line, for one reason: **durability.** Revision 37 established the per-task workflow and the step was added to `CLAUDE.md`, but §16.3's mandatory list did not require it — so it would have survived today and not a future rewrite of the file. **Scope deliberately narrow:** the *requirement* is now normative; the *process* (before/during/after, knowledge routing, the six-condition Done) stays in the handbook under §16.4, because duplicating procedure through the SRS would contradict the tier split R37 established. The step earns a normative line because it is the cheapest defence against a second authoritative home for one concept — reading first is what locates the existing home *before* a duplicate is created |
| **37** | 2026-07-29 | **Documentation maintenance is binding (new §16.4), and §16.3 stops carrying verbatim copies.** *A feature is not complete until the documentation describing it is updated, in the same commit* — the ledger row recorded **what was done** but never **how the system now works**, so explanatory documentation could rot while every gate stayed green. Also fixed the **precedence** question the new hierarchy raised: the SRS is normative and says what MUST; the handbook is explanatory, cites rather than restates, and is a derived artifact. **The second half is a duplication removal:** §16.3 had carried a full verbatim copy of `CLAUDE.md` and `AGENTS.md`. Useful to bootstrap them at M0, those copies became a second home for one requirement — **and had already drifted.** §16.3 now states normatively *what each file must contain*; the files carry the wording. The `CHANGES.log` template is **retained**, because it is a genuine one-time artifact no live file can drift from |
| **36.2** | 2026-07-29 | **Public display identity is an invariant, not an endpoint detail.** Generalised from one payload to *every* public surface, stated **once** in the data model with everything else cross-referencing it. Added guardrail rule 21 |
| **36.1** | 2026-07-29 | **`public_display_name` on the person.** Lets an instructor appear publicly as a kunya while the platform keeps her legal name. Resolved **in the backend only**; the frontend implements no fallback. Placed on the person rather than a teacher profile — it is a person-level publication choice |
| **36** | 2026-07-29 | **One bootstrap document for the calendar screen**, rejecting four independent endpoints: round trips are the scarce resource, one cache policy beats four, and the grouping is a real concept. Bounded by an explicit rule — **reference data only, never operational data**. Occurrences became self-sufficient, avoiding an N+1 on a public screen |
| **35** | 2026-07-29 | **The public branch directory.** Five public contact fields, and a **dedicated public route** rather than the admin route with permissions relaxed. Opening hours are **free text that nothing may parse** — Ramadan changes them, and a structured model turns each change into a schema conversation. No coordinates: two representations of one fact means the unread one drifts |
| **34** | 2026-07-29 | **Invalid credentials on public endpoints are anonymous.** A returning visitor whose token expired must not be login-walled on a public page |
| **33** | 2026-07-29 | **Pre-frontend consistency sweep.** No scope or behaviour change — four contradictions removed. Recorded the general lesson: **where a requirement is stated twice, the copies drift, and the fix is a cross-reference** |

### Domain model corrections

| # | Date | Decision |
|---|---|---|
| **32** | 2026-07-29 | **Recording, not deciding.** The Super Admin records the Ministry's announcement; the Ministry decides. Vocabulary enforced across specification, API, UI, and code. **The importer left the MVP entirely** — there is no machine-readable source, so the endpoint could only ever answer *not configured*. Extensibility preserved **by data, not scaffolding** |
| **31** | 2026-07-28 | **The official Hijri calendar is the source of truth.** The ±2-day offset removed: an offset approximates *uniformly*, while the real divergence varies month to month. An unrecorded month renders **nothing** |
| **30** | 2026-07-28 | **Teachers do not browse reference data.** Found by a verification sweep where the specification and the code disagreed — the code was right |
| **29** | 2026-07-28 | **Registration metadata is not reference data**, and **registration never places a beneficiary.** Placement is administrative, after approval. **Superseded in part by Revision 39**, which lets the applicant choose a *Branch* — the metadata-vs-reference-data half stands unchanged |
| **28** | 2026-07-28 | **Case-file permissions and audit.** No write permission had existed at all. Corrected wording that implied a related guardian might have access. **Both reads and writes audited** — viewing a child's file is itself sensitive |
| **27** | 2026-07-28 | **Generic educational stages; sex belongs to the person.** The restriction had existed **only in the Arabic category names** while every level was permissive — so no query could see the rule. Added `User.sex`, seeded real restrictions |
| **26** | 2026-07-28 | **Reference data versus operational data.** Only a Super Admin may write reference data. Also removed an incoherence: branch creation could not be scope-checked, and produced a branch its creator could not see |
| **25** | 2026-07-28 | **Category and level scopes reserved, not prohibited.** User-list visibility defined explicitly |
| **24** | 2026-07-26 | **Branch-scoped authorization confirmed.** A polymorphic scope framework **rejected** — a polymorphic id cannot carry a foreign key. Two real bugs fixed |

### Sessions, bootstrap, and identity

| # | Date | Decision |
|---|---|---|
| **23** | 2026-07-26 | **`SUPER_ADMIN_EMAIL` becomes optional once an administrator exists.** **Linking an existing child is staff-mediated** — parents get no search over children, which is what makes the anti-enumeration problem disappear |
| **22** | 2026-07-26 | **`SUPER_ADMIN_EMAIL` is a bootstrap value.** The old gate created a **second** Super Admin on an email change, leaving the first active and unclaimed. Lockout recovery is the intended path |
| **20** | 2026-07-25 | **Deleted-account login routing.** The lookup's scoping made a deleted account unreachable, so it fell through to *the registration form*. One rule instead of two half-rules |
| **19** | 2026-07-25 | **Audit purge selects on an enumerated allowlist AND age.** **A glob is not an allowlist** — `auth.*` would sweep in future actions nobody decided were purgeable |
| **18** | 2026-07-25 | **Sizing follows the audit model, not the reverse.** ~800–900k authentication rows a year. The choice was to **revise the estimate rather than weaken the audit trail** |
| **17** | 2026-07-25 | **Audit attribution verified rather than asserted.** Verification found the claim true in principle but not guaranteed in three respects. Stated the **attribution invariant** |
| **16** | 2026-07-25 | **Authentication state-machine audit.** Four blocking findings from a review that verified 17 of 21 paths and **refused to guess at the rest**. Added the token entity, twelve acceptance criteria, and the idempotent grace window — **a forked chain makes reuse detection impossible** |
| **15** | 2026-07-24 | **Pre-provisioned account lookup.** The documented flow was literally unimplementable — there was nowhere to store the authorized address. **Placeholder identity rows prohibited** |

### Architecture and scope

| # | Date | Decision |
|---|---|---|
| **14** | 2026-07-24 | Grading scale fixed at /20. **Rate limiting is two-layer** — Nginx cannot read a token subject or express an hourly rate. **Two-phase version lifecycle** replacing a blanket freeze that left the build unable to absorb a CVE fix |
| **13** | 2026-07-24 | Consistency sweep. One operational contradiction: the registry listed routes that the guardrails **forbade building** |
| **12** | — | Audit resolutions and a **deadline scope trim**: the weight engine, the in-app recorder, translations, committees, the audit page, the print layout. Sanctioned narrow raw-SQL exception. **Images built in CI, never on the VPS** |
| **11** | — | **Multi-tenancy removed entirely.** Trade-off recorded: a second institute means a separate deployment |
| **10** | — | Security hardening. Access token in the header only. **Fresh database assertion on high-risk endpoints** regardless of an unexpired token |
| **9** | — | Concurrency policy · migration compatibility · degraded operation · search semantics · the scale envelope · browser matrix |
| **8** | — | Architectural audit: ranged-GET magic bytes, storage-proxy signature rules, onboarding replay protection, integer basis points |
| **7** | — | The configuration inventory, the version policy, and the two mutable companion documents |
| **6** | — | Scope trim: notifications, CSV, multipart, Trash UI moved out. **Soft-delete columns, snapshots, and immutable keys retained.** The Hijri overlay **reaffirmed as in scope** |

---

## Patterns worth noticing

Reading the log as a whole, five habits recur — and they are the project's actual method.

**Duplication always drifts.** Revisions 33, 36.2 and 37 all fix an instance of it, and 33
names it as *the* general hazard. Every instance was found by audit, never by a failing test,
because **the copy that drifts still passes its own tests.** By Revision 37 the document is
correcting duplication it introduced in itself — the verbatim agent-file copies — which is
the clearest possible demonstration that the rule applies to the specification too.

**Verification over assertion.** Revision 17 exists because a claim was required to be
*verified rather than asserted* — and verification found it true in principle but not
guaranteed. Revision 30 exists because a sweep found the specification and the code
disagreed.

**Reject the reflex, and record why.** A polymorphic scope framework (24), structured opening
hours (35), four endpoints instead of one document (36), an abstract importer interface (32) —
each was the obvious answer, and each is documented with the reason it lost.

**Say what is deliberately absent.** An importer that could only answer *not configured*, an
interim average formula that would have to be torn out, coordinates nothing reads. Naming
them stops them being re-added by reflex.

**Superseded, not rewritten.** Revision 25 supersedes wording in 24; 14 replaces the policy in
10; 21 supersedes the reading in 10. The earlier entries stay standing as the record of what
was decided at the time.

---

**Related:** [Scope and roadmap](../overview/scope-and-roadmap.md),
[Architecture](../architecture/README.md), [`SRS.md`](../SRS.md) §0
