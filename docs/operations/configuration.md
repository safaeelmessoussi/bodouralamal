[Documentation](../README.md) › [Operations](README.md) › **Configuration**

# Configuration

All runtime configuration flows through **environment variables** or the **settings table**.
Nothing is hardcoded.

## Two kinds of configuration

| | **Environment variables** | **`SystemSetting` table** |
|---|---|---|
| Changed by | An operator editing `.env`, then restarting | A Super Admin, in the application |
| Requires | A restart | Nothing |
| Holds | Connection strings, secrets, origins, tiers | Branding, legal text versions, category default visibilities, grading scale |
| Validated | **At boot, fail-fast** | At write time |

## The variable inventory

The specification's table is **the single authoritative list**; `.env.example` is generated
from it and must stay in lockstep. **The application fails fast at boot with a named error
if any required variable is missing.**

### Required

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL, for both Prisma and the job queue |
| `GOOGLE_CLIENT_ID` | OAuth client |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `JWT_SIGNING_KEY` | Access-token signing. Rotatable |
| `ONBOARDING_TOKEN_KEY` | Onboarding-token signing — **must be distinct** from the JWT key |
| `MINIO_ENDPOINT` | Internal S3 API endpoint |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | Storage credentials |
| `PUBLIC_BASE_URL` | The canonical origin. Also what the refresh endpoint validates `Origin` against |
| `STORAGE_BASE_URL` | Public storage path prefix. **Presigned URLs are signed against this**, so signatures survive the proxy |
| `NODE_ENV` | `production` \| `development` \| `test`. Boot validation enumerates exactly these three, so a typo fails fast rather than silently passing the non-production guard |

The origin relationship is validated, not conventional: `PUBLIC_BASE_URL` must be one
canonical HTTP(S) origin with no path/query/fragment/trailing slash, and `STORAGE_BASE_URL`
must be exactly its same-origin `/storage` path. Every non-loopback public origin requires HTTPS;
HTTP is accepted only for Local Development on `localhost`, `127.0.0.1`, or `[::1]`.
`JWT_SIGNING_KEY` and `ONBOARDING_TOKEN_KEY` must be distinct; reusing one key would collapse
two separately scoped credential boundaries.

### Conditional

| Variable | When |
|---|---|
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_SEX` | **Platform Owner bootstrap only.** See below |
| `BACKUP_TARGET_SSH` | Production only — the offsite Moroccan backup target |

### Optional, with defaults

| Variable | Default | Purpose |
|---|---|---|
| `TZ` | `Africa/Casablanca` | Container wall-clock alignment |
| `PORT` | `3000` | API listen port behind Nginx |
| `LOG_LEVEL` | `info` | `info` \| `debug`. **`debug` is prohibited in production** |

## Secrets have no defaults, by design

> **A secret that silently defaults is a vulnerability, not a convenience.**

Every secret in `.env.example` is intentionally empty. The generation guidance in the
comments (`openssl rand -base64 48`) is **documentation, not an auto-generation mechanism** —
nothing generates a key for you, because a generated-on-first-boot key is a key nobody knows
they need to back up.

Secrets never appear in logs, error payloads, or the API contract. A CI guard fails the
build if an `.env` file is ever committed.

The checked-in template defaults to `NODE_ENV=development` for Local Development. Release
hosts do not trust that editable default: `docker-compose.production.yml` forces
`production`, and the fixture-only Staging overlay forces `development`.

### One example of that discipline in the compose file

MinIO's init container passes credentials through `MC_HOST_local` — the documented
credential channel — rather than on the command line, so the secret never surfaces in
`docker compose config`, `docker inspect`, or a process list.

## Platform Owner bootstrap values

The variable with the most subtle lifecycle in the system.

- **The running API never reads them.**
- Before `PlatformOwner('platform')` exists, the seed requires exactly
  `SUPER_ADMIN_EMAIL=safae.elmessoussi@gmail.com` and `SUPER_ADMIN_SEX=female`, failing
  loudly and atomically on any other value or identity conflict.
- Once the singleton exists, both values are ignored permanently and may be removed from
  `.env`. A rerun cannot reclaim a valid transfer, create an automatic successor, or reopen
  because the active-Super-Admin population changed.

**Editing these lines later does not move ownership or a role.** Ownership transfers through
the application to another eligible Global Super Admin; ordinary administrator changes use
the ordinary role-management workflow. The database remains the source of truth.

> Full resolution order:
> [Identity and access](../architecture/identity-and-access.md#platform-owner-and-initial-bootstrap)

## Runtime settings

Held in `SystemSetting`, editable by a Super Admin:

- Branding assets
- Legal and consent **text versions** — which consent records reference, so a version is
  never retroactively rewritten
- Per-category default content visibility
- **`grading.display_scale = 20`** and **`grading.passing_grade_bp = 5000`** — the
  association's /20 scale with a 10/20 pass, expressed in basis points so the comparison
  stays integer-only end to end

Per-level grading overrides are **settings rows, not columns**. The level and category
entities carry only a name, display order, and (for level) the sex restriction — adding a
passing-grade column to them is explicitly non-compliant.

## Rate limits

Split across two layers because one **cannot** do the other's job.

| Layer | Limit |
|---|---|
| **Nginx, per IP** | Auth endpoints 10 req/min · general API 120 req/min |
| **Nginx, per IP, uploads** | A coarse guard at the nearest expressible floor (`1r/m`) — **explicitly not the quota** |
| **Application, per user** | **Upload initiations 30/hour** — the authoritative quota, counted in PostgreSQL |

Nginx keys on connection variables and cannot read a token subject; its grammar admits only
`r/s` and `r/m`, so an hourly quota has no representation there.

> [Security](../architecture/security.md#rate-limiting-in-two-layers)

## Body size limits

```nginx
location /api/v1/  { client_max_body_size 2m;   }
location /storage/ { client_max_body_size 110m;
                     proxy_request_buffering off; }
```

**Never raise the body limit globally to "fix" uploads.**

## Resource pins

These are configuration, not suggestions — leaving any at its default is non-compliant.

```
Postgres   max_connections=30 · shared_buffers=256MB · work_mem=8MB
           statement_timeout=10s
MinIO      GOMEMLIMIT=512MiB
Node       --max-old-space-size=768
Prisma     connection_limit=10
pg-boss    pool ≤ 5
```

Target steady state ≈ 2.2 GB on a 4 GB box.

## Changing configuration safely

1. **Adding a variable** means updating the specification's inventory table first — it is
   the authoritative list — then regenerating `.env.example`, then the boot validation.
2. **Rotating a signing key** invalidates every token signed with it. Access tokens die
   within an hour; refresh tokens are hashed in the database and are unaffected by a JWT key
   rotation.
3. **Changing `PUBLIC_BASE_URL`** changes what the refresh endpoint accepts as a valid
   `Origin`, and what presigned URLs are signed against. Both break together if it is wrong.

---

**Next:** [Deployment](deployment.md) · **Related:**
[Environments](environments.md), [Security](../architecture/security.md#secrets)
