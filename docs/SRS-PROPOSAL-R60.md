# SRS Revision 60 — proposal

**Title:** The Active Role — a session-scoped authorization context, so a person
holding several roles works as exactly one of them

**Status:** Document Owner decisions taken 2026-08-11; drafted for the record
**Amends:** §7 (JWT claims), §2.1, §4.2, §4.3, TD-12, TD-8
**Author:** implementation session, 2026-08-11

---

## 60.0 — What this is, and what it is not

**Framing accepted by the Document Owner, and recorded first because it governs
every decision below:** the Active Role is a **safety** mechanism, not a
containment boundary.

Switching is self-service and instant — no re-authentication, no approval. A
Super Admin acting as مؤطِّرة can return to Super Admin in one click. So this
**cannot** defend the platform against a Super Admin who intends harm, and no
design permitting instant self-service switching could.

What it does deliver, and what it was approved for:

* **A Super Admin can test the platform exactly as a Teacher, Admin or Student
  experiences it** — the stated goal — rather than approximating it from a
  different navigation.
* **Blast-radius reduction.** While acting as مؤطِّرة, an accidental click cannot
  delete a branch or purge a record: the authority is genuinely absent.
* **Least privilege by default** for staff whose daily work is a lesser role.

Anything that reads as *containment* is out of scope and must not be implied by
the implementation.

---

## 60.1 — `active_role` becomes a JWT claim

§7 enumerates the access-token claims exhaustively — `sub`, `roles[]`,
`role_scopes[]`, `account_status`, `iat/exp` — and adds *"No PII beyond these."*
That list is amended to include:

```
active_role: string | absent
```

**When present, the token is already narrowed.** `roles[]` and `role_scopes[]`
carry **only** that role's entry. This is the load-bearing design decision, and
the reason is mechanical rather than stylistic: every authorization decision in
the platform reads one of those two fields, so narrowing them at the point of
issue narrows **every** call site at once — 103 references across 28 files —
without editing any of them. A service cannot consult an un-narrowed array
because no un-narrowed array exists in that request.

**When absent, behaviour is exactly as today**: every held role, every scope.
Required for single-role accounts, for tokens minted before this revision, and
for the no-switcher case.

**`roles[]` stays derived from `role_scopes[]`** at issue time (§7's existing
rule, so the two cannot disagree). Filtering the input therefore narrows both,
which matters because **fourteen call sites read `roles[]` directly** rather than
going through the scope helpers.

### Why this differs from the active child, which §7 forbids as a claim

§7 states the active child *"is never a JWT claim"*, because per-request
assertion *"keeps child switching instant (no re-issue)"* and keeps a revoked
link effective immediately.

That reasoning does not transfer, and the difference is worth stating so the two
rules are not later "harmonised" in the wrong direction:

| | Active child (§4.3) | Active role (this revision) |
|---|---|---|
| Names | *Whose data* is being read | *Which authority* is being exercised |
| Switching frequency | Constant, per page | Rare, deliberate |
| Re-issue cost | A round trip per switch — prohibitive | One round trip per switch — already paid |
| Freshness need | Immediate: a revoked link is a safeguarding failure | Bounded by TD-12, which already re-checks high-risk paths per request |

A role is **already** re-read from live rows on every refresh, so putting it in
the token costs nothing that is not already spent.

---

## 60.2 — The invariant

**`active_role`, when present, is always one of the account's live assignments.**

Enforced at three depths, all of them existing machinery:

1. **At issue.** `/auth/switch-role` and `/auth/refresh` both re-read
   `UserBranchRole` and refuse to mint a token for a role the rows do not carry.
2. **At refresh.** Every hour at most, the same re-read happens (§60.4).
3. **Per request, on high-risk paths.** TD-12 freshness re-checks that the
   **active** role is still assigned (§60.5).

A token whose `active_role` is not backed by a live row cannot be produced by the
platform, and one presented from elsewhere fails signature verification. There is
no fourth case.

---

## 60.3 — Switching

```
POST /auth/switch-role   { "role": "teacher" }
  → re-read live UserBranchRole rows
  → 403 unless `role` is among them
  → mint an access token narrowed to it
  → audit `auth.role_switch`
  → 200 { access_token, expires_at, active_role }
```

**No logout, no refresh-cookie change, no new session.** One indexed query and
one signature.

**Stateless — no `active_role` column anywhere**, on `User` or on
`RefreshToken`. The Document Owner's decision, and the architecture supports it:
the claim lives in the token, and the token is per-device.

**Concurrent devices therefore differ by construction.** Two browsers hold two
access tokens; each carries its own `active_role`; neither can affect the other.
No coordination, no shared row, nothing to reconcile.

---

## 60.4 — Refresh is the load-bearing path, and it fails safe

**The client holds the access token in memory only**, and the role switch
navigates by full page load — so the token is discarded and re-acquired from
`POST /auth/refresh` on the very next page. Refresh, not the switch endpoint, is
what makes an active role persist through normal use.

`POST /auth/refresh` therefore:

* **accepts a requested `active_role`** and validates it against the live rows it
  already reads;
* **returns `active_role` explicitly** in its response, so the client is never
  guessing what authority it holds;
* **fails safe when the requested role is gone** (Document Owner decision): it
  does **not** silently restore unrestricted multi-role authority. It falls back
  to another still-valid assigned role — the most privileged remaining, matching
  the login default — and returns that role, so the client can tell the person
  what happened.

**Omitting the field is not the same as losing the role.** A request with no
`active_role` yields an un-narrowed token (§60.1). That is the honest reading of
"the client did not ask to be narrowed", and it restores the account's real
authority rather than granting anything it lacks — but a client that *has* an
active role and forgets to send it will silently widen. The client is therefore
required to persist and re-assert it on every refresh.

---

## 60.5 — TD-12 freshness

TD-12 re-reads the caller from the database on high-risk endpoints and
**rebuilds roles from live rows, ignoring the token**. Left alone, that would
mean **exactly the most dangerous endpoints keep full Super Admin authority
while everything else narrows** — the worst possible split, and the single
largest risk this revision carries.

`assertFreshActive` therefore becomes active-role aware:

* it checks that the **active** role — not merely *some* held role — is still
  assigned;
* the roles and scopes it **returns** are narrowed to the active role, because
  six callers use that return value for subsequent scope decisions.

TD-12's guarantee is unchanged and now applies to the role actually being
exercised.

---

## 60.6 — Authorization semantics are unchanged

§4.2 is **not** amended. *"Scope resolves per role, never as a flat union across
roles"* stands exactly as written; the array simply has one entry. Branch
scoping is preserved by construction, since the retained entry keeps its own
`branches` (`null` = all branches for that assignment).

Two consequences follow and are stated so they are not later mistaken for bugs:

* **`branchesForRole` short-circuits on `isSuperAdmin(scopes)`.** Narrowed to
  `teacher`, that short-circuit correctly stops applying. This is the mechanism
  by which Super Admin authority actually disappears.
* **A Super Admin acting as مؤطِّرة is refused by `isSuperAdmin` at all 44 call
  sites**, including the Trash's destructive verbs. That is the point of the
  feature, not a regression.

---

## 60.7 — §4.3 and the Student/Parent case

§4.3 resolves the acting student by testing whether *"the caller holds the
Student role"*. Under this revision that test reads the **active** role, which
the Document Owner has decided:

> Acting as Parent uses Parent behaviour; acting as Student uses Student
> behaviour.

So a person holding both:

* **active role `student`** → the §4.3 bypass applies; the acting student is the
  caller, verified against the token subject. No header.
* **active role `parent`** → no bypass; `X-Active-Child-ID` is required and
  verified against an `Approved` link, exactly as for a parent who is not also a
  student.

This makes the two paths reachable deliberately rather than by an accident of
which roles the account happens to hold, and it removes an ambiguity §4.3 has
carried since it was written.

---

## 60.8 — Audit

**`active_role` is recorded on every audit row** (Document Owner decision),
alongside — never instead of — `actor_user_id`.

**The account remains the accountable identity.** The active role records *the
capacity in which the person acted*, which is a different question from *who
acted*, and answering only the second has been enough to make a trail
ambiguous: *"the Super Admin deleted it"* and *"the Super Admin, working as
مؤطِّرة, deleted it"* describe different events.

Carried in `detail`, which every row already has, so **no schema change**.

---

## 60.9 — `/me`

`GET /me` continues to report **every currently assigned role**, plus the active
one. The switcher's menu is built from that list, so narrowing it would remove
the person's ability to switch back — the one place where the un-narrowed set is
the correct answer.

`/me` and authorization therefore read **different fields on purpose**, and that
is the rule: `/me` answers *what may this person become*, authorization answers
*what is this person now*.

---

## 60.10 — What is deliberately not built

* **No re-authentication to escalate.** Follows from §60.0: this is not
  containment, and adding a password prompt to a switch would imply otherwise.
* **No `active_role` persistence server-side** — no column on `User`, none on
  `RefreshToken`. Revisit only if refresh-forgetting proves real in use.
* **No per-role UI beyond what §14.1 already defines.** The portals exist; the
  active role selects between them.
