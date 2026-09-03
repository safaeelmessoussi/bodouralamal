[Documentation](README.md) › **SRS Proposal — Revision 130**

# SRS Proposal — Revision 130

**Every beneficiary carries a full date of birth. Eighteen establishes
eligibility for a self-managed account and triggers nothing.**

**Status: RATIFIED by the Document Owner, 2026-09-03 — AWAITING APPLICATION to
`SRS.md`.** Implemented, migrated and tested; the clauses below are the exact
text the Document Owner applies.

---

## 1 · Proposed addition to §4.1

> **A FULL DATE OF BIRTH IS REQUIRED FOR EVERY BENEFICIARY** — adult women,
> teenagers and children alike.
>
> **It is not required merely because somebody holds a platform account.** A
> guardian-only adult (R129) is admitted to nothing and is not asked; a staff
> request is not a beneficiary admission and the field is **refused** on it
> rather than ignored, because accepting one would collect a beneficiary's
> personal datum from somebody who is not one. A guardian who later applies as a
> beneficiary supplies it through that application.
>
> **Its purposes are exactly four**: establishing minor/adult status; supporting
> age-appropriate placement; supporting registration and placement decisions; and
> establishing eligibility for the controlled transition to a self-managed
> account. **It informs placement and gates nothing** — no Level is assigned from
> it, on the R62.6 rule that a student older than the usual age still belongs
> where her schooling puts her.
>
> **A full calendar date is stored and an age is never stored.** An age is wrong
> the day after it is written; it is derived at the moment it is needed. It is a
> TD-11 calendar date, never an instant — an instant would put a person's
> birthday a day earlier for half the world.
>
> **It is not an identifier.** It names nobody, and nothing may look a person up
> by it.

## 2 · Proposed addition to §4.3 — eighteen years

> **EIGHTEEN YEARS IS THE THRESHOLD FOR INDEPENDENT ACCOUNT MANAGEMENT, AND IT
> ESTABLISHES ELIGIBILITY ONLY.**
>
> Turning eighteen must **not** automatically bind an identity, revoke a
> `FamilyLink`, change authority, change roles, create an account or perform any
> background transition. **There is no birthday job and none may be added** — an
> account that changes hands while nobody is looking is an account nobody
> decided to hand over.
>
> The transition itself is a separate, explicit, controlled workflow, specified
> in its own revision.

## 3 · Where the value lives

**`User.birth_date` is the durable answer** — one person, one row, beside `sex`,
which is the other fact captured about the person themselves.

**`ChildApplication.birth_date` is the submitted answer.** A child `User` does
not exist until approval (R62), so the application carries it exactly as it
already carries the name parts, `sex` and the schooling stage, and **approval
materialises the same calendar date unchanged** onto the row it creates. This is
the existing application→approved-record convention, not a second source of
truth: after approval the `User` column is authoritative, and the value is
copied rather than recomputed so the two cannot disagree.

**One module owns the rule.** `lib/birth-date.ts` holds the parse, the real
calendar check, the future bound, the plausibility floor and the eighteen-year
predicate. Four boundaries need the same answer and one of them has a
safeguarding consequence, so the arithmetic is not repeated in a validator or a
service. The browser runs a deliberately **thinner** pre-check — no eligibility
rule, no plausibility floor — so it can only be quieter than the server, never
in conflict with it.

## 4 · Legacy rows, stated honestly

Read-only before the migration was written: **Localhost — 73 users (18 live), 25
beneficiaries, 0 with a birth date, 4 child applications.** Staging was not
queried; Production is not deployed.

**No date is fabricated, and none is inferred** — not from a Category, a
schooling stage, an enrolment, an age-like label or a row's creation date — and
no sentinel is used, because a sentinel is indistinguishable from a recorded
fact a year later.

**The column is therefore nullable and the requirement lives at the write
boundary**, exactly as R122 did for `enrollment.academic_period_id`. Every new
beneficiary carries one; no historical row is rewritten; a legacy row stays
**visibly incomplete** until somebody who knows records the real date.

**The CONTRACT phase (`NOT NULL`) is not performed and cannot honestly be
performed until every live beneficiary has a real recorded date.** That
condition is written down rather than assumed.

**Completion happens on the surface that already exists.** `PATCH
/admin/users/{id}` — Super Admin only since R112 — accepts `birth_date`, under
the same TD-15 version check and TD-12 freshness assertion as every other field
on it. **No new route, no new role, and no weakening of ordinary profile
protections.** It is **completion, never correction**: a change to a recorded
date is refused as `BIRTH_DATE_ALREADY_RECORDED`, on the R80.3 pattern and for
the R80.3 reason — a recorded date decides minor/adult status and eligibility, so
changing one is its own decision.

## 5 · Privacy

* **The audit row records the FIELD, never the value.** `user.update` already
  worked this way and a date of birth is exactly the kind of personal datum TD-8
  must not become a second copy of.
* **It is never logged** (TD-14).
* **It is published on one read**: the Super-Admin-only `/admin/users`, because
  that is where a missing one is completed. **Not** on `/admin/directory`, not on
  any beneficiary list, not on a public surface — the same exact narrowing R80.6
  applies to `sex`.
* **No age is ever sent, stored or derived into a column.**

## 6 · Deliberately unchanged

R62.6's rule that schooling stage informs placement and gates nothing; R129's
guardian-only model; every placement rule; `Level.gender_restriction`; and the
absence of any automatic consequence of a birthday.
