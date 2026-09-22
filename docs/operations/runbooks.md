[Documentation](../README.md) › [Operations](README.md) › **Runbooks**

# Runbooks

Step-by-step procedures for things that will actually happen.

> Procedures that touch real beneficiary data run **only** on the production VPS, by someone
> authorised by the association. Nothing here is a reason to copy production data anywhere.

---

## Creating and restoring a full recovery point

The repository now has host-scoped recovery tooling for the current Compose data layout. It takes one coherent
point by stopping every running service except PostgreSQL, producing a portable custom-format
`pg_dump`, stopping PostgreSQL, and backing up that dump, the cleanly stopped Docker data
volumes, TLS state and recovery configuration into one encrypted restic snapshot. The exact
pre-backup containers are restarted with `compose start` even on failure — never reconciled or
recreated from whatever Compose overlays happen to be present at backup time. The encrypted
repository/password/SSH path is proved before any writer stops, so an unavailable target fails
visibly without causing an application outage. The restic image is immutable by digest; the
password file is root-only and is never included in the snapshot.

Every tier's [SeaweedFS selection](../architecture/storage.md#b1-candidate-verification-checkpoint)
(Owner decision, 2026-09-20) keeps the logical `minio-data` backup coordinate but resolves it to
`<project>_seaweedfs-data` through Compose labels. The shared mount uses `nocopy` so
`compose create` does not seed a restore target with image scaffolding. Keep the
empty-volume guard intact. Restore raw data only to the same vendor/version; a legacy
real-MinIO volume requires a separately authorized S3-level migration, not a renamed volume.

This is intentionally host-scoped. The API and its pg-boss workers are unprivileged
containers; mounting the Docker socket into either would grant root-equivalent control of the
VPS. The current executable tooling does not make that trade.

### OWNER DECISION REQUIRED — BACKUP TARGET AND RETENTION

**Historical heading retained for links; resolved for the temporary B8 architecture.**
R133 already fixes monthly backups and at most two generations. The Owner's B8 decision
(2026-09-12) permits encrypted backups on the **same Production VPS for the first couple of
months**, without another provider. This supersedes the earlier offsite prerequisite for that
limited period. It does **not** provide recovery from total VPS, provider or disk loss.
There is no claim of a 24-hour RPO with monthly copies. No extra infrastructure is implied.

The executable [same-VPS recovery procedure](recovery.md) covers root-only key escrow,
explicit disk floor, daily host scheduling of the monthly operation, five-minute operator
checks, safe snapshot selection, and fresh-host recovery **only if repository bytes survive**.
Create → full `restic check --read-data` → scoped prune retains at most two generations
after success; a failed verification never prunes old points and may temporarily leave extra
unverified snapshots until repair. No previous-generation deletion replay is introduced.

The tools use the B1 SeaweedFS volume and pin repository ID, source Compose project, exact
snapshot ID, logical volume set and PostgreSQL/object-store image IDs before restore targets
are created. Raw cross-vendor restore is prohibited. Portable `pg_dump` is verified separately.
Old manifests missing these identity fields fail closed and require deliberate operator review;
there is no automatic compatibility bypass or rewrite of historical repositories.

The focused proof is `bash scripts/backup/verify-backup-restore.sh`; the actual Production-mode
API/worker/Nginx/SeaweedFS rollback proof is
`bash scripts/deploy/verify-production-bootstrap.sh`. Both own and remove disposable resources.
Neither proves realistic-volume Production RTO, installs the timers, or changes a live host.

The current execution boundary is a root-owned **host systemd timer**, not a pg-boss handler
with a Docker socket. TD-7's `backup.replicate` wording and the TD-14/TD-16 dashboard-alert
contract still need Document Owner reconciliation; no job or API route was invented. Host
status, nonzero operator checks and service journals are implemented, **not dashboard alerts**.

---

## Restoring a soft-deleted record

**Never run restoration SQL directly in `psql`.**

The reason is stated plainly in the specification: a raw session enforces no authority,
parent-first ordering or audit. Restore through `/admin/trash` as a live Super Admin; the
service clears the record tombstone, reinstates only the child rows declared safe for that
entity type, removes the Trash entry and writes `trash.restore` in one transaction.

**R111 account deletion is a deliberate special case.** Its recoverable phase removes no
family link, enrolment, Teaching Group membership, course staffing, role or Google identity.
It only stamps the User tombstone and revokes credentials, so restoring the User during the
three-day window is complete: the same account and relationships return, while revoked
sessions stay revoked. Permanent de-identification removes the account's Trash entry in the
same transaction, so an erased identity is never offered for reconstruction.

For every other entity, the old warning still applies: clearing `deleted_at` is insufficient
if the deletion removed owned relationships. The service refuses those types until their
complete reinstatement is implemented and tested. There is currently no general `db:restore`
CLI; do not use a command or direct SQL that the repository does not provide.

> The Trash restoration **UI shipped** (R52), and **permanent deletion with it** (R59.1).
> The snapshot and the 90-day window remain non-negotiable
> ([`BR-15`](../reference/business-rules.md#br-15)).

### What the screen can restore

The screen handles the types whose reinstatement is **written and tested** — today
`User` (R111), `Branch`, `Category`, `Subject`, `Room`, `Partner`, `Exam` (R59.3) and
`HijriMonthStart` (R59.5). A current Subject snapshot names the exact `LevelSubject` rows
that followed its deletion and restores only those; a legacy snapshot without those ids is
labelled `INCOMPLETE_SNAPSHOT` and is not offered for restore. Everything else is refused
loudly, because clearing `deleted_at` is the easy tenth of the problem and every failure of
the other nine is silent.

### Permanent deletion, and what it will not do

`DELETE /admin/trash/{id}` (Super Admin only) destroys a record, its **declared** cascade
children and its tombstone in one transaction, and writes a `trash.permanent_delete` audit
row that is retained indefinitely — it is deliberately absent from the `audit.purge`
allowlist, so the record of an irreversible act outlives the audit horizon.

It refuses, rather than cascading, when a live row still references the record
(`DEPENDENTS_EXIST`, naming the constraint). **Clear the dependants first, deliberately** —
the refusal is the safeguard, and there is no force flag by design.

One type has no destruction plan at all, and one is conditional:

| Type | Reason | What to do instead |
|---|---|---|
| `User` | `ACCOUNTABILITY_RECORD` — a person's row is referenced by `AuditLog` and institutional records, so destroying it takes their meaning and the record of who acted | Use R111 permanent de-identification. The non-identifying tombstone remains; its personal fields, credentials, planning data and recoverable snapshot do not |
| `RecurringCourseSchedule` | **Purged WITH its occurrences after the seven days (SRS Revision 170 §8, superseding R118 (1))** — each record-free occurrence and its owned rows go with the class. `SESSIONS_HAVE_RECORDS` refuses while any occurrence is LIVE or carries a student's record (attendance, a recording, an exam sat in it): R133 destroys a person's history only with her own account | Keep it; it is presented as retained. Never delete a Session by SQL. Whether attendance and recordings should go with a class is the one question R170 §8 left with the Owner |

`QuranProgressLog` is different from account deletion: deleting an account retains every
institutional progress row, but a teacher's deliberate correction already tombstones one exact
log. That deleted correction may now be permanently purged; its `quranlog.delete` and
`trash.permanent_delete` audits remain. `LevelSurah`, `Partner`, and an unused `SchedulingType` are likewise
explicit leaf plans. Parent Level/Subject purges use only child ids captured in the parent's
snapshot; they never issue a broad delete by foreign key.

The deliberate action is storage-durable for `EducationalContent`: its transaction inserts an
exact `StorageRetirement` record and `content.quarantine-purge` wakeup before deleting the content row and Trash locator.
If the queue is absent the whole transaction rolls back; a storage outage or lost delete
response retries under TD-7. After B5 migration/import, pg-boss history is execution evidence,
not the sole object locator. Never delete an unresolved retirement row to make a dashboard green.

The B5 reconciliation cron authorizes **no additional destruction**. It retries already
recorded exact obligations. Age-based Trash selection belongs to the separate ratified
`trash.retention-purge` lifecycle, with its existing deadlines and exceptions unchanged;
this is not a new scan of quarantined objects or permission for live-data cleanup.

---

## Reading the audit log

There is no audit browsing page in the MVP — audit *writing* is mandatory, the reading
interface is deferred. Reads go through SQL.

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

A **null `actor_user_id` means system-initiated**, not attribution lost. The action type and
detail carry the *why*.

---

## Recording an official Hijri month

Recurring administrative work — roughly monthly, after the Ministry announces the sighting.

> **The screen is not built yet.** The four endpoints exist and are Super-Admin-only, so until
> `/superadmin/hijri-calendar` ships the only way to record an announcement is an authenticated
> API call:
>
> ```
> PUT /api/v1/admin/hijri-calendar/{hijriYear}/{hijriMonth}
>     { "gregorian_start_date": "YYYY-MM-DD" }          ← the announced date
> POST /api/v1/admin/hijri-calendar/{hijriYear}/publish  ← nothing renders until this
> ```
>
> **Record two consecutive months wherever possible.** A month whose successor is unrecorded
> resolves for only its certain 29 days, so the tail of the Gregorian month falls silent —
> correct behaviour that reads as a bug. See
> [Calendar and Hijri](../architecture/calendar-and-hijri.md#the-overlay-is-invisible-until-someone-records-a-month--including-in-development).

Once the screen exists:

1. The Super Admin opens **Hijri Calendar Management** and selects the Hijri year.
2. For the announced month, records **the Gregorian date on which the Ministry announced that
   month began**.
3. Saves. The row is `draft` and **renders nowhere yet**.
4. Reviews, then **publishes**. Only published months appear anywhere in the platform.

**The Super Admin records; the Ministry decides.** If the Ministry later issues a correction,
record the correction — the audit row captures both the previous and the new start date,
because *the correction is the interesting event*.

**Until a month is recorded and published, dates in it carry no Hijri label.** That is
correct behaviour, not a bug to work around.

> [Calendar and Hijri](../architecture/calendar-and-hijri.md#the-hijri-overlay)

---

## Recovering from total administrator lockout

If **every** Super Administrator has been suspended or deleted, the bootstrap gate reopens.

1. Set `SUPER_ADMIN_EMAIL` in `.env` to the address that should hold the role.
2. Run the seed:
   ```bash
   docker compose run --rm api npm run seed:production
   ```
3. That address logs in with Google; the identity binds.

**This grants no new authority** — it is reachable only by someone who can already run the
seed on the VPS, and who therefore already holds the database credentials.

**If the address belongs to a soft-deleted account, the seed fails loudly and creates
nothing.** Guessing between resurrecting a deleted person and hijacking their address is not
a decision a seed script may make. Restore the account first, or use a different address.

---

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

If step 2a returns rows, **stop**. The migration will refuse the same state, deliberately.
**Worked example, 2026-08-25 (development).** `safae1025@gmail.com` was claimed by two live
Users: **علا علام**, holding an *active bound* `UserIdentity` on it since 2026-08-02, and a
**pending** account pre-provisioned with the same address ten days later that nobody had ever
signed into. The Owner resolved it in favour of the bound identity and authorised clearing
**only** `pre_provisioned_email` on the pending row — no deletion, no merge, no change to the
identity, roles, enrolments or audit. The migration was then re-run normally.

Prisma records an aborted attempt as **failed**, so `migrate deploy` refuses until it is
resolved. Confirm the transaction genuinely left nothing behind — the `RAISE` aborts the whole
migration, so `to_regclass('public.normalized_email_lock')` should be `ABSENT` and no later
migration should have applied — and only then mark it rolled back, which is the truthful
record, before deploying again:

```bash
npx prisma migrate resolve --rolled-back "20260823210000_normalized_email_ownership_lock"
npx prisma migrate deploy
```

Do not clear `pre_provisioned_email`, deactivate an identity, or merge Users merely to make
the command pass: those operations decide which person owns a verified address and may also
destroy the provenance §4.1b requires. Have the association identify the intended account,
perform the ordinary reviewed account-resolution procedure, take a new dump, rerun the query,
and migrate only when it returns zero rows. Prisma records a failed transactional attempt;
after the cause is resolved, mark that named attempt rolled back with `prisma migrate resolve
--rolled-back <migration-name>` before retrying.

**The dump is the rollback point**, and it must match the pre-migration state exactly. A dump
from the previous night rolls back the migration *and* a night of real work.

Rollback is `docker compose down` plus restoring that dump. **Migrations are forward-only in
production** — no down-migration exists, by policy.

---

## Rotating a signing key

```bash
openssl rand -base64 48
```

| Key | Effect of rotation |
|---|---|
| `JWT_SIGNING_KEY` | Every access token becomes invalid. Users' clients refresh transparently within an hour; **refresh tokens are hashed in the database and are unaffected** |
| `ONBOARDING_TOKEN_KEY` | In-flight registrations (10-minute window) fail and must restart |

They **must remain distinct from each other.**

---

## Investigating a user-reported error

1. Get the **request id** from the error the user saw — the interface shows it discreetly for
   exactly this purpose.
2. Grep the logs:
   ```bash
   docker compose logs api | grep '<request-id>'
   ```
3. The same id appears on any job the request enqueued.

You will find the user id, never their name — [that is deliberate](observability.md#no-pii-in-logs).

---

## Checking whether a job is stuck

```bash
curl -s https://<domain>/healthz \
  | jq '{status, components, jobs: .details.jobs}'
docker compose logs api | grep -i 'job'
```

Interpret the two job-related components separately:

- `queue != "ok"` — PostgreSQL or pg-boss infrastructure is unavailable/not installed.
- `queue == "ok"` and `jobs == "down"` — durable enqueue storage exists, but this API
  process's runner never started, failed registration, stopped, or became stale. Use
  `details.jobs.reason`; restart the API only after recording the startup error from its log.
- `jobs == "ok"` — every implemented worker registered and remains active/fresh. This does
  not certify that every TD-7 release requirement has been implemented.

Jobs retry five times with exponential backoff, then dead-letter with an Admin-visible
failure. **Enqueues keep succeeding even when workers are down** — jobs are delayed, never
lost, and drain on restart.

For a failed `session-recording-ingest` job, distinguish the phase before intervening. If the
recording has no `educational_content_id`, it is an import failure and staging is deliberately
kept for a corrected retry. If the relation is already populated and the job output names
`RecordingStagingCleanupFailure`, the library item is valid and available; the remaining
obligation is only deletion of that row's recorded staging bucket/key. Redrive the existing
job after restoring MinIO. Do not delete the canonical content key, do not enqueue a general
bucket sweep, and do not use `upload.gc` for this recording-specific obligation.

For `consent.reevaluate`, first inspect the named `session_id`. A missing/deleted occurrence
converges as an empty no-op. Since R170 §3 the job writes only `media_consent_missing` (a
warning, both directions) and moves no bytes; do not hand-edit that flag — the next run
recomputes it from the audience.

For `content.bucket-migrate`, inspect `content_id` and the current row before redrive:

- A `consent_migrate` obligation is a pre-R170 leftover: the worker completes it with
  `last_error_code = 'withdrawn_r170'` and touches no object. There is no pending consent
  safeguard state any more.
- Resolve the job's `retirement_id` to its `StorageRetirement` record. Legacy jobs alone
  still carry `source_key`; they must be imported before retention can remove them.
  An ordinary consent migration must
  name the row's current canonical key. `operation = retire_public` is an exact obsolete-key
  obligation after replacement/deletion and must never be rewritten to the current key.
- A private destination with a server SHA-256 and a missing public source is the supported
  delete-succeeded/DB-rollback recovery state; redrive the existing job.
- A retirement whose public source is already missing is complete, including after an
  ambiguous successful delete response. Do not recreate it or delete the replacement key.
- Never manually set visibility to private before confirming the public object is gone, never
  delete the private canonical object, and never use `upload.gc` for this exact transition.
- A terminal job failure does not complete the domain obligation. Restore MinIO/repair the
  named inconsistency, then reconcile pending records; do not enqueue a general bucket sweep.

### B5 retirement backlog and rollout

Stop old writers/workers, take the ordinary validated backup, apply migration 96, and
run `importLegacyRetirements` from the built storage-retirement repository **before starting
pg-boss maintenance on the upgraded host**. It uses the existing queue tables and the same
transactional enqueue implementation; do not start a parallel worker for this step. Normal
API startup repeats import and reconciliation idempotently. The early import matters because
retention may already be due on old failed jobs. Already-expired legacy coordinates cannot be
reconstructed from hashed audit metadata; investigate any pre-upgrade inventory separately
under explicit authorization, never guess deletion targets. No live rollout occurred in the
local B4/B5/B6 verification.

Read pending work without exporting filenames/locators:

```sql
SELECT id, content_id, operation, bucket, copy_settled, attempts, last_error_code,
       created_at, next_attempt_at
FROM storage_retirement
WHERE completed_at IS NULL
ORDER BY next_attempt_at, id
LIMIT 250;
```

`STORAGE_OPERATION_FAILED` retains the exact operational key for retry; successful
resolution clears it. The existing quarantine queue's `{operation: 'reconcile'}` handler
re-enqueues due records in bounded pages, at startup and daily. A healthy worker registry
does not prove this backlog is empty. Check both, and retain unresolved rows across job
expiry, terminal failure, restart and backup/restore. The supported handler rechecks current
canonical authority before any deletion; never replace its coordinate with a newer key.

`COPY_OUTCOME_UNKNOWN` means the placement request may still take effect remotely.
Do not mark it complete merely because HEAD reports absence, the worker is green,
or an arbitrary delay elapsed. Normal reconciliation observes a late copy,
durably records settlement and retires it under canonical-reference protection.
If no object ever appears and no positive no-dispatch/completion evidence survives,
the unresolved row is intentional; keep its locator and investigate the specific
operation rather than inventing an age-based deletion/metadata-expiry rule.

If backup replication has failed twice consecutively, escalate to the owner.

---

## Entering launch data

Branches, rooms, groups, and rosters are entered **manually through the admin UI**, with the
branch coordinator. **Seeding them into production is prohibited.**

Budget dedicated hours for this — it is
[Risk R-5](../overview/scope-and-roadmap.md#open-risks), not a footnote. Arabic search
normalization softens paper-roster spelling variance, but the typing is real work.

Order matters: branches → rooms → levels are reference data (**Super Admin**), then groups
and rosters are operational (**Admin**, within scope).

---

## Verifying the storage proxy after an Nginx change

A signed round trip **through the proxy** — never direct to MinIO, which is the one path
production never uses:

```bash
bash scripts/dev/test-integration.sh   # includes the storage-proxy round trip
```

A `SignatureDoesNotMatch` failure after an Nginx edit almost always means the `/storage/`
location stopped stripping the prefix, or stopped rewriting `Host` consistently with the
endpoint the signature was computed for. Non-default test ports are part of that exact Host;
normalizing them away invalidates the signature. Also verify a signed public-staging PUT,
an unsigned staging GET denial, one current canonical public read, and one forced/deleted
canonical public denial—the staging and canonical locations intentionally have different
authorization behavior. Inspect `nginx -T`, not only the source file, then verify that
canonical and staging S3 Select-style POST plus DELETE receive Nginx `405`, that unsigned PUT
still receives MinIO `403`, and that `/storage/public`, `/storage/public/` and either form with
`?list-type=2` cannot return a bucket listing. Duplicate/encoded separator probes must either
select the same denial or fail the exact-coordinate authorizer; none may fall through the
generic `/storage/` proxy.

For the temporary P0.1 object-store defence, `nginx -T` must also show the shared
`STREAMING-UNSIGNED-PAYLOAD-TRAILER` rejection on every proxied storage location. The safe
regression sends only that header on an unsigned, bodyless representative PUT: it must return
`403` with `X-Bodour-Storage-Policy: unsigned-trailer-denied`, proving Nginx—not MinIO—made
the decision. Do not construct a chunked payload or attempt to reproduce the vulnerability.
The signed proxy round trip above must pass in the same run. This filter does not remove the
[Owner-blocked supported-object-store requirement](../architecture/storage.md#owner-decision-required--object-store).

### B-03 rollout: let legacy direct PUT capabilities expire

The R103 application release accepts outstanding non-replacement upload tickets through the
SHA-256 finalizer, but **refuses every outstanding replacement ticket that lacks
`replaces_version`**. There is no two-hour completion-ticket wait: the refusal is fail-closed
at deployment, the old content remains authoritative, and the user simply initiates the
replacement again. No accepted content row or historical object is rewritten.

Already-completed rows from the former direct-upload release are different: their original PUT
target is their canonical key, and an issued presigned URL cannot be individually revoked.

Stop the old API before rollout and record that time. Do not declare the immutable-
finalization invariant fully active until one PUT TTL (one hour) has passed since that stop;
after that bound every old direct capability has expired. The new release may run during the
drain because all newly issued URLs target staging. Do **not** rotate object-store credentials
or rewrite historical keys as a shortcut: either is a separate operational/data migration
with a wider blast radius. The development audit on 2026-08-24 found 11 current rows proven
to have been created by the former direct upload path, with the newest upload audit older
than two days, so no development URL remained live.

The one-hour bound is repository-wide: `PRESIGN_TTL_SECONDS.put` is the only production PUT
TTL and no other production presigner overrides it. R103 does not change that TTL. After the
drain, newly accepted browser uploads use 32-hex SHA-256-based canonical identities; R99
provider recordings retain their existing server-controlled ingestion keys.

---

**Related:** [Deployment](deployment.md), [Resilience](resilience.md),
[Database](../architecture/database.md)
