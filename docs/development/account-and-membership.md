[Documentation](../README.md) › [Development](README.md) › **Account and membership**

# A platform account is not association membership

**One page for the distinction the platform kept implicitly in three services
and never stated in one place.** It cites [`docs/SRS.md`](../SRS.md) §4.1, §4.3,
BR-5 and Revisions 62, 79, 111 and 129 rather than restating them; where a rule
below has an SRS home, the SRS wins.

---

## The rule

**Having a technical platform account does not make a person a beneficiary, a
Student, or a member of the association.**

Fatima authenticates in order to register and manage Sara. She therefore needs
the ordinary `User` + `UserIdentity` machinery — for authentication,
authorization, consent and `FamilyLink`. That is *all* it means. In the business
domain she is **guardian-only**.

She is not automatically a beneficiary, a Student, enrolled, a مؤطِّرة, an
Admin, a Super Admin, or an association member.

**There is no `GuardianAccount` table and no second authentication
architecture**, deliberately: the existing `User` + roles + relationships model
expresses this exactly, and a parallel account type would fork authentication,
consent, deletion and audit for one distinction that is already representable.

## How the platform enforces it — three facts, one set

The enforcement is not a flag somebody remembers to clear. It is that **three
independent facts are all written from the same set: the people an approval
actually enrols.**

| Fact | Written where | For whom |
|---|---|---|
| `Enrollment` row | `approval.service.ts`, from `decision.placement` | the people being placed |
| `User.isBeneficiary` (R79.3) | `approval.service.ts`, from `admitted` | the same set |
| `student` role assignment | `approval.service.ts`, from the same set | the same set |

`admitted` is derived as `[...new Set(enrollments.map(e => e.userId))]` — the set
the approval *placed*, never a second derivation. R79.3 states the reason
plainly: *"a second derivation would drift from the first, and the drift would be
invisible until somebody could not be enrolled again."*

**A guardian is not in that set**, because R62 makes `mustEnrol` empty for an
applicant who arrived carrying child applications: the children are placed on
their own decisions, and the guardian's access comes through the `FamilyLink`.
So all three facts are absent for her, together, for one reason.

## What a guardian-only account may reach

Legitimate guardian and account functions only:

* her children, and their applications;
* her approved `FamilyLink`s;
* guardian/account settings;
* notifications and actions concerning her linked children.

The dashboards enforce this by **resolving a child**, not by hiding a section: a
parent's grades, Quran and account views send `X-Active-Child-ID` and read that
child's record. There is no arm that shows a guardian *her own* marks, because
there are none to show — and the server is the authority either way (UX rule O).

She must not appear in a beneficiary, student or member list merely because she
authenticated. `beneficiaries_only` filters on `isBeneficiary`, which is false
for her.

## Her email is hers — and it is the same address twice, not two columns

**Superseding an earlier over-absolute reading** (Owner, 2026-09-03): the address
on a guardian's authenticated identity **may also serve as that same guardian's
operational contact address**. There is no requirement to duplicate it, and
**`contact_email` must not be added merely to copy the same value** — a second
column holding the same string is a second source of truth, and on this project
every duplicated value has drifted.

What it must never mean is *«Sara authenticates as fatima@example.com»*. The
guardian's address is **never copied** into:

* the child's `UserIdentity`;
* the child's `preProvisionedEmail`;
* `ChildApplication` as a "child email" — the model has no email column at all;
* `FamilyLink` as duplicated contact data.

A child created through the minor flow has **no email of any kind**, and R62.9
makes that the *definition* of a minor: linking is restricted to accounts with no
login identity, because *an adult consents for themselves*.

When messaging eventually exists and something must reach a child's family, the
destination is resolved by **finding the live approved guardian and reading her
current address** — not by having stored a copy. There is no email, SMS or push
provider today, and none is implemented here.

### The generic `email` projection, and why it is not renamed

`profile.service.ts` and `user.service.ts` both project
`identities[0]?.email ?? preProvisionedEmail` as a field named plainly `email`.
Audited 2026-09-03: **the screen that renders it labels it «بريد Google»**, so it
already reads as the login address rather than as a contact coordinate. The wire
name is therefore **kept** — renaming it would break clients to fix a label that
is not wrong — and the invariant is recorded instead:

> **`email` on a profile or directory row is the ACCOUNT'S AUTHENTICATION
> ADDRESS.** It is the bound Google identity, falling back to the address the
> account was pre-provisioned against. It is not a per-person contact field, it
> is never another person's address, and it is never written by anything but
> identity binding or pre-provisioning.

## A guardian who later joins the association

**She uses the same account. A second `User` is never created.**

She submits the ordinary registration/application process, and on approval the
beneficiary state attaches to the row she already has: an `Enrollment`, the
`student` role and `isBeneficiary`. Her `FamilyLink`s stay intact, and her
guardian history is the same person's history.

**The mechanism already exists** and needed nothing added: all three facts are
written against a `userId`, and none of them is created by registration. What
does not exist yet is a *screen* for it — an existing guardian applying for
herself — which is a separate piece of work and not a second membership system.

## Date of birth, and who is asked for one

**Every beneficiary carries a full date of birth (R130); nobody else is asked.**
The question follows *admission*, not authentication:

| Who | Asked? | Why |
|---|---|---|
| An adult registering herself | **yes, required** | on that path the applicant *is* the beneficiary |
| Each child on a family request | **yes, required, per child** | every child is a beneficiary, and two siblings are two people |
| A guardian registering children | **no** | she is admitted to nothing (above) |
| A staff request (`requested_role`) | **refused, not ignored** | a مؤطِّرة is not a beneficiary; accepting one would collect a beneficiary's personal datum from somebody who is not one |
| A guardian who later applies as a beneficiary | **yes** | through that application, on the same account |

`User.birth_date` is the durable answer; `ChildApplication.birth_date` is the
submitted one, materialised unchanged at approval because the child `User` does
not exist until then (R62). **`lib/birth-date.ts` owns the rule** — the parse,
the calendar check, the future bound, the plausibility floor and the
eighteen-year predicate — and nothing repeats the arithmetic. **No age is ever
stored**: it is wrong the day after it is written.

**25 beneficiaries predate the requirement and no date was invented for them.**
The column is nullable, the requirement lives at the write boundary, and a
missing one is completed by a Super Admin on `/admin/users` — **completion,
never correction**, refused as `BIRTH_DATE_ALREADY_RECORDED` if one is already
recorded. The `NOT NULL` contraction cannot honestly happen until every live
beneficiary has a real recorded date.

**Eighteen establishes eligibility and triggers nothing.** No birthday job, no
automatic family-link revocation, no automatic identity binding, no role change
— an account that changes hands while nobody is looking is one nobody decided to
hand over. A guard asserts that no job source names the column.

### The adult-Category marker that is deliberately NOT added (2026-09-04)

**Adulthood is a fact about a person, and the platform now records it directly.**
A recurring idea is a `Category`-level marker — *«المرأة is the adult Category»* —
so that adult behaviour could be selected without consulting a birth date. It is
resolved, and the resolution is not to add it.

* **R130 removed the reason it existed.** The marker was attractive while there
  was no per-person answer. There is one now, required for every beneficiary, and
  a derived category flag would be a second answer to a question that already has
  a durable one — the drift this handbook keeps warning about.
* **It would be wrong for exactly the person it matters for.** Placement is an
  administrative decision that age never gates (R62.7), so a seventeen-year-old
  may sit in المرأة and an adult may sit in اليافعات. A Category marker would call
  the first an adult and the second a minor — and the whole point of the fact is
  deciding whether *this* person may claim her own account.
* **`Category.self_attendance_allowed` must not be borrowed for it.** R123's
  column looks like an adult marker and is not one: its own definition says the
  *population* is what makes self-marking acceptable, not the class. It answers
  *may a beneficiary of this Category mark her own presence*, and it is read by
  attendance and by scope options — nothing else. Overloading it would make a
  safeguarding permission and an identity fact one switch, so relaxing either
  would silently relax the other.

**What to do instead** when a screen seems to need *«is this an adult Category»*:
it almost always needs *«is this beneficiary an adult»*, which is
`lib/birth-date.ts` on `User.birth_date`. If it genuinely needs a property of the
Category, that is a new attribute with its own name and its own meaning, and an
Owner decision — not a reinterpretation of an existing column.

## The minor who becomes an adult — BUILT (R132)

**The blocker recorded on 2026-09-03 is closed, and the refusal that created it
still stands.** `PATCH /admin/users/{id}` still refuses `pre_provisioned_email`
*because it authorises claiming an account*; R132 adds the one controlled path
that refusal was protecting the absence of, not a general capability.

### Three facts, and none of them binds alone

| | proves | binds? |
|---|---|---|
| **Google OAuth** (unchanged flow) | somebody controls *this* Google identity | **no** |
| **Her reference code** | *which* beneficiary record is claimed | **no** — it grants nothing (R62.5), which is why quoting it is safe |
| **Super Admin approval** | the association recognises her as that beneficiary | **yes** — and only this |

The first two produce a **pending claim**. The third binds the identity to the
**existing** `User`, so her enrolments, grades, Quran progression, attendance,
submissions and reference code stay on the one id. **No second account, ever.**

### The guardian is not part of it

She does not choose the address, type it as the authoritative identity, attest
ownership, bind it, approve the transition or receive any credential — and her
own address never becomes the beneficiary's. The beneficiary proves control
herself; the association confirms who she is. That is exactly the blocker: the
only party who could previously act for a minor was the party an anti-takeover
control must guard against.

### Age is eligibility, never a trigger

At 18 (R130) she may **ask**. Nothing happens on a birthday: no job, no binding,
no authority change, no account creation. A guard asserts no job source names the
birth-date column.

### After the transition — authority is DURABLE, and evidence survives

**Authority and authentication are different facts** (Owner, 2026-09-04):

```
DOB ≥ 18             → eligibility only
approved R132 claim  → DURABLE self-managed authority
UserIdentity         → an authentication MECHANISM, nothing more
Option A closure     → removes authentication, removes NO authority
```

The durable fact is **the approved claim itself** — `policies/self-management.ts`
derives it — not a flag beside it, because a second column would be a second
answer to one question. It survives identity removal, logout, session deletion,
account closure and any later re-binding.

**This corrects the original R132 reading.** That expressed the rule as *an
account with no active login identity*, reusing §4.3's structural test for a
minor so there would be one definition. The reasoning was right and the fact was
wrong: **Option A deliberately deletes `UserIdentity`**, so a self-managed adult
who closed her account satisfied that test again. Nothing broke — but only
because the resolver separately requires a live student and a closed account is
soft-deleted. **Authority that survives by coincidence will not survive the next
change**, and the test that distinguishes the two clears the tombstone precisely
so only the durable fact can refuse the guardian.

**Three paths read it**, and the third is the sharpest: the child-context
resolver, the candidate search for linking an existing child, and the **linking
write itself** — where a closed self-managed adult has no login and would
otherwise have been accepted as a linkable child, *granting a guardian authority
over an adult who had taken it away* (`ACCOUNT_SELF_MANAGED`).

**The link row survives.** It is historical relationship evidence; what ends is
the current authority. A beneficiary who is 19 and never transitioned is still
reached through her guardian — the rule turns on the completed transition, never
on the age and never on the credential.

### The refusals are mostly uniform, on purpose

Every condition about the **claimed person** — unknown code, under 18, no
recorded date, already has a login, suspended, deleted, already claimed —
collapses into one answer. Distinguishing them would report whether `BA-XXXXX`
exists and whether that person is a minor. Only conditions about the caller's
**own** Google identity are named, because those disclose nothing she does not
control.

## Deleting a guardian account — WITHDRAWN as a separate concept (R133)

A dedicated action existed for one day: `POST /admin/users/{id}/close-guardian-only`,
guarded by an account-purpose policy that refused while the account had any
reason to exist. **Both are removed.**

The concept only made sense while *closing a guardian* was different from
*deleting an account*. Under R133 it is not: a Super Admin deletes the account
like any other, it is recoverable for seven days, and permanent deletion removes
what belongs solely to her.

**The safeguarding property the guard was credited with was never its doing.**
*«Deleting a guardian must not touch her child»* is a property of the erasure
boundary — everything it removes is keyed on the subject — so it survives the
guard's removal untouched, and is now asserted directly against the ordinary
deletion path, in both directions.

**Her family relationships go with her** (R133 §10). A `FamilyLink` exists to let
a guardian act for a child; when either party is permanently deleted it has no
purpose left, and it is personal data about the deleted person — who her family
is. **Only the link**: the other party's account, enrolments, grades and history
are untouched.

## The guards## The guards## The guards

| Property | Guard |
|---|---|
| Approving a guardian admits her to nothing — no enrolment, no `isBeneficiary` | `registration.integration.test.ts` |
| She holds no `student`, `teacher`, `admin` or `super_admin` role | same |
| She does not appear in the beneficiaries list | same |
| She carries no Grade, Attendance, submission, Quran log or teaching-group seat | same |
| Her email reaches neither the child's identity nor the child's pre-provisioned address, and exactly one account claims it | same |
| The upgrade attaches to the same `User`, and her `FamilyLink`s survive it | same |
| A child has no login identity, so linking refuses an account that has one | `child-application.integration.test.ts` (`ACCOUNT_HAS_LOGIN`) |
| Under 18 cannot initiate; exactly 18 can; the birthday itself binds nothing | `self-managed-claim.integration.test.ts` |
| A verified Google identity alone binds nothing — it produces a pending claim | same |
| Approval binds to the SAME user, creates no second user, and keeps her history | same |
| An existing identity is never overwritten; an identity bound elsewhere is refused | same |
| A replayed verification, a duplicate claim and a double approval are all refused | same |
| An unknown reference code answers exactly as an ineligible one | same |
| A guardian can neither decide a claim nor put her own identity on the daughter | same |
| A former guardian loses authority once the account is self-managed — while the link row survives | same |
| A 19-year-old who never transitioned still has her guardian (the control case) | same |
| The audit carries no token, subject, address, reference code or birth date | same |
| An adult beneficiary registration is refused without a date of birth, and a staff request is refused *with* one | `registration.integration.test.ts` |
| Each child needs her own; siblings' dates are independent and preserved exactly | same |
| Approval materialises the application's date onto the beneficiary | same |
| A guardian is not asked for one | same |
| An impossible, future or malformed date is refused | same, and `birth-date.test.ts` |
| No stored age column exists on either table | same (asserted against `information_schema`) |
| A Super Admin completes a missing date; a recorded one cannot be rewritten; an Admin, teacher, student or parent cannot write it at all | `user.integration.test.ts` |
| The audit row names the field and never the value | same |
| No job source names the birth-date column | same |
| Eighteen is a boundary and a pure predicate | `birth-date.test.ts` |
| One live account per email, across both ownership channels | `email-ownership.integration.test.ts` |
