[Documentation](../README.md) › [Compliance](personal-data-audit.md) › **R62 design decisions**

# R62 — Architectural Decisions Before Drafting

**Date:** 2026-08-11 · **Follows:** [audit](personal-data-audit.md) → [data-collection decision](data-collection-decision.md)
**Status:** for approval. Nothing implemented, no schema, no migration, no SRS change.

Tags as before: **[SRS]** · **[CODE]** verified · **[INFER]** my reasoning ·
**[CONFIRM]** needs the CNDP or a Moroccan privacy lawyer.

**Your data-collection direction is recorded as settled** and is assumed
throughout: no date of birth · reference code · remove the three dead fields ·
remove child free-text notes · bounded accessibility model · `familySituation`
and `homeAddress` blocked pending legal review · parent-as-discriminator ·
admin-decided matching · read-only parent.

---

## Decision 1 — Can one child have multiple approved parents?

**Recommendation: YES.**

**[CODE] The capability already exists and nothing assumes otherwise.**
Uniqueness is on the **pair** — `familyLink.findFirst({ parentId, studentId })`
— not on the child. `resolveActingStudent` matches parent *and* child, so two
approved links are two independent authorizations that cannot interfere.

**[INFER] Refusing it would be worse for safeguarding than allowing it.** A
mother and father both need access; a grandparent may be the guardian. If the
platform permits one, the second adult uses the first one's login — and the
audit trail then attributes their actions to the wrong person. Shared
credentials are the failure mode a single-parent rule *causes*.

**Custody and separation** are handled by the mechanism that already exists:
each link is approved individually, and revocation takes effect on the **next
request** **[CODE]** because the link is re-checked per request rather than
cached in the token.

**[CODE] Consent survives it**: `ConsentRecord.grantedByUserId` records *which*
parent consented, so multi-parent does not blur the consent trail.

| Impact | |
|---|---|
| SRS | Must **state** it — currently silent, which is the actual defect |
| Database | **None** |
| Security | Each link independently approved and independently revocable |
| UX | The child appears in both parents' switchers |
| Scalability | None |
| Complexity | **Zero** — this is documenting what the model already does |

**[CONFIRM]** Whether a parent whose rights are legally restricted must be
provably removable within a defined period.

---

## Decision 2 — Relationship types

**Recommendation: exactly three — `mother` · `father` · `legal_guardian`. No
free text, no `other`.**

**[INFER] The platform asks one question: may this person act for this child?**
Anything finer is family-structure data with no functional consumer — precisely
what we agreed to remove from `StudentSocialProfile`. A grandparent who acts
legally *is* a legal guardian; recording "grandmother" adds a fact nothing uses.

An `other` value with a free-text note would reintroduce the unbounded-text
problem in the same release we remove it.

| Impact | |
|---|---|
| SRS | Defines the enum and the reasoning |
| Database | One enum column on `FamilyLink` |
| Security | None |
| Privacy | Mother/father does reveal family structure — proportionate, since the purpose is direct |
| Scalability | Adding a value later is a migration, not a redesign |
| Complexity | Trivial |

---

## Decision 3 — Adding another child, with no Parent Dashboard

**This is a real gap in the model, and it needs an explicit answer.**

**[CODE]** `roleHomePath('parent')` resolves to `/dashboard/parent`, which your
model deletes. **A non-student parent would then have no page at all.**

**Recommendation, in two parts:**

1. **A parent's home is their first approved child's dashboard.** `homeForRole('parent')`
   resolves to the child context rather than to a parent page. No new screen.
2. **The switcher's ولي الأمر group carries a persistent action row —
   «＋ تسجيل طفل» — beneath the children.** That is exactly where a parent is
   already thinking about their children, and it needs no dashboard to host it.

**Edge case that follows:** a parent holding the role with **zero** approved
children (all revoked, or the last child left). **[INFER] Recommendation:** the
group still appears, containing only the add-child action. Hiding the role
entirely would strand someone who legitimately holds it; showing an empty list
would be a dead end.

| Impact | |
|---|---|
| SRS | §14.1 removes `/dashboard/parent`; states the parent-home rule |
| Database | None |
| Security | None — the action only creates a pending application |
| UX | One action row; no page to design, build or maintain |
| Scalability | Works for 1 child or 12 |
| Complexity | Small |

---

## Decision 4 — Can an adult's account be linked to a parent?

**Recommendation: NO. Restrict linking to minors — and define "minor"
structurally, not by age.**

**[SRS]** *"Minor students (Teens/Children) have no login of their own; they
exist as student records accessed exclusively through an approved linked
Parent's account."*

**[INFER] So the platform already encodes minority structurally: a minor is a
student account with no `UserIdentity`.** That test needs **no date of birth** —
it uses what the model already says. This is the same principle as using the
parent as the discriminator: read what is there rather than collect something
new.

An adult student holds their own account, consents for themselves, and has
data-protection rights of their own. Linking a parent to them would hand a third
party their full record on an administrator's decision.

**Two consequences requiring your decision:**

* **4a — What happens when a minor gains a login?** A teenager reaching majority
  claims their own Google account. **[INFER] Existing parent links should not
  silently survive that.** Options: auto-revoke on identity binding · flag for
  admin review · leave until revoked. **My recommendation: flag for review,
  never silent.** **[CONFIRM]** whether Moroccan law compels revocation at
  majority.
* **4b — Dependent adults.** An adult who genuinely needs a guardian is outside
  §4.3 as written. **[INFER] Do not build for it now**; note it as unsupported
  rather than half-supported.

| Impact | |
|---|---|
| SRS | States the structural definition and the majority rule |
| Database | None |
| Security | **Significant** — closes a path to an adult's record |
| UX | Registration refuses with a clear reason |
| Scalability | Fine |
| Complexity | One check; 4a needs a lifecycle hook |

---

## Decision 5 — The student reference code

**Recommendation: one field, random, unique, non-secret, students only.**

| Property | Choice | Why |
|---|---|---|
| Applies to | **Students** (adult + minor) | Staff have other identifiers |
| Generation | **Random from a large space**, uniqueness enforced by index | **[INFER] Never sequential** — a sequential code leaks enrolment order and total headcount, and invites enumeration |
| Alphabet | Digits + unambiguous Latin letters, **excluding** `0/O` and `1/I/l` | It will be read aloud and hand-copied |
| Length | 6–8 characters | Large enough space; short enough to say |
| Format | e.g. `BA-7K4M2` | Prefix aids recognition on paper |
| Secrecy | **Not secret, and never a credential** | It identifies; it must never authorise. Knowing a code must grant nothing |
| Display | The student's own dashboard · staff screens · the parent's child list | Where "which one?" is actually asked |
| Immutability | Never changes | Its value is that it is stable |

**[INFER] The security property that matters:** because it is not secret, every
lookup by code must still run the *same* authorization as a lookup by id.
Otherwise the code becomes a bearer token by accident — a classic failure.

| Impact | |
|---|---|
| SRS | New field, generation rule, and the *"identifies, never authorises"* rule |
| Database | One column + unique index + backfill for existing students |
| Security | Positive — replaces speaking a child's name aloud |
| Privacy | **Carries no personal data** |
| Scalability | Collision-free at any realistic size |
| Complexity | Small |

---

## Decision 6 — What the admin sees for a multi-child request

**Recommendation: one queue item per request; one decidable block per child.**

**Parent block** — name, phone, branch, consent status, and **whether this
parent already has approved children** *(context that prevents a wrong link)*.

**Per child** — name, sex, requested stage, the Level/Group assignment controls
that already exist **[SRS]** (R49/R43), and **duplicate-match candidates**.

**Each candidate is shown as name + linked parent + reference code** — using
Decision 1's discriminator and Decision 5's code, so the administrator can tell
two same-named children apart **without the platform holding a birth date**.

**[INFER] The screen must make "create new" the deliberate choice, not the
default.** If matching is easier to skip than to do, duplicates are created by
the path of least resistance.

| Impact | |
|---|---|
| SRS | §5.6 / §14.2 |
| Database | The `ChildApplication` table |
| Security | The approval *is* the security boundary — this screen must justify itself |
| UX | The largest new screen in R62 |
| Scalability | Fine for a handful of siblings |
| Complexity | **Medium — the main build cost of R62** |

---

## Decision 7 — Independent per-child approval

**Recommendation: YES, as you directed — and it requires narrowing TD-4.2.**

**[CODE] Today the bundle is all-or-nothing**: `decide()` approves the applicant
and **every** pending child link in one decision. **[SRS] TD-4.2** names that
atomicity as a requirement, so per-child approval is a genuine revision, not an
implementation detail.

**The narrowed rule: atomicity is per child** — parent activation + that child +
that link + that role grant, in one transaction. The *bundle* stops being the
unit; the *child* becomes it.

**Sub-decision you must make: what decides the parent's own account?**
**[INFER] Recommendation: keep it an explicit, separate decision on the same
screen** — as registration already does. Inferring the parent's fate from the
children's outcomes ("all rejected ⇒ reject the parent") creates a state machine
nobody can predict from the interface.

**Safety property, free:** a rejected child gets **no `FamilyLink` row at all**,
because the link is created *on approval*. Partial approval therefore cannot leak
a rejected child — there is nothing to leak through.

| Impact | |
|---|---|
| SRS | **TD-4.2 narrowed** — the central revision in R62 |
| Database | `ChildApplication.status` per row |
| Security | Strong: no link, no access |
| UX | Approve some, reject others, in one visit |
| Scalability | Fine |
| Complexity | Medium |

---

## Decision 8 — What a rejected parent sees, and resubmission

**Recommendation: a bounded reason code shown to the parent, plus an internal
note that is never shown.**

**[INFER]** A free-text rejection reason will eventually contain a safeguarding
judgement — *"could not verify guardianship"*, *"child appears already linked to
another family"* — that must not be disclosed to the applicant. This is the same
problem as `healthCondition`, and the same fix works: **bound what is shared,
keep the free text internal.**

```
rejectionReason  enum   duplicate_application · insufficient_information ·
                        not_eligible · other
internalNote     VarChar(500)   — staff only, never returned to the parent
```

**Resubmission: allowed, as a NEW application.** The decided one is an audit
record and is never mutated. **[INFER]** This also gives the natural rate-limit
conversation later, if resubmission is abused.

**[CONFIRM]** Whether an applicant has a right to the *actual* reason for a
refusal, which would change this design.

| Impact | |
|---|---|
| SRS | The enum and the never-shared rule |
| Database | Two columns |
| Security | Prevents disclosing a safeguarding judgement |
| UX | Honest status without a dead end |
| Scalability | Fine |
| Complexity | Small |

---

## Decision 9 — Personal data R62 introduces

| Field | Classification |
|---|---|
| Child first/last name (Arabic), `sex` | **Required and justified** — already collected today; R62 only moves *when* |
| `FamilyLink.relationshipType` | **Required and justified** (Decision 2) |
| `ChildApplication.status`, `decidedAt`, `decidedById` | **Required and justified** — the accountability record |
| `rejectionReason` (enum) | **Required and justified** |
| `internalNote` (500 chars, staff-only) | **Requires care** — bound it, name its purpose, keep it out of every parent-facing payload |
| `referenceCode` | **Not personal data** |
| `guardianshipVerifiedAt` | **Requires legal confirmation** — see below |
| Emergency contact | **Not R62.** Justified, but belongs to its own decision |

**[CONFIRM] Guardianship verification.** The platform records a *claim* of
guardianship, not proof. Whether the association must verify documents — and if
so whether the platform records **that a check occurred** (a date, never a
scanned document) — is a legal question that changes the model.

**[INFER] R62 introduces no new *category* of personal data.** It restructures
the workflow around data already collected, plus one non-personal identifier.
That is the right shape for a change of this size.

---

# Final recommendation

**Proceed to draft R62 with these settled.** The design adds **one table, three
columns and one enum** — and closes two conflicts in the existing specification.

**What R62 should contain**

1. `ChildApplication` — the envelope: one request, many children, per-child status
2. **TD-4.2 narrowed** — atomicity becomes per child
3. `FamilyLink.relationshipType` — the three-value enum
4. `User.referenceCode` — random, unique, non-secret, students only
5. **Automatic `parent` role grant** on first approval
6. §5.4 / §14.1 — the Family Dashboard removed; a parent's home is their child's dashboard
7. Linking **restricted to accounts with no login identity** (minors, structurally)
8. Rejection: bounded public reason + internal note; resubmission as a new application
9. **Multi-parent explicitly permitted** — documenting what the model already does

**What R62 should NOT contain**

Date of birth · emergency contact *(own decision)* · `familySituation` /
`homeAddress` changes *(blocked pending legal review)* · any new parent
capability · staff HR data · the accessibility redesign *(own revision — it
touches a different table and a different legal question)*

**A scope warning you should weigh. [CODE]** `/dashboard/student` **does not
exist** — it resolves to the *not-built* state. R62's entire UX terminates in a
screen that has not been built. Either R62 includes a minimal student dashboard,
or it ships against a placeholder and cannot be demonstrated end to end. **[INFER]
My recommendation: include a minimal one** — today's sessions and the student's
own identity block — so the flow is walkable.

---

# Decisions still needed from you

| # | Question |
|---|---|
| **A** | **Decision 4a** — a minor who gains their own login: auto-revoke, flag for review, or leave? *(I recommend flag)* |
| **B** | **Decision 7** — is the parent's own account decided explicitly, or inferred from the children? *(I recommend explicit)* |
| **C** | **Scope** — does R62 include a minimal student dashboard, or ship against the placeholder? *(I recommend include)* |
| **D** | **[CONFIRM]** Guardianship verification — must the association verify, and must the platform record that it did? |
| **E** | **[CONFIRM]** Must a rejected applicant be told the actual reason? *(Changes Decision 8)* |
| **F** | Confirm the three legal items from the previous document are in motion: `healthCondition` / `familySituation` / `homeAddress` review, the CNDP declaration status, and the Arabic privacy notice |

Nothing will be drafted or implemented until you answer A–C and confirm F.
