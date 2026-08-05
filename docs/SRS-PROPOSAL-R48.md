[Documentation](README.md) › **SRS proposal — Revision 48**

# Draft SRS Revision 48 — user management, and who may create an administrator

> **Status: PROPOSED. Not in force.** `docs/SRS.md` is immutable to implementing
> agents; this is drafted wording for the **Document Owner** to apply, amend or reject.
> **Delete it once decided.**
>
> **The endpoints are already implemented and shipped** (2026-08-05) on the Owner's
> instruction to make the Admin portal operable end to end. This proposal records the
> wording; the code is not waiting on it.

---

## What §5.6 already documents, and what it does not

§5.6 lists the Users screen's capabilities in one line:

> **User Management (`/admin/users`)** — search (fields: TD-10), filter, list, create (staff
> pre-provisioning against a Google email), **edit**, approve, reject, **deactivate**,
> **role/branch-scope assignment**, consent-record management.

Four of those had endpoints (search/filter/list, create, approve/reject, consents). **Edit,
deactivate and role/branch-scope assignment had none.** They join TD-3 under the same
**Revision 21 pattern** that admitted Branches, Rooms and the curriculum taxonomy: a screen the
SRS mandates documents the endpoints its own §14.2 standard requires.

```
PATCH /admin/users/{id}              → the person's own fields          Admin+
POST  /admin/users/{id}/suspend      → TD-1 Active → Suspended          Admin+
POST  /admin/users/{id}/reactivate   → TD-1 Suspended → Active          Admin+
PUT   /admin/users/{id}/roles        → replaces the assignment set      Admin+ (see below)
```

`GET /admin/users` now also carries **`version`**, so the edit dialog has the TD-15 value to
send back. This is the same choice made for `GET /admin/subjects` in R47 and for the same
reason: a second single-user read would be a parallel projection of one concept, kept in step
by hand.

## Three decisions that are genuinely new

Everything else follows existing clauses. These three do not, and each is the kind of thing
that should be settled in the specification rather than in a service file.

### 1. Suspension is its own verb, not a field on the edit

`PATCH` **refuses** `account_status` rather than dropping it. TD-4.15 requires the transition
to `Suspended` to revoke **every** live `RefreshToken` in the same transaction; a client that
set the field on the edit endpoint and received `200` would believe access had been withdrawn
while a 30-day credential was still live.

This is the same reasoning §4.4/TD-3.12 already applies to `PATCH /sessions/{id}`, which
refuses `status` because cancelling carries obligations a field assignment cannot. **Proposed:
state it once as a general rule** rather than a third time per endpoint — *a status whose
transition carries an obligation is never a writable field.*

### 2. `super_admin` is assignable through the application

`POST /admin/users` has always excluded `super_admin` from its assignable set, on the reasoning
that §15.1 bootstraps it and the database is authoritative thereafter.

**That reading is too narrow, and Revision 22 says so directly:** after bootstrap, *"every
subsequent change of administrators — assignment, promotion, demotion, suspension — happens
**exclusively through the application**"*. If no endpoint may grant the role, the only route to
a second Super Admin is the lockout-recovery seed, which needs `DATABASE_URL` and a shell on
the VPS — the opposite of *exclusively through the application*.

**Proposed:** `PUT /admin/users/{id}/roles` may grant and revoke `super_admin`, **and only a
Super Admin may do so** — the same privilege-propagation rule `POST /admin/users` already
applies to `admin`. Creation keeps its narrower set: pre-provisioning an unclaimed account
directly into the platform's highest role is a different risk from promoting an account that
already exists and has been approved.

### 3. The last active Super Admin cannot lose the role

Revision 22 documents the lockout as an intended **recovery** path: suspend or delete every
Super Admin and `SUPER_ADMIN_EMAIL` becomes live again. Reaching it requires a VPS shell and a
manual `npm run seed:production`.

That is a sanctioned recovery, **not an outcome a back-office control may produce with one
click**. Both `PUT .../roles` and `POST .../suspend` refuse when the target holds the last live
`super_admin` assignment (`409 STATE_CONFLICT`, `reason: LAST_SUPER_ADMIN`). Self-suspension is
refused separately (`SELF_SUSPENSION`) — an administrator who suspends themselves is locked out
by their own next request.

**Proposed:** state the guard normatively beside Revision 22's recovery path, so the two are
read together.

## One thing deliberately NOT done, and the clause that decides it

**A role change does not revoke sessions.** An access token keeps the old scopes for up to an
hour on ordinary routes, and it would be easy to argue for revoking. **Revision 10 already
resolves this trade-off the other way:** every safeguarding-sensitive operation re-asserts the
caller's live assignments per request (`assertFreshActive`), so a revoked role stops mattering
*immediately where it matters*, and the stateless window is explicitly accepted elsewhere —
*"acceptable for reading one's own schedule, not for safeguarding-sensitive reads."*

There is a second, harder reason: **§7 fixes `RefreshRevokedReason` at four values** — `logout`,
`suspension`, `user_deleted`, `reuse_detected`. None honestly describes a demotion, and reusing
`suspension` would make the audit trail say something untrue about why access ended. Adding a
fifth value is a §7 schema change, and it should be the Owner's decision rather than a side
effect of building a screen.

**If the Owner wants revocation on role change, the change is: one enum value, one migration,
one line in `setUserRoles`.**

## Also not done, and why it is not an omission

**There is no `DELETE /admin/users/{id}`.** §5.6 lists *deactivate*, not *delete*, and TD-5's
soft delete of a person reaches grades, submissions, Quran logs, consent records and family
links. Suspension covers the operational need this milestone has; a user soft-delete is a
safeguarding and data-retention decision (§2.3, BR-15's 90-day window) that deserves its own
revision rather than arriving as part of a CRUD screen.

## Exact wording to apply

### 1. New entry in §0

> **Revision 48 (Document Owner decision — user management joins TD-3; administrators are
> managed through the application, 2026-08-05):** §5.6 lists *edit*, *deactivate* and
> *role/branch-scope assignment* among the Users screen's capabilities and TD-3 documented no
> endpoint for any of them. **Four operations join TD-3** —
> `PATCH /admin/users/{id}`, `POST /admin/users/{id}/suspend`,
> `POST /admin/users/{id}/reactivate` and `PUT /admin/users/{id}/roles` — under the Revision 21
> pattern. `GET /admin/users` gains `version` so the edit form has the TD-15 value, for the
> reason R47 records for `GET /admin/subjects`.
>
> **Three normative rules.** **(1)** `account_status` is **refused** on the edit endpoint, not
> ignored: TD-4.15 binds the transition to `Suspended` to revoking every live `RefreshToken` in
> the same transaction, and a status whose transition carries an obligation is never a writable
> field — the rule TD-3.12 already applies to `PATCH /sessions/{id}`. **(2)** `super_admin`
> **is** grantable and revocable through `PUT /admin/users/{id}/roles`, **by a Super Admin
> only**, which is what Revision 22's *"exclusively through the application"* requires;
> `POST /admin/users` keeps its narrower set, because pre-provisioning an unclaimed account
> into the highest role is a different risk from promoting an approved one. **(3)** The **last
> active Super Admin cannot be stripped of the role or suspended** (`409 STATE_CONFLICT`,
> `reason: LAST_SUPER_ADMIN`), and **no administrator may suspend their own account**
> (`SELF_SUSPENSION`). Revision 22's lockout-recovery path stands unchanged — it requires
> `DATABASE_URL` and a manual seed run, and is a recovery rather than something a back-office
> control may cause.
>
> **Deliberately unchanged:** a role change does **not** revoke sessions (Revision 10 accepts
> the ≤1-hour stateless window for everything that is not safeguarding-sensitive, and §7's
> `RefreshRevokedReason` has no value that honestly describes a demotion), and **no user-delete
> endpoint exists** — §5.6 lists *deactivate*, and a person's soft delete reaches grades,
> submissions, Quran logs and consent records, which is its own decision.

### 2. TD-3.2 — extend the user-management list

> Add the four operations above beside `GET`/`POST /admin/users`, with the refused keys named:
> `account_status`, `pre_provisioned_email` (it authorises *claiming* an account, §7 R15) and
> `public_display_name` (§20 rule 21 resolves the published identity server-side).

### 3. §5.6 — no change needed

The capabilities are already listed there. This revision supplies the endpoints they implied.
