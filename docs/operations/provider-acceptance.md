[Documentation](../README.md) › [Operations](README.md) › **Moroccan provider acceptance**

# Moroccan Production provider acceptance

This is the single operational checklist for comparing a Nindohost, Clouder, Cap Connect or
other Moroccan-hosting quotation. It turns the residency rule in SRS §2.2, the backup contract
in §6, and the deployment pipeline in §19.1 into evidence the Owner can collect. It does **not**
select a provider, and an unchecked or verbally answered row is not acceptance.

**Temporary B8 exception (Owner, 2026-09-12):** the offsite row/gate and second-location
drill below are deferred for the first couple of months in favor of
[encrypted same-VPS backup](recovery.md). This does not waive Moroccan residency and
does not provide total-host-loss recovery. R133 already fixes monthly/max-two retention;
it is not an open choice of arbitrary provider retention tiers.

Record the quotation reference, date, legal supplier name, service location and named responder
before assessing it. Keep the quotation and written answers with the private procurement record;
do not commit prices, contacts, credentials or contract documents to this repository.

## Reject gates

Reject the offer before technical testing if any of these remains false or merely assumed:

- every primary database, object, snapshot, replica, backup and disaster-recovery copy that may
  contain real data is physically stored in Morocco, with the locations and subcontractors
  confirmed in writing;
- the operator receives root-capable administration, key-only SSH and recovery-console access
  to a supported Ubuntu host on which the repository's Docker topology is permitted;
- the provider can supply a maintained, supported S3-compatible object store on Moroccan
  infrastructure, or permits the selected maintained self-hosted product on the VPS;
- the offsite backup destination is a second Moroccan location and a separate failure domain;
- the contract, support and deletion/exit process are acceptable to the Owner and legal review.

"Moroccan company", "local support" and "regional cloud" do not prove physical residency.
Written answers must identify where bytes and every automatic copy actually reside.

## Quotation evidence matrix

For every shortlisted offer, copy this matrix into the private procurement record and add a
PASS/FAIL result plus the quotation or written-answer reference. A provider passes only when each
required row has a written answer or an executed technical proof.

| Area | Required answer or evidence | Acceptance rule |
|---|---|---|
| Primary residency | Physical country/site for VM disks, PostgreSQL and object storage | Morocco, stated in writing |
| Secondary residency | Physical country/site for snapshots, replicas, backups and DR copies | Every copy Morocco-only; no automatic foreign replica |
| Subprocessors | Legal entities operating infrastructure or backup services | Named and included in Owner/legal review |
| Compute | 4 vCPU baseline; state dedicated/shared model, fair-use limits and allocation guarantee | No undisclosed burst-only or throttled allocation |
| Memory | 8 GiB initial RAM; exact path, downtime and rebuild requirement for 16 GiB | In-place or documented migration path with preserved data/IP |
| Host storage | Approximately 200 GB NVMe, usable capacity, filesystem, stated IOPS/throughput and contention model | Persistent storage suitable for PostgreSQL and the selected object store |
| Expansion | Increment, maximum size, lead time, downtime and whether shrinking/rebuild is involved | Growth path documented before purchase |
| Snapshots | Crash/application consistency, schedule, retention, encryption, restore method and physical location | Supplemental only; never a substitute for the §6 recovery point |
| Network | Public IPv4, bandwidth/transfer allowance, port policy and stable-IP behavior during resize/recovery | One preserved public IPv4; SSH, TCP 80/443 **and the online-class media ports 7881/tcp and 7882/udp (inbound UDP must not be filtered)** permitted |
| Administration | Root/sudo, key-only SSH, serial/VNC console, rescue mode and reinstall workflow | Repository host contract can be implemented without an auth bypass |
| Network defence | Provider firewall, anti-DDoS scope and response process | Controls documented; PostgreSQL/object storage remain unpublished |
| Reliability | SLA, maintenance notice, host redundancy and incident escalation | Written service and escalation boundaries |
| Recovery | Failed-host replacement process, data-volume attachment/recovery and expected operator access | Recovery can be rehearsed rather than dependent on an undocumented ticket |
| Offsite backup | Second-location service, protocol, frequency options, encryption support and failure-domain separation | Morocco-only and separate from the primary host/site |
| Backup retention | Available retention controls, deletion, restore initiation, restore fees and expected throughput | Owner chooses a horizon; provider does not silently destroy required points |
| S3 API | Path-style SigV4, AWS SDK compatibility, PUT/GET/HEAD/copy/delete, range and conditional operations | Must pass the full replacement suite in [Storage](../architecture/storage.md#owner-decision-required--object-store) |
| S3 administration | Three buckets, private policies, authenticated health, versioning/lifecycle/Object Lock controls | Versioning off and no unapproved lifecycle/retention rule |
| S3 durability | Durability model, replication count/failure domains, repair/scrub process and monitoring | Documented and compatible with Morocco-only residency |
| S3 backup/export | Consistent export/restore method, format portability and realistic throughput | Must integrate with the encrypted recovery-point drill |
| Platform | Ubuntu 24.04 LTS AMD64 availability and restrictions on Docker/rootful containers/volumes | Must satisfy the [supported host contract](deployment.md#supported-host-contract) |
| Commercial | Initial 4-vCPU/8-GiB/~200-GB price, 16-GiB upgrade, setup/traffic/backup/restore/support fees | Total recurring and recovery costs explicit |
| Terms | Commitment, renewal, cancellation, data export/deletion, support hours and exit assistance | Owner/legal acceptance recorded before real data |

Self-hosting the chosen object store on the Production VPS remains compatible with the current
single-host architecture only when the product is maintained and supported, its resource budget
fits, its container/health/export integration is adapted, and the second Moroccan recovery point
survives loss of that VPS. The current MinIO OSS pin is not acceptable; the reason and replacement
suite live in [Storage](../architecture/storage.md#owner-decision-required--object-store).

## Production disk recommendation awaiting Owner approval

For the planned approximately 200-GB primary disk, the engineering recommendation is:

- **deployment preflight floor: 50 GiB free** on the filesystem holding Docker's data root;
- **growth warning: 60 GiB free**; and
- **critical capacity state: 50 GiB free**, at which a deployment or recovery rehearsal stops
  until capacity is expanded or safely reclaimed.

Fifty GiB is roughly one quarter of the planned disk. It reserves room for two exact release generations,
PostgreSQL WAL/query/migration workspace, a logical dump and restore workspace, bounded container
and host logs, object-store repair/temporary work, and failed-deployment or rollback recovery.
The warning starts 10 GiB earlier so procurement is not first notified at the hard gate.

This is a concrete recommendation, **not an approved default and not proof that 200 GB is enough**.
SRS §2.3 still requires the Owner's recordings-per-week and average-size estimate; the annual
object budget plus database growth determines whether the disk itself is adequate. The existing
preflight already accepts an explicit whole-GiB floor and must continue to receive the approved
value rather than embedding this recommendation in code. Runtime disk alert delivery also depends
on the still-open TD-14/TD-3 operational-alert decision.

## Assessment of one quotation against this matrix (2026-09-20)

Requested by the Owner for a Moroccan «Cloud» VM offer: **4 vCPU, 8 GB RAM, 100 GB SSD,
1 Gbps best-effort port with unmetered monthly transfer, Linux, high-availability
virtualisation with hardware redundancy, an ISO 27001 / Tier III datacentre, 99.9 %
availability and anti-DDoS**, with a separate **100 GB external backup** line (agent
licence, automatic backup to a remote server, daily report, configurable frequency and
retention, web restore console). Prices, the quotation reference and contacts stay in the
private procurement record, as this page requires. **This is an assessment, not a selection:
nothing was ordered and Production go-live remains on hold.**

**Verdict — enough to LAUNCH on, with one known limit and three answers that must arrive in
writing first.**

| Area | The offer | Against what this platform needs |
|---|---|---|
| Compute | 4 vCPU | **Meets it.** The Production preflight floor is 4 CPUs (SRS Revision 164 §5). Measured: the media server peaks at 0.35 core; one 720p recording costs the recorder 1.7–1.9 cores, an audio one 0.2–0.35. So **one video recording at a time** with the platform still responsive, plus audio recordings beside it; a second simultaneous video recording is *refused by the recorder's own admission control* rather than degrading the first — which is the designed behaviour, and worth the Owner knowing before two classes are recorded in video at once. **Only true if the vCPUs are not burst-only** (question 2). |
| Memory | 8 GB | **Meets it.** The whole stack with one video recording in progress sits well inside 8 GB (recorder ≈ 700 MiB, media server ≈ 140 MiB). The matrix asks for the 16 GB path to be stated before purchase; the quotation does not state it (question 5). |
| Disk | 100 GB SSD | **The limit.** The matrix planned for *approximately 200 GB*, and the [disk recommendation](#production-disk-recommendation-awaiting-owner-approval) below was sized for that. It is enough to launch; it is not enough to stop thinking about. See the arithmetic under this table. |
| Network | 1 Gbps best effort, unmetered | **Meets it** for this audience. «Best effort» is a shared port, which suits class traffic; nothing here depends on a guaranteed rate. |
| Media ports | *not stated* | **Must be confirmed (question 1).** Online classes need inbound **UDP 7882** and **TCP 7881** beside 80/443 (SRS Revision 164 §2). An anti-DDoS layer that drops or rate-limits unsolicited inbound UDP would leave every class on the TCP fallback, or unreachable. This is the single answer most likely to decide the offer. |
| Residency | «Cloud Maroc», Tier III datacentre | **Not yet evidence.** A Moroccan company and a product name do not state where the bytes are. The matrix needs the physical site of the VM disks **and of the backup line's remote server**, and every subprocessor, in writing (question 3, and the [reject gates](#reject-gates)). |
| Backup line | 100 GB, agent-based, remote server | **Potentially valuable — it could be the second Moroccan copy the temporary B8 exception is waiting for** — but three things decide that: where the remote server physically is; that the agent can be limited to the already-encrypted recovery repository (`/var/lib/bodour-backups`) so the provider never holds readable personal data; and what a provider's agent running as root on the host means for the [host contract](deployment.md#supported-host-contract). 100 GB is the same size as the disk, so it fits by construction. |
| Platform / access | «Linux» | **Must be confirmed (question 4):** Ubuntu 24.04 LTS AMD64, root with key-only SSH, Docker permitted, a rescue or serial console. |
| Availability | 99.9 %, HA infrastructure | Acceptable. Note what it covers: the *infrastructure*. It is not a backup and does not replace the recovery point. |

**The disk, in numbers.** Roughly: the operating system and two exact release generations of
the images take about **25 GB** (the recorder image alone is 4 GB, and two generations are kept
so a deployment can roll back). A deployment floor sized like Staging's (20 GiB) leaves about
**50 GB** for PostgreSQL, the object store and the same-host recovery repository together.
Recordings are already compressed, so the recovery repository cannot shrink them: with up to
two retained generations plus the working room a backup needs, every gigabyte of media costs
roughly **two to three** on this disk. That puts the practical media budget near **15–20 GB**.
At the measured rates — about **0.63 GB per hour of video** and **59 MB per hour of audio** —
that is on the order of **25–30 hours of video**, or **250–330 hours of audio**, before the
disk must grow. Everything that is not a recording (documents, images, the database) is small
beside that. Three levers, in order of effect: record in **audio** unless the picture matters
(the form already defaults to it, SRS Revision 163 §1); move the recovery repository's second
copy onto the backup line once question 3 is answered, which returns a large share of the disk;
and buy the disk increment early — the [growth warning](#production-disk-recommendation-awaiting-owner-approval)
exists so that is a purchase, not an incident. The 50 GiB floor recommended below was sized
for 200 GB and **cannot** be carried onto a 100 GB disk unchanged; the Owner-approved floor for
this host would be set when it is provisioned.

**Questions to put to the provider, in writing, before ordering:**

1. Does the anti-DDoS / firewall layer pass **inbound UDP 7882 and TCP 7881** to the VM,
   unfiltered and without a rate limit that a sustained media stream would trip?
2. Are the 4 vCPUs **dedicated or shared**, and is there a fair-use or burst policy? A
   recording needs about two cores *continuously* for the length of a class.
3. **Where, physically, are the VM's disks and the backup line's remote server** — city and
   site — and which legal entities operate each? (Loi 09-08; the reject gates above.)
4. Is **Ubuntu 24.04 LTS (AMD64)** offered, with root access, key-only SSH, Docker permitted
   and a rescue/serial console?
5. What is the **upgrade path** — disk to 200 GB and memory to 16 GB: increment, price,
   downtime, and whether the public IPv4 and the data survive it?
6. For the backup line: can the agent be restricted to **one directory**; is the data
   **encrypted before it leaves the VM**; what are the retention and restore terms; and is
   restore billed?

Also worth noticing before signing: the quotation's customer identification field for the
association was blank, and the offer is for twelve months.

### What the provider has since answered in writing (2026-09-21), and what is still open

Recorded without names, prices or quotation numbers, as this page requires. **The Owner has
decided to launch WITHOUT the external-backup line**, which makes the last row below matter more.

| Question | Written answer | Status |
|---|---|---|
| 2 · vCPU model | Dedicated vCPUs, recent processors | **Answered.** A recording's two sustained cores are available |
| 3 · Residency | Server and data physically in Morocco, in an ISO 27001 / Tier III datacentre; backup copies on an external space also in Morocco | **Answered in substance; not yet evidence.** City/site and the legal entity operating it are not named — needed for the CNDP file, so asked for in the contract rather than in another email |
| 5 · Upgrade path | CPU and RAM on demand, no migration or reinstall, same public IPv4, ~15 minutes at an agreed time; storage can also be added separately | **Answered for CPU/RAM; disk not explicit** — whether a disk extension is online and keeps the data is asked once more |
| Storage | NVMe, no stated IOPS cap | Better than the quotation's «SSD» |
| Payment | No monthly billing; quarterly with an annual commitment | Commercial, the Owner's to accept |
| 1 · Media ports | *not answered* | **OPEN — the one that decides online classes.** Inbound UDP 7882 and TCP 7881 through the anti-DDoS layer |
| 4 · Platform | *implied only* («conservant votre application Docker») | **OPEN.** Ubuntu 24.04 LTS AMD64, root, key-only SSH, Docker, rescue/serial console |
| Contract | *not yet provided* | **OPEN, and mandatory.** Loi 09-08 art. 25 as the CNDP applies it: a written contractual commitment by the host on the security and confidentiality of the data. Without it the hosting cannot be declared |
| Migration service | Offered, billed | Declined: this repository deploys itself by a documented pipeline |

**Launching without the backup line — what that means.** The only recovery point is then the
encrypted repository ON the same VPS ([recovery](recovery.md), the temporary B8 exception):
it survives a bad deployment, a dropped table or a deleted recording, and **does not survive
the loss of the VPS or its disk**. That is an accepted risk for a first couple of months, not a
design; the backup line (or another Moroccan second location) is what ends it, and the disk
arithmetic above assumes it eventually does.

## Technical acceptance after shortlisting

Before an empty deployment is accepted on the selected host:

1. run the read-only host preflight against the exact release and the Owner-approved disk floor;
2. pull the exact GHCR images and verify their revision labels and running image IDs;
3. execute the object-store replacement suite, including administrative bucket settings;
4. create an encrypted recovery point in the second Moroccan location, destroy only disposable
   rehearsal state, restore it and measure realistic-volume RTO;
5. verify reboot, restart/recreation, disk/resource pressure, TLS renewal, dependency health and
   anonymous plus authorized OAuth-bound smoke through the real edge; and
6. record the provider evidence and Owner/legal approvals without placing secrets or personal
   data in Git.

Provider selection does not resolve TD-7's representation of backup work. The temporary B8
host timer schedules monthly recovery points/daily retry without API Docker-host authority;
formal catalog/dashboard reconciliation remains separate.

---

**Related:** [Deployment readiness](deployment-readiness.md), [Deployment](deployment.md),
[Resilience](resilience.md), [Storage](../architecture/storage.md)
