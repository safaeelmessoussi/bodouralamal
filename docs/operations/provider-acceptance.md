[Documentation](../README.md) › [Operations](README.md) › **Moroccan provider acceptance**

# Moroccan Production provider acceptance

This is the single operational checklist for comparing a Nindohost, Clouder, Cap Connect or
other Moroccan-hosting quotation. It turns the residency rule in SRS §2.2, the backup contract
in §6, and the deployment pipeline in §19.1 into evidence the Owner can collect. It does **not**
select a provider, and an unchecked or verbally answered row is not acceptance.

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
| Network | Public IPv4, bandwidth/transfer allowance, port policy and stable-IP behavior during resize/recovery | One preserved public IPv4; SSH and TCP 80/443 permitted |
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

Provider selection does not resolve the separate TD-7 question of who schedules and represents
the host-scoped nightly backup without granting the API Docker-host authority.

---

**Related:** [Deployment readiness](deployment-readiness.md), [Deployment](deployment.md),
[Resilience](resilience.md), [Storage](../architecture/storage.md)
