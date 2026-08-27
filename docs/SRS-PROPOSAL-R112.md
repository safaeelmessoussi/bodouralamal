[Documentation](README.md) › **SRS Proposal — Revision 112**

# SRS Proposal — Revision 112

**Global account administration is Super Admin's. Picking a person while doing
operational work is not account administration, and keeps its own smaller read.**

**Status:** **PROPOSED — awaiting the Document Owner.** The decisions are already
the Owner's (clarification of 2026-08-28); what is proposed here is the
**normative wording and the one TD-3 route**, because `docs/SRS.md` is the
Document Owner's to edit.

**The implementation ships with this proposal.** It implements the ratified
decisions, not this text — if the Owner's wording differs, the code changes.

> **This is the one thing that blocks CI.** `scripts/ci/check-openapi-td3.sh`
> enforces §20 rule 16 — *an endpoint in the API document that is not in TD-3 is
> forbidden* — and it is **correctly failing** on `GET /admin/directory` until
> TD-3 lists it. The guard is working; it needs one line only the Owner may add.

---

## 1 · The Owner's decisions

1. Every authenticated user may **soft-delete their own account** — Student,
   Teacher, Admin and Super Admin alike.
2. A Super Admin may delete their own account **only while another active Super
   Admin remains**.
3. **Only a Super Admin may delete another user's account.**
4. On المستخدمون a Super Admin may act on any account: **soft delete**, and
   **permanent delete** where R111's classification allows.
5. **المستخدمون is Super-Admin-only**, enforced **server-side**.
6. **Ordinary role-specific management screens stay separate** from global
   account administration.

## 2 · Why decision 6 requires a route, and why it is a SMALLER question

`GET /admin/users` served two unrelated purposes under one role list:

- **global account administration** — every person, their address, their status,
  their roles, and the power to edit, suspend or delete the account;
- **picking a person while doing operational work** — staffing a class,
  enrolling a beneficiary, filling a roster.

Decision 5 removes the first from Admins. Decision 6 says that must not remove
the second. **Five screens** read this endpoint purely to render a list of names:
مجموعات المستويات, حصص الجدول, المستفيدات, الجدولة and المؤطِّرات.

**This is R93's rule applied again, not a new pattern.** R93 states it in terms:

> *the fix for a screen that cannot work is a smaller question, never a wider
> permission.*

R93 answered *whom may I name here* with `GET /me/event-staff-options` rather
than widening `/admin/users`. This answers *whom may I staff, enrol or roster*
the same way — and it is genuinely **smaller**, not a relaxed copy:

| | `/admin/users` | `/admin/directory` |
|---|---|---|
| who | **Super Admin** | Admin or Super Admin |
| fields | id, name, nickname, **email, phone, account_status, version**, roles | id, name, nickname, roles |
| branch scope | §4.2 R25 | **identical — the same query** |
| writes beneath it | yes | none |

The existing `/me/event-staff-options` does not cover this: it is *active
teaching staff* for the caller's own events, and three of the five screens need
beneficiaries or the full teaching roster.

**The projection is the security property, not a convenience.** Five screens were
receiving every user's email, phone and account status in order to draw a list of
names.

**The scope rule is shared rather than copied.** Both surfaces run one unexported
query that asserts no role of its own, so they cannot drift on *which rows* a
branch-scoped Admin may see while differing on *what is returned about them*.

## 3 · Proposed TD-3 entry

> `GET /admin/directory` — **Admin or Super Admin.** The operational
> people-picker. Returns exactly `id`, `name_arabic`, `nickname` and `roles`,
> branch-scoped identically to `GET /admin/users` (§4.2 Revision 25). Filters
> `role`, `branch_id`, `beneficiaries_only`; TD-10 search and paging. **No write
> exists at this path.** It carries no address, no phone, no account status and
> no TD-15 `version`, because a picker can do nothing that would need them.

## 4 · Proposed TD-2 change

The row *"Create/edit users; assign roles & branch scopes"* moves from **Admin +
Super Admin** to **Super Admin**. A new row records that an Admin may **read the
operational directory**.

## 5 · §20 rule 17 is preserved, by uniformity rather than by 404

The rule says an out-of-reach row answers `404`, never `403`, because *"exists,
but not yours"* is itself a disclosure. That was the right shape while an Admin
could edit **some** accounts.

An Admin is now refused the **capability**, not the row — so **`403` is the
non-disclosing answer**, and uniformity is what makes it so: the same status
returns for an out-of-scope user, a user in the caller's own branch, and an id
that does not exist. Nothing in the response varies with the target.

The scope-based rule has not gone away. It **moved to `/admin/directory`**, where
a branch-scoped Admin *is* authorized and out-of-scope people simply do not
appear — asserted at the HTTP boundary.

## 6 · What this proposal does not change

R111 stands in every particular: the de-identification model, the 3-day
restoration window, OD-07's re-registration rule, historical-record retention,
and the staff-responsibility BLOCK. Nothing here touches teaching authority
(§4.4c), `PURGE_WINDOW_DAYS`, or R59.4's open quarantine decision.

---

*Nothing in `docs/SRS.md` has been edited — that is the Document Owner's.*
