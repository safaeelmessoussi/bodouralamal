[Documentation](../README.md) › [Operations](README.md) › **Environments**

# Environments

Four tiers, and the boundary between them is a **legal** boundary as much as a technical
one.

| Tier | Frontend | Backend / DB / storage | Data | Residency |
|---|---|---|---|---|
| **Local Development** | Local Vite dev server | Developer's machine, inside the same containerized architecture with locally built app images | **Fixtures only** | Non-Moroccan hardware permitted, because no real data exists here |
| **Preview** | **Vercel**, auto-deployed from `develop` | — **calls no real backend** | **Fixture mocks only**; stores nothing | Vercel is outside Morocco — acceptable *only* because it holds no data at all |
| **Staging** | Served by Nginx from the staging VPS, **same origin as the API**, over HTTPS | Same VPS: the full production-shaped stack | **Fixtures and synthetic records only** | Currently OVH France. Outside Morocco — acceptable *only* because the tier is fixture-only |
| **Production** | Served by Nginx from the **Moroccan VPS**, same origin as the API | Same VPS: the full stack | **Real data** | Law 09-08: all real data **and backups** on Moroccan infrastructure only |

## Why "Preview" and "Staging" are two different words

One word used to name both, and it hid a real gap. The Vercel deployment was called
*Staging*, and it **calls no backend at all** — so nothing was ever staged on it. There was a
name, and no tier behind the name, for the environment that actually rehearses the platform.

Since [SRS Revision 104](../SRS.md) the Vercel tier is **Preview** — frontend and demo
validation, nothing more — and **Staging** is a real, full-stack, production-shaped
deployment with its own database and object storage.

> **Staging is not a relaxed environment. It is Production with synthetic data.**

The tier is structural in Compose. `docker-compose.production.yml` forces
`NODE_ENV=production`; `docker-compose.staging.yml` forces `development`, the value that
permits fixture seeding, and adds its resource ceilings. An operator cannot turn Production
into a fixture-permitting process by forgetting to edit `.env.example`'s safe local default.

HTTPS, the `HttpOnly; Secure; SameSite=Lax` refresh cookie on its R101 Path, the CSRF
boundary, same-origin routing, the whole authorization matrix, and the B-01 public-storage
database gate, B-02 placement invariant and B-03 immutable finalization are all **fully
enabled there**. Weakening one to make something work in Staging is prohibited exactly as it
is everywhere else.

What Staging still does **not** replace is the dress rehearsal on the production VPS: it
exercises neither Moroccan residency, nor TLS on the production domain, nor the backup
pipeline.

## The residency firewall

The hard rule, enforced as [`BR-18`](../reference/business-rules.md#br-18):

> **No real beneficiary data ever enters Local Development, Preview or Staging. Fixture
> data only.**

Four mechanisms hold it, not one:

1. **The fixtures seed refuses to run when `NODE_ENV=production`.** The same guard that
   stops fixtures polluting production is the residency firewall in the other direction.
   It is also why Staging runs `NODE_ENV=development`: that value is what *permits* the
   fixtures, and it changes no security behaviour — see below.
2. **Production dumps are never copied to any other tier.** Not "discouraged" — never.
3. **The development database and its MinIO objects are never copied into Staging.** A
   developer's database is not fixture data: it accumulates real addresses and real
   experiments, and it is exactly the thing that looks harmless to copy.
4. **The Preview frontend build must not embed production URLs.**

### `NODE_ENV` does not change security behaviour

Worth stating because Staging depends on it. `NODE_ENV` gates exactly three things: the
fixture guard, the production-only `BACKUP_TARGET_SSH` requirement, and the production ban
on `LOG_LEVEL=debug`. **It does not gate error detail.** The error envelope is uniform in
every environment and never returns a stack trace, an SQL fragment or an internal path —
`middleware/request-context.ts` is unconditional, with no environment branch anywhere.

The specification used to list *"error verbosity"* among what `NODE_ENV` controls. That
described a branch which never existed, and [Revision 104](../SRS.md) corrects it.

Production data, backups, and restores exist only on the **two Moroccan locations**.

> Recorded as Risk R-10.

## The Preview authentication boundary

This is the part that looks broken and is not, so it is worth stating plainly.

The Vercel origin and any backend are **cross-origin**. The `SameSite=Lax` refresh
cookie **will not flow between them** — **by design, and this is not a bug to fix.**

Therefore:

- **Authenticated flows are never tested through the Preview origin.** Login, sessions,
  cookie refresh, and end-to-end journeys run against a **same-origin compose stack** —
  Local Development, **Staging**, or the production rehearsal — each of which serves the
  identical built frontend through Nginx exactly as production does.
- **The Preview deployment exists for UI and visual review against mocks only.** It calls no
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

The same service topology as Production, through `docker-compose`; API and web images are
built from the working source rather than pulled from GHCR:

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

The overlay also replaces the release HTTP server, which is permanently ACME-only plus an
HTTPS redirect, with `nginx/dev/default.conf`. This is the only tier that serves the
application directly over HTTP, and only on localhost; no runtime environment flag can
weaken a release host into that mode.

Two deliberate choices in that file:

**It is not named `docker-compose.override.yml`**, precisely so Compose **cannot merge it
automatically**. Deployment explicitly selects `docker-compose.release.yml` and must never
pick the development overlay up by accident.

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

## What the Staging VM backup does and does not cover

OVH Standard automated VM backup is enabled on the Staging host. It is a **whole-VM
snapshot**, so what it covers follows from where things sit rather than from any application
configuration:

| | Covered? | Because |
|---|---|---|
| PostgreSQL data | yes | `bodour_db-data` is a Docker volume under `/var/lib/docker/volumes`, on the root filesystem |
| MinIO objects | yes | `bodour_minio-data`, same place |
| TLS certificate and ACME state | yes | `bodour_certbot-conf` / `bodour_certbot-www`, same place |
| `/opt/bodour/.env` and `infra.env` | **yes — and this matters** | The snapshot therefore contains every staging secret. Treat a restored image as credential-bearing |

**This closes nothing for Production.** A VM snapshot is not the specified backup: §6 requires
a **second Moroccan location**, a tested restore, and an RTO the drill has actually met. A
snapshot of the wrong country would not satisfy Law 09-08 even if it were tested, and it has
not been. Host-scoped encrypted [recovery tooling](runbooks.md#creating-and-restoring-a-full-recovery-point)
now exists and passes a disposable restore, but `backup.replicate`, the actual Moroccan target,
retention decision, critical alert and Production-volume drill remain open readiness items.

For Staging specifically, losing the VM costs nothing that cannot be rebuilt: it holds only
fixtures, and the deployment is reproducible from Git plus regenerated secrets.

## The dress rehearsal still runs on the real VPS

Staging exercises a great deal that Preview never could — TLS automation, the memory ceiling
of a small box, the real deployment pipeline. It still does **not** exercise Moroccan
residency, TLS on the production domain, or the backup pipeline. So the integration dress
rehearsal runs **on the production VPS itself**, before launch, and Staging does not replace
it.

---

**Next:** [Configuration](configuration.md) · **Related:**
[Deployment](deployment.md), [Security](../architecture/security.md#data-residency)
