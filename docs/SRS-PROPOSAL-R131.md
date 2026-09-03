[Documentation](README.md) › **SRS Proposal — Revision 131**

# SRS Proposal — Revision 131

**Two deletion requests, a ten-year educational retention policy, and the end of
the R111 ↔ R122 contradiction.**

**Status: RATIFIED by the Document Owner, 2026-09-03 — AWAITING APPLICATION to
`SRS.md`. POLICY AND ARCHITECTURE ONLY; NOT YET IMPLEMENTED.** The Owner's
instruction was explicit: ratify the policy first, and write no destructive
automation until the cross-domain map is coherent. The map is
[`docs/development/personal-data-map.md`](development/personal-data-map.md).
**Nothing in the platform's deletion behaviour changes with this revision** —
Option A is still R111's behaviour exactly, including clearing `referenceCode`,
which this decision will change.

---

## 1 · Proposed addition to §4.10 — the retention policy

> **Identifiable educational history is retained for TEN YEARS after the
> beneficiary's last educational activity.**
>
> This is **the association's own purpose-based retention policy** — historical
> educational continuity, answering former-beneficiary requests, and issuing or
> verifying educational attestations. **It is not a duration prescribed,
> reviewed or approved by the CNDP, and no document, screen or notice may
> describe it as one.**
>
> **"Last educational activity" is DERIVED from canonical facts**, never from a
> maintained timestamp: a dedicated column is a fact nobody updates consistently,
> and a retention clock driven by a stale one deletes the wrong records. The
> boundary is the latest of the enrolment's `AcademicPeriod` end, an attendance
> occurrence date, the date of an exam a Grade is against, a submission's instant
> and a Quran progression entry.
>
> **The long-term archive is minimal.** It keeps only what is needed to find the
> former beneficiary and substantiate an attestation: the reference code, the
> identity the attestation must name, enrolment history, Levels, academic
> periods, relevant published Grades, relevant progression evidence and the
> branch context. It does **not** keep authentication sessions, refresh tokens,
> the OAuth subject, a login email no longer otherwise required, a telephone
> number, notification state or unrelated operational metadata.
>
> **Quran progression is educational history for product purposes.** That states
> how the platform treats it and makes **no claim about its legal
> classification**, which remains explicitly open in the data inventory.

## 2 · Proposed addition to §4.10 — two requests, not one

> The platform must distinguish two requests and must never present them as one.
>
> **OPTION A — close my platform account.** Removes or de-identifies what exists
> to operate the person's online account: the Google identity, the login email
> where nothing else requires it, sessions and tokens, account-only state and
> unnecessary profile data. **The minimal educational archive is preserved** for
> the remainder of the retention period, together with the reference code and the
> identity needed to match her to it.
>
> **The archive is not anonymous because the login is gone.** The reference code
> is personal/pseudonymous data and is protected as such.
>
> **OPTION B — delete all my deletable data.** Requests deletion or
> de-identification of the personal *and educational* data the platform is
> permitted and technically able to remove: enrolment history, Grades, Quran
> progression, attendance, assessment submissions and answers, the reference code
> and the retained identity.
>
> **Option B is a REQUEST, not an immediate cascade**, and it is approved and
> executed by a **Super Admin only** — never a branch Admin, never a مؤطِّرة.
>
> **The interface must say what each one does, and must not mislead.** Option A's
> screen states plainly that account and login data are removed, that educational
> history remains, why it remains, for how long, and that a future attestation
> stays possible. Option B's screen states **before** confirmation that after
> full educational deletion **the association may no longer be able to prove the
> person's previous level or issue an attestation**. **No dark patterns**: the
> destructive option is never preselected, and Option A is never implied to
> destroy educational history.
>
> **Neither may promise "zero rows anywhere".** Narrowly necessary evidence
> survives under its own rules — the request itself, its completion, required
> security and audit facts, and consent and legal evidence. Equally, **no
> educational content may be retained under the pretext of audit** once a full
> educational deletion is approved.

## 3 · Proposed addition to §4.3 — who may ask, and for whom

> **An adult self-managed beneficiary requests for herself.**
>
> **For a minor, the request originates from an adult holding a LIVE APPROVED
> `FamilyLink`** to that minor, and full educational deletion then requires Super
> Admin review before anything irreversible happens. **One guardian's browser
> must never directly destroy a child's educational history.**
>
> **Once a beneficiary has completed the controlled transition to a self-managed
> adult account she exercises her own rights.** A former guardian does not
> exercise them for her, and a historical `FamilyLink` alone makes nobody the
> owner of an adult's account. **No legal representative is inferred beyond the
> platform's own approved relationship model, and CIN is not collected for this.**
>
> **A request that has gone stale fails safely.** If the identity or the
> relationship state changed after the request was made, it is refused and
> requires fresh review rather than executing against the state it assumed.
> Concurrency follows the existing first-wins approval conventions. The audit
> records actor, subject and decision **without unnecessary personal data in the
> detail** (TD-8, TD-14).

## 4 · Proposed addition to §4.3 — the guardian-only account after the last child

> **A guardian-only account exists because it has a child-management purpose.**
> When the **last** such relationship is deliberately and permanently removed and
> the adult has no other platform purpose, the guardian account is closed and
> de-identified through the **established account machinery** — never by a
> foreign-key cascade.
>
> **It is one controlled domain operation, and it verifies atomically** that the
> adult is guardian-only: not a beneficiary or Student, not a مؤطِّرة, not an
> Admin or Super Admin, holding no other live `FamilyLink`, holding no pending
> child relationship or application that needs the account, holding no approved
> membership or application state that needs it, and holding no other current
> legitimate purpose. **If any is false the account is preserved.**
>
> **The distinctions are load-bearing.** Removing one of several children leaves
> the guardian. A **rejected** family link (R128) while a pending
> `ChildApplication` or another child-management purpose remains does **not**
> close the account. Fully deleting the child is the same rule if that child was
> the adult's last purpose.
>
> **The decision belongs to the deliberate deletion operation**, never to a
> background sweep. A guardian who returns after a genuine closure registers
> afresh.

## 5 · Proposed addition to §4.10 — rejected and pending applications

> **A rejected application is retained for TWELVE MONTHS after rejection**, so
> the decision and its reason survive the relevant academic cycle, the
> association can recognise that the same case was refused and why, and an
> accidental re-acceptance within the cycle is avoided. After twelve months it is
> deleted or de-identified under the final retention architecture. **This is a
> maximum, not indefinite retention.**
>
> **A pending application that never becomes a beneficiary follows the same
> twelve-month maximum** from its own reference point.

## 6 · Proposed resolution of the R111 ↔ R122 contradiction

R122 committed the association to a future attestation; R111 cleared every field
that could match a returning person to her preserved record, **including
`referenceCode`**. Both were in force and neither cited the other.

> **Under Option A the reference code SURVIVES** as part of the protected minimal
> archive for the remainder of the retention period, because it is what
> reconnects a former beneficiary with her own record. **Under Option B it is
> deleted** with the identifiable educational archive. **It must never be used to
> reconstruct educational history that Option B was approved to delete.**

This supersedes the earlier instruction that the code must not be preserved.

## 7 · Proposed addition to §19 — backups

> A deletion request removes data from the **live operational system**.
> Encrypted, finite-lifetime backups may hold an older copy until they expire,
> and **no document, screen or notice may promise immediate byte-level erasure
> from backups already written**, because it is not true.
>
> **A restore must not silently resurrect deleted personal data.** The mechanism
> is to be the smallest reliable one, reusing an existing reconciliation ledger
> where one exists rather than inventing a subsystem.

## 8 · What this revision deliberately does NOT do

* **It implements nothing.** No behaviour changes; no purge job exists; Option B
  does not exist; `referenceCode` is still cleared by `deIdentifyAccount`.
* **It does not touch the active `LegalConsentText`.** The decisions above will
  require the privacy wording to change, and that wording is drafted, reviewed
  and activated by the Document Owner — never autonomously. The required changes
  are recorded in `TASKS.md`.
* **It makes no legal claim.** The ten-year period is the association's own
  policy; the classification of Quran progression stays open; and nothing here
  is presented as CNDP guidance.
* **It does not authorise a purge job.** The seven reconciliations named in the
  data map are the precondition, and a partial purge that claims data is gone
  while obvious copies remain is worse than none.

## 9 · Deliberately unchanged

R111's classification for Option A in every particular except `referenceCode`;
BR-15's ninety-day Trash window and R111's three-day account window; R128's
family-link lifecycle; TD-5 soft delete; TD-8 audit minimisation; every consent
rule in §4.1a; and R59.4's quarantine-destruction question, which remains open
and is not authorised by anything here.
