[Documentation](../README.md) › **Personal Data & CNDP Readiness Audit**

# Personal Data & CNDP Readiness Audit

Historical audit of 2026-08-11 (pre-R62), retained as provenance; the 2026-09-13 preparation below supersedes its inventory/filing suggestions, not its evidence. Followed by the [data-collection decision](data-collection-decision.md).

## Current filing preparation — 2026-09-13

- 2026-09-22 (R170 §13): the declaration's answers and the full Arabic privacy notice are prepared in [cndp-filing-and-privacy-notice.md](cndp-filing-and-privacy-notice.md) for Owner review; the regime and transfer determinations below stay open.
- Preparation only: not legal advice, filing, receipt or approval. Reconciled 2026-09-13 against HEAD `4e43697` (H1–H6 and H3 closed locally, `docker-compose.storage.yml` deploy fix, hosted CI green), superseding the review from B8 commit `45cf1f0`; H3 (`POST /assessments/{id}/open`, explicit manual exam opening) is an authorization/audit event, not a data category. No live legal document, account, provider console or Production host was read or changed.
- Labels: `VERIFIED FROM REPOSITORY` (read from source/config) · `OWNER INPUT REQUIRED` · `PROVIDER EVIDENCE REQUIRED` (Hostoweb or subprocessor, in writing; brand nationality proves nothing) · `LEGAL/CNDP CONFIRMATION REQUIRED` · `MUST COMPLETE BEFORE PRODUCTION` (no real beneficiary data until closed).
- CNDP sources verified live 2026-09-13 (HTTP 200): [notification guidance](https://www.cndp.ma/notifier-un-traitement/) listing **F214** (déclaration simplifiée), **F211** (déclaration normale), **F113** (autorisation simplifiée), **F112** (autorisation normale), **F118** (transfert à l'étranger), **F115** (désignation du responsable de traitement — not yet addressed, `LEGAL/CNDP CONFIRMATION REQUIRED`); [procedures](https://www.cndp.ma/procedures-de-notification-process/); [website conformity](https://www.cndp.ma/conformite-des-sites-web/); [Law 09-08](https://www.cndp.ma/images/lois/Loi-09-08-Fr.pdf). Re-verify before submission.

### Current processing annex

`VERIFIED FROM REPOSITORY` — read from current source, schema and configuration.

| Purpose / people | Verified implementation and material limits |
|---|---|
| Accounts, registration, staff/guardian/beneficiary relationships | `User`, `Identity`, roles, memberships, applications, `FamilyLink`; split names, contact, sex, beneficiary DOB (required, unlike the historical audit). Turning 18 grants nothing automatically: the explicit self-managed claim/approval remains (R132) |
| Educational administration | Enrollment, attendance, Quran progress, exams, answers, grades; assigned staff/audience scope, no public learner directory. Required history survives de-identification under structural IDs (not guaranteed anonymous). Manual remote exam opening is an explicit audited action (H3), not a timer |
| Recordings and publications | `EducationalContent`, Session links, optional online recording ingest; public/private/hidden placement, fresh authorization, media-consent safeguarding. Public publication is a disclosure the filing must cover. H6 retagging remediation passed real-stack acceptance |
| Security/accountability | Local refresh state, OAuth binding, consent/legal versions, structural audit. Authentication audit retained 12 months; business audit/consent history per TD-8/TD-14. Free-text settings/reasons outside the R141 rejection minimization still need recorded policy decisions, not a generic scrubber |
| Erasure and recovery | R133/B2 exact-generation User Trash deadline, then de-identification with retained history; B7 removes claim rationale and authorized historical rejection-audit copies. Monthly encrypted backup, at most two generations after verified rotation, no per-account archive rewrite or deletion replay; a restored point may hold later-erased data: reconcile before reopening access under an authorized incident decision |
| Hosting and authentication | B1 SeaweedFS + PostgreSQL on a Moroccan host; B8 encrypted backups temporarily on the same VPS. Google OAuth requests `openid email`, verifies identity/email; refresh is local; Google still involves identity/network data and potential foreign processing. Optional LiveKit must not silently activate an unreviewed foreign media processor |

Sources: [schema](../../backend/prisma/schema.prisma), [identity/access](../architecture/identity-and-access.md), [OAuth](../../backend/src/lib/oauth.ts), [storage](../architecture/storage.md), [recovery](../operations/resilience.md). No `StudentSocialProfile`, `User.notes`, generic health/CIN collection or birthday-based control transfer exists today.

### Filing regime and transfer decision

- CNDP lists F211 (normal declaration), F112 (prior authorization), F118 (foreign transfer). Ordinary declaration is not a safe blanket: Quran participation/progress may reveal religious convictions (inference requiring review). The Article 12(1)(a) nonprofit exemption is conditional: qualifying purpose, members/regular contacts and limits on third-party disclosure/express consent must all be evidenced. See [notification guidance](https://www.cndp.ma/notifier-un-traitement/), [Law 09-08 Art. 1 and 12](https://www.cndp.ma/images/lois/Loi-09-08-Fr.pdf).
- `OWNER INPUT REQUIRED` + `LEGAL/CNDP CONFIRMATION REQUIRED`, `MUST COMPLETE BEFORE PRODUCTION` — regime: signatory/adviser confirms F211 vs F112 and any exemption (minors, Quran progress, recordings, retained accountability evidence); do not assume F214/F113; nothing has been submitted.
- Same tags — transfers: document actual recipient legal entities, countries, processor/controller roles, contractual basis and safeguards for Google/others; Moroccan hosting does not answer it; prepare F118 with the base file if applicable (transfer authorization depends on approval of the underlying processing); no adequacy status or Google exemption presumed. See [procedures](https://www.cndp.ma/procedures-de-notification-process/).

### Submission packet — fill privately, never in Git

| Material | Ready input / missing input |
|---|---|
| Responsible controller and signatory | `OWNER INPUT REQUIRED`, `MUST COMPLETE BEFORE PRODUCTION`: registered name, status, address, registration evidence, signatory authority, rights contact; statutes/identity documents and forms outside Git |
| Purpose / categories / recipients | `VERIFIED FROM REPOSITORY`: the annex above; confirm real volumes, staff audiences, public media, optional online teaching; never the old audit's "no DOB" or withdrawn health fields |
| Collection notices and consent proof | Synthetic screenshots of the accepted release's forms; approved processing/media wording, privacy and terms versions. `OWNER INPUT REQUIRED`, `MUST COMPLETE BEFORE PRODUCTION`: final Arabic wording and activation evidence |
| Retention justification | `VERIFIED FROM REPOSITORY` for the mechanism (R133/B2/B7, educational/consent/audit history, monthly two-generation backup; two generations is no promise of erasure within two months during failed backups — failures escalate). `OWNER INPUT REQUIRED` + `LEGAL/CNDP CONFIRMATION REQUIRED`: legal justification for retained history and free-text rules |
| Hosting/subcontracting | `PROVIDER EVIDENCE REQUIRED`, `MUST COMPLETE BEFORE PRODUCTION`: Hostoweb contract, actual Moroccan data-center location, subcontractors/support access, snapshots/replicas/backups, incident terms, in writing; engineering cannot supply this |
| Security annex | `VERIFIED FROM REPOSITORY`: Branch/Teacher scope, exact public-object DB gate, private signed access, encryption/escrow, bounded logs, worker/retirement alarms, restore proof; H1–H6 and H3 closed locally ([deployment readiness](../operations/deployment-readiness.md)); B1 object store and B8 backup engineering-complete, not host-installed; state the same-VPS total-loss limitation |
| Transfer annex and filing evidence | `OWNER INPUT REQUIRED` + `LEGAL/CNDP CONFIRMATION REQUIRED`, `MUST COMPLETE BEFORE PRODUCTION`: F118 facts/basis if applicable, later actual receipts/approvals; no invented numbers, signatures, dates, commitments or proof |

- CNDP procedure requires notices/consent or another basis, subcontracting confidentiality evidence and signatory authority; the public site must state controller, purposes, recipients, obligatory/optional fields and rights/contact, with CNDP references once issued ([website conformity](https://www.cndp.ma/conformite-des-sites-web/)).

### Public-text release check
- Since R138 `/privacy` and `/terms` render activated `LegalDocument` rows, not hardcoded text; the Production seed invents none; registration uses versioned `LegalConsentText`. Source review cannot show what is activated live: before real users, export/review the approved versions privately, match every annex claim, verify anonymous rendering and the registration consent snapshot. No legal text is activated by this task; follow the [release checklist](../operations/deployment-readiness.md#ordered-release-checklist).

### Owner/legal/provider checklist
1. `OWNER`: registered name, status, address, registration evidence, authorized signatory.
2. `OWNER` + `LEGAL/CNDP`: filing route F211 vs F112, whether Article 12(1)(a) applies, whether F115 is separately required; no form pre-selected.
3. `OWNER` + `LEGAL/CNDP`: Google's recipient entity/country/role and whether F118 accompanies the base filing.
4. `PROVIDER`: written Hostoweb confirmation of data-center location, subcontractors with access, backup/incident terms ([provider-acceptance matrix](../operations/provider-acceptance.md) or the release checklist's provider step).
5. `OWNER`: approve and activate final Arabic `/privacy`, `/terms` and registration-consent rows; re-verify anonymous rendering.
6. `OWNER` + `LEGAL/CNDP`: written approval of retention/erasure (R133/B2/B7, monthly two-generation same-VPS backup) before real data exists.
7. Only then assemble the packet privately and file; this task selects no form and submits nothing.

## Historical audit — retained provenance

- DATED AUDIT, NOT THE CURRENT INVENTORY. `StudentSocialProfile` was withdrawn 2026-09-02 (R120; migration `20260902200000_drop_student_social_profile`, guard refuses a non-empty table; localhost and Staging held 0 rows; Production not deployed). Section A.2 and every derived LEGAL REVIEW item is RESOLVED BY REMOVAL. Owner policy: no categories of personal data unnecessary for current operational purposes.
- `User.notes` (2 000-char free text, §A.1/§G.3) was dropped the same day (R121; `20260902220000_drop_user_notes`, guard refuses a non-blank value; localhost 0 of 73 users, Staging 0 of 14); the form no longer offers it; Google OAuth scope reduced to `openid email` (the unused `profile` scope of §H.1 is gone). Principle: no generic free-text field without a documented purpose.
- Neither removal states a legal conclusion: declaration vs authorization, Quran-progress classification and the Google transfer remain open.
- Audit for the Document Owner; no code, schema or SRS changed. Tags: **[SRS]** cited · **[CODE]** verified in code · **[INFER]** reasoning, not authority · **[CONFIRM]** needs the CNDP or a Moroccan privacy lawyer. Law 09-08 is understood to distinguish declaration from prior authorization (sensitive categories, national ID, file interconnection, transfers to non-adequate countries); article numbers unverified. A declaration does not license collection: each field must be necessary and proportionate to a defined purpose; merely useful fields are OPTIONAL or DO NOT COLLECT.

### A. Data inventory (verified against `prisma/schema.prisma`)

**A.1 `User`**

| Field | Person | Purpose | Necessary? | Req/Opt | Access | Sensitive? | Action |
|---|---|---|---|---|---|---|---|
| `nameArabic` (+ parts) | all | Identify | Yes | Required | staff; self | No | KEEP |
| `nameFrench` (+ parts) | all | Bilingual records | Marginal | Optional | staff; self | No | OPTIONAL |
| `nickname` | all | What a person is called | Yes | Optional | staff; self | No | KEEP |
| `publicDisplayName` | all | Public identity (§20 r21) | Yes | Derived | public | No | KEEP |
| `phone` | adult/parent/staff | Contact | Yes | Optional | staff; self | No | KEEP; never a child's (G.2) |
| `qrRef` | all | Scannable reference (R96) | Yes | Required | staff; self | External correlate | KEEP; rotate at final de-identification |
| `referenceCode` | beneficiaries | Spoken short id (R62) | Yes | Optional | staff; self | External correlate | KEEP; clear at final de-identification |
| `sex` | all | §4.4b restricted Levels | Yes [SRS] | Required | staff | [CONFIRM] | KEEP |
| `notes` | all | Free-text note | No defined purpose | Optional | staff | 2000 chars of anything | LEGAL REVIEW (I.1); removed R121 |
| `preProvisionedEmail` | staff | Account claiming (§4.1b) | Yes | Optional | staff | No | KEEP |
| `accountStatus` | all | TD-1 lifecycle | Yes | Required | staff; self | No | KEEP |
| `intendedBranchId` | applicant | Routing (R39) | Yes | Optional | staff | No | KEEP |
| `intendedCategoryId`, `schoolingStage`, `requestedRole` | applicant | Approval context | Yes | Optional | staff | No | KEEP until decided; clear at final de-identification |
| `*Normalized` | all | Arabic search | Yes | Derived | server only, not in the API | No | KEEP |

- Every field above reaches the API except `*Normalized`; every field applies to minors except `phone` and `preProvisionedEmail`.
- [CODE] at audit date: no date of birth, CIN/national ID, photo or geolocation in the schema (DOB later required, R130).
- [CODE] R111 de-identification is an allow-list: the tombstone keeps `id`, `sex`, lifecycle, beneficiary status, record age; clears composed and split names, contact/public identity, registration-request metadata, notes, spoken/QR identifiers and every credential/planning satellite; the Trash snapshot is deleted in the same transaction.

**A.2 `StudentSocialProfile` — REMOVED (R120)**, analysis kept as the argument that produced the decision.

| Field | Purpose | Necessary? | Sensitive? | Action |
|---|---|---|---|---|
| `healthCondition` | Safeguarding | [CONFIRM] | Health data, almost certainly special category | LEGAL REVIEW |
| `familySituation` | Safeguarding | [CONFIRM] | Unbounded free text; judicial/social data | LEGAL REVIEW |
| `homeAddress` | Safeguarding | Questionable | Locates a minor | LEGAL REVIEW |
| `siblingsCount` | Social context | No | Low | DO NOT COLLECT |
| `fatherName`, `motherName` | Family identification | Partly | Third-party data | OPTIONAL |
| `fatherProfession`, `motherProfession` | Social context | No | Socio-economic profiling | DO NOT COLLECT |

- [CODE] access was the platform's strictest: read and write by Super Admin, branch-scoped Admin and assigned teachers only; never students or guardians (BR-16, R28); both audited (`socialprofile.view` / `socialprofile.update`); out of scope `404`, not `403`.
- [INFER] the field list, not the controls, was the problem: 2000-char `healthCondition` invites a diagnosis ([CONFIRM] whether that alone forces prior authorization); `siblingsCount` and `*Profession` were read by no business logic.

**A.3 Educational data**

| Data | Model | Purpose | Necessary? | Minor? | Action |
|---|---|---|---|---|---|
| Level / Category / Group membership | `Enrollment`, `StudentTeachingGroup` | Educational administration | Yes | Yes | KEEP |
| Level completion, certificate number and dates (R167 §3) | `LevelCompletionMark` | Her completion record and printable certificate; no free text; `requirements_met` boolean; no certificate file generated, stored or sent | Yes | Yes | KEEP |
| Placeholder mark on the birth date (R169 §9) | `User.birthDateIsPlaceholder` | Unrecorded dates store the fixed 1900-01-01, marked; means only «not recorded»; never shown as a date or read as an age; replaced once by the real date; cleared at de-identification | Yes | Yes | KEEP |
| Roles asked for and their decisions (R168 §1) | `RoleRequest` | `student · guardian · teaching · administration`, approved/declined, by whom, when; `first_time` boolean; `decline_reason` operator-facing (≤500), never shown raw, a decision not a judgement; a request, never an authority | Yes | No (a minor never registers herself, R62) | KEEP |
| Circles a first-time مستفيدة ranked (R168 §1) | `CirclePreference` | Placement; ids and rank only | Yes | No | KEEP |
| Quran progress (surah, ayah range) | `QuranProgressLog` | Core educational purpose | Yes | Yes | KEEP |
| Grades (integer basis points) | `Grade` | Assessment | Yes | Yes | KEEP |
| `Grade.overrideReason` | free text | Override accountability | Yes | Yes | KEEP; bound the length |
| Exam submissions | `StudentExamSubmission` | Assessment | Yes | Yes | KEEP |
| Assessment answers (R124) | `StudentExamAnswer`, `StudentExamAnswerOption` | Her own words and choices; replaces the `answers` jsonb column | Yes | Yes | KEEP |
| `Session.cancellationReason` | free text | Operational record | Yes | No | KEEP |

- [CODE] at audit date no attendance model existed (a new purpose, E); attendance is now §4.7 (R123).
- R124, where an answer never appears: `AuditLog` (`assessment.save`, `assessment.submit`, `assessment.question.*` carry ids, kind, count; never an answer, prompt, option label or title; guard refuses copied identity, the free-text rule is asserted in `assessment.integration.test.ts`); `Trash` (only a removed question and its options, staff text, §20 rule 11; removal refused once anybody submitted; the retired `questions` blob snapshot is a column, not an answer); notifications (none in v1); logs (TD-14 forbids request bodies).

**A.4 Authentication, audit and security**

| Data | Where | Retention | Action |
|---|---|---|---|
| Google `providerSubjectId`, `email` | `UserIdentity` | Life of account | KEEP |
| `tokenHash` | `RefreshToken` | Purged past expiry [CODE] | KEEP |
| `AuditLog.detail` (JSON) | `AuditLog` | 12 months for an enumerated auth allowlist; everything else indefinite [CODE] | KEEP (I.2) |
| `ConsentRecord` | own table | Indefinite | KEEP |

- [CODE] audit detail minimised at the repository boundary: updates log field names only; pre-provisioning logs the target User id and `identity_channel = pre_provisioned`, never the mailbox; content rows use non-reversible exact-coordinate ids (the key stays in the content/Trash/job record); the recursive guard refuses copied names, contacts, titles, labels, filenames, locators before commit; unit test + CI source guard pin it.
- [CODE] logs carry no identity coordinates: Nginx makes the correlation id, logs no URI/client address; Express logs a route template / `<unmatched>` and fixed error text; raw database/storage messages excluded. TD-8 identity-email closed by R170 §18 (user id only); exact-storage-key reconciliation stays an Owner item in `TASKS.md`, stricter no-PII behaviour meanwhile. TD-8-required reasons and old/new setting values are not sanitized; their access/retention is a separate Owner decision.
- [CODE] `consent_gate.override`, `grade.passfail_override`, `settings.change`, `trash.permanent_delete` are excluded from the purge allowlist, retained indefinitely.

**A.5 Files and storage**
- [CODE] uploads: PDF and audio only; video excluded by design (`file-types.ts`); images not accepted.
- [INFER] audio of a child reciting is personal data with voice characteristics; not biometric identification as used (no matching); [CONFIRM] heightened treatment for minors' voice recordings.
- [SRS] `media_release` is a distinct `ConsentType` from `data_processing`.

**A.6 Third parties and hosting**

| Party | Data | Location | Status |
|---|---|---|---|
| Google OAuth | `openid email profile` at audit date [CODE]; `openid email` since R121 | Foreign | [CONFIRM] (H.1) |
| SeaweedFS (object storage) | All uploads | Self-hosted, same VPS [SRS] | OK |
| PostgreSQL | Everything | Self-hosted, same VPS [SRS] | OK |
| Analytics / telemetry | — | — | [CODE] none: no analytics, Sentry or tag manager |
| Email / SMS | — | — | [CODE] none; no notification channel built |
| Third-party AI | — | — | [CODE] none |

- [SRS] §2.2 requires Moroccan hosting; Local Development, Preview (Vercel) and Staging (§19.0, R104) hold fixture data only — a specified control.

### B. Planned R62 data inventory

| Field | Person | Purpose | Necessary? | Notes |
|---|---|---|---|---|
| Child first/last Arabic name | minor | Identify the child | Yes | Exists |
| Child `sex` | minor | §4.4b restriction | Yes [SRS] | Exists |
| Parent–child relationship | parent + minor | `FamilyLink` authorization record | Yes | Exists |
| `ChildApplication` envelope + `decisionReason` | parent + minor | Approval workflow | Yes | New table |
| Proposed date of birth | minor | Duplicate detection | See D.1 | Not in the schema then |

- [INFER] R62 adds no new category; the duplicate-match proposal (birth date) is where risk enters (D.1).

### C. Recommended additional data (purpose ÷ risk)

| Field | Purpose | Why proportionate | Action |
|---|---|---|---|
| Emergency contact (name, phone, relationship) | Safeguarding: a child unwell or unaccompanied | Concrete need; absence is a safeguarding gap | KEEP, minors only |
| Attendance (present/absent/late per session) | Educational administration | Core to teaching | KEEP as its own purpose (E) |
| Guardian relationship type (mother/father/legal guardian) | Who may act | Bounded enum | OPTIONAL |
| Preferred contact language | Communication | Trivial risk | OPTIONAL |
| Certificates / achievements | Recognition | Derived from held grades | OPTIONAL |

### D. Data to avoid collecting

| Field | Why not | Action |
|---|---|---|
| CIN / national ID | [CONFIRM] may require prior authorization; top breach target; no purpose acted on | DO NOT COLLECT |
| Date of birth for duplicate matching only | Solves it badly (siblings, twins, entry error); precise identifier per minor | DO NOT COLLECT for that purpose (D.1) |
| Biometrics | Special category; no purpose | DO NOT COLLECT |
| Religious affiliation or conviction | Special category; inferable from enrolment itself, so never a field | DO NOT COLLECT |
| Political opinions, ethnicity, trade-union membership | Special category; no purpose | DO NOT COLLECT |
| Geolocation | No purpose | DO NOT COLLECT |
| Photos/video of students | Excluded by design [CODE]; reintroduction needs `media_release` consent and a retention rule | DO NOT COLLECT without explicit decision |
| Parents' professions, siblings count | No logic read them | DELETE (I.1) — done by R120 |
| Free-text health details | A.2 | LEGAL REVIEW before R62 — resolved by removal |

- D.1: keep human-resolved (admin-chosen candidate) duplicate matching; no birth date for deduplication — hundreds of permanent identifiers to save minutes a few times a year; a birth date for another purpose (age-appropriate placement) is a separate decision.

### E. Processing-purpose matrix ([INFER] structure; declare purposes separately)

| # | Purpose | Data categories | Lawful basis [CONFIRM] | Retention |
|---|---|---|---|---|
| 1 | Account & authentication | Identity, Google subject, tokens | Contract / consent | Life of account |
| 2 | Registration & membership | Names, sex, date of birth (R130), phone, branch, application status | Contract / consent | Life of membership; a REJECTED application 12 months (R131) |
| 3 | Parent–child relationship | `FamilyLink`, guardian identity | Legal representation of a minor | Until withdrawn or an approved self-managed claim ends it (R132); never automatically at majority |
| 4 | Educational administration | Level, group, subject, schedule | Contract | 10 years after last educational activity (R131) |
| 5 | Attendance | Presence per session | Contract | 10 years after last educational activity (R131) |
| 6 | Assessment | Grades, exam submissions | Contract | 10 years after last educational activity (R131) |
| 7 | Quran progress | Surah/ayah coverage | Contract | 10 years after last educational activity (R131) |
| 8 | Communication (none built) | Contact details, preferences | Consent | Until withdrawn |
| 9 | Safeguarding | Social profile, emergency contact | [CONFIRM], likely the most constrained | Strictly limited [CONFIRM] |
| 10 | Security & audit | Actor, action, timestamp, no values | Legal obligation / legitimate interest | 12 months, security events longer |
| 11 | File & document management | Uploads, metadata | Contract / consent | Until deletion + 90 days |
| 12 | Platform operation | Technical logs | Legitimate interest | Short [CONFIRM] |

- Retention updated 2026-09-04: R131 settled purposes 2 and 4–7, R132 purpose 3; the ten years are the association's own purpose-based policy, not CNDP-prescribed; definition of *last educational activity* and the computation: [personal-data map](../development/personal-data-map.md).
- Row 3: guardian authority never lapses by itself on an eighteenth birthday; the transition is an approved claim.
- Purpose 9 is declared separately and narrowly, never bundled into educational administration.

### F. Questions for the CNDP / a lawyer (all [CONFIRM])
1. Does free-text `healthCondition` force prior authorization? (resolved by removal)
2. Do `familySituation` and `homeAddress` for minors attract the same treatment? (resolved by removal)
3. Is Google OAuth (identity data to a US provider) a transfer requiring authorization; is the destination adequate? §2.2 mandates Moroccan hosting; authentication is the one flow that structurally leaves.
4. Are audio recordings of minors ordinary personal data?
5. Retention and majority: answered by the Owner (R131 ten years from last educational activity; R132 nothing happens at majority, she may claim her account); open: any externally required minimum/maximum.
6. Must parents' rectification/erasure over a child's record be a feature?
7. Must the notice be in Arabic and consent per purpose? (schema already separates `media_release` / `data_processing`)
8. Is a CNDP declaration already filed, covering E?

### G. Minor-specific risks
- G.1 [SRS] minors have no login; every access path is an authorization path, widened by R62.
- G.2 [CODE] `phone` exists on `User` for children too; [INFER] constrain that a `User` reached only via `FamilyLink` carries no phone.
- G.3 [CODE] `registration.service.ts:282` wrote `input.child.notes` (`VarChar(2000)`, no purpose, no reader) — removed by R121.
- G.4 social-profile access was correct; its contents were the exposure — removed by R120.
- G.5 [CODE] `resolveActingStudent` is sound; approval is the security boundary (a mis-approved link grants a stranger a child's record); the approval screen must show enough to decide; approvals are audited.
- G.6 multi-parent linking undefined ([SRS] silent; schema permits two parents per child); custody disputes make it a safeguarding question — decision required.

### H. Third-party and hosting risks
- H.1 [CODE] Google OAuth is the only foreign flow; no Google API beyond token exchange; minors never authenticate, so a child's identity never reaches Google — state it in the declaration.
- H.2 [CODE] no analytics, error tracking, email provider or AI service; preserve as a rule — any addition is a new processor and transfer question.
- H.3 [SRS] §2.2 forbids real data in every non-Moroccan tier. Preview (Vercel) stores nothing (MSW mocks). Staging (R104) has since 2026-08-25 a real PostgreSQL and MinIO on a VPS in France, permissible only as fixture-only, held by: the fixtures seed refusing `NODE_ENV=production`; production dumps never leaving Moroccan infrastructure and the development database never copied into Staging (§20 rule 18); Staging holding no production credential. [INFER] residual risk is procedural (nothing stops a manual `pg_restore`); a technical barrier is recommended.
- H.4 [SRS] backups: nightly `pg_dump` plus volume backups, `restic` over SSH offsite to a second Moroccan location, RPO ≤ 24 h, RTO < 1 h, tested restore as a launch requirement; both locations inside Morocco (BR-18). Open: no retention period for backup copies, so an erased record may persist; [CONFIRM] backup retention vs erasure.

### I. Missing controls

| # | Gap | Severity | Recommendation |
|---|---|---|---|
| I.1 | `siblingsCount`, `fatherProfession`, `motherProfession` stored, returned, read by no logic [CODE]; `User.notes` about children | High | Delete the three; purpose or removal for `notes` — done (R120, R121) |
| I.2 | No automatic retention job: `content.quarantine-purge` handles exact obligations, R59.4 keeps age-based destruction Owner-gated; R111's three-day de-identification ratified but absent from TD-7 and the worker [CODE] | High | Manual Super Admin purge works; Owner adds the account queue to TD-7 before implementation and decides automatic content destruction |
| I.3 | Privacy/terms pages exist and describe account deletion [CODE]; legal entity/registration/CNDP details marked as required | High | Association/legal review supplies them |
| I.4 | No data-subject access/export path | Medium | A parent cannot obtain a child's record |
| I.5 | Backup retention unset | Medium | H.4 |
| I.6 | No emergency contact | Medium | C |
| I.7 | `data_processing` consent not enforced as a registration gate [CONFIRM] | Medium | Verify it is recorded before processing |
| I.8 | ~~No minimisation rule for audit `detail`~~ resolved in code/docs/CI: values stay on the governed entity, audit uses ids, coordinates, field names; identity-email closed by R170 §18 (user id only); free-text reasons left the audit for the owning record | Low | Keep `check-no-pii-logs.sh` and hostile-value regressions green |

### J. Recommended registration forms (collect what a purpose needs, when needed)

| Person | Required | Optional | Not collected |
|---|---|---|---|
| Adult student | Arabic first + last name · sex · phone · branch · `data_processing` consent | French name · nickname | CIN, birth date, address, profession, health |
| Child (via parent) | Arabic first + last name · sex · relationship to requester; separately, own `media_release` consent | nickname | phone, CIN, birth date, address, health, siblings, parents' professions |
| Parent | Arabic first + last name · phone · `data_processing` consent; emergency contact name + phone if not the parent | French name · preferred contact language | — |
| Teacher / staff | Arabic first + last name · phone · email (Google) · branch | French name · nickname | CIN, birth date, address, marital status, photo |

### K. Proposed minimal profile model
- `User`: identity (Arabic first/last, optional French, nickname, `publicDisplayName`); contact `phone` (adults and staff only); `sex`; `accountStatus`, `intendedBranchId`; `notes` removed.
- `MinorSafeguarding` (renamed, narrowed `StudentSocialProfile`): `emergencyContactName/Phone/Relation`; `accessibilityNeeds` as bounded enum + short note, not a diagnosis ([CONFIRM] whether it replaces `healthCondition`); `siblingsCount` and professions removed; `healthCondition`, `familySituation`, `homeAddress` legal review.
- `FamilyLink` unchanged + `relationshipType` (mother | father | legal_guardian).

### L. Prioritised plan
- Before R62 (blocking): legal review of `healthCondition`/`familySituation`/`homeAddress` [CONFIRM]; delete the three no-purpose fields (I.1); Arabic per-purpose privacy notice (I.3); confirm CNDP declaration status and E coverage.
- With R62: human-resolved matching, no birth date (D.1); `relationshipType`; multi-parent decision (G.6); emergency contact (C, I.6).
- Soon after: retention job (I.2); data-subject export (I.4); backup retention and erasure propagation (H.4, I.5); child-`phone` constraint (G.2); audit-detail minimisation guard (I.8).
- Not done by the audit: no interpretation of Moroccan law, no articles cited, no declaration/authorization conclusion; A, D and I state what the system holds, where it goes, who reads it and which fields serve no purpose.
