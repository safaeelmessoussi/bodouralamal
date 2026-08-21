[Documentation](../README.md) › [Operations](README.md) › **Deployment**

# Deployment

A deterministic pipeline from a clean VPS to a healthy platform. Ten steps, in order.

## Prerequisites

- An Ubuntu VPS from a **Moroccan provider**, minimum **4 GB RAM**, with Docker and Compose v2
- A second Moroccan location for offsite backups
- A domain with DNS control, for Let's Encrypt
- Google OAuth client credentials — **allow days to weeks** for consent-screen verification

## The pipeline

```bash
# 1  Clone
git clone <repo> && cd <repo>

# 2  Configure
cp .env.example .env          # fill every Required value
cp infra.env.example infra.env # the Postgres password — must match DATABASE_URL
#    SUPER_ADMIN_EMAIL is needed for the FIRST deployment only

# 3  Pull images — BUILT IN CI, never built here
docker pull <registry>/bodour-api:<tag>

# 4  Existing deployment: stop the legacy cookie issuer, then start data services
#    R101's next migration invalidates every live refresh session. The old API
#    must not mint another narrow-path cookie after that one-time sweep.
docker compose stop nginx api
docker compose up -d db minio

# 5  Migrate
#    ON AN EXISTING DEPLOYMENT: pg_dump IMMEDIATELY BEFORE this line.
#    Migrations are forward-only; this dump is the rollback point.
docker compose run --rm api npx prisma migrate deploy

# 6  Seed — idempotent, safe to re-run
docker compose run --rm api npm run seed:production

# 7  Start the rest
docker compose --profile production up -d    # api, nginx, certbot

# 8  Verify
curl https://<domain>/healthz                # 200, all components green

# 9  The Super Admin performs their first Google login
#    (the identity binds to the pre-provisioned account)

# 10 Smoke test: journey J1 · backup dry run · restore drill
```

## Why images are built in CI, never on the server

> The frontend build peaks near **2 GB**, which will OOM or thrash a 4 GB box already running
> PostgreSQL, MinIO, and Node.

The emergency-only fallback is: bring the stack **fully down**, then build. Not with the
stack running.

This is also why the container memory pins have any headroom at all — the budget assumes no
build ever competes with the running services.

## Step 5 deserves its own paragraph

**Take the `pg_dump` immediately before `prisma migrate deploy`, not the night before.**

Migrations are forward-only in production. Down-migrations are never written and never run.
Rollback means **restoring that dump**, so it must match the pre-migration state exactly —
a dump from twelve hours earlier rolls back the migration *and* twelve hours of real work.

Before it reaches production, every migration has already been **rehearsed against a staging
database seeded to ceiling-scale fixtures**. Duration matters: an `ALTER` that rewrites a
million audit rows must be known about beforehand, not discovered during a deploy window.

The Revision-101 deployment intentionally signs everybody out once. With the legacy API
already stopped, its migration marks every live refresh row `cookie_path_migration` and
writes system `auth.token_revoked` audit rows before the new `/api/v1/auth` cookie Path is
issued. Users authenticate again after the deployment. Do not restart the old API after this
migration: it would be able to mint a narrow-path credential after the invalidation boundary.
Do not start the new API before step 5 either: the data migration intentionally selects every
live row visible at that point. Prisma records it in `_prisma_migrations`, so repeating
`migrate deploy` is safe and does not sweep sessions issued after cutover; executing the raw
SQL manually is not an operating procedure. Step 7 is the only point that may begin issuing
the new cookie.

> [Database § migrations](../architecture/database.md#migrations)

## Rollback

```bash
docker compose down
# restore the latest pg_dump per the documented procedure
```

Migrations are forward-only. There is no down-migration path, by policy.

## TLS

Certbot runs under a `production` compose profile, renewing via the webroot challenge on a
12-hour loop. The HTTP server block keeps serving the ACME challenge and redirects
everything else to TLS.

**Renewal failure alerts at 21 days remaining** — never discovered as a browser error by a
user.

## What the seed does, and does not do

**Does** (idempotently, safe to re-run):

- Roles: super admin, admin, teacher, student, parent — **seeded here and not
  user-manageable**; no role CRUD exists or is to be built
- Categories: الكبار / اليافعون / الطفل, as **generic educational stages**
- Levels, with **real sex restrictions** rather than a blanket permissive value — which is
  what makes availability a fact a query can read
- Subjects: تفسير, فقه, محو الأمية — **the Quran is deliberately not a Subject**
- The academic year, with exactly one marked current
- All **114 Surahs** from a verified static dataset in the repository
- Settings defaults, including the grading scale
- The Super Admin, **only while no active one exists**

**Does not**, and this is enforced:

> **Branches, rooms, groups, and rosters are never seeded into production.** They are entered
> through the admin UI from real data. **Seeding fake branches into production is
> prohibited.**

Development fixtures do carry two real branch premises so the landing page renders against
realistic data locally — which is exactly the split that keeps production clean.

## First deployment versus subsequent ones

| | First | Subsequent |
|---|---|---|
| `SUPER_ADMIN_EMAIL` | **Required** — the seed fails loudly by name without it | Ignored permanently; may be removed from `.env` |
| `pg_dump` before migrating | Not applicable | **Mandatory** |
| Restore drill | **Before go-live** | Periodically |

## Staging

Pushing to `develop` triggers an automatic Vercel build of the frontend, in a
**fixture-pointing configuration only**. It calls no real backend.

## The dress rehearsal

Before launch, the full pipeline runs **on the production VPS itself**, because the staging
topology exercises none of the VPS realities — memory ceilings, TLS automation, the backup
pipeline. It is followed by user-acceptance testing with the branch coordinator, including a
**staff-assisted Google-account registration drill** with a real low-digital-literacy
beneficiary.

That drill is not a formality. It is the check on
[Risk R-1](../overview/scope-and-roadmap.md#open-risks), and the standing instruction is to
**escalate rather than launch** if it surfaces a large excluded population.

## Deployment checklist

- [ ] Pipeline runs clean from a clean VPS to a green health check
- [ ] Fixtures-only rule respected outside Morocco
- [ ] Hand-written migration SQL present in the history (CI-checked)
- [ ] `db push` appears in no script (CI-checked)
- [ ] Backup job runs, and a **restore drill completes inside the RTO target**
- [ ] Per-IP rate limits active at Nginx
- [ ] Per-user upload quota enforced, proven by exhausting it
- [ ] Same-origin routing serves client, API, and storage under one domain
- [ ] R101 deployment only: old API stopped before migration; users warned that sessions will end
- [ ] Signed PUT/GET round trip passes **through the proxy**
- [ ] No PII in logs (log audit)

---

**Next:** [Observability](observability.md) · **Related:**
[Environments](environments.md), [Resilience](resilience.md), [Runbooks](runbooks.md)
