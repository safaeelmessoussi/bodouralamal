[Documentation](../README.md) › [Development](README.md) › **Email-lock keying**

# Keying the normalized-email lock — design

**Status: RATIFIED DESIGN — NOT IMPLEMENTED. AWAITING ONE OPERATIONAL
PRECONDITION.** The Owner authorised implementation in the same session *only if*
six conditions held. **Condition 5 does not hold** — see
[The blocker](#the-blocker) — so this is the design, and the migration is not
written.

---

## What the lock is for

`normalized_email_lock` is a **concurrency primitive**, not a directory. The
invariant it protects — *an email is claimed by at most one live account* — spans
two tables, `user_identity.email` and `user.pre_provisioned_email`, and **either
row may be absent**. Same-table uniqueness therefore cannot close the
check-then-insert race, and the defect is not hypothetical: `POST /admin/users`
once answered `201` for an address that already had a live active identity,
leaving two live accounts claiming one address for §4.1b's binding step to choose
between.

`lockNormalizedEmail` inserts the row with `ON CONFLICT DO NOTHING` — so
concurrent creators of an absent row converge on one — then takes `SELECT … FOR
UPDATE` on it, which protects the caller's cross-table re-read until its whole
ownership transaction commits.

## The problem

**The primary key is the raw lowercased email address, and the row has no
owner.** After a permanent de-identification the ownership channels are cleared
and a genuinely new registration can reclaim the address — proven by test — but
the lock row **remains**, holding the exact former address, with no purpose
statement and no retention rule.

Deleting it during de-identification is **not** the fix and must not be
attempted: the row deliberately carries no owner, and removing it while another
writer waits on it makes that writer wake to no row and fail. Ownership is
released by clearing the two authoritative channels; the stable row exists to
serialize the next claimant.

## The design

**Key the table on a deterministic, server-secret-keyed digest of the normalized
address. Store no raw email.**

### Canonical input

The value hashed is the address **after** the normalization every ownership path
already applies — `trim()` then `toLowerCase()` — and nothing else. No Unicode
folding, no gmail dot-stripping, no plus-tag removal: those would change *which
addresses collide*, which is an authentication decision, not a storage one.

### The construction

`HMAC-SHA-256(key = EMAIL_LOCK_KEY, message = "bodour.email-lock.v1|" + normalized)`,
stored as the lowercase hex digest, 64 characters, as the table's primary key.

* **HMAC, not `SHA-256(email)`.** A bare hash of an email is trivially reversed
  by dictionary: the space of real addresses is small and enumerable, so an
  unkeyed digest is the address in a thin disguise. The key is what makes the
  stored value useless to a reader who has the table and not the secret.
* **A standard construction, never a bespoke one.** `node:crypto`'s `createHmac`,
  which is already the project's primitive elsewhere.
* **Domain separation in the message.** The `bodour.email-lock.v1|` prefix means
  a digest from this table can never equal one computed for another purpose under
  the same key, and the `v1` gives a future scheme change somewhere to go.

### The secret

`EMAIL_LOCK_KEY` — a **new** TD-13 required variable, distinct from
`JWT_SIGNING_KEY` and `ONBOARDING_TOKEN_KEY` for the reason those two are
distinct from each other: one key with two purposes means rotating it for one
reason breaks the other. Reusing `JWT_SIGNING_KEY` would couple session-key
rotation — a routine, expected operation — to the integrity of every email lock,
which is exactly the coupling to avoid.

It is **required, never optional**. An optional key with a raw-email fallback
would produce two different key spaces in two environments and silently break the
invariant in the one that fell back.

### Rotation

**Rotation is a re-key of the whole table, and there is no dual-key lookup.**

A digest is a lookup key, not a verification: on rotation every row must be
recomputed, which requires the plaintext — and the plaintext is exactly what this
design stops storing. So rotation cannot recompute existing rows.

That is acceptable, because **the rows are disposable by nature**: a lock row
carries no ownership and no history. The rotation procedure is therefore
**truncate the table** during a maintenance window with no in-flight ownership
transactions. Ownership itself is untouched — it lives in the two authoritative
channels — so nothing is lost. The serialization guarantee is suspended only for
the length of the truncate.

### Losing the secret

**Same consequence, same remedy, and no data loss.** Truncate and continue with a
new key. Nothing that grants access, proves consent or records history is stored
here.

### Collisions

SHA-256 over a keyed message. A collision would merge two addresses' locks and
serialize two unrelated registrations against one row — a **liveness** cost, not
a correctness one, since the authoritative re-read still consults the two
ownership channels. At any plausible number of addresses the probability is
negligible; the fallback behaviour is safe rather than merely unlikely.

### Transaction semantics

**Unchanged in every particular.** `createMany({ skipDuplicates })` then `SELECT
… FOR UPDATE` on the digest instead of on the address. The lock ordering
(`Email → PlatformOwner → User`) is unchanged, so no new deadlock class is
introduced.

### Migration

Forward-only, and **it cannot be a computed backfill**, because computing the
digest of an existing row requires the plaintext the migration is removing —
which would be the same exposure written twice.

**Truncate and re-key**, on the same reasoning as rotation: the rows are
disposable, ownership is elsewhere, and any address still in use re-establishes
its lock on the next claim. Concretely: truncate, drop the `email` primary key,
add `email_digest CHAR(64) PRIMARY KEY`. A fresh database gets the new shape
directly; an existing one loses only rows that carry nothing.

### Account deletion

`deIdentifyAccount` changes in exactly one respect: it locks each address by
**digest** rather than by address. It still does **not** delete the lock row —
that reasoning is unchanged and remains correct. After the migration the row it
leaves behind holds a keyed digest rather than a person's address, which is the
whole point.

### Tests the implementation must carry

1. The original cross-table race: concurrent `preProvision` and identity binding
   on one address produce **one** claimant, not two.
2. A failed ownership transaction leaves **no** lock row (rollback).
3. A successful claim leaves exactly one.
4. Permanent de-identification still **releases** ownership — the address is
   reclaimable by a genuinely new registration.
5. The digest is deterministic: the same address twice yields one row.
6. Normalization is applied before hashing — `  Foo@Example.COM ` and
   `foo@example.com` reach the same row.
7. **No raw email remains in the lock table** — asserted against
   `information_schema` plus a scan for `@` in the key column, so a future column
   cannot quietly reintroduce one.
8. Boot fails loudly and by name when `EMAIL_LOCK_KEY` is absent.

## The blocker

The Owner's condition 5 was *"no staging/prod secret needs to be invented or
mutated."* **It does.**

`EMAIL_LOCK_KEY` must join `REQUIRED_ENV_VARS`, and a missing required variable
**throws `MissingRequiredEnvError` at boot** — by design, since TD-13 gives
secrets no defaults. So the next Staging deploy would fail until the secret is
set there, which is a Staging mutation this session is forbidden to perform and a
secret it must not invent. Making the variable optional to avoid that is the one
thing that would be worse: two key spaces, one invariant, silently broken in
whichever environment fell back.

**Everything else is ready.** The design is unambiguous, the migration is
forward-only and safe, no authentication behaviour is weakened, and the section
is completable and testable in one pass **once the secret exists in every
environment that will run the new code**.

**The order is: generate and install `EMAIL_LOCK_KEY` in Localhost and Staging →
then implement.** Not the other way round.
