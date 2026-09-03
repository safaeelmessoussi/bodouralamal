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

- `https://staging.bodouralamal.com` is deployed at
  `4fd620de2cf182aa8a8342d48641c054ea76002e`. Hosted run `33262358687`, attempt 2,
  passed all six verification jobs and exact-image publication before promotion; the real edge
  then passed 15/15 anonymous browser assertions and a stateless-service restart.
- Acceptance belongs to that deployed commit. Later `develop` documentation or application
  commits do **not** inherit it.
- Revision 115 authorises the next exact-release transition from strict synthetic-only Staging
  to controlled UAT for exactly `safae.elmessoussi@gmail.com` as Platform Owner/Global Super
  Admin. That transition has not occurred merely because its code or documentation exists:
  until the exact commit passes hosted CI and is promoted, the deployed release and its accepted
  synthetic-only inventory above remain authoritative.
- The Owner approved **20 GiB free as the Staging-only preflight floor** on 2026-08-29. This
  does not answer Production capacity; the Production threshold remains a separate input after
  the Moroccan VPS and storage topology are selected.
- The authorized Staging reboot now has `ssh` and Docker enabled and active at boot. The first
  executable preflight found and closed an effective `PermitRootLogin prohibit-password` drift;
  root login is now disabled, key-only non-root access and `/healthz` remain green.
- The privacy-safe provenance review classified the two pre-existing untagged OAuth accounts as
  **B (manually created/personal)** and both untagged Branch rows as **A (exact authoritative
  reference/fixture matches)** without displaying an identity value. After a mode-0600,
  catalog-validated PostgreSQL backup, the exact deployed domain service permanently
  de-identified both B accounts and removed their identities, roles and session credentials. A
  brief API stop made removal of their two unclaimed email synchronization coordinates free of a
  registration race; the same exact container returned healthy. The branches and all dependent
  fixture relationships were retained. Final count-only acceptance is 8/8 committed fixture
  users, zero OAuth identities or personal coordinates, zero non-fixture beneficiaries, zero
  fixture-email violations, and 4/4 authoritative Branch rows; 61/61 migrations, all health
  dependencies, 9/9 workers, HTTPS/security headers and the 15/15 anonymous browser smoke remain
  green on the unchanged deployed release.
- No evidence in this workspace establishes a Production deployment, Production host access,
  Production DNS control, or Production credentials. Production is treated as undeployed.

## Current topology

| Concern | Repository state |
|---|---|
| External surface | Nginx alone publishes ports 80/443; PostgreSQL and object storage have no base-Compose host port |
| Application | One Node/Express container; pg-boss workers run in the API process |
| Data | PostgreSQL 18.4 named volume; migrations are forward-only |
| Storage | Three internal buckets: public, private, recording staging. Application readiness uses authenticated S3 `HeadBucket` for all three; the current MinIO image/init/container-health/volume pin remains release-blocked by the [object-store decision](../architecture/storage.md#owner-decision-required--object-store) |
| Web | One environment-independent Vite bundle served by Nginx; API and storage are boot-validated as exact same-origin paths |
| TLS | Certbot webroot renewal plus periodic Nginx reload; activation remains a host operation |
| Persistence | PostgreSQL, object storage, Certbot configuration, and ACME webroot are named volumes |
| Recovery | Encrypted host-scoped recovery-point tooling preflights the repository before outage, preserves exact container identities, and passes raw-volume plus clean logical-PostgreSQL restore; the remote target, retention, scheduling, alerting, vendor-specific object export, and realistic host drill remain open |

## BLOCKS DEPLOYMENT

| Status | Blocker | Smallest completion boundary |
|---|---|---|
| **OWNER DECISION REQUIRED** | The pinned final MinIO OSS release is affected and unsupported | Select a maintained Moroccan-resident object store/vendor using the [provider evidence matrix](provider-acceptance.md), explicitly prove bucket versioning/lifecycle/Object Lock settings, adapt the image/init/container probe and volume/export format, then run the compatibility suite named in [Storage](../architecture/storage.md#owner-decision-required--object-store). Application readiness is already generic authenticated S3 bucket access |
| **OWNER/SPEC DECISION REQUIRED** | `backup.replicate` is a TD-7 pg-boss job, while a coherent recovery point must stop Compose services and read Docker volumes; giving the API the Docker socket is explicitly rejected | Reconcile who schedules/executes the host-scoped operation without granting the API root-equivalent host control; then implement the nightly trigger and failure/staleness signal |
| **OWNER INPUT REQUIRED** | The second Moroccan backup target and destructive retention horizon do not exist in repository configuration | Use the [provider evidence matrix](provider-acceptance.md) to prove the second location and failure domain, provision the target, pin its host key, escrow the restic and SSH credentials, and select retention as described in the [recovery runbook](runbooks.md#owner-decision-required--backup-target-and-retention) |
| **OWNER INPUT REQUIRED — PRIMARY DISK CAPACITY** | The SRS gives audit growth and file caps but intentionally requires the Owner's recording/week and average-size estimate before sizing the VPS disk | Engineering recommends a **50 GiB deployment floor**, **60 GiB warning** and **50 GiB critical state** for the planned ~200-GB disk. Approve or replace those values after supplying the recording budget; preflight still requires the approved explicit whole-GiB value and has no invented default. See [the capacity rationale](provider-acceptance.md#production-disk-recommendation-awaiting-owner-approval) |
| **IMPLEMENTED — PROVIDER EVIDENCE CONTRACT** | Provider quotations previously had no single acceptance record, inviting residency and recovery assumptions to live in messages | The [authoritative quotation checklist](provider-acceptance.md) now covers every primary/secondary data copy, compute/memory growth, ~200-GB storage, access/network, reliability, backup failure domain, S3 administration/portability, platform restrictions and commercial/exit terms. No vendor or price is claimed without actual written evidence |
| **CLOSED FOR CURRENT RELEASE — CONTROLLED-UAT TRANSITION AUTHORISED** | The two untagged OAuth accounts were category B; the two untagged Branch rows were category A exact reference matches | Both B accounts were de-identified through the deployed domain service after a validated owner-only backup, the A branches were retained, and the current release remains strictly fixture-only. R115 authorises exactly one Owner identity on the next accepted release; promotion still requires exact hosted CI, backup, migration/seed and post-deploy acceptance. Production is untouched |
| **MANDATORY PREFLIGHT BEFORE THE R124 MIGRATION** | `20260904090000_r124_assessment_builder` drops `exam.questions` and `student_exam_submission.answers` and writes a `status` no old column proves | Run the **three counts** in [Deployment](deployment.md#the-r124-migration-has-a-mandatory-preflight-and-it-is-three-counts) against production first — a non-empty question blob, any submission row, or any `mode = 'online'` exam. **All three must be `0`.** They are expected to be: no submission endpoint ever existed and `online` was refused from R58 until R124, so a row is evidence of something the application did not do, and what to keep is an Owner decision rather than an operator's. Audited 2026-09-04 and found otherwise safe — `target_kind` re-encodes R58's own stated inference, and `status` is read by nothing outside `mode = 'online'` — see [Database § the R124 legacy mapping](../architecture/database.md#the-r124-legacy-mapping) |
| **EXTERNAL ACCESS REQUIRED** | Production VPS, DNS, TLS issuance access, Google OAuth Production credentials, and GHCR read authority are not available in this workspace | Supply only those external inputs; never commit them |
| **IMPLEMENTED — APPROVED ACTION RUNTIMES** | GitHub warned that the v4 checkout/setup-node actions targeted deprecated Node 20 | Document Owner approval was received on 2026-08-30; all invocations use the maintained v7 Node 24 lines and preserve explicit Node/cache inputs. Hosted run `33287083470` passed all six verification jobs and published both exact-commit images for `09ecd09b83d52b2159ab21c3b022d22577167b22` |
| **IMPLEMENTED — DISPOSABLE PRODUCTION RECOVERY/ROLLBACK GREEN** | Repository bootstrap and backup restore were previously separate proofs, so neither showed the Production-mode application becoming healthy on a restored rollback point | The combined isolated drill now proves migrations, byte-stable repeat seed, clean inventory, exact repository-HEAD image labels/IDs, TLS/Nginx and anonymous browser **15/15**; worker/dependency restart and recreation; then an encrypted recovery point, later database/object writes, destruction and empty-volume restore, rollback to the earlier values, unchanged migration/seed state and healthy startup without implicit migrate/seed. Still execute [the deployment pipeline](deployment.md#the-pipeline) on the selected clean VPS: GHCR pull, public certificate, authenticated OAuth smoke, selected object store, remote Moroccan backup/restore and realistic-volume RTO are external evidence |
| **IMPLEMENTED — HOSTED PUBLICATION PROVED** | Deployable images previously did not exist | Hosted run `33262358687`, attempt 2, passed all six verification jobs and published both API and web images for exact commit `4fd620de2cf182aa8a8342d48641c054ea76002e`; the release overlay refuses an absent tag and deployment uses `--no-build` |
| **IMPLEMENTED** | The checked-in environment template defaults to Development | Explicit Production/Staging overlays force the intended runtime tier; boot refuses non-HTTPS external and non-canonical/cross-origin storage URLs |
| **IMPLEMENTED** | Docker's default container log driver is unbounded | Every base service resolves to one bounded local-log policy (10 MB × 5); a coverage guard fails when a service omits it |
| **IMPLEMENTED** | Process liveness and a plain `curl` could look green while the platform was degraded | The API container healthcheck uses whole-application `/healthz`; deployment fails on non-200 responses and bounds the probe to 15 seconds |
| **IMPLEMENTED — REPOSITORY HOST GATE** | The clean-VPS prerequisites were prose-only and did not fail before deployment on a wrong host, mutable checkout, weak secret files, DNS drift, insufficient approved disk, wrong topology, or missing exact images | The read-only preflight now checks the bounded Ubuntu/AMD64/Compose contract, local boot-enabled Docker, NTP, persistent Docker storage, exact detached commit, mode-0600 secrets, exact IPv4/no-AAAA DNS, resolved services/ports/volumes/log/restart policy, same-origin settings, credential coupling and both GHCR manifests. Public packages need no invented credential file; any installed Docker credential remains owner-only mode 0600. The real Staging host is now exercising this gate; Production host/credentials remain unavailable |

## BLOCKS REAL USERS

| Status | Blocker | Authority / evidence |
|---|---|---|
| **DOCUMENT OWNER DECISION REQUIRED** | R111 promises automatic de-identification after three days, but TD-7 has no account-purge job and older clauses still contradict the ratified design | Recorded in [`TASKS.md`](../TASKS.md#m7--hardening--launch-data); manual permanent de-identification remains the implemented path |
| **OWNER / LEGAL DECISION REQUIRED** | R111 removes email ownership and permits re-registration, but `NormalizedEmailLock` deliberately retains the exact lowercased former address as an ownerless concurrency coordinate | Classification **C — unresolved retention/specification boundary**. Decide whether that raw ownerless coordinate may be retained with an explicit purpose/access/retention basis, or require an erasable/non-reversible serialization design. This does not block an empty deployment, but must close before real identities are introduced |
| **DOCUMENT OWNER DECISION REQUIRED** | Audit identity email, exact content-coordinate wording, and required free-text evidence conflict with the current no-redundant-PII boundary | Recorded once in [`TASKS.md`](../TASKS.md#m7--hardening--launch-data); current code stays fail-closed |
| **DOCUMENT OWNER ACTION REQUIRED** | TD-14/TD-16 require terminal-job, queue-lag, backup and TLS alarms on the Admin dashboard, but TD-3 has no operational-alert read and the existing Notification model is domain-only | Define the smallest route/DTO and storage/projection boundary; until then failures are durable and runbook-visible, not Admin-dashboard-visible |
| **OWNER / LEGAL INPUT REQUIRED** | Final privacy/terms content and Moroccan retention choices cannot be invented by engineering | Legal placeholders remain visibly non-final; no launch claim may treat them as approved |
| **OWNER OPERATION REQUIRED** | Branches, rooms, groups, and the real roster are intentionally absent from the Production seed | Enter through the authorised application flow after infrastructure acceptance; never import them into Staging |
| **BLOCKED WITH DEPLOYMENT** | Supported object storage, offsite backup, restore proof, monitoring/alerts, and incident readiness | Close the corresponding deployment rows before real personal data is introduced |

## HARDENING / POST-LAUNCH

| Status | Item | Evidence needed |
|---|---|---|
| **OPEN** | Ceiling-scale query/N+1 and latency audit | Measured fixtures at the documented ceiling, not development-row inference |
| **PARTIAL — REAL STAGING EDGE GREEN** | Full automated J1–J8 and authenticated Staging E2E | The clean hosted Production drill and the real Staging HTTPS edge both pass the 15/15 anonymous same-origin login/public-route/security smoke without a development-session backdoor. Complete authenticated journeys only with real OAuth authority |
| **PARTIAL — INTEGRATION COMPLETE** | Permission/E2E/coverage gates in hosted CI | Full real-stack integration and all-table isolation now gate release; add the remaining gates only when each has isolated disposable infrastructure |
| **OPEN** | Live edge-rate-limit, TLS-expiry, queue-lag, and backup-failure alert verification | Wire-observed signals on the target environment |
| **PARTIAL — STAGING REBOOT/RESTART GREEN** | Production-host resource, disk-exhaustion, reboot and realistic-RTO drills | The Production-mode drill proves worker-down backlog drain, active-handler SIGTERM, independent restarts and persistent recreation. The Staging host additionally recovered from its authorised reboot with SSH/Docker enabled and healthy, and its exact-image API/Nginx restart returned to 9/9 worker readiness. Still observe pressure and realistic-volume RTO on the selected Production host with the supported replacement object store |

## Promotion rule

One commit moves through Local verification → clean CI → Staging acceptance → Production
smoke. A later `develop` commit never inherits an earlier commit's Staging acceptance.

---

**Next:** [Deployment](deployment.md) · **Related:**
[Environments](environments.md), [Resilience](resilience.md), [CI/CD](../development/ci-cd.md)
