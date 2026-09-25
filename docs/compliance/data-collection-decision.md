[Documentation](../README.md) › [Compliance](personal-data-audit.md) › **Data-collection decision**

# Data-Collection Decision Document

- Date 2026-08-11 · companion to the [personal-data audit](personal-data-audit.md) · followed by the [R62 design decisions](r62-design-decisions.md) · for the Owner's decision; nothing implemented, R62 paused at the time.
- SUPERSEDED IN PART: this proposed *narrowing* the case file (`StudentSupport` / `MinorSafeguarding`); on 2026-09-02 the Owner withdrew it entirely (R120: no surface ever collected it; no categories not operationally needed). The platform collects no health, medical or social-case-file data; proposals on `healthCondition`, `familySituation`, `homeAddress`, `siblingsCount`, parents' names/professions are moot, kept as the reasoning trail.
- Tags: **[SRS]** · **[CODE]** verified · **[INFER]** reasoning · **[CONFIRM]** needs the CNDP or a Moroccan privacy lawyer.
- Premise rejected: "we are filing anyway, so collect everything useful now". A declaration describes processing, it does not authorise collection (proportionality per field per purpose, [CONFIRM]); every field is a permanent liability (backups, exports, audit, breaches); adding a field later is cheap here (forward-only migrations), removing a populated one is not. Default: collect what a defined purpose consumes today.

## 1. The four profiles

**1.1 Adult student** — not collected: CIN, date of birth, address, profession, marital status, photo, emergency contact (an adult is her own contact).

| Field | Necessary or useful? | Reads | Risk | Retention | Verdict |
|---|---|---|---|---|---|
| First + last name (Arabic) | Necessary | staff, self | Ordinary | Life of record | A — KEEP |
| `sex` | Necessary [SRS] §4.4b, enforced | staff | [CONFIRM] B.1 | Life | B — KEEP |
| `phone` | Necessary; the only contact channel [CODE] (no email/SMS built) | staff, self | Ordinary | Life | A — KEEP |
| Name (French) | Useful; bilingual certificates | staff, self | Ordinary | Life | A — OPTIONAL |
| `nickname` | Useful | staff, self | Ordinary | Life | A — OPTIONAL |
| Branch (intended) | Necessary; routes the application | staff | Ordinary | Until decided | A — KEEP |
| `data_processing` consent | Necessary | staff, self | — | Indefinite | A — KEEP |

**1.2 Minor student** — the narrowest profile.

| Field | Necessary or useful? | Reads | Risk | Retention | Verdict |
|---|---|---|---|---|---|
| First + last name (Arabic) | Necessary | staff, linked parent | Minor's data | Life of record | A — KEEP |
| `sex` | Necessary [SRS] §4.4b | staff | [CONFIRM] B.1 | Life | B — KEEP |
| `nickname` | Useful; teachers use it | staff, linked parent | Ordinary | Life | A — OPTIONAL |
| Student reference code | Necessary (§3) | staff, linked parent | None; no personal data | Life | A — ADD |
| Guardian relationship type | Necessary; who may act | staff | Ordinary | Life of link | A — ADD |
| Emergency contact (name, phone, relation) | Necessary; safeguarding | staff | Third-party data | Life | B — ADD (2.4) |
| `phone` | Never | — | — | — | C — must be impossible (B.4) |
| Date of birth | §2.1 | — | — | — | REJECT |
| Home address | B.2 | — | — | — | B — LEGAL REVIEW |

**1.3 Parent / legal guardian** — the platform holds a *claim* of guardianship, not proof; [CONFIRM] whether documentation must be verified and a check recorded (a boolean and date, never a scan).

| Field | Necessary or useful? | Reads | Risk | Retention | Verdict |
|---|---|---|---|---|---|
| First + last name (Arabic) | Necessary | staff, self | Ordinary | Life | A — KEEP |
| `phone` | Necessary; contact of record for a minor | staff, self | Ordinary | Life | A — KEEP |
| Google identity (email) | Necessary; the login [SRS] | server | Ordinary | Life | A — KEEP |
| Relationship to each child | Necessary; mother / father / legal guardian | staff | Ordinary | Life of link | A — ADD |
| Name (French) | Useful | staff, self | Ordinary | Life | A — OPTIONAL |
| Preferred contact language | Useful once a messaging channel exists | staff | Ordinary | Life | A — DEFER |
| Profession | No purpose | — | Socio-economic profiling | — | C — DO NOT COLLECT |
| CIN | No purpose | — | C.1 | — | C — DO NOT COLLECT |

**1.4 Staff / teacher** — HR data (contracts, diplomas, salary, CIN) is a different processing, audience and retention; keep the staff profile to what teaching needs.

| Field | Necessary or useful? | Reads | Risk | Retention | Verdict |
|---|---|---|---|---|---|
| First + last name (Arabic) | Necessary | staff, self | Ordinary | Employment + statutory | A — KEEP |
| `phone` | Necessary; operational contact | staff, self | Ordinary | Employment | A — KEEP |
| Google identity | Necessary; the login | server | Ordinary | Employment | A — KEEP |
| `preProvisionedEmail` | Necessary [SRS] §4.1b | staff | Ordinary | Life | A — KEEP |
| Branch assignment | Necessary; authorization scope | staff | Ordinary | Employment | A — KEEP |
| `sex` | Useful if §4.4b applies to staffing female-only Levels [CONFIRM] | staff | [CONFIRM] | Employment | B — CONFIRM |
| Qualifications, CV, diplomas | Useful to the association | — | Employment data | — | B — OUT OF SCOPE |
| CIN | No purpose here | — | C.1 | — | C — DO NOT COLLECT |

## 2. The proposed fields

- **2.1 Date of birth — revised after the Owner's clarification (2026-08-11).** The earlier REJECT ("no code consumes an age") was incomplete: the purpose lived in practice. The programs map approximately to schooling stage (الطفل: a year before primary through primary; اليافعون: middle and high school; الكبار: after high school); age is only approximate (an older girl still in high school may join the teens program, or when the admin considers it appropriate); placement stays administrative. Collect the signal, not the proxy: `schoolingStage` enum `pre_primary · primary · middle · high · post_secondary · not_in_school` — answers "which program" directly, handles the edge case, low identifying power, no civil-registry lookup, ages out naturally. [CODE] `Category` was chosen freely at registration with no supporting information. Birth year only if stage proves insufficient, never pre-emptively. Full date of birth: superseded for placement; rejected for deduplication (siblings, twins, typos; §3); [CONFIRM] certificates, the one open purpose.
- **2.2 Birth city — REJECT**: no purpose; combined with a name it is strongly identifying (civil-status documents).
- **2.3 Home address — LEGAL REVIEW (B)**: locates a minor; transport planning and home visits do not exist [CODE]; not for minors absent a stated need, and then held against the family.
- **2.4 Emergency contact — ADD (B)**: the one genuine gap; name, phone, relationship; minors only; default to the linked parent, collect a second contact only when offered; [CONFIRM] notice owed to the contact person.
- **2.5 Accessibility needs — ADD, redesigned (B)**: replaces `healthCondition` with an accommodation, not a diagnosis: `accessibilityNeeds enum[] seating · extra_time · large_print · hearing_support · mobility_access · other`; `accessibilityNote VarChar(200)` labelled "what helps this student learn"; discourages, does not prevent, a medical entry — [CONFIRM] whether it suffices.
- **2.6 Schooling stage — REVERSED: ADD** (§2.1); the error: judging purpose by what the code consumed; a purpose in staff practice is still a purpose.
- **2.7 Phone — KEEP for adults, forbid for minors** (B.4).

## 3. Distinguishing children with the same name (two «محمد العلوي» in one branch)
- 3.1 The parent is the discriminator [CODE]: a minor exists only through a `FamilyLink`, so screens show «محمد العلوي — ابن فاطمة الزهراء»; zero cost.
- 3.2 A student reference code (e.g. `ط-4821`): a pronounceable row id, no personal data, printable, speakable in public; adopt.
- 3.3 Birth year, one integer, only if 3.1 and 3.2 prove insufficient. Rejected: a national identifier or birth date for every child.

## 4. Verdicts on the existing fields

| Field | Finding | Verdict |
|---|---|---|
| `siblings_count` | [CODE] stored, returned in a DTO, read by no business logic | REMOVE |
| `father_profession` | Same; socio-economic profiling | REMOVE |
| `mother_profession` | Same | REMOVE |
| `father_name`, `mother_name` | Redundant with `FamilyLink` (approval trail); free-text claims about third parties | REDESIGN: derive from `FamilyLink`; a field only for a parent with no account |
| `User.notes` (2000 chars) | [CODE] collected about children at registration; no purpose; where a diagnosis or custody note will be written in good faith | REDESIGN: remove from the child form; on staff records rename to a purpose or delete |
| `healthCondition` | 2.5 | REPLACE with accessibility needs [CONFIRM] |
| `familySituation` | Unbounded free text about a minor's family; the need is real, the design is not | LEGAL REVIEW before R62 |
| `homeAddress` | 2.3 | LEGAL REVIEW |

- Removing the three no-purpose fields is a forward-only migration plus a decision on existing values; [CONFIRM] whether backups holding them must be addressed.

## 5. The three tiers
- **A — ordinary, proportionate, collect:** names (Arabic, optionally French) · nickname · phone (adults and staff) · branch · Google identity · educational stage, Levels, groups · attendance (when built) · grades · Quran progress · consent records · student reference code · guardian relationship type.
- **B — collect with care:** `sex` [CONFIRM] (necessary for §4.4b, a protected characteristic) · emergency contact (third-party data) · accessibility needs (never a diagnosis) · audio recordings of minors [CONFIRM] · `familySituation` and `homeAddress` (legal review before R62) · staff `sex` [CONFIRM].
- **C — not without explicit legal validation:** CIN / national ID · full date of birth · birth city · biometrics · religious affiliation or conviction · political opinion, ethnicity, union membership · free-text health conditions · parents' professions · geolocation · photos and video of students · a child's own phone · staff HR records (CV, diplomas, salary, contract).
- C.1 CIN: [CONFIRM] may attract prior authorization; serves no purpose the platform acts on; makes the database a more attractive target; never, unless a law obliges the association — and then in the system holding that obligation.

## 6. The recommended model
- `User`: `firstNameArabic`, `lastNameArabic` required; `firstNameFrench`, `lastNameFrench`, `nickname` optional; `publicDisplayName` derived (§20 r21); `sex` (§4.4b, [CONFIRM]); `phone` adults and staff only; `referenceCode` new, generated, no personal data; `accountStatus`, `intendedBranchId`; `preProvisionedEmail` staff only; `notes` removed.
- `FamilyLink` (the authorization record) + `relationshipType` mother | father | legal_guardian; + `guardianshipVerifiedAt` [CONFIRM], a date, never a document.
- `StudentSupport` (replaces `StudentSocialProfile`, narrowed — the name is the cheapest control): `emergencyContactName/Phone/Relation`; `accessibilityNeeds enum[]`; `accessibilityNote VarChar(200)`; removed `siblingsCount`, `fatherProfession`, `motherProfession`, `fatherName`, `motherName`; legal review `familySituation`, `homeAddress`, `healthCondition`.

## 7. Decisions required before R62

| # | Decision | Blocking? | Recommendation |
|---|---|---|---|
| 1 | `healthCondition`, `familySituation`, `homeAddress` for minors: legal review | Yes | Replace the first with accessibility needs; drop the other two absent a stated need |
| 2 | Remove `siblings_count`, `father_profession`, `mother_profession` | Yes (R62 touches the table) | Remove |
| 3 | Remove free-text `notes` from the child form | Yes | Remove |
| 4 | Adopt the student reference code | Yes (the answer to child identification) | Adopt |
| 5 | Emergency contact for minors | No, but soon | Add |
| 6 | `relationshipType` on `FamilyLink` | Yes (R62 creates the rows) | Add |
| 7 | Date of birth | Yes (settle it) | Do not collect |
| 8 | Multi-parent linking | Yes (R62 defines the workflow) | Decide explicitly |
| 9 | Is a CNDP declaration filed covering the twelve purposes? | Yes | — |
| 10 | Arabic per-purpose privacy notice | Yes (R62 widens collection) | Write before R62 ships |
| 11 | Staff HR data in this platform | No | Keep out |
| 12 | Backup retention vs erasure | No | Settle after R62 |

- Not concluded: declaration vs authorization, whether `sex` is a protected characteristic under Moroccan law, legally required retention for a minor's record — all [CONFIRM]. Stated: which fields the code consumes, which are dead weight, which designs invite over-collection (§2, §4, §6).
