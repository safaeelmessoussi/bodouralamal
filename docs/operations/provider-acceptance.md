[Documentation](../README.md) › [Operations](README.md) › **Moroccan provider acceptance**

# Moroccan Production provider acceptance

The single checklist for comparing a Moroccan-hosting quotation; it turns SRS §2.2 residency, §6 backup and §19.1 deployment into evidence the Owner collects. It selects no provider; an unchecked or verbal row is not acceptance.
- **Temporary B8 exception (Owner, 2026-09-12):** the offsite row/gate and second-location drill are deferred for the first couple of months in favour of [encrypted same-VPS backup](recovery.md); residency is not waived, total-host-loss recovery is not provided, R133 monthly/max-two retention is fixed.
- Record quotation reference, date, legal supplier, service location and named responder in the private procurement record; never commit prices, contacts, credentials or contracts.

## Reject gates

Reject before technical testing if any is false or merely assumed:
- every primary database, object, snapshot, replica, backup and DR copy that may hold real data is physically in Morocco, locations and subcontractors confirmed in writing;
- the operator gets root-capable administration, key-only SSH and recovery-console access to a supported Ubuntu host permitting the repository's Docker topology;
- a maintained, supported S3-compatible object store on Moroccan infrastructure, or the selected self-hosted product permitted on the VPS;
- the offsite backup destination is a second Moroccan location and a separate failure domain;
- contract, support and deletion/exit process acceptable to the Owner and legal review.

«Moroccan company», «local support» and «regional cloud» do not prove residency; answers must state where bytes and every automatic copy reside.

## Quotation evidence matrix

Copy per shortlisted offer into the private record with PASS/FAIL and the written-answer reference; a provider passes only when each row has a written answer or executed proof.

| Area | Required answer or evidence | Acceptance rule |
|---|---|---|
| Primary residency | Physical country/site for VM disks, PostgreSQL, object storage | Morocco, in writing |
| Secondary residency | Physical site for snapshots, replicas, backups, DR copies | Every copy Morocco-only; no automatic foreign replica |
| Subprocessors | Legal entities operating infrastructure or backup | Named; in Owner/legal review |
| Compute | 4 vCPU baseline; dedicated/shared model, fair-use, allocation guarantee | No undisclosed burst-only/throttled allocation |
| Memory | 8 GiB initial; exact path, downtime, rebuild requirement for 16 GiB | In-place or documented migration with preserved data/IP |
| Host storage | ~200 GB NVMe, usable capacity, filesystem, IOPS/throughput, contention model | Persistent storage fit for PostgreSQL and the object store |
| Expansion | Increment, maximum, lead time, downtime, shrink/rebuild involvement | Growth path documented before purchase |
| Snapshots | Consistency, schedule, retention, encryption, restore method, location | Supplemental only; never the §6 recovery point |
| Network | Public IPv4, bandwidth/transfer, port policy, stable IP through resize/recovery | One preserved IPv4; SSH, TCP 80/443 **and media ports 7881/tcp, 7882/udp (inbound UDP unfiltered)** |
| Administration | Root/sudo, key-only SSH, serial/VNC console, rescue mode, reinstall | Host contract implementable without an auth bypass |
| Network defence | Provider firewall, anti-DDoS scope, response process | Documented; PostgreSQL/object storage unpublished |
| Reliability | SLA, maintenance notice, host redundancy, escalation | Written service/escalation boundaries |
| Recovery | Failed-host replacement, data-volume attachment/recovery, operator access | Rehearsable, not an undocumented ticket |
| Offsite backup | Second-location service, protocol, frequency, encryption, failure-domain separation | Morocco-only, separate from the primary site |
| Backup retention | Retention controls, deletion, restore initiation/fees/throughput | Owner chooses the horizon; no silent destruction |
| S3 API | Path-style SigV4, AWS SDK, PUT/GET/HEAD/copy/delete, range, conditional ops | Passes the full suite in [Storage](../architecture/storage.md#owner-decision-required--object-store) |
| S3 administration | Three buckets, private policies, authenticated health, versioning/lifecycle/Object Lock | Versioning off; no unapproved lifecycle/retention |
| S3 durability | Durability model, replication/failure domains, scrub, monitoring | Documented, Morocco-only compatible |
| S3 backup/export | Consistent export/restore, portability, throughput | Integrates with the encrypted recovery-point drill |
| Platform | Ubuntu 24.04 LTS AMD64; Docker/rootful/volume restrictions | Satisfies the [supported host contract](deployment.md#supported-host-contract) |
| Commercial | Initial 4-vCPU/8-GiB/~200-GB, 16-GiB upgrade, setup/traffic/backup/restore/support fees | Total recurring and recovery costs explicit |
| Terms | Commitment, renewal, cancellation, export/deletion, support hours, exit assistance | Owner/legal acceptance before real data |

Self-hosting the object store on the VPS is compatible only when the product is maintained/supported, its budget fits, its container/health/export integration is adapted and the second Moroccan recovery point survives VPS loss. The MinIO OSS pin is not acceptable ([Storage](../architecture/storage.md#owner-decision-required--object-store)).

## Production disk recommendation awaiting Owner approval

For the planned ~200-GB primary disk: **deployment preflight floor 50 GiB free** on Docker's data-root filesystem; **growth warning 60 GiB**; **critical state 50 GiB** (deployment or recovery rehearsal stops until capacity is expanded/reclaimed).
- 50 GiB ≈ one quarter of the disk: two release generations, PostgreSQL WAL/migration workspace, dump/restore workspace, bounded logs, object-store repair space, rollback recovery. Warning 10 GiB earlier so procurement is not first notified at the gate.
- **Not an approved default, not proof 200 GB suffices**: SRS §2.3 still needs the Owner's recordings/week and average-size estimate. Preflight takes the approved explicit whole-GiB value; never embed the recommendation in code. Runtime disk alerting depends on the open TD-14/TD-3 alert decision.

## Assessment of one quotation (2026-09-20)

Offer: **4 vCPU, 8 GB RAM, 100 GB SSD, 1 Gbps best-effort unmetered, Linux, HA virtualisation, ISO 27001 / Tier III datacentre, 99.9 % availability, anti-DDoS**, plus a separate **100 GB agent-based external backup** line. **Assessment, not selection: nothing ordered; Production go-live on hold.** Verdict: enough to launch on, one known limit (disk), three written answers required first.

| Area | Offer | Against the need |
|---|---|---|
| Compute | 4 vCPU | **Meets** the 4-CPU floor (R164 §5). Measured: media server 0.35 core; one 720p recording 1.7–1.9 cores, audio 0.2–0.35 — **one video recording at a time**; a second is refused by the recorder's admission control, not degraded. Only if not burst-only (Q2) |
| Memory | 8 GB | **Meets** (recorder ≈ 700 MiB, media server ≈ 140 MiB); 16 GB path unstated (Q5) |
| Disk | 100 GB SSD | **The limit**; the recommendation above was sized for ~200 GB. Enough to launch, not to stop thinking |
| Network | 1 Gbps best effort, unmetered | **Meets**; shared port suits class traffic |
| Media ports | not stated | **Q1 — decides online classes.** Inbound **UDP 7882** and **TCP 7881** (R164 §2); anti-DDoS dropping UDP leaves classes on TCP fallback or unreachable |
| Residency | «Cloud Maroc», Tier III | **Not evidence**: physical site of VM disks **and of the backup remote server**, plus subprocessors, in writing (Q3, reject gates) |
| Backup line | 100 GB, agent, remote server | Could be the second Moroccan copy B8 waits for, if: physical location known; agent limited to the already-encrypted repository (`/var/lib/bodour-backups`); a root agent's effect on the [host contract](deployment.md#supported-host-contract) understood |
| Platform / access | «Linux» | **Q4**: Ubuntu 24.04 LTS AMD64, root, key-only SSH, Docker, rescue/serial console |
| Availability | 99.9 %, HA | Acceptable; covers infrastructure, not a backup |

- **Disk arithmetic:** OS + two release generations ≈ **25 GB** (recorder image 4 GB); a Staging-like 20 GiB floor leaves ≈ **50 GB** for PostgreSQL, object store and same-host repository. Recordings are pre-compressed, so with two retained generations plus working room each media GB costs **2–3 GB**: practical media budget **15–20 GB** ≈ **25–30 h video** (~0.63 GB/h) or **250–330 h audio** (~59 MB/h). Levers: record **audio** unless picture matters (form default, R163 §1); move the second copy to the backup line once Q3 is answered; buy the disk increment early. The 50 GiB floor **cannot** carry unchanged onto 100 GB; the Owner sets this host's floor at provisioning.
- **Written questions before ordering:** (1) anti-DDoS/firewall passes inbound UDP 7882 and TCP 7881 unfiltered, no rate limit a sustained stream trips; (2) vCPUs dedicated or shared, fair-use/burst policy — a recording needs ~2 cores continuously; (3) physical city/site of VM disks and backup remote server, and operating legal entities (Loi 09-08); (4) Ubuntu 24.04 LTS AMD64, root, key-only SSH, Docker, rescue/serial console; (5) upgrade path to 200 GB / 16 GB — increment, downtime, IPv4 and data survival; (6) backup agent restricted to one directory, encrypted before leaving the VM, retention/restore terms, restore billing.
- Customer identification field was blank; offer is twelve months.

### Written answers (2026-09-21) and what is still open

**The Owner decided to launch WITHOUT the external-backup line.**

| Question | Written answer | Status |
|---|---|---|
| 2 · vCPU | Dedicated, recent processors | **Answered** |
| 3 · Residency | Server and data physically in Morocco (ISO 27001 / Tier III); backup copies on an external space also in Morocco | **Substance answered; not evidence** — city/site and legal entity needed for the CNDP file, asked for in the contract |
| 5 · Upgrade | CPU/RAM on demand, no reinstall, same IPv4, ~15 min at an agreed time; storage addable separately | **CPU/RAM answered; disk not explicit** (online and data-preserving?) |
| Storage | NVMe, no stated IOPS cap | Better than quoted «SSD» |
| Payment | Quarterly with annual commitment; no monthly | Commercial, Owner's to accept |
| 1 · Media ports | not answered | **OPEN — decides online classes** |
| 4 · Platform | implied only («conservant votre application Docker») | **OPEN** |
| Contract | not provided | **OPEN, mandatory:** Loi 09-08 art. 25 — written host commitment on data security/confidentiality; without it the hosting cannot be declared |
| Migration service | Offered, billed | Declined; the pipeline deploys itself |

Without the backup line the only recovery point is the encrypted repository on the same VPS ([recovery](recovery.md), B8): survives a bad deployment, dropped table or deleted recording; **does not survive loss of the VPS or its disk** — accepted for a first couple of months, ended by the backup line or another Moroccan second location.

## Technical acceptance after shortlisting

Before an empty deployment is accepted on the host:
1. read-only host preflight on the exact release and the Owner-approved disk floor;
2. pull exact GHCR images; verify revision labels and running image IDs;
3. object-store replacement suite incl. administrative bucket settings;
4. encrypted recovery point in the second Moroccan location; destroy only disposable rehearsal state; restore; measure realistic-volume RTO;
5. reboot, restart/recreation, disk/resource pressure, TLS renewal, dependency health, anonymous plus OAuth-bound smoke through the real edge;
6. record provider evidence and Owner/legal approvals with no secrets or personal data in Git.

Provider selection does not resolve TD-7's backup representation; the B8 host timer schedules monthly points/daily retry without API Docker authority; catalog/dashboard reconciliation stays separate.

---

**Related:** [Deployment readiness](deployment-readiness.md), [Deployment](deployment.md), [Resilience](resilience.md), [Storage](../architecture/storage.md)
