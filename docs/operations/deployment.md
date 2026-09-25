[Documentation](../README.md) › [Operations](README.md) › **Deployment**

# Deployment

Deterministic pipeline from a clean VPS to a healthy platform; eleven steps, in order.

## Supported host contract

Release images are Linux/AMD64 only:

| Concern | Required state |
|---|---|
| OS | Ubuntu Server **22.04 LTS or 24.04 LTS**, x86_64/AMD64; no derivative |
| Capacity | ≥ 4 GB RAM, swap, **Owner-approved free-disk floor** on Docker's data-root filesystem; **CPUs ≥ 2 Staging, ≥ 4 Production** (one 720p recording peaks ~1.9 cores — [evidence](../development/online-class-provider.md#what-it-actually-costs-measured)); preflight refuses less |
| Runtime | Docker Engine from Docker's official Ubuntu repo, local rootful daemon enabled at boot; Compose **≥ 2.24.4** (the `!override` tag verification overlays use) |
| Operator | One dedicated non-root deployment account, SSH key only, in `docker`, non-interactive root for the read-only `/usr/sbin/sshd -T -C …` preflight; no shared login |
| Checkout | `/opt/bodour`, owned by that account, not group/world-writable; approved commit detached and clean |
| State | Volumes `bodour_db-data`, `bodour_seaweedfs-data`, `bodour_certbot-conf`, `bodour_certbot-www` on persistent storage — same names every tier (Owner, 2026-09-20) |
| Network | One approved public IPv4; domain has exactly that A result, no unverified AAAA; admitted: SSH, TCP 80/443, **7881/tcp, 7882/udp** — nothing else |
| Time | NTP-synced; host UTC, containers `Africa/Casablanca` (TD-11). **Host `tzdata` kept current by unattended upgrades; `/usr/share/zoneinfo` mounted read-only into `api` and `db`** (R167 §2) — an image's copy is frozen at build. Verified after every deployment: `GET /api/v1/clock` answers `"source":"host-zoneinfo"` with the host offset (`TZ=Africa/Casablanca date +%z`) |
| Secrets | `.env`, `infra.env` and any Docker credential file: regular, deployment-user-owned, mode `0600` |

- Engine is capability-checked (local Linux/AMD64, reachable, persistent, enabled at boot, resolves the exact release model), not version-pinned; rootless Docker unsupported by the volume-backup/reboot contract.
- Preflight: fresh host = none of the four volumes (also needs bootstrap Super Admin email and sex); upgrade = all four (may omit them); partial set stops for recovery review.
- Every tier uses the [B1 object store](../architecture/storage.md#b1-candidate-verification-checkpoint) (Owner, 2026-09-20). Preflight refuses a legacy `bodour_minio-data` volume: no cross-vendor migration — remove it explicitly first. Restore only same-vendor raw volumes; logical recovery name stays `minio-data` (Compose labels). Keep `volume.nocopy`, or scaffolding makes a fresh restore target non-empty.
- `docker` group is **root-equivalent**: deployment account only; its SSH key is a host-root credential; never expose the Docker API over TCP.
- Production needs DNS control (Let's Encrypt), Google OAuth credentials, GHCR read. Temporary B8 decision: [encrypted same-VPS backups](recovery.md) for the first months, no total-VPS-loss protection; second location deferred. Quotation: [provider matrix](provider-acceptance.md).
- Engineering recommends a 50-GiB floor (warn at 60 GiB) for the planned ~200-GB disk — **not approved**, not a substitute for the SRS recording/week estimate; pass the Owner-approved whole-GiB floor to preflight, never as a code default.

## One-time host provisioning

Complete Docker's [official Ubuntu installation](https://docs.docker.com/engine/install/ubuntu/) first (`docker.io` and legacy `docker-compose` are outside the contract), then:

```bash
# As the provider-created sudo account; replace the SSH public key and port if required.
sudo apt update && sudo apt full-upgrade
sudo apt install ca-certificates curl git dnsutils openssh-server openssl python3 unattended-upgrades ufw
sudo adduser --disabled-password --gecos '' bodour-deploy
sudo usermod -aG docker bodour-deploy
sudo install -d -o bodour-deploy -g bodour-deploy -m 0750 /opt/bodour
sudo install -d -o bodour-deploy -g bodour-deploy -m 0700 /home/bodour-deploy/.ssh
sudoedit /home/bodour-deploy/.ssh/authorized_keys
sudo chown bodour-deploy:bodour-deploy /home/bodour-deploy/.ssh/authorized_keys
sudo chmod 0600 /home/bodour-deploy/.ssh/authorized_keys
sudo install -d -m 0755 /etc/ssh/sshd_config.d
sudoedit /etc/ssh/sshd_config.d/60-bodour.conf
sudoedit /etc/sudoers.d/60-bodour-preflight
sudo chmod 0440 /etc/sudoers.d/60-bodour-preflight
sudo visudo -cf /etc/sudoers.d/60-bodour-preflight
```

- SSH drop-in: public keys on, `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`; `sudo sshd -t`, open a **second** key session as `bodour-deploy`, only then close the provisioning session.
- Sudoers file, exactly (`sshd -T` reads root-only host keys — keep them root-only; preflight uses `sudo -n`, so a missing/interactive grant fails before any mutation):

```sudoers
bodour-deploy ALL=(root) NOPASSWD: /usr/sbin/sshd -T -C *
```

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow <ssh-port>/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 7881/tcp   # online-class media, TCP fallback (SRS R164)
sudo ufw allow 7882/udp   # online-class media, the one multiplexed UDP port
sudo ufw enable
sudo systemctl enable --now docker containerd ssh ufw systemd-timesyncd apt-daily-upgrade.timer
sudo dpkg-reconfigure --priority=low unattended-upgrades
sudo timedatectl set-timezone Etc/UTC
sudo timedatectl set-ntp true
# R164: media server wants a 5 MB UDP buffer; kernel default (~200-400 KB) drops packets.
printf 'net.core.rmem_max=5000000\nnet.core.wmem_max=5000000\n' | sudo tee /etc/sysctl.d/60-bodour-media.conf
sudo sysctl --system
```

- Reboot when `/var/run/reboot-required` exists; preflight refuses to deploy across a pending reboot.
- Docker-published ports bypass UFW; CI and preflight check the structural fact: **exactly four published ports — Nginx 80/443, media 7881/tcp and 7882/udp** (R164). Signalling (7880) is proxied as `/rtc`, never published; PostgreSQL, object store, Redis, recorder get no host binding. Provider firewall must admit the same set; no console or Docker socket.
- Container logs: 10 MB × 5 per service (`local` driver). Journal: `/etc/systemd/journald.conf.d/60-bodour.conf` with `SystemMaxUse=500M`, `SystemKeepFree=2G`, `RuntimeMaxUse=100M`, then `sudo systemctl restart systemd-journald`. Rehearse OS/Docker upgrades on Staging; schedule reboots explicitly.
- Packages are public: preflight accepts an absent credential file and proves read authority via both exact manifests. If private, log in without the token in history or an env file; never create an empty `auths` entry; preflight refuses unsafe credential-file ownership/mode:

```bash
read -rsp 'GHCR read token: ' GHCR_TOKEN && printf '\n'
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username '<github-user>' --password-stdin
unset GHCR_TOKEN
chmod 600 "$HOME/.docker/config.json"
```

## The pipeline

```bash
# 1  Exact approved commit. First deploy clones; upgrade keeps checkout + gitignored files.
if test -d /opt/bodour/.git; then
  cd /opt/bodour
else
  git clone <repo> /opt/bodour
  cd /opt/bodour
fi
export BODOUR_RELEASE_TAG='<approved 40-character commit>'
printf '%s\n' "$BODOUR_RELEASE_TAG" | grep -Eq '^[0-9a-f]{40}$'
git fetch origin
git cat-file -e "${BODOUR_RELEASE_TAG}^{commit}"
test "$(git rev-parse "${BODOUR_RELEASE_TAG}^{commit}")" = "$BODOUR_RELEASE_TAG"
git switch --detach "$BODOUR_RELEASE_TAG"
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$BODOUR_RELEASE_TAG"

# 2  Configure. First deploy: fill every Required value (normally install completed
#    files from the secret handoff). Never overwrite existing secrets on upgrade.
#    Postgres password must match DATABASE_URL. R115 Owner email/sex only before
#    the singleton exists.
test -f .env || install -m 600 .env.example .env
test -f infra.env || install -m 600 infra.env.example infra.env
chmod 600 .env infra.env

# 3  Prove host/config/release boundary without changing runtime state.
export DEPLOYMENT_TIER=production                 # or staging
export DOMAIN=bodouralamal.com                    # staging.bodouralamal.com for Staging
export EXPECTED_PUBLIC_IPV4='<provider-approved-public-ipv4>'
export MINIMUM_FREE_GIB='<Owner-approved-primary-disk-floor>'
bash scripts/deploy/preflight-host.sh "$DEPLOYMENT_TIER" "$DOMAIN" "$EXPECTED_PUBLIC_IPV4" "$MINIMUM_FREE_GIB"

# 4  Pull exact artifacts; missing image = stop. minio-init uses the exact API image;
#    docker-compose.yml defines the one SeaweedFS model every tier shares.
docker compose -f docker-compose.yml -f docker-compose.release.yml \
  -f docker-compose.production.yml pull api nginx minio minio-init livekit livekit-egress redis
test "$(docker image inspect --format '{{ index .Config.Labels \"org.opencontainers.image.revision\" }}' \
  "ghcr.io/safaeelmessoussi/bodouralamal-api:$BODOUR_RELEASE_TAG")" = "$BODOUR_RELEASE_TAG"
test "$(docker image inspect --format '{{ index .Config.Labels \"org.opencontainers.image.revision\" }}' \
  "ghcr.io/safaeelmessoussi/bodouralamal-web:$BODOUR_RELEASE_TAG")" = "$BODOUR_RELEASE_TAG"
#    Below the disk floor? Usually OLD RELEASE IMAGES (~1.1 GB each). Keep the
#    running release and its predecessor, remove the rest. Never lower the floor:
#      docker images --format '{{.Repository}}:{{.Tag}}' | grep bodouralamal-
#      docker rmi ghcr.io/safaeelmessoussi/bodouralamal-{api,web}:<old-commit>

# 4b Existing deployment with online classes: NEVER restart the recorder under a
#    class (R167 §5) — the capture is lost. Exit 0 = nothing recording; exit 3
#    names what is: wait, ask again. Skip on first deploy or a pre-R167 release.
#    As one script over `ssh host 'bash -s' <<EOF`, give every `exec -T`/`run`
#    its own `</dev/null` or it swallows the rest of the script.
docker compose -f docker-compose.yml -f docker-compose.release.yml \
  -f docker-compose.production.yml exec -T api npm run --silent ops:active-recordings

# 5  Existing deployment: stop the legacy cookie issuer (R101's migration
#    invalidates every refresh session), then start data services.
docker compose -f docker-compose.yml -f docker-compose.release.yml \
  -f docker-compose.production.yml stop nginx api
docker compose -f docker-compose.yml -f docker-compose.release.yml \
  -f docker-compose.production.yml up --no-build -d --wait db minio
#    Bucket bootstrap: refuses unexpected policies/versioning/lifecycle/retention.
docker compose -f docker-compose.yml -f docker-compose.release.yml \
  -f docker-compose.production.yml run --rm --no-deps minio-init

# 6  Migrate. EXISTING DEPLOYMENT: pg_dump IMMEDIATELY BEFORE this line — it is
#    the rollback point. The normalized-email migration aborts if one address
#    maps to two Users: follow the migration runbook; never clear/merge an identity.
docker compose -f docker-compose.yml -f docker-compose.release.yml \
  -f docker-compose.production.yml \
  run --rm api npx prisma migrate deploy

# 7  Seed — idempotent, safe to re-run
docker compose -f docker-compose.yml -f docker-compose.release.yml \
  -f docker-compose.production.yml \
  run --rm api npm run seed:production

# 8  Start the rest
docker compose -f docker-compose.yml -f docker-compose.release.yml \
  -f docker-compose.production.yml \
  --profile production up --no-build -d      # api, nginx, certbot
#    FIRST DEPLOYMENT ONLY: live ACME certificate.
docker compose -f docker-compose.yml -f docker-compose.release.yml \
  -f docker-compose.production.yml \
  run --rm --entrypoint certbot certbot certonly \
  --webroot -w /var/www/certbot -d <domain>
#    Every deployment: reconcile the ignored host-specific TLS block.
bash scripts/deploy/enable-tls.sh <domain> production

# 9  Verify. Any non-200 (a truthful 503 included) stops verification.
curl --fail-with-body --silent --show-error --max-time 15 https://<domain>/healthz
#    Media stack (R164; outside /healthz): three healthy containers, recorder
#    accepting the CPU budget, signalling through the edge (401 = token-less
#    request refused; index.html = route missing).
docker compose -f docker-compose.yml -f docker-compose.release.yml \
  -f docker-compose.production.yml ps livekit livekit-egress redis
docker compose -f docker-compose.yml -f docker-compose.release.yml \
  -f docker-compose.production.yml logs livekit-egress | grep -E 'cpu available|not enough cpu'
test "$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 15 https://<domain>/rtc/validate)" = 401

# 10 Super Admin's first Google login binds to the pre-provisioned account
# 11 Smoke test: journey J1 · backup dry run · restore drill
```

## Where the images come from

- Built in [CI](../development/ci-cd.md), never on the server (frontend build peaks ~**2 GB**; container memory pins assume no build competes). After all seven jobs pass on `develop`, two GHCR images are published under **only the exact 40-character commit**, labelled `org.opencontainers.image.revision`; no `latest`, no deployment credential in CI.
- `docker-compose.release.yml` (mandatory) refuses an absent `BODOUR_RELEASE_TAG`; exactly one tier overlay joins it. Always `--no-build`; missing image or mismatched label = hard stop.
- Web image = static Vite output, same-origin paths, no `import.meta.env`; one artifact for every environment.

## Migrate: the dump is the rollback point

- `pg_dump` **immediately before** `prisma migrate deploy`; forward-only, no down-migrations; rollback = restore that dump, so it must match pre-migration state exactly.
- Every migration is rehearsed on Staging at ceiling-scale fixtures first; long `ALTER`s must be known beforehand.
- R101 signs everyone out once: with the legacy API stopped, the migration marks live refresh rows `cookie_path_migration` and writes system `auth.token_revoked` audit rows before the new `/api/v1/auth` cookie Path issues. Never restart the old API after it; never start the new API before step 6. Recorded in `_prisma_migrations`, so re-running `migrate deploy` is safe; running the SQL by hand is not a procedure. Step 8 is the first point that issues the new cookie.

### The R124 migration has a mandatory preflight, and it is three counts

`20260904090000_r124_assessment_builder` **drops two `jsonb` columns and writes a value no old column proves** ([audit](../architecture/database.md#the-r124-legacy-mapping)). **Run against production BEFORE `prisma migrate deploy`; stop if any is non-zero:**

```sql
-- 1. Paper authored via direct SQL (v1 cannot hold the old correctIndex/maxPointsBp).
SELECT count(*) FROM exam
 WHERE questions IS NOT NULL AND questions::text NOT IN ('[]', '{}', 'null');
-- 2. Submitted answer (no submission endpoint has ever existed).
SELECT count(*) FROM student_exam_submission;
-- 3. Online exam (the service refused mode = 'online' from R58 until R124).
SELECT count(*) FROM exam WHERE mode = 'online';
```

- **All expected `0`**; otherwise **do not migrate** — what to keep is an Owner decision. A non-empty `questions` is snapshotted into `Trash` with the usual **90-day `purge_after`**: safety net, not retention.
- Every pre-existing `exam` row gets `status = 'published'`: `is_published` was never read or written (verified by search); every `exam.status` reader is in `assessment.service.ts` scoped `mode = 'online'`, so the value is inert for physical sittings, and `published` cannot hide an arranged sitting.
- `target_kind` re-encodes R58's real fact: `administrative_group_id` `NULL → level`, `NOT NULL → administrative_group`.
- [Database § migrations](../architecture/database.md#migrations).

## Rollback

```bash
docker compose -f docker-compose.yml -f docker-compose.release.yml \
  -f docker-compose.production.yml down
# restore the latest complete recovery point per the runbook
```

- No down-migration path, by policy. The [recovery-point runbook](runbooks.md#creating-and-restoring-a-full-recovery-point) restores only into empty volumes and leaves services stopped for configuration verification.
- The dress rehearsal executes this boundary on the full Production-mode graph (write after a point → destroy both data volumes → restore → start exact image IDs, no migration/seed). The VPS must repeat it with its own object store and remote Moroccan repository; local timing is not RTO evidence.

## TLS

- Certbot: `production` profile, webroot challenge, 12-hour loop; HTTP block serves ACME, redirects everything else.
- **Renewal failure alerts at 21 days remaining.**
- A written certificate is not a served one: Nginx keeps the old one in memory, so the `nginx` service runs a six-hour `nginx -s reload` loop, inside the 30-day renewal window.

## What the seed does, and does not do

**Does** (idempotently):
- Roles: super admin, admin, teacher, student, parent — **seeded, not user-manageable**; no role CRUD exists or will be built.
- Categories: المرأة / اليافعات / الطفل, in that display order.
- Levels, **each Category's own named sequence**: وميض/نور/ضياء/بريق/شعاع/سراج/نجمات الأمل (المرأة); نسيم/عبير/أريج/شذى الأمل + المستوى 5 + مسك الأمل (اليافعات); كتاكيت/براعم/أشبال/أجيال/سواعد/أبطال/نجوم الأمل plus an explicit **المستوى 0** (الطفل). Not comparable across Categories, unequal lengths: **no logic may assume a level 0**; every screen shows `{Category} — {Level}` (UX rule D).
- Levels carry **real sex restrictions**, not a blanket permissive value.
- Subject baseline: أحكام القرآن, حفظ القرآن, ترتيل وتجويد القرآن, تفسير القرآن, فقه, السيرة النبوية, العقيدة, الأذكار. القرآن الكريم is not a row, محو الأمية is not seeded fresh, only حفظ القرآن has `tracks_quran_progress` (R107–R108). Additive: Super-Admin additions and historical Subjects survive reruns.
- Academic year (exactly one current); all **114 Surahs** from a verified static dataset; settings defaults incl. grading scale; the Super Admin **only while no active one exists**.

**Does not** (enforced): **branches, rooms, groups, rosters are never seeded into production** — admin UI from real data. Development fixtures carry two real branch premises for the local landing page.

### Reconciling an already-initialized installation

- Seeders lay a baseline **once** (`seed.initialized.*` markers); rows then belong to the Super Admin, so a canonical-list change does not reach an initialized installation.
- `backend/scripts/reconcile-reference-data.ts` does: read-only analysis → prove semantic identity → **normalize in place** → keep id and relationships → never create a near-duplicate → **skip only the ambiguous row and report it**. Idempotent, never deletes an Owner row; restores الطفل's المستوى 0 **by id**. Rooms matched **through the Branch row by id**, never by position; still no seeded branches/rooms in production.
- Never part of deploy:

```bash
docker compose -f docker-compose.yml -f docker-compose.release.yml \
  -f docker-compose.production.yml \
  run --rm api npx tsx scripts/reconcile-reference-data.ts
```

## First deployment versus subsequent ones

| | First | Subsequent |
|---|---|---|
| `SUPER_ADMIN_EMAIL` | **Required as exactly `safae.elmessoussi@gmail.com`** (R115); seed refuses any other | Ignored once the Platform Owner singleton exists; cannot reclaim a transfer |
| `SUPER_ADMIN_SEX` | **Required as exactly `female`** (R115) | Ignored |
| `pg_dump` before migrating | Not applicable | **Mandatory** |
| Restore drill | **Before go-live** | Periodically |

## Staging

[Environments](environments.md); Vercel Preview is retired (Owner, 2026-09-13). Staging (`https://staging.bodouralamal.com`) runs **this same pipeline** with two differences:

| | Staging | Production |
|---|---|---|
| Data | Synthetic fixtures plus exactly the R115 Platform Owner identity for OAuth UAT | Real data |
| `NODE_ENV` | `development` — permits the fixture seed | `production` |
| Everything else | identical | identical |

- `NODE_ENV=development` changes **no** security behaviour ([Environments](environments.md#node_env-does-not-change-security-behaviour)).
- Replace `-f docker-compose.production.yml` with `-f docker-compose.staging.yml` everywhere — the **only** substitution; never combine tier overlays; no storage overlay exists (Owner, 2026-09-20).
- `npm run seed:fixtures` followed step 6 until 2026-09-23 (R172 §10): the Owner withdrew fixtures from Staging (`npm run ops:remove-fixtures` renamed the two fixture branches and rooms through the platform's own deletion doors); a fixture-populated Staging is re-created only on an empty database.
- **Never copy a development database or its objects into Staging.** The pre-provisioned Owner identity authorises no other real person or record there.

| File | What it is |
|---|---|
| `docker-compose.release.yml` | Selects the exact CI artifacts; absent tag = configuration error |
| `docker-compose.production.yml` | Forces `NODE_ENV=production`; no storage content |
| `docker-compose.staging.yml` | Fixture-permitting tier value (R104) + hard memory ceilings; publishes no port, relaxes no limit, changes no security setting |
| `scripts/deploy/enable-tls.sh` | Writes only the ignored host TLS block, refuses before the certificate exists or on an absent/mismatched tag, recreates Nginx through the exact-release + tier overlays; cannot swap the web image for a host build. Release HTTP always serves ACME and redirects; Local Dev substitutes HTTP only via `docker-compose.dev.yml` |

```bash
BODOUR_RELEASE_TAG="$(git rev-parse HEAD)" \
  docker compose -f docker-compose.yml -f docker-compose.release.yml \
  -f docker-compose.staging.yml --profile production up --no-build -d
bash scripts/deploy/enable-tls.sh <domain> staging     # Staging host
bash scripts/deploy/enable-tls.sh <domain> production  # Production host
```

## The dress rehearsal

```bash
bash scripts/deploy/verify-production-bootstrap.sh
```

- Unique Compose project, synthetic one-day certificate; real migration + Production seed run twice; clean-inventory assertion; real TLS/Nginx config; anonymous real-browser drive of public/login routes (Google-only boundary, public reads, CSP cleanliness, auth throttling; no faked identity); storage loss must fail `/healthz` and Docker health; restarts checked against exact-HEAD image IDs; final encrypted recovery point → mutate → destroy both volumes → restore → exact release, state, migration history and health must return.
- Builds local images (uncommitted candidates); gates hosted CI before GHCR publication. Passing is not a deployment claim.
- Before launch: full pipeline **on the production VPS itself**, then UAT with the branch coordinator including a **staff-assisted Google-account registration drill** with a real low-digital-literacy beneficiary — the check on [Risk R-1](../overview/scope-and-roadmap.md#open-risks): **escalate rather than launch** if it surfaces a large excluded population.

## Deployment checklist

- [ ] Pipeline runs clean from a clean VPS to a green health check
- [ ] Fixtures-only rule respected outside Morocco
- [ ] Hand-written migration SQL present in the history (CI-checked)
- [ ] `db push` appears in no script (CI-checked)
- [ ] Backup job runs, and a **restore drill completes inside the RTO target**
- [ ] Per-IP rate limits active at Nginx
- [ ] Per-user upload quota enforced, proven by exhausting it
- [ ] Same-origin routing serves client, API, and storage under one domain
- [ ] R101 deployment only: old API stopped before migration; users warned that sessions will end
- [ ] Signed PUT/GET round trip passes **through the proxy**
- [ ] No PII in logs (audit complete; TD-8 identity-email contradiction awaits the Document Owner)

---

**Next:** [Observability](observability.md) · **Related:** [Environments](environments.md), [Resilience](resilience.md), [Runbooks](runbooks.md)
