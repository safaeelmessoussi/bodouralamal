[Documentation](README.md) › **SRS Proposal — Revision 79**

# SRS Proposal — Revision 79

**A beneficiary is a durable fact about a person, independent of every role.**

**Status:** **APPLIED** to `docs/SRS.md` on 2026-08-18, on the Document Owner's
explicit decision (*"A beneficiary must be structurally and durably identifiable
in the data model"*), together with the enumerated prohibitions on defining one
by role, by enrolment, by social profile, or by a consumed registration field.

---

## 1 · The audit that came first

Every existing durable concept was checked before proposing a new one, and each
fails for a reason worth recording — because each is the answer somebody will
reach for again.

| Candidate | Why it cannot answer *is this person a beneficiary* |
|---|---|
| The `student` **role** | A minor beneficiary holds **no role row at all** (§4.3), and one account may legitimately hold both `teacher` and `student`. Roles say what a person may *do* in the system, not what they *are* to the institute |
| An existing **`Enrollment`** | **Circular at runtime**: enrolment cannot be the precondition for being enrollable, and a beneficiary between enrolments would cease to be one |
| **`StudentSocialProfile`** | Created by staff *later*, for safeguarding (§4.10). Most beneficiaries never have one, and having one is not what makes somebody a beneficiary |
| **`requested_role` / `intended_category_id`** | Written at registration and **cleared at approval** (`approval.service.ts`) — deliberately, because they are *request* fields consumed by the decision. Measured on live rows: 0 of 13 populated |
| **`FamilyLink`** | Says who may act *for* a child, not whether the child is enrolled at the institute |
| A **person-type enum** | Would make the classifications mutually exclusive, which the domain contradicts: a مؤطرة may study, a guardian may not |
| A general **capability/profile mechanism** | **None exists.** Every model in §7 is a concrete domain entity; there is nothing to reuse |

**No existing concept answers it.** The gap is real, and it is why the enrolment
selector has always offered every active account.

## 2 · The proposed revision

> **Revision 79 (Document Owner decision — beneficiary status becomes a durable
> fact, 2026-08-18):** **(1) `User` gains `is_beneficiary`** (§7), a non-null
> boolean defaulting to `false`. It records that **the institute has accepted
> this person as one of its مستفيدات**, and it is the single authoritative answer
> to that question. **(2) It is INDEPENDENT of every role.** A person may be a
> beneficiary and staff; a minor beneficiary holds no role at all (§4.3); a
> guardian who does not herself study is not a beneficiary; a Super Admin is not
> one unless she is. Nothing may be inferred in either direction, and TD-2 is
> untouched — this grants no permission and revokes none. **(3) It is set at
> APPROVAL, not at request.** A registration or child application *asks*; the
> approval that accepts a person as a beneficiary sets the fact, **in the same
> transaction that clears the request fields** — which is precisely the failure
> R79 exists to prevent, since `requested_role` and `intended_category_id` are
> consumed by the decision and cannot carry it afterwards. Staff approvals set
> nothing. **(4) It is DURABLE.** Ending an enrolment does not clear it; holding
> zero enrolments does not clear it; enrolling again later needs no re-approval.
> A person accepted once remains a beneficiary until a deliberate act says
> otherwise. **(5) No revocation workflow is created**, because the SRS defines
> none and inventing one would be adding a lifecycle nobody has asked for. The
> field is writable by the same authority that manages a person's record, and
> that is the whole of it for now. **(6) `Enrollment` is EVIDENCE, never the
> DEFINITION.** A live or historical enrolment proves the institute already
> treated the person as a beneficiary, so it is authoritative for **backfilling**
> existing rows — and it must never be consulted at runtime to decide the
> question, which is the circularity in (1). **(7) The beneficiary selector on
> `تسجيل مستفيدة` returns exactly the active beneficiaries**, whatever their
> roles, whatever their enrolments, and independently of every other field on the
> form. `مستفيدات المجموعة` keeps its own narrower population — the beneficiaries
> already enrolled in that Group's Level and Branch — because the two dialogs ask
> different questions. **(8) The flag is not published on any public contract.**
> It is a fact about a person's relationship with the institute; the admin
> surfaces that need it read it server-side, and no anonymous or student-facing
> response carries it.

## 3 · Why a boolean, and not something larger

A `Beneficiary` **entity** was considered and rejected: it would carry one field,
have no lifecycle of its own, no attributes the SRS names, and no scoping —
`Enrollment` already holds every *placement* fact, per Level and per Branch. An
entity existing only to carry a boolean is a join nobody needs.

**When the fact acquires attributes** — a start date, a reason, a revocation —
it earns a row of its own. It has none today, and TD-8's audit trail already
records who set it and when.

## 4 · What this costs

| | |
|---|---|
| **Schema change** | **One column**, non-null with a `false` default. No table. |
| **Migration risk** | Additive; the default makes it safe on a populated table. |
| **Backfill** | From enrolment evidence, which is conclusive (6). Rows with no evidence stay `false` and are **reported, never guessed**. |
| **TD-2 rows** | **None** — it grants nothing. |
| **Public contract** | **Unchanged** (8). |

## 5 · What was approved

1. `User.is_beneficiary`, non-null, default `false`.
2. Independence from roles, in both directions.
3. Set at **approval**, in the transaction that clears the request fields.
4. Durable across enrolment ending and re-enrolment.
5. Enrolment as **backfill evidence only**, never the runtime definition.
6. No revocation workflow invented.
