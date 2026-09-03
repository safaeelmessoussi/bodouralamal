[Documentation](../README.md) › [Operations](README.md) › **Deployment**

# Deployment

A deterministic pipeline from a clean VPS to a healthy platform. Eleven steps, in order.

## Supported host contract

The release images are currently built on Linux/AMD64, so the supported clean host is
deliberately narrow:

| Concern | Required state |
|---|---|
| OS | Ubuntu Server **22.04 LTS or 24.04 LTS**, x86_64/AMD64; no derivative distribution |
| Capacity | At least 4 GB RAM, swap present, and an **Owner-approved free-disk floor** on the filesystem holding Docker's data root |
| Runtime | Docker Engine from Docker's official Ubuntu repository, local rootful system daemon enabled at boot; Docker Compose **2.24.4 or newer** |
| Operator | One dedicated non-root deployment account, SSH public-key access only, member of `docker`, with non-interactive root authority for the read-only `/usr/sbin/sshd -T -C …` preflight inspection; no shared login |
| Checkout | `/opt/bodour`, owned by that account, not group/world-writable; approved commit checked out detached and clean |
| State | Docker named volumes `bodour_db-data`, `bodour_minio-data`, `bodour_certbot-conf`, `bodour_certbot-www` on persistent host storage |
| Network | One approved public IPv4; the environment domain has exactly that A result and no unverified AAAA; only SSH and TCP 80/443 admitted externally |
| Time | Host clock NTP-synchronized. Host timezone is UTC; containers retain `Africa/Casablanca` for TD-11 wall-clock semantics |
| Secrets | `.env` and `infra.env` are regular, deployment-user-owned mode-`0600` files; an optional Docker credential file is held to the same rule |

Compose 2.24.4 is the floor because repository verification overlays use the documented
`!override` merge tag introduced in that release. Newer Compose v2/v5 keeps the same command.
The Engine itself is capability-checked rather than assigned an invented historical version:
the daemon must be local Linux/AMD64, reachable by the deployment account, persistent, enabled
at boot, and able to resolve the exact release model. Rootless Docker is not supported by the
current volume-backup/reboot contract.

Preflight distinguishes a fresh host (none of the four named volumes exists) from an upgrade
(all four exist). A partial set is neither and stops for recovery review. On a fresh host it
also requires the bootstrap Super Admin email and sex; an upgrade may omit those seed-only
values once the database is authoritative.

The `docker` group is **root-equivalent**. Restrict it to the deployment account and treat that
account's SSH key as a host-root credential. Do not expose the Docker API over TCP.

Production additionally requires a second Moroccan location for offsite backups, domain/DNS
control for Let's Encrypt, Google OAuth credentials, and read access to the repository's GHCR
packages. Use the single [Moroccan-provider evidence matrix](provider-acceptance.md) for the host,
storage and backup quotation. Engineering recommends a 50-GiB deployment floor for the planned
~200-GB disk, with a warning at 60 GiB, but that is not approved and does not replace the SRS's
recording/week and average-size estimate. Select and pass the Owner-approved whole-GiB floor to
preflight; never turn the recommendation into a convenient code default.

## One-time host provisioning

Provision the single-purpose host before cloning. First complete Docker's
[official Ubuntu installation](https://docs.docker.com/engine/install/ubuntu/) so the Compose
plugin and Engine come from one maintained channel; distribution `docker.io` and legacy
`docker-compose` are outside this contract. Then run:

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

The SSH drop-in must enable public keys and set `PermitRootLogin no`,
`PasswordAuthentication no`, and `KbdInteractiveAuthentication no`. Validate with
`sudo sshd -t`, open a **second** key-authenticated session as `bodour-deploy`, and only then
close the provisioning session. Never disable the only working access path. The sudoers file
contains exactly this command grant:

```sudoers
bodour-deploy ALL=(root) NOPASSWD: /usr/sbin/sshd -T -C *
```

`sshd -T` only renders effective policy, but it must read root-only host keys and included
configuration to do so. Keep those files root-only; do not make them readable to satisfy
preflight. The deployment account is already root-equivalent through its required Docker-group
membership, but the explicit command remains narrow and auditable. Preflight uses `sudo -n`, so
a missing or interactive grant fails before any runtime mutation.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow <ssh-port>/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo systemctl enable --now docker containerd ssh ufw systemd-timesyncd apt-daily-upgrade.timer
sudo dpkg-reconfigure --priority=low unattended-upgrades
sudo timedatectl set-timezone Etc/UTC
sudo timedatectl set-ntp true
```

Reboot after the initial upgrade when `/var/run/reboot-required` exists, then reconnect as
`bodour-deploy`; preflight refuses to deploy across a pending kernel/system reboot.

Docker-published ports bypass ordinary UFW forwarding rules. The release therefore relies on
the stronger structural fact checked in CI and again by host preflight: **only Nginx publishes
ports, and only 80/443**. PostgreSQL and object storage never receive a host binding. Verify the
provider's network firewall independently with the same three admitted ports; do not expose a
management console or Docker socket.

Container stdout/stderr is already bounded per service at 10 MB × 5 through Docker's `local`
driver. Bound the host journal as well in `/etc/systemd/journald.conf.d/60-bodour.conf` with
`SystemMaxUse=500M`, `SystemKeepFree=2G`, and `RuntimeMaxUse=100M`, then run
`sudo systemctl restart systemd-journald`. Security updates may install automatically; rehearse
Docker/OS upgrades on Staging and schedule reboots explicitly rather than allowing an
unobserved Production restart.

The current exact-release packages are public, so preflight accepts an absent Docker credential
file and proves read authority by inspecting both exact manifests. If package visibility later
becomes private, authenticate the deployment account to GHCR without placing the token in shell
history or an environment file:

```bash
read -rsp 'GHCR read token: ' GHCR_TOKEN && printf '\n'
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username '<github-user>' --password-stdin
unset GHCR_TOKEN
chmod 600 "$HOME/.docker/config.json"
```

Never create an empty `auths` entry merely to satisfy preflight: it conveys no authority. The
exact API and web manifest probes are the authoritative check for both public and private package
visibility; if credentials exist, preflight independently refuses unsafe ownership or mode.

## The pipeline

```bash
# 1  Check out the exact commit already approved for this environment.
#    First deployment creates the checkout; an upgrade preserves it and every
#    gitignored host file.
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

# 2  Configure. On a first deployment these commands create private templates;
#    normally install completed files from the external secret handoff instead.
test -f .env || install -m 600 .env.example .env
test -f infra.env || install -m 600 infra.env.example infra.env
chmod 600 .env infra.env
#    On first deploy, fill every Required value. Never overwrite existing secrets
#    from a template during an upgrade. The Postgres password must match DATABASE_URL.
#    Exact R115 Platform Owner email/sex are needed only before the singleton exists

# 3  Prove the host/config/release boundary without changing runtime state.
export DEPLOYMENT_TIER=production                 # or staging
export DOMAIN=bodouralamal.com                    # staging.bodouralamal.com for Staging
export EXPECTED_PUBLIC_IPV4='<provider-approved-public-ipv4>'
export MINIMUM_FREE_GIB='<Owner-approved-primary-disk-floor>'
bash scripts/deploy/preflight-host.sh "$DEPLOYMENT_TIER" "$DOMAIN" "$EXPECTED_PUBLIC_IPV4" "$MINIMUM_FREE_GIB"

# 4  Pull the two exact-commit artifacts. A missing image stops deployment.
docker compose -f docker-compose.yml -f docker-compose.release.yml \
  -f docker-compose.production.yml pull api nginx
test "$(docker image inspect --format '{{ index .Config.Labels \"org.opencontainers.image.revision\" }}' \
  "ghcr.io/safaeelmessoussi/bodouralamal-api:$BODOUR_RELEASE_TAG")" = "$BODOUR_RELEASE_TAG"
test "$(docker image inspect --format '{{ index .Config.Labels \"org.opencontainers.image.revision\" }}' \
  "ghcr.io/safaeelmessoussi/bodouralamal-web:$BODOUR_RELEASE_TAG")" = "$BODOUR_RELEASE_TAG"

# 5  Existing deployment: stop the legacy cookie issuer, then start data services
#    R101's next migration invalidates every live refresh session. The old API
#    must not mint another narrow-path cookie after that one-time sweep.
docker compose -f docker-compose.yml -f docker-compose.release.yml \
  -f docker-compose.production.yml stop nginx api
docker compose -f docker-compose.yml -f docker-compose.release.yml \
  -f docker-compose.production.yml up --no-build -d db minio

# 6  Migrate
#    ON AN EXISTING DEPLOYMENT: pg_dump IMMEDIATELY BEFORE this line.
#    Migrations are forward-only; this dump is the rollback point.
#    The normalized-email migration deliberately aborts if historical data
#    already assigns one address to two Users. Follow the migration runbook;
#    never clear or merge an identity merely to make deploy green.
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

#    FIRST DEPLOYMENT ONLY: issue the certificate through the live ACME path.
docker compose -f docker-compose.yml -f docker-compose.release.yml \
  -f docker-compose.production.yml \
  run --rm --entrypoint certbot certbot certonly \
  --webroot -w /var/www/certbot -d <domain>

#    Every deployment: generate/reconcile the ignored host-specific TLS block.
bash scripts/deploy/enable-tls.sh <domain> production

# 9  Verify
curl --fail-with-body --silent --show-error --max-time 15 https://<domain>/healthz
#    Any non-200 response, including a truthful 503 from a dependency/worker
#    failure, stops the deployment verification instead of looking successful.

# 10 The Super Admin performs their first Google login
#    (the identity binds to the pre-provisioned account)

# 11 Smoke test: journey J1 · backup dry run · restore drill
```

## Where the images come from

API and web images are built in CI and pulled, never built on the server:

> The frontend build peaks near **2 GB**, which will OOM or thrash a 4 GB box already running
> PostgreSQL, MinIO, and Node.

This is also why the container memory pins have any headroom at all — the budget assumes no
build ever competes with the running services.

After all six verification jobs pass on a push to `develop`, [CI](../development/ci-cd.md)
publishes two GHCR images under **only the exact 40-character source commit**. Each carries
the same value in `org.opencontainers.image.revision`. There is no mutable `latest` tag and
no deployment credential in CI.

`docker-compose.release.yml` is the mandatory shared release overlay. It refuses an absent
`BODOUR_RELEASE_TAG` and selects both exact artifacts. The deployment also selects exactly
one tier overlay: `docker-compose.production.yml` forces `NODE_ENV=production`, while
`docker-compose.staging.yml` forces the fixture-permitting `development` value plus its
resource ceilings. Deployment always passes `--no-build`. A missing image or mismatched
revision label is a hard stop. Building on the host is not a fallback.

The web image contains the static Vite output. The client uses same-origin API and storage
paths and no `import.meta.env`, so one artifact is valid for every environment; nothing
environment-specific is baked into it.

## Step 5 deserves its own paragraph

**Take the `pg_dump` immediately before `prisma migrate deploy`, not the night before.**

Migrations are forward-only in production. Down-migrations are never written and never run.
Rollback means **restoring that dump**, so it must match the pre-migration state exactly —
a dump from twelve hours earlier rolls back the migration *and* twelve hours of real work.

Before it reaches production, every migration has already been **rehearsed against a staging
database seeded to ceiling-scale fixtures**. Duration matters: an `ALTER` that rewrites a
million audit rows must be known about beforehand, not discovered during a deploy window.

The Revision-101 deployment intentionally signs everybody out once. With the legacy API
already stopped, its migration marks every live refresh row `cookie_path_migration` and
writes system `auth.token_revoked` audit rows before the new `/api/v1/auth` cookie Path is
issued. Users authenticate again after the deployment. Do not restart the old API after this
migration: it would be able to mint a narrow-path credential after the invalidation boundary.
Do not start the new API before step 5 either: the data migration intentionally selects every
live row visible at that point. Prisma records it in `_prisma_migrations`, so repeating
`migrate deploy` is safe and does not sweep sessions issued after cutover; executing the raw
SQL manually is not an operating procedure. Step 7 is the only point that may begin issuing
the new cookie.

### The R124 migration has a mandatory preflight, and it is three counts

`20260904090000_r124_assessment_builder` **drops two `jsonb` columns and writes a
value that no old column proves**. It was audited clause by clause on 2026-09-04;
the audit is recorded in [Database § the R124 legacy mapping](../architecture/database.md#the-r124-legacy-mapping),
and this is the operational half of it.

**Run these three against production BEFORE `prisma migrate deploy`, and stop if
any is non-zero:**

```sql
-- 1. A paper somebody authored through direct SQL. v1 has no representation for
--    the old blob's `correctIndex`/`maxPointsBp`, so migrating it would either
--    discard the marking key or invent a shape the builder cannot edit.
SELECT count(*) FROM exam
 WHERE questions IS NOT NULL AND questions::text NOT IN ('[]', '{}', 'null');

-- 2. An answer somebody submitted. No submission endpoint has ever existed, so a
--    row here is an artefact — and it is a beneficiary's answer, which must not
--    be dropped on an assumption.
SELECT count(*) FROM student_exam_submission;

-- 3. An online exam. The service refused `mode = 'online'` from R58 until R124,
--    so a row here was written around the application.
SELECT count(*) FROM exam WHERE mode = 'online';
```

**All three are expected to be `0`.** If any is not, **do not migrate** — the
rows are evidence of something the application did not do, and what to keep is
an Owner decision, not an operator's. The migration does snapshot a non-empty
`questions` value into `Trash` before dropping it, but that snapshot carries a
**90-day `purge_after`** like every other, so it is a safety net and never a
retention plan.

**What the migration writes that no old column proves.** Every pre-existing
`exam` row is set `status = 'published'`. `is_published` existed but **no
application code ever wrote or read it** (verified by search, not assumed), so
there was no better fact to consult. The value is **inert for a physical
sitting**: every reader of `exam.status` is in `assessment.service.ts` and every
one of them is scoped `mode = 'online'`. `published` was chosen because it is the
reading that cannot hide an arranged sitting if a future feature ever does read
the column without scoping to the mode — the conservative direction.

`target_kind`, by contrast, **is** derived from a real old fact: R58 stored the
narrower sitting as a non-null `administrative_group_id` and read `NULL` as *the
whole Level*. `NULL → level`, `NOT NULL → administrative_group` re-encodes that
inference exactly. Nothing is fabricated.

> [Database § migrations](../architecture/database.md#migrations)

## Rollback

```bash
docker compose -f docker-compose.yml -f docker-compose.release.yml \
  -f docker-compose.production.yml down
# restore the latest complete recovery point per the runbook
```

Migrations are forward-only. There is no down-migration path, by policy.
The [recovery-point runbook](runbooks.md#creating-and-restoring-a-full-recovery-point) restores
only into empty volumes and leaves services stopped for configuration verification.
The repository dress rehearsal below executes this rollback boundary against the complete
Production-mode graph: it writes state after a recovery point, destroys both disposable data
volumes, restores the earlier point, and starts the exact proved image IDs without invoking a
migration or seed. The target VPS must repeat it against its supported object store and remote
Moroccan repository; fixture-scale local timing is not Production RTO evidence.

## TLS

Certbot runs under a `production` compose profile, renewing via the webroot challenge on a
12-hour loop. The HTTP server block keeps serving the ACME challenge and redirects
everything else to TLS.

**Renewal failure alerts at 21 days remaining** — never discovered as a browser error by a
user.

**Certbot writing a new certificate is not the same as serving it.** Nginx holds the
certificate in memory and keeps serving the old one until it reloads, so a renewal loop on
its own produces a current file on disk behind an expired certificate on the wire — a
failure that looks like certbot's and is not. The `nginx` service therefore runs a six-hour
`nginx -s reload` loop beside its worker, well inside the 30-day renewal window.

## What the seed does, and does not do

**Does** (idempotently, safe to re-run):

- Roles: super admin, admin, teacher, student, parent — **seeded here and not
  user-manageable**; no role CRUD exists or is to be built
- Categories: المرأة / اليافعات / الطفل, in that display order
- Levels: **each Category's own named sequence** — وميض/نور/ضياء/بريق/شعاع/سراج/نجمات
  الأمل for المرأة, نسيم/عبير/أريج/شذى الأمل + المستوى 5 + مسك الأمل for اليافعات,
  كتاكيت/براعم/أشبال/أجيال/سواعد/أبطال/نجوم الأمل for الطفل, which additionally
  carries an explicit **المستوى 0**. The names are not comparable across
  Categories and the sequences are not the same length, which is why
  **no logic may assume a Category has a level 0** and why every screen shows
  `{Category} — {Level}` (UX rule D).
- Levels carry **real sex restrictions** rather than a blanket permissive value — which is
  what makes availability a fact a query can read
- Initial atomic Subject baseline: أحكام القرآن, حفظ القرآن, ترتيل وتجويد القرآن,
  تفسير القرآن, فقه, السيرة النبوية, العقيدة, الأذكار. The broad Quran domain
  القرآن الكريم is not a row, محو الأمية is not seeded on a fresh deployment,
  and only حفظ القرآن carries `tracks_quran_progress` (SRS R107–R108). This is
  additive reference data, not a closed list: later Super-Admin additions and
  historical Subjects survive every rerun unchanged.
- The academic year, with exactly one marked current
- All **114 Surahs** from a verified static dataset in the repository
- Settings defaults, including the grading scale
- The Super Admin, **only while no active one exists**

**Does not**, and this is enforced:

> **Branches, rooms, groups, and rosters are never seeded into production.** They are entered
> through the admin UI from real data. **Seeding fake branches into production is
> prohibited.**

Development fixtures do carry two real branch premises so the landing page renders against
realistic data locally — which is exactly the split that keeps production clean.

### Reconciling an already-initialized installation

The seeders above lay a baseline **once** and then never touch those tables again
(each records a `seed.initialized.*` marker), because after initialization the rows
belong to the Super Admin: a rerun must not recreate something intentionally deleted
or undo an Owner edit. That is deliberate, and it means a **change to the canonical
list does not reach an installation that is already initialized.**

`backend/scripts/reconcile-reference-data.ts` is the deliberate, one-command pass that
does reach it. It follows the protocol already approved for the Subjects:

> read-only analysis → prove semantic identity → **normalize in place** → preserve the
> id and every relationship → never create a near-duplicate beside the historical row →
> **skip only the ambiguous row and report it**, rather than stopping the whole batch.

It is idempotent, it never deletes an Owner row, and the one row it restores
(الطفل's المستوى 0) it restores **by id** — an un-delete of that specific row, not a
resurrection by name that would leave a second one beside the historical row.

Run it explicitly with the same release overlay; it is never part of deploy:

```bash
docker compose -f docker-compose.yml -f docker-compose.release.yml \
  -f docker-compose.production.yml \
  run --rm api npx tsx scripts/reconcile-reference-data.ts
```

Rooms are reconciled for the branches that exist, **matched through the Branch row by
id** — never by position, which would attach a branch's rooms to whichever branch
happened to sort first. Production still gets no seeded branches or rooms.

## First deployment versus subsequent ones

| | First | Subsequent |
|---|---|---|
| `SUPER_ADMIN_EMAIL` | **Required as exactly `safae.elmessoussi@gmail.com`** — the seed refuses any other initial owner (R115) | Ignored permanently once the Platform Owner singleton exists; cannot reclaim a transfer |
| `SUPER_ADMIN_SEX` | **Required as exactly `female`** for the approved initial Owner (R115) | Ignored once ownership exists |
| `pg_dump` before migrating | Not applicable | **Mandatory** |
| Restore drill | **Before go-live** | Periodically |

## Preview and Staging

Two different environments since [SRS Revision 104](../SRS.md); see
[Environments](environments.md).

**Preview** — pushing to `develop` triggers an automatic Vercel build of the frontend, in a
**fixture-pointing configuration only**. It calls no real backend.

**Staging** — a real, full-stack, production-shaped deployment on its own VPS, currently
`https://staging.bodouralamal.com`. It runs **this same pipeline**, with two differences and
no others:

| | Staging | Production |
|---|---|---|
| Data | Synthetic fixtures plus exactly the R115-authorised Platform Owner identity for controlled OAuth UAT | Real data |
| `NODE_ENV` | `development` — the value that *permits* the fixture seed | `production` |
| Everything else | identical | identical |

`NODE_ENV=development` changes **no** security behaviour — see
[Environments § `NODE_ENV`](environments.md#node_env-does-not-change-security-behaviour).
For every Compose command in the pipeline, replace `-f docker-compose.production.yml` with
`-f docker-compose.staging.yml`; never combine the two tier overlays. Step 6 is then followed
by `npm run seed:fixtures`, which is the only added operation.

**Never copy a development database or its storage objects into Staging.** A developer's
database is not fixture data. The exact Owner staff identity is pre-provisioned by the
production seed; it does not authorise any other real person or record on Staging.

Four committed pieces make release hosts reproducible from Git, and none holds a secret:

| File | What it is |
|---|---|
| `docker-compose.release.yml` | Selects the exact CI-published API and web artifacts; an absent commit tag is a configuration error |
| `docker-compose.production.yml` | Forces the Production runtime tier instead of trusting `.env.example`'s safe Development default |
| `docker-compose.staging.yml` | Selects the fixture-permitting tier value required by Revision 104 and adds hard container memory ceilings for a small VPS. It publishes no port, relaxes no limit and substitutes no security setting; `NODE_ENV` controls only the three Revision-104 behaviours named above |
| `scripts/deploy/enable-tls.sh` | Generates only the ignored host-specific TLS block, refuses to run before the certificate exists, and recreates Nginx through the same exact-release plus environment overlays; the committed release HTTP block already preserves ACME and redirects everything else |

```bash
BODOUR_RELEASE_TAG="$(git rev-parse HEAD)" \
  docker compose -f docker-compose.yml -f docker-compose.release.yml \
  -f docker-compose.staging.yml --profile production up --no-build -d
```

`scripts/deploy/enable-tls.sh` exists because activation was manual and un-rerunnable.
Release HTTP now always serves ACME and redirects every other request to HTTPS; Local
Development substitutes its HTTP application server only through `docker-compose.dev.yml`.
The script therefore writes no tracked file. Activating the TLS block **before** the
certificate exists is still a hard config error, so the script checks first. Invoke it with
the environment tier while the pipeline's `BODOUR_RELEASE_TAG` remains exported:

```bash
bash scripts/deploy/enable-tls.sh <domain> staging     # Staging host
bash scripts/deploy/enable-tls.sh <domain> production  # Production host
```

It refuses an absent/mismatched commit tag and retains the Staging resource overlay where
applicable; TLS activation cannot silently replace the approved web image with a host build.

## The dress rehearsal

Before a host is involved, run the repository-side Production-mode boundary:

```bash
bash scripts/deploy/verify-production-bootstrap.sh
```

It owns a unique Compose project and synthetic one-day certificate, runs the real migration and
Production seed commands twice, asserts the clean initial inventory, loads the actual TLS/Nginx
configuration, drives the built public/login routes in a real anonymous browser, and proves that
storage loss makes both `/healthz` and Docker health fail before recovering. The browser verifies
the Google-only boundary, public reads, CSP/runtime cleanliness and real Production auth throttling;
it does not fake an authenticated identity. Both local candidate images carry the exact repository
HEAD label, and every restart/recreation is checked against their image IDs. The final phase creates
an encrypted recovery point from that running graph, mutates PostgreSQL and object state, destroys
both volumes, restores into empty replacements, and requires the exact release, pre-change state,
migration history and whole-application health to return. It deliberately builds local images so
it can test an uncommitted candidate; the same drill gates hosted CI before exact-commit GHCR
publication. Passing it is not a deployment claim and does not replace the authenticated,
Moroccan-target, realistic-volume or host checks below.

Before launch, the full pipeline runs **on the production VPS itself**, because the staging
topology exercises none of the VPS realities — memory ceilings, TLS automation, the backup
pipeline. It is followed by user-acceptance testing with the branch coordinator, including a
**staff-assisted Google-account registration drill** with a real low-digital-literacy
beneficiary.

That drill is not a formality. It is the check on
[Risk R-1](../overview/scope-and-roadmap.md#open-risks), and the standing instruction is to
**escalate rather than launch** if it surfaces a large excluded population.

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
- [ ] No PII in logs (engineering audit complete; TD-8 identity-email contradiction awaits the
      Document Owner before this launch checkbox can close)

---

**Next:** [Observability](observability.md) · **Related:**
[Environments](environments.md), [Resilience](resilience.md), [Runbooks](runbooks.md)
