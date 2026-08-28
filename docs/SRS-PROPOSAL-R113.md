[Documentation](README.md) › **SRS Proposal — Revision 113**

# SRS Proposal — Revision 113

**The association's partners are reference data a Super Admin owns, and the
landing page renders what that table holds.**

**Status:** **PROPOSED — awaiting the Document Owner.** The decisions are already
recorded (OD-01's sub-decision; the NEW N brief); what is proposed is the
**normative wording, five TD-3 routes and one §14.1 node**, because `docs/SRS.md`
is the Document Owner's to edit.

**The implementation ships with this proposal** and is complete apart from the
four names — see §5.

> **Two guards are correctly refusing this work until the SRS lists it**, and
> both are the mechanism working:
> `check-openapi-td3.sh` (§20 rule 16 — an endpoint the registry does not list)
> and `admin-modules.test.ts` (*"a path added here that the sitemap does not
> list is exactly what §20 rule 16 forbids"*).

---

## 1 · Why a table rather than four lines of copy

§5.1's public sections already work this way: **the branch directory renders what
the database holds**, so opening a branch is an administrative act rather than a
deployment. Partners are the same kind of fact and get the same treatment — a
partner added in the back office appears on the landing page with no frontend
change and no release.

## 2 · A partner is a NAME

No logo, no URL, no description, no contact. The brief is explicit that none of
it may be invented, and a column exists for a fact the platform holds rather than
one it might. **An empty logo frame on a public page is worse than no frame**: it
reports an absence the data does not have. Adding a logo later is a column and a
migration — nothing here forecloses it.

## 3 · `is_visible` is not `deleted_at`

Withholding a partner from the site while a relationship is renewed is an
ordinary thing an association needs, and it is **not** the same act as removing
the record. Two questions, two columns — and the management table shows both, so
*not on the site* is never mistaken for *deleted*.

## 4 · The section renders NOTHING when no partner is visible

Specified behaviour, not a degraded one, and it is why this section differs from
the branch list beside it. **An empty branch list is a fault** — the association
has premises, so an empty answer means something went wrong and the section says
so. **Having no partners is an ordinary state**, so a heading over an empty area
would be the page reporting an absence nobody asked about. The failure case is
treated the same way: a public page degrades by leaving the section out.

## 5 · What is NOT done, and cannot be

**The four canonical partner names are not recorded anywhere in this
repository.** They are referred to as already provided; a full-text search of
`docs/`, the task log and the change log finds no names. The seeder therefore
ships with an **empty list and an explanatory line**, because §2's rule forbids
inventing one and a name is the *whole* of what this entity holds.

Nothing is broken by that: §4's section renders nothing, and a Super Admin can
enter all four through the back office without a deployment. Filling the array
affects **fresh installs only**.

## 6 · Proposed TD-3 entries

> `GET /partners` — **public**, unauthenticated. The landing section's only
> source. Live and visible rows, ordered by `display_order` then name (BR-19).
> Exactly `id` and `name`. **Unpaginated**: the set is bounded by the
> association's real relationships, and a public section showing a subset would
> misstate who its partners are.
>
> `GET /admin/partners` · `POST /admin/partners` ·
> `PATCH /admin/partners/{id}` · `DELETE /admin/partners/{id}` — **Super Admin
> only** (OD-01's sub-decision), asserted in the service. The management read
> returns every live partner including withheld ones, with the TD-15 `version`.
> `DELETE` is TD-5 soft delete; **nothing references a Partner**, so no
> blocked-delete case arises.

**The public and management representations are two DTOs, not one with a
filter** — building the public shape by trimming the management one is how a
field added for the back office reaches a public page (§16.2 Revision 38).

## 7 · Proposed §14.1 node

> **الشركاء** — `/admin/partners`, inside **الإدارة**, Super Admin only.

Placed after **أنواع الجدولة** and before **سلة المحذوفات**, which is this
section's own stated logic — the dependency chain, then the standalone nodes —
and where R110 put the scheduling-type catalogue for the same reason. **R105's
sequence is extended, not reinterpreted.**

## 8 · Proposed TD-2 row

> **Manage the partner catalogue** — Super Admin ✔, all other roles ⊘.

## 9 · What this proposal does not change

R61, R105's order, R110, and every existing catalogue's authority. No public
surface other than the landing section. No new authorization concept: this is
`SUPER_ONLY` reference data, of which the platform already has several.

---

*Nothing in `docs/SRS.md` has been edited — that is the Document Owner's.*
