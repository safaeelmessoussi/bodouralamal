[Documentation](README.md) › **SRS Proposal — Revision 128**

# SRS Proposal — Revision 128

**A rejected family link is soft-deleted with its decision. Rejection and
revocation become one shape, and R118.3's special-case purge route is
withdrawn.**

**Status: RATIFIED by the Document Owner, 2026-09-03 — AWAITING APPLICATION to
`SRS.md`.** The behaviour is implemented, migrated and tested; the clauses below
are the exact text the Document Owner applies.

---

## 1 · The measured finding

`FamilyLinkStatus` is `pending | approved | rejected`, and the TD-6 partial
unique index is

```
family_link_student_parent_active_key UNIQUE (student_id, parent_id) WHERE deleted_at IS NULL
```

A **revoked** link is soft-deleted, so it leaves the index and the pair is free
to be requested again — §4.3 says so in terms. A **rejected** link was never
soft-deleted, so it stayed **live** and occupied that index **forever**.

**The weaker outcome was therefore the more permanent one.** An adult whose
request was refused because the relationship was recorded wrongly could never
submit a corrected request for the same child; an adult whose *approved*
authority was deliberately revoked could. The only way out was for an
administrator to invoke a destructive route — a **deletion performed to enable a
correction**, which is not what that route was designed for.

## 2 · Proposed amendment to §4.3

> **A rejection is recorded and then withdrawn from the live set.** Deciding a
> pending link as `rejected` writes, atomically: the `rejected` status, the
> decision instant, the deciding administrator, the decision reason where one is
> given, `deleted_at`/`deleted_by` **stamped with that same instant**, a Trash
> snapshot carrying the decision itself, and a `familylink.reject` audit row
> carrying both party ids and the reason and **no name** (TD-14).
>
> **The lifecycle is therefore one shape with two endings:**
>
> ```
> pending → approved → (revoked: soft-deleted, Trash, audit)
> pending → rejected + recorded → soft-deleted, Trash, audit
> ```
>
> **A corrected request is a NEW `pending` row** with its own id and its own
> history. The old refusal is never reopened, reused or overwritten: **no
> `rejected → pending` transition exists and none may be added.**
>
> **Live uniqueness is unchanged.** One live row per `(student, parent)` still
> refuses a second pending request and a request against an approved link. Only
> the rejected row leaves the live set.
>
> **A rejection grants nothing, and is refused twice over.** It never granted
> authority; it is now also soft-deleted, which is already a `404` condition for
> the `X-Active-Child-ID` resolver.
>
> **A rejected link can never be restored into live authority.** `FamilyLink` is
> absent from the Trash restore plan and blocked as `CASCADE_RELATIONSHIPS`, so
> a generic restore is refused by name however senior the caller.

## 3 · Revision 118 clause (3) is superseded

R118.3 created `DELETE /admin/family-links/{id}/rejected` and the audit action
`familylink.purge_rejected` because a rejected link *"had no transition to leave
by, which is why it accumulated"*. That reading was right about the symptom and
treated it at the wrong end: the row accumulated because it was **live**, and
R128 removes the reason rather than giving the row a special exit.

**Withdrawn in their entirety:**

* the route `DELETE /admin/family-links/{id}/rejected` — removed from TD-3, the
  router, the controller, the service, the OpenAPI document and its tests;
* the audit action `familylink.purge_rejected` (TD-8);
* the refusal code `NOT_TERMINAL_REJECTED`, whose only thrower it was.

**Nothing is lost by the withdrawal.** A rejected link now enters Trash like any
other soft-deleted record, under BR-15's ninety days, and `PURGEABLE` already
carried `FamilyLink` — so the ordinary lifecycle performs exactly what the
special route performed, with one implementation instead of two. Keeping both
would leave two competing deletion lifecycles for one entity, which is how a
destructive verb reaches the wrong row.

**The historical §0 text for R118 is NOT edited.** It records what was decided on
2026-09-02 and on what basis; this revision states the correction as its own
clause, exactly as R126 handled R59's expired rationale.

## 4 · One implementation, because a rule stated twice drifts

Two paths decide a link — the registration bundle and the standalone queue item
— and both previously wrote the same four-field update inline. They now share
`decideLink`, which owns the status write, the rejection's tombstone and
snapshot, and the audit row for **both** arms.

The registration bundle therefore **gains** a per-link audit row it never had: it
wrote `user.reject` alone, so a link's decision was attributable only through its
parent, and §20 rule 11 requires a destructive step to carry its own evidence.

## 5 · Migration

`20260904110000_soft_delete_rejected_family_links` brings rows decided **before**
this change to the same state — otherwise a family rejected last month stays
blocked forever while one rejected tomorrow does not.

Each affected row is tombstoned with **its own decision instant**, never
`now()`: the deletion *is* the decision, and stamping today would claim the
refusal happened today. `decided_by` becomes `deleted_by` for the same reason,
and a row with no `decided_at` falls back to `created_at` so no edge case leaves
a row live. **No status changes and nothing is destroyed** — only two nullable
columns are written. A Trash entry is written for each, skipping rows that
already have one, so the sweep is idempotent.

Verified read-only before it was written: **Localhost — 3 family links (1
pending, 1 approved, 1 rejected, all live).** Staging was not queried in this
session and Production is not deployed. Proved against the existing local
database and against a fresh disposable one.

## 6 · Deliberately unchanged

* **Revocation** in every particular: the reason requirement, the
  `only an approved link can be revoked` refusal, the Trash snapshot, the audit
  row and immediate effect on the next request (TD-12).
* **R68's identity review**, which soft-deletes an already-**approved** link —
  that is a revocation, a different transition, and it is untouched.
* **TD-1** — no new state and no new transition; `rejected` stays terminal.
* **TD-2** — no role gains or loses a capability.
* **BR-15's ninety-day window** and every other Trash rule.
* **`createLink`**, which already blocked only on live rows and therefore needed
  no change for a corrected request to succeed.
