[Documentation](../README.md) › [Development](README.md) › **Email-lock keying**

# Keying the normalized-email lock — design

**Status: RATIFIED DESIGN — IMPLEMENTED AND LOCALLY VERIFIED (2026-09-11).**
The Owner subsequently authorised the bounded B2/B3/B7 code-and-disposable-test
batch without any environment/secret mutation (2026-09-11). Real PostgreSQL
fresh/populated migration, HMAC ownership concurrency, re-registration and retained
lock-row lifecycle checks pass. After the B7 repository-boundary correction,
affected disposable suites pass 220/220 and full integration passes 2,513 tests
with 17 skipped; both are all-table isolation-clean. The unchanged ordinary-read
guard passes, and the full run's real-edge browser probe passes 193/193.
Final static, unit, build, contract and documentation gates also pass.
See [runtime evidence](testing.md#b2b3b7-account-lifecycle-acceptance-2026-09-11).
This is not rollout approval. See
[the operational prerequisite](#the-blocker) and [TASKS](../TASKS.md).

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

**Before the B3 migration, the primary key is the raw lowercased email address,
and the row has no owner.** After a permanent de-identification the ownership channels are cleared
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

It is **required, never optional**: at least 32 bytes, with operators generating
an independent high-entropy secret (TD-13). An optional key with a raw-email fallback
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
add `email_digest CHAR(64) PRIMARY KEY` and a lowercase-hex CHECK. A fresh database
replays the earlier plaintext migration then this transition; an existing one
loses only ownerless lock coordinates. All ownership writers must be stopped;
an online old/new binary overlap is unsupported.

The single migration is
`20260911100000_deletion_generation_identity_minimization`. It also implements
B7's paired nullable claim credentials and removes their copies/snapshots only
for already permanently erased accounts proven by `user.deidentify` audit,
absent credentials and absent User Trash. Soft deletion alone is not erasure
evidence. Its transaction has bounded SQL timeouts. B2 reuses the existing
Trash generation and User lock and requires no extra column. Neither migration
application nor a rollback has been performed on Owner-populated data in this batch.
The schema transition is forward-only: do not run an old binary against it, and
do not restore erased personal data as a rollback technique.

### Account deletion

`deIdentifyAccount` locks each address by **digest** rather than by address and
does **not** delete the lock row. B3 removes the post-commit plaintext-retirement
loop introduced in `a4174b1`: failure after ownership erasure could leave an
undiscoverable plaintext row, and deletion could invalidate another writer's
wait target. Stable keyed coordinates remove that retirement obligation entirely.

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

The original Owner condition 5 was *"no staging/prod secret needs to be invented
or mutated."* That blocked the original implement-and-ship sequence. The later
B2/B3/B7 instruction permits implementation and isolated test secrets **without
shipping or touching real environments**. It does not waive secret provisioning.

`EMAIL_LOCK_KEY` is in `REQUIRED_ENV_VARS`, and a missing required variable
**throws `MissingRequiredEnvError` at boot** — by design, since TD-13 gives
secrets no defaults. So the next Staging deploy would fail until the secret is
set there, which is a Staging mutation this session is forbidden to perform and a
secret it must not invent. Making the variable optional to avoid that is the one
thing that would be worse: two key spaces, one invariant, silently broken in
whichever environment fell back.

**Current order:** complete disposable verification → commit the bounded batch
without pushing/deploying → obtain separate operational authority → stop all
ownership writers, install the shared key and apply the migration → restart only
the matching new code and verify. Localhost, Staging and Production secrets/data
remain untouched. The earlier execution-service usage-limit rejection prevented
the first post-correction attempt from starting; once execution was available,
both required current-code disposable reruns passed. No Owner-data substitution
or required-key weakening occurred. Operational provisioning remains outstanding.
