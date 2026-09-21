[Documentation](README.md) › **SRS Proposal — Revision 168**

# SRS Proposal — Revision 168

**One registration form, several roles: a person asks for every role she needs
at once, the Super Admin decides each role separately, and a first-time
مستفيدة orders the memorisation circles that suit her.**

**Status: PROPOSED — awaiting the Document Owner (2026-09-21). Nothing here is
implemented, and `SRS.md` is unchanged by it.** Requested by the Owner as item 6
of the Revision 167 batch. It is a proposal rather than code because it reverses
four rules the SRS states today (§2), and those are the Owner's to reverse.

---

## 1 · What was asked

1. A person may request **several roles in one form**: مستفيدة; guardian
   registering children; teaching staff (مؤطِّرة / مساعدة); administrative staff
   (إدارية / مساعدة إدارية).
2. The form is the **union of the fields each chosen role needs, each asked
   once** («full outer join, no duplicates»).
3. Guardian data is asked for a child registration **unless another adult role
   is also selected** — that role already collects the same person's data.
4. The Super Admin **approves or declines each role separately**.
5. «أسجّل نفسي كمستفيدة» asks *is this your first time?*; if yes, she **orders
   the memorisation-circle slots that suit her** — one, two or three, most
   convenient first. Given data: **المرأة · المستوى الأول · مقر تاركة** —
   Tuesday 15:00–20:00, Thursday 09:00–12:00, Saturday 15:00–20:00; تفسير is
   Wednesday 09:00–12:00 for everybody and is not a choice. Other Levels offer
   no choice. أمرشيش's split comes later.

## 2 · What the SRS says today, and would have to change

| Today | Where | The change |
|---|---|---|
| A registration has **one `kind`**: `adult` or `parent_child`. A staff request rides on `adult` as a hint. | §4.1b, `registrationSchema` | One request carries a **set of role requests**. |
| `User.requested_role` is **one value, constrained in SQL to `teacher`**; «administrator accounts arrive through staff pre-provisioning — an authenticated path with a named actor». | §4.1b step 4b, R49, the column's CHECK | Administrative staff may **ask** through the public form. *Asking still grants nothing* (§3.3). **This is the policy reversal that most needs the Owner's explicit yes.** |
| Approval decides the **account** (`pending → active`) and places the مستفيدة in the same act. | §5.6, `approval.service.ts` | Approval decides **each role request**; the account becomes active with the **first** approved one. |
| A مستفيدة states no scheduling preference; the approver places her. | §5.6, R66 | A first-time مستفيدة states an **ordered preference**; the approver still places her. |

Unchanged, and deliberately: identity comes only from the verified Google token
(§20 rule 9); registration is atomic with its consent records (TD-4.1); a
self-declared value is **never** an authority (R49); children are
`ChildApplication`s approved one by one (R62); twelve-month retention of an
undecided application and the rejected-registration purge (§4.10a).

## 3 · Proposed model

### 3.1 `role_request` — one row per role asked for

```
role_request
  id              uuid pk
  user_id         uuid  → user            (the applicant)
  role            enum  student | guardian | teacher | teaching_assistant
                        | admin | admin_assistant
  branch_id       uuid? → branch          (where she asks to serve / study)
  status          enum  pending | approved | declined | withdrawn
  decided_by      uuid? → user
  decided_at      timestamptz?
  decline_reason  varchar(500)?           (operator-facing, never shown raw)
  created_at      timestamptz
  UNIQUE (user_id, role) WHERE status = 'pending'
```

`user.requested_role` stays as provenance for rows written before this revision
and is no longer written. A `guardian` request exists exactly when the form
carries children: it is what lets her standing as a guardian be declined while
another role of hers is approved, and the reverse.

### 3.2 The state machine

```
            ┌────────────── withdrawn (by the applicant, while pending)
pending ────┼────────────── declined  (Super Admin, reason recorded)
            └────────────── approved  (Super Admin) → writes user_branch_role
```

* **The account** is `pending` until its first role is approved, then `active`.
  All declined → the account follows today's rejected-registration path
  (§4.10a) unchanged.
* **Approving `student`** is today's approval verbatim — placement through
  `enrolAtPlacement`, R27 sex eligibility, BR-21 — with the preference list
  (§3.5) shown beside the placement control.
* **Approving a staff role** writes `user_branch_role` for the requested branch
  (editable by the approver), exactly as pre-provisioning does today.
* **Approving `guardian`** approves the adult as a parent; each child remains
  its own `ChildApplication` decision (R62) and cannot be approved before her.
* Each decision is its own audited act; a later role can be requested from
  «حسابي» through the same table (no second mechanism).

### 3.3 Why a public request for an administrative role is safe to allow

The risk R49 guarded against is *privilege by form submission*. It stays
impossible: a `role_request` row is read by exactly one screen (§5.6) and
written to `user_branch_role` by exactly one act — a Super Admin's approval,
audited with her name. What changes is only that the request may be *stated*.
Two cheap protections are proposed with it: administrative requests are
**rate-limited per Google account and per IP** like registration itself, and the
approvals screen lists them under their own heading so they are never approved
in a batch with beneficiaries.

### 3.4 The form — the union of fields, each once

| Field group | student | guardian | teaching staff | admin staff |
|---|:-:|:-:|:-:|:-:|
| Identity: Arabic name, French name, sex, birth date, phone, city | ● | ● | ● | ● |
| Branch asked for | ● | — | ● | ● |
| Category/Level interest · first time? · circle preference (§3.5) | ● | — | — | — |
| Children (each: name, sex, birth date, Level interest) | — | ● | — | — |
| Relationship to each child | — | ● | — | — |
| Subjects and Categories she can teach · availability | — | — | ● | — |
| Consents (platform terms · data processing · recordings) | ● | ● | ● | ● |
| Child consents (given by the guardian, per child) | — | ● | — | — |

* **Identity is asked once whatever is ticked** — this is the Owner's
  «full outer join». The guardian block therefore *disappears* when any other
  adult role is ticked, because it is the same person's identity; it appears
  only for a guardian-only registration. One `User` row either way.
* A field a role does not need is not asked and not stored (data minimisation,
  Loi 09-08 art. 3) — the union is computed from the ticked roles, never «ask
  everything».
* The server validates the same union (a Zod schema built from the role set),
  so a client cannot omit a required group or smuggle an unasked one
  (`.strict()`).

### 3.5 Circle-slot preference

**Where the options come from — never typed into the form.** A slot is a
memorisation **class that exists**: a live `RecurringCourseSchedule` of the
tracker Subject (`tracks_quran_progress`), addressed to a حلقة (`TeachingGroup`)
of the Level she asks for, **at the branch she asks for**. Its weekday and
times are the schedule's own. So the Owner's Targa data is *entered once, as
three scheduled classes*, and the form, the calendar and the approver read one
truth. A Level/branch with one such class, or none, asks nothing — which is
exactly «other Levels have no choice», with no list of exceptions to maintain,
and أمرشيش starts offering choices the day its classes are scheduled.

> A حلقة has no branch of its own (§4.4c, R43.3) — the branch is the class's.
> The proposal relies on that as it stands and changes nothing in it.

```
circle_preference
  role_request_id   uuid → role_request (student)
  teaching_group_id uuid → teaching_group
  rank              smallint  (1 = most convenient)
  PRIMARY KEY (role_request_id, teaching_group_id)
  UNIQUE (role_request_id, rank)
```

* She ranks **one to all** of the offered slots (drag, or ↑/↓ buttons —
  keyboard and phone operable); unranked means «cannot attend».
* تفسير is shown as information («الأربعاء 09:00–12:00 للجميع»), read from its
  own scheduled class, never as a choice.
* At approval the ranked list appears beside the حلقة control, with each
  circle's current head-count; the approver decides. **A preference is a
  wish, never a seat** — no capacity rule is proposed here.
* *First time?* = **no** asks instead for the Level she last attended
  (free choice of Level, no circle ranking): a returning مستفيدة is placed by
  the administration, who know her.

### 3.6 Consent and CNDP

One consent set per **person**, recorded once against the active
`LegalConsentText` version as today — not once per role. Child consents stay
per child, given by the guardian. The registry entry
([personal-data audit](compliance/personal-data-audit.md)) gains `role_request`
and `circle_preference`: purpose *processing a registration*, retention
following the application's (§4.10a), no new recipient, nothing leaves the
Morocco-hosted database.

## 4 · What it costs

| Piece | Size |
|---|---|
| Migration (`role_request`, `circle_preference`, back-fill one request per existing pending applicant) | small |
| `registration.service` + validators: role-set union, atomic write | medium |
| `approval.service` (1,205 lines): per-role decisions, account activation on first approval | **large — the risky part** |
| `/register` (997 lines): role picker, conditional groups, slot ranking | large |
| §5.6 approvals screen: per-role cards | medium |
| Tests: union matrix (15 role combinations), per-role decisions, slot sourcing, a real-browser journey | medium |

Roughly one revision the size of R163. It can ship in two safe halves:
**(A)** role requests + per-role approval, **(B)** first-time question + circle
preference. (B) is independent and much smaller; it could go first.

## 5 · The decisions only the Owner can make

1. **May administrative staff ask through the public form at all** (§3.3),
   or do they stay on pre-provisioning, with the form offering only مستفيدة /
   guardian / teaching staff? *Recommended: allow, with the two protections.*
2. **Is «مساعدة» a role or a position?** Today `teacher` and `admin` are the
   only two staff roles; an assistant is a *staffing position on a class*
   (R91), and «مساعدة إدارية» does not exist. *Recommended: the form offers
   four labels but stores two roles plus an `as_assistant` flag the approver
   sees — no new permission level is invented.*
3. **When roles are decided at different times, when does the applicant hear?**
   *Recommended: one notification per decision.*
4. **Does a declined role block asking again?** *Recommended: no — like a
   rejected family link since R128, a declined request leaves the unique index.*
5. **The slots are scheduled classes (§3.5) — agreed?** It means the three
   Targa حلقات must exist as three scheduled memorisation classes before the
   form can offer them (they may already).
6. **«First time?» = no** — is asking for her last Level enough, or should she
   also rank circles?
