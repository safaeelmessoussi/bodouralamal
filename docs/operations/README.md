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
| [Same-VPS recovery](recovery.md) | Temporary B8 encrypted backup, host scheduling, operator signals and safe recovery |

One `docker-compose` stack on one Moroccan VPS (Nginx the only published port; API with in-process workers; PostgreSQL; S3; Certbot). Exact-commit images are built in CI and pulled — **never built on the host** (the frontend build peaks ~2 GB). Config is validated at boot, failing by name. Backups: R133 monthly, ≤2 generations, encrypted same-VPS repository (Owner-permitted, temporary; cannot survive total host loss). Never `prisma db push`; never a mutable image tag.
