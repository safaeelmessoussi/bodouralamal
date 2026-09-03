[Documentation](README.md) › **SRS Proposal — Revision 132**

# SRS Proposal — Revision 132

**A beneficiary claims her own account at 18. Google proves control of an
identity; a Super Admin proves it is hers.**

**Status: APPLIED — ratified by the Document Owner and applied to `SRS.md` as SRS Revision 132, 2026-09-03.** Kept as the drafting record; **`SRS.md` is now authoritative**. §0, §4.1, §4.3, §7, TD-1, TD-2, TD-3 and TD-8 carry the transition, the reference-code invariant and the post-transition authority rule. Implemented, migrated, tested and browser-verified.

---

## 1 · The blocker this closes, and the refusal it does not weaken

A former minor is a login-less `User` (R62.9) holding her whole educational
history, and nothing could ever give her a login. The blocker recorded on
2026-09-03 was exact: **no operation points an EXISTING account at an address**,
and `PATCH /admin/users/{id}` refuses `pre_provisioned_email` *because it
authorises claiming an account*.

**That refusal is correct and is untouched.** R132 does not add a general
capability to point any account at any address — it adds the one controlled path
whose absence that refusal was protecting.

## 2 · Proposed addition to §4.3

> **AGE ESTABLISHES ELIGIBILITY AND NOTHING ELSE.** At 18 (R130) a beneficiary
> becomes eligible to **request** a self-managed account. Turning 18 must never
> bind an identity, create an account, change authority, remove a guardian's
> relationship or trigger any background work. **There is no birthday job and
> none may be added.**
>
> **Three facts, and none of them binds alone.**
>
> 1. **Google proves control of a Google identity** — through the ordinary
>    OAuth+PKCE flow, unchanged. It does **not** prove that the person
>    controlling it is this beneficiary, which is the whole reason a human
>    decision follows.
> 2. **The reference code names WHICH beneficiary is claimed.** It grants
>    nothing on its own (R62.5) — which is exactly why it is safe for her to
>    quote down a telephone, and why quoting it cannot take anybody's account.
> 3. **A Super Admin performs the association-side identity match**, using the
>    recognition the association already practises for the people it teaches.
>    **No CIN, no identity-document scan, and no invented automated identity
>    proofing** to eliminate the human step.
>
> **Only the third binds.** Until then the claim is a row and nothing else.
>
> **THE GUARDIAN IS NOT PART OF THIS.** She does not choose the address, type it
> as the authoritative identity, attest ownership, bind it, approve the
> transition or receive any credential; her own address never becomes the
> beneficiary's. The beneficiary proves control herself; the association
> confirms who she is.
>
> **Approval binds to the EXISTING `User`.** No second account is created, ever.
> Enrolments, grades, Quran progression, attendance, submissions, the reference
> code and every relationship stay on the one id.

## 3 · Proposed addition to §4.3 — authority after the transition

> **A self-managed adult is not acted for.** Once her own identity is bound she
> exercises her own account and privacy rights, and a former guardian does not
> continue to exercise them because a historical `FamilyLink` exists.
>
> **The fact is DERIVED, not stored, and it is the one §4.3 already uses:**
> R62.9 defines a minor as *an account with no login identity*. The child-context
> resolver reads that same fact, so there is one definition rather than a second
> flag that could disagree with it.
>
> **The link row is not deleted.** It is historical relationship evidence and
> stays; what ends is the **current authority** it conferred. Separating the two
> is what lets the history survive without the control surviving with it.

## 4 · The state machine

```
(no claim)
   │  beneficiary verifies a Google identity + quotes her reference code
   ▼
pending ──── Super Admin approves ───▶ approved   → identity bound to the SAME User
   │
   └──────── Super Admin refuses ────▶ rejected + soft-deleted
                                          │
                                          └─▶ she may make a NEW claim
```

`rejected` follows **R128's shape**, for R128's reason: a refusal that stays
live blocks the corrected request for ever. The decision and its reason survive
on the row and in the audit trail; only the pending slot is released, and a
retry is a **new** claim with its own history — the old one is never reopened.

**Two partial unique indexes are the concurrency rules**, both covering pending
live rows only so history blocks nothing: one pending claim per beneficiary, and
one per verified Google subject.

## 5 · What the boundaries refuse

**Uniform** (`404 CLAIM_NOT_AVAILABLE`) for every condition about the **claimed
person** — unknown code, not a beneficiary, no recorded birth date, under 18,
already holds a login, suspended, deleted, already claimed. Distinguishing them
would report whether `BA-XXXXX` exists and whether that person is a minor, which
§20 rule 17 keeps unobservable.

**Named** only for conditions about the **caller's own identity**, because those
disclose nothing she does not control: `IDENTITY_ALREADY_BOUND` (she should
simply sign in), `CLAIM_ALREADY_PENDING`, `TOKEN_ALREADY_USED` (replay).

**At approval, every precondition is re-read inside the transaction** under the
same `Email → User` locks the login path takes, because a claim may have waited
days. An existing identity is **never overwritten and never reassigned**
(`ACCOUNT_HAS_LOGIN`); both ownership channels and `(provider, subject)` are
re-checked; a beneficiary who became ineligible fails **closed** and by name
(`BENEFICIARY_INELIGIBLE`) so an administrator learns the claim is stale.

## 6 · Privacy

The audit records `selfmanaged.request`, `selfmanaged.approve` and
`selfmanaged.reject` with **ids only**. Deliberately absent: the OAuth token, the
PKCE verifier, the raw state, the Google subject, the email, the reference code
and the birth date. The review surface publishes who is claimed, which record and
which address will become the login — **the Google subject is never published**,
and the birth date is absent because it decided eligibility before the row
existed.

## 7 · TD changes

* **TD-3** gains `POST /self-managed-claims` (public, onboarding-token gated) and
  `GET`/`POST .../approve`/`POST .../reject` under `/admin/self-managed-claims`
  (Super Admin).
* **TD-2** gains one row: *decide a self-managed-account claim — Super Admin*.
* **TD-8** gains the three action types above.
* **§7** gains `SelfManagedClaim`.

## 8 · Deliberately unchanged

The OAuth flow, its PKCE and state protections, and the onboarding token's shape
and TTL — all reused, none weakened. R130's birth date, which is read and never
written here. R128's family-link lifecycle. `PATCH /admin/users/{id}`'s refusal
of `pre_provisioned_email`. R131, which remains policy and map.
