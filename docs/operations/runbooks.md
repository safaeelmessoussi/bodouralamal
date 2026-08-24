[Documentation](../README.md) › [Operations](README.md) › **Runbooks**

# Runbooks

Step-by-step procedures for things that will actually happen.

> Procedures that touch real beneficiary data run **only** on the production VPS, by someone
> authorised by the association. Nothing here is a reason to copy production data anywhere.

---

## Restoring a soft-deleted record

**Never run restoration SQL directly in `psql`.**

The reason is stated plainly in the specification: *a raw session enforces nothing, and
accountability would depend on developer goodwill.*

Restoration runs through a **locked CLI maintenance script checked into the repository**:

```bash
docker compose run --rm api npm run db:restore -- --entity=User --id=<uuid>
```

The script wraps three things in **one transaction**:

1. Restoring the row from its Trash snapshot — clearing `deleted_at` / `deleted_by`
2. **Reinstating the relationship rows the cascade removed**
3. Writing the `trash.manual_restore` audit row

### Step 2 is the one that gets forgotten

Deleting a user cascades: family links, group assignments, branch-role assignments, and
identity deactivations. Restoring the user row alone produces **a half-restored, silently
broken account** — a person who exists, can log in, and has no roles, no enrolments, and no
children.

The runbook must explicitly capture and reinstate:

- `FamilyLink`
- `Enrollment` — **and with it the student's level membership**, which is stored nowhere
  else (BR-21). A user restored without their enrolments has no level, no group and no
  branch
- `StudentTeachingGroup`
- `CourseScheduleStaff` — a teacher restored without these staffs no courses, and any
  schedule left with no `teacher` position must surface to Admins as unstaffed
- `UserBranchRole`
- `UserIdentity` deactivations

The Trash snapshot contains them. The script's job is to put them back.

> The Trash restoration **UI shipped** (R52), and **permanent deletion with it** (R59.1).
> The snapshot and the 90-day window remain non-negotiable
> ([`BR-15`](../reference/business-rules.md#br-15)).

### When to use this runbook rather than the screen

The screen handles the types whose reinstatement is **written and tested** — today
`Branch`, `Category`, `Subject`, `Room`, `Exam` (R59.3) and `HijriMonthStart` (R59.5). It
refuses everything else loudly, with the reason on the row, because clearing `deleted_at` is
the easy tenth of the problem and every failure of the other nine is silent.

This runbook is for the refused ones. A `User` is the case it was written for and remains
the hardest: six relationship types, listed above.

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
| `User` | `ACCOUNTABILITY_RECORD` — a person's row is referenced by `AuditLog` and `Trash` themselves, so destroying it takes the record of who deleted what | The account stays soft-deleted with its fields anonymised. Erasure of a person's data is R54's decision, and it is about anonymisation, not row destruction |
| `RecurringCourseSchedule` | `CASCADE_CHILDREN` — its Sessions are materialized rows other records reference, so destroying it destroys a timetable's history | Purge the Sessions that block it first, or leave it to BR-15 |

> **BR-15's 90-day window is not enforced by anything.** Revisions 52 and 53 both state that
> `content.quarantine-purge` (TD-7) closes it. **That job was never built** (R59.4):
> `purge_after` is written on every tombstone and nothing has ever read it. Until it ships,
> the only permanent deletion on this platform is the deliberate Super Admin action above.

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
endpoint the signature was computed for.

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
