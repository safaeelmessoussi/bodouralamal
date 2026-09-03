[Documentation](README.md) › **SRS Proposal — Revision 129**

# SRS Proposal — Revision 129

**A platform account is not association membership. A guardian's email is her
own. A guardian who joins the association keeps her account.**

**Status: APPLIED — ratified by the Document Owner and applied to `SRS.md` as SRS Revision 129, 2026-09-03.** Kept as the drafting record; **`SRS.md` is now authoritative**. §0 and §4.1 carry the account-versus-membership model and the email semantics. Audited, pinned by tests and documented; the clauses below are the
exact text the Document Owner applies. **This revision changes no schema, no
route and no wire contract** — the model it states is the model the platform
already implements, and what was missing was the statement, the tests and the
name.

---

## 1 · What the audit found

Three services carry this distinction between them and no document stated it:

* **R62** makes `mustEnrol` empty for an applicant who arrived with child
  applications — the children are placed on their own decisions.
* **R79.3** writes `User.isBeneficiary` from `admitted`, which *is* the set the
  approval enrolled, deliberately reusing it rather than re-deriving it.
* The `student` role is granted from that same set.

So a guardian is excluded from all three **together, for one reason**. That is a
good design and it was invisible: nothing asserted it end to end, and the failure
would have been silent and severe — a guardian in a beneficiary list, or handed
a personal educational record she never had.

## 2 · Proposed addition to §4.1

> **HAVING A TECHNICAL PLATFORM ACCOUNT DOES NOT MAKE A PERSON AN ASSOCIATION
> BENEFICIARY, STUDENT OR MEMBER.**
>
> A guardian may authenticate solely in order to register and manage children.
> She therefore requires the ordinary `User` and `UserIdentity` infrastructure —
> for authentication, authorization, consent and `FamilyLink` — and that is all
> it means. In the business domain she is **guardian-only**: not a beneficiary,
> not a Student, not enrolled, not a مؤطِّرة, not an Admin, not a Super Admin,
> not a member.
>
> **There is no separate guardian account type**, and none is to be created: the
> existing `User` + roles + relationships model expresses this exactly, and a
> parallel account type would fork authentication, consent, deletion and audit
> for a distinction that is already representable.
>
> **A guardian-only account receives no personal beneficiary surface.** Its
> user-facing scope is her children and their applications, her approved family
> links, her guardian and account settings, and notifications and actions
> concerning her linked children. It exposes **no personal `Enrollment`, Level,
> `Grade`, Quran progression, attendance or assessment history for the guardian
> herself**, because she has none — and it never will unless she separately
> becomes a beneficiary.
>
> **She does not appear in any beneficiary, student or member list** merely
> because she authenticated.
>
> **The enforcement is that the three facts share one set.** `Enrollment`,
> `User.isBeneficiary` and the `student` role are all written from the people an
> approval actually places. A fourth derivation of *"is this person a
> beneficiary"* is not to be added; it would drift from the other three.

## 3 · Proposed amendment on email — superseding an over-absolute earlier reading

> **A guardian's authenticated email MAY also serve as that same guardian's
> operational contact address.** There is no requirement to duplicate it into a
> second field, and **a `contact_email` column must not be added merely to hold
> the same value**: a second column carrying the same string is a second source
> of truth.
>
> **THE GUARDIAN'S EMAIL BELONGS TO THE GUARDIAN.** It must never become the
> child's authentication identity, and it is **never copied** into the child's
> `UserIdentity`, the child's `preProvisionedEmail`, `ChildApplication` as a
> child email, or `FamilyLink` as duplicated contact data.
>
> **A child created through the minor flow has no email of any kind**, and R62.9
> makes that the definition of a minor: linking is restricted to accounts with no
> login identity, because an adult consents for themselves.
>
> **When a message must concern a child**, the destination is resolved by finding
> the **live approved guardian** and reading her current address — never by
> having stored a copy. No email, SMS or push provider exists, and none is
> introduced here.
>
> **The `email` field on a profile or directory row is the account's
> AUTHENTICATION address** — the bound Google identity, falling back to the
> pre-provisioned one. It is not a per-person contact field and is never another
> person's address. The screen that renders it is labelled «بريد Google», so the
> name is kept and the invariant recorded rather than the contract broken.

## 4 · Proposed addition on the guardian → beneficiary transition

> **A guardian-only person who later joins the association MUST NOT create a
> second account.** She uses the same `User`, submits the ordinary
> registration/application process, and on approval the beneficiary state
> attaches to the row she already has: an `Enrollment`, the `student` role and
> `isBeneficiary`. Her existing `FamilyLink`s remain intact and her guardian
> history remains the same person's history.
>
> **No second membership system exists or is to be built.** All three facts are
> written against a `userId` and none is created by registration, so admitting
> her is an ordinary approval acting on an existing row.

## 5 · What is NOT decided here

* **The screen** for an existing guardian applying for herself. The data model
  supports the transition today; the surface does not exist, and building it is
  separate work.
* **The minor → adult transition**, which depends on date of birth and is stated
  in its own revision.
* **Anything about deletion or retention.**

## 6 · Deliberately unchanged

Every schema, route, DTO and wire contract. §4.1's approval flow, R62's
per-child decisions, R79.3's beneficiary fact, BR-5's login-less minor, the
`ACCOUNT_HAS_LOGIN` refusal, and the one-live-account-per-email invariant across
both ownership channels.
