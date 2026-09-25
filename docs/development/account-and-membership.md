[Documentation](../README.md) › [Development](README.md) › **Account and membership**

# A platform account is not association membership

Cites [`docs/SRS.md`](../SRS.md) §4.1, §4.3, BR-5 and Revisions 62, 79, 111, 129; where a rule has an SRS home, the SRS wins.

## The rule

- A technical platform account makes nobody a beneficiary, Student, enrolled person, مؤطِّرة, Admin, Super Admin or association member.
- A guardian (Fatima registering Sara) needs `User` + `UserIdentity` for authentication, authorization, consent and `FamilyLink` — nothing more; in the domain she is guardian-only.
- No `GuardianAccount` table, no second authentication architecture: a parallel account type would fork authentication, consent, deletion and audit.

## Enforcement — three facts, one set

| Fact | Written where | For whom |
|---|---|---|
| `Enrollment` row | `approval.service.ts`, from `decision.placement` | the people being placed |
| `User.isBeneficiary` (R79.3) | `approval.service.ts`, from `admitted` | the same set |
| `student` role assignment | `approval.service.ts`, from the same set | the same set |

- `admitted = [...new Set(enrollments.map(e => e.userId))]` — the set the approval placed, never a second derivation (R79.3: drift would be invisible until somebody could not be enrolled again).
- A guardian is not in the set: R62 makes `mustEnrol` empty for an applicant carrying child applications; children are placed on their own decisions; her access is the `FamilyLink`.

## What a guardian-only account may reach

- Her children and their applications; her approved `FamilyLink`s; guardian/account settings; notifications and actions about her linked children.
- Dashboards resolve a child (`X-Active-Child-ID`), not hide a section; no arm shows a guardian her own marks (none exist); the server is the authority (UX rule O).
- `beneficiaries_only` filters on `isBeneficiary`, false for her; she never appears in a beneficiary, student or member list for having authenticated.

## Her email is hers — the same address, not two columns

- Owner, 2026-09-03 (superseding an over-absolute reading): a guardian's identity address may also serve as her operational contact; `contact_email` must not be added merely to copy it (every duplicated value on this project has drifted).
- Never copied into: the child's `UserIdentity`, the child's `preProvisionedEmail`, `ChildApplication` (no email column at all), `FamilyLink`.
- A minor-flow child has no email of any kind; R62.9 defines a minor by it (linking restricted to accounts with no login identity — an adult consents for herself).
- Future messaging reaches a family by finding the live approved guardian and reading her current address; no email, SMS or push provider exists today.
- `profile.service.ts` and `user.service.ts` project `identities[0]?.email ?? preProvisionedEmail` as `email`; the screen labels it «بريد Google» (audited 2026-09-03), so the wire name is kept. Invariant: **`email` on a profile or directory row is the ACCOUNT'S AUTHENTICATION ADDRESS** — bound Google identity, else the pre-provisioned address; never a contact field, never another person's, written only by identity binding or pre-provisioning.

## A guardian who later joins the association

- Same account, never a second `User`: on approval `Enrollment`, `student` role and `isBeneficiary` attach to her existing row; `FamilyLink`s stay.
- Mechanism exists (all three facts are written against a `userId`, none by registration); a screen for an existing guardian applying for herself is NOT built.

## Date of birth, and who is asked

| Who | Asked? | Why |
|---|---|---|
| Adult registering herself | yes, required | the applicant is the beneficiary |
| Each child on a family request | yes, required, per child | every child is a beneficiary |
| Guardian registering children | no | admitted to nothing |
| Staff request (`requested_role`) | refused, not ignored | a مؤطِّرة is not a beneficiary |
| Guardian later applying as a beneficiary | yes | through that application, same account |

- `User.birth_date` is durable; `ChildApplication.birth_date` is submitted and materialised unchanged at approval (the child `User` does not exist before, R62).
- `lib/birth-date.ts` owns parse, calendar check, future bound, plausibility floor and the eighteen-year predicate; nothing repeats the arithmetic; no age is ever stored.
- 25 beneficiaries predate the requirement, no date invented: the column is nullable, the requirement lives at the write boundary; a Super Admin completes a missing date on `/admin/users` — completion, never correction (`BIRTH_DATE_ALREADY_RECORDED`); `NOT NULL` waits until every live beneficiary has a real date.
- Eighteen establishes eligibility and triggers nothing: no birthday job, no automatic link revocation, identity binding or role change; a guard asserts no job source names the column.

### The adult-Category marker that is NOT added (2026-09-04)

- Rejected: R130 gives a per-person answer, so a Category flag would be a second answer that drifts.
- Placement is administrative and age never gates it (R62.7): a seventeen-year-old may sit in المرأة, an adult in اليافعات — a marker would misclassify exactly the person it matters for.
- `Category.self_attendance_allowed` (R123) must not be borrowed: it answers «may a beneficiary of this Category mark her own presence», read by attendance and scope options only; overloading it would couple a safeguarding permission to an identity fact.
- «Is this an adult Category» almost always means «is this beneficiary an adult» = `lib/birth-date.ts` on `User.birth_date`; a genuine Category property is a new named attribute and an Owner decision.

### The marker that IS added: `Category.holds_own_login` (SRS Revision 170 §6)

- Who holds the login — §2.1's structural definition of a minor, NOT adulthood; the marker R64.7 recommended, closing its gap (a woman asking «الطفل» for herself; a child application into the adults' Category).
- Not an age gate: `birth_date` answers adulthood; placement stays the approver's (R39, R66.5). It binds the REQUEST only: `policies/category-login.policy.ts` refuses self-registration into a guardian-managed Category (`CATEGORY_IS_GUARDIAN_MANAGED`) and a child application into an own-login one (`CATEGORY_HOLDS_OWN_LOGIN`); the three forms stop offering what would be refused (`lib/category-audience.ts`).
- `null` = «not stated», restricts nothing; the migration answered existing rows from `self_attendance_allowed` ONCE; the columns are separate since, both edited on «الفئات».
- `min_age`/`max_age` are informational: shown on «الفئات» and beside the Category's name on the forms, 0–120 whole years, never inverted (`AGE_RANGE_INVERTED`), refuse nothing.

## The minor who becomes an adult — BUILT (R132)

- `PATCH /admin/users/{id}` still refuses `pre_provisioned_email` (it authorises claiming an account); R132 adds the one controlled path.

| | proves | binds? |
|---|---|---|
| Google OAuth (unchanged flow) | somebody controls this Google identity | no |
| Her reference code | which beneficiary record is claimed | no — it grants nothing (R62.5), so quoting it is safe |
| Super Admin approval | the association recognises her as that beneficiary | yes, only this |

- The first two produce a pending claim; approval binds the identity to the EXISTING `User` (enrolments, grades, Quran, attendance, submissions, reference code stay on one id); no second account, ever.
- The guardian is not part of it: does not choose, type, attest, bind, approve or receive a credential; her address never becomes the beneficiary's (the only party who could act for a minor is the one an anti-takeover control guards against).
- Age is eligibility, never a trigger: at 18 (R130) she may ask; nothing happens on a birthday.
- Authority and authentication are different facts (Owner, 2026-09-04):

```
DOB ≥ 18             → eligibility only
approved R132 claim  → DURABLE self-managed authority
UserIdentity         → an authentication MECHANISM, nothing more
Option A closure     → removes authentication, removes NO authority
```

- The durable fact is the approved claim itself, derived by `policies/self-management.ts`, not a flag; it survives identity removal, logout, session deletion, account closure and re-binding. This corrects the original R132 reading («no active login identity»): Option A deletes `UserIdentity`, so a closed self-managed adult satisfied the minor test again; the test clears the tombstone so only the durable fact refuses the guardian.
- Three readers: the child-context resolver, the candidate search for linking an existing child, and the linking write itself (`ACCOUNT_SELF_MANAGED` — otherwise a closed self-managed adult would be a linkable child).
- The `FamilyLink` row survives as historical evidence; only current authority ends. A 19-year-old who never transitioned is still reached through her guardian: the rule turns on the completed transition, never age or credential.
- Refusals about the claimed person (unknown code, under 18, no date, has a login, suspended, deleted, already claimed) collapse into one answer; only conditions about the caller's own Google identity are named.

## Deleting a guardian account — WITHDRAWN as a separate concept (R133)

- `POST /admin/users/{id}/close-guardian-only` and its account-purpose policy (one day old) are removed: a Super Admin deletes the account like any other, recoverable seven days, permanent deletion removes what is solely hers.
- «Deleting a guardian must not touch her child» is a property of the erasure boundary (everything keyed on the subject), asserted directly against the ordinary deletion path in both directions.
- Her `FamilyLink`s go with her (R133 §10) — only the link; the other party's account, enrolments, grades and history are untouched.

## The guards

| Property | Guard |
|---|---|
| Approving a guardian admits her to nothing — no enrolment, no `isBeneficiary` | `registration.integration.test.ts` |
| She holds no `student`, `teacher`, `admin` or `super_admin` role | same |
| She does not appear in the beneficiaries list | same |
| She carries no Grade, Attendance, submission, Quran log or teaching-group seat | same |
| Her email reaches neither the child's identity nor pre-provisioned address; exactly one account claims it | same |
| The upgrade attaches to the same `User`; her `FamilyLink`s survive | same |
| A child has no login identity; linking refuses an account that has one | `child-application.integration.test.ts` (`ACCOUNT_HAS_LOGIN`) |
| Under 18 cannot initiate; exactly 18 can; the birthday binds nothing | `self-managed-claim.integration.test.ts` |
| A verified Google identity alone produces only a pending claim | same |
| Approval binds the SAME user, no second user, history kept | same |
| An existing identity is never overwritten; one bound elsewhere is refused | same |
| Replayed verification, duplicate claim, double approval refused | same |
| Unknown reference code answers exactly as an ineligible one | same |
| A guardian can neither decide a claim nor put her identity on the daughter | same |
| A former guardian loses authority once self-managed; the link row survives | same |
| A 19-year-old who never transitioned still has her guardian | same |
| The audit carries no token, subject, address, reference code or birth date | same |
| Adult beneficiary registration refused without a date; staff request refused with one | `registration.integration.test.ts` |
| Each child needs her own date; siblings' dates independent and exact | same |
| Approval materialises the application's date onto the beneficiary | same |
| A guardian is not asked for one | same |
| Impossible, future or malformed date refused | same, and `birth-date.test.ts` |
| No stored age column on either table | same (against `information_schema`) |
| Super Admin completes a missing date; a recorded one cannot be rewritten; Admin, teacher, student, parent cannot write it | `user.integration.test.ts` |
| The audit row names the field, never the value | same |
| No job source names the birth-date column | same |
| Eighteen is a boundary and a pure predicate | `birth-date.test.ts` |
| One live account per email across both ownership channels | `email-ownership.integration.test.ts` |
