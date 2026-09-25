[Documentation](../README.md) › [Development](README.md) › **Email-lock keying**

# Keying the normalized-email lock — design

**Status: RATIFIED DESIGN — IMPLEMENTED AND LOCALLY VERIFIED (2026-09-11).** Owner-authorised B2/B3/B7 code-and-disposable-test batch with no environment/secret mutation: real PostgreSQL fresh/populated migration, HMAC ownership concurrency, re-registration and retained lock-row lifecycle pass; after the B7 repository-boundary correction the affected disposable suites pass 220/220, full integration 2,513 tests (17 skipped), both isolation-clean; ordinary-read guard passes; real-edge browser probe 193/193; static, unit, build, contract and documentation gates pass ([runtime evidence](testing.md#b2b3b7-account-lifecycle-acceptance-2026-09-11)). Not rollout approval — see [the blocker](#the-blocker) and [TASKS](../TASKS.md).

## What the lock is for

- `normalized_email_lock` is a concurrency primitive, not a directory: «an email is claimed by at most one live account» spans `user_identity.email` and `user.pre_provisioned_email`, either row may be absent, so same-table uniqueness cannot close the check-then-insert race (`POST /admin/users` once answered `201` for an address with a live active identity).
- `lockNormalizedEmail` inserts with `ON CONFLICT DO NOTHING`, then `SELECT … FOR UPDATE`, protecting the caller's cross-table re-read until its ownership transaction commits.

## The problem

- Before B3 the primary key was the raw lowercased address with no owner; after de-identification the ownership channels are cleared and the address is reclaimable, but the lock row remained holding the former address with no purpose or retention rule.
- Deleting it during de-identification is not the fix: the row carries no owner, and removing it while another writer waits makes that writer wake to no row; ownership is released by clearing the two channels; the stable row serialises the next claimant.

## The design

Key the table on a server-secret-keyed digest of the normalized address; store no raw email.
- Canonical input: the address after `trim()` then `toLowerCase()`, nothing else (no Unicode folding, gmail dot-stripping or plus-tag removal — those change which addresses collide, an authentication decision).
- Construction: `HMAC-SHA-256(key = EMAIL_LOCK_KEY, message = "bodour.email-lock.v1|" + normalized)`, lowercase hex, 64 characters, the primary key; `node:crypto` `createHmac`; HMAC not bare `SHA-256(email)` (dictionary-reversible); the prefix gives domain separation and `v1` a path for scheme change.
- Secret: `EMAIL_LOCK_KEY`, new TD-13 required variable, distinct from `JWT_SIGNING_KEY` and `ONBOARDING_TOKEN_KEY` (session-key rotation must not touch lock integrity); at least 32 bytes, independent high-entropy; required, never optional (a raw-email fallback = two key spaces, the invariant silently broken where it fell back).
- Rotation: re-key of the whole table, no dual-key lookup; a digest is a lookup key, rows are disposable (no ownership, no history), so rotation = truncate during a maintenance window with no in-flight ownership transactions; serialisation suspended only for the truncate.
- Losing the secret: same remedy, no data loss.
- Collisions: merging two addresses' locks is a liveness cost only (the authoritative re-read still consults the ownership channels); probability negligible.
- Transaction semantics unchanged: `createMany({ skipDuplicates })` then `SELECT … FOR UPDATE` on the digest; lock ordering `Email → PlatformOwner → User` unchanged, no new deadlock class.

### Migration

- Forward-only; not a computed backfill (the digest needs the plaintext being removed). Truncate and re-key: truncate, drop the `email` primary key, add `email_digest CHAR(64) PRIMARY KEY` and a lowercase-hex CHECK; a fresh database replays the plaintext migration then this transition; an existing one loses only ownerless lock coordinates. All ownership writers stopped; old/new binary overlap unsupported.
- `20260911100000_deletion_generation_identity_minimization` also implements B7's paired nullable claim credentials and removes their copies/snapshots only for accounts proven permanently erased by `user.deidentify` audit, absent credentials and absent User Trash (soft deletion is not erasure evidence); bounded SQL timeouts. B2 reuses the existing Trash generation and User lock, no extra column. Neither application nor rollback performed on Owner-populated data; do not run an old binary against it; do not restore erased personal data as a rollback.

### Account deletion

- `deIdentifyAccount` locks each address by digest and does not delete the lock row; B3 removes the post-commit plaintext-retirement loop from `a4174b1` (failure after ownership erasure could leave an undiscoverable plaintext row; deletion could invalidate another writer's wait target).

### Tests the implementation must carry

1. Concurrent `preProvision` and identity binding on one address → one claimant.
2. A failed ownership transaction leaves no lock row.
3. A successful claim leaves exactly one.
4. Permanent de-identification releases ownership; a genuinely new registration reclaims the address.
5. Deterministic digest: the same address twice → one row.
6. Normalization before hashing: `  Foo@Example.COM ` and `foo@example.com` → one row.
7. No raw email in the lock table — asserted against `information_schema` plus a scan for `@` in the key column.
8. Boot fails loudly by name when `EMAIL_LOCK_KEY` is absent.

## The blocker

- Owner condition 5 («no staging/prod secret needs to be invented or mutated») blocked ship; the B2/B3/B7 instruction permits implementation with isolated test secrets, not secret provisioning.
- `EMAIL_LOCK_KEY` is in `REQUIRED_ENV_VARS`; a missing one throws `MissingRequiredEnvError` at boot (TD-13 gives secrets no defaults), so the next Staging deploy fails until the secret is set — a mutation this work may not perform; making it optional would be worse.
- Order: disposable verification → commit the batch without pushing/deploying → separate operational authority → stop all ownership writers, install the shared key, apply the migration → restart only the matching new code and verify. Localhost, Staging and Production secrets/data untouched; both current-code disposable reruns passed; operational provisioning outstanding.
