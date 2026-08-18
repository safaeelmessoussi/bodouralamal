[Documentation](README.md) › **SRS Proposal — Revision 80**

# SRS Proposal — Revision 80

**Sex is recorded for every person at creation, completed explicitly where it is
missing, and then required by the schema.**

**Status:** **APPLIED** to `docs/SRS.md` on 2026-08-18, on the Document Owner's
decision (*"Every person created in the platform must have sex recorded at
creation … Existing people whose sex is missing must be completed explicitly by
an authorized administrator; it must never be inferred. Once all live records are
complete, contract the column to NOT NULL."*).

---

## 1 · What the audit found

R27 made `sex` the person-side half of `Level.gender_restriction` and required it
**at registration**. The audit of every write path found the rule was enforced on
exactly one road into the system and on none of the others:

| Path | Captures `sex` today |
|---|---|
| `POST /registrations` — adult and children | **Yes, required** (§4.1b step 5) |
| `POST /child-applications` | **Optional** — accepted without one |
| `POST /admin/users` — staff pre-provisioning | **No field at all** |
| Super Admin bootstrap seed | **No** |
| Any update path — profile, admin edit, approval | **None can write it** |

So a person created by staff acquired no sex **and had no way ever to acquire
one**: the column was write-once at registration and immutable thereafter. That
is why `NOT NULL` was unreachable by migration alone, and why the previous report
stopped short of it.

## 2 · The proposed revision

> **Revision 80 (Document Owner decision — sex is captured at every creation and
> completed explicitly, 2026-08-18):** **(1) Every path that creates a person
> captures `sex`.** It becomes **required** on `POST /admin/users` and on the
> child-application path, joining the registration path that already required it
> (R27). There is no longer a road into the system that produces a person without
> one. **(2) The Super Admin bootstrap supplies it too**, through
> `SUPER_ADMIN_SEX` beside `SUPER_ADMIN_EMAIL`, and on the same terms: a
> **seed-only** value that the running API never reads (TD-13, R23), demanded
> **only when the seed actually creates an account** and failing loudly by name
> when it must and cannot. Granting Super Admin to an **existing** person asks
> for nothing, because that person already has a sex. **(3) A missing sex is
> COMPLETED, never inferred.** `PATCH /admin/users/{id}` accepts `sex` **only
> while the stored value is absent**; supplying one for a person who already has
> a recorded sex is refused (`SEX_ALREADY_RECORDED`). Completion is an
> administrative act about a person's record and is **audited** (TD-8) like every
> other. **Nothing derives it** — not a name, not a role, not a Category, not a
> title. **(4) Correction is deliberately NOT introduced.** Changing a recorded
> sex is a different decision, with different consequences for placements already
> made, and the Owner has not asked for one; a completion path is not quietly a
> correction path. **(5) The column becomes `NOT NULL`**, once no live person
> lacks a value. The migration **verifies and refuses** rather than defaulting: if
> any row is still missing one it aborts naming the count, because a default here
> would be the inference this revision exists to forbid. **(6) The field stays
> off every contract** (R79.8's rule, unchanged): staff record it and the server
> reasons with it; no response publishes it.

## 3 · What this costs

| | |
|---|---|
| **Schema change** | One column contracted to `NOT NULL`. No table, no new column. |
| **New endpoints** | **None** — completion rides `PATCH /admin/users/{id}`. |
| **New env** | One **seed-only** value, on `SUPER_ADMIN_EMAIL`'s existing terms. |
| **Migration risk** | The migration **aborts** rather than inventing values. |
| **Breaking changes** | `POST /admin/users` gains a required field — an admin-only surface with one caller. |

## 4 · What was approved

1. `sex` required on every creation path, including staff pre-provisioning.
2. `SUPER_ADMIN_SEX`, seed-only, demanded only when creating.
3. Completion through `PATCH /admin/users/{id}`, **only while absent**, audited.
4. **No correction path** — flagged rather than assumed.
5. `NOT NULL`, with a migration that refuses instead of defaulting.
