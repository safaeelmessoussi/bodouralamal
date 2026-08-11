[Documentation](../README.md) › [Compliance](personal-data-audit.md) › **Data-collection decision**

# Data-Collection Decision Document

**Date:** 2026-08-11 · **Companion to:** [the personal-data audit](personal-data-audit.md)
**Status:** for the Document Owner's decision. Nothing implemented; R62 still paused.

Tags carry the same meaning as in the audit: **[SRS]** the specification says
so · **[CODE]** verified in the codebase · **[INFER]** my reasoning · **[CONFIRM]**
needs the CNDP or a Moroccan privacy lawyer.

---

## The premise this document argues against

> *"We are completing the CNDP formalities anyway, so let us collect everything
> useful now rather than adding fields later."*

The instinct — decide once, properly, at the start — is right, and this document
serves it. But the conclusion does not follow, for three reasons that are
engineering facts rather than legal opinions:

1. **A declaration describes processing; it does not authorise collection.**
   Proportionality is assessed per field, per purpose. **[CONFIRM]**
2. **Every field is a permanent liability.** It appears in backups, exports,
   audit trails and breaches. A field never collected needs no retention rule,
   no access control, and no erasure path.
3. **Adding a field later is cheap here.** **[CODE]** This codebase has added
   columns repeatedly with forward-only migrations, no data loss, and a
   revision each time. *Removing* a field once populated is the expensive
   direction — the data already exists in backups.

**[INFER] So the correct default is: collect what a defined purpose consumes
today, and design the schema so tomorrow's field is easy to add.** That is a
different discipline from collecting everything now, and it costs less.

---

# 1. The four profiles

## 1.1 Adult student

| Field | Necessary or useful? | Who reads it | Risk | Retention | Verdict |
|---|---|---|---|---|---|
| First + last name (Arabic) | **Necessary** — identifies the person | staff, self | Ordinary | Life of record | **A — KEEP** |
| `sex` | **Necessary** **[SRS]** — §4.4b Level restriction is a real rule the code enforces | staff | **[CONFIRM]** — see B.1 | Life | **B — KEEP** |
| `phone` | **Necessary** — the only contact channel that exists **[CODE]** (no email or SMS system is built) | staff, self | Ordinary | Life | **A — KEEP** |
| Name (French) | Useful — bilingual certificates | staff, self | Ordinary | Life | **A — OPTIONAL** |
| `nickname` | Useful — what a person is actually called | staff, self | Ordinary | Life | **A — OPTIONAL** |
| Branch (intended) | **Necessary** — routes the application | staff | Ordinary | Until decided | **A — KEEP** |
| `data_processing` consent | **Necessary** | staff, self | — | Indefinite | **A — KEEP** |

**Not collected:** CIN, date of birth, address, profession, marital status,
photo, emergency contact *(an adult is their own emergency contact; see 2.4)*.

## 1.2 Minor student

The narrowest profile in the platform, deliberately.

| Field | Necessary or useful? | Who reads it | Risk | Retention | Verdict |
|---|---|---|---|---|---|
| First + last name (Arabic) | **Necessary** | staff, linked parent | Minor's data | Life of record | **A — KEEP** |
| `sex` | **Necessary** **[SRS]** §4.4b | staff | **[CONFIRM]** B.1 | Life | **B — KEEP** |
| `nickname` | Useful — teachers call children by it | staff, linked parent | Ordinary | Life | **A — OPTIONAL** |
| **Student reference code** | **Necessary** — see §3 | staff, linked parent | **None — carries no personal data** | Life | **A — ADD** |
| Guardian relationship type | **Necessary** — who may act for this child | staff | Ordinary | Life of link | **A — ADD** |
| **Emergency contact** (name, phone, relation) | **Necessary** — safeguarding | staff | Third-party data | Life | **B — ADD**, see 2.4 |
| **`phone`** | **Never** | — | — | — | **C — must be impossible**, see B.4 |
| Date of birth | See §2.1 | — | — | — | **REJECT** |
| Home address | See B.2 | — | — | — | **B — LEGAL REVIEW** |

## 1.3 Parent / legal guardian

| Field | Necessary or useful? | Who reads it | Risk | Retention | Verdict |
|---|---|---|---|---|---|
| First + last name (Arabic) | **Necessary** | staff, self | Ordinary | Life | **A — KEEP** |
| `phone` | **Necessary** — the contact of record for a minor | staff, self | Ordinary | Life | **A — KEEP** |
| Google identity (email) | **Necessary** — the login **[SRS]** | server | Ordinary | Life | **A — KEEP** |
| Relationship to each child | **Necessary** — mother / father / legal guardian | staff | Ordinary | Life of link | **A — ADD** |
| Name (French) | Useful | staff, self | Ordinary | Life | **A — OPTIONAL** |
| Preferred contact language | Useful *once a messaging channel exists* | staff | Ordinary | Life | **A — DEFER** |
| Profession | **No purpose** | — | Socio-economic profiling | — | **C — DO NOT COLLECT** |
| CIN | **No purpose** | — | See C.1 | — | **C — DO NOT COLLECT** |

**[INFER] A note on "legal guardian".** The platform will hold a *claim* of
guardianship, not proof of it. **[CONFIRM]** whether the association must verify
guardianship documentation, and whether the platform must record that a check
occurred *(a boolean and a date — not a scan of the document)*.

## 1.4 Staff / teacher

| Field | Necessary or useful? | Who reads it | Risk | Retention | Verdict |
|---|---|---|---|---|---|
| First + last name (Arabic) | **Necessary** | staff, self | Ordinary | Employment + statutory | **A — KEEP** |
| `phone` | **Necessary** — operational contact | staff, self | Ordinary | Employment | **A — KEEP** |
| Google identity | **Necessary** — the login | server | Ordinary | Employment | **A — KEEP** |
| `preProvisionedEmail` | **Necessary** **[SRS]** §4.1b account claiming | staff | Ordinary | Life | **A — KEEP** |
| Branch assignment | **Necessary** — the authorization scope | staff | Ordinary | Employment | **A — KEEP** |
| `sex` | Useful — §4.4b applies to staffing female-only Levels **[CONFIRM]** whether it does | staff | **[CONFIRM]** | Employment | **B — CONFIRM** |
| Qualifications, CV, diplomas | Useful to the association | — | Employment data | — | **B — OUT OF SCOPE**, see below |
| CIN | **No purpose in this platform** | — | C.1 | — | **C — DO NOT COLLECT** |

**[INFER] HR data does not belong in this platform.** Contracts, diplomas,
salary and CIN are employment processing with a different purpose, a different
audience and a different retention period. Putting them here would merge two
processings into one system and one breach radius. **Recommend: keep the
platform's staff profile to what *teaching* needs.**

---

# 2. The proposed fields, judged individually

## 2.1 Date of birth — **REJECT**

**[CODE] This is the decisive finding.** The educational stage
(الكبار / اليافعون / الطفل) is **chosen at registration**, never derived:
`registration.service.ts:188` takes `category_id` from the applicant, validates
it exists, and stores it. **No code path computes or consumes an age.**

So a birth date would be collected for a purpose the platform does not have.

* **For deduplication** — disproportionate, and it does not even work: siblings,
  twins and data-entry errors defeat it. See §3 for what does work.
* **For age-appropriate placement** — that feature does not exist. If you want
  it, **a birth *year* is sufficient** to warn *"this child is 7 and you selected
  الكبار"*, and a year is far less identifying than a full date.
* **For certificates** — **[CONFIRM]** if certificates must state a birth date,
  that is a genuine purpose and changes this answer.

**[INFER] Recommendation: do not collect. Revisit only with a stated purpose,
and then prefer birth year.**

## 2.2 Birth city — **REJECT**

No purpose in the platform. **[INFER]** It appears on Moroccan identity and
civil-status documents, so in combination with a name it is strongly
identifying while serving nothing here.

## 2.3 Home address — **LEGAL REVIEW (B)**

Already present on `StudentSocialProfile`. It **locates a minor**. The only
purposes I can construct are transport planning and home visits — **neither
exists in the platform** **[CODE]**.

**[INFER] Recommendation: do not collect for minors** unless the association
has a stated operational need, and then hold it against *the family* rather than
the child.

## 2.4 Emergency contact — **ADD (B)**

The one genuine gap. **[CODE]** A platform holding minors' records with no way
to reach an adult in an incident is a safeguarding weakness, not a privacy
virtue.

* Three fields: name, phone, relationship.
* **For minors only.** An adult student is their own contact.
* **[INFER]** Default it to the linked parent, so most families enter nothing.
  Collect a *second* contact only where the family offers one.
* Third-party personal data — **[CONFIRM]** what notice the contact person is
  owed when a parent supplies their number.

## 2.5 Accessibility needs — **ADD, redesigned (B)**

**[INFER] This is the field that should replace `healthCondition`.**

The real teaching need is *"this child needs to sit at the front"* or *"give her
extra time"*. That is an **educational accommodation**, not a diagnosis. A free
text box invites the diagnosis; a bounded list does not.

```
accessibilityNeeds : enum[]   seating · extra_time · large_print ·
                              hearing_support · mobility_access · other
accessibilityNote  : VarChar(200)   — an accommodation, never a condition
```

**[INFER]** 200 characters and a label saying *"what helps this student learn"*
is a design that discourages a medical entry. It does not prevent one, which is
why **[CONFIRM]** is still needed on whether this suffices.

## 2.6 Education level (prior schooling) — **REJECT**

No purpose. The platform's own Levels are assigned by staff at approval **[SRS]**.

## 2.7 Phone — **KEEP for adults, forbid for minors**

See B.4.

---

# 3. Distinguishing children with the same name

The problem is real: two «محمد العلوي» in one branch. The wrong answer is a
national identifier or a birth date for every child.

**[INFER] Three mechanisms, in order of preference — the first two cost no new
personal data at all.**

### 3.1 The parent is already the discriminator

**[CODE]** A minor exists *only* through a `FamilyLink`. Every screen that shows
a child can show *«محمد العلوي — ابن فاطمة الزهراء»*. Two same-named children
sharing the same parent is vanishingly rare, and if it happens the family knows
which is which.

**Cost: zero.** The data is already held for another purpose.

### 3.2 A student reference code

A short, human-readable, platform-generated identifier — `ط-4821`.

* **Carries no personal data.** It is a row id made pronounceable.
* Solves the desk problem, the phone-call problem and the paper-list problem.
* Printable on a card; a parent can quote it without stating a name aloud.
* **[INFER]** This is what institutions actually use, and it is *more* privacy-
  protective than a name, because it can be spoken in public.

**Recommendation: adopt.** It is the single best value-for-risk field in this
document.

### 3.3 Birth year — only if 3.1 and 3.2 prove insufficient

One integer. Distinguishes peers, is useless for identity theft, and cannot be
used to look someone up in a civil registry.

**[INFER] Do not add it pre-emptively.** Ship 3.1 and 3.2, and add this only if
staff report a real collision the first two could not resolve.

---

# 4. Verdicts on the existing fields

| Field | Finding | Verdict |
|---|---|---|
| `siblings_count` | **[CODE]** stored, returned in a DTO, **read by no business logic**. Collection without purpose | **REMOVE** |
| `father_profession` | Same. Socio-economic profiling with no consumer | **REMOVE** |
| `mother_profession` | Same | **REMOVE** |
| `father_name`, `mother_name` | Partly redundant — `FamilyLink` already names the parent, with an approval trail. These are free-text *claims* about third parties | **REDESIGN** — derive from `FamilyLink`; keep a field only for a parent who has no account |
| `User.notes` (free text, 2000 chars) | **[CODE]** collected about **children** at registration; no stated purpose; staff-visible. This is where a diagnosis or a custody arrangement will be written in good faith | **REDESIGN** — remove from the child form; on staff records rename to a purpose-named field or delete |
| `healthCondition` | See 2.5 | **REPLACE** with accessibility needs — **[CONFIRM]** |
| `familySituation` | Unbounded free text about a minor's family. **[INFER]** The safeguarding need is real; the design is not — this will hold judicial and social data nobody classified | **LEGAL REVIEW** before R62 |
| `homeAddress` | See 2.3 | **LEGAL REVIEW** |

**[INFER] On removing the three no-purpose fields:** they are already deployed.
Removal is a forward-only migration plus a decision about existing values — and
**[CONFIRM]** whether the backups holding them must also be addressed.

---

# 5. The three tiers

### A — Ordinary personal data, proportionate, collect
Names (Arabic, optionally French) · nickname · phone *(adults and staff)* ·
branch · Google identity · educational stage, Levels, groups · attendance
*(when built)* · grades · Quran progress · consent records · **student reference
code** · **guardian relationship type**

### B — Needs particular attention, collect with care
`sex` **[CONFIRM]** — necessary for §4.4b, but a protected characteristic ·
**emergency contact** — third-party data · **accessibility needs** — must not
become a diagnosis · audio recordings of minors **[CONFIRM]** · `familySituation`
and `homeAddress` — **legal review before R62** · staff `sex` **[CONFIRM]**

### C — Do not collect without explicit legal validation
CIN / national ID · full date of birth · birth city · biometrics · religious
affiliation or conviction · political opinion, ethnicity, union membership ·
health conditions and diagnoses as free text · parents' professions ·
geolocation · photos and video of students · a child's own phone · staff HR
records (CV, diplomas, salary, contract)

**C.1 — On CIN specifically.** **[CONFIRM]** my understanding is that processing
the national identity number may attract **prior authorization** rather than
ordinary declaration. Independently of that: it serves **no purpose this
platform acts on**, and it would make the database materially more attractive to
attack. **Recommendation: never, unless a law obliges the association to record
it — and then in the system that has that obligation, not this one.**

---

# 6. The recommended model

```
User
  firstNameArabic, lastNameArabic          required
  firstNameFrench, lastNameFrench          optional
  nickname                                 optional
  publicDisplayName                        derived (§20 r21)
  sex                                      §4.4b            [CONFIRM]
  phone                                    adults and staff ONLY
  referenceCode                            NEW — generated, no personal data
  accountStatus, intendedBranchId          lifecycle
  preProvisionedEmail                      staff only
  ── REMOVED ── notes

FamilyLink                                  the authorization record
  + relationshipType                       mother | father | legal_guardian
  + guardianshipVerifiedAt                 [CONFIRM] — a date, never a document

StudentSupport            (replaces StudentSocialProfile, narrowed)
  emergencyContactName, emergencyContactPhone, emergencyContactRelation
  accessibilityNeeds  enum[]
  accessibilityNote   VarChar(200)
  ── REMOVED ── siblingsCount, fatherProfession, motherProfession,
                fatherName, motherName
  ── LEGAL REVIEW ── familySituation, homeAddress, healthCondition
```

**[INFER] Renaming the table matters.** *Social profile* invites social-work
content. *Student support* names what the association actually does with it, and
a name is the cheapest control a schema has.

---

# 7. Decisions required before R62

| # | Decision | Blocking? | My recommendation |
|---|---|---|---|
| 1 | `healthCondition`, `familySituation`, `homeAddress` for minors — legal review | **Yes** | Replace the first with accessibility needs; drop the other two unless a stated operational need exists |
| 2 | Remove `siblings_count`, `father_profession`, `mother_profession` | **Yes** — R62 touches this table | Remove |
| 3 | Remove free-text `notes` from the child registration form | **Yes** | Remove |
| 4 | Adopt the **student reference code** | **Yes** — it is the answer to child identification | Adopt |
| 5 | Add **emergency contact** for minors | No, but soon | Add |
| 6 | Add `relationshipType` to `FamilyLink` | **Yes** — R62 creates these rows | Add |
| 7 | Date of birth | **Yes** — settle it so it is not revisited | Do not collect |
| 8 | Multi-parent linking | **Yes** — R62 defines the workflow | Decide explicitly |
| 9 | Is a CNDP declaration filed, and does it cover the twelve purposes? | **Yes** | — |
| 10 | Privacy notice, in Arabic, per purpose | **Yes** — R62 widens collection | Write before R62 ships |
| 11 | Staff HR data in this platform | No | Keep out |
| 12 | Backup retention vs erasure | No | Settle after R62 |

---

## What I am not telling you

I have not concluded whether any of this needs declaration or authorization,
whether `sex` is a protected characteristic under Moroccan law, or what
retention the law requires for a minor's educational record. Those are
**[CONFIRM]** and belong to the CNDP or a Moroccan privacy lawyer.

What I can tell you with confidence is which fields the code actually consumes,
which are dead weight, and which design choices make an over-collection likely
later. Those are §2, §4 and §6.
