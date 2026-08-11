# SRS Revision 62 — proposal

**Title:** Parent and child registration — one request, many children, decided
one child at a time

**Status:** drafted for the Document Owner. **Not applied.**
**Amends:** TD-4.2 · §4.1b step 5 · §4.3 · §5.3 · §5.4 · §7 · §14.1
**Decision trail:** [audit](compliance/personal-data-audit.md) →
[data-collection](compliance/data-collection-decision.md) →
[design decisions](compliance/r62-design-decisions.md)

---

## 62.0 — What this revision is, and the discipline it was drafted under

A parent registers one or more children in **one request**; an administrator
decides **each child independently**; the `parent` role appears once the first
child is approved; and the parent reaches that child through the role switcher
into the **existing Student Dashboard** — there is no Parent Dashboard.

**The data model grows by one table, four columns and two enums** — plus the
four consent fields 62.3b requires on the new table. Everything
else this revision does is *narrowing* a rule the specification already carries,
or *writing down* something the model already permits and the document never
said.

**Compliance posture, recorded here because it governs what follows.** The CNDP
declaration has **not** been filed. The Document Owner's plan is to reach the
MVP, maintain the compliance register as decisions are taken, and prepare the
declaration from what the finished system actually processes.

That order is workable **only** with the discipline it implies, which this
revision follows and which future revisions must too:

* **No field is justified by *"we will declare it later."*** Each is judged on
  whether a defined purpose consumes it.
* **Compliance-sensitive decisions are recorded when taken**, not reconstructed
  afterwards. The register lives in `docs/compliance/`.
* **No legal answer is assumed.** Where this revision does not know, it says so
  and builds nothing on the guess.

---

## 62.1 — `ChildApplication` (new)

One row per child in a request; the envelope groups siblings.

```
ChildApplication
  id
  requestId                 groups children submitted together
  parentId                  the requesting adult — applicant or existing account
  childUserId               NULL until approved
  firstNameArabic, lastNameArabic, sex
  schoolingStage            see 62.6
  status                    pending | approved | rejected      ← PER CHILD
  matchedExistingUserId     NULL, or the account the admin chose to link
  rejectionReason           enum, see 62.8
  internalNote              staff-only, never returned to a parent
  consent*                  see 62.3b — captured at submission
  decidedAt, decidedById
  createdAt, deletedAt, deletedById
```

**Why the child `User` is not created up front.** Today's parent+child
registration creates the child immediately, which is exactly what forces the
all-or-nothing bundle: a rejected child would otherwise leave an orphan account.
Deferring creation to approval is what makes per-child decisions clean, and it
means **a rejected child leaves no `User` row and no `FamilyLink` at all**.

---

## 62.2 — TD-4.2 narrowed: atomicity is per child

TD-4.2 currently makes approval atomic across **the applicant and every pending
child**. It becomes atomic across **the applicant and one child**:

> Approving one child application creates or links that child's `User`, creates
> the `FamilyLink(approved)`, grants the `parent` role if the parent does not
> hold it, and writes the audit row — in **one transaction**. Other children in
> the same request are unaffected.

**The parent's own application is decided explicitly and separately** (Owner
decision). It is never inferred from the children's outcomes. A parent may be
approved with every child refused, or refused with children approved.

**Safety property, and it is free rather than enforced:** a rejected child has
no `FamilyLink`, so partial approval cannot expose one. There is nothing to
leak through.

---

## 62.3 — Duplicate children: an administrative decision, never automatic

When an application names a child who may already exist, the server **proposes
candidates** and the administrator chooses *link this account* or *create a new
record*. **The platform never merges automatically.**

**The reason is not convenience.** There is no natural key for a child — no
national identifier, and (by 62.6) no date of birth. Matching on names alone
would eventually attach a child to the wrong family, which is a safeguarding
failure that no audit row undoes.

**Candidates are shown as name + linked parent + reference code**, which is what
lets an administrator tell two same-named children apart without the platform
holding a precise identifier for either.

---

## 62.3b — Consent, when the child does not exist yet

**This clause exists because auditing the draft found that 62.1 breaks the
consent flow, and the break is silent.**

**[CODE] Today** `registration.service.ts` writes `ConsentRecord` rows for the
child in the same transaction as the child `User` — `studentId: child.id`. If
the child is created at *approval* (62.1), there is **no student id at
submission**, and a naive implementation would either lose the consent or
record it against the wrong person.

**The parent gives consent at submission. It must be recorded then, and
materialised later.**

`ChildApplication` therefore carries the consent **decisions** as given:

```
consentDataProcessing   Boolean          required — refusal blocks submission
consentMediaRelease     Boolean          granted or refused, per child
consentTextVersion      String           the version in force AT SUBMISSION
consentGivenAt          DateTime         when the parent actually agreed
```

At approval, the `ConsentRecord` rows are created for the now-existing child
with **the submission's values, not the approval's**:

* `granted_at` = `consentGivenAt` — the moment consent was given;
* `consent_text_version` = the captured version;
* `granted_by_user_id` = the parent.

**Why the captured version is normative rather than a detail.** **[CODE]**
`legal.consent_text_version` is a Super-Admin-editable `SystemSetting`. If it
changes between submission and approval, materialising with the *current*
version would record that a parent consented to text **they never saw**. §4.1a
requires the exact text version agreed to; taking today's value would make that
record false.

**Consent is per child.** A parent may permit photographs of one child and
refuse for another, so `media_release` is captured on each `ChildApplication`
rather than once per request.

**A rejected application creates no `ConsentRecord`** — there is no student to
hold one. The application retains what was given, as part of the audit record of
what was decided.

---

## 62.4 — `FamilyLink.relationshipType`

```
relationshipType : mother | father | legal_guardian
```

Three values, **no free text and no `other`**. The platform asks one question —
*may this person act for this child* — and a grandparent who acts legally *is* a
legal guardian. Finer gradation would record family structure that nothing
consumes, which is the pattern this revision's companion documents removed
elsewhere.

**Multi-parent linking is permitted, and this revision states it** because the
model has always allowed it and the specification never said so. Uniqueness is on
the **pair** `(parent, child)`, never on the child. Two approved links are two
independent authorizations, each separately approved and separately revocable,
and `ConsentRecord.granted_by_user_id` already records *which* parent consented.

Refusing multi-parent would be worse for safeguarding than allowing it: the
second adult would use the first one's login, and the audit trail would then
attribute their actions to the wrong person.

**Guardianship verification is NOT designed here.** Whether the association must
verify guardianship documents, and whether the platform must record that a check
occurred, is **pending legal/CNDP confirmation**. Nothing in this revision
assumes an answer. If verification is later required it adds one date column —
never a stored document.

---

## 62.5 — `User.referenceCode`

A short, stable, **non-personal** identifier for every student.

| Property | Rule |
|---|---|
| Who | Students — adult and minor. Not staff |
| Generation | **Random** from a large space, uniqueness by index |
| Never | Sequential — that would leak enrolment order and headcount, and invite enumeration |
| Alphabet | Digits and unambiguous letters; `0/O` and `1/I/l` excluded, because it is read aloud |
| Secrecy | **Not secret** |
| **Authorization** | **It identifies; it never authorises.** A lookup by code runs exactly the same authorization as a lookup by id |

That last rule is normative. Without it the code becomes a bearer token by
accident — knowing a child's code must grant nothing.

---

## 62.6 — `User.schoolingStage`

```
schoolingStage : pre_primary | primary | middle | high |
                 post_secondary | not_in_school
```

**Purpose: it informs an administrator's placement decision.** The institute's
three Categories map to schooling stage — الطفل from the year before first
primary through primary; اليافعون through middle and high school; الكبار after
high school.

### Placement is an administrative decision, not an automatic rule

**This is normative, and it is the point of the field.**

> `schoolingStage` **informs** placement. It **never gates, filters, validates or
> auto-assigns** a Category or a Level. No business logic may refuse a placement
> on the basis of schooling stage or of any age derived from it.

The Document Owner's own case is the reason: *a girl older than the usual
high-school age is still placed in اليافعون if she is still in high school, or
if the administrator considers it appropriate.* **Any rule that automated this
would refuse that placement.** An implementation adding such validation would be
violating this revision, not completing it.

### Why this field rather than a date of birth

Age correlates with schooling stage and does not determine it — the case above
is precisely where the correlation breaks. So the platform records **the signal
the decision actually uses**, not a proxy for it. Schooling stage is also a
*current status* rather than a permanent identifier, and cannot be used to look a
person up in a civil registry.

**Date of birth is not added by this revision.** If administrators later report
that stage alone is insufficient, a **birth year** is the proportionate next
step — one integer, and a separate decision.

---

## 62.7 — Where children are requested, and where a parent lives

| Requester | Path |
|---|---|
| **Adult student** | From the student area — one request, one or more children |
| **Non-student parent** | The registration flow, extended from one child to several |
| **Already-approved parent** | The role switcher's ولي الأمر group carries a persistent **«＋ تسجيل طفل»** action |

**The Family Dashboard is removed** (§5.4) and `/dashboard/parent` leaves §14.1.

**A parent's home is their first approved child's dashboard.** Without this rule
a non-student parent would have no landing page at all, since the page they
previously resolved to no longer exists.

**A parent holding the role with no approved children** — every child revoked, or
the last one left — still sees the ولي الأمر group, containing only the
add-child action. Hiding the role would strand someone who legitimately holds
it; an empty list would be a dead end.

### The role switcher

ولي الأمر expands into the approved children. **Selecting a child sets the
active role to `parent` and the active child in one action**, then opens the
Student Dashboard in that child's context. Setting one without the other is a
state that must not exist.

A parent who is also a student keeps **both** roles: `طالبة` opens their own
dashboard, `ولي الأمر → child` opens that child's.

**No new security machinery.** R60's active role and §4.3's active child are
reused exactly as they are, and every read still resolves through the existing
per-request `FamilyLink` check.

---

## 62.8 — Rejection, and resubmission

```
rejectionReason : duplicate_application | insufficient_information |
                  not_eligible | other
internalNote    : staff-only, never returned to a parent
```

**A bounded reason reaches the parent; the free text never does.** A rejection
note will eventually contain a safeguarding judgement — *"could not verify
guardianship"*, *"child appears linked to another family"* — that must not be
disclosed to the applicant.

**Resubmission creates a NEW application.** The decided one is an audit record
and is never mutated.

**Whether an applicant has a right to the actual reason is pending legal/CNDP
confirmation.** This revision assumes no answer. If disclosure is later
required, the bounded enum gains a shared free-text field beside it and the
internal note stays as it is.

---

## 62.9 — The `parent` role, and who may be linked

**The `parent` role is granted automatically on the first approved child
application**, in the same transaction, through the existing
`applyRoleAssignments` — which already carries the privilege guard, the
branch-liveness check and the last-administrator rule. **Rejection grants
nothing.**

**Linking is restricted to accounts with no login identity.** §4.3 already says
minors have no login of their own, so *a minor is structurally a student account
with no `UserIdentity`*. This test needs **no date of birth**.

An adult student holds their own account and consents for themselves; linking a
parent to them would hand a third party their record on an administrator's
decision. **Dependent adults are out of scope** — noted as unsupported rather
than half-supported.

**When a minor gains their own login**, existing parent links are **not revoked
automatically**. Binding a first `UserIdentity` to a student who has approved
links raises a **non-blocking review item** in the approvals queue: the links
keep working, the student keeps their new login, and an administrator decides.

**[Pending legal/CNDP confirmation]** whether the law compels revocation at
majority. Nothing here assumes it does.

---

## 62.10 — Minimal Student Dashboard

R62's flow terminates in `/dashboard/student`, which today resolves to the
*not-built* state. This revision delivers a **minimal** version so the flow is
walkable and testable end to end:

* the student identity block — name, **reference code**, Category, Level, branch;
* today's and upcoming sessions;
* basic student information.

**Out of scope, unchanged:** Quran progress, grades, exams — later milestones.

It serves the same route in both contexts: the caller's own account when acting
as `student`, the active child when acting as `parent`. **A persistent banner
names whose data is shown** — a parent must never be unsure.

---

## 62.11 — Parent permissions

**Read-only. TD-2 is not amended.**

TD-2 grants a parent exactly two things over a child: *view linked child's data*
and *take online exams as the linked minor's vehicle*. The second is
unreachable — R58 disabled online exams. **This revision adds no parent
capability**, and an implementation that adds one is exceeding it.

---

## 62.12 — Explicitly out of scope

Date of birth · emergency contact · `familySituation` / `homeAddress` changes
*(blocked pending legal review)* · the accessibility redesign replacing
`healthCondition` *(its own revision — different table, different legal
question)* · removal of `siblings_count`, `father_profession`,
`mother_profession` and child free-text `notes` *(agreed, but not this
revision's subject)* · staff HR data · any new parent capability · Quran
progress, grades, exams.

---

## 62.13 — Audit of this draft against the live architecture

Every claim above was checked against `develop` before this proposal was
circulated. **[CODE]** findings:

| Claim | Verified |
|---|---|
| Registration creates the child at submission | `registration.service.ts:266` |
| Approval decides the whole bundle | `approval.service.ts:295` — loops every pending link |
| `applyRoleAssignments` carries the privilege guards | `user.service.ts:632` |
| `FamilyLink` uniqueness is on the **pair** | `family-link.service.ts:79` |
| TD-2 grants a parent exactly two things | matrix column extracted; *view linked child's data*, *take online exams* |
| `/dashboard/student` is not built | resolves to the *not-built* state |
| No `referenceCode`, no `schoolingStage`, no birth date exist | absent from the schema |
| `ConsentRecord.granted_by_user_id` records which parent | `schema.prisma:1134` |

**The audit changed the draft once.** 62.3b did not exist in the first version:
deferring child creation silently breaks the consent flow, because
`ConsentRecord.student_id` cannot be written before the student exists. That is
the kind of defect that ships as *"consent was lost for children registered
between two text versions"* and is discovered much later.

### Implementation consequences this revision creates

Named here so they are estimated rather than discovered:

1. **The approval queue's own query changes.** **[CODE]**
   `approval.service.ts:103` and `:282` both select applicants with
   `childLinks: { none: {} }` — a shape that assumes children arrive as links.
   With applications, the queue reads `ChildApplication` instead.
2. **`intendedBranchId` stays on the applicant only** (R39), unchanged. A child
   application carries no branch; the branch arrives with the Level and Group
   assigned at approval.
3. **Two write paths converge.** The registration flow and the student-area
   request must produce the *same* `ChildApplication` rows, or they will drift —
   one service, two callers.
4. **`/dashboard/parent` is referenced in four frontend places**, including
   `role-home.ts` and three test files. Removing the node is a small change with
   a visible blast radius, and the tests encode the old rule.

### What could not be verified, and is not assumed

Nothing in this revision rests on a legal conclusion. The two open items —
**guardianship verification** (62.4) and **the right to an actual rejection
reason** (62.8) — are marked pending, and neither changes the data model if
answered later: the first adds one date column, the second adds one shared text
field beside the existing enum.

---

## Text changes

| Clause | Change |
|---|---|
| **TD-4.2** | Atomicity narrowed from the bundle to **one child**; the parent's own decision made explicit and separate |
| **§4.1b step 5** | One request, **many** child applications; the child `User` is created **at approval**, not at submission |
| **§4.3** | "Minor" defined structurally — a student account with no `UserIdentity`; linking restricted to those; the majority review item |
| **§5.3** | The Student Dashboard serves both own-account and child context |
| **§5.4** | **Family Dashboard removed.** Child requests move to the student area, the registration flow and the switcher |
| **§7** | `ChildApplication`; `FamilyLink.relationship_type`; `User.reference_code`; `User.schooling_stage`; multi-parent stated |
| **§14.1** | `/dashboard/parent` removed; `الإدارة`'s sitemap unchanged |
| **TD-2** | **Unchanged** — stated so the absence is deliberate |
