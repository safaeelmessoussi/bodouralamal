[Documentation](../README.md) › [Operations](README.md) › **Runbooks**

# Runbooks

Procedures that touch real beneficiary data run **only** on the production VPS, by someone the association authorises; nothing here justifies copying production data anywhere.

## Creating and restoring a full recovery point

The executable procedure, timers, key escrow, disk floor, operator checks, snapshot selection and fresh-host recovery are in [Recovery](recovery.md); this section keeps the invariants.
- One coherent point: stop every service except PostgreSQL → portable custom-format `pg_dump` → stop PostgreSQL → dump, cleanly stopped data volumes, TLS state and recovery configuration into one encrypted restic snapshot. Pre-backup containers restart with `compose start` even on failure — never reconciled from whatever overlays are present. Repository/password/SSH path proved before any writer stops. Restic image immutable by digest; password file root-only, never in the snapshot.
- [SeaweedFS](../architecture/storage.md#b1-candidate-verification-checkpoint) (Owner, 2026-09-20): logical `minio-data` coordinate resolves to `<project>_seaweedfs-data` via Compose labels; `nocopy` mount so `compose create` cannot seed a restore target; keep the empty-volume guard. Raw restore only to the same vendor/version; a legacy real-MinIO volume needs a separately authorised S3-level migration.
- Host-scoped by design: a Docker socket in the API or workers would be root-equivalent control of the VPS. Execution boundary is a root-owned **host systemd timer**, not a pg-boss handler; TD-7 `backup.replicate` wording and the TD-14/TD-16 dashboard-alert contract still need Document Owner reconciliation — host status and journals exist, **not dashboard alerts**.
- Retention: R133 monthly, at most two generations. Owner's B8 decision (2026-09-12): encrypted backups on the **same Production VPS for the first couple of months**; no recovery from total VPS/provider/disk loss, no 24-hour RPO claim, no extra infrastructure. Create → full `restic check --read-data` → scoped prune; a failed verification never prunes. No deletion replay.
- Restore pins repository ID, source Compose project, exact snapshot ID, logical volume set and PostgreSQL/object-store image IDs before targets exist; old manifests lacking them fail closed with no bypass. Portable `pg_dump` verified separately.
- Proofs: `bash scripts/backup/verify-backup-restore.sh` (focused) and `bash scripts/deploy/verify-production-bootstrap.sh` (Production-mode rollback); both own/remove disposable resources; neither proves realistic-volume RTO, installs timers or touches a live host.

## Restoring a soft-deleted record

- **Never run restoration SQL in `psql`**: a raw session enforces no authority, parent-first ordering or audit. Restore through `/admin/trash` as a live Super Admin; the service clears the tombstone, reinstates only the child rows declared safe for that type, removes the Trash entry and writes `trash.restore` in one transaction.
- **R111 account deletion is a special case:** the recoverable phase removes no family link, enrolment, Teaching Group membership, course staffing, role or Google identity — only the User tombstone and credential revocation — so restoring within the three-day window is complete (revoked sessions stay revoked). Permanent de-identification removes the Trash entry in the same transaction.
- Every other entity: clearing `deleted_at` is insufficient when owned relationships were removed; the service refuses those types until reinstatement is implemented and tested. No general `db:restore` CLI exists.
- Trash UI shipped (R52), permanent deletion with it (R59.1); the snapshot and 90-day window are non-negotiable ([`BR-15`](../reference/business-rules.md#br-15)).

### What the screen can restore

`User` (R111), `Branch`, `Category`, `Subject`, `Room`, `Partner`, `Exam` (R59.3), `HijriMonthStart` (R59.5). A current Subject snapshot names the exact `LevelSubject` rows deleted with it and restores only those; a legacy snapshot without those ids is labelled `INCOMPLETE_SNAPSHOT` and not offered. Everything else is refused loudly.

### Permanent deletion, and what it will not do

- `DELETE /admin/trash/{id}` (Super Admin) destroys the record, its **declared** cascade children and tombstone in one transaction and writes `trash.permanent_delete`, retained indefinitely (absent from the `audit.purge` allowlist).
- Refuses when a live row still references it (`DEPENDENTS_EXIST`, naming the constraint); no force flag by design — clear dependants deliberately.

| Type | Reason | Instead |
|---|---|---|
| `User` | `ACCOUNTABILITY_RECORD` — referenced by `AuditLog` and institutional records | R111 permanent de-identification: non-identifying tombstone stays; personal fields, credentials, planning data, snapshot go |
| `RecurringCourseSchedule` | **Purged WITH its occurrences, their attendance and their recordings after the seven days (R170 §8, superseding R118 (1); Owner, 2026-09-22)** — a recording becomes an ordinary deleted library item with its quarantine obligation. `SESSIONS_HAVE_EXAMS` refuses while any occurrence is LIVE or an exam was sat in it (R136) | Keep it; never delete a Session by SQL |

- `QuranProgressLog`: account deletion retains every progress row, but a teacher's tombstoned correction may be permanently purged; its `quranlog.delete` and `trash.permanent_delete` audits remain. `LevelSurah`, `Partner` and an unused `SchedulingType` are explicit leaf plans. Parent Level/Subject purges use only child ids in the parent's snapshot, never a broad FK delete.
- `EducationalContent`: the transaction inserts an exact `StorageRetirement` record and `content.quarantine-purge` wakeup before deleting the row and Trash locator; absent queue → whole transaction rolls back; storage outage retries under TD-7. After B5, pg-boss history is execution evidence, not the sole locator. Never delete an unresolved retirement row to make a dashboard green.
- The B5 reconciliation cron authorises **no additional destruction**; age-based Trash selection belongs to `trash.retention-purge`, unchanged.

## Reading the audit log

No audit browsing page in the MVP (writing mandatory, reading deferred); reads go through SQL.

```sql
-- Everything one actor did, most recent first
SELECT created_at, action_type, target_entity, target_id, detail
FROM "AuditLog"
WHERE actor_user_id = '<uuid>'
ORDER BY created_at DESC
LIMIT 100;

-- Who viewed a particular child's case file
SELECT created_at, actor_user_id, detail
FROM "AuditLog"
WHERE action_type = 'socialprofile.view' AND target_id = '<student uuid>'
ORDER BY created_at DESC;

-- Security events: replayed refresh tokens
SELECT created_at, target_id, detail
FROM "AuditLog"
WHERE action_type = 'auth.token_revoked'
  AND detail->>'reason' = 'reuse_detected'
ORDER BY created_at DESC;

-- Consent warnings raised and cleared by the engine (R170 §3)
SELECT created_at, target_id, detail->>'media_consent_missing' AS missing, detail->>'source_session_id' AS session
FROM "AuditLog"
WHERE action_type = 'content.consent_warning'
ORDER BY created_at DESC;
```

A **null `actor_user_id` means system-initiated**, not attribution lost.

## Recording an official Hijri month

Roughly monthly, after the Ministry announces the sighting. **The screen is not built yet**; until `/superadmin/hijri-calendar` ships, the four Super-Admin-only endpoints are the only path:

```
PUT /api/v1/admin/hijri-calendar/{hijriYear}/{hijriMonth}
    { "gregorian_start_date": "YYYY-MM-DD" }          ← the announced date
POST /api/v1/admin/hijri-calendar/{hijriYear}/publish  ← nothing renders until this
```

- **Record two consecutive months wherever possible**: a month whose successor is unrecorded resolves for only its certain 29 days ([Calendar and Hijri](../architecture/calendar-and-hijri.md#the-overlay-is-invisible-until-someone-records-a-month--including-in-development)).
- Once the screen exists: open **Hijri Calendar Management**, select the Hijri year → record **the Gregorian date on which the Ministry announced the month began** → save (`draft`, renders nowhere) → review, **publish**; only published months appear.
- **The Super Admin records; the Ministry decides.** Record a Ministry correction as a correction; the audit row captures previous and new start dates.
- Until a month is recorded and published, its dates carry no Hijri label — correct behaviour ([Calendar and Hijri](../architecture/calendar-and-hijri.md#the-hijri-overlay)).

## Recovering from total administrator lockout

If **every** Super Administrator is suspended or deleted, the bootstrap gate reopens:
1. Set `SUPER_ADMIN_EMAIL` in `.env` to the address that should hold the role.
2. Run the seed:
   ```bash
   docker compose run --rm api npm run seed:production
   ```
3. That address logs in with Google; the identity binds.

- **Grants no new authority**: reachable only by someone who can already run the seed on the VPS.
- **A soft-deleted account's address makes the seed fail loudly and create nothing**; restore the account first or use another address.

## Applying a migration to production

```bash
# 1  Rehearse against ceiling-scale staging fixtures first. Note the duration.

# 2  On the VPS — IMMEDIATELY before migrating:
docker compose exec db pg_dump -U app bodour > pre-migration-$(date +%F-%H%M).sql

# 2a Before the normalized-email lock migration, inspect cross-channel owners.
docker compose exec db psql -U app -d bodour -P pager=off -c '
WITH claims AS (
  SELECT id AS user_id, pre_provisioned_email AS email, '\''pre_provisioned'\'' AS channel
  FROM "user" WHERE pre_provisioned_email IS NOT NULL
  UNION ALL
  SELECT user_id, email, '\''identity'\'' AS channel
  FROM user_identity WHERE is_active = TRUE
)
SELECT email, array_agg(DISTINCT user_id) AS users,
       array_agg(DISTINCT channel) AS channels
FROM claims GROUP BY email HAVING count(DISTINCT user_id) > 1;'

# 3  Apply
docker compose run --rm api npx prisma migrate deploy

# 4  Verify
curl --fail-with-body --silent --show-error --max-time 15 https://<domain>/healthz
```

- Step 2a rows → **stop**; the migration refuses the same state deliberately. Precedent (2026-08-25, development): one address on an *active bound* identity and a never-used *pending* pre-provisioned row; the Owner kept the bound identity and authorised clearing **only** `pre_provisioned_email` on the pending row — no deletion, merge or identity change.
- Never clear `pre_provisioned_email`, deactivate an identity or merge Users to make the command pass: that decides who owns a verified address and may destroy §4.1b provenance. Have the association identify the intended account, run the reviewed account-resolution procedure, take a new dump, rerun the query, migrate at zero rows.
- Prisma records the aborted attempt as **failed** and refuses `migrate deploy` until resolved. Confirm nothing was left behind (`to_regclass('public.normalized_email_lock')` is `ABSENT`, no later migration applied), then:

```bash
npx prisma migrate resolve --rolled-back "20260823210000_normalized_email_ownership_lock"
npx prisma migrate deploy
```

- **The dump is the rollback point** and must match pre-migration state exactly. Rollback = `docker compose down` + restore that dump; **migrations are forward-only**, no down-migration by policy.

## Rotating a signing key

```bash
openssl rand -base64 48
```

| Key | Effect of rotation |
|---|---|
| `JWT_SIGNING_KEY` | Every access token invalid; clients refresh transparently within an hour; **refresh tokens are hashed in the database and unaffected** |
| `ONBOARDING_TOKEN_KEY` | In-flight registrations (10-minute window) fail and restart |

They **must remain distinct from each other.**

## Investigating a user-reported error

1. Take the **request id** the interface shows on the error.
2. `docker compose logs api | grep '<request-id>'`
3. The same id appears on any job the request enqueued.

Logs carry the user id, never a name ([no PII in logs](observability.md#no-pii-in-logs)).

## Checking whether a job is stuck

```bash
curl -s https://<domain>/healthz \
  | jq '{status, components, jobs: .details.jobs}'
docker compose logs api | grep -i 'job'
```

- `queue != "ok"`: PostgreSQL or pg-boss infrastructure unavailable/not installed.
- `queue == "ok"` and `jobs == "down"`: enqueue storage exists but this process's runner never started, failed registration, stopped or went stale; read `details.jobs.reason`; restart the API only after recording the startup error.
- `jobs == "ok"`: every implemented worker registered and fresh (not a claim that every TD-7 requirement is implemented).
- Jobs retry five times with exponential backoff, then dead-letter with an Admin-visible failure. **Enqueues succeed while workers are down**; jobs drain on restart.
- `session-recording-ingest` failure: no `educational_content_id` → import failure, staging kept for a corrected retry. Relation populated and output names `RecordingStagingCleanupFailure` → the library item is valid; the only obligation is deleting the recorded staging bucket/key. Redrive the existing job after restoring MinIO; never delete the canonical key, never enqueue a bucket sweep, never use `upload.gc` for it.
- `consent.reevaluate`: inspect the named `session_id`; a missing/deleted occurrence converges as a no-op. Since R170 §3 it writes only `media_consent_missing` (warning, both directions) and moves no bytes; never hand-edit the flag.
- `content.bucket-migrate`: inspect `content_id` and the current row before redrive:
  - `consent_migrate` is a pre-R170 leftover: completed with `last_error_code = 'withdrawn_r170'`, no object touched.
  - Resolve `retirement_id` to its `StorageRetirement`; legacy jobs alone carry `source_key` and must be imported before retention removes them. A consent migration names the row's current canonical key; `operation = retire_public` is an exact obsolete-key obligation, never rewritten to the current key.
  - Private destination with server SHA-256 and missing public source = supported delete-succeeded/DB-rollback state; redrive.
  - Public source already missing = complete (also after an ambiguous delete response); never recreate it or delete the replacement key.
  - Never set visibility private before the public object is gone, never delete the private canonical object, never use `upload.gc` here.
  - A terminal job failure does not complete the obligation: restore MinIO/repair the named inconsistency, reconcile pending records; no bucket sweep.

### B5 retirement backlog and rollout

- Stop old writers/workers → ordinary validated backup → apply migration 96 → run `importLegacyRetirements` from the built storage-retirement repository **before starting pg-boss maintenance on the upgraded host** (same queue tables and transactional enqueue; no parallel worker). Normal API startup repeats import and reconciliation idempotently; the early import matters because retention may already be due on old failed jobs.
- Already-expired legacy coordinates cannot be reconstructed from hashed audit metadata; investigate pre-upgrade inventory separately under explicit authorisation. No live rollout occurred in local B4/B5/B6 verification.

```sql
SELECT id, content_id, operation, bucket, copy_settled, attempts, last_error_code,
       created_at, next_attempt_at
FROM storage_retirement
WHERE completed_at IS NULL
ORDER BY next_attempt_at, id
LIMIT 250;
```

- `STORAGE_OPERATION_FAILED` retains the exact key for retry; success clears it. The quarantine queue's `{operation: 'reconcile'}` handler re-enqueues due records in bounded pages at startup and daily. A healthy worker registry does not prove the backlog empty: check both; retain unresolved rows across expiry, terminal failure, restart and backup/restore. The handler rechecks canonical authority before any deletion; never replace its coordinate with a newer key.
- `COPY_OUTCOME_UNKNOWN`: the placement may still take effect remotely; never mark complete on HEAD absence, a green worker or elapsed time. Reconciliation observes a late copy, records settlement and retires it under canonical-reference protection. If no object appears and no positive evidence survives, the unresolved row is intentional — keep its locator, investigate the operation; no age-based deletion rule.
- Two consecutive backup replication failures → escalate to the Owner.

## Entering launch data

- Branches, rooms, groups, rosters: **manually through the admin UI** with the branch coordinator; **seeding them into production is prohibited.**
- Budget dedicated hours ([Risk R-5](../overview/scope-and-roadmap.md#open-risks)); Arabic search normalization softens spelling variance.
- Order: branches → rooms → levels (reference data, **Super Admin**), then groups and rosters (**Admin**, within scope).

## Verifying the storage proxy after an Nginx change

Signed round trip **through the proxy**, never direct to MinIO:

```bash
bash scripts/dev/test-integration.sh   # includes the storage-proxy round trip
```

- `SignatureDoesNotMatch` after an Nginx edit: the `/storage/` location stopped stripping the prefix or rewriting `Host` consistently with the signed endpoint; non-default test ports are part of that Host.
- Also verify: signed public-staging PUT, unsigned staging GET denial, one current canonical public read, one forced/deleted canonical public denial (staging and canonical locations authorise differently). Inspect `nginx -T`, not the source file; canonical and staging S3 Select-style POST plus DELETE get Nginx `405`; unsigned PUT gets MinIO `403`; `/storage/public`, `/storage/public/` and either with `?list-type=2` return no listing; duplicate/encoded separator probes select the same denial or fail the exact-coordinate authorizer — none falls through the generic `/storage/` proxy.
- Temporary P0.1 defence: `nginx -T` shows the shared `STREAMING-UNSIGNED-PAYLOAD-TRAILER` rejection on every proxied storage location; the safe regression sends only that header on an unsigned bodyless PUT and expects `403` with `X-Bodour-Storage-Policy: unsigned-trailer-denied` (Nginx decided, not MinIO). Never construct a chunked payload. The signed round trip must pass in the same run. The filter does not remove the [Owner-blocked object-store requirement](../architecture/storage.md#owner-decision-required--object-store).

### B-03 rollout: let legacy direct PUT capabilities expire

- R103 accepts outstanding non-replacement tickets through the SHA-256 finalizer but **refuses every outstanding replacement ticket lacking `replaces_version`** — fail-closed at deployment; old content stays authoritative; the user re-initiates. No accepted row or historical object rewritten.
- Completed rows from the former direct-upload release keep their original PUT target as canonical key; an issued presigned URL cannot be revoked individually.
- Stop the old API before rollout and record the time; do not declare the immutable-finalization invariant active until one PUT TTL (one hour) has passed. The new release may run during the drain (new URLs target staging). Do **not** rotate object-store credentials or rewrite historical keys as a shortcut. Development audit 2026-08-24: 11 rows from the direct path, newest older than two days, no live URL.
- `PRESIGN_TTL_SECONDS.put` is the only production PUT TTL; R103 does not change it. After the drain, browser uploads use 32-hex SHA-256 canonical identities; R99 provider recordings keep server-controlled ingestion keys.

---

**Related:** [Deployment](deployment.md), [Resilience](resilience.md), [Database](../architecture/database.md)
