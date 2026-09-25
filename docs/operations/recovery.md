[Documentation](../README.md) › [Operations](README.md) › **Same-VPS recovery**

# B8: temporary same-VPS recovery

Owner decision, 2026-09-12: for the first couple of months, encrypted backups stay on the Production VPS; no second service/provider required; all data, backups and recovered copies stay physically in Morocco. **Protects against logical/application failure only while the repository survives — not complete disk, VPS or provider loss, nor a root compromise destroying both copies; not full disaster recovery.** Review with the Owner before extending; never silently add an overseas/offsite target.

## Before enabling anything on an authorized host

The local drill authorises nothing; an operator installs the schedule explicitly on the accepted exact-release checkout at `/opt/bodour`, with no other writers into the four Compose data volumes. The tools drain API/pg-boss, stop all services and snapshot a portable PostgreSQL dump, clean raw PostgreSQL and **B1 SeaweedFS** volumes, TLS volumes and configuration; brief planned downtime is unavoidable.

1. Create `/var/lib/bodour-backups` and its `bodour` repository directory, root-owned, mode `0700`; no symlink, not writable by another account.
2. Generate a random restic password (≥ 32 random bytes, e.g. `openssl rand -base64 48`) **on the operator-controlled host** directly into `/root/bodour-recovery/restic-password` (directory `0700`, file `0600`, root-owned). Never paste it into a terminal recording, Git, an argument, CI or a support report; the tool passes a read-only file mount, not the value, to the pinned restic image.
3. Escrow the password independently in the association's authorised vault or sealed offline custody; verify a second custodian can retrieve it — a sole key inside the VPS is not escrow. Record repository ID, source project, exact release and data image digests beside it, **not the password**. Escrow is not an offsite data backup. Never rotate by overwriting; use restic's key-management procedure with a verified old key.
4. Set a **positive integer GiB** backup disk floor for this VPS: no Production default, no reuse of Staging's 20-GiB floor. Before stopping any writer the tool requires that floor **plus twice the currently allocated source-volume bytes** on both the repository filesystem and `/tmp`; monitor both.
5. Create `/etc/bodour-recovery.env`, root-owned `0600` (sourced as trusted root configuration, never writable by an application user):

   ```sh
   BODOUR_RELEASE_TAG=<full-40-hex-accepted-release>
   BACKUP_REPOSITORY=/var/lib/bodour-backups/bodour
   BACKUP_PASSWORD_FILE=/root/bodour-recovery/restic-password
   BACKUP_MINIMUM_FREE_GIB=<positive-integer-for-this-host>
   ```

   The application's `BACKUP_TARGET_SSH` is a legacy required-nonempty setting; in this mode it may name `/var/lib/bodour-backups/bodour`. Host scripts read `BACKUP_REPOSITORY` from the operator file, not a pg-boss job. No key, host configuration or new env contract is committed.

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

- Daily 03:00 **UTC** timer retries failure; `--monthly` skips only when this source project has a successful, still-present verified snapshot from the current UTC month. R133: **one monthly generation, at most two retained after a successful rotation**; no nightly RPO promise; manual exceptional points rotate to the same cap. One repository-wide host lock prevents overlap; never break it forcibly.
- Each run: credentials/disk check before outage → private atomic status file beside the repository → **asks whether a class is being recorded** (R167 §5, R171 §10: `ops:active-recordings` in the API container, the same question [a deployment asks](deployment.md#the-pipeline); exit 3 postpones to tomorrow's timer with `phase=recording-check`; an unanswerable check is a refusal) → stop writers → dump/check PostgreSQL → snapshot all stopped stores → restart the **same** container IDs. Only a fixture drill may pass `--skip-recording-check`; Production refuses it.
- `restic check --read-data` over **all** packs (older snapshots included) before `forget --host <project> --tag bodour --group-by host --keep-last 2 --prune`; grouping by host avoids extra generations per historical path set; other projects untouched. An error never prunes; failed verification may leave more than two snapshots — preserve them, repair, retry before any manual removal. Status is successful only after verification and rotation. No deletion replay or backup mutation for account erasure ([R133 consequences](resilience.md#there-is-no-deletion-replay--and-what-that-honestly-means)).
- Service ceiling two hours; utility containers and SQL have bounded timeouts. Traps remove only their own utility container and attempt to restart stopped services; on daemon/host/power failure inspect the exact Compose services, clear no locks blindly, recover manually, record a failed restart as an outage. Never change a timeout to conceal a stuck operation.

## Operator signals, not an invented dashboard

The five-minute monitor combines: missing/running/failed backup state, missed current-month success, missing snapshot, low disk; database, authenticated storage, queue and registered/active worker health; terminal jobs, created/retry jobs > 10 minutes late, pending retirement count, overdue/failed retirement obligations and unresolved placement-copy outcomes, **even with no job**.
- Aggregate counts in a read-only PostgreSQL session; no payloads, account identifiers, keys or locators. A missing/unreadable probe is a failure, not green. Future-due pending retirements are counted, not called overdue.
- Two consecutive backup failures emit `ESCALATE_OWNER`: the operator notifies the Owner and records the incident. A timer alone is not an attended alert channel:

```sh
sudo systemctl status bodour-backup.service bodour-recovery-monitor.service
sudo journalctl -u bodour-backup.service -u bodour-recovery-monitor.service --since today
sudo bash /opt/bodour/scripts/backup/run-scheduled.sh monitor
```

- Expected red during the planned backup outage, green after verification. Historic terminal pg-boss failures stay visible until handled through the domain/runbook; never delete jobs to get green. No email/SMS delivery or external host-death detection; assign an operator. TD-7 wording and TD-14/TD-16 **Admin dashboard** alerts remain a Document Owner question; no Docker socket in the API, no invented operational route.

## Restore and fresh-host recovery

If **no repository copy survives**, stop: recovery of the lost data is impossible under this architecture; a password or Git checkout cannot reconstruct it. If the repository survives (or an authorised copy exists), recover onto a clean **Moroccan** host:

1. Keep public traffic, scheduled backup and writers stopped; preserve the repository intact. Recover the escrowed password; verify the repository ID against the independently recorded ID with pinned restic `cat config` (never infer the pin from whatever is attached). Inspect `snapshots --host <source> --tag bodour`; record the **full** snapshot ID. Default `latest` is source-project-scoped, never global.
2. Fetch the accepted exact release, restore the bootstrap configuration securely, pull the **exact original PostgreSQL and SeaweedFS image digests/architecture** (no data-image upgrade during raw restore); use base + release + Production overlays. Manifest parsing checks repository, source project, volume set and data image IDs before `compose create`; missing legacy identity metadata needs a separate reviewed plan.
3. Use an empty target Compose project and a nonexistent private recovered-config directory; the command refuses running services/nonempty target volumes and never deletes them. Values come from the verified inventory. `docker-compose.yml` already defines the one SeaweedFS model (Owner, 2026-09-20), so no storage file is passed:

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

4. Restore uses the resolved full ID and `--verify`, compares manifest and dump SHA-256, writes private recovered files and **leaves services stopped**. Any error leaves an untrusted partial target stopped: do not start it; preserve evidence; retry into a new authorised empty target; never auto-wipe or reset repository locks.
5. Compare/install the recovered config without exposing it; never source the manifest. Start the exact recovered release **without reseed or automatic migration**. Verify migration counts, seed/Owner invariants, database canaries, public/private/recording-staging object bytes and metadata, signed GET/PUT, exact-coordinate public reads, `/healthz`, all workers, retirement backlog, a browser journey. In a drill, verify the portable dump into a separate approved disposable database. Logical PostgreSQL restore is separate from raw SeaweedFS restore; never rename/reuse a legacy MinIO volume as SeaweedFS.
6. Recovery may resurrect data deleted since the point (R133): record the recovery timestamp and obtain the operational decision; no automatic deletion replay. Keep traffic closed until acceptance, then reinstall the schedule with the recovered exact release. Never restore Production personal data into localhost or Staging. Keep realistic-size duration evidence: the sub-hour RTO target is **not proven by tiny fixtures**.

Local evidence: [B8 verification](../development/testing.md#b8-same-vps-backup-and-recovery).
