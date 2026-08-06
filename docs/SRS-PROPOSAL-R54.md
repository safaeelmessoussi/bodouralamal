[Documentation](README.md) › **SRS proposal — Revision 54**

# Draft SRS Revision 54 — account deletion, and permanent deletion from the Trash

> **Status: DRAFT — awaiting the Document Owner.** Unlike R53, this one is **not** applied,
> because it reverses a prohibition the Owner set eight days ago (R52) *and* because the
> capability it asks for depends on work R52 deliberately deferred. Both points are below.
>
> Raised in response to the Owner's direction, quoted verbatim:
>
> > *"any user should be able to delete his/her account, that gets moved to trash, and super
> > admin can review that delete, permanently delete it or restore it. All deletes in the
> > platform should be soft deletes appearing in the trash, then in the trash, permanently
> > delete can happen by super admin."*

---

## What the specification says today

**Three separate clauses, and none of them provides an endpoint.**

* **§4.10:** *"Two-step account self-deletion."* Five words. No route in TD-3, no state in TD-1,
  no screen in §14.1.
* **§5.6 and §14.2** give the Users screen *Edit, Approve/Reject, **Deactivate**, Consents* —
  **deletion is not among them**, and `deactivate` (`account_status → suspended`) is a distinct
  operation that TD-1 defines and that already ships.
* **TD-8** lists `user.delete` in the audit grid — so deletion is *contemplated* and its
  accountability is specified, while the act itself has nowhere to happen.
* **R52 (2026-08-05):** *"No permanent-delete action exists, and none may be added without a
  further revision."*

So three of the Owner's five points need this revision, and the fourth — that every soft delete
reaches the Trash — was a **defect**, now fixed, that needed no revision at all.

## The three additions

### 1. `DELETE /admin/users/{id}` — Super Admin deletes an account

Soft delete, `Trash` snapshot, TD-4.15 refresh-token revocation in the same transaction, and a
`user.delete` audit row. Guarded by the two invariants user management already enforces: **never
the last Super Admin**, and **never yourself** (an administrator who deletes their own account
mid-session is a support incident, not a workflow).

### 2. `POST /me/deletion-request` and `POST /me/deletion-request/confirm` — §4.10's two steps

The two steps are what §4.10 asks for, and they are two because the act is irreversible from the
person's side: the first records the intent, the second performs it. **The account is not
purged** — it is soft-deleted like any other record and appears in the Trash for Super Admin
review, which is exactly what the Owner asked for.

**A Super Admin cannot self-delete through this route either**, for the reason above; the last
one especially, since it would leave the platform unadministrable.

### 3. `DELETE /admin/trash/{id}` — permanent deletion, Super Admin only

This **reverses R52's prohibition**, which is why it needs the Owner's signature rather than my
judgement. What it does: removes the record and its `Trash` row for good, and — where the entity
owns storage objects — deletes those too. Audited as `trash.permanent_delete`, and that action
type is **excluded from the `audit.purge` allowlist**, so the record of the destruction outlives
the thing destroyed.

**The BR-15 note R52 made still stands and should be recorded rather than dropped:** the 90-day
window exists for legal and safeguarding reasons, and this control bypasses it. The Owner has
now decided that a Super Admin may do so deliberately. That is a legitimate decision; it is
simply not one an implementing agent may take on its own, and R52 said so explicitly.

## The dependency the Owner should know about before approving

**"Super admin can … restore it" is the expensive half, and it is the half R52 deferred.**

R52 shipped restore for `Branch`, `Category`, `Subject` and `Room` — the types whose deletion is
*guarded* rather than cascading — and refused every other type loudly. `User` is the hardest
case in the platform, and §7 states why in its own words:

> a User restored without their links, enrollments and roles is a **half-restored, silently
> broken account**

Restoring a person means reinstating **six relationship types** — `FamilyLink`, `Enrollment`,
`StudentTeachingGroup`, `CourseScheduleStaff`, `UserBranchRole` and `UserIdentity` — each with
its own rule for what happens when the *related* row was itself deleted meanwhile. A student's
Administrative Group may be gone; a teacher's schedule may have been split.

**So this revision has two deliverables, and only the first is small.** Deleting accounts and
purging them permanently is a day's work. **Restoring them correctly is the milestone-sized
piece**, and shipping the delete without it would leave the platform able to bin a person and
unable to bring them back — the worst of the three possible states.

### What I recommend, and why

**Ship them in this order, in one revision but two slices:**

1. **Deletion and permanent deletion first** (points 1–3 above), with `User` still marked
   `CASCADE_RELATIONSHIPS` in the Trash — so a Super Admin can delete an account, see it listed,
   and destroy it deliberately, while the screen says plainly that restore is not yet available
   for this type.
2. **`User` restore second**, as its own slice: the snapshot already captures what is needed
   (this revision requires it), and the reinstatement is then written and tested per relationship
   with the *related-row-missing* rule stated for each.

The alternative — holding the whole feature until restore is proven — is defensible, and it is
the Owner's call. What should **not** happen is a Restore button on a `User` row before the six
reinstatements behind it are tested, because that button would report success and leave a person
enrolled in nothing.

## Exact wording to apply, if the Owner accepts

### 1. New entry in §0

> **Revision 54 (Document Owner decision — account deletion and permanent deletion, 2026-08-06):**
> §4.10 asked for *"two-step account self-deletion"* and gave it no endpoint, no state and no
> screen; §5.6 offered *deactivate* and never *delete*; TD-8 already listed `user.delete`. Three
> routes close that: **`DELETE /admin/users/{id}`** (Super Admin; soft delete + `Trash` snapshot
> + TD-4.15 token revocation in one transaction; never the last Super Admin and never oneself),
> **`POST /me/deletion-request`** and **`/confirm`** (§4.10's two steps; the account is
> soft-deleted and reviewable, never purged by the person themselves), and
> **`DELETE /admin/trash/{id}`** (Super Admin only), which **supersedes Revision 52's prohibition
> on permanent deletion**. BR-15's ninety-day window remains the default and remains enforced by
> `content.quarantine-purge`; this is a deliberate override of it by the one role that may take a
> data-retention decision, audited as `trash.permanent_delete` and **excluded from the
> `audit.purge` allowlist**, so the record of a destruction outlives what it destroyed.
> **Restore for `User` is NOT part of this revision** and keeps R52's refusal until the six
> relationship reinstatements §7 names are written and tested — a Restore button on a person
> before then would report success and leave them enrolled in nothing.

### 2. TD-3.4 — the routes

> ```
> DELETE /admin/users/{id}          → Super Admin. Soft delete + Trash snapshot + TD-4.15
>                                     revocation, one transaction. 409 LAST_SUPER_ADMIN;
>                                     409 SELF_DELETE_FORBIDDEN
> POST   /me/deletion-request       → records the intent, returns a short-lived confirmation
> POST   /me/deletion-request/confirm → performs it (§4.10 two-step)
> DELETE /admin/trash/{id}          → Super Admin. PERMANENT (R54, supersedes R52). Removes the
>                                     record, its Trash row, and any storage objects it owns
> ```

### 3. TD-8 — one row

> | `trash.permanent_delete` *(Revision 54)* | entity, target id, the snapshot's identifying fields, and the actor. **Never purgeable** — the account of a destruction must outlive the thing destroyed |

### 4. §4.10 — replace the five-word clause

> Replace *"Two-step account self-deletion."* with the two-step flow above, stating that a
> self-deletion produces a **soft delete reviewable by a Super Admin**, not a purge.
