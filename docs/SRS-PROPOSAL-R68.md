[Documentation](README.md) › **SRS proposal — Revision 68**

# Draft SRS Revision 68 — the identity-binding review item, given a mechanism

**Status: specifying a behaviour Revision 62 already mandates.** §4.3 and R62.9
say what must happen; neither says how, and the how needs a column, a queue
type and an audit row. This revision supplies exactly those and nothing else.

> **§4.3 (R62.9):** *"When a minor gains a login, existing parent links are NOT
> revoked automatically: binding a first identity to a student who has approved
> links raises a **non-blocking review item**, and an administrator decides."*

It is the last open item of Revision 62.

---

## 68.1 — Why it is reachable, and therefore worth building

A child created by approval has no email and no `UserIdentity`, so it cannot log
in. The path that produces the state R62.9 describes is the **staff one**:

1. staff pre-provision a student against a Google address
   (`POST /admin/users` writes `pre_provisioned_email`);
2. a parent is linked to them — **permitted**, because R62.9 restricts linking
   to accounts with no `UserIdentity`, and a pre-provisioned account has none;
3. the student signs in for the first time. `bindIdentity` creates the identity
   (§4.1b step 4b), and a **minor with parents attached is now a person with
   their own login**.

Nothing about that sequence is exotic — it is how an older student who
previously had a parent acting for them starts acting for themselves.

## 68.2 — What is raised, and what stays untouched

**A `FamilyLink` gains `identity_review_raised_at`** (nullable). Binding a first
identity stamps it on **every approved, live link naming that student**, in the
same transaction as the binding (§4.1b step 4b is already transactional).

**Non-blocking is the whole point, and it is structural rather than promised:**

* the links keep working — nothing reads the stamp for authorization, and
  `resolveActingStudent` is unchanged;
* the student keeps their new login;
* the binding **cannot fail** because of it: the stamp is an `updateMany` on
  rows the transaction already touches conceptually, and no branch of
  `bindIdentity` refuses.

**A single nullable timestamp, not a status.** The link's own `status` is a
decided value (TD-1) and overloading it would make *"is this link approved"* and
*"has anyone looked at this"* one question. The stamp is cleared when an
administrator decides, and the decision itself lives in the audit trail — which
is where *who looked at this child's arrangement, and when* belongs.

## 68.3 — It appears in the approvals queue as a fourth type

`GET /admin/approvals?type=identity-review`, **one item per student**, grouping
every stamped link. It carries the student and the parents attached to them,
because the decision is about that relationship rather than about one row.

**Derived, exactly like the other three.** Nothing is enqueued; the item exists
while a stamped, approved, live link does. That is what makes the queue
incapable of showing an item nobody can act on.

**No branch.** The queue's `branch` filter excludes the type, for the reason
Revision 43.3 gave about Teaching Groups: the entity has no branch of its own,
and resolving one through the student's enrolment would make one filter mean two
different things.

## 68.4 — The two outcomes

Decided through the existing `POST /admin/approvals/{id}/approve|reject`:

| | Meaning | Effect |
|---|---|---|
| **approve** | *the links stand* | clears the stamp; the links are untouched |
| **reject** | *this person now acts for themselves* | soft-deletes the links — §4.3's revocation mechanism since Revision 16 — and clears the stamp |

**Rejection requires a reason**, as every rejection in this queue does (§5.6).

**`familylink.identity_review` joins TD-8**, recording the student, the links and
the outcome. `familylink.revoke` already exists and is written by the rejection
path, so the trail carries both *what was decided* and *what it did* — one row
would have had to mean both.

## 68.5 — Deliberately NOT in this revision

* **No automatic revocation at majority.** R62.9 records that whether the law
  compels it is **pending legal/CNDP confirmation**, and nothing here assumes an
  answer. An administrator decides, every time.
* **No age, no birth date.** The trigger is structural — *this account gained a
  login* — which is the same reasoning §4.3 uses to define a minor without one.
* **No new endpoint.** The queue and its two verbs already exist.

## 68.6 — Audit against the live architecture

| Claim | Status |
|---|---|
| `bindIdentity` is the single place an identity is born on login | **[CODE]** `user.repository.ts`, and its doc comment says so |
| It already runs inside a transaction | **[CODE]** `auth.service.ts` step 4b |
| Linking is restricted to accounts with no active identity | **[CODE]** `child-application.service.ts` (`ACCOUNT_HAS_LOGIN`) |
| Staff pre-provisioning writes `pre_provisioned_email` | **[CODE]** `user.service.ts` |
| The queue derives all three existing types from live rows | **[CODE]** `approval.service.ts` |
| Soft-deleting an approved link IS revocation | **[SRS]** §4.3, Revision 16 |
| `familylink.revoke` is already in TD-8 | **[SRS]** TD-8 grid |

**One nullable column, one TD-8 row, one queue type. No new endpoint, no
authorization change, and nothing that can refuse a login.**
