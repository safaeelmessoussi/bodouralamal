[Documentation](../README.md) › **Personal Data & CNDP Readiness Audit**

# Personal Data & CNDP Readiness Audit

**Date:** 2026-08-11 · **Scope:** the live `develop` architecture, before R62
**Status:** audit for the Document Owner. No code, schema, or SRS was changed.
**Followed by:** [the data-collection decision document](data-collection-decision.md),
which turns these findings into a recommended profile per person type.

---

## How to read the claims in this document

Every material statement is tagged, because mixing these four is how a
compliance document becomes confidently wrong:

| Tag | Means |
|---|---|
| **[SRS]** | The specification says this. Quoted or cited. |
| **[CODE]** | I verified it in the running codebase. Reproducible. |
| **[INFER]** | My engineering/compliance reasoning. Not authority. |
| **[CONFIRM]** | **Requires the CNDP or a Moroccan privacy lawyer.** I am not one. |

**On the legal framework specifically.** My understanding is that Law 09-08
distinguishes ordinary processing (declaration to the CNDP) from processing
requiring **prior authorization** — which I understand to include sensitive
categories, use of the national identity number, interconnection of files, and
transfers to countries the CNDP has not recognised as adequate. **I have not
verified article numbers or current CNDP practice, and this document cites
none.** Every point where the distinction matters is tagged **[CONFIRM]**.

**A principle this audit applies throughout:** a declaration does not license
collection. Each field must be *necessary and proportionate to a defined
purpose*. Fields that are merely useful are marked OPTIONAL or DO NOT COLLECT.

---

# A. Current data inventory

Verified against `prisma/schema.prisma` and the services that read it.

## A.1 `User` — every person on the platform

| Field | Person | Purpose | Necessary? | Req/Opt | Access | API? | Minor? | Sensitive? | Action |
|---|---|---|---|---|---|---|---|---|---|
| `nameArabic` (+ first/last parts) | all | Identify a person | Yes | Required | staff; self | Yes | Yes, for children | No | **KEEP** |
| `nameFrench` (+ parts) | all | Bilingual records | Marginal | Optional | staff; self | Yes | Yes | No | **OPTIONAL** |
| `nickname` | all | What a person is called | Yes | Optional | staff; self | Yes | Yes | No | **KEEP** |
| `publicDisplayName` | all | Resolved public identity (§20 r21) | Yes | Derived | public | Yes | Yes | No | **KEEP** |
| `phone` | adult/parent/staff | Contact | Yes | Optional | staff; self | Yes | **Should never be a child's** | No | **KEEP** — see G.2 |
| `qrRef` | all | Stable scannable person reference (R96) | Yes | Required | staff; self | Yes | Yes | External correlate | **KEEP while active; rotate at final de-identification** |
| `referenceCode` | beneficiaries | Spoken short identifier (R62) | Yes | Optional | staff; self | Yes | Yes | External correlate | **KEEP while active; clear at final de-identification** |
| `sex` | all | §4.4b sex-restricted Levels | Yes **[SRS]** | Required | staff | Yes | Yes | **[CONFIRM]** | **KEEP** |
| `notes` | all | Free-text admin note | **No defined purpose** | Optional | staff | Yes | Yes | 2000 chars of anything | **LEGAL REVIEW** — see I.1 |
| `preProvisionedEmail` | staff | Account claiming (§4.1b) | Yes | Optional | staff | Yes | No | No | **KEEP** |
| `accountStatus` | all | TD-1 lifecycle | Yes | Required | staff; self | Yes | Yes | No | **KEEP** |
| `intendedBranchId` | applicant | Routing an application (R39) | Yes | Optional | staff | Yes | Yes | No | **KEEP** |
| `intendedCategoryId`, `schoolingStage`, `requestedRole` | applicant | Approval context | Yes | Optional | staff | Yes | Yes | No | **KEEP until decided; clear at final de-identification** |
| `*Normalized` | all | Arabic search | Yes | Derived | server only | **No** | Yes | No | **KEEP** |

**[CODE]** There is **no date of birth, no CIN/national ID, no photo field, and
no geolocation** anywhere in the schema. That is a strong starting position and
should be defended.

**[CODE] R111 de-identification is an allow-list, not a display rename.** The preserved User
tombstone keeps `id`, `sex`, lifecycle, beneficiary status and record age. It clears both
composed and split names, contact/public identity, registration-request metadata, free-text
notes, spoken/QR identifiers and every credential/planning satellite. Its recoverable Trash
snapshot is deleted in that same transaction; otherwise the original PII would survive the
operation in JSONB.

## A.2 `StudentSocialProfile` — the highest-risk table

| Field | Purpose | Necessary? | Sensitive? | Action |
|---|---|---|---|---|
| `healthCondition` | Safeguarding | **[CONFIRM]** | **Health data — almost certainly a special category** | **LEGAL REVIEW** |
| `familySituation` | Safeguarding | **[CONFIRM]** | Unbounded free text; may capture judicial/social data | **LEGAL REVIEW** |
| `homeAddress` | Safeguarding | Questionable | Locates a minor | **LEGAL REVIEW** |
| `siblingsCount` | Social context | **No** | Low | **DO NOT COLLECT** |
| `fatherName`, `motherName` | Family identification | Partly | Third-party data | **OPTIONAL** |
| `fatherProfession`, `motherProfession` | Social context | **No** | Socio-economic profiling | **DO NOT COLLECT** |

**[CODE] The access controls here are the strongest in the platform** and were
built deliberately: read *and* write restricted to Super Admin, branch-scoped
Admin, and the student's own assigned teachers; **never students, never
guardians including the child's own parents** (BR-16, R28); both reads and
writes audited (`socialprofile.view` / `socialprofile.update`); out-of-scope
answers `404` not `403` so a response cannot confirm a record exists.

**[INFER] The controls are excellent; the field list is the problem.**
`healthCondition` as unbounded free text (2000 chars) invites a teacher to write
a diagnosis, a medication, or a disability. **[CONFIRM]** Whether this alone
moves the processing into a prior-authorization regime is the single most
important legal question in this audit.

**[INFER]** `siblingsCount` and both `*Profession` fields have no purpose the
platform acts on. I searched: **no business logic reads them** — they are
displayed and nothing more. That is collection without purpose.

## A.3 Educational data

| Data | Model | Purpose | Necessary? | Minor? | Action |
|---|---|---|---|---|---|
| Level / Category / Group membership | `Enrollment`, `StudentTeachingGroup` | Educational administration | Yes | Yes | **KEEP** |
| Quran progress (surah, ayah range) | `QuranProgressLog` | Core educational purpose | Yes | Yes | **KEEP** |
| Grades (integer basis points) | `Grade` | Assessment | Yes | Yes | **KEEP** |
| `Grade.overrideReason` | free text | Accountability for an override | Yes | Yes | **KEEP** — bound the length |
| Exam submissions | `StudentExamSubmission` | Assessment | Yes | Yes | **KEEP** |
| `Session.cancellationReason` | free text | Operational record | Yes | No | **KEEP** |

**[CODE] There is no attendance model.** `grep "model Attendance"` returns
nothing. If attendance is planned, it is a new purpose (see E).

## A.4 Authentication, audit and security

| Data | Where | Retention | Action |
|---|---|---|---|
| Google `providerSubjectId`, `email` | `UserIdentity` | Life of account | **KEEP** |
| `tokenHash` | `RefreshToken` | Purged past expiry **[CODE]** | **KEEP** |
| `AuditLog.detail` (JSON) | `AuditLog` | 12 months for an **enumerated** auth allowlist only; everything else **indefinite** **[CODE]** | **KEEP** — see I.2 |
| `ConsentRecord` | its own table | Indefinite | **KEEP** |

**[CODE] Audit detail is minimised by design in at least one place**:
`user.service.ts:425` logs **field names only, never values** on a profile
update. That is the right pattern and should be made a stated rule.

**[CODE]** Security events (`consent_gate.override`, `grade.passfail_override`,
`settings.change`, `trash.permanent_delete`) are **deliberately excluded** from
the purge allowlist and retained indefinitely.

## A.5 Files and storage

**[CODE]** Accepted uploads: **PDF and audio only**. Video is *excluded by
design* — `file-types.ts` states that accepting `video/*` would be a decision
nobody made. Images are not accepted either.

**[INFER]** Audio of a child reciting is still personal data, and plausibly
carries voice characteristics. It is **not** biometric identification as the
platform uses it (no matching, no identification), but **[CONFIRM]** whether
voice recordings of minors attract heightened treatment.

**[SRS]** `media_release` consent exists as a distinct `ConsentType`, separate
from `data_processing` — the right structure.

## A.6 Third parties and hosting

| Party | Data | Location | Status |
|---|---|---|---|
| **Google OAuth** | `openid email profile` **[CODE]** | Foreign | **[CONFIRM]** — see H.1 |
| **MinIO** | All uploads | Self-hosted, same VPS **[SRS]** | OK |
| **PostgreSQL** | Everything | Self-hosted, same VPS **[SRS]** | OK |
| Analytics / telemetry | — | — | **[CODE] None. No analytics, no Sentry, no tag manager.** |
| Email / SMS | — | — | **[CODE] None exists.** No notification channel is built |
| Third-party AI | — | — | **[CODE] None.** |

**[SRS] §2.2 already requires Moroccan hosting** and states that every
non-Moroccan tier — **Local Development, Preview (Vercel) and Staging** (§19.0,
Revision 104) — **must never contain real beneficiary data: fixture data
only**. This is a specified architectural control, not an aspiration.

---

# B. Planned R62 data inventory

| Field | Person | Purpose | Necessary? | Notes |
|---|---|---|---|---|
| Child first/last Arabic name | **minor** | Identify the child | Yes | Already exists |
| Child `sex` | **minor** | §4.4b Level restriction | Yes **[SRS]** | Already exists |
| Parent–child relationship | parent + minor | `FamilyLink` authorization record | Yes | Already exists |
| `ChildApplication` envelope + `decisionReason` | parent + minor | Approval workflow | Yes | New table |
| **Proposed: date of birth** | **minor** | Duplicate detection | **See D.1** | **Not in the schema today** |

**[INFER] R62 adds no new *category* of personal data** — it restructures the
workflow around data already collected. The one exception is the duplicate-match
problem, which is where a birth date was proposed. That proposal is where the
compliance risk enters, and it is addressed in D.1.

---

# C. Recommended additional data worth collecting

Ranked by *purpose served ÷ risk added*.

| Field | Purpose | Why proportionate | Action |
|---|---|---|---|
| **Emergency contact** (name, phone, relationship) | Safeguarding — a child is unwell or unaccompanied | A concrete, defensible need. Currently **absent**, which is arguably a *safeguarding gap* | **KEEP** — collect for minors only |
| **Attendance** (present/absent/late per session) | Educational administration | Core to a teaching institution | **KEEP** — as a purpose of its own (E) |
| **Guardian relationship type** (mother/father/legal guardian) | Clarifies who may act | Small, bounded enum | **OPTIONAL** |
| **Preferred contact language** | Communication | Trivial risk | **OPTIONAL** |
| **Certificates / achievements** | Recognition | Derived from grades already held | **OPTIONAL** |

**[INFER]** Emergency contact is the one genuine gap. A platform holding
minors' educational records with **no** way to reach someone in an incident is a
weakness, not a privacy virtue.

---

# D. Data to explicitly avoid collecting

| Field | Why not | Action |
|---|---|---|
| **CIN / national ID** | **[CONFIRM]** my understanding is that national-identifier processing may require **prior authorization** rather than declaration. It would also become the platform's most attractive breach target, and it serves **no purpose the platform acts on** | **DO NOT COLLECT** |
| **Date of birth** — *if collected only for duplicate matching* | Solves the problem badly (siblings, twins, data-entry error) and adds a precise identifier for every minor | **DO NOT COLLECT for that purpose.** See D.1 |
| **Biometrics** (face, fingerprint, voiceprint-as-identifier) | Special category; no purpose here | **DO NOT COLLECT** |
| **Religious affiliation or conviction** | Special category. **[INFER]** For a Quran institute this is *inferable from enrolment itself* — which is precisely why it must never be recorded as a field | **DO NOT COLLECT** |
| **Political opinions, ethnicity, trade-union membership** | Special category; no purpose | **DO NOT COLLECT** |
| **Geolocation** | No purpose | **DO NOT COLLECT** |
| **Photos/video of students** | Currently excluded by design **[CODE]**. Re-introducing needs `media_release` consent *and* a retention rule | **DO NOT COLLECT** without an explicit decision |
| **Parents' professions, siblings count** | Already present; no logic reads them | **DELETE** — see I.1 |
| **Free-text health details** | See A.2 | **LEGAL REVIEW before R62** |

## D.1 The duplicate-matching problem, restated as a privacy question

R62 needs to decide *"is this child already registered?"*. My earlier engineering
recommendation was an **admin-resolved match from proposed candidates**.

**That recommendation is also the privacy-correct one.** Adding a birth date for
every minor in order to automate a decision an administrator makes a handful of
times a year is disproportionate: it creates a permanent precise identifier for
hundreds of children to save a few minutes of staff time.

**[INFER] Recommendation: keep human-resolved matching. Do not add a birth
date for deduplication.** If a birth date is later wanted for a *different*
stated purpose — age-appropriate Level placement, for instance — that is a
separate decision, judged on its own merits.

---

# E. Processing-purpose matrix

Purposes should be declared **separately**, because they have different data,
audiences and retention. **[INFER]** — this structure is my proposal.

| # | Purpose | Data categories | Lawful basis **[CONFIRM]** | Retention **[CONFIRM]** |
|---|---|---|---|---|
| 1 | **Account & authentication** | Identity, Google subject, tokens | Contract / consent | Life of account |
| 2 | **Registration & membership** | Names, sex, phone, branch, application status | Contract / consent | Life + statutory period |
| 3 | **Parent–child relationship** | `FamilyLink`, guardian identity | Legal representation of a minor | Until majority or unlink |
| 4 | **Educational administration** | Level, group, subject, schedule | Contract | Academic year + archive |
| 5 | **Attendance** *(new)* | Presence per session | Contract | Academic year |
| 6 | **Assessment** | Grades, exam submissions | Contract | Academic record — long |
| 7 | **Quran progress** | Surah/ayah coverage | Contract | Academic record |
| 8 | **Communication** *(none built)* | Contact details, preferences | Consent | Until withdrawn |
| 9 | **Safeguarding** | Social profile, emergency contact | **[CONFIRM] — likely the most constrained** | Strictly limited |
| 10 | **Security & audit** | Actor, action, timestamp, no values | Legal obligation / legitimate interest | 12 months, security events longer |
| 11 | **File & document management** | Uploads, metadata | Contract / consent | Until deletion + 90 days |
| 12 | **Platform operation** | Technical logs | Legitimate interest | Short |

**[INFER] Purpose 9 (safeguarding) should be declared separately and narrowly.**
Bundling minors' health and family circumstances into "educational
administration" would understate what is held.

---

# F. Declaration vs authorization vs transfer — the questions to ask

**All [CONFIRM]. I am not answering these; I am framing them precisely.**

1. Does the free-text **`healthCondition`** field move this processing into a
   prior-authorization regime? *(The single most consequential question here.)*
2. Do **`familySituation`** and **`homeAddress`** for minors attract the same
   treatment?
3. Does **Google OAuth** — identity data leaving Morocco to a US provider —
   constitute a transfer requiring authorization, and does the CNDP recognise
   the destination as adequate? **[SRS] §2.2 mandates Moroccan hosting for
   personal data; authentication is the one flow that structurally leaves.**
4. Are **audio recordings of minors** ordinary personal data or something more?
5. What retention periods are **required or permitted** for a minor's
   educational record, and what must happen at majority?
6. Do parents have a **right to rectification/erasure** over a child's record
   that the platform must implement as a feature?
7. Must the **privacy notice** be provided in Arabic, and must consent be
   recorded per purpose rather than globally? *(The schema already supports
   per-purpose consent — `media_release` vs `data_processing`.)*
8. Is a **CNDP declaration already filed** for this association, and does it
   cover the purposes in E?

---

# G. Minor-specific risks

**G.1 — The platform is minor-heavy by design.** **[SRS]** Minors have no login;
they exist only as records reached through an approved parent. Every access path
is therefore an *authorization* path, and R62 widens it.

**G.2 — A child's `phone` must never be populated.** **[CODE]** The column
exists on `User` and applies to children as much as adults; nothing prevents it.
**[INFER] Recommend a constraint or a validated rule** that a `User` reached
only via `FamilyLink` carries no phone of their own.

**G.3 — free-text `notes` is collected about children at registration.**
**[CODE]** `registration.service.ts:282` writes `input.child.notes`, and the
registration form renders a notes field. It is `VarChar(2000)` — capped, but
capped at 2000 characters of *anything*, with no stated purpose and no business
logic reading it. This is where a diagnosis, a custody arrangement or a family
circumstance will eventually be written by someone acting entirely in good
faith, about a minor, in a field nobody classified.

**G.4 — Social-profile access is correct; its *contents* are the exposure.**
The safeguard is strong. The risk is that the fields invite recording more than
is needed.

**G.5 — R62 makes one parent's approval the gate to a child's whole record.**
`resolveActingStudent` is sound **[CODE]**, but the *approval* step becomes the
security boundary. A mis-approved link grants a stranger a child's full record.
**[INFER] The admin approval screen must show enough to make that decision
deliberately**, and every approval is already audited.

**G.6 — Multi-parent linking is undefined.** **[SRS]** silent; the schema
permits two parents linked to one child. In separation or custody disputes this
is a real safeguarding question. **Decision required.**

---

# H. Third-party and hosting risks

**H.1 — Google OAuth is the only foreign flow. [CODE]** Scope is
`openid email profile` — minimal, and no Google API is called beyond token
exchange. **[INFER]** Only adult/parent/staff accounts authenticate; **minors
never do**, so a child's identity does not reach Google. That is a meaningful
mitigation and should be stated in the declaration.

**H.2 — No analytics, no error tracking, no email provider, no AI service.
[CODE]** Verified absent. This is unusually clean and is worth *preserving as a
rule*: any addition is a new processor and a new transfer question.

**H.3 — Non-Moroccan tiers. [SRS]** §2.2 prohibits real data in all of them.
**Preview** (Vercel) stores nothing at all: it runs on MSW mocks and calls no
backend, so there is no transfer to assess.

**Staging** (Revision 104) is the one that changed, and it deserves naming
plainly: since 2026-08-25 there is a **real PostgreSQL database and a real MinIO
instance on a VPS in France**. That is a genuine non-Moroccan data store, and it
is permissible **only** because the tier is fixture-only. Three controls hold
that, and the first is mechanical:

1. **The fixtures seed refuses to run under `NODE_ENV=production`** — the same
   guard, in the other direction.
2. **Production dumps never leave Moroccan infrastructure**, and **the
   development database and its objects are never copied into Staging** — a
   developer's database is not fixture data (§20 rule 18).
3. Staging holds no credential that can reach a production database; it has its
   own generated secrets and its own storage.

**[INFER] The residual risk is procedural, not architectural**: nothing
mechanically stops a human running `pg_restore` of a production dump onto the
Staging VPS. The recommended control is unchanged in kind — a technical barrier
rather than only a rule — and it is now worth more, because Staging has a
database to restore *into*.

**H.4 — Backups are specified and Morocco-resident.** **[SRS]**
`operations/resilience.md` defines nightly `pg_dump` plus volume backups,
replicated **offsite to a second Moroccan location** via `restic` over SSH, RPO
≤ 24h, RTO < 1h, with a documented and periodically tested restore as a launch
requirement — and states explicitly that *"both locations are inside Morocco,
because backups are personal data and BR-18 makes no exception for them."*

**I initially recorded this as a gap and was wrong**; the policy exists and is
better than most. **[INFER] The remaining question is not location but
lifetime**: the document sets no *retention* period for backup copies, so a
record erased in production may persist in backups indefinitely. **[CONFIRM]**
how backup retention interacts with an erasure obligation.

---

# I. Missing privacy and security controls

| # | Gap | Severity | Recommendation |
|---|---|---|---|
| **I.1** | `siblingsCount`, `fatherProfession`, `motherProfession` — **verified stored and returned, never read by any logic** **[CODE]**; plus `User.notes` free text collected about children | **High** | Delete the three; give `notes` a stated purpose or remove it from the child form |
| **I.2** | **No automatic retention job runs.** `content.quarantine-purge` processes exact obligations but R59.4 keeps age-based destruction Owner-gated; R111's separate three-day account de-identification is ratified but absent from TD-7 and from the worker **[CODE]** | **High** | Deliberate Super Admin account/content purge works; the Document Owner must add the account queue to TD-7 before implementation, and separately decide automatic content destruction |
| **I.3** | Privacy and terms pages now exist and describe the implemented account-deletion boundary **[CODE]**; legal entity/registration/CNDP details remain visibly marked as required | **High** | Association/legal review must supply the marked launch details |
| **I.4** | **No data-subject access/export path** | Medium | A parent cannot obtain their child's record |
| **I.5** | Backup **retention** period unset — an erased record may survive in backups indefinitely | Medium | See H.4. The policy itself exists and is sound |
| **I.6** | **No emergency contact** | Medium | Safeguarding gap (C) |
| **I.7** | `data_processing` consent exists but is **not enforced as a gate** on registration **[CONFIRM]** | Medium | Verify the flow records it before processing begins |
| **I.8** | **No documented minimisation rule for audit `detail`** | Low | The good practice at `user.service.ts:425` should be a stated rule and a guard |

---

# J. Recommended registration forms

**Principle: collect what a defined purpose needs, at the moment it is needed.**

### Adult student
Required: first + last name (Arabic) · sex · phone · branch · `data_processing`
consent
Optional: name (French) · nickname
**Not collected:** CIN, birth date, address, profession, health

### Child (via parent)
Required: first + last name (Arabic) · sex · relationship to requester
Optional: nickname
**Not collected:** phone, CIN, birth date, address, health, siblings, parents'
professions
*Separately, with its own explicit consent:* `media_release`

### Parent
Required: first + last name (Arabic) · phone · `data_processing` consent
Optional: name (French) · preferred contact language
**Plus, for the child's safety:** emergency contact name + phone *(if not the
parent themselves)*

### Teacher / staff
Required: first + last name (Arabic) · phone · email (via Google) · branch
Optional: name (French) · nickname
**Not collected:** CIN, birth date, address, marital status, photo

---

# K. Proposed minimal-but-complete profile model

```
User
  identity      first/last Arabic · optional French · nickname · publicDisplayName
  contact       phone            (adults and staff only — never a child)
  attributes    sex              (§4.4b Level restriction)
  lifecycle     accountStatus · intendedBranchId
  ── removed ── notes

MinorSafeguarding                (renamed from StudentSocialProfile, narrowed)
  emergencyContactName · emergencyContactPhone · emergencyContactRelation
  accessibilityNeeds             (bounded enum + short note — NOT a diagnosis)
  ── removed ── siblingsCount, fatherProfession, motherProfession
  ── legal review ── healthCondition, familySituation, homeAddress

FamilyLink                       (unchanged — already the authorization record)
  + relationshipType             (mother | father | legal_guardian)
```

**[INFER]** `accessibilityNeeds` as a bounded enum plus a short note is the
proportionate way to serve the real teaching need — *"this child needs to sit at
the front"* — **without recording a medical diagnosis**. Whether it fully
replaces `healthCondition` is **[CONFIRM]**.

---

# L. Prioritised plan

**Before R62 — blocking**
1. **[CONFIRM]** Legal review of `healthCondition`, `familySituation`,
   `homeAddress` for minors. This determines the regime.
2. Decide the three no-purpose fields (I.1) — my recommendation: delete.
3. Write the privacy notice (I.3), Arabic, per purpose.
4. Confirm the CNDP declaration status and whether E's purposes are covered.

**With R62**
5. Human-resolved duplicate matching; **no birth date** (D.1).
6. `relationshipType` on `FamilyLink`.
7. Decide multi-parent linking (G.6).
8. Emergency contact for minors (C, I.6).

**Soon after**
9. Build the retention job (I.2) — currently nothing is ever deleted.
10. Data-subject export (I.4).
11. Backup **retention** period, and how erasure propagates to backups (H.4, I.5).
12. Constraint preventing a child's `phone` (G.2).
13. Audit-detail minimisation rule + guard (I.8).

---

## What I did not do

I did not interpret Moroccan law, cite articles, or conclude whether this
processing needs declaration or authorization. Every such point is **[CONFIRM]**
and needs the CNDP or a Moroccan privacy lawyer. What I can state with
confidence is what the system holds, where it goes, who reads it, and which
fields serve no purpose — and those are in A, D and I.
