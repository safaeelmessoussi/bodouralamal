[Documentation](../README.md) › [Operations](README.md) › **Deployment readiness**

# Deployment-readiness ledger

This is the operational view of the remaining work. It does not restate requirements: each
row points to the specification or the handbook page that owns the rule. Update the status
when evidence changes; do not turn an unperformed drill into a green row.

## Evidence baseline

**Current state (2026-09-13):** `develop` closed H1–H6 (`5eabe63`) then H3
(`3171a47`), pushed, and hosted CI ran green on `3171a47` (run `34774455994` failed
two jobs on a real Compose-version incompatibility unrelated to product code; the
narrow fix `4e43697` was pushed and hosted CI re-ran fully green, run `34776047322`).
`develop` and `origin/develop` are equal at `4e43697`. B1–B8 local acceptance is
retained. Nothing has been deployed, and no host or live-data system has been
touched. Older dated Staging/CI rows below are historical evidence, not proof that
this newer source is deployed or accepted there.

### HIGH finding disposition

| Finding | Current disposition and evidence |
|---|---|
| H1 room/branch PATCH | **CLOSED locally.** Authoritative transaction reuses creation coherence; focused HTTP cross-branch room/group refusal passed in the full corrected run |
| H2 authority/date | **CLOSED locally.** Physical create/schedule/PATCH and individual grading/authoring use the exam date; ended-assignment PATCH regression passed. Verification found and fixed a real gap: the publish-time re-check used the branch-only authorization subset instead of the full per-arm rule, wrongly refusing a Teacher's own exact-Session/Teaching-Group/student target. See the [checkpoint](../development/testing.md#high-readiness-checkpoint-2026-09-13) for the exact root cause and fix |
| H3 manual opening | **CLOSED locally (Owner decision 2026-09-13, SRS Revision 142).** `POST /assessments/{id}/open` sets the existing `available_from` (R136 clause 5) explicitly, reusing `assertMayAuthor`/H5's lock unchanged; one-way and non-idempotent, matching `close`'s own convention. No migration. Frontend gains one confirmed «فتح الاختبار» action. See the [checkpoint](../development/testing.md#h3-readiness-checkpoint-2026-09-13) |
| H4 time | **CLOSED locally.** Wall-clock availability shares the online-class conversion; cron explicitly passes the IANA timezone. Seasonal scheduling and runner assertions pass in the final corrected run |
| H5 grade races | **CLOSED locally.** Shared Exam lock before fresh reads in save/publish/PATCH/delete; existing grades require version. Three deterministic PostgreSQL lock-order scenarios passed. The same version-fixture gap was also found and fixed in one further, previously unaudited test file outside the original six-suite set |
| H6 retag safeguarding | **CLOSED locally, runtime verified.** Session→Content locking, atomic consent flag and exact-key obligation commit together even without a bucket move; B4/B5 copy/winner protocol retained with no regression |
| H7 restore selection | **Already fixed by B8**: project/repository/exact-image pin, foreign-snapshot refusal and real restore proof; backup sources unchanged |
| H8 operator failure visibility | **Already fixed locally by B8** for backup/disk/storage/workers and obligation backlog including unknown-copy/no-job. Host installation, attended response, TLS review and realistic-size restore remain external prerequisites; dashboard/catalog reconciliation is explicitly unresolved |

Final corrected gate: **245/245** (5 skipped) on the nine-suite focused command; full
disposable-stack run **2,549 passed / 18 skipped, 0 failed**, browser **193/193**.
No failing check was waived; two real gaps were found by this verification pass and
fixed with the smallest necessary correction (see checkpoint). Independent Docker
inventory after the final run confirms no disposable resources remain. OpenAPI
currency, previously blocked by a sandbox `EPERM`, passed cleanly this run. See
[testing checkpoint](../development/testing.md#high-readiness-checkpoint-2026-09-13)
for exact commands and counts.

The audit began from clean, synchronized `develop` at
`85b9ae1573b5509804ce960f35526483fb033825`. The four Compose variants parse successfully:
base, Production profile, Staging overlay, and Local Development overlay.

Staging and current `develop` are different facts:

- `https://staging.bodouralamal.com` is deployed at
  `f4d2a61ab38149735e1a4d0be7a66f2460481ecc` (2026-09-20, SRS Revision 164 — self-hosted online
  classes). Hosted run `35530662292` passed all seven verification jobs and exact-image publication
  before promotion; host preflight passed, including the media rules. Verified from OUTSIDE, by a
  real browser behind home NAT: signalling over `wss://` on 443, media over **UDP to 7882**, and the
  only ICE server a client is handed is a dead port on this host — no third party. A **real recording
  was made on this 2-vCPU host** and read back from its own object store: 1280x720 H.264, 1,064 frames
  in 35.48 s (29.99 fps), with the recorder at 1.1-1.4 cores and ~750 MiB and the host never above
  166% of its 200%. 7880 and 3478 are closed to the internet; `/healthz` 200 with 12/12 workers. The
  first accepted Staging release was `4fd620de2cf182aa8a8342d48641c054ea76002e` (hosted run
  `33262358687`, attempt 2, six verification jobs at the time).
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
| External surface | Exactly four published ports, each with one owner: Nginx 80/443, and the self-hosted media server 7881/tcp + 7882/udp (SRS R164). The media server's signalling port is proxied as `/rtc` and never published; PostgreSQL, object storage, Redis and the recorder have no host port |
| Application | One Node/Express container; pg-boss workers run in the API process |
| Data | PostgreSQL 18.4 named volume; migrations are forward-only |
| Storage | Three internal buckets: public, private, recording staging. Every tier's Compose selects the [B1 SeaweedFS replacement](../architecture/storage.md#b1-candidate-verification-checkpoint) identically (Owner decision, 2026-09-20: Localhost/Staging data recreated on it, Production will run the same implementation whenever its own separate go-live is authorized); authenticated S3 readiness and exact-coordinate Nginx authorization remain |
| Web | One environment-independent Vite bundle served by Nginx; API and storage are boot-validated as exact same-origin paths |
| TLS | Certbot webroot renewal plus periodic Nginx reload; activation remains a host operation |
| Persistence | PostgreSQL, object storage, Certbot configuration, and ACME webroot are named volumes |
| Recovery | Encrypted host-scoped recovery-point tooling preflights the repository before outage, preserves exact container identities, and passes raw-volume plus clean logical-PostgreSQL restore; the remote target, retention, scheduling, alerting, vendor-specific object export, and realistic host drill remain open |

## BLOCKS DEPLOYMENT

| Status | Blocker | Smallest completion boundary |
|---|---|---|
| **B1 — ONE MODEL; RUNNING ON LOCALHOST AND STAGING; PRODUCTION ROLLOUT SEPARATELY UNAUTHORIZED** | The final MinIO OSS release is affected and unsupported | Pinned SeaweedFS 4.46 is the only object store the repository defines, for Localhost, Staging and Production alike (Owner decision, 2026-09-20 — Localhost/Staging object data is discarded and recreated, not migrated). Both non-Production tiers were switched on 2026-09-20 and their legacy `bodour_minio-data` volumes deleted: Localhost, then Staging at `a6b599d9148cff7732db7511a4ddf07f428682e4` through the documented pipeline. Discarding their objects was authorized, but a one-off S3-level copy was cheap, so every legacy object was copied and verified by size, SHA-256 and content type first (Localhost 107 of 107, Staging 5 of 5, zero mismatches). On Staging the public objects are served through the real edge at their exact lengths, an unsigned private read is denied, and a signed PUT/GET round trip through the real TLS proxy passes with the application's own presigner. One operational fact for any future host still carrying a legacy volume: host preflight refuses to run while `bodour_minio-data` exists, so it must be removed (or, as here, copied aside first) before the pipeline starts. It has separate physical storage, repeatable explicit initialization, bucket-policy/integrity/edge tests and same-version restart/recreate/recovery proof. See [B1 evidence](../development/testing.md#b1-seaweedfs-compatibility-and-recovery). Production will run the identical implementation, but that decision only fixed which implementation — Production's own go-live remains a separate, still-open decision, and the legacy MinIO pin remains prohibited for it either way |
| **IMPLEMENTED — SELF-HOSTED ONLINE CLASSES ON EVERY TIER** (Owner decision, 2026-09-20, SRS R164) | No release tier had a media provider, so «دخول الحصة» answered *«خدمة الحصص عن بُعد غير مهيّأة بعد»* | LiveKit, its Egress recorder and Redis are defined once in `docker-compose.yml` and run identically on Localhost, Staging and Production; LiveKit Cloud is not used. Signalling is same-origin (`wss://<domain>/rtc` through Nginx); the only additional host ports are **7881/tcp and 7882/udp**; the host's address is stated rather than discovered, so no third-party STUN is contacted; recordings are written straight into this deployment's object store. **Resources were measured before anything was built** ([evidence](../development/online-class-provider.md#what-it-actually-costs-measured)): a 720p recording peaks at ~1.9 cores and ~700 MiB. Staging's 2 vCPU carries one recording at a time with the CPU saturated for a video's length. **PRODUCTION PREREQUISITES:** a host with **at least 4 vCPU** (preflight refuses fewer; the provider matrix already asks for 4 vCPU / 8 GiB); **7881/tcp and 7882/udp admitted by the host AND the provider firewall, with inbound UDP unfiltered**; `LIVEKIT_NODE_IP` set to the approved public IPv4; and a dedicated `LIVEKIT_API_SECRET` |
| **B8 LOCAL ENGINEERING — TEMPORARY HOST EXECUTION** | Root host timers schedule monthly encrypted backup/daily retry and five-minute operator checks; the API never receives a Docker socket | Install/validate on the authorized host using the [recovery runbook](recovery.md). TD-7 pg-boss wording and TD-14/TD-16 dashboard contracts still require Document Owner reconciliation; no invented job/API or automatic message delivery |
| **OWNER DECISION RECORDED — SAME VPS, FIRST COUPLE OF MONTHS** | B8 temporarily permits a local encrypted repository; R133 already specifies monthly/max-two retention | Provision root-only directory/key with independent key escrow, explicit host-specific backup disk floor and attended operator checks. Verify actual-size restore on the selected Moroccan host. Same-VPS backup **cannot recover total disk/VPS/provider loss**; no offsite service is introduced or falsely claimed |
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
| **IMPLEMENTED — R133/B2** | Automatic User de-identification uses the existing Trash-retention worker; expired restore is refused synchronously | Exact Trash generation/deadline and User lock protect delete/restore/redelete; the older R111 missing-job note is superseded, not an instruction to add another worker |
| **DESIGN RATIFIED; OPERATIONAL PROVISIONING REQUIRED** | The [keyed-HMAC design](../development/email-lock-keying.md) replaces plaintext email-lock coordinates; B3 is technically closed | Required `EMAIL_LOCK_KEY`, domain-separated HMAC-SHA-256 and retained digest lock rows are settled. Real secret provisioning and the stopped-writer truncate/re-key rollout remain outstanding; no online mixed-key/old-writer rollout or Production-readiness claim is authorized |
| **DOCUMENT OWNER DECISION REQUIRED** | Audit identity email, exact content-coordinate wording, and required free-text evidence conflict with the current no-redundant-PII boundary | Recorded once in [`TASKS.md`](../TASKS.md#m7--hardening--launch-data); current code stays fail-closed |
| **DOCUMENT OWNER ACTION REQUIRED** | TD-14/TD-16 require terminal-job, queue-lag, backup and TLS alarms on the Admin dashboard, but TD-3 has no operational-alert read and the existing Notification model is domain-only | Define the smallest route/DTO and storage/projection boundary; until then failures are durable and runbook-visible, not Admin-dashboard-visible |
| **OWNER / LEGAL INPUT REQUIRED** | Final privacy/terms, CNDP regime/filing and Google transfer facts cannot be invented | Current [filing preparation](../compliance/personal-data-audit.md#current-filing-preparation--2026-09-13) distinguishes required DOB, explicit 18+ transition, R133/B7 erasure/history and same-VPS backups. R138 legal pages require actual Owner-activated text; live content was not inspected |
| **OWNER OPERATION REQUIRED** | Branches, rooms, groups, and the real roster are intentionally absent from the Production seed | Enter through the authorised application flow after infrastructure acceptance; never import them into Staging |
| **BLOCKED WITH DEPLOYMENT** | B1 object storage and the temporary B8 same-VPS backup must be installed/verified on the selected host; real-size restore, attended monitoring and incident readiness remain | Close the corresponding host rows before real personal data is introduced. No offsite protection is claimed under the temporary Owner decision |

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

## Ordered release checklist

This is the one execution-order checklist; the linked runbooks own the commands.
Every unchecked step is a prerequisite, not authorization to act in this task.

1. **Engineering:** HIGH focused/storage/concurrency tests, final consolidated
   CI-equivalent gates and H3's manual-opening contract are complete and
   committed locally (H1–H6). Obtain separate authority to push and require
   hosted CI/exact-image publication for that exact SHA.
2. **Legal/Owner:** complete the [CNDP packet](../compliance/personal-data-audit.md#current-filing-preparation--2026-09-13),
   filing regime/Google-transfer review, association/signatory facts and required
   approvals/receipts. Approve and activate the exact privacy/terms/consent versions
   before real users. No launch claim follows from having a draft packet.
3. **Provider:** obtain **Hostoweb** written evidence using the existing
   [provider matrix](provider-acceptance.md): all disks, snapshots, backups,
   replicas/DR copies physically Morocco; legal supplier/subprocessors, access and
   incident/exit terms. Confirm 4 vCPU/8 GiB/~200-GB plan and realistic growth;
   obtain actual approved deployment **and backup** free-disk floors. Do not reuse
   the Staging 20-GiB value or turn the 50-GiB recommendation into approval.
4. **Authorized host setup:** [deployment preflight](deployment.md) on the exact
   detached release, root-controlled supported Ubuntu/Docker/Compose, key-only SSH,
   safe rescue access, boot-enabled services/NTP, bounded logs and security updates.
   Firewall exposes only approved SSH, Nginx 80/443 and the online-class media ports
   7881/tcp + 7882/udp; DB/S3/console/filer/metrics
   stay internal. Validate actual public DNS/TLS only after separate authorization.
5. **Secrets/OAuth:** complete the [exact-release inventory](configuration.md#exact-release-host-inventory)
   privately on-host, distinct keys plus escrow, same-origin URLs and exact Google
   callback. No Production values in chat/Git/command output. Keep optional media
   disabled unless its real infrastructure and residency are separately accepted.
6. **Empty bootstrap:** use [the pipeline](deployment.md#the-pipeline), exact GHCR
   images/no host build, B1 SeaweedFS initializer with separate volume, migrations
   (current repository **96**) then minimal Production seed only, idempotency and
   singleton Owner proof. Never fixture-seed/import development data. Respect all
   legacy migration preflights for any populated upgrade and B3 stopped-writer keying.
7. **Acceptance — exact image IDs/labels, TLS/security headers, real Nginx public/
   private storage, and first legitimate Google Owner binding**, then the shortest
   representative smoke pass using only synthetic/UAT-authorized accounts created
   through the supported application flows (registration, admin creation) —
   **never real beneficiary data, and never a fixture seed on Production**:
   - **Auth:** register/login, token refresh, logout, and a suspended-account
     login refusal.
   - **Scoping:** branch/level/session creation, and one cross-branch/role
     boundary refusal (§20 rule 17 — refused and nonexistent must read alike).
   - **Attendance:** mark and read one session's attendance.
   - **Exams:** author, schedule a manual remote exam, confirm the student is
     refused before opening, **open it through `POST /assessments/{id}/open`
     (H3)**, then confirm the student can reach it and answer.
   - **Grades:** save a draft, publish it, confirm the student sees only the
     published mark.
   - **Materials:** upload, then download through a signed URL; confirm a
     private object is refused anonymously.
   - **Recordings/safeguarding:** tag content as a session recording without
     full consent and confirm it privatizes (H6 path).
   - **Workers:** confirm the full expected pg-boss worker catalog and cron
     timezone are healthy on `/healthz`.
   - **Backup:** trigger one manual recovery-point creation and verify it
     (step 8), rather than waiting for the first scheduled run.
   Delete every smoke-test account/record afterward through the supported
   deletion mechanism (never a direct database statement) before real users
   are introduced.
8. **Recovery/response:** install only when authorized, following [B8](recovery.md):
   root encrypted repository on the same VPS, independent key escrow, disk
   preflight, create→full-data verify→scoped two-generation prune, exact snapshot
   pin. Measure realistic-volume PostgreSQL **and SeaweedFS** restore/RTO on
   disposable Moroccan targets; never destroy live data for proof. Assign an
   operator to attend backup failures, worker/retirement backlog, disk and TLS
   expiry/renewal signals; a timer is not a person or an external host-death alarm.
9. **Rollback and recovery decision:**
   - **Application-only rollback is sufficient** when the failure is in the
     released code/image and no migration in the failed release has run
     destructively against data (`docker compose ... down`, then redeploy the
     prior accepted `BODOUR_RELEASE_TAG` per [Rollback](deployment.md#rollback)).
     No down-migration path exists; a release that already migrated data
     forward cannot simply be "rolled back" onto an older schema.
   - **Database/object restoration is required** when a migration corrupted or
     destroyed data, when the application-only rollback does not resolve the
     fault, or when data must return to a known-good point — always via the
     [recovery-point restore](recovery.md#restore-and-fresh-host-recovery),
     never a partial manual fix. Preserve the failed state and its logs before
     touching anything further; do not overwrite evidence to "clean up" fast.
   - **Exact order:** stop public traffic/writers → preserve failed-state
     evidence → decide application-only vs. restore → execute the one chosen
     path → verify (migrations, seed/Owner invariants, object bytes, a browser
     journey) → reopen traffic only after that verification passes.
   - Restoring an earlier point may **revive data erased since that point**
     (R133); resolve this under an explicit operational decision before
     reopening access. Same-VPS backup recovers logical/application failure
     only — it does not recover total VPS, provider, or disk loss.
   - **The Owner (or their explicitly delegated release authority) makes the
     go/no-go call** to reopen traffic after either path; an operator does not
     unilaterally decide the incident is closed.
10. **After launch:**
    - **Immediately:** watch `/healthz`, the worker catalog, error rate, and the
      TLS certificate validity window through the first hour of real traffic.
    - **First day:** confirm the first scheduled backup timer fires and its
      recovery point verifies (`recovery.md`'s operator signals); review
      pg-boss job/queue health and disk headroom on both filesystems; review
      the audit log for anything unexpected.
    - **First week:** repeat the disk/job/backup checks daily; review error
      logs for patterns invisible in a single day; confirm no smoke-test
      account or record remains.
    - **Incident escalation:** two consecutive backup failures, a failed
      restore verification, or an unresolved `ESCALATE_OWNER` signal notifies
      the Owner immediately per [recovery.md](recovery.md#operator-signals-not-an-invented-dashboard) —
      it is never left for the next scheduled check.

---

**Next:** [Deployment](deployment.md) · **Related:**
[Environments](environments.md), [Resilience](resilience.md), [CI/CD](../development/ci-cd.md)
