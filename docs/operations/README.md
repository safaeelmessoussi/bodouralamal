[Documentation](../README.md) › **Operations**

# Operations

Running the platform: where it runs, how it is configured, how it is deployed, and what to
do when something breaks.

## Pages

| | |
|---|---|
| [Deployment readiness](deployment-readiness.md) | Live ledger: deployment blockers, real-user blockers, and hardening |
| [Moroccan provider acceptance](provider-acceptance.md) | One evidence checklist for hosting, residency, storage, backup and commercial quotations |
| [Environments](environments.md) | The three tiers, and the data-residency firewall between them |
| [Configuration](configuration.md) | Every environment variable and runtime setting |
| [Deployment](deployment.md) | The deterministic pipeline to the production VPS |
| [Observability](observability.md) | Health checks, structured logs, what is alerted |
| [Resilience](resilience.md) | Backup, restore, and behaviour when a dependency is down |
| [Runbooks](runbooks.md) | Step-by-step procedures for the things that actually happen |

## The operational picture in one paragraph

Everything runs as **one `docker-compose` stack on a single Moroccan VPS**: Nginx, the Node
API (with job workers in-process), PostgreSQL, MinIO, and Certbot. Nginx is the only
container publishing host ports. Exact-commit API and web images are built in CI after the
existing gates pass and pulled through the release overlay; the server never compiles them.
Configuration is environment variables that the application validates at boot,
failing fast and by name. Backups run nightly to a **second Moroccan location**, and the
restore procedure is drilled before launch rather than trusted.

## Three things that will bite you if you skip them

**Never build images on the VPS.** The frontend build peaks near 2 GB and will exhaust a 4 GB
box already running PostgreSQL, object storage, and Node. A missing exact-commit registry
image stops deployment; it is never permission to build a substitute on the host
([why](deployment.md#where-the-images-come-from)).

**Take a `pg_dump` immediately before applying migrations** on any existing deployment.
Migrations are forward-only in production — the dump *is* the rollback point, and it must
match the pre-migration state exactly.

**Never weaken cookie attributes to make an environment work.** `HttpOnly; Secure;
SameSite=Lax` is identical in every tier. **Preview's** cross-origin cookie behaviour is by
design, not a bug ([why](environments.md#the-preview-authentication-boundary)); **Staging**
is same-origin like Production, so the cookie flows there normally.

---

**Related:** [System overview](../architecture/system-overview.md),
[CI/CD](../development/ci-cd.md)
