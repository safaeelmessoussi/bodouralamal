[Documentation](../README.md) › [Operations](README.md) › **Deployment readiness**

# Deployment-readiness ledger

Operational view of the remaining work; each row points at the rule's owner. Update status when evidence changes; never turn an unperformed drill into a green row.

## Evidence baseline

- H1–H8 HIGH findings are **closed locally** (2026-09-13): final gate 245/245 focused, 2,549 passed / 18 skipped full stack, browser 193/193; details in the [testing checkpoint](../development/testing.md#high-readiness-checkpoint-2026-09-13) and [H3 checkpoint](../development/testing.md#h3-readiness-checkpoint-2026-09-13). The four Compose variants (base, Production profile, Staging overlay, Local overlay) parse.
- Staging (`https://staging.bodouralamal.com`) is deployed at `f4d2a61ab38149735e1a4d0be7a66f2460481ecc` (2026-09-20, R164; hosted run `35530662292`, seven jobs green, host preflight incl. media rules). Verified from outside: signalling `wss://` on 443, media **UDP 7882**, no third-party ICE; a real 720p recording on the 2-vCPU host (recorder 1.1–1.4 cores, ~750 MiB); 7880 and 3478 closed; `/healthz` 200, 12/12 workers. First accepted release: `4fd620de2cf182aa8a8342d48641c054ea76002e` (run `33262358687`).
- Acceptance belongs to the deployed commit; later `develop` commits do **not** inherit it.
- R115 authorises the transition from synthetic-only Staging to controlled UAT for exactly `safae.elmessoussi@gmail.com`; until that exact commit passes hosted CI and is promoted, the deployed release stays authoritative.
- Owner-approved **20 GiB free = Staging-only preflight floor** (2026-08-29); Production's floor is a separate input.
- Staging host: `ssh` and Docker enabled at boot; `PermitRootLogin` drift closed (root login disabled, key-only non-root).
- Provenance review: two untagged OAuth accounts (category B) de-identified through the deployed domain service after a validated backup; both untagged Branch rows (category A) retained; zero OAuth identities/personal coordinates remain.
- No evidence establishes a Production deployment, host access, DNS control or credentials: **Production is undeployed.**

## Current topology

| Concern | Repository state |
|---|---|
| External surface | Exactly four published ports, one owner each: Nginx 80/443, media server 7881/tcp + 7882/udp (R164). Signalling proxied as `/rtc`, never published; PostgreSQL, object storage, Redis, recorder have no host port |
| Application | One Node/Express container; pg-boss workers in the API process |
| Data | PostgreSQL 18.4 named volume; forward-only migrations |
| Storage | Three internal buckets: public, private, recording staging. Every tier selects the [B1 SeaweedFS replacement](../architecture/storage.md#b1-candidate-verification-checkpoint) identically (Owner, 2026-09-20); authenticated S3 readiness and exact-coordinate Nginx authorization remain |
| Web | One environment-independent Vite bundle via Nginx; API and storage boot-validated as exact same-origin paths |
| TLS | Certbot webroot renewal plus periodic Nginx reload; activation is a host operation |
| Persistence | PostgreSQL, object storage, Certbot configuration, ACME webroot: named volumes |
| Recovery | Encrypted **same-VPS** recovery points ([B8, Owner 2026-09-12](recovery.md)): repository preflight, refuses while a class is recording (R167 §5, same `ops:active-recordings` gate), exact container identities, R133 monthly/max-two retention, daily systemd timer, raw-volume plus logical-PostgreSQL restore proven. **No offsite target exists or is claimed.** Open: realistic host drill on the selected VPS; backup-failure alarm on the Admin surface |

## BLOCKS DEPLOYMENT

| Status | Blocker | Smallest completion boundary |
|---|---|---|
| **B1 — ONE MODEL ON LOCALHOST AND STAGING; PRODUCTION ROLLOUT SEPARATELY UNAUTHORIZED** | Final MinIO OSS release affected and unsupported | Pinned SeaweedFS 4.46 is the only object store defined, every tier (Owner, 2026-09-20). Localhost and Staging (`a6b599d9148cff7732db7511a4ddf07f428682e4`) switched 2026-09-20 after a verified S3 copy; legacy `bodour_minio-data` deleted (preflight refuses while it exists). [B1 evidence](../development/testing.md#b1-seaweedfs-compatibility-and-recovery). Production go-live is a separate open decision; the MinIO pin stays prohibited |
| **IMPLEMENTED — SELF-HOSTED ONLINE CLASSES, EVERY TIER** (Owner, 2026-09-20, R164) | No tier had a media provider | LiveKit, Egress and Redis defined once in `docker-compose.yml`; LiveKit Cloud unused; signalling `wss://<domain>/rtc`; host address stated, no third-party STUN; recordings land in this deployment's object store. Measured: 720p recording ≈ 1.9 cores, ~700 MiB ([evidence](../development/online-class-provider.md#what-it-actually-costs-measured)). **PRODUCTION PREREQUISITES:** **≥ 4 vCPU** (preflight refuses fewer); **7881/tcp + 7882/udp admitted by host AND provider firewall, inbound UDP unfiltered**; `LIVEKIT_NODE_IP` = approved public IPv4; dedicated `LIVEKIT_API_SECRET` |
| **B8 LOCAL ENGINEERING — TEMPORARY HOST EXECUTION** | Root host timers: monthly encrypted backup/daily retry, five-minute operator checks; the API never gets a Docker socket | Install/validate on the authorized host per the [recovery runbook](recovery.md). TD-7 pg-boss wording and TD-14/TD-16 dashboard contracts still need Document Owner reconciliation; no invented job/API or automatic message delivery |
| **OWNER DECISION — SAME VPS, FIRST COUPLE OF MONTHS** | B8 permits a local encrypted repository; R133 specifies monthly/max-two retention | Provision root-only directory/key with independent key escrow, explicit backup disk floor, attended operator checks; verify actual-size restore on the Moroccan host. Same-VPS backup **cannot recover total disk/VPS/provider loss**; no offsite service is claimed |
| **OWNER INPUT REQUIRED — PRIMARY DISK CAPACITY** | SRS requires the Owner's recording/week and average-size estimate before sizing | Engineering recommends **50 GiB deployment floor**, **60 GiB warning**, **50 GiB critical** for the planned ~200-GB disk; approve or replace after supplying the recording budget; preflight has no default. [Rationale](provider-acceptance.md#production-disk-recommendation-awaiting-owner-approval) |
| **MANDATORY PREFLIGHT BEFORE THE R124 MIGRATION** | `20260904090000_r124_assessment_builder` drops `exam.questions` and `student_exam_submission.answers` and writes a `status` no old column proves | Run the [three counts](deployment.md#the-r124-migration-has-a-mandatory-preflight-and-it-is-three-counts) first; **all must be `0`**; a non-zero row is an Owner decision. Otherwise safe ([R124 legacy mapping](../architecture/database.md#the-r124-legacy-mapping)) |
| **EXTERNAL ACCESS REQUIRED** | Production VPS, DNS, TLS issuance, Google OAuth Production credentials, GHCR read authority are not in this workspace | Supply only those inputs; never commit them |
| **IMPLEMENTED — DISPOSABLE RECOVERY/ROLLBACK GREEN; HOST EVIDENCE OPEN** | The [dress rehearsal](deployment.md#the-dress-rehearsal) proves the Production-mode rollback boundary locally | Still execute [the pipeline](deployment.md#the-pipeline) on the clean VPS: GHCR pull, public certificate, authenticated OAuth smoke, real-host backup/restore and realistic-volume RTO are external evidence. The [host preflight gate](deployment.md#supported-host-contract) runs on Staging; Production host/credentials unavailable |

## BLOCKS REAL USERS

| Status | Blocker | Authority / evidence |
|---|---|---|
| **IMPLEMENTED — R133/B2** | Automatic User de-identification uses the Trash-retention worker; expired restore refused synchronously | Trash generation/deadline and User lock protect delete/restore/redelete; the R111 missing-job note is superseded, not an instruction to add a worker |
| **DESIGN RATIFIED; PROVISIONING REQUIRED** | [Keyed-HMAC email lock](../development/email-lock-keying.md) replaces plaintext coordinates; B3 technically closed | Required `EMAIL_LOCK_KEY`, domain-separated HMAC-SHA-256, retained digest rows settled. Real secret provisioning and the stopped-writer truncate/re-key rollout outstanding; no online mixed-key rollout or readiness claim authorized |
| **DECIDED — R170 §18** | Audit identity email vs. no-redundant-PII boundary | Owner (2026-09-22): user id only; content id plus non-reversible coordinate digest; fixed codes in the audit, the sentence only on the owning record. Implemented, test-pinned |
| **PARTLY IMPLEMENTED — R169 §11** | TD-14/TD-16 require terminal-job, queue-lag, backup and TLS alarms on the Admin dashboard | `GET /admin/operations/status` («حالة النظام», Super Admin) answers failed/late jobs and unfinished storage retirements in counts. **Backup freshness and certificate expiry are host-only** (`scripts/backup/check-readiness.sh`, certbot timer): the API cannot read the restic status file or certificate volume. Owner decision: publish those two host facts to the API (read-only mounted file) or leave them runbook-visible |
| **OWNER / LEGAL INPUT REQUIRED** | Privacy/terms, CNDP regime/filing, Google transfer facts | [Filing preparation](../compliance/personal-data-audit.md#current-filing-preparation--2026-09-13) covers required DOB, 18+ transition, R133/B7 erasure/history, same-VPS backups. R138 legal pages need Owner-activated text |
| **OWNER OPERATION REQUIRED** | Branches, rooms, groups, roster absent from the Production seed by design | Enter through the application after infrastructure acceptance; never import into Staging |
| **BLOCKED WITH DEPLOYMENT** | B1 storage and B8 same-VPS backup must be installed/verified on the host; real-size restore, attended monitoring, incident readiness remain | Close the host rows before real personal data; no offsite protection claimed |

## HARDENING / POST-LAUNCH

| Status | Item | Evidence needed |
|---|---|---|
| **OPEN** | Ceiling-scale query/N+1 and latency audit | Measured fixtures at the documented ceiling |
| **PARTIAL — STAGING EDGE GREEN** | Full automated J1–J8 and authenticated Staging E2E | Hosted drill and real Staging edge pass the 15/15 anonymous smoke without a session backdoor; authenticated journeys need real OAuth authority |
| **PARTIAL — INTEGRATION COMPLETE** | Permission/E2E/coverage gates in hosted CI | Full real-stack integration and all-table isolation gate release. Absent §19.2 gates (Codex review, 2026-09-22): **generated permission-matrix** test (authority pinned per route, not from one TD-3 table), **J1–J8 automation** (today: `scripts/dev/browser/` harnesses on Localhost + the 15/15 Staging smoke), **≥ 80 % coverage threshold** (collected, not enforced). Bounded; no Production host needed |
| **DONE — §3.1a PHASE 2, PART** | Container image digests | Every third-party image in `docker-compose.yml` and both Dockerfiles pinned to the Staging-verified index digest (2026-09-22); `check-compose-operations.sh` refuses an unpinned image. [Environments](environments.md#version-and-image-pinning) |
| **RECORDED — DEPENDENCY AUDIT** | `npm audit` at feature freeze | Patch fixes applied (`qs`, `fast-uri`, `brace-expansion`, `nanoid`, `postcss`, `vitest`, 2026-09-22). Remaining: **one chain under the `prisma` CLI** (`@prisma/dev` → `find-my-way`, `valibot`, `mysql2`; `@prisma/config` → `deepmerge-ts`); only fix is a major upgrade, prohibited by §3.1a without an approved task. **Accepted:** none of it runs here — no MySQL driver, the dev server never starts, the CLI's only Production act is `migrate deploy`. Re-audit in the upgrade task |
| **OPEN** | Live edge-rate-limit, TLS-expiry, queue-lag, backup-failure alert verification | Wire-observed signals on the target |
| **PARTIAL — STAGING REBOOT/RESTART GREEN** | Production-host resource, disk-exhaustion, reboot, realistic-RTO drills | Drill proves backlog drain, SIGTERM under active handlers, independent restarts, persistent recreation; Staging recovered from its reboot and exact-image restart to 9/9 workers. Still observe pressure and realistic-volume RTO on the Production host |

## Promotion rule

One commit moves Local verification → clean CI → Staging acceptance → Production smoke. A later `develop` commit never inherits an earlier commit's Staging acceptance.

## Ordered release checklist

The one execution-order checklist; linked runbooks own the commands. Every unchecked step is a prerequisite, not authorization.

1. **Engineering:** HIGH focused/storage/concurrency tests, consolidated CI-equivalent gates and H3's manual-opening contract committed (H1–H6). Separate authority to push; hosted CI/exact-image publication for that SHA.
2. **Legal/Owner:** complete the [CNDP packet](../compliance/personal-data-audit.md#current-filing-preparation--2026-09-13), filing regime/Google-transfer review, association/signatory facts, approvals/receipts; activate exact privacy/terms/consent versions before real users.
3. **Provider:** **Hostoweb** written evidence via the [provider matrix](provider-acceptance.md): all disks, snapshots, backups, replicas/DR physically in Morocco; supplier/subprocessors, access, incident/exit terms. Confirm 4 vCPU/8 GiB/~200-GB plan and growth; obtain approved deployment **and backup** free-disk floors — not the Staging 20-GiB value, not the 50-GiB recommendation.
4. **Authorized host setup:** [deployment preflight](deployment.md) on the exact detached release; supported Ubuntu/Docker/Compose, key-only SSH, safe rescue access, boot-enabled services/NTP, bounded logs, security updates. Firewall: SSH, 80/443, 7881/tcp + 7882/udp only; DB/S3/console/filer/metrics internal. Public DNS/TLS only after separate authorization.
5. **Secrets/OAuth:** complete the [exact-release inventory](configuration.md#exact-release-host-inventory) on-host: distinct keys plus escrow, same-origin URLs, exact Google callback. No Production values in chat/Git/output. Optional media disabled unless its infrastructure and residency are accepted.
6. **Empty bootstrap:** [the pipeline](deployment.md#the-pipeline) — exact GHCR images, no host build, B1 SeaweedFS initializer with separate volume, migrations (repository: **96**), minimal Production seed, idempotency and singleton Owner proof. Never fixture-seed/import development data. Respect legacy migration preflights on a populated upgrade and B3 stopped-writer keying.
7. **Acceptance:** exact image IDs/labels, TLS/security headers, real Nginx public/private storage, first legitimate Google Owner binding; then the shortest smoke with synthetic/UAT accounts created through supported flows — **never real beneficiary data, never a fixture seed on Production**:
   - **Auth:** register/login, refresh, logout, suspended-account refusal.
   - **Scoping:** branch/level/session creation; one cross-branch/role refusal (§20 rule 17 — refused and nonexistent read alike).
   - **Attendance:** mark and read one session.
   - **Exams:** author, schedule a manual remote exam, student refused before opening, **open via `POST /assessments/{id}/open` (H3)**, student can reach and answer.
   - **Grades:** save draft, publish, student sees only the published mark.
   - **Materials:** upload, download via signed URL; private object refused anonymously.
   - **Recordings/safeguarding:** tag content as a session recording without full consent; confirm it privatizes (H6).
   - **Workers:** full pg-boss catalog and cron timezone healthy on `/healthz`.
   - **Backup:** one manual recovery-point creation, verified (step 8).
   Delete every smoke account/record through the supported deletion mechanism (never direct SQL) before real users.
8. **Recovery/response:** install only when authorized per [B8](recovery.md): root encrypted repository on the same VPS, independent key escrow, disk preflight, create → full-data verify → scoped two-generation prune, exact snapshot pin. Measure realistic-volume PostgreSQL **and SeaweedFS** restore/RTO on disposable Moroccan targets; never destroy live data. Assign an operator for backup failures, worker/retirement backlog, disk and TLS signals; a timer is not a person.
9. **Rollback and recovery decision:**
   - **Application-only rollback** when the fault is in the released image and no migration ran destructively: `docker compose ... down`, redeploy the prior accepted `BODOUR_RELEASE_TAG` per [Rollback](deployment.md#rollback). No down-migration path; a forward-migrated release cannot be rolled back onto an older schema.
   - **Database/object restoration** when a migration corrupted data, application rollback fails, or data must return to a known point — always the [recovery-point restore](recovery.md#restore-and-fresh-host-recovery), never a partial manual fix. Preserve the failed state and logs first.
   - **Order:** stop public traffic/writers → preserve evidence → choose one path → execute → verify (migrations, seed/Owner invariants, object bytes, a browser journey) → reopen only after verification.
   - Restoring an earlier point may **revive data erased since** (R133): explicit operational decision before reopening. Same-VPS backup recovers logical failure only.
   - **The Owner (or delegated release authority) makes the go/no-go call** to reopen; an operator never closes the incident unilaterally.
10. **After launch:**
    - **Immediately:** watch `/healthz`, worker catalog, error rate, TLS validity window for the first hour.
    - **First day:** first scheduled backup fires and verifies ([operator signals](recovery.md#operator-signals-not-an-invented-dashboard)); pg-boss job/queue health, disk headroom on both filesystems, audit log review.
    - **First week:** repeat disk/job/backup checks daily; review error-log patterns; confirm no smoke account remains.
    - **Escalation:** two consecutive backup failures, a failed restore verification or an unresolved `ESCALATE_OWNER` signal notifies the Owner immediately — never left for the next check.

---

**Next:** [Deployment](deployment.md) · **Related:** [Environments](environments.md), [Resilience](resilience.md), [CI/CD](../development/ci-cd.md)
