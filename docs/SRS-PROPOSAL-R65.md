# SRS Proposal — Revision 65

**Status: authorised by the Document Owner (2026-08-11), who specified the model
and asked for the design to be decided here** — *"Child registration is not a
capability specific to Adult Student or Parent … Therefore I want a
role-independent Personal/Account section available to every account type …
Child registration must be accessible from this personal section regardless of
the user's active role. Do not require someone to be a Student or Parent merely
to register their child."*

---

## 65.1 — The audit's finding: the model already exists and was not used

**§5.2 is titled *Shared / Cross-Role*, and `Profile (/profile)` is already in
it.** §14.1 lists the node. Neither has ever been implemented, and Revision 64,
looking for somewhere to put the child-registration page, put it under
**`/dashboard/student/`** — a *role's* area.

That is the conflict, and it is R64's, not the Owner's request:

| | Where R64 put it | What the document says |
|---|---|---|
| Child registration | `/dashboard/student/register-child` | an act of a person, reachable by any account |
| Personal section | did not exist | §5.2 *Shared / Cross-Role*, `/profile` |

**§4.3's own wording is the same mistake in prose:** *"a parent … submits a
child-registration request from the role switcher's «＋ تسجيل طفل» action; an
adult student submits one from their own student area."* Two role-shaped entry
points for one act — while R62 had already unified the act itself into **one
service and one endpoint**. `submitChildApplications` performs **no role check
by design**, and `POST /child-applications` requires only an authenticated
active account.

**So a Teacher who is not a student could already submit one.** The interface
simply gave her nowhere to do it. This revision is a **navigation correction; no
authorization changes.**

## 65.2 — `/profile` is the personal section, and it is role-independent

Implemented as §5.2 already places it: reached from the header's account menu
(`الحساب`) by **every** authenticated account, whatever its active role, and
carrying the acts that concern *the person* rather than a capacity they are
working in:

* **their own details** — name, nickname, phone, email, sex, account status, and
  the reference code where one exists;
* **editing the part that is theirs to edit** (65.4);
* **registering one or more children**, and the status of the requests they have
  already made (`GET /child-applications/mine`, already registered by R62).

**It is not gated by role, and that is the point.** §14.4's no-permission state
does not apply: every account has a person behind it.

## 65.3 — `/profile/register-child` replaces R64's node

The page moves verbatim; only its address and its entry point change. §14.1's
`/dashboard/student/register-child` is removed — R64.3 introduced it eight hours
earlier and no data depends on it.

**The Student Dashboard keeps no registration link.** A person acting as a
student who wants to register their child goes to their personal section, like
everyone else. One entry point, not one per role — which is what stops the field
sets diverging again, the exact failure R64 was written to repair.

**`ولي الأمر` is unchanged and stays unchanged.** The Parent role is about
reaching **already-approved** children; selecting `ولي الأمر` → a child remains
the way into that child's Student Dashboard, and **no registration action goes
in it**.

## 65.4 — `GET /profile` and `PATCH /profile` join TD-3.1

§5.2 asks for *"view/edit own basic contact info (sensitive profiling fields
remain restricted)"* and **no endpoint exists** — `GET /me` answers *which
account is this* (roles, scopes, status, approved child links) and deliberately
carries no personal detail (R63).

```
GET   /profile  → { id, name_arabic, name_french, nickname, phone, email, sex,
                    account_status, reference_code, version }
PATCH /profile  → { phone?, nickname?, version }
```

**`PATCH` accepts two fields, and the exclusions are the specification, not an
oversight:**

| Field | Why the person cannot change it here |
|---|---|
| `name_arabic` / French names | **Identity, not contact detail.** §1.1 has the server compose the name from parts collected once; a rename is a staff act on the §14.2 screen, where it is reviewable |
| `sex` | Feeds §4.4b's `Level.gender_restriction`; self-editing it would let someone move themselves past an admission rule |
| `email` | The Google identity the account is keyed to (§4.1b) |
| `account_status` | A decision, made by an approver (TD-1) |
| Everything under §4.10 / BR-16 | Never reachable here — those are staff-only safeguarding records |

**TD-15 optimistic locking applies** (`version` in, `409 VERSION_CONFLICT`
otherwise), and the write reuses the **existing `user.update` audit action** —
this is the same act as a staff edit, performed by a different actor, and a
second action name would split one question across two rows.

**Own row only.** The endpoint takes no id: the subject is the JWT `sub`, so
there is nowhere for a caller to name someone else — the same argument R63 made
for `GET /students/me`.

## 65.5 — Account deletion is NOT built here, and the reason is on record

The Owner's list includes *"requesting permanent account deletion"*. §4.10 does
say *"two-step account self-deletion"* — five words, with no route in TD-3, no
state in TD-1 and no screen in §14.1 — and **`docs/SRS-PROPOSAL-R54.md` drafted
exactly this and has never been approved**, because it reverses Revision 52's
prohibition (*"no permanent-delete action exists, and none may be added without a
further revision"*) and depends on work R52 deferred.

**So the personal section offers no deletion control.** Building an
irreversible, unapproved capability because a page now exists to host it would be
the worst possible reading of this revision. **R54 remains the Owner's decision**
and, once taken, its screen belongs here — which is the one thing this revision
settles about it.

## 65.6 — Audit against the live architecture

| Claim | Status |
|---|---|
| `/profile` is already in §5.2 *Shared / Cross-Role* and §14.1 | **[SRS]** §5.2, §14.1 |
| It has never been implemented | **[CODE]** `route.ts` has no `profile` case; `user-menu.tsx` says the account nodes "join it when they exist" |
| `POST /child-applications` checks **no role** | **[CODE]** `child-application.service.ts` — the absence is documented and deliberate |
| So a Teacher could already submit one | **[INFER]** from the above: the route is on the `guarded` router and nothing narrows it |
| No self-service profile read or write exists | **[CODE]** TD-3 registers `PATCH /admin/users/{id}` only |
| `user.update` is the action already used for this act | **[CODE]** `user.service.ts` |
| R54 is drafted and unapproved | **[CODE]** `docs/SRS-PROPOSAL-R54.md`, status line |

**No TD-2 row changes, no schema change, no migration.** The only new authority
is a person editing two fields of their own row.
