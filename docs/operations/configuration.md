[Documentation](../README.md) › [Operations](README.md) › **Configuration**

# Configuration

All runtime configuration flows through **environment variables** or the **settings table**.
Nothing is hardcoded.

## Two kinds of configuration

| | **Environment variables** | **`SystemSetting` table** |
|---|---|---|
| Changed by | An operator editing `.env`, then restarting | A Super Admin, in the application |
| Requires | A restart | Nothing |
| Holds | Connection strings, secrets, origins, tiers | Branding and platform settings; legal documents/consent versions and category defaults have their own domain records |
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
| `EMAIL_LOCK_KEY` | Required dedicated email-lock HMAC secret, at least 32 bytes and distinct from both signing keys. No fallback; never stored in the database |
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
| `BACKUP_TARGET_SSH` | Production-only nonempty legacy setting; B8 temporarily permits `/var/lib/bodour-backups/bodour`. Host backup paths/key/floor belong to the separate root-only [operator configuration](recovery.md#before-enabling-anything-on-an-authorized-host), not the API |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Optional as a complete group; half-configuration refuses boot. `LIVEKIT_API_URL` optionally supplies the server-side endpoint. Without the group, media actions fail closed, not the whole API. Production media processing requires its own approved Moroccan location/contract |

### Optional, with defaults

| Variable | Default | Purpose |
|---|---|---|
| `TZ` | `Africa/Casablanca` | Container wall-clock alignment |
| `PORT` | `3000` | API listen port behind Nginx |
| `LOG_LEVEL` | `info` | `info` \| `debug`. **`debug` is prohibited in production** |
| `RECORDING_STAGING_BUCKET` | `recordings-staging` | Provider-ingest staging, never a public content bucket |

### Exact-release host inventory

This is a provisioning checklist, **not a command to provision this workspace**.
Derivation: [`config.ts`](../../backend/src/lib/config.ts),
[`infra.env.example`](../../infra.env.example), the root Compose overlays and
the [B8 root-only environment](recovery.md#before-enabling-anything-on-an-authorized-host).

- Application `.env` and bootstrap `infra.env` remain operator-owned mode `0600`.
  `POSTGRES_PASSWORD` must match the URL-encoded password in `DATABASE_URL` for
  internal host `db`, database `bodour`, user `app`. No externally published DB port.
- Generate independent random signing/onboarding/email-lock and storage credentials
  directly into private host files, never command arguments, chat, shell recordings,
  Git or printed resolved Compose. The existing guidance is 48 random bytes encoded
  as base64; preserve special-character escaping in environment/URL formats.
  Record secure retrieval/rotation custody, not values, in the private operator record.
- `MINIO_*` names stay for compatibility with SeaweedFS, internal `http://minio:9000`;
  AWS aliases in Production Compose resolve from the same secrets. Do not run the
  legacy MinIO image or attach its populated physical volume to SeaweedFS.
- `PUBLIC_BASE_URL=https://bodouralamal.com` and `STORAGE_BASE_URL` exactly that
  origin plus `/storage`; Google redirect exactly
  `https://bodouralamal.com/api/v1/auth/google/callback`, scopes `openid email`.
  **OWNER INPUT REQUIRED:** separately authorized Production OAuth client/domain
  configuration, final privacy URL/text and transfer review; no console change here.
- `COMPOSE_PROJECT_NAME` and full `BODOUR_RELEASE_TAG` identify the exact accepted
  checkout/images. Keep `TZ=Africa/Casablanca`, `PORT=3000`, `LOG_LEVEL=info` and
  the Production overlay's `NODE_ENV=production`; no developer auth mechanism.
- Seed-only Owner values below are not recurring credentials. Restic key, repository
  pin, backup floor and timers belong only to B8 host configuration, never the API.
  No shared Production/Staging secrets or backup key committed to the checkout.

### Secret rotation and installation, at a glance

Every value below is generated independently (`openssl rand -base64 48` unless noted),
written directly into the operator's private `.env`/`infra.env`/root-only recovery
config — **never** a command argument, chat message, ticket, or printed resolved
Compose — and installed only on the target host. A placeholder shown here is a
**format example, never a usable value.**

| Variable | Secret? | Generation | Restart required to take effect? |
|---|---|---|---|
| `DATABASE_URL` password component | Secret | Random, matched to `POSTGRES_PASSWORD` in `infra.env` | `db` + `api` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Secret (Owner/Google Cloud Console) | Issued by Google Cloud Console, not generated locally | `api`; live OAuth users are unaffected until Google itself revokes the old value |
| `JWT_SIGNING_KEY` | Secret | Random ≥32 bytes | `api`; every access token signed with the old key is invalidated immediately, every refresh token is unaffected (hashed, not signed by this key) |
| `ONBOARDING_TOKEN_KEY` | Secret | Random ≥32 bytes, distinct from `JWT_SIGNING_KEY` | `api`; only in-flight onboarding tokens are invalidated |
| `EMAIL_LOCK_KEY` | Secret | Random ≥32 bytes, distinct from both keys above | `api`, plus the [stopped-writer truncate/re-key migration](../development/email-lock-keying.md) — never a live rotation |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | Secret | Random, shared identically between the `api`, `minio` (SeaweedFS) and `minio-init` services | `minio` + `minio-init` + `api`; a mismatch after rotation fails the S3 initializer's own credential-match preflight |
| Backup repository encryption password | Secret, **escrowed separately from the host** | Random ≥32 bytes, written directly on the host (never through this application) | Not a live-restart concern — see [recovery.md](recovery.md#before-enabling-anything-on-an-authorized-host); rotation is a new-key procedure, never an overwrite |
| `PUBLIC_BASE_URL` / `STORAGE_BASE_URL` | Public (not secret) | Fixed by the accepted domain | `api`; changes what the refresh endpoint accepts as `Origin` and what presigned URLs are signed against |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_SEX` | Sensitive, one-time only | Fixed values, not generated | Read only by the seed before the Owner singleton exists; ignored forever after |
| `BODOUR_RELEASE_TAG` | Public (a commit SHA, not a secret) | Set to the exact accepted 40-character commit | Every Compose command in the pipeline |

Logging/monitoring destinations and required alerts are **not** environment variables in
this codebase — there is currently no external log/metrics sink and no Admin-visible
alert surface; see [Observability](observability.md#required-alerts--not-implemented-yet)
for the exact gap and the interim host-level [operator signal](recovery.md#operator-signals-not-an-invented-dashboard).

## Secrets have no defaults, by design

> **A secret that silently defaults is a vulnerability, not a convenience.**

Every secret in `.env.example` is intentionally empty. The generation guidance in the
comments (`openssl rand -base64 48`) is **documentation, not an auto-generation mechanism** —
nothing generates a key for you, because a generated-on-first-boot key is a key nobody knows
they need to back up.

Secrets never appear in logs, error payloads, or the API contract. A CI guard fails the
build if an `.env` file is ever committed.

### Email-lock rollout and rotation

The B3 migration is **not a rolling upgrade**. Stop every email-ownership writer,
including API instances and seed/bootstrap processes, before applying
`20260911100000_deletion_generation_identity_minimization`. Provision the same
operator-generated `EMAIL_LOCK_KEY` for every writer before restarting the new code.
The migration discards ownerless plaintext lock coordinates, not User/UserIdentity
ownership. It also minimizes copied claim credentials for audit-proven permanent
deletions; it does not purge recoverable accounts. Never roll back to the old binary
against the new schema, or restore a pre-erasure backup just to downgrade.

Rotation or key loss requires the same stopped-writer maintenance boundary and
truncation of the **lock table only**, followed by one new shared key. No online
mixed-key rollout, raw fallback, automatic key generation or computed backfill is
supported. See the [ratified design and acceptance status](../development/email-lock-keying.md).
No Localhost/Staging/Production secret has been provisioned by this code-only batch;
operator provisioning remains a prerequisite for deploying it.

The checked-in template defaults to `NODE_ENV=development` for Local Development. Release
hosts do not trust that editable default: `docker-compose.production.yml` forces
`production`, and the fixture-only Staging overlay forces `development`.

### One example of that discipline in the compose file

Legacy Local/Staging MinIO initialization uses `MC_HOST_local`; Production's SeaweedFS
service receives `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, and its shared S3 initializer
uses the existing TD-13 `MINIO_*` settings. All come from the operator's unchanged private
environment files, not command-line credential arguments. **Resolved Compose and Docker
inspect output still contain environment secrets**: never publish that output.
`BODOUR_STORAGE_INIT_IMAGE` is a test-harness override; Production preflight requires the
initializer image to equal the exact release API image. See
[Storage](../architecture/storage.md#b1-candidate-verification-checkpoint) for the single pin,
bucket rules and separate-volume migration boundary.

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

Branding uses `SystemSetting`; per-category visibility uses the Category record.
Consent wording uses `LegalConsentText`, while privacy/terms use `LegalDocument`
(R119/R138): published versions are not rewritten. No production legal wording is
invented by the seed. Grades use each Exam's `maxGrade` (R81), not the obsolete
global basis-point scale or invented per-level passing-grade settings.

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
