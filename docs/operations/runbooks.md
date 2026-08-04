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

> The Trash restoration **UI** is post-MVP. The snapshot and the 90-day window are not — they
> are non-negotiable ([`BR-15`](../reference/business-rules.md#br-15)).

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

# 3  Apply
docker compose run --rm api npx prisma migrate deploy

# 4  Verify
curl https://<domain>/healthz
```

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
curl -s https://<domain>/healthz | jq        # is the queue heartbeat alive?
docker compose logs api | grep -i 'job'
```

Jobs retry five times with exponential backoff, then dead-letter with an Admin-visible
failure. **Enqueues keep succeeding even when workers are down** — jobs are delayed, never
lost, and drain on restart.

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

---

**Related:** [Deployment](deployment.md), [Resilience](resilience.md),
[Database](../architecture/database.md)
