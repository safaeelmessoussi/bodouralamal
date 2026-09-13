[Documentation](../README.md) › [Operations](README.md) › **Same-VPS recovery**

# B8: temporary same-VPS recovery

Owner decision, 2026-09-12: for the first couple of months, keep encrypted backups on the
Production VPS. No second service/provider is required for this bounded architecture.
All Production data, backups and recovered copies must still remain physically in Morocco.
**This protects against logical/application failures only while the repository survives. It
does not protect against complete disk, VPS or provider loss, or a root compromise that can
destroy both copies. It is not full disaster recovery.** Review this temporary arrangement
with the Owner before extending it; do not silently add an overseas/offsite target.

## Before enabling anything on an authorized host

The local engineering drill does not authorize deployment. An operator must explicitly install
the schedule on the accepted exact-release checkout at `/opt/bodour`. There must be no other
writers into the four Compose data volumes. The host tools drain API/pg-boss, stop all services,
and snapshot a portable PostgreSQL dump, clean raw PostgreSQL and **B1 SeaweedFS** volumes,
TLS volumes and configuration. Brief planned downtime is unavoidable in this small design.

1. Create `/var/lib/bodour-backups` and its `bodour` repository directory, owned by root,
   mode `0700`. Do not use a symlink or a directory writable by another account.
2. Generate a random restic password (at least 32 random bytes; e.g. `openssl rand -base64 48`)
   **on the operator-controlled host**, writing directly into
   `/root/bodour-recovery/restic-password`, directory `0700`, file `0600`, root-owned.
   Never paste it into a terminal recording, Git, an argument, CI or a support report.
   The tool passes a read-only file mount, not the password value, to the pinned restic image.
3. Escrow the password independently in the association's authorized secure password vault or
   sealed offline custody; verify a second authorized custodian can retrieve it. A sole key
   inside the VPS is not escrow. Record repository ID, source project, exact release and data
   image digests beside that inventory, **not the password**. Key escrow does not create an
   offsite data backup and cannot recover missing repository bytes. Never rotate the file by
   overwriting it; use restic's deliberate key-management procedure with a verified old key.
4. Set a **positive integer GiB** backup disk floor appropriate to this VPS. There is deliberately
   no Production default and no reuse of Staging's 20-GiB deployment floor. Before stopping any
   writer, the tool requires that floor **plus twice the currently allocated source-volume bytes**
   on both the repository filesystem and `/tmp`. This conservative working-space estimate is
   not a quota or a guarantee against concurrent host disk growth; monitor both filesystems.
5. Create `/etc/bodour-recovery.env`, root-owned `0600`, using these variable names (replace
   the release/floor placeholders with actual approved values; this file is sourced as trusted
   root configuration, never writable by an application user):

   ```sh
   BODOUR_RELEASE_TAG=<full-40-hex-accepted-release>
   BACKUP_REPOSITORY=/var/lib/bodour-backups/bodour
   BACKUP_PASSWORD_FILE=/root/bodour-recovery/restic-password
   BACKUP_MINIMUM_FREE_GIB=<positive-integer-for-this-host>
   ```

   The existing application's `BACKUP_TARGET_SSH` is a legacy required nonempty compatibility
   setting; for this temporary mode it can name `/var/lib/bodour-backups/bodour`. The host
   scripts use `BACKUP_REPOSITORY` from the separate operator file, not a pg-boss job. No key,
   host configuration or new application env contract is committed.

## Schedule, verify, then rotate

On an **authorized** host, review and install the four templates from `scripts/backup/`:

```sh
sudo install -m 0644 scripts/backup/bodour-backup.service scripts/backup/bodour-backup.timer \
  scripts/backup/bodour-recovery-monitor.service scripts/backup/bodour-recovery-monitor.timer \
  /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bodour-backup.timer bodour-recovery-monitor.timer
sudo systemctl start bodour-backup.service
sudo systemctl start bodour-recovery-monitor.service
sudo systemctl list-timers bodour-backup.timer bodour-recovery-monitor.timer
```

The daily 03:00 **UTC** timer retries failure, but `--monthly` skips only when this source
project has a successful, still-present verified snapshot from the current UTC month. R133
requires **one monthly generation, at most two retained after a successful rotation**. It does
not promise nightly RPO. Manual exceptional recovery points also rotate to the same cap.
One repository-wide host lock prevents backup/restore overlap; never forcibly break it.

Each run checks credentials/disk before outage, records a private atomic status file beside
the repository, stops writers, dumps/checks PostgreSQL, snapshots all stopped stores, then
restarts the **same** container IDs. It runs `restic check --read-data` over **all** packs,
including older snapshots, before `forget --host <project> --tag bodour --group-by host
--keep-last 2 --prune`. Grouping by host avoids keeping extra generations for each historical
path set; other projects are untouched. An error never intentionally prunes previous points.
Failed verification can temporarily leave more than two snapshots: preserve them, repair the
repository failure and retry before considering any explicit manual removal. The status only
becomes successful after verification and rotation. No deletion replay or backup mutation for
individual account erasure is introduced; see [R133 consequences](resilience.md#there-is-no-deletion-replay--and-what-that-honestly-means).

The service has a two-hour ceiling; individual restic utility containers and SQL have bounded
timeouts. Traps remove only their own utility container and attempt to restart stopped services.
If the daemon/host is unavailable or power fails, automatic recovery cannot be guaranteed:
inspect the exact Compose services, clear no locks blindly, and recover manually. Record any
failed restart as an outage. Do not change a timeout simply to conceal a stuck operation.

## Operator signals, not an invented dashboard

The five-minute monitor combines:

- missing/running/failed backup state, missed current-month success, missing snapshot and low disk;
- database, authenticated storage, queue and actual registered/active worker health;
- terminal jobs, created/retry jobs more than 10 minutes late, pending retirement count,
  overdue/failed retirement obligations and unresolved placement-copy outcomes, **even with no job**.

It reads aggregate counts in a read-only PostgreSQL session; no job payloads, account identifiers,
keys or object locators are printed. A missing/unreadable probe is a failure, not green. Normal
future-due pending retirements are counted without falsely calling them overdue. Two consecutive
backup failures emit `ESCALATE_OWNER`; the responsible operator must notify the Owner and record
the incident. Check failed units and their journal; a timer alone is not an attended alert channel:

```sh
sudo systemctl status bodour-backup.service bodour-recovery-monitor.service
sudo journalctl -u bodour-backup.service -u bodour-recovery-monitor.service --since today
sudo bash /opt/bodour/scripts/backup/run-scheduled.sh monitor
```

The monitor is expected to go red during the planned outage/backup in progress and recover after
verification. Historic terminal pg-boss failures remain visible until handled through the proper
domain/runbook; never delete jobs just to get green. There is no email/SMS delivery or external
host-death detection in this same-host design. Assign an operator to review it. TD-7 execution
wording and TD-14/TD-16 **Admin dashboard** alerts remain a separate Document Owner contract
question; no Docker socket is mounted into API and no operational API route is invented.

## Restore and fresh-host recovery

If **no repository copy survives**, stop: fresh-host recovery of the lost data is impossible
under the approved architecture. Do not claim a password or Git checkout can reconstruct it.
If the repository disk/directory survives (or an independently authorized copy is available),
an authorized operator may recover it onto a clean **Moroccan** host:

1. Keep public traffic, scheduled backup and application writers stopped. Preserve the surviving
   repository intact. Recover the escrowed password and verify the repository ID against the
   independently recorded ID using pinned restic `cat config`. Do not infer the pin merely from
   whatever repository happens to be attached. Inspect `snapshots --host <source> --tag bodour`;
   record the **full** desired snapshot ID. Default `latest` is source-project-scoped, never global.
2. Fetch the accepted exact release, restore the operator-supplied bootstrap configuration securely,
   and pull the **exact original PostgreSQL and SeaweedFS image digests/architecture**. Do not
   upgrade data images during raw restore. Use the existing base + release + Production overlays.
   Manifest parsing checks repository, source project, volume set and data image IDs before
   `compose create`; missing legacy identity metadata requires a separate reviewed recovery plan.
3. Use an empty target Compose project and a nonexistent private recovered-config directory.
   The command refuses running services/nonempty target volumes; it never deletes them for you.
   Obtain values below from the verified inventory/operator configuration, not guesswork:

   ```sh
   sudo bash scripts/backup/restore-recovery-point.sh \
     --project bodour --source-project bodour \
     --compose-file docker-compose.yml --compose-file docker-compose.release.yml \
     --compose-file docker-compose.production.yml \
     --repository /var/lib/bodour-backups/bodour \
     --password-file /root/bodour-recovery/restic-password \
     --repository-id "$EXPECTED_REPOSITORY_ID" --snapshot "$EXPECTED_SNAPSHOT_ID" \
     --recovered-config-dir /root/bodour-recovered-config \
     --confirm-production-restore RESTORE_TO_EMPTY_PRODUCTION_VOLUMES
   ```

4. Restore uses the resolved full ID and `--verify`, compares the manifest and dump SHA-256,
   writes private recovered files, and **leaves services stopped**. Any error leaves an untrusted
   partial target stopped; do not start it. Preserve evidence and use a new explicitly authorized
   empty target for retry, never auto-wipe a failed restore or reset repository locks.
5. Compare/install the recovered config locally without exposing it; never source the manifest.
   Start the exact recovered release, **without reseed or automatic migration**. Verify migration
   counts, seed/Owner invariants, database canaries, actual public/private/recording-staging object
   bytes and metadata, signed GET/PUT, exact-coordinate public reads, `/healthz`, all workers,
   retirement backlog and a browser journey. Verify the portable dump into a separate approved
   disposable database when doing a drill. PostgreSQL logical restore is separate from raw
   SeaweedFS restore; never rename/reuse a legacy MinIO volume as SeaweedFS.
6. Recovery may resurrect data deleted since that point (R133). Record the recovery timestamp
   and obtain the required operational decision; there is no automatic deletion replay. Keep
   traffic closed until acceptance; only then reinstall the schedule with the recovered exact
   release. Never restore Production personal data into localhost or Staging. Keep realistic-size
   duration evidence: the sub-hour RTO target is **not proven by tiny synthetic fixtures**.

Local evidence: [B8 verification](../development/testing.md#b8-same-vps-backup-and-recovery).
