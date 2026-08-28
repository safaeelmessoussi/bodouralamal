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
pre-backup service set is restarted even on failure. The restic image is immutable by digest;
the password file is root-only and is never included in the snapshot.

This is intentionally host-scoped. The API and its pg-boss workers are unprivileged
containers; mounting the Docker socket into either would grant root-equivalent control of the
VPS. The current executable tooling does not make that trade.

### OWNER DECISION REQUIRED — BACKUP TARGET AND RETENTION

Before Production, the Owner must provision an SFTP/SSH repository at a **second Moroccan
location**, pin its host key in a dedicated `known_hosts`, escrow a strong restic password and
SSH recovery key separately, and choose a retention schedule. Safe target categories are a
second association-controlled Moroccan VPS or a contracted Moroccan-resident SFTP service;
an overseas service is prohibited even when encrypted. The recommendation is a separately
administered Moroccan SFTP target whose credentials cannot modify the primary VPS.

The SRS fixes the nightly RPO and sub-hour RTO but does not set the destructive snapshot
retention horizon. Until the Owner chooses one, the tooling runs no `forget` or `prune` at
all. A reasonable decision set to evaluate is daily/weekly/monthly tiers (for example 7 daily,
5 weekly and 12 monthly) versus a longer legal/operational horizon; cost, erasure obligations
and the recovery window differ, so the repository does not pick between them.

Create a Production recovery point from `/opt/bodour`:

```bash
sudo scripts/backup/create-recovery-point.sh \
  --repository "$BACKUP_TARGET_SSH" \
  --password-file /root/bodour-backup/restic-password \
  --ssh-dir /root/bodour-backup/ssh \
  --config-file /opt/bodour/.env \
  --config-file /opt/bodour/infra.env
```

`BACKUP_TARGET_SSH` may be the TD-13 spelling `user@host:/path`; the tool normalizes it to
restic's SFTP backend. Production refuses a local repository. Conversely,
`--allow-fixtures` refuses SFTP, so a disposable drill cannot copy fixtures externally.
The initial snapshot may take longer than incremental nights because all four volumes are
new; measure the maintenance window on the production VPS before launch.

Restore only onto fresh, empty named volumes. The tool refuses a running project, refuses a
non-empty volume, requires an exact Production confirmation, verifies the logical dump's
SHA-256, restores the raw volumes, writes the dump, manifest and recovered `.env`/`infra.env`
into a new root-only directory for comparison, and deliberately leaves services stopped:

```bash
sudo scripts/backup/restore-recovery-point.sh \
  --repository "$BACKUP_TARGET_SSH" \
  --password-file /root/bodour-backup/restic-password \
  --ssh-dir /root/bodour-backup/ssh \
  --recovered-config-dir /root/bodour-recovered-config \
  --confirm-production-restore RESTORE_TO_EMPTY_PRODUCTION_VOLUMES
```

Compare/install the recovered configuration, start the exact recorded commit, then verify
PostgreSQL migrations and row counts, all object buckets, `/healthz`, worker readiness, signed
private GET/PUT, the public exact-coordinate gate, and one application journey. Never restore
a Production snapshot into Local, Preview or Staging.

The custom-format PostgreSQL dump is portable. The raw PostgreSQL and object-store volume
copies are deliberately the fast, exact same-version disaster path and are **not** a claim of
cross-vendor object portability. After the Owner selects the supported object store, update
the backed-up volume set/export format, then repeat the compatibility and restore suite before
Production. Do not restore a MinIO volume under a different vendor or unverified release.

The destructive disposable proof is:

```bash
bash scripts/backup/verify-backup-restore.sh
```

It creates uniquely named PostgreSQL/MinIO volumes and a local encrypted repository, records
known database and object values, snapshots, destroys both volumes, restores into empty
volumes, validates the portable dump catalog and reads both values back. The accepted run on
2026-08-26 completed in **33 seconds**,
inside the one-hour RTO. It proves the tooling; only a drill on the selected Moroccan target
with realistic data volume proves Production's RTO.

**Still open:** the nightly `backup.replicate` pg-boss automation, critical Admin-visible
failure/staleness alert, remote Moroccan target, chosen retention, and production-host drill.
Production remains blocked until those exist. Do not substitute an unmonitored host cron or a
Docker-socket mount and call the job complete.

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
`User` (R111), `Branch`, `Category`, `Subject`, `Room`, `Exam` (R59.3) and
`HijriMonthStart` (R59.5). It refuses everything else loudly, with the reason on the row,
because clearing `deleted_at` is
the easy tenth of the problem and every failure of the other nine is silent.

### Permanent deletion, and what it will not do

`DELETE /admin/trash/{id}` (Super Admin only) destroys a record, its **declared** cascade
children and its tombstone in one transaction, and writes a `trash.permanent_delete` audit
row that is retained indefinitely — it is deliberately absent from the `audit.purge`
allowlist, so the record of an irreversible act outlives the audit horizon.

It refuses, rather than cascading, when a live row still references the record
(`DEPENDENTS_EXIST`, naming the constraint). **Clear the dependants first, deliberately** —
the refusal is the safeguard, and there is no force flag by design.

Two types have no destruction plan at all:

| Type | Reason | What to do instead |
|---|---|---|
| `User` | `ACCOUNTABILITY_RECORD` — a person's row is referenced by `AuditLog` and institutional records, so destroying it takes their meaning and the record of who acted | Use R111 permanent de-identification. The non-identifying tombstone remains; its personal fields, credentials, planning data and recoverable snapshot do not |
| `RecurringCourseSchedule` | `CASCADE_CHILDREN` — its Sessions are materialized rows other records reference, so destroying it destroys a timetable's history | Purge the Sessions that block it first, or leave it to BR-15 |

The deliberate action is storage-durable for `EducationalContent`: its transaction inserts an
exact `content.quarantine-purge` obligation before deleting the content row and Trash locator.
If the queue is absent the whole transaction rolls back; a storage outage or lost delete
response retries under TD-7. Operators must not manually remove a failed job, because after
the row is gone that payload is the durable record of the two possible object leftovers.

> **OWNER DECISION REQUIRED — AUTOMATIC QUARANTINE DESTRUCTION.** Revisions 52 and 53 state
> that `content.quarantine-purge` closes BR-15 after 90 days, while R59.4 reserves activating
> automatic Production destruction to the Document Owner. The queue now processes explicit
> replacement/deletion/manual-purge coordinates, but it is deliberately not scheduled against
> `purge_after`; expired Trash remains until a Super Admin acts. Take the object-store and
> backup/retention decisions and complete a Production-scale restore drill before authorising
> the automatic arm.

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

-- Consent-gate overrides, with their mandatory justifications
SELECT created_at, actor_user_id, target_id, detail->>'justification' AS justification
FROM "AuditLog"
WHERE action_type = 'consent_gate.override'
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
curl https://<domain>/healthz
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
converges as an empty no-op; a repeated storage/placement inconsistency is fail-closed and must
be investigated rather than bypassed. Do not clear `consent_forced_private` to make the job
green.

For `content.bucket-migrate`, inspect `content_id` and the current row before redrive:

- `consent_forced_private = true`, `visibility = public`, `storage_bucket = public` is a valid
  pending safeguard. Public application reads and Nginx's stable object URL are already
  closed; only the network-internal public-bucket copy remains until migration succeeds.
- Inspect `source_key` and `operation` in the job payload. An ordinary consent migration must
  name the row's current canonical key. `operation = retire_public` is an exact obsolete-key
  obligation after replacement/deletion and must never be rewritten to the current key.
- A private destination with a server SHA-256 and a missing public source is the supported
  delete-succeeded/DB-rollback recovery state; redrive the existing job.
- A retirement whose public source is already missing is complete, including after an
  ambiguous successful delete response. Do not recreate it or delete the replacement key.
- Never manually set visibility to private before confirming the public object is gone, never
  delete the private canonical object, and never use `upload.gc` for this exact transition.
- A terminal failure remains in pg-boss after five attempts. Restore MinIO/repair the named
  inconsistency, then redrive; do not enqueue a general bucket sweep.

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
