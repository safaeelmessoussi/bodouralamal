[Documentation](../README.md) › [Operations](README.md) › **Environments**

# Environments

Three tiers; the boundary between them is **legal** as much as technical. Vercel/"Preview" is retired (Owner, 2026-09-13): it was frontend-only review against MSW mocks, never a rehearsal of the real stack; a green Vercel status on any commit is a legacy artifact, not deployment evidence ([Owner action still needed](#vercel-retirement--owner-action-required)).

| Tier | Frontend | Backend / DB / storage | Data | Residency |
|---|---|---|---|---|
| **Local Development** | Local Vite dev server | Developer's machine, same containerized architecture, locally built app images | **Fixtures only** | Non-Moroccan hardware permitted: no real data exists |
| **Staging** | Nginx on the staging VPS, **same origin as the API**, HTTPS | Same VPS, full production-shaped stack | Synthetic fixtures plus exactly the R115-authorised Owner staff identity for controlled OAuth UAT | Currently OVH France; no real beneficiary/educational/content or other staff data |
| **Production** | Nginx on the **Moroccan VPS**, same origin | Same VPS, full stack | **Real data** | Law 09-08: all real data **and backups** on Moroccan infrastructure only |

## Staging is the one pre-production rehearsal tier

- A real full-stack deployment with its own database and object storage — **Production-shaped controlled UAT**, not a relaxed environment: synthetic data plus exactly `safae.elmessoussi@gmail.com` as Platform Owner/Global Super Admin.
- Tier is structural in Compose: `docker-compose.production.yml` forces `NODE_ENV=production`; `docker-compose.staging.yml` forces `development` (permits fixture seeding) and adds resource ceilings; forgetting `.env.example`'s default cannot make Production fixture-permitting.
- HTTPS, the `HttpOnly; Secure; SameSite=Lax` refresh cookie on its R101 Path, the CSRF boundary, same-origin routing, the full authorization matrix, the B-01 public-storage gate, B-02 placement invariant and B-03 immutable finalization are **fully enabled**; weakening any is prohibited.
- Staging does **not** replace the dress rehearsal on the production VPS: no Moroccan residency, no TLS on the production domain, no backup pipeline.

## The residency firewall

[`BR-18`](../reference/business-rules.md#br-18): **no real beneficiary, educational or content data ever enters Local Development or Staging**; Staging's only real-person exception is the R115 Owner identity. Three mechanisms:
1. **The fixtures seed refuses to run when `NODE_ENV=production`** — the same guard in both directions; Staging runs `development` because that value permits fixtures. The Owner account comes from the production seed's pre-provisioning contract, not a copied database.
2. **Production dumps are never copied to any other tier.**
3. **The development database and its MinIO objects are never copied into Staging**: a developer's database accumulates real addresses and experiments.

The controlled-UAT exception grants no latitude for another real identity; expansion needs a new Owner decision and residency/compliance review.

### `NODE_ENV` does not change security behaviour

- `NODE_ENV` gates exactly three things: the fixture guard, the production-only `BACKUP_TARGET_SSH` requirement, the production ban on `LOG_LEVEL=debug`. **Not error detail**: the envelope is uniform everywhere and never returns a stack trace, SQL fragment or internal path — `middleware/request-context.ts` has no environment branch. The SRS once listed "error verbosity"; [Revision 104](../SRS.md) corrected it.
- Production data, backups and restores stay physically in Morocco; the temporary [B8 same-VPS decision](recovery.md) supersedes the two-location prerequisite and gives no recovery from total VPS/provider/disk loss. Risk R-10.

## Cookie attributes are identical in every environment

- Authenticated flows run only against a **same-origin compose stack** (Local, Staging, production rehearsal) serving the built frontend through Nginx; no tier calls the API cross-origin, so none needs CORS or a relaxed cookie.
- **Environment-conditional downgrades — `SameSite=None`, dropping `Secure`, wildcard CORS with credentials — are prohibited** ([R104](../SRS.md)); weakening a staging cookie introduces CSRF.
- Local HTTP on `localhost` is a browser **secure context**, so `Secure` cookies work unchanged.

## Vercel retirement — Owner action required

- No `vercel.json` or Vercel configuration ever existed in the repository; what remains is external GitHub/Vercel state this codebase must not touch.
- Vercel's GitHub App still auto-builds every push to `develop`. **Owner action:** Vercel dashboard → project → **Settings → Git** → disconnect the repository (or delete the project once authorised) — **or** GitHub **Settings → Integrations → Applications → Installed GitHub Apps → Vercel → Configure** → remove this repository. Either suffices.
- Any "Vercel" commit status, past or future, is a legacy artifact with no bearing on the launch decision ([Deployment](deployment.md)). Deleting the project, its deployments or the integration needs separate explicit Owner authorization.

## What development actually runs

Same topology as Production via `docker-compose`, with API and web images built from working source:

```
nginx   ← the only public WEB edge (release tiers: 80/443; Local: loopback HTTP 80 only)
livekit ← online-class MEDIA only: 7881/tcp + 7882/udp (release tiers; Local: loopback). Signalling comes through nginx as /rtc
api     ← Node + Express, pg-boss workers in-process
db      ← PostgreSQL 18.4, with the production memory and pool pins
minio   ← dual buckets, created idempotently by a one-shot init container
```

`certbot` is behind the `production` profile and never starts locally.

### The dev overlay, and why it is a separate file

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

- Publishes PostgreSQL for host-run integration tests (the base file does not); replaces the release HTTP server (ACME-only plus HTTPS redirect) with `nginx/dev/default.conf`; replaces the Nginx port list with exactly `127.0.0.1:80 → nginx:80` and `[::1]:80 → nginx:80` (a browser may resolve `localhost` to `::1` and get `ERR_CONNECTION_REFUSED` otherwise). It does not publish 443: Local Nginx has no TLS listener, and an unserved port would reset HTTPS connections (`ERR_CONNECTION_CLOSED`). Only this tier serves HTTP directly, only on localhost; no runtime flag can weaken a release host into it.
- **Not named `docker-compose.override.yml`**, so Compose cannot merge it automatically; deployment selects `docker-compose.release.yml` explicitly.
- **Ports bound to loopback (`127.0.0.1`, plus `[::1]` for the HTTP edge), never wildcard**, on non-default numbers (5433 PostgreSQL, 9001 MinIO): a host PostgreSQL commonly occupies 5432, and **a silent connection to the wrong database is worse than a port clash.**

## Two config files, and why they are separate

| File | Holds | Why separate |
|---|---|---|
| `.env` | **Application runtime config** — the full variable inventory | Generated from, and in lockstep with, the SRS table |
| `infra.env` | **Container bootstrap credentials** — the Postgres superuser password | Compose-level bootstrap is infrastructure, not application config |

Both gitignored; a CI guard fails the build if either is committed. **The password in `infra.env` must match the one in `DATABASE_URL`** ([Configuration](configuration.md)).

## Version and image pinning

| Component | Pin |
|---|---|
| Node | `24.11.0`, in `.nvmrc` and the base image |
| PostgreSQL | `postgres:18.4`, Debian variant — **ICU required** for Arabic collation |
| Object storage (every tier) | SeaweedFS `4.46`, digest-pinned in `docker-compose.yml` (Owner, 2026-09-20); [selection](../architecture/storage.md#b1-candidate-verification-checkpoint) |
| LiveKit server / Egress / Redis / certbot | `v1.9.1` / `v1.9.1` / `8.2-alpine` / `latest`, each digest-pinned |
| Nginx | `stable-alpine` |

- **Every third-party image in `docker-compose.yml` carries an index digest** (§3.1a Phase 2, pinned 2026-09-22 to what Staging verified); `scripts/ci/check-compose-operations.sh` refuses an unpinned one. A re-pushed tag changes nothing until an Owner-approved upgrade task moves the digest; re-resolve with `docker buildx imagetools inspect <image:tag> --format '{{.Manifest.Digest}}'`.
- **PG 18+ images require the volume at `/var/lib/postgresql`, not `/var/lib/postgresql/data`**: data lands in a major-version subdirectory (keeps `pg_upgrade --link` possible); mounting at `.../data` refuses to start.

## What the Staging VM backup does and does not cover

OVH Standard automated VM backup is enabled on Staging — a **whole-VM snapshot**:

| | Covered? | Because |
|---|---|---|
| PostgreSQL data | yes | `bodour_db-data` under `/var/lib/docker/volumes`, root filesystem |
| Object storage (SeaweedFS) | yes | `bodour_seaweedfs-data`, same place |
| TLS certificate and ACME state | yes | `bodour_certbot-conf` / `bodour_certbot-www` |
| `/opt/bodour/.env` and `infra.env` | **yes — and this matters** | The snapshot holds every staging secret; a restored image is credential-bearing |

- **Closes nothing for Production**: §6 requires a **second Moroccan location**, a tested restore and a met RTO; a snapshot in the wrong country fails Law 09-08 regardless. Host-scoped encrypted [recovery tooling](runbooks.md#creating-and-restoring-a-full-recovery-point) passes a disposable restore, but `backup.replicate`, the Moroccan target, retention decision, critical alert and Production-volume drill remain open.
- Losing the Staging VM costs nothing unrebuildable: fixtures only, reproducible from Git plus regenerated secrets.

## The dress rehearsal still runs on the real VPS

Staging exercises TLS automation, the small-box memory ceiling and the real pipeline, but not Moroccan residency, production-domain TLS or the backup pipeline; the dress rehearsal runs **on the production VPS itself** before launch.

---

**Next:** [Configuration](configuration.md) · **Related:** [Deployment](deployment.md), [Security](../architecture/security.md#data-residency)
