[Documentation](../README.md) › **Operations**

# Operations

Running the platform: where it runs, how it is configured, how it is deployed, and what to
do when something breaks.

## Pages

| | |
|---|---|
| [Environments](environments.md) | The three tiers, and the data-residency firewall between them |
| [Configuration](configuration.md) | Every environment variable and runtime setting |
| [Deployment](deployment.md) | The deterministic pipeline to the production VPS |
| [Observability](observability.md) | Health checks, structured logs, what is alerted |
| [Resilience](resilience.md) | Backup, restore, and behaviour when a dependency is down |
| [Runbooks](runbooks.md) | Step-by-step procedures for the things that actually happen |

## The operational picture in one paragraph

Everything runs as **one `docker-compose` stack on a single Moroccan VPS**: Nginx, the Node
API (with job workers in-process), PostgreSQL, MinIO, and Certbot. Nginx is the only
container publishing host ports. Images are **built in CI and pulled**, never built on the
server. Configuration is environment variables that the application validates at boot,
failing fast and by name. Backups run nightly to a **second Moroccan location**, and the
restore procedure is drilled before launch rather than trusted.

## Three things that will bite you if you skip them

**Never build images on the VPS.** The frontend build peaks near 2 GB and will exhaust a
4 GB box already running PostgreSQL, MinIO, and Node. Emergency-only fallback: stack fully
down, then build.

**Take a `pg_dump` immediately before applying migrations** on any existing deployment.
Migrations are forward-only in production — the dump *is* the rollback point, and it must
match the pre-migration state exactly.

**Never weaken cookie attributes to make an environment work.** `HttpOnly; Secure;
SameSite=Lax` is identical in every tier. Staging's cross-origin cookie behaviour is by
design, not a bug ([why](environments.md#the-staging-authentication-boundary)).

---

**Related:** [System overview](../architecture/system-overview.md),
[CI/CD](../development/ci-cd.md)
