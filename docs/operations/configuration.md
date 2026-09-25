[Documentation](../README.md) › [Operations](README.md) › **Configuration**

# Configuration

All runtime configuration is **environment variables** or the **settings table**; nothing is hardcoded.

| | **Environment variables** | **`SystemSetting` table** |
|---|---|---|
| Changed by | Operator editing `.env`, then restarting | A Super Admin, in the application |
| Requires | A restart | Nothing |
| Holds | Connection strings, secrets, origins, tiers | Branding and platform settings; legal documents/consent versions and category defaults have their own domain records |
| Validated | **At boot, fail-fast** | At write time |

## The variable inventory

The SRS table is **the single authoritative list**; `.env.example` is generated from it. **Boot fails fast with a named error on any missing required variable.**

### Required

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL, for Prisma and the job queue |
| `GOOGLE_CLIENT_ID` | OAuth client |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `JWT_SIGNING_KEY` | Access-token signing; rotatable |
| `ONBOARDING_TOKEN_KEY` | Onboarding-token signing — **distinct** from the JWT key |
| `EMAIL_LOCK_KEY` | Dedicated email-lock HMAC secret, ≥ 32 bytes, distinct from both signing keys; no fallback; never stored in the database |
| `MINIO_ENDPOINT` | Internal S3 API endpoint |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | Storage credentials |
| `PUBLIC_BASE_URL` | Canonical origin; the refresh endpoint validates `Origin` against it |
| `STORAGE_BASE_URL` | Public storage prefix; **presigned URLs are signed against it**, so signatures survive the proxy |
| `NODE_ENV` | `production` \| `development` \| `test` — exactly these three; a typo fails fast |

- `PUBLIC_BASE_URL` must be one canonical HTTP(S) origin (no path/query/fragment/trailing slash); `STORAGE_BASE_URL` must be exactly its same-origin `/storage` path. Non-loopback origins require HTTPS; HTTP only on `localhost`, `127.0.0.1` or `[::1]`.
- `JWT_SIGNING_KEY` and `ONBOARDING_TOKEN_KEY` must differ: one key would collapse two credential boundaries.

### Conditional

| Variable | When |
|---|---|
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_SEX` | **Platform Owner bootstrap only** (below) |
| `BACKUP_TARGET_SSH` | Production-only nonempty legacy setting; B8 temporarily permits `/var/lib/bodour-backups/bodour`. Host backup paths/key/floor are root-only [operator configuration](recovery.md#before-enabling-anything-on-an-authorized-host), not the API |
| `LIVEKIT_URL` / `LIVEKIT_API_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` / `LIVEKIT_NODE_IP` | **Self-hosted media server (R164) — required on Staging and Production; preflight refuses a release without them.** `LIVEKIT_URL` = the deployment's own origin (`wss://<domain>`; Localhost `ws://localhost`) since signalling is proxied as `/rtc`. `LIVEKIT_API_URL` = `http://livekit:7880` always. Key pair read by API, media server AND recorder; secret dedicated, ≥ 32 bytes (`openssl rand -hex 32`). `LIVEKIT_NODE_IP` = host public IPv4, read by Compose, stated so no public STUN is asked (empty on Localhost). Application group is all-or-none: half-configured refuses boot; none set → media actions fail closed, rest serves. [Deployment detail](../development/online-class-provider.md#how-it-is-deployed-srs-revision-164) |

### Optional, with defaults

| Variable | Default | Purpose |
|---|---|---|
| `TZ` | `Africa/Casablanca` | Container wall-clock alignment |
| `PORT` | `3000` | API port behind Nginx |
| `LOG_LEVEL` | `info` | `info` \| `debug`; **`debug` prohibited in production** |
| `RECORDING_STAGING_BUCKET` | `recordings-staging` | Provider-ingest staging, never a public content bucket |

### Exact-release host inventory

Provisioning checklist, **not a command to provision this workspace**. Derived from [`config.ts`](../../backend/src/lib/config.ts), [`infra.env.example`](../../infra.env.example), the Compose overlays and the [B8 root-only environment](recovery.md#before-enabling-anything-on-an-authorized-host).
- `.env` and `infra.env`: operator-owned mode `0600`. `POSTGRES_PASSWORD` must match the URL-encoded password in `DATABASE_URL` (host `db`, database `bodour`, user `app`). No published DB port.
- Generate independent random signing/onboarding/email-lock and storage credentials (48 random bytes, base64) directly into private host files — never command arguments, chat, shell recordings, Git or printed resolved Compose; preserve special-character escaping. Record custody, not values.
- `MINIO_*` names stay for SeaweedFS compatibility, internal `http://minio:9000`; AWS aliases in Production Compose resolve from the same secrets. Never run the legacy MinIO image or attach its populated volume to SeaweedFS.
- `PUBLIC_BASE_URL=https://bodouralamal.com`, `STORAGE_BASE_URL` = that origin + `/storage`; Google redirect exactly `https://bodouralamal.com/api/v1/auth/google/callback`, scopes `openid email`. **OWNER INPUT REQUIRED:** separately authorised Production OAuth client/domain configuration, final privacy URL/text and transfer review.
- `COMPOSE_PROJECT_NAME` and full `BODOUR_RELEASE_TAG` identify the exact checkout/images. Keep `TZ=Africa/Casablanca`, `PORT=3000`, `LOG_LEVEL=info`, the Production overlay's `NODE_ENV=production`; no developer auth mechanism.
- Seed-only Owner values are not recurring credentials. Restic key, repository pin, backup floor and timers belong to B8 host configuration only. No shared Production/Staging secrets or backup key in the checkout.

### Secret rotation and installation, at a glance

Every value is generated independently (`openssl rand -base64 48` unless noted), written directly into the private `.env`/`infra.env`/root-only recovery config, installed only on the target host. Placeholders are format examples, never usable values.

| Variable | Secret? | Generation | Restart required |
|---|---|---|---|
| `DATABASE_URL` password | Secret | Random, matched to `POSTGRES_PASSWORD` in `infra.env` | `db` + `api` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Secret (Google Cloud Console) | Issued by Google, not generated | `api`; live OAuth users unaffected until Google revokes the old value |
| `JWT_SIGNING_KEY` | Secret | Random ≥ 32 bytes | `api`; every access token invalidated immediately; refresh tokens unaffected (hashed) |
| `ONBOARDING_TOKEN_KEY` | Secret | Random ≥ 32 bytes, distinct from `JWT_SIGNING_KEY` | `api`; only in-flight onboarding tokens invalidated |
| `EMAIL_LOCK_KEY` | Secret | Random ≥ 32 bytes, distinct from both | `api` plus the [stopped-writer truncate/re-key migration](../development/email-lock-keying.md) — never live |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | Secret | Random, identical for `api`, `minio`, `minio-init` | `minio` + `minio-init` + `api`; mismatch fails the initializer's credential-match preflight |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Secret | Key: any identifier; secret random ≥ 32 bytes (`openssl rand -hex 32`), identical for `api`, `livekit`, `livekit-egress` | All three together; mismatch fails preflight. Live classes drop and an in-progress recording is lost: rotate outside teaching hours |
| `LIVEKIT_NODE_IP` | Public (host IPv4) | Provider-approved address | `livekit`; wrong → browsers send media elsewhere |
| Backup repository password | Secret, **escrowed off-host** | Random ≥ 32 bytes, written on the host, never via the application | Not a restart concern ([recovery](recovery.md#before-enabling-anything-on-an-authorized-host)); rotation is a new-key procedure, never an overwrite |
| `PUBLIC_BASE_URL` / `STORAGE_BASE_URL` | Public | Fixed by the domain | `api`; changes accepted `Origin` and presign target |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_SEX` | Sensitive, one-time | Fixed values | Read only by the seed before the Owner singleton exists |
| `BODOUR_RELEASE_TAG` | Public (commit SHA) | Exact accepted 40-character commit | Every Compose command |

Logging/monitoring destinations and alerts are **not** environment variables: no external sink exists. The Admin alert surface «حالة النظام» (R169 §11) needs no configuration — [what it shows and cannot](observability.md#required-alerts--two-of-four-are-on-the-super-admins-screen-r169-11); backup and certificate stay with the host [operator signal](recovery.md#operator-signals-not-an-invented-dashboard).

## Secrets have no defaults, by design

- Every secret in `.env.example` is empty; `openssl rand -base64 48` in the comments is documentation, not auto-generation — a first-boot-generated key is one nobody knows to back up.
- Secrets never appear in logs, error payloads or the API contract; a CI guard fails the build if an `.env` file is committed.
- The template defaults to `NODE_ENV=development`; release hosts do not trust it: `docker-compose.production.yml` forces `production`, the Staging overlay forces `development`.
- Every tier's SeaweedFS `minio` service receives `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` and the shared initializer uses TD-13 `MINIO_*` (Owner, 2026-09-20), all from the private env files. **Resolved Compose and `docker inspect` output contain secrets: never publish it.** `BODOUR_STORAGE_INIT_IMAGE` is a test-harness override; Production preflight requires the initializer image to equal the release API image ([Storage](../architecture/storage.md#b1-candidate-verification-checkpoint)).

### Email-lock rollout and rotation

- B3 is **not a rolling upgrade**: stop every email-ownership writer (API instances, seed/bootstrap) before applying `20260911100000_deletion_generation_identity_minimization`; provision the same `EMAIL_LOCK_KEY` for every writer before restarting. The migration discards ownerless plaintext lock coordinates, not User/UserIdentity ownership; minimizes copied claim credentials for audit-proven permanent deletions; does not purge recoverable accounts. Never run the old binary on the new schema or restore a pre-erasure backup to downgrade.
- Rotation or key loss: same stopped-writer boundary, truncate the **lock table only**, one new shared key. No mixed-key rollout, raw fallback, automatic generation or computed backfill ([design](../development/email-lock-keying.md)). No secret has been provisioned by the code-only batch.

## Platform Owner bootstrap values

- **The running API never reads them.**
- Before `PlatformOwner('platform')` exists the seed requires exactly `SUPER_ADMIN_EMAIL=safae.elmessoussi@gmail.com` and `SUPER_ADMIN_SEX=female`, failing atomically on any other value or identity conflict.
- Once the singleton exists both are ignored permanently and may be removed; a rerun cannot reclaim a transfer, create a successor or reopen because the Super-Admin population changed. Ownership transfers only through the application ([resolution order](../architecture/identity-and-access.md#platform-owner-and-initial-bootstrap)).

## Runtime settings

Branding: `SystemSetting`; per-category visibility: the Category record; consent wording: `LegalConsentText`; privacy/terms: `LegalDocument` (R119/R138), published versions never rewritten, no legal wording invented by the seed. Grades use each Exam's `maxGrade` (R81), not a global basis-point scale or per-level passing-grade settings.

## Rate limits

| Layer | Limit |
|---|---|
| **Nginx, per IP** | Auth endpoints 10 req/min · general API 120 req/min |
| **Nginx, per IP, uploads** | Coarse guard at the nearest floor (`1r/m`) — **not the quota** |
| **Application, per user** | **Upload initiations 30/hour** — the authoritative quota, counted in PostgreSQL |

Nginx cannot read a token subject and admits only `r/s`/`r/m` ([Security](../architecture/security.md#rate-limiting-in-two-layers)).

## Body size limits

```nginx
location /api/v1/  { client_max_body_size 2m;   }
location /storage/ { client_max_body_size 110m;
                     proxy_request_buffering off; }
```

**Never raise the body limit globally to "fix" uploads.**

## Resource pins

Configuration, not suggestions; a default is non-compliant. Target steady state ≈ 2.2 GB on a 4 GB box.

```
Postgres   max_connections=30 · shared_buffers=256MB · work_mem=8MB
           statement_timeout=10s
MinIO      GOMEMLIMIT=512MiB
Node       --max-old-space-size=768
Prisma     connection_limit=10
pg-boss    pool ≤ 5
```

## Changing configuration safely

1. **Adding a variable:** SRS inventory table first, then regenerate `.env.example`, then boot validation.
2. **Rotating a signing key** invalidates every token signed with it; access tokens die within an hour; refresh tokens are hashed and unaffected.
3. **Changing `PUBLIC_BASE_URL`** changes the accepted refresh `Origin` and the presign target; both break together if wrong.

---

**Next:** [Deployment](deployment.md) · **Related:** [Environments](environments.md), [Security](../architecture/security.md#secrets)
