[Documentation](../README.md) › [Operations](README.md) › **Deployment readiness**

# Deployment-readiness ledger

This is the operational view of the remaining work. It does not restate requirements: each
row points to the specification or the handbook page that owns the rule. Update the status
when evidence changes; do not turn an unperformed drill into a green row.

## Evidence baseline

The audit began from clean, synchronized `develop` at
`85b9ae1573b5509804ce960f35526483fb033825`. The four Compose variants parse successfully:
base, Production profile, Staging overlay, and Local Development overlay.

Staging and current `develop` are different facts:

- `https://staging.bodouralamal.com` was accepted at `9d6dff139acaadbe8ae788b1df7a99984c5fea7f`.
- Changes after that commit, including the current Production-seed corrections, have **not**
  been accepted on Staging merely because they are on `develop`.
- No evidence in this workspace establishes a Production deployment, Production host access,
  Production DNS control, or Production credentials. Production is treated as undeployed.

## Current topology

| Concern | Repository state |
|---|---|
| External surface | Nginx alone publishes ports 80/443; PostgreSQL and object storage have no base-Compose host port |
| Application | One Node/Express container; pg-boss workers run in the API process |
| Data | PostgreSQL 18.4 named volume; migrations are forward-only |
| Storage | Three internal MinIO buckets: public, private, recording staging; current pin remains release-blocked by the [object-store decision](../architecture/storage.md#owner-decision-required--object-store) |
| Web | One environment-independent Vite bundle served by Nginx; API and storage are boot-validated as exact same-origin paths |
| TLS | Certbot webroot renewal plus periodic Nginx reload; activation remains a host operation |
| Persistence | PostgreSQL, object storage, Certbot configuration, and ACME webroot are named volumes |
| Recovery | Encrypted host-scoped recovery-point tooling passes a disposable drill; the remote target, retention, scheduling, alerting, and realistic host drill remain open |

## BLOCKS DEPLOYMENT

| Status | Blocker | Smallest completion boundary |
|---|---|---|
| **OWNER DECISION REQUIRED** | The pinned final MinIO OSS release is affected and unsupported | Select a maintained object store/vendor, then run the compatibility suite named in [Storage](../architecture/storage.md#owner-decision-required--object-store) |
| **OWNER/SPEC DECISION REQUIRED** | `backup.replicate` is a TD-7 pg-boss job, while a coherent recovery point must stop Compose services and read Docker volumes; giving the API the Docker socket is explicitly rejected | Reconcile who schedules/executes the host-scoped operation without granting the API root-equivalent host control; then implement the nightly trigger and failure/staleness signal |
| **OWNER INPUT REQUIRED** | The second Moroccan backup target and destructive retention horizon do not exist in repository configuration | Provision the target, pin its host key, escrow the restic and SSH credentials, and select retention as described in the [recovery runbook](runbooks.md#owner-decision-required--backup-target-and-retention) |
| **EXTERNAL ACCESS REQUIRED** | The current `develop` commit is not the accepted Staging commit | Provide/restore Staging host and deployment access, promote the exact green commit, and run same-origin authenticated acceptance |
| **EXTERNAL ACCESS REQUIRED** | Production VPS, DNS, TLS issuance access, Google OAuth Production credentials, and GHCR read authority are not available in this workspace | Supply only those external inputs; never commit them |
| **DOCUMENT OWNER APPROVAL REQUIRED** | GitHub now warns that `actions/checkout@v4` and `actions/setup-node@v4` target deprecated Node 20 and force-runs them on Node 24 | Approve the dedicated major tooling upgrade to the current v7 lines; their official action metadata uses `node24`, but SRS §3.1a prohibits an unapproved major upgrade |
| **PARTIAL — DISPOSABLE PRODUCTION BOOTSTRAP GREEN** | Clean-host deployment and rollback have not been rehearsed end to end for the current commit | The isolated Production-mode drill now proves migrations, byte-stable repeat seed, clean inventory, internal MinIO policies, TLS/Nginx, worker readiness, storage-degraded `503` + Docker `unhealthy`, and recovery. Still execute [the deployment pipeline](deployment.md#the-pipeline) on a clean VPS, including GHCR pull, public certificate, browser smoke, backup, restore and rollback |
| **IMPLEMENTED — HOSTED PUBLICATION PROVED** | Deployable images previously did not exist | Hosted run `33246930840` passed all five verification jobs and published both API and web images for exact commit `9e0b303c27e77ec731e3afee936dcb31cd165504`; the release overlay refuses an absent tag and deployment uses `--no-build` |
| **IMPLEMENTED** | The checked-in environment template defaults to Development | Explicit Production/Staging overlays force the intended runtime tier; boot refuses non-HTTPS external and non-canonical/cross-origin storage URLs |
| **IMPLEMENTED** | Docker's default container log driver is unbounded | Every base service resolves to one bounded local-log policy (10 MB × 5); a coverage guard fails when a service omits it |
| **IMPLEMENTED** | Process liveness and a plain `curl` could look green while the platform was degraded | The API container healthcheck uses whole-application `/healthz`; deployment fails on non-200 responses and bounds the probe to 15 seconds |

## BLOCKS REAL USERS

| Status | Blocker | Authority / evidence |
|---|---|---|
| **DOCUMENT OWNER DECISION REQUIRED** | R111 promises automatic de-identification after three days, but TD-7 has no account-purge job and older clauses still contradict the ratified design | Recorded in [`TASKS.md`](../TASKS.md#m7--hardening--launch-data); manual permanent de-identification remains the implemented path |
| **DOCUMENT OWNER DECISION REQUIRED** | Audit identity email, exact content-coordinate wording, and required free-text evidence conflict with the current no-redundant-PII boundary | Recorded once in [`TASKS.md`](../TASKS.md#m7--hardening--launch-data); current code stays fail-closed |
| **OWNER / LEGAL INPUT REQUIRED** | Final privacy/terms content and Moroccan retention choices cannot be invented by engineering | Legal placeholders remain visibly non-final; no launch claim may treat them as approved |
| **OWNER OPERATION REQUIRED** | Branches, rooms, groups, and the real roster are intentionally absent from the Production seed | Enter through the authorised application flow after infrastructure acceptance; never import them into Staging |
| **BLOCKED WITH DEPLOYMENT** | Supported object storage, offsite backup, restore proof, monitoring/alerts, and incident readiness | Close the corresponding deployment rows before real personal data is introduced |

## HARDENING / POST-LAUNCH

| Status | Item | Evidence needed |
|---|---|---|
| **OPEN** | Ceiling-scale query/N+1 and latency audit | Measured fixtures at the documented ceiling, not development-row inference |
| **OPEN** | Full automated J1–J8 and authenticated Staging E2E | Same-origin production-shaped browser run; no development-session backdoor |
| **PARTIAL — INTEGRATION COMPLETE** | Permission/E2E/coverage gates in hosted CI | Full real-stack integration and all-table isolation now gate release; add the remaining gates only when each has isolated disposable infrastructure |
| **OPEN** | Live edge-rate-limit, TLS-expiry, queue-lag, and backup-failure alert verification | Wire-observed signals on the target environment |
| **OPEN** | Production-host resource, disk-exhaustion, restart, graceful-shutdown, and realistic-RTO drills | Results from the selected host and object store |

## Promotion rule

One commit moves through Local verification → clean CI → Staging acceptance → Production
smoke. A later `develop` commit never inherits an earlier commit's Staging acceptance.

---

**Next:** [Deployment](deployment.md) · **Related:**
[Environments](environments.md), [Resilience](resilience.md), [CI/CD](../development/ci-cd.md)
