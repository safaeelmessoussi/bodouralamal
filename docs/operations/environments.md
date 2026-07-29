[Documentation](../README.md) › [Operations](README.md) › **Environments**

# Environments

Three tiers, and the boundary between them is a **legal** boundary as much as a technical
one.

| Tier | Frontend | Backend / DB / storage | Data | Residency |
|---|---|---|---|---|
| **Development** | Local Vite dev server | Developer's machine, inside the containerized stack — **the same images as production** | **Fixtures only** | Non-Moroccan hardware permitted, because no real data exists here |
| **Staging** | **Vercel**, auto-deployed from `develop` | — **calls no real backend** | **Fixture mocks only** | Vercel is outside Morocco — acceptable *only* because staging never holds real data |
| **Production** | Served by Nginx from the **Moroccan VPS**, same origin as the API | Same VPS: the full stack | **Real data** | Law 09-08: all real data **and backups** on Moroccan infrastructure only |

## The residency firewall

The hard rule, enforced as [`BR-18`](../reference/business-rules.md#br-18):

> **No real beneficiary data ever enters development or staging. Fixture data only.**

Three mechanisms hold it, not one:

1. **The fixtures seed refuses to run when `NODE_ENV=production`.** The same guard that
   stops fixtures polluting production is the residency firewall in the other direction.
2. **Production dumps are never copied to development or staging.** Not "discouraged" —
   never.
3. **The staging frontend build must not embed production URLs.**

Production data, backups, and restores exist only on the **two Moroccan locations**.

> Recorded as Risk R-10.

## The staging authentication boundary

This is the part that looks broken and is not, so it is worth stating plainly.

The Vercel origin and any local backend are **cross-origin**. The `SameSite=Lax` refresh
cookie **will not flow between them** — **by design, and this is not a bug to fix.**

Therefore:

- **Authenticated flows are never tested through the Vercel origin.** Login, sessions,
  cookie refresh, and end-to-end journeys run against the **local same-origin compose
  stack** — which serves the identical built frontend through Nginx exactly as production
  does — and against the production rehearsal.
- **The Vercel deployment exists for UI and visual review against mocks only.** It calls no
  real backend, which is what deletes the last CORS exception that would otherwise exist
  anywhere in the system.

And the rule that follows:

> **Cookie attributes are identical in every environment. Environment-conditional
> downgrades — `SameSite=None`, dropping `Secure`, wildcard CORS with credentials — are
> prohibited.**
>
> An agent "fixing" staging cookies by weakening them is introducing a CSRF vulnerability,
> not fixing a bug.

Local development terminates at HTTP on `localhost`, which browsers treat as a **secure
context** — so the `Secure` cookie is delivered normally without weakening a single
attribute. The problem simply does not arise there.

## What development actually runs

The same images as production, through `docker-compose`:

```
nginx   ← the only container publishing host ports (80, 443)
api     ← Node + Express, pg-boss workers in-process
db      ← PostgreSQL 18.4, with the production memory and pool pins
minio   ← dual buckets, created idempotently by a one-shot init container
```

`certbot` is behind a `production` profile, so it never starts locally.

### The dev overlay, and why it is a separate file

Host-run integration tests need to reach PostgreSQL directly, and the base compose file
deliberately does not publish its port. An overlay does:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Two deliberate choices in that file:

**It is not named `docker-compose.override.yml`**, precisely so Compose **cannot merge it
automatically**. The deployment steps run a plain `docker compose up -d` and must never pick
it up by accident.

**Ports are bound to `127.0.0.1`, never `0.0.0.0`**, and use non-default numbers (5433 for
PostgreSQL, 9001 for MinIO) because a host PostgreSQL commonly occupies 5432 — and **a
silent connection to the wrong database is far worse than a port clash.** That clash was
real on the development machine.

## Two config files, and why they are separate

| File | Holds | Why separate |
|---|---|---|
| `.env` | **Application runtime config** — the full variable inventory | Generated from, and kept in lockstep with, the specification's authoritative table |
| `infra.env` | **Container bootstrap credentials** — the Postgres superuser password | Compose-level bootstrap is infrastructure, not application config. Keeping it out preserves the lockstep above |

Both are gitignored, and a CI guard fails the build if either is ever committed.

The one coupling to remember: **the password in `infra.env` must match the one embedded in
`DATABASE_URL`.**

> [Configuration](configuration.md)

## Version and image pinning

| Component | Pin |
|---|---|
| Node | `24.11.0`, pinned in `.nvmrc` and the base image |
| PostgreSQL | `postgres:18.4` — the Debian variant, because **ICU is required** for Arabic collation |
| MinIO | `RELEASE.2025-09-07T16-13-09Z` |
| Nginx | `stable-alpine` |

One PostgreSQL detail that will waste an afternoon if unknown: **PG 18+ images require the
volume mounted at `/var/lib/postgresql`, not `/var/lib/postgresql/data`.** Data lands in a
major-version subdirectory, which is what keeps `pg_upgrade --link` possible without
mount-boundary issues. Mounting at `.../data` makes the container refuse to start outright.

## The dress rehearsal runs on the real VPS

The staging topology exercises **none** of the VPS realities — memory ceilings, TLS
automation, the backup pipeline. So the integration dress rehearsal runs **on the production
VPS itself**, through the real deployment pipeline, before launch.

---

**Next:** [Configuration](configuration.md) · **Related:**
[Deployment](deployment.md), [Security](../architecture/security.md#data-residency)
