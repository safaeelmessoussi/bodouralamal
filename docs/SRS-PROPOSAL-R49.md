[Documentation](README.md) › **SRS proposal — Revision 49**

# Draft SRS Revision 49 — staff registration requests, and role assignment at approval

> **Status: PROPOSED. Not in force.** `docs/SRS.md` is immutable to implementing
> agents; this is drafted wording for the **Document Owner** to apply, amend or reject.
> **Delete it once decided.**
>
> **The change is already implemented and shipped** (2026-08-05) on the Owner's instruction
> to complete the Admin portal. This proposal records the wording; the code is not waiting.

---

## The audit that came first

The Owner asked for an audit before implementation: *"confirm whether the current endpoints
already support the workflow with only small contract extensions."* They do. **No route was
added.** The findings, because most of them were *reuse*:

| Requirement | Verdict |
|---|---|
| **Admins/Super Admins inviting or creating staff** | **Already complete.** `POST /admin/users` pre-provisions name + Google email + role + branch scope, and §4.1 calls this the first-class staff path. The Users screen exposes it. **Zero work.** |
| **Teachers requesting teacher accounts** | Worked *except for one datum* — see below |
| **Super Admin approving or rejecting them** | `GET /admin/approvals` + approve/reject already do this |
| **Assigning roles and branch scopes during approval** | One optional field on the existing approve body |

### What was actually missing: one fact, not a feature

A teacher could already self-register through the adult form, land in `Pending`, appear in
طلبات الانضمام, be approved, and then be given a role on `/admin/users`. Every step existed.

**What did not exist was any record of what the applicant asked to be.** The queue showed
names, type, bundle and branch — so a teacher applicant and a family registration were
indistinguishable, and the approver had no way to know the account needed a role at all. The
whole workflow turned on that one absence.

## What changed

```
POST /registrations                    + optional  requested_role: 'teacher'
GET  /admin/approvals                  + field     requested_role: string | null
POST /admin/approvals/{id}/approve     + optional  assignments: [{ role, branch_id }]
User                                   + column    requested_role (nullable, CHECK)
```

Four extensions to three existing contracts and one nullable column. **No new endpoint, no new
`kind`, no new screen.**

## The four questions, answered

### 1. Should `requested_role` be added to the registration payload? — **Yes**

It is the only missing datum, and nothing else can supply it: the applicant is the only party
present at registration who knows why they are registering.

**It grants nothing.** Authority lives in `user_branch_role`, written at approval. A
self-declared value that granted access would be privilege escalation by form submission.

**`teacher` is the only accepted value**, enforced by Zod *and* a database `CHECK`. An applicant
may not self-nominate for an administrator role: those accounts arrive through staff
pre-provisioning (§4.1b step 4b), an authenticated path with a named actor and an audit row.
The `CHECK` is what makes widening the set **an SRS revision rather than a code change**.

**It rides on the existing `adult` kind** rather than a third one. A teacher applying *is* an
adult registering themselves; the difference is one optional field. A `kind: 'staff'` would
have duplicated every name, consent and branch rule for an identical form — and §4.1b step 4c
names exactly two forms, so a third would be a flow the SRS does not describe.

### 2. Branch scope at registration, or only at approval? — **Approval only**

This is the load-bearing half of the design.

`branch_id` already exists on the payload (R39) and records **the branch the applicant asked
for** — explicitly *"a request, not a placement."* A **role's branch scope** is a different
thing entirely: it is an **authorization boundary** (TD-2) determining which people's records
this person may reach.

Collecting it from the applicant would let a person **propose the extent of their own
permissions**. The approver chooses it, defaulting to the branch the applicant requested — two
questions, one prefilled from the other, neither conflated.

### 3. Should approval assign role and scope in one transaction? — **Yes**

§4.1 already states that approval is *"a single administrative act that admits the applicant to
the school"*, and TD-4.2 already makes it atomic.

An account that is `Active` with **no role** is a person who can sign in and reach nothing. Two
calls would create exactly that window and leave the second one forgettable. A refused grant
**takes the activation with it**, because the transaction is atomic — a rejected privilege grant
cannot leave an approved account behind.

**The applicant's `requested_role` is never applied automatically.** It prefills the control;
the approver states the assignment, or there is none. Approving *without* a role stays a
first-class action, because refusing the role is not the same decision as refusing the person.

### 4. Extend the approval endpoint, or add a route? — **Extend**

Additive optional field on a body that already accepts one. And there is a stronger reason than
economy:

> **§4.1 (Revision 43) already specifies an approve payload that is not implemented.** It
> requires the approver to select **Levels** and, for each, one **Administrative Group**, with
> approval and every resulting `Enrollment` written in one transaction. `decide()` implements
> none of it — it only flips statuses.

So this endpoint's contract was **already meant to be richer**. Adding role assignment follows a
direction the SRS set rather than inventing one, and the transaction that R43's Levels and
Groups will eventually join is now the one this revision extends.

**That R43 gap is reported, not silently built** — it is a different feature (student placement)
and deserves its own slice. It is recorded in `TASKS.md`.

## Reuse rather than a second implementation

The grant runs through **the same function `PUT /admin/users/{id}/roles` uses**
(`applyRoleAssignments`, extracted for this). Approval therefore inherits, without a second
copy that could drift:

* only a Super Admin may grant or revoke `admin` or `super_admin`;
* branch scopes must name a live branch;
* the last active Super Admin cannot lose the role.

**Approval cannot become a second, weaker way to hand out authority.** That property is one
function, not two rules that agree today.

## Exact wording to apply

### 1. New entry in §0

> **Revision 49 (Document Owner decision — staff registration requests, 2026-08-05):** a
> prospective **teacher** could already self-register, reach the §5.6 approval queue and be
> given a role afterwards, but **nothing recorded what the applicant had asked to be**, so a
> staff request was indistinguishable from a family registration and the approver had no signal
> that a role was needed. The gap is closed by extending existing contracts — **no endpoint is
> added.**
>
> **(1) `POST /registrations` accepts an optional `requested_role` on the adult path**, whose
> only permitted value is `teacher`, persisted to a new nullable `User.requested_role` (§7) with
> a database `CHECK` — so widening the set is a revision, not a code change. **It grants
> nothing**: authority lives in `UserBranchRole`, written at approval. An applicant may **not**
> self-nominate for an administrator role; those accounts arrive through staff pre-provisioning
> (§4.1b step 4b), an authenticated path with a named actor. The value is **retained after
> approval as provenance**, like `pre_provisioned_email`.
>
> **(2) A role's branch SCOPE is never collected at registration.** `branch_id` (Revision 39)
> records the branch an applicant *asked for* — a request, not a placement — whereas a role's
> branch scope is an **access-control boundary** (TD-2). Collecting it from the applicant would
> let a person propose the extent of their own permissions. The approver chooses it, defaulting
> to the requested branch.
>
> **(3) `POST /admin/approvals/{id}/approve` accepts optional `assignments`**, granted **in the
> same transaction as the activation** (TD-4.2), because §4.1 already makes approval a single
> admitting act and an `Active` account with no role is a person who can sign in and reach
> nothing. The applicant's `requested_role` is a **hint and is never applied automatically**.
> Approving with no assignment stays the ordinary path — students and parents receive access
> through enrolment. **Rejection grants nothing**, whatever the caller sends. The grant is
> subject to the **same privilege rules as `PUT /admin/users/{id}/roles`** and is executed by
> the same function, so approval can never become a weaker path to authority; a refused grant
> **takes the activation with it**. The TD-8 row records `requested_role` and `granted` side by
> side — the gap between them is the approver's decision.

### 2. §7 — `User.requested_role`

> **`requested_role` (nullable, Revision 49).** What a self-service applicant asked to become.
> `CHECK (requested_role IS NULL OR requested_role IN ('teacher'))`. **A hint to the approver
> and never an authority** — no access follows from it. Null for every staff-created and
> family registration. Retained after approval as provenance.

### 3. §4.1 — one sentence beside the staff-registration bullet

> A prospective teacher may also **request** an account through the public adult form, recording
> `requested_role`. The request grants nothing; the role and its branch scope are assigned by
> the approver, in the same transaction as the activation.

---

## Reported, not built: §4.1's unimplemented approval payload

Revision 43 requires approval to assign **Levels and Administrative Groups** and to write the
resulting `Enrollment` rows in the same transaction. **That is not implemented** — `decide()`
only changes statuses, so an approved student is admitted to the school and enrolled in nothing.

It is out of scope here (student placement, not staff), but it belongs in the transaction this
revision just extended, and whoever builds it will touch exactly this code.
