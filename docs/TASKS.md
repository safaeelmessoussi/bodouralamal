# Tasks — بذور الأمل Platform

## HIGH continuation — 2026-09-13 (H1–H6 CLOSED locally; committed, not pushed)

- [x] Preserve `develop` at `45cf1f063d14073feb04ee190817535f011fe2db`
  (six ahead, zero behind); B1–B8 acceptance remains unchanged. No push or live actions.
- [x] Review inherited H1/H2/H4/H5 fixes and correct existing-grade fixtures to
  supply the current TD-15 version. Stale/missing versions remain conflicts.
- [x] Implement H6 retag safeguarding under Session→Content locks, including
  first-link graph growth and same-transaction failure rollback; add regressions.
- [x] Rerun corrected exam/grade suites and new exact-Session/seasonal cases:
  **245/245** (5 skipped). Verification found and fixed one real H2 gap —
  `publishOccurrenceTx`'s publish-time re-check used the branch-only subset of
  authorization instead of the full per-arm `assertMayAuthor` rule, wrongly
  refusing a Teacher's own exact-Session/Teaching-Group/student target that had
  just been authorized moments earlier at scheduling. See the
  [checkpoint](development/testing.md#high-readiness-checkpoint-2026-09-13) for
  the exact root cause and fix, and a second, same-shaped fixture gap found and
  corrected outside the nine-suite set (`notification-targets.http.integration.test.ts`).
- [x] Ran H6 and affected B4/B5 storage/lifecycle regressions, then final
  integration/isolation gates and independent disposable-resource cleanup inventory.
  Full suite: **2,549 passed / 18 skipped, 0 failed**; browser **193/193**; Docker
  inventory confirms no disposable resources remain.
- [x] Final verified local commit made after all required gates passed green,
  including a rerun of every gate touched by the two additional corrections above.
  Lint, exact typecheck, build, units/guards, TD-3 and **OpenAPI currency** (now
  passing; the earlier sandbox blocker did not recur) are tracked in the
  [verification checkpoint](development/testing.md#high-readiness-checkpoint-2026-09-13).
- [x] **H3 CLOSED (Owner decision 2026-09-13, SRS Revision 142).** A manual
  remote exam is opened explicitly through `POST /assessments/{id}/open` by an
  already-authorized teacher or administrator, never by the scheduled start
  time on its own. No new state or migration: sets the existing
  `Exam.available_from` (R136 clause 5) once, under the same governing lock
  and re-read H5 established, through `assertMayAuthor` unchanged (H2) — never
  its branch-only subset. One-way and non-idempotent, matching
  `POST /assessments/{id}/close`'s own established convention: repeating it,
  or calling it on a `draft`/`closed`/`physical` row, is refused
  `409 STATE_CONFLICT`/`INVALID_TRANSITION`. The frontend gains one «فتح
  الاختبار» action on `/admin/assessments`, confirmed and state-gated exactly
  like «إغلاق الاختبار», the backend the sole authority. The service test
  that previously simulated opening with a direct `prisma.exam.update` now
  calls the real action; 13 new focused integration tests cover Admin/whole-
  Level/exact-Session teacher authority (and its non-expansion), R91 date-
  bounded authority, wrong branch, unauthorized roles/student, non-remote/
  non-published/already-open refusal, concurrency, the audit event, and
  before/after student availability. Full suite after the fix:
  **2,563 passed / 18 skipped, 0 failed**; browser **193/193**; TD-3
  **227/235** (same eight pending, zero undocumented); OpenAPI regenerated and
  current. See the [checkpoint](development/testing.md#high-readiness-checkpoint-2026-09-13).
- **HIGH continuation (H1–H6) is now fully closed locally.** Latest Owner scope
  was HIGH completion; earlier uncommitted privacy, configuration and
  release-checklist drafts remain preserved, not extended or accepted. Do not
  begin the next section from this alone; no claim that the whole programme
  is release-ready.
- [x] **Pushed H1–H6/H3, then hosted CI green.** `develop`/`origin/develop`
  equal at `4e43697`. First hosted run (`34774455994`, SHA `3171a47`) failed
  two jobs on a real Docker Compose version incompatibility (`extends:` and an
  `!override`-tagged map, unrelated to product code) — diagnosed empirically
  against the exact runner Compose release, fixed narrowly (`4e43697`), and
  hosted CI re-ran fully green (`34776047322`).

## Production-readiness documentation reconciliation — 2026-09-13

- [x] **Vercel/Preview retired (Owner decision).** SRS Revision 143 records the
  three-tier topology (Local Development, Staging, Production); no
  `vercel.json` or Vercel config existed to remove. Retired Preview-specific
  language from `docs/operations/environments.md`, `deployment.md` and
  `docs/development/ci-cd.md`. Exact Owner action to stop automatic Vercel
  builds recorded in [environments.md](operations/environments.md#vercel-retirement--owner-action-required);
  not performed here (external, requires separate authorization).
- [x] **CNDP/privacy package reconciled** against HEAD `4e43697` in
  `docs/compliance/personal-data-audit.md`: relabeled every requirement with
  the exact `VERIFIED FROM REPOSITORY` / `OWNER INPUT REQUIRED` /
  `PROVIDER EVIDENCE REQUIRED` / `LEGAL/CNDP CONFIRMATION REQUIRED` /
  `MUST COMPLETE BEFORE PRODUCTION` taxonomy (the prior pass used only
  `OWNER INPUT REQUIRED` for some genuinely provider- or legal-owned items);
  added H3 to the educational-administration annex row; re-verified all four
  CNDP source citations live (200 OK, 2026-09-13) and confirmed the exact form
  codes (F211/F214/F112/F113/F118/F115) directly from the primary source;
  added a seven-item shortest Owner/legal/provider closing checklist. No form
  is selected, no filing is made, no legal conclusion is asserted.
- [x] **Configuration inventory completed**: added a secret-by-secret
  rotation/installation-at-a-glance table to `docs/operations/configuration.md`
  covering every required secret's generation, restart requirement, and
  installation boundary; cross-referenced the known TD-14/TD-16 monitoring/
  alert gap from `observability.md` rather than restating it.
- [x] **Release/rollback checklist finished** in
  `docs/operations/deployment-readiness.md`: expanded the acceptance step into
  a named fixture-only smoke-test list (auth, scoping, attendance, exams
  including H3's manual opening, grades, materials, safeguarding, workers,
  backup), added explicit rollback-trigger criteria (app-only vs.
  database/object restore, exact ordering, go/no-go authority), and added a
  new after-launch step (immediate/first-day/first-week checks, incident
  escalation).
- [x] **Concrete Compose-order defect found and fixed in documentation**:
  `docs/operations/recovery.md`'s restore command and the entire
  `docs/operations/deployment.md` pipeline (11 invocations) omitted the
  now-required explicit `docker-compose.storage.yml` file, reproducing in
  prose the exact bug `4e43697` fixed in scripts. Corrected every occurrence
  to the verified order (`docker-compose.yml` → `docker-compose.release.yml`
  → `docker-compose.storage.yml` → `docker-compose.production.yml`); no
  script changed, since the scripts themselves were already correct.
- [x] Documentation links (1,094), the release/host-preflight/backup/
  storage-lifecycle/env-not-committed guards, and `git diff --check` all pass
  on the changed documentation. No backend/frontend/integration suite was
  rerun — no source code changed this pass, and hosted CI on `4e43697`
  already proved that evidence green.

## B8 — same-VPS backup/recovery (local engineering acceptance complete)

- Owner decision (2026-09-12): encrypted backups may stay on the same Production VPS
  for the first couple of months. No new provider; no claim of recovery from total
  disk/VPS/provider loss. R133 monthly/max-two policy remains. [Runbook](operations/recovery.md).
- [x] Preserve B1 commit `d9c25e6a0e7f993d4308012fa7bbfa60c5c0f85f` and inherited
  backup edits; no push, deployment or Owner/live-data operations.
- [x] Project/repository/image-pinned exact restore; full-data verification before
  scoped rotation; explicit disk floor; host serialization and durable failure state.
- [x] Root host timer templates and aggregate backup/disk/worker/retirement checks.
  H7 unsafe latest selection and H8 host-level visibility addressed here; no dashboard
  endpoint/job-catalog invention. TD-7 execution wording and TD-14/TD-16 dashboard
  surface remain Document Owner work, not silently represented as implemented.
- [x] Focused metadata/monitor **12/12** and real PostgreSQL/SeaweedFS encrypted
  recovery/negative-safety drill pass (**150 seconds**).
- [x] Frozen-source Production-mode recovery/operator drill passes: **96/96**
  migrations, repeat seed, browser **15/15**, exact-image restart/recreate/rollback,
  healthy aggregate probes and unknown-copy alert despite healthy workers/no job.
  An initial private-directory fixture error was corrected without weakening the guard;
  a later concurrent help-text edit interrupted Bash, so only the final hash-matched
  exit-zero run is accepted. No source changed during that final run.
- [x] All **30** repository guards, systemd template validation, bounded utility
  timeout/cleanup, final scope/privacy review, docs links and diff checks pass.
  Disposable containers/volumes/networks/images/processes and temporary recovery
  directories are gone; existing localhost resources remain untouched.
- B8 is **CLOSED for the Owner-approved temporary local-engineering boundary**,
  not full disaster recovery or Production approval. One local commit only.
  Real-host installation, key escrow, disk-floor selection, attended alerts and
  realistic-size restore remain operational prerequisites. No push/deployment.

## B1 — maintained object store (local engineering acceptance complete)

- [x] Recover clean `99a4d3552f96c28da19d529201e302284f5bb94f`; preserve
  B2–B7 local acceptance. No push, live data, Staging or Production operations.
- [x] Select SeaweedFS 4.46 from current official release/security evidence;
  [pin and selection](architecture/storage.md#b1-candidate-verification-checkpoint).
  Separate physical volume; legacy Local/Staging MinIO configuration unchanged.
- [x] Real Nginx compatibility exposed SDK signing of CRC32(empty) before the
  browser body exists. Public-origin presigning now uses `WHEN_REQUIRED`;
  internal checksums, single-attempt COPY and full SHA-256 verification unchanged.
  New deterministic unit assertion passes **1/1**.
- [x] Replace the vendor-specific truncated-stream expectation with both exact
  refusal paths; retain publication/staging assertions and prove successful
  full-byte retry. Explicit transport failure exposed an unobserved SDK checksum
  rejection; the internal client now observes, but does not replace or resolve,
  that rejecting promise. Final focused **108/108**, browser **193/193**, clean isolation.
- [x] Production Compose/preflight, repeat initialization, restart/recreate and
  encrypted recovery-point rollback pass. Resolve physical volume names through
  the existing helper; prevent image scaffold copy-up with `nocopy` rather than
  weakening the empty-restore-target rule. Lifecycle **5/5**; B4/B5 winner,
  late-copy, ambiguous-delete and durable-obligation coverage retained.
- [x] Final exact-code full disposable gate: **2,536 passed / 18 skipped / zero
  failures**, **112 files passed / two skipped**, **433.40 seconds**, browser
  **193/193**, all-table isolation clean, fresh **96/96** migrations and both seeds.
  Lint/typecheck/build, **342/342** units and all **30 non-link guards** pass.
  [Detailed compatibility/recovery evidence](development/testing.md#b1-seaweedfs-compatibility-and-recovery).
- [x] Final scope/security review, shell/Node syntax, diff and documentation-link
  checks pass (**1,046/1,046**). Independent Docker/process inventory confirms
  no disposable project resources remain; pre-existing volumes are untouched.
- [x] Complete B1 locally before any B8/HIGH/CNDP/release work. No push,
  deployment, Owner-data or live-infrastructure changes. Future populated
  MinIO migration and real-host provisioning require separate authorization;
  this local engineering acceptance is not Production approval.

## B4/B5/B6 — storage retirement and Event authorization (local acceptance complete)

- [x] Close unique visibility-placement adoption/rollback and durable exact-key
  retirement together, preserving B2/B3/B7. No parallel cleanup mechanism.
- [x] Reject the complete unauthorized Event scope; preserve R139 explicit
  all-permitted-branches and R71/R72 Teacher group/responsibility boundaries.
- [x] Focused real-stack regressions, populated migration proof, full final gates,
  clean isolation and final diff review before one local commit. No push or live
  data/infrastructure changes; B1/B8 and unrelated HIGH findings remain separate.
- Earlier interrupted run recovered: **2,531 passed / 18 skipped**, 112 passing
  files / two skipped, browser **193/193**, all-table isolation clean. Current
  runtime sources then predated that run. The later narrow correction invalidates
  it for final acceptance. See [evidence](development/testing.md#b4b5b6-storage-retirement-and-event-scope-2026-09-12).
- [x] Reproduce the late-copy ordering before fixing it: absent cleanup falsely
  completed the intent while the delayed COPY was still held. `copy_settled`,
  single-attempt placement COPY and durable positive settlement now retain unknown
  outcomes, retire late bytes and protect a fresh winner without a grace timer.
  Targeted **77/77**, then affected batch **193/193** (eight suites), both
  isolation-clean with browser **193/193**. Lifecycle **5/5**, updated populated
  **95→96**, lint/typecheck/build, **341/341** units and 30 non-link guards pass.
- [x] Final exact-code full run: **2,534 passed / 18 skipped / zero failed**,
  **112 files passed / two skipped**, **299.42 seconds**, browser **193/193**,
  all-table isolation clean, fresh **96/96** migrations and both seeds. Recovered
  exit-zero result reused after matching runtime/source hashes; no redundant sweep.
- [x] Final review and independent Docker inventory: no disposable containers,
  project volumes/networks/images or test processes remain. Existing anonymous
  volumes all predate this batch and were untouched. Documentation links
  **1,038/1,038**, shell/Node syntax and diff checks pass. B4, B5 and B6 are
  **CLOSED for local engineering acceptance**, not operational rollout.
- Earlier command-approval exhaustion is resolved; no workaround was used.
  One new local commit only, no push/live rollout. Existing B2/B3/B7 acceptance
  remains intact; B1/B8 and unrelated HIGH findings remain outside this batch.

## R141 — B7 rejection-audit follow-up (2026-09-11; local acceptance complete)

- [x] Owner resolved the R132/TD-8 conflict: self-managed rejection audit is
  structural only; human rationale stays on the claim until authorized erasure.
  The exception for historical audit copies removes only rejection-reason fields,
  preserving rows and all other permitted evidence. No general audit-edit path.
- [x] Reproduced the missed case on disposable data: **7/8** lifecycle assertions
  passed; the identifying rejection marker survived in audit detail after erasure.
  Prior B7 acceptance below is superseded by this additional closure requirement.
- [x] Focused disposable verification: **140/140**, eight suites, all-table
  isolation clean. Covers the identifying-reason lifecycle and exact historical
  SQL migration, including idempotency, attribution, unchanged claim rationale
  and unrelated-row preservation. Fresh **95/95** migrations and both seeds pass.
- [x] Final full disposable integration: **2,514 passed / 17 skipped**, 111 files
  passed / two skipped, all-table isolation clean; real-edge browser **193/193**.
  Lint, exact typecheck, backend units **341/341**, build, all 30 non-link guards,
  **1,031/1,031** documentation links and final diff checks pass. B7's identifying
  free-text regression now closes the local engineering gap; real-host migration
  remains pending. One new local commit only; no push/deployment. See
  [R141 evidence](development/testing.md#r141-self-managed-rejection-audit-follow-up).
- B2 remains closed and B3 technically closed. The stale readiness entry now
  distinguishes its settled keyed-HMAC design from outstanding real-key
  provisioning and stopped-writer rollout. No Owner/Localhost/Staging/Production
  data mutation is authorized by this code-and-disposable-verification task.

## B2 + B3 + B7 recovery — 2026-09-11 (local engineering acceptance complete)

- [x] Close only the inherited batch above `a4174b1102fb38e7aa889287700d7201099accb8`;
  preserve its unrelated fixes. B2 binds automatic User erasure to the exact
  observed Trash generation and enforces the restore deadline under the User lock.
  B3 implements the [ratified keyed lock](development/email-lock-keying.md), keeping
  digest rows and removing post-commit plaintext retirement. B7 minimizes claim
  credentials/snapshots while preserving approved self-management authority.
- [x] Fresh and representative populated disposable migration,
  barrier-controlled deletion/restore/re-delete races, claim lifecycle/races,
  ownership/re-registration integration and all-table isolation passed. The existing
  migration was corrected during inherited recovery, not duplicated; the final
  continuation required no further migration edits. Before the final repository move,
  focused **159/159**,
  strengthened cross-lifecycle **8/8**, each isolation-clean; fresh **94/94** migrations.
  [Populated rehearsal](../scripts/test/verify-deletion-upgrade.mjs): 11 Users,
  10 claim states, two recovery windows, preserved ownership/family/audit/Trash,
  valid HMAC locking and preserved approved authority. Both changed Prisma models
  match; no new schema divergence against the committed pre-batch baseline.
- [x] Rerun affected disposable suites and full integration after the final B7
  repository correction. First full run: **2,512 passed / 1 failed / 17 skipped**,
  plus **193/193** real-edge browser checks. The unchanged ordinary-read guard
  found the erasure-only claim enumeration in `account-deletion.service.ts`.
  `users.minimizeSelfManagedClaimIdentity(tx, ...)` now owns that exact data access
  within the existing User-locked transaction, including deleted claims. The guard
  itself is unchanged. The current-code ten-suite retry passes **220/220**,
  including **8/8** lifecycle cases and the ordinary-read guard; all-table isolation
  is clean. Final current-code full run: **2,513 passed / 17 skipped**, 110 files
  passed / two skipped, all-table isolation clean; required real-edge browser
  checks **193/193**. Fresh **94/94** migrations and both seeds passed again.
  No further implementation, schema, migration or guard edits were necessary.
- Final current-code gates: backend units **341/341** (39 files), lint, exact
  typecheck, Prisma format/validate/generate, build, all 30 non-link repository
  guards, **1,029/1,029** documentation links (120 files), shell/Node syntax and
  diff checks passed. OpenAPI is unchanged (175 paths / 226 operations); TD-3
  remains 226/234 with eight pending and zero undocumented endpoints. Earlier stale test
  adaptations and upgrade-fixture failures, followed by their passing retries,
  are recorded in [testing](development/testing.md#b2b3b7-account-lifecycle-acceptance-2026-09-11)
  and CHANGES; no gate was weakened.
- The earlier execution-allowance rejection is resolved for this continuation;
  the documented retry ran on disposable data only. One new local commit is
  authorized at this green boundary; **no push/deployment**. B2/B3/B7 are closed
  for this bounded local engineering batch, not for operational rollout.
  Real `EMAIL_LOCK_KEY` provisioning and a stopped-writer cutover remain separately
  authorized operational prerequisites; no real environment or secret was changed.
- Separate finding, **record only**: whole-schema comparison reports 26 unrelated
  SQL/Prisma table differences, reproduced byte-for-byte at `a4174b1` before the
  migration. Named indexes, raw-SQL FKs/types and defaults need a separate review;
  this batch introduces none and does not claim globally zero schema drift.
- B1/B4/B5/B6/B8 and HIGH findings remain outside scope. This is not Production approval.

## Repository simplification — 2026-09-08

- [x] Reviewed the inherited removal of seven unreferenced frontend exports:
  `CalendarSurface`, `MenuAction`, `useActionFeedback`, `ListDialog`,
  `NotBuiltYet`, `addYears`, `formatDateNumeric`. Checked imports, dynamic
  entry points, routes, test and script references; no live path or assertion
  removed. Focused frontend: 7 files / 164 assertions; exact typecheck green.
- [x] Kept subprocess fixtures, integration snapshot tooling, live Session
  detail API, all declared dependencies, generated contracts and migrations.
  No equivalent test setup was proven redundant enough to consolidate safely.
- [x] Shorten the existing agent entry path and separate current guidance from
  historical lookup; calendar-prefill reconciliation is recorded separately below.
- [x] Final local gates: backend 331 / frontend 1,074 assertions, both lint/exact
  typecheck/build; disposable integration 2,349 passed / 17 skipped with clean
  isolation and 193 browser assertions; all 31 guard checks and 1,013 doc links.
  Built JS/CSS is byte-identical to the accepted baseline and localhost serves
  those same bytes; root/calendar/resources/health reads return 200.
- Exact hosted CI, including recovery and image publication, is the acceptance
  gate for the two coherent commits. No deployment or Owner-data mutation belongs
  to this milestone; no additional cleanup starts at handoff.

## Calendar/media regression correction — 2026-09-07

- [x] Removed automatic profile-derived narrowing from the public calendar. The
  populated localhost returned 26 anonymous / 61 Owner-authorized occurrences;
  applying profile defaults had caused a second, empty response. Explicit URL
  filters remain reader-controlled and the server still resolves authorization.
- [x] Restored the real seven-column month grid on phones; the Owner rejected the
  previous automatic agenda. Corrected the measured 768 px date collision without
  recreating the removed Session page or duplicating the canonical dialog.
- [x] With explicit Owner approval, refreshed only the stale localhost API image.
  The same public audio changed from mint `401` to `200`, real Range `206` and
  successful anonymous playback. Private, hidden and consent-restricted items
  remained `404`; no storage policy or authorization was broadened.
- [x] Disposable browser proof: **193/193**, including all eight widths
  (320/360/375/390/412/430/768/1280), real session transitions, populated cells,
  exact dialog/deep links and media security. Full disposable integration:
  **2,349 passed / 17 skipped**, with all-table isolation clean. Frontend:
  **1,074** assertions; backend unit: **331**. Lint, exact typecheck and builds pass.
  All 31 guard checks pass (OpenAPI currency via the same read-only generator
  directly inside the sandbox); documentation links: **990/990**.
- [x] The Owner manually verified the repaired populated localhost and confirmed
  it works, satisfying the final local acceptance left pending when automatic
  approval review exhausted its allowance. The unchanged implementation reuses
  the green disposable/full-suite evidence; exact hosted CI is still required
  for the repair commit. The later simplification milestone is not part of this batch.
- [x] Document Owner reconciliation (2026-09-08, R135): Option A ratified in
  SRS §4.4 / TD-3.4 / J6, with a narrow supersession note preserving Revision
  43(12). Public filters stay reader-selected; `prefilled_filters` remains API
  metadata and personal calendars retain their audience scoping. Docs/spec only.
- [x] **Separate follow-up, not settled by R135:** **[Closed 2026-09-21 — fixed, R169 §4 — the content backlink no longer names a cancelled occurrence]** source inspection found that
  `listSessionsForContent` can return a cancelled Session while the calendar
  deep-link day read excludes cancelled Sessions, so a Library backlink may
  resolve as unavailable. Not dynamically reproduced or fixed; review its
  lifecycle/navigation contract independently, without changing retention or visibility.

## Canonical occurrence dialog and public readers — 2026-09-07

- [x] Removed the duplicate frontend Session detail page. Grid chips and table
  titles and Educational Library back-links now open the same complete calendar
  dialog; stable kind/id/date links survive refresh and fail closed when stale.
- [x] Public library media is genuinely readable anonymously through the existing
  exact-coordinate storage boundary. Signed-in readers retain their server-granted
  tier; private/hidden content and private occurrence relationships remain gated.
- [x] The originally delivered automatic phone agenda is superseded by the
  Owner-directed month-grid correction above. Administrative scheduling keeps
  its distinct definition/calendar choice; filters and dialogs remain usable.
- [x] The disposable real-stack browser gate exercises real image, PDF, audio,
  video and download-only Office-document bytes, inline playback,
  anonymous/private authorization, direct occurrence links,
  obsolete-route absence, role-specific private access and horizontal-overflow widths.

## Controlled-UAT corrections — 2026-09-01

- [x] Registration now accepts the real multi-child consent shape: one required
  request-level data-processing decision and one explicit media-release decision per child.
  French names remain optional as a pair for every adult and child; both controls explain
  that rule and server validation identifies the missing counterpart.
- [x] Pending and Rejected registration accounts remain in طلبات الانضمام and are absent
  from ordinary account-management and operational-directory populations. Approval places
  every admitted beneficiary, sets the durable beneficiary fact and grants the structural
  branch-scoped Student role in the same transaction.
- [x] Platform ownership protects only the live global Super Admin assignment. The Owner may
  add, change and remove ordinary functional roles; the main user-form Save includes its
  visible role draft. The existing current-owner-only transfer action remains discoverable
  on eligible active Global Super Admin rows.
- [x] The public calendar sends the current access token when one exists, leaving visibility
  resolution to the server. Students/Parents receive the ratified private tier, staff remain
  scoped, role-less Active accounts fail closed to public, and hidden remains responsible-
  person/Super-Admin only. Day cells pin Hijri to the physical left and Gregorian to the
  physical right without changing either date.
- [x] Removed the user-facing file-replacement action while retaining the internal R53 upload
  primitive. New scheduling items default to المستوى كامل and new staffing rows to مؤطّرة
  مسؤولة; edits preserve stored values. The existing shared dirty-form guard already closes
  pristine forms immediately and confirms only genuine unsaved changes.
- [x] Calendar integration fixtures now own reserved Hijri years and remote Gregorian dates;
  teardown can no longer delete an operator-recorded 1447/1448 catalogue. The all-table
  isolation runner proves the restored local catalogue remains byte-stable.
- [x] **R116 — comprehensive actionable notifications.** The ratified catalogue extends the
  existing caller-owned inbox for registration/approval, family links, roles, ownership,
  enrolment, Session/Event restaffing and physical Exam lifecycle. Exact target FKs,
  transaction-local delivery, actor exclusion, dual-role semantic coexistence, real-transition
  resurfacing and hidden responsible-only withdrawal are enforced. Upload completion stays
  silent because it is storage finalization rather than a publication decision. The postponed
  tier/preference/channel framework and TD-7 job catalogue remain unchanged.
- [x] **R117 — registration/guardian controlled-UAT closure.** Registration-review notices
  open one exact authorized pending request and stale coordinates render safely. Reviewers see
  complete guardian contact/consent data and separate submitted details for every child.
  Sibling Category/Branch requests remain exact into their own placement decisions; a
  children-only guardian is activated without beneficiary/Student/Enrollment state. New
  registration requires phone while legacy null remains valid, Parent lands on the supported
  Student Dashboard, and non-Parent context clears any stored child coordinate. Focused local
  evidence is 41/41 real-browser plus 12/12 exact database assertions.

## Platform Owner and هيئة التأطير framing — R115, 2026-08-31

- [x] Platform ownership is a protected singleton lifecycle relationship, not a new Role.
  Transfer is current-owner-only to another active Global Super Admin; the singleton is locked
  before both Users in deterministic order, and suspension, deletion, permanent
  de-identification and demotion are refused until transfer.
- [x] The fresh bootstrap identity is exactly `safae.elmessoussi@gmail.com`, صفاء المسوسي,
  female, active Global Super Admin, with `both`/all-current-and-future-branches general
  framing and no invented weekly hours or Google provider subject. Once ownership exists,
  seed reruns are ownership no-ops and never reclaim a transfer.
- [x] A هيئة التأطير request records strict planning willingness: online, physical or both;
  physical modes support one, several, or durable future-inclusive all branches. Approval
  displays it, and approved teaching profiles retain the same value read-only. It never
  supplies authority or weekly availability.
- [x] Every weekly availability interval may state its own mode; legacy null remains honestly
  unknown. Candidate appraisal reports incompatibility/unknown as an advisory warning only.
- [ ] **Controlled-UAT Staging promotion:** only after this exact implementation commit passes
  complete hosted CI, take and validate the Staging backup, promote exact images, apply the
  migration/seed, prove exactly one unbound Owner and healthy synthetic-only educational data,
  then stop for the Owner's manual Google login. Production and DNS remain out of scope.

## Local authenticated navigation restored — 2026-08-31

- [x] The development Compose overlay now replaces the release Nginx port list with exactly
  the IPv4 and IPv6 loopback mappings `127.0.0.1:80:80` and `[::1]:80:80`. Local Nginx serves
  HTTP only, so it neither inherits a published but unserved port 443 nor refuses a later
  browser navigation when `localhost` resolves to `::1`. Staging/Production retain the
  release 80/443 topology and all cookie attributes stay unchanged.
- [x] The real Chrome regression now uses the production-shape Secure refresh cookie, clicks
  the rendered لوحة التحكم control, and covers HTTP arrival, Back/Forward, reload, logout,
  re-login, a consumed OAuth callback, a fresh tab and Admin/Super Admin authorization
  (**42/42**), after independently requiring both loopback families to reach the edge. The
  consumed-callback screen remains the intentional standalone auth status layout; it was not
  the transport failure.

## Staging promoted — 2026-08-30 (previous strict-synthetic release)

`https://staging.bodouralamal.com` is deployed and healthy at
`4fd620de2cf182aa8a8342d48641c054ea76002e`. Hosted run `33262358687`, attempt 2,
passed all six verification jobs and published both exact-commit images before promotion.
The real edge then passed the complete 15/15 anonymous browser smoke and a stateless-service
restart. The remaining count-only provenance finding was closed for that release: Staging
passed strict synthetic-only acceptance without changing the deployed release. Revision 115
now authorises one exact Owner identity for controlled UAT, but that later transition does not
retroactively change this evidence and is tracked above.

That deployment evidence belongs to that commit. Later `develop` commits are not thereby accepted on
Staging; current promotion state and blockers live in the
[deployment-readiness ledger](operations/deployment-readiness.md).

**Open items carried forward:**

- [x] **Strict Staging synthetic-only boundary — CLOSED 2026-08-30.** PII-redacted provenance
  evidence classified both untagged OAuth-bound accounts as **B (manually created/personal)**:
  one was the original bootstrap administrator later bound and manually expanded, and the other
  was a self-registered/approved account. Both were permanently de-identified through the exact
  deployed domain service after an owner-only, catalog-validated PostgreSQL backup; dependent
  identity/session credentials and the two unclaimed email synchronization coordinates were
  removed. The two untagged Branch rows are **A (authoritative reference/fixture data)**: every
  committed reference field matches and each has an exact tagged counterpart, so both were
  retained with their fixture relationships. Final count-only acceptance proves 8/8 active
  users match committed fixtures, zero OAuth identities/personal coordinates, 0 non-fixture
  beneficiaries, 0 fixture-email violations, and 4/4 live Branch rows match authoritative
  definitions. Release `4fd620de2cf182aa8a8342d48641c054ea76002e`, 61/61 migrations,
  `/healthz` 9/9 worker readiness, HTTPS, and the 15/15 browser smoke remain green. Production
  was not accessed or changed.

- **Rule AX, remaining instance:** the Content **Recorder** dialog still takes its scope from
  the page filters. Its own slice — R75's recorder has a separate submit path.
- **Rule AX, borderline:** `session-materials-dialog` takes the Session's scope as context and
  does not display it. Owner decision whether *"fixed → disabled, not hidden"* applies.
- **Automated authenticated Staging E2E** — the next bounded engineering task the Owner
  already scoped: it must preserve the real authentication boundary rather than minting
  unauthenticated sessions, which is why `issue-dev-session.ts` still refuses a non-loopback
  database and was never weakened.
- **Housekeeping:** the disposable `bodour_v` database, the stale `bodouralamal-db` container
  on port 5434, and the old `bodouralamal-*` volumes are all retained for a later cleanup task.

## ✅ FIXED — the Content Upload screen had no visibility selector (§14.1)

**Found 2026-08-25 by an Owner performing a real upload on Staging and being unable to mark
it private. Fixed the same day, before Staging acceptance.**

§14.1 specifies the node as:

> **Content Upload (`/teacher/content`)** — … **visibility selection honoring Category
> defaults and the consent gate** (consent-forced private state visible but not editable by
> Teachers; Global scope unavailable to Teachers, §4.9).

The selection does not exist. Everything around it does:

| Layer | State |
|---|---|
| `initiateUpload` | **accepts** `meta.visibility`, falling back to the Category default |
| `UploadMeta` (client type) | **declares** `visibility?: 'public' \| 'private' \| 'hidden'` |
| `content.tsx` | renders visibility as a **read-only column** and never sets it |
| i18n | `content.visibility.public/private/hidden` exist and are used — for the column |
| `docs/openapi.json` | already documented `visibility?` in prose — see the correction below |

So the platform silently always takes the Category default. On the staging fixtures that is
`public` for الكبار, which is why an Owner asking for private content got public content and
no control to change it.

**This is rule P again — a complete capability with no reach — and it is the seventh
instance.** The service, the client type and the copy were all built; the control was not.

> **Correction to the first report of this defect.** It said the OpenAPI document omitted
> `visibility` from `content_meta`. It does not: the `/uploads/initiate` description already
> lists `{ … visibility?, origin?, replaces_content_id? }` and states the Category fallback.
> What is true is that the generator emits **no request-body schema for any operation** —
> bodies are documented in prose throughout, by design, because TD-3 is canonical and OpenAPI
> is a generated artifact. So the contract was **not** incomplete here, and adding a schema
> for this one operation would have introduced a second convention into a document that
> uniformly has none. **No OpenAPI schema change was made.**

### What was built

A `SelectField` on the **upload** dialog only, offering the three tiers through the existing
`content.visibility.*` labels — no new terminology and no new i18n keys.

**The default rides the Level, not the Category, and that is the load-bearing decision.**
`GET /admin/categories` is Admin-only (TD-2 R26, R30) and the content page never requests it,
so resolving the default through a Category list would have returned `null` on every screen
that needs it — *the same defect in a new place*. It now travels on `LevelDto`
(`default_visibility`), which is the very list that offers the Level, so a screen that can
offer a Level can always honour its default. That also mirrors the server:
`categoryDefaultVisibility` is keyed on a **level id**.

Four properties the implementation holds deliberately:

- **Absent is never `public`.** No Level chosen, list not arrived, or a payload predating the
  field all resolve to `null` — the selector waits rather than proposing the open tier. A
  dialog that preselected `public` because a request was slow would publish content by
  accident.
- **A malformed settings row resolves to `private`**, server-side and client-side. Never
  widen on a surprise.
- **Replacement has no selector**, so R53 stays a file swap rather than becoming a
  publication decision; the row's own visibility remains authoritative.
- **`consent_forced_private` is not reachable from this form.** BR-2 owns it, a new upload
  starts `false`, and lifting it is BR-3's separate Admin-with-justification workflow —
  deliberately not this slice.

All three tiers are offered to everyone who can reach the screen, and that is *derived*:
`assertUploadScope` gates the Global/branch scope and nothing else, so §4.9 places no
per-role limit on the tier itself. §14.1's *"not editable by Teachers"* is about the
consent-forced state, which no new upload can be in.

## ✅ FIXED — CI had been red on `develop` since before 2026-08-20

**`prisma generate` never runs in the clean CI jobs.** The `backend` and `API contract` jobs
run `npm ci` → `npm run lint` → `npm run typecheck`, and `src/generated/prisma/**` is
gitignored, so typecheck cannot find the client:

```
TS2307: Cannot find module './generated/prisma/client.js'
```

followed by a cascade of `TS7006` on every parameter whose type came from it. It passes on a
developer machine only because the working tree already holds a generated client, which is
the same shape of blindness that hid the frontend lock-file break: **local green and CI green
were never the same thing, and nobody was comparing them.**

**Fixed 2026-08-25**: `npx prisma generate` now runs after `npm ci` in both the `backend` and
`contract` jobs. It was pulled into the staging slice after all, because the adopted release
flow makes **clean CI on the exact commit a precondition for deploying to Staging** — so
leaving it red would have blocked the very promotion it was recorded beside. Nothing further
was hiding behind it: the run went green on the first attempt.

> Discovered 2026-08-25 during the staging deployment. The other cause of the same red build
> — `frontend/package-lock.json` out of sync so `npm ci` failed on every clean checkout — was
> fixed in that slice because it blocked the deployment build itself.

> **Backend Release-Candidate status (2026-07-29, SRS Revision 33).** M0–M3 are **complete on the backend**:
> every TD-3 endpoint for those milestones is implemented, documented and router-reconciled, and both the
> §18 *Registration, Approvals & Family* and *Scheduling & Calendar* checklists are green. 97 unit + 473
> integration tests, six CI guards, zero contract drift. The only M0–M3 item still open is **frontend**
> (`ChildContextSwitcher`, owned by v0). M4–M8 below are future milestones and are genuinely unstarted.
**Granular implementation checklist. Mutable — agents tick items (`[x]`) as work completes and may split items into sub-items, but never add tasks for post-MVP features (SRS §10.1) and never contradict the SRS. Milestone order: `docs/IMPLEMENTATION_PLAN.md`. Completion log: `docs/CHANGES.log`. SRS references in parentheses are the authority for each item.**

**Status notation.** `[x]` complete · `[ ]` not started · `[~]` **partial — and a partial item always names WHICH dimension is done**, because "partial" alone hides whether the remaining risk is unwritten code or merely an unbuilt screen. Dimensions used:

| Mark | Dimension | Means |
|---|---|---|
| ✓ | Backend implementation | Code exists and runs |
| ✓ | Tests | Automated coverage exists and passes |
| ✓ | Security verification | The SRS security property was exercised, not assumed |
| △ | Frontend integration | Needs the React shell (M2+) |
| △ | Later milestone | Needs an endpoint or component from a named later milestone |


## M0 — Bootstrap
- [x] Monorepo folders per §16.1 (backend/frontend/nginx/docs)
- [x] `/CLAUDE.md`, `/AGENTS.md`, `docs/CHANGES.log` committed (§16.3)
- [x] `.env.example` generated from TD-13 inventory; boot-time fail-fast validation for Required vars
- [x] Version pins per §3.1a (Node 22 LTS image, PG 17, Prisma 6, React 19, Vite 6, Express 5, pg-boss 10)
- [x] CI: all 24 committed guards, lint, exact typecheck, default test runners, backend/frontend production builds, and ordinary OpenAPI↔TD-3 conformance (§3.1). Integration/browser/coverage infrastructure and fatal `TD3_REQUIRE_COMPLETE=1` remain separate slices

## M1 — Infrastructure & Platform Core
- [x] `docker-compose.yml`: api, db, minio, nginx (+certbot); TZ=Africa/Casablanca; tzdata pinned (TD-11)
- [x] Nginx same-origin path routing `/` `/api/v1/` `/storage/` + SSL + rate limits + storage error-page mapping + prefix-strip/Host rewrite + CSP/nosniff + `/storage/` client_max_body_size 110m + proxy_request_buffering off (API 2m) + gzip static (§3.1, TD-13)
- [x] Signed PUT + signed GET round-trip through the /storage proxy passes (§3.1, §18)
- [x] MinIO dual buckets (public/private) + policies (§3.1)
- [x] `schema.prisma` full §7 model incl. `version` columns on TD-15 entities; plain constraints in Prisma
- [x] `RateLimitCounter` entity + unique `(user_id, bucket, window_start)` (§7/TD-6, Revision 14) — added by a forward-only follow-up migration (TD-6b)
- [x] Hand-written SQL migrations via `migrate dev --create-only`: explicit `CREATE COLLATION "ar-x-icu"` registration, column collations, CHECKs (incl. bp score checks), partial unique indexes, cross-table ayah trigger (TD-6, TD-6a)
- [x] Production seed, idempotent (§15.1): roles, categories/levels, R107–R108 extensible eight-Subject baseline with exactly one حفظ القرآن memorisation marker, academic year, 114 Surahs, SystemSetting defaults, Super Admin allow-list (via `pre_provisioned_email`, Revision 15 — no placeholder identity)
- [x] Dev fixtures with `NODE_ENV` guard (§15.2)
- [x] Google OAuth: state+PKCE (flow state in a short-lived signed HttpOnly callback-scoped cookie, TD-12 Revision 16), cryptographically verified Google ID token (RS256/provider key, exact issuer, configured audience, lifetime, subject, verified email), callback branches 4a/4b/4c, first binding guarded by the authoritative User lock/status re-read, onboarding token (10 min, `jti` + ConsumedToken replay guard) (§4.1b, TD-12)
- [x] Step-4a routing complete: Active / Pending / (Rejected|Suspended|deleted_at → deactivated screen), never reactivation (§4.1b, Revision 16)
- [x] Email lowercasing on all identity lookups/writes (TD-12) + DB `CHECK (email = lower(email))` (TD-6)
- [x] Cross-channel normalized-email ownership: registration, staff pre-provisioning,
  first binding and production bootstrap share one collision-free row lock; stale onboarding
  snapshots and concurrent absent claims cannot create two intended accounts. Upgrade backfill
  refuses pre-existing ambiguity rather than choosing a person in migration SQL
- [~] Registration identity extracted solely from onboarding-token payload; body fields excluded from schema (§4.1b, TD-12)
  - ✓ Backend — onboarding token carries the verified `email` + `provider_subject_id`; payload is the sole identity source
  - ✓ Tests — 8 unit tests
  - ✓ Security — a substituted-email token fails signature verification (§20 rule 9)
  - △ Later milestone (M2) — `POST /registrations` and the Zod schema that must not even accept those fields
- [x] Access token via Authorization header only; refresh and logout are the only refresh-cookie consumers, both with the same custom-header + Origin checks; cookie Path `/api/v1/auth` (TD-12, R101)
- [~] High-risk endpoint fresh DB status assertions (presigned mint, social profile, approvals, overrides) (TD-12)
  - ✓ Covered on every surface that exists — approvals (5 assertions), consent overrides (3), social profile, user management, family links: a mid-session suspension or a revoked role assignment loses the capability on the **next call**, on the caller's still-valid token
  - △ *presigned mint* arrives with **M6 (Storage)**; the `/uploads/*` endpoints are not built, so this cannot be green before then
- [x] `RefreshToken` entity + unique `token_hash` + `session_id` chain (§7/TD-6, Revision 16) — forward-only migration
- [x] Session layer: 1 h access JWT, 30 d rotating refresh cookie (HttpOnly/Secure/SameSite=Lax/Path `/api/v1/auth`), hashed-never-raw storage, revocation list (TD-12, R101)
- [x] Rotation / logout / revoke-on-suspension transactions (TD-4.13/14/15); logout revocation + `auth.logout` audit are atomic; refresh/logout/purge serialize on a stable per-`session_id` row; identity binding, final login issuance, switch-role and revoke-all serialize on the User row before session anchors and re-read authoritative state; the explicit User `NO KEY UPDATE` is compatible with implicit child-FK `KEY SHARE`, closing the session→User/User→session deadlock; post-rotation access issuance permits only Active/Pending under its session lock; 10 s grace is idempotent (no chain fork) and cannot resurrect a logged-out chain
- [x] R102 Pending → Rejected closure: the approval transaction holds the User-first → RefreshSession-anchor hierarchy, revokes every live session as `rejection`, and atomically writes `user.reject` plus `auth.token_revoked`; refresh/login races cannot leave a live successor or new session, unrelated users remain independent, and later state changes never resurrect an old credential
- [x] R101 rollout: old API stops first; migration audits and invalidates every live legacy narrow-Path session as `cookie_path_migration`; users reauthenticate
- [x] Token-lifecycle acceptance criteria T1–T14 green (§18, Revisions 16, 101 and 102)
- [x] Pending hard-redirect; zero data access except `GET /me` + logout (TD-1); client-side global Pending route guard (§14.4)
  - ✓ Backend · ✓ Tests · ✓ Security · ✓ Frontend — `PendingGuard` renders the §2.1 status screen before any authenticated route mounts, so no skeleton leaks
- [x] Error envelope middleware + canonical code catalog incl. VERSION_CONFLICT/SERVICE_UNAVAILABLE + i18n message keys (TD-3.8)
- [x] Optimistic-locking helper (conditional UPDATE + version bump) shared across TD-15 entities
  - ✓ Backend — `updateWithVersion` for any TD-15 delegate; distinguishes VERSION_CONFLICT from NOT_FOUND
  - ✓ Tests — exercised live through Branch/Room PATCH
  - ✓ Security — stale version returns 409, never a silent overwrite (§20 rule 12)
- [~] Outbound timeout discipline (5 s, no hidden retries) + degraded-mode 503 handling per TD-16
  - ✓ Backend — 5 s `AbortSignal.timeout` on both outbound calls (Google token exchange, MinIO health); no hidden retries
  - ✓ Tests — exercised through `/healthz` component states
  - ✓ Security — upstream failures leak no detail; they surface as the canonical envelope
  - △ Later milestone (M6) — the full TD-16 matrix needs the storage endpoints that must 503 while MinIO is down
- [x] request_id propagation, JSON logs, no-PII log policy (TD-14)
- [x] `GET /healthz` with truthful dependency and worker-readiness checks (TD-14)
  - ✓ Queue infrastructure is independent from process-local runner readiness; a surviving
    `pgboss` schema cannot make stopped/failed/unregistered workers healthy
  - ✓ Expected workers derive from the actual registration catalog; live pg-boss activity
    detects missing, inactive, and stale workers with an injected-clock test seam
- [~] pg-boss bootstrap + job runner; JobsRepository same-transaction job inserts (§16.2, TD-4); token.purge + ratelimit.purge + audit.purge crons (TD-7)
  - ✓ Backend — runner in the API container; all three crons scheduled in Postgres with the TD-7 retry policy
  - ✓ Tests — all three purges run against the live worker and their effects verified
  - ✓ Security — `audit.purge` allowlist mutation-tested; an equally-ancient security event survived
  - ✓ Backend — `JobsRepository` same-transaction enqueue implemented (§16.2 sanctioned raw SQL); first consumer is the §4.1a consent re-evaluation
- [x] Pool/memory pins: Prisma limit 10, pg-boss ≤5, PG max_connections 30, statement_timeout 10s; shared_buffers/GOMEMLIMIT/max-old-space (TD-13)
- [x] OAuth callback failure redirects (/login?error=…, 4 keys) + OAUTH_EXCHANGE_FAILED + single-flight refresh w/ 10s grace (§4.1b, TD-12)
  - ✓ Backend · ✓ Tests · ✓ Security · ✓ Frontend — all four keys render as i18n messages with a retry affordance; the client shares one in-flight refresh promise so concurrent tabs cannot race each other into a logout
- [x] AuditLog table + write helper (TD-8); auth.login / login_denied / identity_bound / refresh / logout / token_revoked rows
- [x] OpenAPI generation wired; contract = implementation (TD-3) — **enforced against the live Express router**, not merely intended
  - ✓ Reproducible — regeneration is byte-identical to the committed document
  - ✓ CI — a dedicated `contract` job regenerates it and fails on any drift, so the committed file cannot be hand-edited
  - ✓ Gate — the conformance check consumes that regenerated artifact, not a manually-maintained one
  - ✓ Router-reconciled — generation walks the real route stack and fails on any documented-but-unserved or served-but-undocumented operation. This gap was real: a route documented in both the registry and OpenAPI, but never mounted, passed every gate while returning 404.
- [x] Branch/Room CRUD — **reference data: writes Super Admin only, reads Admin (branch-scoped)** (§2.2, §5.6, TD-2 Revision 26)
  - ✓ Backend — 8 routes; Zod validation at the boundary; TD-5 deletion guards under `FOR UPDATE`; TD-4.8 soft-delete + Trash + audit
  - ✓ Tests — verified live: 401 unauthenticated, optimistic locking both ways, TD-5 room-blocks-branch, TD-9 length limit
  - ✓ Tests — 13 integration tests for the R26 permission boundary in both directions; five mutations caught, including reverting writes to Admin and restricting reads to Super Admin
  - ✓ Security — §2.2 display_order refused for a plain Admin **and** allowed when absent; out-of-scope is 404 not 403 (§20 rule 17)
  - ✓ Contract — explicit DTOs (§16.2, Revision 38): allow-list projection, `snake_case`, `operational_start_date` as a TD-11 **date**; the four internal columns no longer exposed. Replaces the raw Prisma rows this task originally shipped
  - ✓ Tests — 10 HTTP tests asserting the **exact key set** of every branch and room response. **There was no HTTP-level test here before**, which is how the contract drifted unnoticed
  - ✓ Frontend integration — the `/admin/branches` screen (§14.2), first consumer of the shared CRUD framework
- [~] §18 Authentication & Onboarding checklist — **backend green**, two items outstanding by milestone/ownership
  - ✓ **`state`, PKCE and Google identity verification tested** — 27 focused unit/controller tests cover verifier entropy and uniqueness, S256 derivation, signed-cookie tamper resistance and purpose separation, authorization URL constraints, code-exchange separation, and the real Google Auth Library path with local RSA keys: valid signature, invalid signature, expiry, exact issuer, configured audience, RS256/key id, required subject/email, `email_verified`, provider-certificate failure and callback refusal before account resolution. No live Google service or decoded fixture token stands in for verification
  - ✓ **§19.2 Pending-session data-access denial now asserted** — the whole guarded surface, **derived from the generated contract** rather than a hand-kept list, so a newly documented route is covered automatically. Suspended and rejected sessions too, with an active-token control. TD-1's two exceptions (`GET /me`, logout) are asserted **reachable**, keeping them decisions rather than holes. Mutation-tested: removing the gate fails 32 cases
  - ✓ **`/auth/refresh` CSRF posture now tested** — the custom header and Origin check were implemented but untested; 8 HTTP tests, and the check is proven to run **before** the cookie is read so a probe cannot learn whether a cookie was valid. Three mutations caught
  - ✓ §4.1b all three routing branches, pre-provisioned binding, `jti` replay → 409, email lowercasing, JWT role scopes, suspension revoking refresh, the Nginx same-origin round-trip, body-email substitution, the auth audit rows, and rejected/suspended/soft-deleted all reaching the deactivated screen
  - △ *client-side Pending route guard (no skeleton leak, §14.4)* — frontend (v0)
  - △ *high-risk endpoints re-assert Active* is green for every endpoint that exists; **presigned mint** arrives with M6

- [x] Client shell: RTL-first Arabic-only (§3.1, §6), i18n keys for every string (§16.2), §14.4 state components, §14.1 public routes only, branding assets
  - ✓ Frontend · ✓ Security — CSP unchanged (`default-src 'self'`, no font/CDN host); access token in memory only, read from the URL fragment and stripped from history (TD-12)
  - △ Later milestone (M2) — authenticated layouts, the account switcher, and the unified registration form

- [x] Branch-scoped authorization model made precise (§4.2, SRS Revision 24)
  - ✓ Backend — `policies/branch-scope.ts`; per-role resolution; `branch_id IS NULL` = all branches; Super Admin bypasses by role
  - ✓ Tests — 15 unit tests; five mutations caught, one per original defect
  - ✓ Security — fixed an all-branches Admin seeing nothing (proved 0 of 2 → 2 of 2 over HTTP) and a cross-role over-grant; `roles[]` derived from scopes so a token cannot self-contradict
  - ⚠ Supersedes OPEN AMBIGUITY 4 — user-list branch scoping should now be decided under this model

- [x] Generic educational stages + sex on the person (§4.4b, §7, §15.1, SRS Revision 27)
  - ✓ Backend — `User.sex` captured at registration inside the TD-4.1 transaction; seeded Levels carry real `gender_restriction`
  - ✓ Migration — DDL plus a data migration renaming categories in place, preserving all 21 Levels (verified before and after); seed re-run leaves 3 categories and 21 levels
  - ✓ Tests — 7 tests; four mutations caught (sex optional, sex as free string, applicant sex dropped, child sex dropped)
  - ✓ Architecture — sex never on Category; availability is which Levels exist, so opening Teen+Male is Super Admin data entry with no code change

- [x] Registration never places a beneficiary (§4.1, §4.1b, SRS Revision 29)
  - ✓ Backend — payload carries person fields and consents only; `personCore` is `.strict()` so placement fields are refused, not silently stripped
  - ✓ Tests — 2 regression tests; the strictness guard is mutation-tested
  - ✓ Architecture — reference data stays behind its own APIs under the R26 permission split; assignment is an administrative action after approval

- [~] Shared component registry: the pieces §14.3 lists that do not exist yet (§14.3, §14.2)
  - ✓ **`DataTable` built** with the first CRUD module (Branches) — columns, row actions, all §14.4 states, TD-10 pagination, wide-table scrolling. **Everything is configuration**: adding an entity means passing different columns, never editing the component. First column is a `<th scope="row">`; empty and no-results are distinct; an inapplicable row action is hidden rather than disabled
  - ✓ **Form field primitives built** — `TextField`, `TextArea`, `DateField`, `NumberField`, `SelectField`, `SearchInput`. Each owns label association (`useId`, so two instances cannot collide — the bug `Dialog` shipped with), `aria-describedby` error and hint wiring, `role="alert"`, and visible **plus** programmatic required marking
  - ✓ **`ConfirmDialog` built**, with TD-8's mandatory justification built in so the field cannot be forgotten on the screen that needs it. **Reason bounds are configurable** (approvals): TD-9 uses 10–1000 for a consent override and 1–500 for a §5.6 rejection, and the consent values stay the defaults, so hard-coding the floor would have made the client refuse what the server accepts (§1.1)
  - ✓ **`danger` added as a Button VARIANT**, not a second component (§2.5)
  - ✓ **`ApprovalCard` built** (§14.3) with the approval queue — bundle-aware, because §4.1 can create a parent, a child and a link, and §5.6 approves all three atomically (TD-4.2); a row showing only "the applicant" would hide two of the three
  - ✓ **`Badge` extracted** on its second use (§2.7) from the inline markup the Hijri screen carried. `VisibilityBadge` and `ConsentStatusBadge` become callers of it, not copies — the concept gets the component, not the entity (§2.1)
  - △ Still to come, each with its first consumer: autocomplete, file upload, checkbox, radio group, `StudentSelector`, `GroupSelector`/`LevelSelector`, `VisibilityBadge`, `ConsentStatusBadge`, `JobStatusIndicator`
  - ✓ Already built and shared: `Button` (variants), `Dialog` (+ `wide`), `Icon`, `Container`/`Section`, `Card`, the §14.4 `states.tsx` set, `BranchSelector` (calendar), `ContentPreviewDialog`
  - ⚠ Governed by [engineering-constitution §2](development/engineering-constitution.md): **one component per concept, never one per entity** — no `StudentTable`/`TeacherTable`; extract on the **second** use, never the third; never modify a copy
- [~] Back-office shell: §14.1 navigation, routing and role gating (§14.1, §14.2, TD-2)
  - ✓ **Module registry** (`lib/admin-modules.ts`) holds §14.1's hierarchy as data; the sidebar, the router and the role guard all read that one list, so a menu entry without a route, a route without a permission, or a module visible to an excluded role are impossible by construction. A test asserts the registry's paths against §14.1
  - ✓ **AdminLayout** — generated sidebar with §14.1's group order, `aria-current` on the open module, the §14.4 no-permission state for a module the session may not open, and the whole back office mounted **inside `PendingGuard`** (a sidebar is exactly the "empty skeleton layout" that guard prevents)
  - ✓ **Blocked modules render a NAMED reason**, in the page and as a sidebar badge — not "coming soon", which tells nobody whether the wait is a day or a milestone
  - ✓ **Path resolution** is longest-match and separator-aware, so a module owns its internal views (`/admin/groups/{id}/roster`) without registering each as a navigation node §14.1 does not list
  - ✓ Dashboard is a **launcher, not a statistics screen** — §5.6's counts have no endpoint, and inventing a number would be worse than omitting one
  - ✓ Tests — 15 registry tests (106 frontend total)
  - △ **6 of 11 modules ready** (dashboard, groups, users, approvals, calendar, branches, Hijri calendar); **5 blocked** on endpoints that do not exist: levels, taxonomy, content (M6), settings
  - ✓ **Superseded 2026-08-05:** schedules, settings, Hijri (M3b-24/R42), and **levels + taxonomy (M3b-29)** are now `ready`. Still blocked: users, calendar, content
  - ✓ **Module 2 — Branches (`/admin/branches`)**: list, create, edit, delete, search, TD-10 pagination. **Writing is Super Admin only** (R26) and the controls are hidden for an Admin, who reads this screen because Group management depends on it — the server enforces the matrix regardless. TD-15 optimistic locking with a named conflict message that reloads rather than overwriting; TD-5's "deletion prohibited while rooms or groups reference it" surfaced as its own reason rather than a generic failure
  - ✓ ~~**Finding — `GET /admin/branches` returns raw Prisma rows**~~ **RESOLVED by SRS Revision 38**: the endpoint now returns an explicit contract DTO and the adapter lost its wire types and its date converter. *Adapters adapt contracts to UI models; they do not repair inconsistent contracts* — the repair had left the contract wrong for the next client and hidden that it was wrong from everyone
  - ✓ **Module 3 — Approvals (`/admin/approvals`, طلبات الانضمام)**: both item types, server-side Type filter, TD-10 pagination, approve (atomic, no reason) and reject (reason required, TD-9 500). Reports `records_updated` — what actually changed, not what was requested; a 404/409 reads as *someone else decided first* and reloads. **Configuration of the framework, not a new one** — `DataTable` and the field primitives were unedited
  - ✓ ~~**§14.2 lists a "Branch" filter this queue cannot have**~~ **RESOLVED by SRS Revision 39**: the Owner corrected the specification, not the screen — §14.2 recorded the real intake and R29 had not. Registration now captures the applicant's chosen branch, the queue shows it, and the filter is built. **It filters, never scopes** — visibility stays unscoped so a branch Admin can still find and correct an applicant whose chosen branch is wrong
  - △ Remaining modules land one by one: groups, calendar/events, users

## M2 — Registration, Approvals, Family
- [x] Unified parent+child registration transaction (TD-4.1) + adult path
  - ✓ Backend — `POST /registrations`; replay guard consumed FIRST so the `jti` is authoritative; both paths in one transaction
  - ✓ Backend — **`branch_id` required and persisted as `User.intended_branch_id`** (Revision 39): validated inside the transaction against a live branch, refused for a soft-deleted one, accepted for a not-yet-opened one, written on the applicant only. Level/Room/Group still rejected outright
  - ✓ Frontend — the §5.5 form: adult **or** parent+child, **الاسم الشخصي + الاسم العائلي (R40)**, required Branch selector, consent with a Law 09-08 explanation in the shared Dialog, three-state media release for a minor. Built entirely from the shared field primitives; `/register` no longer a placeholder
  - ✓ Backend — **R40 name parts stored and `name_arabic` composed server-side**; a client-supplied `name_arabic` is rejected, not ignored (§1.1)
  - ✓ Tests — **`registration.http.integration.test.ts` added (11 tests)**. There had been NO HTTP-level test for registration, which is how a 503 reached a browser as "try again later"
  - ✓ ~~**`legal.consent_text_version` has no production mechanism**~~ **RESOLVED by SRS Revision 42**: Platform Settings (`/superadmin/settings`) now carries it — Super Admin only, validated non-empty, audited with its previous value, TD-15 locked, and affecting future registrations only. **No manual deployment step and no development seed is required in production**; the fixture remains a local convenience only
  - ✓ Frontend — **الاسم الشخصي/العائلي in Arabic AND French (R40, R41)**, both server-composed; French optional as a pair
  - ✓ UX — validation failures name the field: the server's `path` per issue is mapped onto the form's controls, and an issue the form cannot place is surfaced verbatim rather than dropped
  - ✓ Tests — 11 integration tests incl. the §18 mid-transaction atomicity check and concurrent submission of one token
  - ✓ Security — schema **rejects** `email`/`provider_subject_id` outright (§20 rule 9); replay → `STATE_CONFLICT`; fails closed with no consent text version
  - △ Frontend integration (M2) — the unified registration form
- [~] ConsentRecord model + versioned text + staff-recorded method (§4.1a)
  - ✓ Backend — `online_form` consents written in the registration transaction with the active text version from `SystemSetting`
  - ✓ Tests — a declined media release is recorded with actor + timestamp, not omitted (BR-1)
  - ✓ Backend — `staff_recorded` path complete: `GET`/`POST /students/{id}/consents`, Admin/Super Admin only (TD-2), append-only history, BR-1 effective status, §4.1a re-evaluation enqueued in-transaction
  - ✓ Tests — 20 integration tests; six mutations caught
  - ✓ B-01 — `consent.reevaluate` plus the consent-forced public → private bucket migration are durable workers; closure adds R92/deleted-schedule triggers, bounded startup convergence, one globally ordered shared-recording lock graph, exact-key retirement/recovery, retry-policy reconciliation and an exact-row public-origin gate whose external surface is limited to authorized GET/HEAD and SigV4 PUT, with bucket roots and all other S3 methods denied; the Admin override/consent-management UI remains M6
- [x] `POST /family-links` — staff-mediated link of an existing child (§4.3 Revision 23)
  - ✓ Backend — Admin/Super Admin only with the TD-12 freshness assertion; creates a `Pending` link decided in the §5.6 queue; duplicate answers `DUPLICATE`, never `FAMILY_LINK_PENDING`
  - ✓ Tests — 11 service + 6 HTTP tests; five mutations caught, including one reopening parent self-service
  - ✓ Security — there is no parent-facing path to an existing child; a parent caller is refused at the edge, not merely unlinked in the UI
- [~] Staff pre-provisioning UI/flow (bind-on-first-login) (§4.1b 4b, TD-4.10)
  - ✓ Backend — `POST /admin/users`; no placeholder identity (§7); lowercased + TD-6-unique address; role/branch scope in the same transaction
  - ✓ Tests — 13 integration tests incl. the full bind-on-first-login path through the repository the login flow calls; six mutations caught
  - ✓ Security — TD-2 admin-only with TD-12 freshness; only a Super Admin may create another Admin; a soft-deleted person's address is never reclaimed
  - △ Frontend integration — the §14.2 create form
- [x] Super Admin bootstrap semantics (§15.1, SRS Revision 22) — the last open specification ambiguity, resolved
  - ✓ Backend — gate is "an active Super Administrator exists", not "a row matching this email"; ignored permanently afterwards; grants rather than duplicates; activates a matched non-active account; fails loudly on a soft-deleted holder
  - ✓ Tests — 11 integration tests; six mutations of the gate all caught, including one restoring the exact pre-R22 bug
  - ✓ Security — reopening the gate on total lockout is the sanctioned recovery path and grants no new authority (the seed is a manual host step, §19.1 step 6)
- [~] Approval queue: bundles, approve (TD-4.2 atomic) / reject with reason
  - ✓ Backend — `GET /admin/approvals` + approve/reject; both item types (registration bundle, standalone §4.3 link); a pending child never appears as its own entry, so the family is approved once; TD-10 paginated
  - ✓ Backend — TD-12 freshness policy (`assertFreshActive`) re-reads the caller and rebuilds roles from live rows; it returns the fresh roles rather than a boolean so a caller cannot verify freshness and then act on the token's stale authority
  - ✓ Tests — 11 service-level + 10 HTTP-level integration tests; the HTTP layer covers route mounting, the TD-3.8 envelope and status codes, which service tests cannot see
  - ✓ Security — TD-2 admin/super-admin only; a *validly signed* token claiming `admin` for a non-admin user is refused; suspension and role revocation take effect on the next request; first-wins on concurrent decisions (TD-15.3) with 409, never a 500; rejection requires a reason within TD-9's 500 chars
  - ✓ Security — all five guards mutation-tested (freshness status check, freshness role check, bundle exclusion, child activation, mandatory reason); every mutant is caught
  - ✓ Frontend — the §5.6 queue screen with §14.2's columns (Applicant(s), Type, Bundle contents, Submitted) and both row actions; `ApprovalCard` renders the bundle. Verified live against a seeded parent+child bundle: `records_updated: 2` on approval, 409 on a second decision, `VALIDATION_FAILED` on a reason-less reject
  - ✓ §14.2's **Branch** filter built (Revision 39) — the queue carries `branch { id, name } | null` and `?branch_id=` narrows it, with `meta.total` following the filter and family-link items excluded wholesale since they carry no branch
- [x] FamilyLink lifecycle (TD-1); unique partial index enforced
  - ✓ Index — `family_link_student_parent_active_key` on (`student_id`, `parent_id`) `WHERE deleted_at IS NULL`, so a revoked link never blocks a fresh one
  - ✓ Lifecycle — pending → approved → revoked with TD-4.8 soft-delete, Trash snapshot and audit; a pending link cannot be revoked (it is decided in the approval queue); revoking twice is `NOT_FOUND` and writes exactly one audit row
  - ✓ Tests — 20 integration tests incl. the partial-index behaviour, per-child and per-parent isolation, and TD-12 freshness
- [~] `X-Active-Child-ID` middleware: (parent+child) match, Student-role self-bypass via JWT sub, 400/404 semantics, never from body/query (§4.3)
  - ✓ Backend — §4.3's ordered resolution in `middleware/child-context.ts`; returns the verified student id, not a boolean, so no caller can fall back to a body/query id
  - ✓ Tests — 15 integration tests incl. both §19.2 named regressions (Student-role bypass, foreign-parent 404); seven mutations all caught
  - ✓ Security — every no-match reason returns an indistinguishable 404; a malformed header no longer 500s (that difference was a side channel); the bypass is unreachable for a Parent-only caller
  - △ Later milestone (M3–M6) — mounting it on the child-scoped endpoints, which arrive with calendar, Quran progress, grades and content

- [x] Revoke an approved family link = soft-delete (§4.3, Revision 16); TD-2 row + `familylink.revoke` audit; middleware already 404s the next request
  - ✓ Backend — `DELETE /admin/family-links/{id}`; TD-4.8 transaction (soft-delete + Trash snapshot + audit); `Approved` stays terminal in TD-1
  - ✓ Tests — 10 service + 7 HTTP tests; asserted through the resolver (access gone on the next request), not merely that a column changed
  - ✓ Security — TD-2 admin-only with the TD-12 freshness assertion; revoking one link leaves the parent's other children and the child's other parent untouched

- [x] ChildContextSwitcher component + API-client header injection (§14.3, §16.1)
  - ✓ **The box was stale, not the work** — verified 2026-08-28. All three parts
    exist and are wired: `components/header/child-context-switcher.tsx` (rendered
    by `role-switcher.tsx`, so it has reach), `contexts/active-child.tsx`, and
    `lib/api.ts` sending `X-Active-Child-ID` per request — never in the token.
  - ✓ Tests — 3 component tests, plus the 15 middleware tests the contract
    already had. Consumed by `dashboard/student.tsx`, `dashboard/account.tsx`
    and `resources.tsx`.
- [~] GroupTeacher join + teacher-scoping resolution helpers (§4.2)
  - ✓ Backend — `policies/teacher-scope.ts`; reach resolves exclusively through `GroupTeacher`, never through a Teacher's branch assignment
  - ✓ Tests — 16 integration tests against real branches, groups and enrolments; six mutations caught
  - ✓ Security — out-of-scope is 404 not 403 (no existence leak for a minor's record); revoking an assignment, un-enrolling, or deleting the group each end reach on the next call
  - ✓ Abstraction — `taughtByTeacher()` composable predicate is the primary form; `teachesStudent`/`teacherStudentIds` are built on it (one query each). Adopted while zero production call sites existed
  - △ Later milestone (M3) — the admin UI that creates groups and assigns teachers arrives with Group CRUD
- [x] ~~StudentSocialProfile field-level restriction~~ — **FEATURE WITHDRAWN (SRS Revision 120, Owner 2026-09-02).** The entity, its table, its two endpoints, its permissions and its audit actions are removed: no product surface ever collected the data, and the Owner does not collect personal-data categories the association does not operationally need.
- [~] User Management screen per §14.2 incl. normalized-shadow-column substring search, no fuzzy (TD-10)
  - ✓ Backend — `GET /admin/users`; §14.2 columns exactly; filters read live assignments; TD-10 envelope and ar-x-icu ordering
  - ✓ Tests — 14 list/search tests + a 38-entry parity corpus proving the TS normalizer matches the SQL function byte for byte; eight mutations caught
  - ✓ Security — §4.10 fields never leave the list (asserted on the row shape); TD-2 admin-only with TD-12 freshness
  - ✓ Visibility — RESOLVED by SRS Revision 25: branch-scoped Admins see only users assigned to their branches; unassigned users are Super Admin only; the branch filter narrows within scope and cannot escape it
  - ⚠ Open for a future decision — registration records no branch, so pending registrations are unassigned and Super-Admin-visible; the §5.6 queue is deliberately unscoped and remains the branch Admin's path to applicants
  - △ Frontend integration — the §14.2 table, filters and search box
- [~] §18 Registration, Approvals & Family checklist — **backend green**, one frontend item outstanding
  - ✓ *unified atomic transaction incl. ConsumedToken* — and the **kill test is now literal**: a child process is parked inside the real transaction, past every write and before the commit, then **SIGKILL**ed. That is a different failure from an error-driven rollback, which was already covered: nothing is raised, no `finally` runs, no teardown happens — what protects the database is PostgreSQL discarding an uncommitted transaction when the connection dies
  - ✓ Proven non-vacuous **before** the kill: `pg_stat_activity.backend_xid` is asserted non-null on the parked backend, which is direct evidence the rows exist and are uncommitted. Without it, a Prisma that buffered writes until commit would make the whole test prove nothing
  - ✓ Falsifiable — letting the transaction commit before the kill makes it fail
  - ✓ *consent records versioned, both types* — parent `data_processing` + child `data_processing` + child `media_release`, all carrying the active text version; a declined media release is **recorded**, not omitted (BR-1)
  - ✓ *bundle approval atomic* — approve/reject act on parent+child together, never half; TD-15.3 double-approval first-wins and the concurrent-admin race both covered
  - ✓ *FamilyLink pending grants zero visibility* — pending and rejected links both resolve to nothing (BR-4)
  - ✓ *X-Active-Child-ID middleware* — all five specified cases plus soft-deleted link/child, malformed and empty headers, the dual-role ordering rule, and the Parent-only bypass being unreachable: **15 tests**
  - △ *child context switcher drives the header* — frontend (v0); the backend contract it consumes is complete

- [x] **Revision 35 — public branch directory** (§5.1, §7, TD-2, TD-3.9, TD-9)
  - ✓ `Branch` gains `address`, `phone`, `email`, `opening_hours_ar`, `google_maps_url`; nullable in the database (branches predating the revision need no invented address), *required* enforced at the write boundary by TD-9
  - ✓ **Opening hours are free multiline Arabic text and are never parsed** — Ramadan and exceptional weeks change them, and a structured model would make each change a schema conversation
  - ✓ No coordinates: `google_maps_url` serves the map action; lat/lng arrive only with embedded maps, since two representations of one fact means the unread one drifts
  - ✓ **Dedicated public `GET /branches`**, not a relaxed admin route — an endpoint's audience is part of its contract. Explicit `select` projection, soft-deleted excluded, `display_order` honoured, TD-10 envelope
  - ✓ Tests — 7 HTTP tests incl. *exposes nothing beyond the documented projection*; three mutations caught (soft-deleted leak, ordering ignored, a field dropped)
  - ✓ Frontend — «فروعنا ومعلومات التواصل» renders entirely from the endpoint; a branch added in the back office appears with no frontend change, and a null map URL disables the button rather than fabricating a link
  - ⓘ Seeding unchanged: §15.1 still prohibits production branch seeding; the **development fixtures** carry the two real premises

## M3 — Scheduling & Calendar
> **⚠ SUPERSEDED IN PART BY SRS REVISION 43 (2026-08-04).** The Group-driven scheduling built and signed off
> below is **retired**: `Group` becomes `AdministrativeGroup` (organisation only — no room, teacher, schedule or
> capacity), delivery moves to `RecurringCourseSchedule → Session`, and `GroupTeacher` is replaced by
> `CourseScheduleStaff`. **The ticks below stay ticked** — they record what was genuinely built and is now being
> replaced, and rewriting them would erase the history that explains why M3b exists. Everything still in force
> here is the **Event layer** (non-teaching activity, four-way scope joins, visibility tiers, branch-activation
> backfill) and the **Hijri overlay**. New work: **M3b**.

> **Carry-over from Revision 26 (recorded in the pre-M3 sweep):** Levels, Categories, Subjects, AcademicYear and
> SystemSettings are **reference/configuration data — writes are Super Admin only, reads are Admin (branch-scoped)**.
> **Applied 2026-08-05 (M3b-29):** `/admin/levels` and `/admin/taxonomy` are built and enforce exactly this — Admin
> reads, Super Admin writes, Teachers refused. SystemSettings did the same in R42; AcademicYear remains read-only.
> **Resolved by Revision 30:** Teachers are `⊘` for reading reference data. They receive branch, room, level and
> subject information only through the operational APIs they are authorised to use, never by browsing reference-data
> endpoints. The implementation already behaved this way and is unchanged.
>
> **M3 backend status (2026-07-29): complete.** Every TD-3.4 scheduling and calendar endpoint is implemented,
> documented and router-reconciled; the §18 Scheduling & Calendar checklist is green. The 16 TD-3 endpoints still
> pending all belong to **M4 (Quran), M5 (Exams/Grading) and Storage/Content** — none is scheduling work. Items below
> that remain `[~]` are held open **only** by frontend work owned by v0 (the roster screen, the month/week/agenda
> views, operational-start graying); the backend contracts they consume are finished and stable.
- [x] Group CRUD: wall-clock times, room/time conflict detection, capacity (FOR UPDATE, TD-15), co-teaching, optimistic version locking (§4.4, TD-11, TD-15)
  - ✓ Backend (service) — create/update/delete/list; half-open room/time conflict detection; TD-15 optimistic locking; TD-5 enrolment guard; R26 scoping
  - ✓ Tests — 18 integration tests; six of seven mutations caught
  - ⓘ Accepted by the Document Owner — the TD-15 lock is implemented as required and the test verifies observable behaviour; proving the mechanism itself is not MVP work
  - ✓ HTTP — `GET`/`POST /admin/groups`, `PATCH`/`DELETE /admin/groups/{id}`; wall-clock `HH:MM` at the boundary; conflict returns `STATE_CONFLICT` with structured `details` rather than a new error code
  - ✓ Co-teaching — `assignTeacher`/`unassignTeacher` with the §4.4 two-slot cap; assignment IS the §4.2 scope (asserted via `teachesStudent`)
- [~] Roster management + consent re-evaluation enqueue on every mutation (TD-4.6)
  - ✓ Backend — `max_students` under the TD-4.6 Group row lock; `CAPACITY_FULL` with structured details; TD-5 soft-delete of the enrolment row only
  - ✓ §19.2 named regression — concurrent adds at capacity − 1 admit exactly one
  - ✓ §4.1a — every roster change enqueues `consent.reevaluate` in-transaction; a refused enrolment enqueues nothing; un-enrolment names the group explicitly
  - ✓ HTTP — roster and instructor routes with `HH:MM` boundary validation and structured conflict details
  - ✓ Tests — 18 service + 12 HTTP tests; seven mutations caught
  - △ Frontend integration — the §5.6 roster screen
- [x] Event model: visibility enum, recurrence (none/daily/weekly/biweekly-alternating/yearly) (§4.4)
  - ✓ Backend — create/delete with all five recurrence types; unbounded recurrence refused; TD-5 delete removes the scope joins
  - ✓ Tests — 20 integration tests; seven mutations caught incl. a teacher privilege-escalation path
  - ✓ HTTP — `POST /events`, `DELETE /events/{id}` with `YYYY-MM-DD`/`HH:MM` boundary validation; response reports what was actually attached
  - ✓ HTTP — `PATCH /events/{id}` under TD-15 optimistic locking; **scope keys are rejected, not silently dropped** (§4.4 materialises scope at creation and backfill is the one sanctioned later attachment); edit rights are narrower than create rights
  - ⚠ For the Document Owner — an event's scope is therefore **not editable** in the MVP; a mis-scoped event is deleted and recreated. Widening this needs a decision on how a re-resolved global event avoids §4.4's silent auto-fill
- [x] Explicit four-way scope-join population at creation; operational-start filter (§4.4)
  - ✓ Backend — rows written at creation, never a runtime wildcard; only already-operational branches attached
  - ✓ Tests — asserts real rows in all four join tables and the exclusion of a future-opening branch
- [x] Branch-activation manual backfill action + endpoint (§4.4, TD-3.4)
  - ✓ Backend — list-then-attach, idempotent, branch-scoped; the gap is neither auto-filled nor ignored
  - ✓ HTTP — `GET`/`POST /admin/branches/{id}/event-backfill`; idempotence proven over HTTP
- [~] Calendar views: month/week/agenda, filters, glance view, session popup, Monday start
  - ✓ Backend — unified grid over Groups + Events; all five recurrence types; Monday-based week; branch/level/group filters; 366-day range guard
  - ✓ Tests — 20 integration tests; eight mutations caught
  - ✓ HTTP — `GET /calendar`, the one **public** route: mounted before the guarded router with optional authentication, so an anonymous visitor is served the public tier rather than a 401
  - △ Remaining — the frontend month/week/agenda views
- [x] Three-tier visibility filtering per role incl. public tier for anonymous (§4.4, TD-2)
  - ✓ Backend — resolved server-side for anonymous, Pending, Student, Parent, Teacher, Admin and Super Admin
  - ✓ Security — each SRS asymmetry pinned by test: student private unfiltered by branch (R-6), hidden unscoped for Admins, private branch-scoped, Pending = anonymous, timetable never public
- [~] Operational-start-date graying in branch-scoped views
  - ✓ Backend — nothing before a branch's `operational_start_date` is returned in a branch-scoped read
  - △ Remaining — the visual graying itself is a frontend concern
- [x] Hijri overlay: recording the Ministry's official announcements (`HijriMonthStart`) + Super Admin screen (§4.4, §5.7, Revisions 31–32)
  - ✓ SRS **Revision 31** — the official Ministry of Habous calendar is the source of truth; the global ±2-day offset is **removed** from the model, `SystemSetting`, TD-9 and every screen
  - ✓ SRS **Revision 32** — the Super Admin **records** the Ministry's announcement rather than deciding it; required vocabulary *record / publish official month / official Ministry announcement*, prohibited *choose / define / set*, applied across the SRS, the contract and the code (`setMonthStart` → `recordMonthStart`, audit `hijri.month_start.set` → `.record`)
  - ✓ Investigation (as instructed) — **no official machine-readable source exists**: the Ministry publishes each month start as a prose news announcement, with no API, feed or dataset, and because months are fixed by sighting on the evening of the 29th a year cannot be published in advance. Manual entry is therefore the primary path, not a fallback
  - ✓ Model — `HijriMonthStart` (year, month, Gregorian start, draft/published, source, version, audit/soft-delete) + TD-9 CHECK constraints; the offset constraint and its settings row are migrated away with a TD-6b contract-phase tag
  - ✓ `baseHijri()` is the single seam — every consumer reads recorded data; **nothing computes a Hijri date astronomically**
  - ✓ Endpoints — `GET /admin/hijri-calendar`, `PUT /admin/hijri-calendar/{year}/{month}` (TD-15), `POST …/{year}/publish`, `GET …/{year}/history`; Super Admin only
  - ✓ **Importer removed from the MVP (Revision 32)** — route, contract entry, provider interface, registry and tests all gone; moved to §10.1. There is no machine-readable Ministry source, so the endpoint could only ever answer *not configured*, and an endpoint that cannot succeed invites clients to build against a promise the system cannot keep
  - ✓ Extensibility kept **by data, not scaffolding** — `recordMonthStart` is the single write path a future importer would call (inheriting ordering, TD-15 locking, draft state and audit), and `HijriMonthStart.source` records provenance; no abstract provider interface ships without an implementation
  - ✓ Tests — 21 unit + 22 integration/HTTP; **twelve mutations caught**, two of which exposed real defects
  - ✓ §18 check green — the overlay reproduces the Ministry's recorded announcements, and an unpublished or unrecorded month renders nothing
  - ✓ **Public frontend — the dual calendar at `/calendar` is built** (see the item below); the Hijri side renders recorded official data only and nothing when a month is unrecorded
  - ✓ **Super Admin `/superadmin/hijri-calendar` recording screen is built** — the twelve months of a chosen year, a date input per month, TD-15 optimistic locking with a named conflict message on a stale version, publish-the-year, and two warnings a reader must not have to discover: **drafts render nowhere until published**, and **the last recorded month resolves only 29 days until its successor is recorded**. Revision 32's vocabulary is enforced in every label — *record* / *official announcement*, never *choose* / *define* / *set*. This closes the gap reported on 2026-07-30: the recurring §2.3 task is now performable through the product rather than only by API call
  - ⚠ For the Document Owner — a **recurring monthly** owner task exists (§2.3): each month must be recorded and published after the Ministry announces it, or dates in it carry no Hijri label. The task is transcription, not judgement
- [x] Public calendar page `/calendar` — the dual-calendar screen (§5.1, §4.4, TD-3.4, TD-3.10)
  - ✓ **Dual-calendar title** — Gregorian right in logo orange, Hijri left in logo green, both bold, spanning months rendered as `ذو الحجة / محرم 1448`. The client performs **no** month arithmetic and **no** Hijri computation: it renders `gregorian_months` and `hijri.months` exactly as the bootstrap assembled them (§20 rule 14)
  - ✓ **Both calendars in every day cell** — Gregorian top-right (orange, dominant), Hijri top-left (green, smaller), as a **fixed header outside the scrolling event list**, so a busy day still shows its date
  - ✓ **Category and Level filters** — options from the backend, never hardcoded (§4.4b). Selecting a Category **re-requests the bootstrap with `category_id`** so the narrowing is **server-side** per §4.4; changing Category **resets** the Level. `LevelSelector` has no category prop at all, which makes client-side filtering structurally impossible rather than merely forbidden
  - ✓ **Backend gap closed** — `GET /calendar/bootstrap` gained the optional `category_id` §4.4 already mandated but the implementation lacked; 10 HTTP integration tests, contract regenerated
  - ✓ **Layout** — the grid is the page: ~108rem inner width, cells 13.5rem (was 9.5rem), ruled hairlines instead of boxes, no shadows. The `برنامج اليوم` panel is **removed** — clicking a day opens a **wide dialog listing every activity in full**, which is what let the cells grow
  - ✓ **Events compact** — title then time on **one** line, no border, no shadow, colour-coded by kind; every occurrence renders and the area scrolls, so nothing is truncated at an arbitrary cap
  - ✓ **Event details** — description, date, time, kind, recurrence, category, level, branch, room, instructor display names, visibility. A field the backend did not send is **absent**, not blank; recurrence is omitted when `none`; an unknown enum value falls back to its raw form rather than vanishing
  - ✓ **Accessible logo colours** — the raw logo orange/green measure 2.5:1 and 1.9:1 on white and **cannot carry text**, so each exists twice: the true value for marks, a darkened same-hue variant for text (4.71:1 and 4.91:1, measured and recorded beside the tokens)
  - ✓ Defect found and fixed while building — the shared `Dialog` hardcoded `aria-labelledby="dialog-title"`; harmless with one dialog, **two elements with one id** once the calendar had two, so a screen reader would announce the wrong title. Now `useId`
  - ✓ Tests — 63 frontend (was 48), covering the spanning-month title, the omitted Hijri side, the per-cell absence, and that the level select does no filtering
- [x] Calendar navigation and visual hierarchy pass (§5.1, §14.4, §14.7)
  - ✓ **Month selector removed**, replaced by three prominent buttons — **السابق · اليوم · التالي** — centred beneath the title. `اليوم` is the primary variant (the action most often wanted, and the only one not reversible by its opposite); it returns to the current month and deliberately does **not** open the day dialog
  - ✓ **The month is named once.** The old selector carried its own copy of the Gregorian month beside the title's — two renderings of one fact; a test now asserts the nav contains no month name at all
  - ✓ **Page reads as four steps** — eyebrow → dual title (the headline) → navigation → filters → grid, each its own centred block with generous rhythm. The `<h1>` became an eyebrow so the *month* takes the visual weight
  - ✓ **Today redesigned.** The filled green disc **overwrote the Gregorian orange**, making today the one cell where the colour language broke. Now a ring in `currentcolor` plus a soft wash: the convention survives, the colour cannot drift from its numeral, and nothing is filled
  - ✓ **Cascade order fixed** — `is-today` → `:hover` → `is-selected`, all `0,2,0`, so order *is* priority. As first written, today's wash silently overrode both hover and selection
  - ✓ **Hierarchy: dates first, events second** — a hairline and padding separate the numbers row from the event list; chip washes lifted off full strength (80%→55%, 15%→10%) and chip titles dropped to 600 against the numerals' 700, so events no longer pull the eye before the dates
  - ✓ **Both numbers are first-class** — same row, same weight, opposite ends, own colours, with a real gap so two two-digit numbers never touch
  - ✓ **Accessibility regression avoided** — the deleted selector held the `aria-live` region announcing month changes; it moved to the title, and a test asserts it. The Gregorian side of the title also gained a fallback to the displayed month, so a failed chrome fetch cannot leave the page headless; **the Hijri side still has no fallback, by rule**
  - ✓ Dead `.month-selector` CSS removed with its component; no stale references remain
  - ✓ Tests — 72 frontend (was 63)
- [x] Hijri overlay made visible, and the brand colours applied (§4.4, Revisions 31–32)
  - ✓ **Diagnosed: not a code defect.** `hijri_month_start` was **empty** (0 rows), so the backend correctly returned `null` for every day and the frontend correctly rendered nothing — Revision 31 mandates silence and §20 rule 14 prohibits computing a substitute. Backend, adapter, model and components were each verified individually and all four were already correct
  - ✓ **Dev fixtures now carry the two announcements this project has on record** — 1 Dhu al-Hijja 1447 = 18 May 2026 and **1 Muharram 1448 = Wednesday 17 June 2026** (the date SRS Revision 31 itself records, contrasted with Umm al-Qura's 16 June). Both `published`, `source = manual`. Production is untouched: §15.1 seeds no Hijri data
  - ✓ **Verified live end to end** — June 2026 resolves **30/30 cells** and the title carries **both** Hijri months (ذو الحجة / محرم 1448), which is the spanning case working
  - ⚠ **Every cell of July 2026 cannot be filled without the Safar 1448 announcement**, which is real-world data nobody here has. Days 1–15 resolve (Muharram 1448's certain 29 days, 17 June – 15 July); from 16 July the overlay is silent by design. Fabricating the next month start would look authoritative and be wrong — exactly what Revisions 31–32 exist to prevent
  - ✓ **Brand colours applied exactly as instructed** — Gregorian `#f39200`, Hijri `#8dc63f`, verified in the built CSS. Contrast measured and **recorded as an accepted decision**: 2.35:1 and 2.02:1, below both the 4.5:1 and 3:1 floors. Defensible because the day cell is a `<button>` whose accessible name carries the full ISO date, so the colour is not the only channel; the residual risk is to low-vision sighted users and is accepted knowingly. The `-ink` variants remain as the correct choice for text with no alternative representation
  - ✓ **Tests — the suite asserted only the ABSENCE case.** Added the presence case (both months recorded → all 31 days resolve, both title months reported), the 29-day boundary (next month unrecorded → day 30 is `null`), and that a `draft` month renders nothing. Bootstrap suite 10 → 14; integration 483 → 487
  - ⚠ **For the Document Owner — no interface exists for recording a month.** `/superadmin/hijri-calendar` (§5.7) is unbuilt, so the only way to record an announcement today is an authenticated API call. Until that screen ships, the recurring §2.3 task cannot be performed through the product
- [x] §18 Scheduling & Calendar checklist green (incl. the Ramadan DST regression test)
  - ✓ group CRUD + half-open room/time conflict detection · co-teaching via `GroupTeacher` (two-slot cap) · all five recurrence types incl. biweekly-alternating · three visibility tiers per role · four-way scope joins written at creation · manual branch-activation backfill · the Hijri overlay from recorded official announcements
  - ✓ **§19.2 Ramadan DST regression** — a weekly 09:00 class expanded across both of Morocco's 2026 clock transitions reads 09:00–10:30 on every occurrence
  - ✓ *operational-start-date gating* — **and a weak assertion was found and fixed while signing this off**: `[].every()` is true, so the boundary check would have passed had the filter removed everything. It now proves the after-side survives and that the pre-boundary event is specifically gone; mutation-tested by ignoring the floor
  - △ The *graying* itself is frontend; the backend returns nothing before the boundary

## M3b — Educational Model (SRS Revision 43)

> **Inserted before M4 by Document Owner decision.** M4 and M5 both resolve students through the group model;
> building them against the retired `Group` would mean writing them twice. Nothing in M4+ starts until this is green.

**Schema & migrations (expand → migrate → contract, TD-6b — three deployments, never one)**
- [x] *Expand:* `AdministrativeGroup` (+ the redundant `UNIQUE (id, level_id)` the composite FK needs), `TeachingGroup`, `StudentTeachingGroup`, `Enrollment`, `RecurringCourseSchedule`, `CourseScheduleStaff`, `Session`, `SessionContent`; `Room.capacity`; `EducationalContent.subject_id` required (§7)
- [x] Hand-written SQL (TD-6a): **two** composite FKs (R43.2) — `(administrative_group_id, level_id) → AdministrativeGroup(id, level_id)` and `(teaching_group_id, subject_id, level_id) → TeachingGroup(id, subject_id, level_id)`; partial `UNIQUE (student_id, level_id)` and `UNIQUE (student_id, subject_id, level_id)`; the schedule mode/target and recurrence-shape CHECKs; time-order CHECK; `UNIQUE (schedule_id, date)`; `ar-x-icu` on both new `name` columns. R83.2 later retired the cancellation-reason CHECK and made the reason optional
  - ✓ **Proven, not assumed** — `prisma/verification/r43-constraints-proof.sql` applies the full current migration history to a scratch database from empty and attempts every live constraint boundary: **12 rejections fired on the named constraint, 6 legitimate rows accepted**, including R83's reasonless cancellation
  - ✓ **Independence between Subjects proven directly**: a ترتيل وتجويد seat for a student already holding a حفظ seat in the same Level is accepted; a second حفظ seat is refused
  - ⚠ **Historical:** the original proof caught a defect in the then-required cancellation-reason CHECK: `btrim(NULL) <> ''` evaluated to `NULL`, which a CHECK treats as satisfied. It was rewritten with an explicit `IS NOT NULL`; R83.2 later dropped that constraint when the Owner made the reason optional
- [x] *Migrate:* backfill each existing `Group` into an `AdministrativeGroup` + one `RecurringCourseSchedule` carrying its slot; `StudentGroup` → `Enrollment`; `GroupTeacher` → `CourseScheduleStaff`; `EventGroup` → `EventAdministrativeGroup`; `Grade.group_id` → `administrative_group_id` **[Closed 2026-09-21 ledger review — superseded: see the «Migrate: superseded» line five below; no data was migrated, by Owner decision]**
- [x] *Contract (separate, later migration):* the retired tables and columns dropped, tagged with the contract-phase justification
  - ✓ **No data migrated, by Document Owner decision** — no production deployment exists, and a backfill would have had to invent the Subject the old model never recorded
  - ✓ Verified on a **fresh database**: all 19 migrations apply from empty, and the four retired tables are absent
  - ✓ Migration is **idempotent** — a contract step that partially applied must be re-runnable, which this one had to be
- [x] *Migrate:* **superseded** — dev fixtures and the seed were rewritten under the new model instead of migrated (authorised)

**Domain**
- [x] Level creation **takes a required `branch_id` and** auto-creates المجموعة 1 at it, in the same transaction (TD-4.6b, §4.4b, R43.1) — the Branch is an input, **never a column on `Level`**
  - ✓ `level.service.ts`; proven by mutation — removing the first-group creation fails **31** tests
- [x] First-Branch bootstrap backfill: creating the deployment's first Branch creates المجموعة 1 for every Level that has none, atomically and idempotently (TD-4.6d, §15.1)
  - ✓ Keyed on the **condition**, not on "is this the first branch" — idempotent by construction, and correct if the first branch is later soft-deleted
  - ✓ Verified against the dev database's **21 seeded Levels**, which are the real bootstrap case; one audit row for the whole backfill
  - ⚠ **`createBranch` is no longer a single-row operation.** The existing branch suite's teardown could not delete its own branches afterwards — fixed there, and recorded because any future caller inherits the same side effect
- [x] Roster resolution — one implementation serving all three teaching modes (§4.4c); **Entire Level is branch-bound**
  - ✓ 17 integration tests; both claims mutation-proven (drop the branch bound → 2 fail; resolve a split to the administrative roster → 4 fail)
- [x] **Teacher scope from `CourseScheduleStaff` — COMPLETE.** Verified 2026-09-04:
      `teacher-scope.ts` no longer exists and `GroupTeacher` survives only in two
      historical schema comments; every staff-scope question composes
      `studentsTaughtBy` in `roster-resolution.ts`, which is the single §4.4c
      definition. R91 later added the occurrence arm and R123/R124 both compose it.
  - ✓ Backend — `studentsTaughtBy`, `teacherBranchIds`, `staffsSession` in `roster-resolution.ts`; branch scope now **stated** by the schedule instead of inferred through two hops
  - ✓ Tests — assistants have identical reach; a teacher with no schedules reaches nobody; revoking a staffing ends reach on the next call
  - ✓ **Consumers migrated** — `calendar`, `event` and `consent` services all resolve through `roster-resolution.ts`; **no production code reads `GroupTeacher`**
  - ✓ Event scoping moved with it (`EventAdministrativeGroup`), because the two id spaces could never have intersected
  - ✓ `consent.service` now emits `{ session_id }`, so both producers agree before M6 writes the handler
  - ✓ `test-support/educational-fixture.ts` — one fixture for the four suites that each need "a group, a student in it, and a teacher who reaches them"
- [x] Teaching Groups + membership, and the **`unassigned` list** (BR-22)
  - ✓ R43.3 authority split: CRUD is Super Admin, membership is Admin scoped by the **student's** enrolment branch
  - ✓ `unassigned` returns `split: false` for an unsplit Subject — deliberately distinguishable from "everyone is assigned"
  - ✓ Proven by mutation: making uniqueness per-Level instead of per-(Subject, Level) breaks independence between subjects
- [x] Enrolment service — enrol · un-enrol · **move within a Level as one action** (§5.6) · roster · `levelsForStudent`
  - ✓ `level_id` read from the group, never the caller; no capacity check anywhere (BR-23)
  - ✓ Gender restriction enforced, with a **null `sex` not eligible** rather than a wildcard (R27)
  - ✓ Consent enqueue emits `{ session_id }`; the live worker resolves the current R43/R92 Session audience and safely drains historical queue-only work
- [x] Course schedule CRUD with conflict detection **against materialized Sessions** — room, teacher **and assistant** — under the TD-4.6c row lock; `SCHEDULE_CONFLICT`
  - ✓ Touching boundaries are **not** a conflict, so back-to-back classes stay legal; a **cancelled** session frees its room while keeping the row
  - ✓ Branch agreement enforced for group targets and rooms; BR-23 confirmed — a capacity of 1 refuses nothing
  - ✓ Proven by mutation: making the check ignore dates (rule-comparison behaviour) fails the alternating-week tests
- [x] `session.materialize` (TD-7): idempotent per `(schedule_id, date)`, academic-year horizon, nightly cron; **never rewrites an overridden session or one carrying work** (§20 rule 24)
  - ✓ Materializes **inside** the schedule-write transaction, so the calendar is never briefly empty
  - ✓ **Snapshots room + staff onto each occurrence (R43.4)**; re-syncs **future, un-overridden** sessions only, so a held class keeps the people who actually taught it
  - ✓ **`policies/session-protection.ts` is the single authority** (R43.6) — a *semantic* rule, not a feature list: protected whenever the session holds data whose loss would change historical truth
  - ✓ Modules **contribute** rules (`registerSessionProtectionRule`) knowing nothing about scheduling; built-ins are unconditional, evaluation is bulk, rules may only *add* protection
  - ✓ Materialization, schedule edit, schedule delete and regeneration all ask that one function; work-carrying sessions are protected **whatever their date**
  - ✓ `regenerateSessions([ids])` is the explicit, Admin-only, audited path — sessions must be **named**, there is no blanket option, and regeneration never discards attached work
  - ✓ Reports what it left alone and why; proven by mutation — removing the protection fails 3 tests
  - ✓ **Recurrence expansion extracted to `lib/recurrence.ts`** and shared with `Event` rather than duplicated (§4.4); 25 unit tests incl. the alternating-week parity
- [x] Session lifecycle (TD-1) + override/cancel/restore + `SessionContent` linking
  - ✓ Transition table written verbatim; anything absent is `STATE_CONFLICT`. A reschedule is a **field edit**, not a transition
  - ✓ Cancellation demands a reason and records the **audience size at that moment**; restore refused after the date
  - ✓ Content is **referenced, never owned** — unlinking leaves the file untouched, and one item may be referenced by many sessions
- [ ] Approval assigns Levels and one Administrative Group each, in the approval transaction (TD-4.2, §4.1)
- [ ] حفظ القرآن and تفسير القرآن as schedulable atomic Subjects **with the BR-9 carve-out** — their `LevelSubject` rows generate no generic grading components because both follow the LevelSurah selection; only حفظ is progress-tracked (§4.4b, R107); the postponed grading-template engine remains unbuilt
- [x] Consent gate re-subjected to the session's resolved audience; `consent.reevaluate` payload `{ session_id }` (BR-2, TD-7)
- [x] Retire `CAPACITY_FULL` and the roster row-lock; `Room.capacity` informational (BR-23, TD-15.2) **[Closed 2026-09-21 ledger review — done: `errors.test.ts` pins `CAPACITY_FULL` as retired by name (M8, 2026-08-28 batch) and no capacity check remains]**

**API & screens**

> The contract phase removed the nine `/admin/groups` routes and added none back, so
> every service below was built, tested and **unreachable over HTTP**. TD-3.12 is
> being mounted one resource at a time, each complete — controller, DTOs, routes,
> OpenAPI, HTTP suite — before the next begins.

- [x] TD-3.12 **Administrative Groups** — `GET`/`POST /admin/administrative-groups`, `PATCH`/`DELETE /admin/administrative-groups/{id}`
  - ✓ Explicit DTO: exactly `id`, `name`, `level_id`, `branch_id`, `display_order`, `version`; 18 HTTP tests asserting the **exact key set**, not field presence
  - ✓ The write boundary **refuses** `max_students`, `room_id`, `teacher_id` and a weekly slot rather than dropping them (§20 rule 22, BR-23) — a `201` after sending a capacity would claim a limit was recorded
  - ✓ `level_id`/`branch_id` rejected on `PATCH`: moving a group between Levels or Branches is a re-creation, not an edit
  - ✓ Proven by mutation — dropping `.strict()` fails 2 tests; leaking `created_at` through the DTO fails the **build** (TS2353), which is the stronger guard
  - ✓ TD-9/TD-15 primitives extracted to `validators/common.ts` and the Zod-failure boundary to `controllers/parse.ts`, rather than copied a second time
- [x] TD-3.12 Administrative Group **roster** — `GET`/`POST /admin/administrative-groups/{id}/roster`, `DELETE .../roster/{studentId}`
  - ✓ `level_id` is **not accepted** on enrolment — read from the group, so the composite FK stays a backstop rather than the only thing between a typo and a mis-filed student
  - ✓ BR-21 refused with an explanation, not a raw constraint error: same group is `DUPLICATE`, another group of the same Level is `ALREADY_ENROLLED_IN_LEVEL` **naming the group that holds them**
  - ✓ `id` on a roster entry is the **enrolment** id, not the student's; un-enrolment leaves the tombstoned row and the academic record intact (TD-5)
  - ✓ No capacity check anywhere (BR-23); 6 HTTP tests, 24 in the file
- [x] TD-3.12 **Teaching Groups** (incl. `unassigned[]`, BR-22) and their membership verbs
  - ✓ Addressed by `(Level, Subject)` because that pair **is** the split; both refused in a body and on `PATCH`, so a cohort can never be silently re-filed under another curriculum item
  - ✓ `GET` returns `{groups, split, unassigned}` in one read — the unassigned list is unreadable without the groups beside it — and is **unpaginated**, since a page boundary through an alarm hides half of it
  - ✓ `split` kept distinct from `groups.length`: *the question does not apply* must not render like *everyone is placed*
  - ✓ `DELETE` answers `200 {released_students}`, not `204` — BR-22 forbids a silent release, and the count exists only at that moment
  - ✓ R43.3 authority split proven over HTTP: group CRUD `403` for a branch Admin, membership `201` for their own student, `404` (never `403`) for a student enrolled elsewhere
  - ✓ 21 HTTP tests; `pending-denial` rose 44 → 50 on its own from the generated document
- [x] TD-3.12 **Course Schedules** (incl. `/conflicts` and `/roster`) — 6 operations
  - ✓ `teaching_mode` + `target_id` on the wire, never three nullable columns — one field cannot be ambiguous
  - ✓ TD-11 wall-clock `HH:MM` in and out; an ISO instant is **refused**, since a class starts at 15:00 at its branch
  - ✓ Writes return `{ schedule, materialization }` **nested, not flattened**, so a list row and a write response share one shape
  - ✓ `protected_sessions` and `retained` report what was deliberately *not* touched (§4.4, R43.6)
  - ✓ Subject, target, branch and academic year rejected on `PATCH` — each would re-point already-materialized history
  - ✓ **Two service functions did not exist** and were written here: `listCourseSchedules` and `resolveScheduleRoster`
  - ✓ 17 HTTP tests; full sweep 648 passing across 36 files
- [x] **Fixed the `auth-refresh` integration flake** — it was `429 RATE_LIMITED`, not data interference: `limit_req_zone` keys on the client IP and the whole suite arrives from one host. Dev overlay replaces the zone *rates* only; every `limit_req` directive and burst stays as production has it ([why](development/testing.md#the-auth-refresh-flake-and-what-it-actually-was)). Verified by three consecutive clean sweeps
- [x] TD-3.12 **Sessions** (override / cancel / restore / content) — 5 operations
  - ✓ `status` **refused** on `PATCH` — a transition carries a mandatory reason and an audience count recorded while still answerable; a field assignment carries neither
  - ✓ `overridden` set by **any** override, including a no-op one: the flag records that a human decided, which is what survives the next schedule edit (R43.4)
  - ✓ `staff` supplied replaces the snapshot, omitted leaves it — an empty array is a real instruction, not an omission
  - ✓ Restore refused after the date (`SESSION_IN_PAST`) — a past class cannot be asserted back onto the timetable
  - ✓ Unlinking content **never deletes the file**; the link row tombstones (TD-5)
  - ✓ Not under `/admin/`: TD-2 gives a Teacher their own staffed sessions, so the prefix would misdescribe the audience; a teacher who staffs nothing gets `404`, never `403`
  - ✓ 14 HTTP tests, green first run; full sweep 667 passing across 37 files
  - ✓ **TD-3.12 is complete** — 64/81 TD-3 endpoints implemented, 0 undocumented
  - Split from Course Schedules deliberately: ten operations in one slice does not fit a fresh context budget, and splitting at the resource boundary is cheaper than compacting halfway through ([why](development/engineering-efficiency.md#capacity-not-only-value))
- [x] TD-3.13 **public library** — `GET /library`
  - ✓ Public and anonymous; **never answers `401`** (an invalid credential is ignored), mounted before the guarded router like `/calendar`
  - ✓ Signing in **reorders, never unlocks**: own branch → Global → other branches (§5.2). `branch_id IS NULL` is *Global*, not *unknown*, so it sorts second
  - ✓ §4.9's three tiers filter every result set — reconciled with TD-3.13's "nothing hidden" via §5.2's *identical filters never means identical results*
  - ✓ Parents of enrolled students get the private tier **without** `X-Active-Child-ID` — the library is one shared reading surface
  - ✓ BR-2 enforced by explicit exclusion, not by trusting the re-evaluation engine to have moved `visibility`
  - ✓ DTO omits `storage_key`/`storage_bucket`/`original_filename`/`consent_forced_private`
  - ✓ 16 HTTP tests; `pending-denial` grew to 62 and gained a positive exemption assertion
- [x] `/calendar` **filter set + `prefilled_filters`** (TD-3.4, R43)
  - ✓ Full set accepted: `academic_year_id`, `subject_id`, `teacher_id` added; **`group_id` corrected to `administrative_group_id`** — the name TD-3.4 spells out, and the schema refused the documented one (same defect class as M3b-14b)
  - ✓ **A filter no Event can satisfy narrows the grid to Sessions** rather than being ignored — ignoring it would return Events that do not match the request
  - ✓ `teacher_id` matches the **session's own staffing snapshot**, not the schedule's (R43.4)
  - ✓ Sessions gained `subject_id`, `subject_name`, `teaching_mode`, `audience_label`, `status`; `audience_label` stops impersonating `description`
  - ✓ `prefilled_filters` is `null` for anonymous **and** Pending; a value is prefilled **only when unambiguous** — plural yields `null`, never *first*
  - ✓ Proven not to change the result set: a signed-in member with no enrolments sees exactly what an anonymous visitor sees
- [x] `/calendar/sessions/{id}` — the §5.2 Session page
  - ✓ The `occurrence` is **byte-identical to the grid's** — one `include` and one mapper, extracted so the two cannot drift; asserted field for field
  - ✓ `recordings` and `linked_content` are **disjoint**, split on the file being audio (§4.9: video is excluded entirely), so no second column has to be kept true
  - ✓ Both lists reuse **the library's §4.9 tier predicate itself**, exported rather than restated — one rule, one rendering
  - ✓ Public at the caller's tier: anonymous sees the public recording, never the private one; a teacher also sees hidden
  - ✓ **`notes` ships `null`** — TD-3.4 names it but §7 defines no storage; a §7 schema decision, deferred, and visible rather than silent
  - ✓ Registered in `scripts/ci/td3-routes.txt`, which caught its absence (66/82 TD-3, 0 undocumented)
  - ✓ 9 HTTP tests green first run; `pending-denial` grew to 63 with a positive exemption assertion
- [x] `/admin/schedules` — Course Schedules screen (read · conflicts · resolved roster · delete)
  - ✓ **The §14.1 node was missing from the module registry entirely** — and from the test pinning that registry, so the two agreed with each other while neither agreed with the sitemap
  - ✓ Conflicts panel states it compares **materialized Sessions, not recurrence rules**; roster panel states it is **resolved now, not stored** — "no conflicts" from a rule comparison is a different assurance
  - ✓ Delete surfaces `retained` — Sessions holding real work outlive the schedule, and the count is unavailable afterwards
  - ✓ `timeLabel` exported and tested: TD-11 wall-clock rendered verbatim, never parsed through `Date`
  - ✓ Client-side contract guard mirroring the server's key set, so an adapter rename is a typecheck failure rather than a blank page
  - ✓ Write form deliberately deferred to its own slice — half a form would claim a capability the module lacks
- [x] `/admin/schedules` **write form** (subject · mode + single target · room · staff · times · recurrence, with conflict reporting on save) **[Closed 2026-09-21 ledger review — built: see «`/admin/schedules` write form — create and edit» below]**
- [x] **Portal separation** — `TEACHER_MODULES` beside `ADMIN_MODULES`, shared mechanics extracted
  - ✓ `lib/portal-modules.ts` owns the *behaviour* (status vocabulary, role gating, longest-match path resolution); each portal owns its *list*
  - ✓ `components/portal/` owns the shared shell and nav rendering; `AdminLayout` and `TeacherLayout` differ only in their sidebar, which is the part that genuinely differs
  - ✓ **`section` deliberately stayed admin-only** — §14.1 groups the back office and gives the teacher portal no equivalent; hoisting it would make the shared layer the first caller's shape
  - ✓ A test asserts the registries **share no path**, so resolution cannot depend on which registry a caller asked
- [x] `/teacher/schedules` **screen** — consumes the **same** `GET /admin/course-schedules`, role-scoped
  - ✓ Document Owner decision: `/admin/` is a **routing namespace, not an authorization boundary**; one endpoint with role-scoped data beats two returning an identical representation
  - ✓ Super Admin all · branch Admin their branches · **Teacher the schedules they staff** (`CourseScheduleStaff`, §4.4c) · everyone else `403`
  - ✓ **Reading is not managing:** create/edit/delete/`conflicts` stay Admin (§14.1 — teachers do not create or edit schedules)
  - ✓ A teacher staffing nothing gets an **empty list, not `403`**; an explicit filter narrows but never widens
  - ✓ `/roster` follows the same rule (§5.6 line 753); a schedule they do not staff is `404`, never `403`
  - ✓ Screen shares the adapter and both cell renderers with `/admin/schedules` — no create/edit/delete controls
  - ✓ **SRS wording proposed, not written:** `docs/SRS-PROPOSAL-R45.md`
- [x] `/admin/groups` (+ roster) — Administrative Groups screen
  - ✓ Level and Branch chosen at creation and **disabled on edit**, matching what the server accepts rather than offering fields it refuses
  - ✓ Each of the three delete refusals names its own cause (`ENROLMENTS_EXIST` · `SCHEDULES_EXIST` · `LAST_GROUP_IN_LEVEL`) instead of a generic failure
  - ✓ BR-21 surfaced as *already in another group of this Level*, which is the information needed to decide on a move
  - ✓ Roster uses `GET /admin/users` for the picker; the enrolment id is kept distinct from the student id, asserted in a test
  - ✓ Level list read from the **public calendar bootstrap** — no `/admin/levels` exists and inventing one would be a new public contract
- [x] **Reference-data selectors** — `GET /admin/subjects`, `GET /admin/academic-years` (TD-3 extension, Owner-authorised)
  - Canonical source for every admin selector needing either; widening `/calendar/bootstrap` and a screen-specific payload both rejected, with reasons recorded
  - Unpaginated (a selector offering a subset misrepresents the choice) and carrying no `version` (no write exists)
  - Admin+ read (TD-2 R26); Teacher refused (R30) — asserted
  - 8 HTTP tests; SRS wording drafted in `SRS-PROPOSAL-R46.md`
- [x] `/admin/schedules` **write form** — create and edit
  - Edit disables Subject, mode, target, branch and year — the server rejects them, so the form does not offer them
  - The target picker follows the mode (one target of the kind the mode names); `teaching_group` withheld until Subject Organisation can supply its target
  - Times are plain text, not a native time control — TD-11 wall-clock travels as `HH:MM`
  - Every save opens a materialization report, so `protected_sessions` is seen rather than swallowed
  - `SCHEDULE_CONFLICT` gets its own message: the remedy is to free a named room or person
- [x] `/admin/levels/{id}/subjects/{subjectId}` — Subject Organisation (Teaching Groups)
  - Routed by pattern, not a registry entry: the path carries ids, so no menu can link to it — it is an internal view of the Levels module, reached by drilling in from a group
  - `split: false` is its own state, never rendered as *everyone is placed* — a Subject with no groups is taught to the whole Level, so the question does not apply
  - The unassigned list leads the page and is unpaginated: BR-22 says a student with no group has **no sessions in that subject**, and a page boundary through an alarm hides half of it
  - Each refusal names its cause: `ALREADY_IN_SUBJECT_SPLIT`, `NOT_ENROLLED_IN_LEVEL`, `SUBJECT_NOT_IN_LEVEL`, `SCHEDULES_EXIST`
  - Deletion reports how many students returned to *unassigned* — the count exists only at that moment
  - R43.3 authority split honoured: group CRUD Super Admin, placement Admin
- [x] **Session page frontend** — `/calendar/sessions/{id}` (§5.2)
  - Public at the caller's tier; **no client-side filtering** — a client that filters is a second implementation of a permission rule
  - A cancelled session is **shown and announced**, not hidden or merely coloured (§14.4)
  - Recordings and materials stay separate lists, because a recording is what BR-2's consent gate acts on
  - An empty list renders **nothing**, not an empty heading: on a public page *there are none* and *there are some you may not see* must not look alike
  - Items link **into the Library** (§5.2 — one reader, one permission path), never to a download
  - **Fixed live drift found here:** the calendar adapter still declared `kind: 'group'`, so every session had been rendering as an Event since Revision 43
- [x] **Public Calendar frontend** — consumes `prefilled_filters` (TD-3.4, R43)
  - Applied **once per visit, not once per fetch**, and only to filters the reader has not set — re-applying would drag a filter back the moment someone cleared it, which is the opposite of *freely changeable*
  - A suggestion, never a scope: the server does not narrow by it and neither does the client
  - `null` for anonymous and Pending is distinct from an object of nulls, and the page uses that to decide whether to prefill at all
- [x] **Level ↔ Subject assignment** — `GET`/`PUT`/`DELETE /admin/levels/{levelId}/subjects[/{subjectId}]`
  - **Root cause of the "إضافة فوج" failure, found by measurement:** the database held **zero `LevelSubject` rows and no write path existed**, so every teaching-group creation answered `SUBJECT_NOT_IN_LEVEL`
  - Super Admin writes (curriculum structure, R26/R43.3); Admin+ reads
  - `PUT` revives a removed assignment rather than duplicating it — one row, so *is this Subject taught here* has one answer
  - Removal refused while Teaching Groups exist: members would otherwise hold seats in a subject the Level does not offer
  - 5 new HTTP tests including the end-to-end assertion that a teaching group can now be created
- [x] **Curriculum taxonomy CRUD** — Categories, Subjects and Levels (§5.6, §14.1; drafted as `SRS-PROPOSAL-R47.md`)
  - **The audit came first and most of it said *reuse*:** Branches & Rooms, Subject Organisation and the Level↔Subject assignment all had complete backends and needed frontend only. `createLevel` already implemented TD-4.6b **with no route to reach it**
  - `GET /admin/subjects` gained `version` so the editor could reuse the selector — **one list, not two reads of one table**; this narrows R46's wording, whose premise was that the endpoint had no write
  - **Deleting a Level cascades its Administrative Groups** — the inverse of TD-4.6b, and a rule the SRS did not have: every Level owns at least one group by construction, so a guard counting them would make deletion unreachable. The audit row names the cascaded ids
  - A Category **never** cascades its Levels — those carry people's records
  - `PATCH /admin/levels/{id}` **refuses** `category_id` (the one `.strict()` schema here): dropping it silently would let a client believe a move succeeded
  - `/admin/levels`, `/admin/taxonomy` and the new `/admin/levels/{id}/subjects` screen are live; the contract-derived Pending-denial suite grew by 11, one per operation
- [x] **Room CRUD frontend** — zero new backend: all eight Branch/Room routes already existed
  - A dialog behind each branch row, not a sibling list: §14.1 names one node, and a room has no meaning apart from its branch
  - Offered to an Admin as well as a Super Admin — an Admin reads this screen because scheduling depends on knowing which rooms exist
- [x] **User management backend** — `PATCH /admin/users/{id}`, `POST .../suspend`, `POST .../reactivate`, `PUT .../roles` (drafted as `SRS-PROPOSAL-R48.md`)
  - **Suspension is a verb, not a field**: TD-4.15 binds it to revoking every live session in the same transaction, so `account_status` is refused on the edit rather than dropped
  - `PUT .../roles` replaces the whole set — one call, one decision, one audit row, and no window where a user holds half a change
  - **`super_admin` is grantable here** (R22: administrator changes happen exclusively through the application), guarded by `LAST_SUPER_ADMIN` and `SELF_SUSPENSION`
  - A role change deliberately does **not** revoke sessions — R10 accepts the window, and §7's `RefreshRevokedReason` has no value that honestly describes a demotion
  - `check-display-identity.sh`'s exception is now **symbol-scoped rather than file-scoped**, proven by reintroducing the bug
- [x] **`/admin/users` screen** — search, filter, create, edit, roles, suspend, reactivate. **Zero backend change**
  - Suspension is a separate control from edit, mirroring the API: it ends every live session (TD-4.15), so it asks for a reason and says so
  - Roles edited as a **set**, matching the `PUT` — one decision, no window where a person holds half a change
  - TD-10's two-character floor applied before the request; every filter change resets to page 1
  - Each `409` reason gets its own sentence — the remedies differ completely
  - **P1 found while probing the running stack:** the `LAST_SUPER_ADMIN` test had revoked real seeded `super_admin` assignments and left the dev database with **none**, all tests green. Fixed three ways (borrow `account_status` not the grant · restore in `finally` · `afterAll` asserts the platform is still administrable) and recorded in `development/testing.md`
- [x] **Staff registration workflow** — audited first; **no endpoint added** (drafted as `SRS-PROPOSAL-R49.md`)
  - Admins/Super Admins creating staff was **already complete** via `POST /admin/users` pre-provisioning (§4.1's first-class staff path)
  - The only missing datum was **what the applicant asked to be**, so the queue could not tell a teacher applicant from a family registration
  - `requested_role` accepts only `teacher`, enforced by Zod **and** a database CHECK — widening it is a revision, not a code change
  - **Branch scope is never collected at registration:** a role's scope is an authorization boundary (TD-2), and collecting it would let an applicant propose the extent of their own permissions
  - Role + scope granted **in the approval transaction**, through the same `applyRoleAssignments` the Users screen uses — approval cannot become a weaker path to authority
- [x] **§4.1 (R43): approval assigns Levels, Groups and writes the Enrollments** — the gap found in the R49 audit
  - Built by extracting `enrolInGroup` from `enrolStudent`, so approval places students by the **same rules the roster screen uses** — branch scope, §4.4b sex restriction, BR-21, consent re-evaluation
  - **An approval that would leave a student unplaced is refused** (`ENROLLMENT_REQUIRED`, naming who). Who must be placed is derived from the bundle; a staff request enrols nobody
  - Only people in the bundle may be named (`NOT_IN_BUNDLE`), or approval would be an unscoped enrolment endpoint
  - ✓ **Deviation closed (Owner decision, 2026-08-05):** registration now records `intended_category_id`, so §4.1 step 1's preselection works — the Level list filters to the stated Category and its first Level is preselected, with *any Category* one click away
  - Category dropdown is the **live Categories ordered by `display_order`**, read from the public `/calendar/bootstrap` — no new endpoint, no hardcoded list
  - Required for a student, **refused for a staff request** (a teacher is admitted to no Level)
  - **Deleting a Category is refused while pending requests reference it**; decided ones never block, and the soft delete keeps them readable
- [x] **Public Educational Library frontend** — the mock adapter replaced by `GET /library`
  - The mock's promise held: **only its two exported functions changed** — no component, page or test touched it
  - `GET /library` now resolves the §5.2 headings (`category_name`, `level_name`, `subject_name`, `academic_year_label`, `branch_name`) because **no public endpoint publishes Subject or Academic Year names**; self-sufficient, as TD-3.4 already requires of the calendar
  - **No per-level counts** (no aggregate exists — a count from page one would be a claim) and **no teacher attribution** (`EducationalContent` records no uploader; deferred Owner decision)
  - `kind` derived client-side from the MIME type: §14.6 is a *presentation* rule, and presentation is the client's job
  - Note: the public calendar's *screen* filters (branch · category · level) stay identical for everyone and are compliant. Adding TD-3.4's `subject_id`/`teacher_id`/`academic_year_id` to a **public** screen would need public reference lists that do not exist — `/admin/subjects` is Admin-only by design

### R91 — effective-dated teaching staffing (2026-08-19)
- [x] **SRS Revision 91** + migration `20260819230000_r91_effective_staffing`. `effective_from`/`effective_until`, inclusive calendar dates, `NULL` open-ended
- [x] **No backfill, nothing fabricated** — a pre-R91 row's two NULLs already meant *the schedule's whole life*. Proved by **1349 existing integration tests passing unchanged** on the migrated schema
- [x] `@@unique(schedule_id, user_id)` **withdrawn** — it refuses the case R91 exists for. Replaced by two interval invariants under a `FOR UPDATE` lock; `btree_gist` declined per §28
- [x] **One shared resolver** `policies/effective-staffing.ts` — `effectiveOn` · `effectiveWithin` · `staffForScheduleOn` · `effectiveSchedulesForTeacher`. No second date predicate anywhere
- [x] **History is never rewritten**: materialization snapshots per occurrence date; resync reaches only future un-overridden ones; `SessionStaff` overrides the schedule always
- [x] Every consumer time-aware, **each one's date documented** in the new [teaching-authority](development/teaching-authority.md) page
- [x] **Defect closed:** `studentsTaughtBy` gained an occurrence arm — R87 §J opened «إدخال الحفظ» for a cover while the resolver handed her an empty roster (rule P inverted)
- [x] UI: `StaffingPeriods` for a class · «مؤطّرة هذه الحصة» for a one-off cover · three refusals each in Arabic. New rule **AS**
- [x] R90's conflict query now needs **both** halves — the limitation R90 recorded is closed
- [x] 222 backend unit · 1373 integration · 613 frontend · 13/13 new browser checks · 18 CI guards · OpenAPI current
- [x] **`verify-staff-picker` closed 2026-08-20 — 13/13.** Harness defect (`===` against the shared add-Button's `＋` prefix) on top of R91's intentional control change. Fixing it exposed a **real regression**: the periods editor rendered bare names, dropping R90's *marked before the choice* half. `markedLabel`/`Warnings` now shared and guarded
- [x] **All 20 harnesses green in one pass — 460 checks** (plus `measure-page-header`'s 9 widths)
### Teacher scheduling merge + responsible=self (2026-08-20)
- [x] **One node «الجدولة»** — the shared `PersonalCalendar` plus her classes table; `/teacher/calendar` still renders it so links survive
- [x] **Responsible = self, enforced server-side** (`RESPONSIBLE_MUST_BE_SELF`); she may now set assistants on the event she answers for, and only that one
- [x] **`GET /me/event-staff-options`** — the narrow read that makes it reachable; `/admin/users` still refuses her (rule O)
- [x] Four guards restated with their reasons: registry list · R84 filter matrix source · two portal checks
- [x] 643 frontend · 222 backend unit · 1403 integration · TD-3 + OpenAPI current
- [x] **The activity SAVE is proven — `verify-teacher-scheduling` 6/6** (2026-08-20). Three causes, all captured from the wire: an unset scope submitted as an empty id · her scope selector fed by `/admin/levels` (403 for her) · the assistants control disabled for her. Plus a platform-wide defect: the shared `Button` had no `type`, so every one inside a form submitted it
- [x] **R93 — assistant-assignment notification** (2026-08-20): `event_staff_assigned`, automatic, newly-assigned only, re-assignment resurfaces, actor excluded. Proven in the assistant's own bell (9/9)
### R94 — the مؤطرة's scheduling types (2026-08-20)
- [x] `＋ إضافة عنصر` offers **نشاط + امتحان**; `حصة` stays Admin-only, and the reason is §4.4c self-escalation rather than caution
- [x] Her exam's scope comes from **«الحصة المعنية»** — one of her own classes — because the curriculum chain answers 403 for her. No new endpoint
- [x] She supervises the sitting she organises, locked to one name; the server refuses anything else
- [x] `verify-teacher-scheduling` **12/12** · 643 frontend · 222 backend unit · 1412 integration
### Shared occurrence details + direct content (2026-08-20)
- [x] **The dialog was never duplicated — it was never opened.** Three of four calendars discarded the click; all four now open the shared component. New rule **AT**
- [x] **التسجيلات** and **المواد المرفقة** are separate sections with separate empty states, and neither claims anything before a 200
- [x] «فتح صفحة الحصة وموادها» removed from the dialog; the combined sentence deleted from the catalogue
- [x] `verify-occurrence-details` **13/13** across public/Admin/مؤطرة/beneficiary · 655 frontend
### Section C — Quran progress entry (2026-08-20)
- [x] **إدخال الحفظ in the back office** — `/admin/quran`, the same workspace the teaching portal renders. Rule P, seventh instance
- [x] **مراجعة no longer inflates memorisation** — the canonical engine, not the UI. ⚠ needs an SRS revision to become normative wording
- [x] **R92's Quran occurrence arm actually connected** — it was named in a docstring and never wired
- [x] `LevelSurah` normative for entry; `level_id` validated and audited, deliberately not stored
- [x] Shared `ProgressBar`; حفظي shows the whole syllabus, grouped by Level
- [x] **Backend CI typecheck was red on `develop`** — 12 pre-existing errors fixed
- [x] 26 new integration cases · 16 frontend guards + 1 CI shell guard (the CSS invariant cannot live in vitest) · `verify-quran-entry` **24/24** · 19 CI guards · 25 browser harnesses / 556 checks
- [x] **SRS Revision 95** ratifies the memorisation-vs-revision semantics — `new_memorization` alone feeds coverage, `revision` is recorded and never inflates it, BR-13's merge and BR-11 unchanged in substance
### R99 — an online class MAY be recorded (2026-08-21) — SRS gate only

- [x] **BR-2 checked against the Owner's STOP condition** — it governs ACCESS, not capture (`SRS.md:813-818`, `:1079`), so **no** per-participant consent workflow
- [x] **§4.9's "Video remains excluded entirely" qualified IN PLACE**, not rewritten — still in force for uploads; R99 admits a **provenance**, not a file type
- [x] **TD-9 +1 row**, reachable only by the ingestion pipeline: `video/mp4`, 500 MB, same magic-byte + delete-on-mismatch verification. `/uploads/*` still refuses `video/*`
- [x] **`EducationalContent.origin`** (`uploaded` | `session_recording`) specified — reusable semantic field, **no separate recording table**
- [x] **Backfill rule specified**: audio + live `SessionContent` link → `session_recording`; everything else `uploaded` — reproduces today's screens exactly
- [x] Recording is **optional and explicit**; `دخول الحصة` never records; `جاري التسجيل` visible to every participant including latecomers
- [x] Provider output is temporary; **a provider URL is never the content asset**
- [x] **C1 — COMPLETE (2026-08-21)**
  - [x] Migration `20260821090000_r99_recording`; backfill verified **12 uploaded + 1 session_recording**
  - [x] `SessionRecording` lifecycle entity + written-out state machine; **partial unique index** = one live recording per occurrence
  - [x] **Redis + real LiveKit Egress** in the dev overlay; LiveKit moved to a config file for Redis + webhooks
  - [x] Optional and explicit — **a class ran with three people and nobody recorded it: no row, no job, no file**
  - [x] مؤطِّرة/assistant parity; administrator in scope; **beneficiary 403 but still sees «جاري التسجيل»**
  - [x] **Server-side capture proven**: the harness closes the starter's tab and the recording keeps running
  - [x] **Real media both ways**: صوت وصورة → 5.6 MiB MP4 · صوت فقط → 141 KiB OGG, verified by extension and byte count
  - [x] Signature-verified callback over the raw body; idempotent against duplicate and out-of-order delivery
  - [x] Defects: browser-vs-server provider URL · simultaneous start · orphaned egress · a failure path that could itself fail · missing `starting → stopping`
  - [x] 23 backend lifecycle · 17 HTTP wire · 30 frontend · `verify-livekit-join` **61/61**
- [x] **C2 — COMPLETE (2026-08-21)** — ingestion, storage import, `EducationalContent` + `SessionContent`, «التسجيلات» rendering, beneficiary visibility ladder, failure/retry
  - [x] **R75.6 naming is SERVER-computed** (2026-08-21) — one algorithm, one namespace per Session; the browser composes nothing and shows an editable suggestion. Latent UTC-date defect fixed on the way
  - [x] **«التسجيلات» is `origin`, not MIME** — an uploaded audio file is a material; a `video/mp4` session recording is a recording. Three guards restated
  - [x] **R99.12 upload marker** — `content_meta.origin`, bound into the ticket, describes and never permits: `video/*` still refused for both values
  - [x] **Migration `20260821140000_r99_recording_ingestion`** — nullable UNIQUE `educational_content_id` + `ingestion_failure_reason`. «متاح» is DERIVED from the relation, never a stored status
  - [x] **Shared TD-9 validator** — `verifyObject` decoupled from `UploadTicketClaims`; one whitelist behind two doors, `video/*` still refused at `/uploads/*`
  - [x] **Server-side storage primitives** — stat · ranged head · `CopyObject` **inside MinIO** · delete. No 500 MB through Node
  - [x] **`session-recording-ingest`** — same-transaction enqueue from the verified callback, singleton per recording; the webhook persists and returns
  - [x] **Worker** — verify actual bytes (incl. media family) → durable copy → `EducationalContent` + `SessionContent` → link → sweep staging last
  - [x] **R99 staging-cleanup recovery** — a post-commit delete failure now keeps the existing ingest job retryable; relation-first retries perform only the exact idempotent staging delete, survive worker restart, and never target canonical or unrelated objects
  - [x] **Idempotent under duplicate callback, retry and concurrency** — one object, one content row, one link, no false suffix increment
  - [x] **Defect found by C2's tests:** the transition table conflated *already there* with *just moved*, so a re-delivered completion enqueued a second job
  - [x] **`verify-livekit-ingest` 27/27** — the real «بدء التسجيل» button; a **27 s / 338 KB OGG** and an **11.4 s MP4** genuinely decoded by a real media element (`readyState`/`duration`), not merely fetched
  - [x] **Tab closed WHILE recording, and she never returns** — capture continues and the whole import happens with nobody watching
  - [x] **The URL is Bodour's, never `recordings-staging`**; a reload mints a fresh one and it still plays
  - [x] **The negative is a DIFFERENT Level** — same-Level-other-branch is a positive under §4.9, so the scenario gained مستفيدة ج. 404, never 403
  - [x] **R99.8 from both sides in one run** — the imported MP4 plays; an uploaded MP4 is refused, `origin` marker or not
  - [x] **SRS Revision 100 (2026-08-21) — the TD-7 gap C2 reported is CLOSED.** R99 authorised the pipeline without naming a queue and §20 rule 1 forbids every in-memory substitute, so C2 built `session-recording-ingest` and **reported the omission instead of inventing a normative row**. R100 adds that row and nothing else, and makes normative what C2 already did: the callback **persists and enqueues, never ingests**; the order **verify → server-side copy → content → link → relation → staging swept last**; retries idempotent on the nullable UNIQUE `educational_content_id`. **Documentation-only — the implementation already conformed, and was not touched to manufacture a diff**

### R98 — entering a class عن بُعد (2026-08-20)

- [x] **The durable rule:** بذور الأمل authorizes; the media provider executes the media session. Never the reverse.
- [x] **`POST /sessions/{id}/online-join`** — one route, **empty `.strict()` body**; identity, room, role, permissions and expiry all derived server-side
- [x] **Room DERIVED from the Session, never stored** — no column, no `OnlineRoom` table, no migration (R97.9 holds by construction)
- [x] **One narrow provider seam** (`lib/online-class-provider.ts`) + `check-provider-seam.sh`, proved against all three defects it exists for
- [x] **Authorization reuses the canonical resolvers** — `audienceForSession` (R92), `staffsSession` (R91), `resolveActingStudent` (§4.3), branch scope (TD-2). No second audience query.
- [x] **Refusals proved, each for its own reason** — expired مؤطِّرة · future مؤطِّرة · R88 capability-only · unrelated beneficiary · forged/revoked child · in-person occurrence · outside the window
- [x] **Assistant parity** and a **one-off cover** confined to its occurrence
- [x] **Guardian enters AS THE CHILD**; no beneficiary role granted
- [x] **Join window** −15 min … +30 min, server time; no timeless credential; window checked **after** authorization so a stranger learns nothing about the timetable
- [x] **Minimum permissions**: no moderation for a beneficiary or an administrator; `audio_only` permits **the microphone alone**, on the credential
- [x] **One classroom for every portal** at `/classroom/{id}`; audio-only is a listening surface and never requests a camera
- [x] **Defect found only in a browser: §3.1's CSP blocked the media server** — and needed BOTH schemes, because the client validates over HTTP before upgrading. `nginx/snippets/media-origin.conf`.
- [x] **Defect: a `SessionStaff` cover on a non-overridden occurrence is resynced away** — the fixture was writing a state the platform cannot reach
- [x] **Defect: a fixture's «today» was UTC's, not the association's** — local weekday, UTC date; broken for the first hour after local midnight
- [x] Tests: 38 backend integration · 9 HTTP wire · 23 frontend · 1 new CI guard
- [x] Browser: `verify-livekit-join` **46/46** against a **real local LiveKit** — a genuine three-party room through the real screens
- [x] `livekit-server-sdk` 2.18.0 · `livekit-client` 2.22.0 · `@livekit/components-react` 2.9.24 · `@livekit/components-styles` 1.2.0, all exact, no new advisories
- [x] TD-13 gains three **grouped-optional** settings — all three or none; half-configured is refused at boot

**Deliberately NOT built (next section):** Egress, Redis, recording start/stop, webhooks, a recording job entity, import of recordings as `EducationalContent`.

### R97 — a class is delivered حضوري or عن بُعد (2026-08-20)

- [x] **Delivery domain, provider-independent** — `delivery_mode` + `online_media_mode` on schedule and occurrence, migration `20260820180000_r97_delivery_mode`, 14 schedules / 773 sessions backfilled to `in_person`
- [x] **One inheritance mechanism reused** — schedule default → materialize snapshot → `Session.overridden`; no `delivery_overridden` column
- [x] **An online occurrence holds no room**, by CHECK — so room-collision detection needs no special case; staff-time conflicts unchanged
- [x] **R91 staffing and R92 audience proved untouched**; Branch remains administrative scope
- [x] **One shared `DeliverySection`** for the class form and the occurrence editor; hidden means cleared
- [x] **Defect: the calendar wire DTO dropped the new fields** — found in the browser, fixed, and now guarded by an exact key-set assertion
- [x] Tests: 32 backend integration · 21 frontend · 2 new wire-contract cases · 4 exact-key guards restated
- [x] Browser: `verify-delivery` **24/24**; all 29 harnesses green (**612 checks**)
- [x] **Provider decision recorded, not implemented** — LiveKit for MVP (`online-class-provider.md`), with the Egress/Redis and MinIO-reachability findings
- [x] `qrcode`/`@types/qrcode` re-pinned exact, per repository dependency policy

**Deliberately NOT built (next section):** rooms, tokens, joining, recording, egress, import of recordings as `EducationalContent`.

### R96 — one QR identity per platform person (2026-08-20)
- [x] **Beneficiary-only QR rejected before implementation** — the unit of identity is the person
- [x] Audit cleared the STOP condition: children and teens are already full `User` rows
- [x] `user_qr_ref` `NOT NULL UNIQUE` on every User, DB-defaulted so no creation path can forget
- [x] Backfill: 15 users · 15 with QR · 0 NULL · 0 duplicate
- [x] Role-, enrolment- and family-link-independent; stable across soft delete and restore
- [x] One shared `UserQr`; `/profile` = account holder, beneficiary view = acting student
- [x] 7 unit · 15 integration · `verify-user-qr` **11/11** · 19 CI guards
- [ ] **Owner decision**: should every beneficiary carry a spoken `referenceCode`? (R62 gap)
- [x] **Fixed (R96.1)** — a `parent`-only account acting for a linked child now reaches every beneficiary screen through the shared gate; no role widened, new rule **AW**, `verify-guardian-child` **12/12**
- [x] **NEXT**: one shared occurrence-details dialog (§9–§10) · direct Session recordings/materials (§11–§15) · beneficiary QR (§16–§25) **[Closed 2026-09-21 ledger review — all three shipped: shared occurrence dialog (`verify-occurrence-details` 13/13), Session recordings/materials, R96 QR]**

### Notification root causes + landing pages (2026-08-20)
- [x] **Level cancellation root cause**: the resolver was right. The only beneficiary in that Level+Branch was the Owner's own account, excluded as the actor (R78.3) — so the send reached nobody and said «أُرسل الإشعار إلى 0» which reads as success. **Zero now answers explicitly.**
- [x] **Grade republish root cause**: two blockers — only newly-drafted rows were offered to the notifier, and `skipDuplicates` absorbed the rest. New semantics: one row per (student, exam), **unread again when the score changed**, silent when it did not
- [x] Student landing = title + lede only; مؤطرة landing loses «ستُضاف لوحة مختصرة هنا لاحقاً», from the page and the catalogue
- [x] `verify-notify-ui` **32/32**; 643 frontend · 222 backend unit · 1399 integration; all 23 browser scripts green (508 checks)
- [x] **NOT STARTED — the rest of this brief**: merged Teacher calendar/scheduling (§8), Teacher event creation with responsible=self (§9, §21), assistant assignment notification (§10, §11), one shared occurrence-details dialog across all four calendars (§12, §22), direct Session content in that dialog (§13, §14), beneficiary QR identity (§15–§19). Each is its own slice with its own migration/UI/tests **[Closed 2026-09-21 ledger review — each item was later built and ticked in this section and R93/R96]**

### Notifications — verified through the UI (2026-08-20)
- [x] **`verify-notify-ui` — 27/27.** Real dialog, real button, recipient's own bell. Cancel (with and without reason) · decline · reschedule · Event · grade draft/publish · R91 replacement recipients · R92 cross-branch · mark-read · reload
- [x] **Defect fixed:** a failed notice could not be retried — the copy said «يمكنك المحاولة لاحقاً» while `finally` closed the dialog. Both notice dialogs now stay open on failure
- [x] **Guard added:** the Prisma enum, the frontend union and the Arabic headlines must agree — proved against the defect
- [x] **`verify-notifications`'s real scope stated**: it POSTs to `/notify`, so it proves the audience and not the flow. That gap is why it was green while manual use was not
- [x] All 23 browser scripts green — **503 checks**

### The assessment library, reuse, and the fixture leak (2026-09-04)
- [x] **`GET /assessments` — the library that did not exist.** A created paper had no route back to it; drafts, published and closed papers now all list, scoped exactly as `GET /exams` is
- [x] **`examScopeWhereForTeacher` pinned a branch an online paper never has** — a مؤطِّرة's library was empty. The assertion half knew; the list half had not grown the rule
- [x] **`POST /assessments/{id}/copy`** — the wording again, never the answers. Historical integrity from copy-on-reuse rather than a versioning scheme
- [x] **Zero audience is stated before publication**, not refused: publishing then admitting students is legitimate (R122)
- [x] **«عن بُعد — قريباً» retired** — untrue since R124, and rendered twice from one component
- [x] **The run-unique fixture tag leak**, swept by age with a shared sweeper and a guard that repairs as well as reports
- [x] **Ratified as SRS Revision 134** (2026-09-08, after Revision 135): `assessment_published`, the paper-as-resource rule, reviewable reuse, zero-audience

### Reuse and copy stay one safe operation, and a copy's target/date became reviewable (2026-09-08, R134)
- [x] **`Exam.source_exam_id`** (nullable, `ON DELETE SET NULL`) — provenance only, read for the library/detail's «نسخة من» / «استُخدمت N مرة»; never consulted for authorization, the freeze, targeting, grading, publication or deletion, and shares no mutable state
- [x] **`PATCH /assessments/{id}/target`** — the gap the Owner's reconciliation surfaced: a copy's target/date were seeded from the source with no way to review or change them before publishing. Reuses `createAssessment`'s exact target resolver and validation; TD-15 versioned; draft-and-unfrozen only; refuses to change the Level
- [x] **Two entry points, one backend operation**: «استخدام مرة أخرى» opens straight to that review; «إنشاء نسخة» opens the question editor first. Both call the identical `POST /assessments/{id}/copy`
- [x] Backend: 11 new integration assertions (provenance exposure/invisibility/no-authority, retarget success/scope/version/transition/validation). Frontend: 5 new source-guard assertions; full suites green (backend 81/81 assessment + 66/66 journey; frontend 1079/1079)

### The admission-to-achievement journey (2026-09-04)
- [x] **The whole business flow, through the real routes**: registration (مؤطِّرة + adult مستفيدة) → approval → two enrolments → online assessment on LEVEL A → publication → notices → save/resume/submit → marking → grade publication → memorisation. 66 assertions in `backend/src/controllers/journey.integration.test.ts`
- [x] **The defect it existed to find**: `publishAssessment` notified nobody. Fixed with `assessment_published`, reusing `examAudienceWhere` for the audience and `assertExamInTeacherScope` for the staff — no second predicate, no second subsystem
- [x] **Two enrolments prove targeting**: one notice, one roster row, one grade, and a LEVEL-B-only control who receives and reaches nothing
- [x] **The Quran boundary held rather than bent**: a مؤطِّرة may not create a course schedule (§4.4, `assertCanManage`); the Super Admin organises it and she delivers it
- [x] **Browser: 14/14** through the bell, the deep links, her marking surface and إدخال الحفظ — fixture cleaned from a `trap`
- [ ] **Owner decisions, non-blocking**: expose `tracks_quran_progress` on `GET /admin/subjects`; decide whether `GET /quran-students` should refuse a beneficiary rather than answer an empty roster

### C-01 — Event cancellation notification (2026-08-21)
- [x] The ordinary Event delete commits first; only an activity then offers the optional R82.5 notification decision. Decline sends no request. Classes/exams and Session R77/R83 behavior are unchanged
- [x] `event_cancelled` reuses the existing route, adapter and Event audience resolver. The deleted Event's authoritative Trash scope and live Event staff freeze the audience without a schema, migration or second Event copy
- [x] Only the recorded deleter can send after deletion; an unrelated valid administrator gets `404`. Repeat sends are idempotent and unrelated recipients receive nothing
- [x] Focused verification: 27 backend HTTP integration tests · 8 frontend decision-flow tests · `verify-notify-ui` **37/37**, including the real DELETE-before-notify request order and the recipient's own bell

### R92 — cross-branch occurrence audiences (2026-08-20)
- [x] **SRS Revision 92** + migration `20260820010000_r92_session_audience_branch`. `SessionAudienceBranch (session, branch)`, **replacement** semantics
- [x] **Physical location and audience are separate facts** — `Session.branch_id` untouched; the roster reports venue and audience side by side
- [x] **One resolver** `audienceForSession`, composed by calendar · roster · notifications · audit count. No independent cross-branch `OR` anywhere
- [x] Whole-Level only; the other modes are **refused**, and the Group/Circle variant is an open Owner question rather than an invention
- [x] **The counterpart Session is never guessed** — two schedules are structurally independent, so the administrator cancels it explicitly
- [x] Admin UI «الحضور من الفروع» on the occurrence, seeded with the inherited branch; roster shown, not inferred
- [x] 20 API tests · 10 frontend guards · **16/16** `verify-cross-branch` across six identities · concurrency on the Session's own version
- [x] 1395 integration · 222 backend unit · 623 frontend · 18 CI guards · OpenAPI current, TD-3 +2 routes
- [x] ~~NEXT — cross-branch occurrence audience (§D)~~ **DONE.** Deliberately NOT started: the Owner's brief instructs re-checking capacity before D and stopping after C with a clean tree if D cannot be completed whole. It needs its own migration (a `Session` audience override), one shared audience resolver, the counterpart-Session decision, UI, tests, browser verification and docs **[Closed 2026-09-21 ledger review — the line itself says DONE; R92's section above is fully ticked]**

### R90 — staff-picker planning warnings (2026-08-19)
- [x] **SRS Revision 89** closes the §14.1 gap: `/admin/teachers` is in the sitemap, with the three ownerships stated
- [x] **SRS Revision 90 + `GET /admin/teaching-candidates`** (TD-3 registered, OpenAPI generated). Four appraisals; **the list is never shortened and nothing is disabled**
- [x] Rendered on the **shared `StaffPicker`** — marker on the option before the choice, named chips under the control after it, silence for a clean candidate
- [x] **Recurrence-aware**: every occupied weekday must be covered, `daily` = seven, `monthly`/`yearly` = *indeterminate*, alternating series collide only on shared anchor parity. No second recurrence engine
- [x] **Both halves of R88.3 proved** in the API and in real Chrome: هـ with no profile teaches once assigned; أ with a flawless profile teaches nothing unassigned
- [x] **Defect fixed:** class staffing was refused on UPDATE while the form offered the controls — now replaced whole, future occurrences resynced, past ones untouched
- [x] **Defect fixed:** `ClassSection` hand-wrote the picker (rule C) — the extraction had been written down and only two thirds applied
- [x] QA inventory reconciled: **447 checks across 19 harnesses**, every count measured. Three harnesses were repaired first — see CHANGES.log
- [x] **NEXT SLICE — effective-dated staffing.** `CourseScheduleStaff` is time-blind: conflicts are bounded only by the schedule's `deleted_at` and R50's `effective_until`, and *A until 15 November, B from 16 November* cannot be expressed. R90 takes the proposed class as input and reads staffing through **one** query, so bounding that query by a date range is the whole of the change **[Closed 2026-09-21 ledger review — built as R91 — `effective_from`/`effective_until`, migration `20260819230000_r91_effective_staffing`]**

### R88 correction — إدارة المؤطِّرات gets its own screen (2026-08-19)
- [x] **The row action left `المستخدمون`.** A teaching profile was offered on a screen whose population is every account — guardians, minors, administrators. The backend is untouched; only ownership moved. New rule **AQ** in [ux-architecture](development/ux-architecture.md)
- [x] `/admin/teachers` under الشؤون التعليمية, beside `التسجيلات`: the section now holds the people being **taught** and the people **doing the teaching**
- [x] **Population asked of the server** (`role=teacher`), never `is_beneficiary` as an exclusion — a مؤطِّرة who also studies is listed, proved in the browser and at the API. `role=teacher` and `beneficiaries_only` are **complements**
- [x] **The R88 dialog reused unchanged** — one teaching-profile editor, asserted by a source scan
- [x] **Weekday i18n root-caused:** `calendar.weekday.*` never existed (labels live at `scheduling.weekday.*`), and `resolves.test.ts` scanned only *quoted literals*, so a computed key was invisible to it. The guard now resolves every **computed** key's namespace, and was proved against the defect before the fix
- [x] Time inputs use the platform's `TextField` + `scheduling.timeHint` — the same control `RecurrenceEditor` uses for the same value; a hard-coded «HH:MM» is gone
- [x] 13/13 browser checks; 14 frontend tests; 5 backend HTTP tests. **Two harness defects found and fixed**: it searched the whole document for the row action and opened the wrong مؤطِّرة's profile, then read her stale data as persistence; and it clicked each row's last button to "open a menu" that `DataTable` does not have — on `المستخدمون` that button is «إيقاف الحساب»
- [x] **§14.1 gap closed — SRS Revision 89** (2026-08-19): the node joins the Academic group, and the revision states the three ownerships (`المستخدمون` = accounts · `التسجيلات` = beneficiary placement · `إدارة المؤطِّرات` = teacher planning). **R88 semantics untouched**; TD-2 gains no row and TD-3 no route

### Admin Dashboard — session management and content (Owner priority, 2026-08-05)
- [x] **Recurrence edit scopes — APPLIED to `docs/SRS.md` as Revision 50** (Owner-authorised direct edit, 2026-08-05). The SRS is the source of truth; `SRS-PROPOSAL-R50.md` is retained for the rationale
  - *This session only* and *all sessions* are **already built**; only *this and all future* lacked a mechanism
  - Implemented as a **schedule split**, not an exception model: the platform already materializes every occurrence and marks the overridden ones, and §4.4 computes conflicts against sessions rather than rules
  - Needs one column: `effective_until` (nullable calendar date; `NULL` = open-ended)
  - **No new endpoint** — `scope` + `from_date` on `PATCH /admin/course-schedules/{id}`
- [x] **Admin Calendar — Event CRUD** (`/admin/calendar`). **Zero backend change**
  - The list dedupes `GET /calendar` occurrences by event id — **no `GET /events` was invented** (§20 r16)
  - The date window is a real input: the endpoint is date-bounded, and the screen says what it is showing
  - Scope on create only, mirroring the server's refusal of scope keys on `PATCH`
- [x] **R50 backend — `effective_until` and the schedule split**
  - The bound lives in `expandSchedule()` **and nowhere else**; it is a second upper bound beside `horizonFor()` and the earlier wins
  - One transaction: close the original, create the successor, **copy the staff**, release the unprotected future sessions
  - The original is closed **before** the successor's conflict check, or it collides with the half it replaces
  - The successor **inherits** `effective_until`, so splitting a bounded series does not make its tail unbounded
  - 7 tests including the §18 criteria; `all_sessions` proven unchanged
- [x] **Session management UI** — all three R50 scopes, at `/admin/schedules/{id}/sessions`
  - Needed one endpoint: `GET /admin/course-schedules/{id}/sessions`, a **sibling of `/conflicts` and `/roster`**. `GET /calendar` could not serve it — it omits `schedule_id` on the public surface, and widening a public payload for an admin need is the pattern rejected twice before
  - Rows carry `protected_reasons`: §4.4 requires the dialog to say what will change, which needs knowing what will be spared
  - The scope is asked before **every** operation that can reach a series, with a live count, and stated before confirming
  - The date moves only under *this session only* — the wider scopes edit a rule, and a rule has times but no date
- [x] **TD-3.5 storage endpoints** — **the note was stale**, verified 2026-08-28.
  All four are mounted in `app.ts`: `POST /uploads/initiate`,
  `POST /uploads/{uploadId}/complete`, `POST /uploads/{uploadId}/abort` and
  `GET /content/{id}/download-url`.
- [x] **Educational Content upload UI** — also stale. `ContentUploadForm` ships on
  مكتبة المحتوى and `SessionMaterialsDialog` attaches to a Session.
  `verify-content-visibility.sh` performs a **real upload** end to end and removes
  its own row afterwards (24/24).

- [x] **Rooms CRUD** — verified complete (shipped M3b-30); added the missing delete confirmation that every other destructive action already had
- [x] **Trash UI (`/admin/trash`)** — SRS Revision 52 applied; list, filter by type and date, search, restore **per entity type**
  - `restorable` is a **server** decision on every row: a client cannot know which deletions cascade
  - Restorable: `User` (R111), `Branch`, `Category`, `Subject`, `Room`, `Exam` and
    `HijriMonthStart`; future Exam staff are revalidated transactionally before revival
  - Blocked types state **why**, rather than silently omitting the action
  - Guards the SRS did not name: `PARENT_DELETED` and `ALREADY_PURGED`
  - R59.1 later added server-declared, audited permanent deletion; User remains
    de-identification, never row destruction
- [x] **Widen the remaining restorable set** **[Closed 2026-09-21 — built, R169 §8 — Level, TeachingGroup and RecurringCourseSchedule restore with what their deletion took; the other cascading types stay read-only and say so]** — each type needs its TD-5 cascade reinstated and
  tested before it joins: `Level` (its Administrative Groups), `TeachingGroup` (member seats),
  and `RecurringCourseSchedule` (future Sessions). Until then the screen says so per row

**Gates
- [ ] §18 *Educational Model* checklist green — including the §19.2 named regressions: composite-FK rejection **attempted directly in SQL**, weekly-vs-biweekly conflict on the alternating week, double-`materialize` idempotency, schedule edit sparing an overridden session, and anonymous-vs-authenticated parity on `/calendar` and `/library`

## M4 — Quran Progress
- [x] QuranProgressLog CRUD (teacher-scoped) with soft delete (TD-5) **[Closed 2026-09-21 ledger review — built as M4a, below]**
- [x] Interval-merge union engine + percentage vs total_ayahs (BR-13) **[Closed 2026-09-21 ledger review — built as M4a, below]**
- [x] StudentSurahProgress cache: post-commit upsert + read-side stamp guard with self-heal (§4.5, §7) **[Closed 2026-09-21 ledger review — built as M4a, below]**
- [x] Synchronous per-surah recalc on create/update/soft-delete — derive-on-read immediately after commit, returned in response (§4.5, TD-4.11) **[Closed 2026-09-21 ledger review — built as M4a, below]**
- [x] Ayah bounds: CHECK + cross-table trigger + service validation (TD-6) **[Closed 2026-09-21 — STALE: all three layers exist — the CHECK and `quran_log_ayah_bounds_check()` trigger in `init_schema`, and `AYAH_OUT_OF_RANGE` / `INVALID_RANGE` in `quran.service.ts`]**
- [x] Audit rows quranlog.update / quranlog.delete (TD-8) **[Closed 2026-09-21 — STALE: `correctLog` and `deleteLog` both write them (`quran.service.ts`); one detail TD-8 names — the recalculated coverage — is not in the row, because the recalculation runs after the transaction]**
- [x] Student read-only per-surah expandable progress view (§5.3) **[Closed 2026-09-21 ledger review — built as M4b — `/dashboard/student/quran`]**
- [ ] p95 < 100 ms incl. recalc verified (TD-11a)
- [ ] §18 Quran Progress checklist green (incl. deletion-un-completes-level test)

## M5 — Exams & Grading
- [x] **Exam builder — BUILT by R124**, in the shape the ratified revision states
      rather than this line's: **four** question kinds (short text, long text,
      UCQ, MCQ) with an optional or required justification on a choice question,
      each question an immutable **row** with an explicit `display_order` rather
      than a UUID inside a JSON array — a blob could not make ordering stable,
      could not let an answer reference the option it chose, and could not refuse
      the deletion of an answered question. Print CSS remains post-MVP §10.1.
- [~] **Submission lifecycle — BUILT by R124; `access_policy` is NOT consumed.**
      `in_progress → submitted` is live, save is separate from submit, and
      submitted is final for the student (no reopen in v1). **`single_submission`
      vs `save_and_resume` is a column nothing reads**: v1 gives every assessment
      save-and-resume, and enforcing the other mode is unbuilt. Recorded as a gap
      rather than ticked, because the column exists and would read as honoured.
- [x] ~~All scores as integer bp~~ — **SUPERSEDED by R81.** `Grade.score` is
      `NUMERIC(6,2)`, the mark as given out of the exam's own `max_grade`; there
      is nothing to normalise against and so nothing to round. §20 rule 3's
      prohibition on **float** arithmetic stands and is better served by exact
      decimal.
- [~] **Absent-zero rows — BUILT** (BR-7): initialised at the teacher's first
      draft save, against the exam's audience. **MCQ auto-grade — EXPLICITLY
      EXCLUDED by R124**: v1 marks everything by hand, and §4.6 now says so. The
      subjective grading flow is the existing sheet.
- [x] **`Grade.administrative_group_id` sitting provenance — BUILT** (R43); it is
      selected and written by `grade.service`. Template-scoped aggregation
      belongs to the postponed engine (§10.1) and is deliberately absent.
- [x] **Grade optimistic versioning — BUILT** (TD-15), and proved by the
      stale-version test on the sheet. Recalc-job participation belongs to the
      postponed engine.
- [x] **Postponement check — VERIFIED 2026-09-04:** no `GradingTemplate` table,
      service, route or UI exists anywhere; the only occurrence of the name in
      the repository is the schema comment recording that it is post-MVP.
- [x] ~~Pass/fail override endpoint + audit~~ — **RETIRED by R81**, which removed
      the endpoint, dropped the columns and retired `grade.passfail_override`
      from TD-8: with nothing computing a verdict there is nothing to override.
      The two stale TD-3 registry lines were removed on 2026-09-04.
- [ ] LevelSurah/LevelSubject auto-draft components incl. the Adult-stage dual generation (BR-9, §4.6)
- [ ] §18 Exams & Grading checklist green (incl. both race tests)

### R57 — a class carries its own name (2026-08-09)
- [x] `title` (required, 1–120, `ar-x-icu`) and `description` (optional) on `RecurringCourseSchedule`
- [x] TD-6b expand → backfill from the Subject's name → contract to `NOT NULL`; DB CHECK refuses a blank title
- [x] Both editable after creation, unlike the scope fields §4.4 freezes; a split successor inherits the name
- [x] **Two silently-dropped fields fixed on the update path**: `title` and — since R55 — `effective_until`. The regression tests read the ROW, never the status code
- [x] The remaining fixture titles from before the seed fix still read `[تجريبي] حدث …`; **[Closed 2026-09-21 — STALE: checked on Localhost AND Staging 2026-09-21 — no «[تجريبي] حدث …» title exists on either; the fixtures carry proper names]** they are data and were not rewritten. Say the word and they can be cleaned

### R62 — parent/child registration (2026-08-11, in progress)
- [x] SRS applied; `ChildApplication`, 4 enums, `FamilyLink.relationshipType`, `User.referenceCode`, `User.schoolingStage`; migration applied
- [x] `child-application.service.ts` — submit, per-child decide, duplicate proposals, a parent's own list
- [x] HTTP surface: 4 routes, TD-3 registered, OpenAPI 79 paths / 106 operations
- [x] **Approval queue reads child applications** — one item per request, one decidable block per child
- [x] Registration flow → multi-child, through the same service; `phone` and child `notes` cease to be collected as a consequence of R62.1's shape
- [x] **Registration form → multi-child**; it was sending the pre-R62 shape and every family registration through the UI returned `400`. Per-child media release, `schooling_stage` collected, indexed server-issue paths
- [x] `GET /me` names the children; `/dashboard/parent` removed (a parent's home is `/dashboard/student`); active child persists across the navigation a role switch causes
- [x] 11 HTTP integration tests for the child-application endpoints — including submit → approve → `/me` names the child
- [x] **R63 — `GET /students/me`**, the identity block R62.10 needs. Drafted, Owner-authorised, applied to the SRS, registered in TD-3, 8 HTTP tests. First mount site of the `X-Active-Child-ID` middleware
- [x] **R63 — §14.1's stale `/dashboard/parent` corrected**
- [x] `ولي الأمر` is a group, not a clickable role: children by name + persistent «＋ تسجيل طفل»; one switcher, not two; a parent-only account gets it
- [x] «＋ تسجيل طفل» dialog → `POST /child-applications`
- [x] `/dashboard/student` — identity block, today's and upcoming sessions, persistent banner naming whose data is shown
- [x] **Identity binding → non-blocking review item** (R68). Stamped inside the binding transaction; a fourth queue type, one item per student; approve = the links stand, reject = revoke. **R62 is complete.**

### R64 — the child-registration flow reconciled (2026-08-11)
- [x] **The reported `NOT_FOUND` root-caused**: a child-application request id names no `User` and no `FamilyLink`; there is no bundle decision (R62.2). Server refuses it by name (`DECIDE_PER_CHILD`); the queue decides per child
- [x] **Approving a child was revoking the parent's other roles** — found end-to-end, not by any test. The grant is additive now, pinned by a regression test
- [x] `ChildApplication.requested_branch_id` written by both paths; queue reports the branch and the filter reaches the type
- [x] §4.1 placement rule restored on the per-child path (`ENROLLMENT_REQUIRED`); linking an existing account stays exempt
- [x] «＋ تسجيل طفل» → `/dashboard/student/register-child`, same fields as `/register`; `ولي الأمر` hidden until a child is approved
- [x] نوع التسجيل relabelled so it stops naming a Category
- [x] Table rule established and applied (branches +4 columns, levels +1); `إضافة مجموعة` converted to `FormDialog`
- [x] **OWNER DECISION — Categories and Levels have no `description`, and NEW K/L supplied one for each.** **[Closed 2026-09-21 — STALE: both columns exist since migration `20260827160000`, with DTOs, admin forms, the public programme page and the Owner's texts in the production seed. Her «yes» is R169 §5c]** The Owner's canonical dataset gives every Category a description (المرأة: *النساء من سن الجامعة الى ما فوق*, and so on) and every Level one of the form *المستوى N - برنامج X*. **Neither entity has a column to store it**, and §7 defines Category as carrying only `name` and `display_order`, and Level only those plus `gender_restriction` — the seed says so in a deliberate comment. Storing the descriptions is a schema addition against a normative §7 clause, which is the Document Owner's call and not the agent's. Everything else in NEW J/K/L shipped on 2026-08-27. **In simple words: do you want the platform to store and show a short description under each Category and Level? If yes, that is a small change to §7 and to the database, and the descriptions you already wrote are ready to load.**
- [x] **R130 — a full date of birth for every beneficiary (Owner, 2026-09-03).**
      `User.birth_date` is the durable answer and `ChildApplication.birth_date`
      the submitted one, materialised unchanged at approval. Required at the
      write boundary on the adult beneficiary path and on **every** child;
      **not asked** of a guardian (R129) and **refused** on a staff request.
      `lib/birth-date.ts` owns the parse, the calendar check, the future bound,
      the plausibility floor and the eighteen-year predicate — no age is stored
      anywhere, asserted against `information_schema`. **18 establishes
      eligibility and triggers nothing**: no birthday job, guarded by asserting
      no job source names the column.
      - [x] **[Closed 2026-09-21 — the Owner decided: fill the gaps so it can be mandatory. Built as R169 §9 with a MARKED placeholder applied by the database; the real date replaces it once]** **CONTRACT PHASE PENDING, and honestly so — `birth_date` cannot
            become `NOT NULL` until every live beneficiary has a real recorded
            date.** 25 have none (Localhost, 2026-09-03) and none was
            fabricated. Completion is a Super Admin recording the real date on
            `/admin/users`: **completion, never correction**
            (`BIRTH_DATE_ALREADY_RECORDED`). Revisit the contraction only when
            the count of live beneficiaries with a null date reaches zero.
- [x] **RESOLVED AND BUILT (Owner, 2026-09-03) — the minor→adult transition (R132).**
      The trusted channel is **the association itself**: Google OAuth proves
      control of a Google identity, her **reference code** names which record is
      claimed — it grants nothing on its own (R62.5), which is why quoting it is
      safe — and a **Super Admin** performs the identity match with the
      recognition the association already practises. **No CIN, no document
      scans, and no invented automated identity proofing.** Only the approval
      binds, and it binds to the **existing** `User`: no second account, and her
      whole educational history stays on the one id. `PATCH /admin/users/{id}`
      still refuses `pre_provisioned_email` — R132 is the controlled path that
      refusal was protecting, not a general capability.
      **The guardian is excluded by construction**: she cannot choose, type,
      attest, bind or approve the identity, and her own address never becomes
      the beneficiary's — which was precisely the blocker.
      **Age is eligibility only** (R130): no birthday job, guarded.
      **After the transition a former guardian loses current authority** while
      the link row survives as evidence — derived from R62.9's own definition of
      a minor (*an account with no login identity*) rather than a second flag.
      28 focused tests; `docs/SRS-PROPOSAL-R132.md` is **APPLIED to `SRS.md`** (2026-09-03).
- [ ] **OWNER DECISION — nothing marks the adult Category.** §2.1 says adults hold logins and minors do not, but R27 made the Categories renameable generic rows, so no form can enforce it and matching by name would hardcode reference data. Recommendation: a `Category.holds_own_login` marker. Until then a self-registering adult can request الطفل, and an approver corrects it

### R65 — the personal section is role-independent (2026-08-11)
- [x] **Audit finding: §5.2 already places `/profile` under *Shared / Cross-Role*** and it had never been built — which is why R64 hung child registration off a role's dashboard
- [x] `/profile` ships: own details, editable contact info, child registration, the status of own requests. Reached from the account menu, not role-gated
- [x] `/profile/register-child` replaces `/dashboard/student/register-child`; the dashboard link is removed — one entry point, not one per role
- [x] `GET`/`PATCH /profile` registered in TD-3; `PATCH` accepts `phone` and `nickname` only, refused not ignored; TD-15 versioning; `user.update` audit
- [x] **No authorization change** — `POST /child-applications` never checked a role; only the door was missing
- [x] `ولي الأمر` untouched: about already-approved children, and no registration action inside it
- [x] **Account deletion settled by ratified R111/R112, superseding the R54 draft.** The control
  ships on `/profile`; the remaining authoritative-SRS/TD-7 synchronization is recorded under
  M7 below rather than reopened as a product decision.

### R69 — the two hierarchies get their own navigation (2026-08-12)
- [x] **Audit first: the model and the authorization were already correct.** No schema, service, policy or TD-2 change
- [x] `/admin/level-subjects` and `/admin/teaching-groups` join §14.1, ids as query parameters (the `/resources` pattern); old paths redirect
- [x] `المستويات` → الإدارة, Super Admin screen; **read endpoint stays Admin-accessible** (the R61 branches rule)
- [x] Both borrowed Subject row actions removed from `المستويات` and `مجموعات المستويات`
- [x] Verified live: R66 direct + grouped enrolment, `entire_level` with no Circle, and R43.3's Super-Admin-structure / Admin-membership split
- [x] **Breadcrumb across المستويات → مواد المستوى → حلقات المادة** — `PortalShell` takes an optional trail; passed in by the page, never derived from the URL, so it can only link nodes that exist
- [x] **Post-R69 audit (2026-08-12):** the drill-down out of مواد المستوى still used the legacy path and navigated twice; «تنظيم المادة» survived as a row-action label for a screen now called «حلقات المواد»; `pickSubject` was substituted into the heading as if it were a Subject name

### The R66 group-less-enrolment bug class (2026-08-14)
- [x] **P0 consent re-evaluation** — the `entire_level` arm skipped group-less students, so BR-2/§4.9's gate never re-ran for their sessions
- [x] **P1 circle candidates** — `listUnassignedStudents` required a live group and scoped branches *through* it; now `Enrollment.branch_id`
- [x] **P1 private library** — 3 sites hid a group-less student's own Level from her and her parent
- [x] **Guard for the class**, proven to fail on reintroduction; states its blind spot (nested `enrollments.some`)
- [x] All 14 enrolment queries classified; group-specific ones deliberately untouched
- [ ] **Left deliberately:** `calendar.service.ts:676` prefill (P2, Owner-scoped out) — in the guard's allowlist with its reason

### End-to-end verification of the educational chain (2026-08-14)
- [x] 30 assertions through the HTTP API: مستفيدة → مستوى → مقر → مجموعة → مادة → حلقة → امتحان → نقاط
- [x] **Found and fixed:** a group-less student could join **no circle** — `studentBranchInLevel`'s `where` still required a live `administrativeGroup`, and a relation filter never matches a NULL relation
- [x] Confirmed Administrative Group ≠ Teaching Circle, and that circle membership has **no** effect on exam eligibility in either direction

### R74 — enrolment gets a screen (2026-08-13)
- [x] **The gap the audit named:** R66's `enrolInLevel` was reachable only through approval; the sole endpoint required a group
- [x] `التسجيلات` (`/admin/enrollments`) joins §14.1 — the Level view of the rows the group roster shows per group
- [x] `enrolAtLevel` is a call to `enrolAtPlacement`; every rule stays in the service the approval path already uses
- [x] Live-verified the exam consequence: enrolling a مستفيدة takes a whole-Level exam's sheet from 0 rows to 1, gradeable
- [x] **Group-less unenrolment built** (`unenrolById`), sharing one `releaseEnrollment` with the group-keyed path
- [x] **Enrolment editing built** — into/out of/between groups and branch; `level_id` refused, because BR-21 makes the enrolment the (student, level) pair
- [x] Enrolment rows show circles read-only; membership stays on حلقات المواد (§4.4c)
- [ ] **Open gap, reported not invented:** nothing structurally identifies a beneficiary — minors hold no role, `intended_category_id` is unset, and one account is both teacher and student. The picker offers every active account. Needs an Owner decision, like R64.7 and R73.4
- [x] **Assistant multi-select built** — `MultiSelectField`, a new atomic control, wired into `StaffPicker` so the exam, class and event forms all changed together

### UX slice — atomic components and the management-overview principle (2026-08-13)
- [x] Student Quran view linked from the dashboard; **one Level selector** (`{Category} — {Level}`) with three screens migrated
- [x] **`إضافة حساب` kept** — TD-2 grants it and R68 depends on it — and its **duplicate-email defect fixed**: an address already signed in collided with nothing and was accepted
- [x] `states.tsx` and `Pagination` converged on the shared `Button`; they were the platform's only unstyled controls
- [x] **`حلقات المواد` rebuilt as a management overview** — no dropdown gate, Groups read-only, circles CRUD inline, BR-22 preserved. No normative change

### M4 — Quran Progress (2026-08-12)
- [x] **R73 applied:** navigation node · `quranlog.create` · TD-2's Quran qualifier · `Subject.tracks_quran_progress` · TD-15.5's stale reason corrected
- [x] **M4a:** BR-13 union (pure, tested against §4.5's own example) · synchronous recalculation · self-heal guard · Trash on delete · `/teacher/quran?student=`
- [x] Authorization exactly as approved: only the structurally marked حفظ القرآن teaching scope; **teaching and assisting count equally**; Admin/Super Admin unchanged; **fails closed** when no Subject is marked (R107)
- [x] Invariant: at most one live Subject may carry the memorisation marker — partial unique index, proven to refuse a second; the Production seed establishes exactly one on حفظ القرآن
- [x] **M4b — `/dashboard/student/quran`**, read-only. `GET /students/me/quran` carries no id: the subject comes from `childContext`, so a parent sees the child they act for and nobody else
- [x] The read is split (`coverageFor`) and shared — the staff path and the student path differ only in how the subject was established
- [x] **M4c — `LevelSurah` + BR-11.** Syllabus management (Super Admin writes, Admin reads) and completion read from the existing engine
- [x] Three states: no syllabus -> `complete: null`, deliberately not `false`
- [x] **BR-11's final-exam clause is unreachable and reported as such** — nothing marks an exam as final (`round` is explicitly non-semantic, §4.6). No marker invented
- [x] **Owner decision, reported not invented:** a *final exam* marker on `Exam`, if BR-11's second clause is ever to fire. Same shape as R64.7, R73.4 and the beneficiary gap **[Closed 2026-09-21 ledger review — answered differently: R166 §1 defined the second clause without a marker, and R168 §3 made completion the administration's recorded act]**

### R72 — the Teacher's الجدولة write access (2026-08-12)
- [x] **R72 applied:** §14.1's `/teacher/schedules` clause said *"do not create or edit schedules"* and gave TD-2's event grant no node. Clarified to mean Course Schedules; Activities are authored here
- [x] Reuses `SchedulingDialog` with `types={['activity']}` — no second screen (R56)
- [x] **Found live:** the form sent `branchIds` into a snake_case `.strict()` contract, so **every non-Global event creation returned 400**
- [x] **Found live:** no form ever offered a `group` scope, the only one a Teacher may use — the server has accepted `group_ids` since R43
- [x] A Teacher is offered `group` and nothing else, and it is their default
- [ ] **Not built:** a Teacher edits an activity only from the calendar; this list is Course Schedules and shows no activity rows

### R71 — an event has somebody responsible for it (2026-08-12)
- [x] **Audit first:** the role model already separates person · capability · scope. No new Role, no capability table, no parallel authorization
- [x] `EventStaff` + `EventStaffPosition` (`responsible | assistant`), shaped like `ExamStaff`, R59 tombstone-and-revive, no Trash entry
- [x] **Event scope is a union** — events staffed ∪ §4.4c teaching scope — as one arm in `roster-resolution.ts`
- [x] `responsible` edits; `assistant` sees only. The one place a `*Staff` position is authorization-bearing, and why
- [x] Assigning staff is Admin+; **creating an event records the creator responsible**; deletion stays Admin (`Event` has no `created_by`)
- [x] Six existing teardowns updated — `event_staff` is RESTRICT like every other event child
- [x] **Terminology slice:** أستاذة → مؤطِّرة · طالبة → مستفيدة (9 places, incl. the privacy notice) · مشرف عام → مشرفة عامة · two drifted role dictionaries unified · **15th CI guard**
- [x] **UI shipped:** the responsible مؤطرة and her assistants are assigned on the scheduling form's `نشاط` branch
- [x] `StaffPicker` **extracted** from the exam section and shared by both — one control, each caller's own vocabulary
- [x] Event DTO carries `staff` (live rows only) so the form prefills who already answers for it

### Platform-wide UX & information-architecture pass (2026-08-17)
- [x] **Audit first, and it decided the size:** the atomic foundation already existed — `Button`, `DataTable`, the five §14.4 states, `levelLabel`, `MultiSelectField`, `FormDialog`, `ConfirmDialog`. **The defects were drift at the edges**, so this was a migration, not a construction. Audit: `docs/development/audit-2026-08-17-ux-architecture.md`
- [x] **Five dropdown-gated pages converted to data-first:** `نقاط الامتحانات` · `حلقات المواد` · `مقرر الحفظ` · `مواد المستوى` · `/teacher/quran`. Deep links survive as **focus, never as gates**
- [x] **A second complete button system removed** — `.button` / `.button.primary` in `status-pages.css`, ten call sites, its own padding and none of `ghost`/`danger`/`add`. Plus five files hand-writing `btn btn--*`, including a `<span>` styled as a disabled button
- [x] **`Button variant="add"`** — the `＋` had lived in a *translation string* for exactly one screen. The variant emits it, so a caller cannot forget it
- [x] **`SearchableSelect`** — one choice from many, **options visible on open**. It replaced two typed-search workflows that returned nothing until two characters were entered
- [x] **Three copies of the Level label reduced to one**; `withCategoryNames` completes the label from the payload the caller already had. The calendar filter and the groups page had rendered bare names
- [x] **No pass/fail verdict on the grade sheet.** `Grade.passed`, `manual_pass_fail_override` and BR-12 **untouched in the model** — the override is still surfaced, because provenance is not a verdict
- [x] **§5.3's `/dashboard/student/grades` finally rendered.** In §14.1 since R62 with nothing implementing it. `GET /students/me/grades` selects `published` **in the query**, so a draft is absent rather than hidden
- [x] **Optional circles in the placement workflow** — two existing calls in order, keyed on the **Level alone**. No Group↔Circle relationship, no schema change
- [x] **«إنهاء التسجيل» audited: the implementation was already correct.** Copy now distinguishes it from changing a placement and states what survives; `ConfirmDialog` gained one optional `details` slot
- [x] **The «66» was one string** — a revision number on a form hint. A sweep of every catalogue *value* found no other leak
- [x] **الإدارة reordered** to الفئات → المستويات → المواد → **مواد المستوى → مقرر الحفظ** — §14.1's own dependency order for the first four
- [x] **The مؤطرة's labels aligned with the back office's** («الجدولة», «مكتبة المحتوى») and her sidebar grouped like it. **No access changed**; `/admin/content` deliberately not offered
- [x] **`إضافة حساب` removed from المستخدمون**, with its dialog and six orphaned catalogue strings. `POST /admin/users` and the adapter untouched
- [x] **19 lettered rules documented and guarded** — `docs/development/ux-architecture.md`, plus a *Platform UX & Atomic Design Rules* section in `CLAUDE.md`
- [x] **Two defects found while wiring, neither in scope:** `fetchMyCoverage` never sent `X-Active-Child-ID` (a parent-only account got a `400`; one holding both roles saw its own progress); `admin.users.create` survived as an orphaned catalogue entry shipping in the bundle
- [x] **Three guards restated rather than deleted** — they pinned the accordion's implementation, and one read the redesign's *use* of `LevelSelect` as a filter as a violation of the rule it fulfils
- [ ] **Awaiting Owner decision (non-blocking):** `GET /admin/teaching-groups` and `GET /students/me/grades` are unlisted in TD-3 — see the audit's §Z, which also records that **`/admin/level-surahs` is not in §14.1**
- [ ] **Not done, and stated:** a مؤطرة's Quran list shows names only — a coverage column needs `/quran-students` widened. `DataTable` still hand-writes its row-action button classes. Three editable tables remain outside the shared primitive, with their reasons in the guard's allowlist; **a fourth is the signal to build an editable-table primitive**

### M5a — in-school exam grading + Teacher scope (2026-08-12)
- [x] **Audit first:** §4.6's model complete, R58's exam half built, §4.4c resolver already live. `Grade` had no service/route/adapter/screen — that was the whole gap
- [x] **R70 drafted and applied:** `/admin/exam-grades?exam=` joins §14.1 · BR-7 reworded to *the exam's audience* · `grade.enter` joins TD-8 · TD-2's exam row splits in four
- [x] Owner decisions: Course Schedules stay Admin (scope self-reference); Teachers create exams in §4.4c scope; **deletion stays Admin** — `Exam` has no `created_by`
- [x] **R66 defect fixed:** `studentsTaughtBy` + `assertCanAccessStudent` resolved branch through the GROUP — ungrouped students were invisible to their own teacher
- [x] **Found live, not by tests:** pre-R58 exams (null branch/subject) answered 500; now `EXAM_INCOMPLETE`, with the type narrowed so it cannot recur
- [x] One shared `GradeSheetView` rendered by both entry points, with a source guard asserting neither page reimplements it
- [x] Empty ≠ absent ≠ zero, structurally; /20 ↔ bp converted once on the server; BR-7 · BR-8 · BR-12 · TD-15 all covered
- [x] **Not implemented, and stated:** no UI for a Teacher to CREATE an Event — the server has supported it since R43 (`teacherEventScope`), and `/teacher/schedules` is read-only by design. الجدولة write access for Teachers needs its own slice **[Closed 2026-09-21 ledger review — built: R72/R140 gave the مؤطِّرة الجدولة write access; `verify-teacher-scheduling` 14/14]**

### Post-R69 UI fixes (2026-08-12)
- [x] **`SUBJECT_NOT_IN_LEVEL` root-caused to the CLIENT.** The Subject selector listed every Subject on the platform instead of the Level's own; validation untouched
- [x] A Level teaching nothing gets a named empty state linking to مواد المستوى, not an empty dropdown
- [x] The form's refusal rendered behind the open dialog — passed into it now
- [x] The circle form was the last hand-rolled `Dialog`; it uses `FormDialog`, which fixes the button alignment
- [x] **R66's retired `LAST_GROUP_IN_LEVEL` removed from the interface** — warning text and the dead refusal string. Service already correct
- [x] `SCHEDULES_EXIST` deletion guard tested for the first time; `ENROLMENTS_EXIST` added at service level

### R67 + UX pass (2026-08-12)
- [x] **R67 — a child's branch and stage are the CHILD's.** Drafted, applied, implemented. No migration: `child_application` has held both per row since R62/R64
- [x] Parent's `intended_branch_id`/`intended_category_id` derived from the first child (R67.3); adult path untouched
- [x] **Found end-to-end, not by tests:** `POST /child-applications` had both optional while `/registrations` required them. Required on both now, 2 HTTP cases
- [x] `.form__row` aligns on controls — fixes تاريخ بدء العمل / ترتيب العرض and إضافة دور / نطاق الفرع with one rule
- [x] الفئات and المواد under الإدارة, Super-Admin-only; READ endpoints stay Admin-accessible (R61's `GET /admin/branches` precedent); Levels stays Admin-readable
- [x] **مواد المستوى / تنظيم المادة audited: the problem was vocabulary.** «فوج» removed (22 strings) — one word per concept; headings name the Level and the Subject
- [x] Breadcrumb for those two screens — delivered in the post-R69 audit above

### R66 — a student is enrolled in a Level; a Group is a subdivision (2026-08-11)
- [x] SRS drafted, applied. §7 Enrollment amended; §5.2 and R43.3 corrected to `Enrollment.branch_id`
- [x] Migration `20260811210000` — TD-6b expand → backfill → contract, derived values, fails loudly rather than relaxing the column
- [x] `administrative_group_id` nullable; composite FK `(administrative_group_id, branch_id)` null-safe by construction
- [x] TD-4.6b, TD-4.6d and `LAST_GROUP_IN_LEVEL` retired; `ENROLMENTS_EXIST` untouched
- [x] `enrolInLevel` — direct enrolment in an unsubdivided Level; 13 branch reads moved off the join
- [x] Level creation drops the branch end to end (service, validator with `.strict()`, DTO, controller, adapter, form)
- [x] 995 backend tests green; the ten encoding retired rules rewritten to the new rule, not deleted
- [x] **Approval placement into a group-less Level** — `enrolAtPlacement` dispatches one `PlacementInput` union for both approval paths; both wire schemas refuse a mixture and half a placement by name; the dialog offers every Level again with a branch selector where there is no group. TD-4.6d's backfill removed from code with it

### UI/product pass 2 (2026-08-11)
- [x] Arabic-Indic digits removed platform-wide + `check-western-digits.sh` (14th guard). **Arabic text, Western numerals**
- [x] Approval button traced: the DATA violates TD-4.6b's invariant — 18 of 20 Levels have no group, so `complete` could never be true and the control was disabled. Unassignable Levels are now excluded, with a route to fix
- [x] «＋ تسجيل طفل» removed from the account menu; `/profile/register-child` unchanged
- [x] `.field--choice` had no CSS rule at all — one rule fixes five usages (RTL-safe)
- [x] **AUDITED, NOT IMPLEMENTED — see [audit-2026-08-11.md](development/audit-2026-08-11.md):** **[Closed 2026-09-21 — re-audited against the code 2026-09-21: four of its five items shipped (R66, R67, R143, the retention purge). What remains lives in its own boxes — widening the restorable set, the quarantine-purge question (R169 open questions), and the M8 deployment steps]**
  - **Level creation's branch** conflicts with TD-4.6b (Level + first group, atomic). Three resolutions costed; **A recommended** (retire the invariant). Needs a revision + a decision on the 18 existing group-less Levels
  - **Per-child branch/category** needs **no migration** — `child_application` already holds both per row. Only the validator and two forms treat them as request-level. Needs a revision amending R62/R64.2
  - **Deletion**: 28 of 45 models soft-delete; 7 are currently restorable and the purgeable
    set remains deliberately narrower. **Recommendation: do NOT draft a generic "delete anything"
    revision** — three smaller decisions instead (widen RESTORABLE per type · switch on retention ·
    settle the backup statement)
  - **Deployment**: `bodouralamal.vercel.app` is a **mock-backed frontend preview by design** (§19.0). Same-origin routing is load-bearing for TD-12 cookies and the OAuth callback, so a split deploy is ruled out by the SRS. **Do not deploy.** Needs a VPS
  - **Educational structure** (addendum): 4 of the 6 statements are ALREADY the specification — a Subject needs no change at all (§7 states it verbatim). The conflict is one rule R43 took explicitly: *"exactly one Administrative Group inside each enrolled Level"*. **Smallest revision: the branch moves from the group to `Enrollment`**, which makes the group nullable with no other structural change, keeps groups branch-owning as the Owner's example requires, and makes the 18 group-less Levels legal instead of broken. Retires TD-4.6b, TD-4.6d and `LAST_GROUP_IN_LEVEL`. Backfill is derivable

### UI/product pass (2026-08-11)
- [x] Child section extracted to one shared component; the personal page gains multi-child. 9 tests through both entry points
- [x] `المستخدمون` filter row aligns on the controls (`align-items: start`) — one rule, every toolbar
- [x] `الشؤون التعليمية` ordered general → specific; `/admin/groups` relabelled «مجموعات المستويات» (§20 rule 22 — it was calling an Administrative Group a حلقة)
- [x] One Arabic date formatter at every `<time>`; `DateField` gains a format hint and an Arabic echo. **The native control's placeholder is the user agent's and cannot be overridden** without abandoning the native picker — stated, not worked around
- [x] Hero: association's own motto and mission wording; logo made transparent (border flood fill) and cropped to its artwork; `object-fit: contain`
- [x] Mission section removed (strings kept — removed *for now*); footer city removed (key deleted); sticky-footer layout on `#root`
- [ ] **OWNER DECISION — الفئة offers الكبار in child registration, and the model cannot honour it.** Traced end to end: approval creates a login-less account (no `UserIdentity`, no email), linked to the requester, with consent recorded as given by the requester — contradicting §2.1 (adults hold their own accounts), §4.3/R62.9 (an adult consents for themselves) and §4.1a. The Owner's future cases are already served by adult self-registration (§4.1b). **Removing the option requires R64.7's `Category.holds_own_login` marker** — R27 made the Categories renameable, so filtering by name would hardcode reference data

### R62 — deferred by scope, not forgotten
- [x] `/dashboard/student/calendar`, `/grades`, `/quran` are §14.1 nodes belonging to later milestones; the dashboard deliberately does not stub them **[Closed 2026-09-21 ledger review — all built since: تقويمي, حفظي, اختباراتي (grades merged in R153), and شهاداتي (R167)]**
- [ ] Still pending the Owner: guardianship verification · right to an actual rejection reason · the three compliance fields · CNDP declaration · Arabic privacy notice

### R61 — الإدارة is Super Admin only (2026-08-11)
- [x] Section rule, enforced by a test over `section: 'administration'` rather than per module
- [x] `/admin/branches` joins the other three; writes were already Super Admin only
- [x] `GET /admin/branches` stays Admin-readable as a selector feed — verified that groups, scheduling and content depend on it
- [x] **Open for the Owner:** this is a visibility boundary, not a data one. **[Closed 2026-09-21 — DECIDED by the Owner, R169 §5a: an Admin may see branch names in selectors; nothing to build]** An Admin can still *see* branch names through selectors. Withholding the data too means re-feeding every branch selector in the back office — a larger decision, not a consequence of this one

### R60 follow-up — the active role drives the interface (2026-08-11)
- [x] `useActiveRole().activeRoles` is what presentation reads; `me.roles` is for the switcher's menu only
- [x] `لوحة التحكم` opens the active role's home — teacher → `/teacher`, admin → `/admin`
- [x] Both portal sidebars, the header (desktop + mobile) and 9 write affordances converted
- [x] The missing `roles.wrongRole*` strings added; the screen kept for deep links only
- [x] **Enforced** by `scripts/ci/check-active-role-presentation.sh` — three forms caught, mutation-proved, wired into CI

### R60 — the Active Role as a security context (2026-08-11)
- [x] `active_role` JWT claim; the token is **already narrowed** when it is present
- [x] `POST /auth/switch-role` — User-locked authoritative Active state and live assignments decide, 403 otherwise, audited; replacement expiry is capped at the presented bearer's verified expiry so switching cannot become refresh
- [x] TD-12 freshness narrows too — the split that would have left high-risk endpoints unrestricted
- [x] Refresh re-asserts, returns the granted role, and fails safe to the most privileged remaining
- [x] `/me` reads live rows so the switcher keeps its menu
- [x] `active_role` on every audit row where a capacity exists
- [x] nginx exception so switching is not rate-limited as a credential surface
- [x] 16 security tests: switching, tampering, revoked roles, concurrent devices, privilege boundaries, branch scope
- [ ] §4.3 Student/Parent now follows the active role — **worth a QA pass with a real dual-role account** once a parent portal exists
- [ ] Audit rows omit the capacity where none exists (login, registration, system-initiated). Stated in R60.8 rather than forced

### Role switching (§2.1) — 2026-08-09
- [x] Active-role context, defaulting to the most privileged role held, persisted and validated against `/me`
- [x] Switching redirects to that role's home; the back office resolves modules from the active role
- [x] A portal the active role does not own renders a named state offering the switch, never a blank page
- [x] A role the person does not hold cannot be selected — the list comes from the server-issued token
- [x] Trash restore, purge and list made TD-12 fresh: a revoked Super Admin loses them at once
- [x] **Server authority does NOT narrow to the active role** **[Closed 2026-09-21 — STALE: it does, since R60 — the claim is narrowed when the token is minted, `assertFreshActive` re-narrows from live rows, and `active-role.http.integration.test.ts` proves a Super Admin acting as مؤطِّرة is refused `/admin/settings`. The Owner's «yes» (R169 §5b) needed nothing built]** — a Super Admin acting as مؤطِّرة still holds Super Admin authority on every endpoint. Making the server honour the active role is a new normative concept; Owner decision required (draft R60)
- [x] Roles come from the JWT, so a newly assigned role appears only after re-login. **[Closed 2026-09-21 — WRONG by the time it was read, and now proven (R169 §2): every page load refreshes, and the refresh reads live assignments — a granted role is hers at her next page. «المستخدمون» says so]** Worth stating on the Users screen

### R59 — deletion authority across the platform (2026-08-09)
- [x] **Permanent delete exists**: `DELETE /admin/trash/{id}`, Super Admin only, one transaction, `trash.permanent_delete` audit row retained indefinitely. Cascade children **declared per type**; anything else refuses with `DEPENDENTS_EXIST` naming the constraint
- [x] Four deliberate deletions now reach the Trash: `Enrollment`, `StudentTeachingGroup`, `LevelSubject`, `SessionContent` — each with a composed label, since a join row has no name
- [x] `HijriMonthStart` gains a deletion (R59.5) — it was the only Super-Admin-creatable entity with none. Last month only, TD-15 versioned
- [x] Exam staff replacement made a **soft** delete + revive, matching `SessionStaff`/`UserBranchRole` — it was hard-deleting rows that carry `deleted_at`
- [x] `Exam` and `HijriMonthStart` join the **restorable** set; restore reinstates declared children
- [x] Server-side authority proven against crafted requests from admin/teacher/student/parent, for read, restore and purge
- [x] Structural guards: every soft-deleting service writes a snapshot; every read of a soft-deletable model filters `deletedAt` — folded into the guard that already existed rather than shipped beside it
- [x] Fixed a silent half-restore: one timestamp per deletion, and the restore keys on the record's own tombstone rather than the Trash entry's
- [x] ~~A branch created after Levels exist cannot be deleted~~ — **closed by R66**: TD-4.6d's backfill and `LAST_GROUP_IN_LEVEL` both retired, so a new branch gets no groups and deletes cleanly. Measured against the running stack with 20 Levels present
- [~] **`content.quarantine-purge` exact-operation worker is built; automatic retention is not** (R59.4) — replacement/deletion quarantine and deliberate R59.1 storage retirement are durable and retryable, while nothing reads `purge_after`. **OWNER DECISION REQUIRED — AUTOMATIC QUARANTINE DESTRUCTION:** switch on a tested 90-day record/object policy, or continue deliberate manual purging
- [x] `User` and `RecurringCourseSchedule` are not row-purgeable — `ACCOUNTABILITY_RECORD` and
  `CASCADE_CHILDREN`. R111 now supplies User de-identification without destroying the tombstone;
  the schedule remains blocked on its materialized history
- [x] **R59 lifecycle closure (2026-09-01):** Subject and Level deletion snapshots now name
  the exact owned `LevelSubject`, `LevelSurah`, and empty `AdministrativeGroup` rows that followed
  the parent; restoration/purge never sweep an earlier independent deletion. `LevelSurah`,
  `QuranProgressLog`, unused `SchedulingType`, and `Partner` have explicit permanent-purge plans, and reviving
  a unique curriculum pair atomically removes its stale Trash entry. The UI filter now names every
  entity that can actually reach Trash. Real PostgreSQL FK/rollback regressions own the proof.
- [ ] **OWNER DECISION REQUIRED — SCHEDULE HISTORY IN TRASH:** keep every deleted
  `RecurringCourseSchedule` indefinitely as `CASCADE_CHILDREN`, or permit permanent purge only when
  it has never materialized a Session (and decide separately whether derived future Session
  tombstones may follow it). Historical/held Sessions and their venue coordinates remain retained.
- [x] **DECIDED AND IMPLEMENTED (Owner, 2026-09-03) — TERMINAL REJECTED FAMILY LINKS.** *(This
  entry was already stale before it was closed: R118.3 supplied a removal transition on
  2026-09-02, and the text above was never updated. R128 supersedes both.)* A rejection is now
  **soft-deleted with its decision** — status, instant, decider, reason, Trash snapshot and a
  `familylink.reject` audit row, atomically — so the live partial unique index releases the pair
  and the same adult may make a **corrected** request, which is a NEW `pending` row with its own
  id. No `rejected → pending` transition exists. Retention is BR-15's ninety days, like every
  other soft-deleted record, so no second window was invented. `DELETE
  /admin/family-links/{id}/rejected`, `familylink.purge_rejected` and `NOT_TERMINAL_REJECTED` are
  **withdrawn**: they existed only because the row stayed live, and two competing deletion
  lifecycles for one entity is how a destructive verb reaches the wrong row. A generic Trash
  restore still cannot resurrect one into live authority (`CASCADE_RELATIONSHIPS`, proved by
  test). `docs/SRS-PROPOSAL-R128.md` is **APPLIED to `SRS.md`** (2026-09-03).
- [ ] **OWNER DECISION REQUIRED — HISTORICAL REFERENCE RETENTION/PRESENTATION:** Branch/Room/
  Level/Subject/Category/AdministrativeGroup rows still referenced by retained schedules or
  Sessions remain FK-protected. Decide whether those tombstones stay visibly non-purgeable in Trash
  or move to a separate archive presentation before changing the historical FK/snapshot model.

### R58 — physical exam scheduling (2026-08-09)
- [x] `Exam.mode` discriminator; `physical` carries date, wall-clock window, branch, room, optional group and supervising staff. Migration + boot-time CHECK ("all four place columns or none", so one legacy row survives without inventing a room)
- [x] `POST/GET/PATCH/DELETE /exams` — TD-15 versioning, TD-5 soft delete with a Trash snapshot, identity fields **refused** on edit rather than dropped
- [x] `عن بُعد` offered disabled with its reason, and refused by the server (`STATE_CONFLICT` / `ONLINE_NOT_AVAILABLE`). **No online endpoint, field or screen exists**
- [x] `kind: 'exam'` in `GET /calendar` — read, not expanded; physical only
- [x] `ExamSection` composed into the unified form; the shell, the recurrence editor, the list and the grid were unchanged — one registry entry, one section, one adapter arm
- [x] `--color-exam` violet on all four surfaces (chip, badge, details, indicator), with weight and words as well as hue
- [x] `SchedulingItem.ids` — the edit form seeds itself from the row it already has, so a re-title cannot silently clear the audience
- [x] 16 HTTP integration tests + the client contract guard; full flow exercised against the real API and database
- [x] Exams are **not restorable from Trash** (`NOT_YET_SUPPORTED`) — part of the standing restorable-set gap, not specific to R58 **[Closed 2026-09-21 ledger review — done: «`Exam` and `HijriMonthStart` join the restorable set»]**

### R56 — unified scheduling (2026-08-07)
- [x] One `/admin/schedules` screen replacing `/admin/calendar` and the old schedules page; type is a field, not a destination
- [x] `GET /events` — definitions, so the List view manages rules rather than occurrences
- [x] List view (definitions) + Calendar view (occurrences), one query parameter, no second navigation node
- [x] One `RecurrenceEditor` — the two `weekly` semantics reconciled without a backend change
- [x] `SchedulingForm` shell with composable type sections — **cashed by R58**: Exams became a third section with nothing in the shell moving
- [x] `/admin/schedules/{id}/sessions` unchanged, keeping R50's three scopes
- [x] **`RoomDto` publishes no `capacity`** **[Closed 2026-09-21 — built, R169 §3 — published, editable, and the scheduling hint renders; still informational only (BR-23)]** — BR-23 makes it informational and enforced nowhere, so the form's capacity hint renders nothing. Publishing it is a small contract change, recorded rather than taken unilaterally
- [x] Sweep `approvals`, `levels` and `users` for hand-rolled filter rows (unchanged from R55) — **verified clean 2026-09-04**: all three use `DataTable`'s toolbar with `SearchInput`/`SelectField`/`BranchSelector` and contain no raw `<select>`/`<input>`. The sweep found a different rule-C drift instead — four hand-written `field field--choice` copies — now owned by `ChoiceField` and guarded (rule AM)
- [ ] **`schedule-sessions.tsx` keeps its own choice markup** — it renders the hint *inside* the label beside a `<strong>`, so converting it moves a hint on a live screen. Needs a browser measurement, not a rewrite; named as the one exception in the rule AM guard

### R55 cross-cutting (2026-08-06)
- [x] **Every selector is dependent** (§14.4, R55) — one module (`hooks/use-scope-options.ts`) owns the graph; screens declare which fields they need and never how they relate
- [x] **`LevelSubject` enforced on all three surfaces** — scheduling did not check at all, and the two that did used different reason codes (`policies/curriculum.ts`, `SUBJECT_NOT_IN_LEVEL`)
- [x] الفئات / المواد split into two §14.1 nodes, one implementation
- [x] Users table: `email` + the Branch scope column §14.2 already required
- [x] Sessions: Arabic weekdays, `anchor_date` and `effective_until` in the shared recurrence editor, one primary teacher + assistants
- [ ] **Backfill the curriculum data — now blocking class scheduling too, not just uploads.** `level_subject` is empty on the live database, so no Level teaches anything and no content can be attached anywhere. Assign subjects per Level from *المستويات ← مواد المستوى* — a data task, not a code one, and the reason the upload appeared broken
- [x] الأنشطة / الحصص parity — one `FormDialog`, one `ListDialog`, one action placement, one notice style; pinned structurally by `scheduling-parity.test.tsx`
  - ✓ **The table's CONTENT was the last difference**, not its wrapper: `CourseScheduleDto` published five ids and no labels, so the timetable led with a clock time and printed a raw UUID for the room. The DTO now resolves `subject_name`, `target_name`, `branch_name`, `room_name` — `libraryItemDto`'s precedent
  - ✓ `MaterializationDialog` was the last bare `<Dialog>`, and printed R43.6 codes untranslated
  - ✓ **The guard now asserts ABSENCE, not just presence** — a page can use the shared components and keep custom UI beside them, and one did for a whole revision. Mutation-proved
- [x] مواد المستوى made findable — the screen existed; the count column is now the link to it
- [x] **Sweep for raw `<select>`/`<label>` pairs — COMPLETE.** Verified 2026-09-04: `approvals.tsx`, `levels.tsx` and `users.tsx` contain **no raw `<select>`** and all three import `SelectField`. The line was stale, not outstanding.

## M6 — Content, Consent & Storage
- [x] Upload initiate/complete/abort: single-shot presigned PUT, branch-scope validation, Teacher Global rejection (§4.9, TD-3.5)
  - ✓ `upload_id` is a **signed ticket, not a table** — §7 defines no pending-upload entity, so `upload.gc` reaps objects no content row claims rather than reconciling a table against a bucket. The ticket binds every phase-one authorization decision so `/complete` cannot restate them
  - ✓ Teacher branch scope resolves through `CourseScheduleStaff` (§4.4c), never the role assignment
  - ✓ **Replace and delete** shipped with it (R53): replacement extends `/uploads/initiate` via `replaces_content_id`; `DELETE /content/{id}` soft-deletes, snapshots and quarantines
  - ✓ **B-02 visibility/storage invariant:** `EducationalContent.visibility` is authoritative; creation derives its bucket, replacement inherits the existing row's tier, and completion rejects/discards a contradictory or pre-fix ticket before changing storage coordinates. Real PostgreSQL/MinIO coverage asserts database rows, both buckets, anonymous/public bytes, signed private reads, unrelated content and `SessionContent` links
  - ✓ **B-03 immutable finalization (R103):** the presigned PUT targets `staging/content/...`; one full stable source read validates magic/length and hashes the exact accepted bytes into private server staging, then a re-hashed server-controlled PUT creates the 32-hex SHA-256-based canonical key. MD5 ETag is only an optional race optimization, never identity. Transactional audit publication, same-ticket convergence across different stable snapshots, replacement compare-and-swap, idempotent retry/restart and retained-PUT isolation are proven against real PostgreSQL/MinIO; unsafe legacy replacements without `replaces_version` fail closed and must be re-initiated. `upload.gc` remains the separate abandoned-object collector
  - ⚠ **Video is refused**, per TD-9's whitelist and §4.9 Revision 12. The Owner's brief asked for video support; widening the list is an SRS revision, not an implementation choice
- [x] Authoritative per-user upload quota 30/hour in PostgreSQL (`RateLimitCounter`), locked + incremented in the initiate transaction (TD-4.12, TD-15.2); `429 RATE_LIMITED` envelope; never in-process memory, never pg-boss, never njs (§3.1 Revision 14)
- [x] Magic-byte validation at /complete via ranged GET (bytes 0–511) to MinIO + HEAD size check; reject-and-delete (§4.9, TD-9)
- [x] Hash-segmented immutable canonical keys; clients write staging only, completion canonicalizes one fully read SHA-256-verified byte stream, and replacement mints a new key + quarantines old (TD-9, R103)
- [x] FileUploader: progress, failure, clean retry (R-9) (§14.3) — `XMLHttpRequest` for the PUT, because `fetch` cannot report upload progress
- [~] Phone-recording upload guidance panel on /teacher/content (§4.9) — **panel shipped**; cross-browser playback E2E for TD-9 containers (§14.7) still to run
- [x] **Visibility transitions + bucket-migrate job + `/content-unavailable` — COMPLETE.**
      Verified 2026-09-04: the consent-forced worker and the Nginx fail-closed gate
      were already done, and **both items listed as remaining are built**.
      *General visibility editing* — `VisibilityField` on the content edit dialog,
      `PATCH /content/{id}` accepting `visibility`, and a transition that **copies
      to the target bucket, verifies size and SHA-256, commits under an optimistic
      version guard and only then retires the old key**; a failed copy is discarded
      and the original left alone. *The stale-link page* — `/content-unavailable`
      is routed in `route.ts` and rendered in `main.tsx`.
- [x] Consent re-evaluation engine wired to enrollment/Teaching Group membership, consent, R92 audience changes, retained Sessions after schedule deletion, recording upload/import/replacement and Session-content links; bounded startup sweep; monotonic `consent_forced_private`; **empty resolved audience disengages the gate** (§4.1a, §4.9, BR-2 as restated by R43)
- [ ] Admin-only consent-gate override with mandatory justification + audit (BR-3, TD-8)
- [x] Presigned GET mint with full permission + child-context check, 10 min TTL (TD-12)
- [~] Resources directory nesting: Category→Level→Year(current pinned)→Branch(Global top)→Subject (§5.2)
  - ✓ **Frontend complete against a MOCK adapter** — `/resources` with both §5.2 views: the level index grouped by category (الكبار → اليافعون → الطفل, fixed editorial order, unknown categories sorted last rather than dropped) and one level's contents grouped **academic year (newest first) → branch**. Level cards carry name, optional description and both counts, with correct Arabic plural agreement; levels with no content never appear
  - ✓ **Content cards** — title, type in words *and* icon, publication date, file size in Arabic units, teacher display name rendered **verbatim** (§20 rule 21 — the type carries no other name field), optional description clamped to two lines, optional subject badge. A field the backend did not send is **absent, not blank**
  - ✓ **Preview architecture built** — one viewer implementing the whole §14.6 table: PDF in an `<iframe>`, native `<video>`/`<audio controls>`, full-width image, **office documents download-only**. Native elements rather than a player library (the CSP admits no external script host). The URL is minted **when the dialog opens**, never with the list, because a 10-minute presigned GET attached to every card would expire before most were clicked
  - ✓ **Filters** — year, branch (with بدون فرع as a real choice), type, and title search folding Arabic variants as TD-10 does. Every option derives from content actually present, so no control can offer a combination that yields nothing. Groups a filter empties are **dropped**, not rendered as bare headings
  - ✓ **All §14.4 states** — skeletons shaped like the cards they replace, empty, error, and **no-results distinct from empty** with a clear-filters action. RTL throughout, responsive, tested at 360 px
  - ✓ **Reuses the existing design language** — `.cal-toolbar`/`.cal-filter` for the filter row (one filter appearance platform-wide), `Container`, `Dialog`, `Icon`, and the shared `states.tsx`. No second design language; file-type icons joined the one shared icon set
  - ✓ **Two views on one navigation node** — §14.1 lists exactly one resources node, so the drill-down is `?level=` rather than an invented path segment (§20 rule 16). Documented as the pattern for every future drill-down screen
  - ✓ Tests — 19 new (91 frontend total): the link-not-button distinction, plural agreement, verbatim display name, absent-vs-blank fields, each filter, group-dropping, Arabic search folding, and that a download-only kind renders **no** media element
  - ⚠ **BLOCKED on backend, Phase 2 reported separately:** no content listing endpoint exists **or is specified anywhere in the SRS**; `EducationalContent` has **no uploader field**, so the teacher name has no source; `GET /content/{id}/download-url` is specified but unimplemented. Two §5.2 divergences also need settling — the **Subject** tier (rendered as a card badge) and **`is_current` pinned** vs strict newest-first
- [x] Wire the library to real endpoints once the revision lands (delete the mock; the interface does not change)
  - ✓ **Preview and download now mint through `GET /content/{id}/download-url`** — `fetchContentUrl` was a stub returning `null` since the library shipped. Credentials travel as **props, not context**, because the same dialog serves the public library where both are legitimately absent
  - ⚠ Still open from the original investigation: **`EducationalContent` has no uploader field**, so the teacher display name on a card has no source (a §7 change plus a migration), and the two §5.2 divergences — the Subject tier and `is_current` pinning — remain for the Owner
  - ⚠ **Investigated 2026-07-30 and reported, not built.** Four hard blockers, all needing a Document Owner decision:
    **(1) No content LISTING endpoint exists or is documented anywhere in the SRS.** TD-3.5 defines only `POST /uploads/initiate|/complete|/abort` and `GET /content/{id}/download-url`; there is no `GET` route that lists content. Building one is inventing an endpoint (§20 rule 16) and needs a revision (Revision 21: later milestones add endpoints through subsequent revisions).
    **(2) `EducationalContent` has no uploader field**, so the requested *teacher display name* has no source. §7's field list does not define one either — this is a §7 change plus a forward-only migration.
    **(3) The presigned GET mint is unimplemented** (PENDING, M6), so private content cannot be previewed or downloaded at all.
    **(4) No content rows exist** and `/uploads/*` is unbuilt, so there is nothing to display.
  - ⚠ Three points where the requested design and §5.2 differ, for the Owner to settle: §5.2 mandates a **Subject** tier and a **"Global / بدون فرع"** container at the top of the branch tier (the brief omits both), and pins the **current** academic year at top (the brief asks strict newest→oldest).
  - ✓ **Previews need no architectural change** — §14.6 already specifies them (PDF inline, `<audio>`, image lightbox, office download-only) and public content sits behind stable same-origin URLs the CSP already allows. The one open question is that private content is served via 10-minute presigned URLs, so a long video can expire mid-playback.
- [~] storage lifecycle jobs (TD-7): `upload.gc` is complete as a daily bounded 250-object
  continuation chain over public/private browser staging and private server-finalization,
  with strict `LastModified < 48 h` deletion. `content.quarantine-purge` is registered and
  healthy for transactionally committed exact old-key quarantine transitions and deliberate
  R59.1 permanent-delete retirement; storage failure retries and a missing queue rolls the
  database purge back. **OWNER DECISION REQUIRED — AUTOMATIC QUARANTINE DESTRUCTION:** no
  handler reads `purge_after` and no age-based destruction is scheduled until the Owner
  authorises it after the object-store/backup decisions and Production-scale restore drill
- [ ] §18 Content, Consent & Storage checklist green

## M7 — Hardening & Launch Data
- [x] **Hosted real-stack integration gate** — every push/PR now builds a uniquely named
  disposable PostgreSQL/MinIO/pg-boss/Nginx stack, deploys every migration, runs the actual
  Production and fixture seeds, waits for whole-application health, and executes the complete
  integration/API suite through the same all-table logical-isolation runner used locally.
  Release publication depends on this fifth verification job. The first run passed **1887**
  active assertions but correctly failed on a leaked normalized-email lock and an inexact
  scheduling-order restore; both fixtures now clean only their exact owned coordinates, and
  focused disposable reruns are isolation-clean. The final complete disposable rerun passed
  **1887/1887 active assertions** with an identical all-table logical snapshot. Hosted CI then
  exposed a pre-existing clean-checkout mismatch: the syntax-aware no-PII guard needs the
  TypeScript compiler but had been placed in the dependency-free job. It now runs after the
  backend's locked install, with a portability guard pinning that exact boundary.
  The corrected hosted run `33246930840` then passed guards, contract, backend, frontend and
  the full disposable integration job, and published both exact-commit images for
  `9e0b303c27e77ec731e3afee936dcb31cd165504`.
- [x] **GitHub Actions Node 24 runtime majors.**
  The Document Owner approved the bounded
  tooling upgrade on 2026-08-30. Every checkout and setup-node invocation now uses the
  maintained v7 line, whose official metadata declares `node24`; the workflow retains its
  explicit Node-version file and npm-cache inputs. The portability guard rejects a regression
  to an unapproved runtime major, so GitHub's compatibility override is no longer relied on.
  Hosted run `33287083470` passed all six verification jobs under v7 and published both
  exact-commit images for `09ecd09b83d52b2159ab21c3b022d22577167b22`.
- [x] **Fail-closed deployment readiness** — the API container healthcheck exercises the real
  DB/storage/queue/worker `/healthz` contract, and deployment verification treats every 503 as
  command failure with a bounded timeout; a running Node process is not called ready. A separate
  isolated Production-mode drill now applies all migrations, executes and byte-compares the real
  seed twice, proves the clean initial inventory and internal MinIO policies, loads the actual TLS
  Nginx edge, drives the built login/public routes in a real anonymous Chrome session without
  fixture authentication, then stops MinIO and requires HTTPS `503` plus Docker `unhealthy` before
  recovery. The drill is now a sixth hosted verification job and release publication waits for it.
  This closes the repository-side bootstrap evidence, not the still-open real-VPS certificate,
  authenticated Staging, resource-budget, backup/restore and rollback rehearsal.
- [x] **Bounded graceful API shutdown** — SIGTERM now closes HTTP and stops pg-boss polling
  concurrently; active handlers have 105 seconds to finish or return durably to retry, inside a
  two-minute Docker grace period. The Production drill asserts the resolved Compose value, and
  focused tests prove readiness becomes `stopping` before the worker drain completes.
- [x] **Disposable restart and persistent-recreation proof** — the Production-mode drill now
  proves a job inserted with the worker stopped drains after start, a real active handler finishes
  across SIGTERM, PostgreSQL and Nginx recover independently, a full stack stop/start retains state,
  and all long-running containers can be force-recreated over the exact database/object volumes.
  Seed rows, migration history, private object bytes, durable job states and the non-seeding API
  startup command are rechecked. Both candidate images now carry repository HEAD and every running
  API/Nginx container is pinned to its exact image ID. The same drill creates an encrypted recovery
  point from the Production-mode graph, writes later database/object state, destroys both volumes,
  restores the earlier point into empty replacements and requires exact-release health plus the
  pre-change values without implicit migration/seeding. Real-host pressure, selected Moroccan
  storage/backup targets and realistic-volume RTO remain open.
- [x] **Executable clean-VPS preflight** — the deployment now stops before runtime mutation unless
  the target is a supported Ubuntu LTS/AMD64 host with local boot-enabled Docker, Compose ≥2.24.4,
  NTP, persistent/adequately sized Docker storage, an exact detached clean checkout, private
  secret files, exact IPv4/no-AAAA DNS, valid same-origin configuration, the audited service/
  port/volume/log/restart graph and both exact GHCR manifests. The disk floor remains an explicit
  Owner capacity input rather than an invented default; passing is readiness, never a deployment
  or backup claim. A real Staging run found that unprivileged `sshd -T` cannot read correctly
  root-only host material; preflight now uses a pinned non-interactive root inspection command
  instead of weakening SSH file permissions. The same run proved both exact GHCR packages are
  publicly readable and found no Docker credential file; the gate now accepts that legitimate
  state while still protecting any installed credential and requiring both exact manifests.
- [~] **Production provider/capacity decision packet** — one authoritative
  [quotation evidence matrix](operations/provider-acceptance.md) now covers Morocco-only primary
  and secondary residency, compute/memory growth, ~200-GB NVMe, access/network/recovery, offsite
  backup failure domain, maintained S3 compatibility and administration, platform restrictions,
  costs and exit terms. Engineering recommends a **50 GiB deployment floor**, **60 GiB warning**
  and **50 GiB critical state** for the planned disk; this reserves rollback/restore and runtime
  headroom but does not prove the disk is large enough. **OWNER INPUT REQUIRED:** supply the SRS
  recording/week and average-size budget, approve or replace the thresholds, and select a provider
  only from actual written quotation/residency evidence.
- [x] **Bounded Production container logs** — every base-Compose service uses one shared
  Docker `local` policy (10 MB × 5), retaining `docker compose logs` without allowing the
  engine's unrotated `json-file` default to exhaust the single VPS disk. A CI guard counts
  services and fails if any new or existing service omits the policy.
- [x] **Production configuration boundary** — the Production overlay structurally forces
  `NODE_ENV=production` while Staging structurally remains fixture-permitting; boot rejects
  non-canonical/cross-origin storage routing, non-HTTPS external origins, and reuse of one
  signing key for access and onboarding tokens. The checked-in Development default can no
  longer silently become the Production runtime tier; its `NODE_ENV` guidance enumerates all
  three TD-13 values and explicitly preserves Revision 104's uniform error boundary. The
  older fresh-Production-seed harness was found still exporting direct MinIO as the public
  storage origin; the real validator correctly refused it after all migrations. Its browser
  coordinate now uses the mandatory same-origin `/storage` path and the complete disposable
  seed/authorization/scenario drill passes again.
- [x] **Exact-commit release artifacts** — after all six verification jobs pass on a
  `develop` push, CI publishes API and environment-independent web images to GHCR under the
  immutable 40-character commit tag and revision label. Staging/Production select both
  through `docker-compose.release.yml` plus exactly one explicit tier overlay; a missing
  tag/image stops the run and documented deployment uses `--no-build`. This closes the
  repository-side artifact gap, not the open
  host/access, object-store, backup, or clean-host rehearsal blockers in the
  [readiness ledger](operations/deployment-readiness.md).
- [x] **P0.1 / B1 object-store security — local engineering complete** — the affected final
  MinIO OSS pin remains prohibited for Production; the selected SeaweedFS replacement and
  full compatibility/recovery proof are recorded in the B1 section above.
  Nginx now applies the vendor-advised unsigned-trailer defence at every storage proxy path
  without weakening valid presigned GET/PUT. Application readiness is now provider-independent:
  it performs authenticated S3 `HeadBucket` against public, private and recording staging with
  the same credentials used by real work, and fails if any required bucket/authority is absent.
  The replacement contract also requires versioning disabled and refuses unapproved lifecycle
  or Object Lock behavior because exact-key deletion carries no storage version ID. The Compose
  image, initializer, container probe and raw-volume backup remain vendor integration points.
  These integration points are adapted and verified locally; live provisioning and any
  populated migration require separate authorization. See
  [Storage](architecture/storage.md#owner-decision-required--object-store).
- [x] **DOCUMENT OWNER ACTION REQUIRED — OPERATIONAL ALERT SURFACE.** **[Closed 2026-09-21 — the Owner said yes. Built as R169 §11: «حالة النظام», a derived Super-Admin read (no new entity, no inbox): failed and late jobs and unfinished storage retirements. The backup and certificate halves cannot be read from inside the API container and are carried as their own box in R169's section]** TD-14/TD-16 require
  terminal job failures, queue lag, backup failure and TLS expiry to surface on the Admin
  dashboard. The implementation has no such read, TD-3 names no route, and R77–R93 deliberately
  constrain `Notification` to targeted Session/Event/Exam facts. Define the smallest route/DTO
  and whether this is a new entity or a derived projection; do not overload personal inboxes or
  invent an undocumented endpoint. Until then failed jobs are durable and runbook-visible only.
- [ ] TD-11a targets measured against ceiling-scale fixtures (§2.4); no N+1 / unbounded scans audit
- [ ] Arabic RTL pass: complete ar catalog, error message_keys (fr/en post-MVP §10.1)
- [ ] Nginx rate limits verified live (TD-13); presigned-URL permission audit
- [ ] Locked CLI restore script (`npm run db:restore`) wrapping restore + cascades + audit in one transaction; executed once on fixtures (§4.10, TD-8)
- [~] backup + restore — pinned encrypted restic recovery-point creation, empty-target restore,
  portable `pg_dump`, raw data/TLS/config volumes, fail-safe exact-container restart and destructive
  disposable drill are complete (under one minute, raw DB + actual clean-database `pg_restore` +
  object + config recovered). Repository authority is checked before writers stop, and a wrong
  credential is proven visible without stopping/recreating the running services. The complete
  Production-mode graph additionally becomes healthy after an empty-volume recovery and proves
  that later DB/object state is rolled back under the exact source-labelled image IDs. **OWNER DECISION
  REQUIRED — BACKUP TARGET AND RETENTION:** provision the second Moroccan SFTP location,
  escrow keys/password, and set retention. Still release-blocking: `backup.replicate` nightly
  pg-boss automation (an unmonitored cron substitute is explicitly not implemented), critical
  alert/staleness visibility and realistic Production-host RTO drill. The B1 object-volume
  adaptation and disposable SeaweedFS recovery proof are complete; no live rollout occurred.
- [~] **P0.3 permanent purge and staging lifecycle** — independently solvable safety work is
  complete: exact replacement/deletion obligations are transactionally durable; manual content
  purge cannot erase its last storage coordinates; retry after ambiguous delete is idempotent;
  old-key work cannot touch a newer canonical key; and bounded `upload.gc` covers every browser
  and server-finalization staging scope but not R100 provider staging. A disposable real
  PostgreSQL/MinIO/pg-boss drill passes. **OWNER DECISION REQUIRED — AUTOMATIC QUARANTINE
  DESTRUCTION:** select/approve the automatic 90-day record/object policy before scheduling any
  `purge_after` scan
- [x] **DOCUMENT OWNER ACTION REQUIRED — R111 account-purge reconciliation.** **[Closed 2026-09-21 — STALE in substance: the purge job exists (`trash.retention-purge` → `deIdentifyAccountSystem`, daily), and the window is SEVEN days (R133), not three. What remained was the SRS's own body text, reconciled under R169: §5.2 and TD-7]** The ratified
  R111 design and shipped UI promise automatic de-identification after the account's three-day
  restoration window, but the authoritative SRS still says account deletion is unapproved in
  §5.2/§14.1, excludes User from the complete restorable set in §0/§4.10, lists neither
  `DELETE /profile` nor `DELETE /admin/users/{id}` in TD-3, and has no account-purge job in
  TD-7. The routes are present only in the derived `td3-routes.txt`, so the
  conformance guard cannot detect this drift. Reconcile those clauses and define the job name,
  payload, trigger and singleton rule; until then manual `?permanent=true` is complete, while an
  untouched soft-deleted account remains identifiable past `purge_after`. Do not invent the
  missing TD-7 row in implementation.
- [x] **R131 POLICY RATIFIED (Owner, 2026-09-03) — deletion and retention.**
      *(Policy and architecture only; nothing is implemented and no behaviour
      changed.)* Ten-year retention of identifiable educational history after
      the **derived** last educational activity — the association's own
      purpose-based policy, **never described as CNDP-prescribed**. Two distinct
      requests: **Option A** account closure keeping the minimal educational
      archive, and **Option B** full educational deletion, **Super Admin only**,
      a request rather than a cascade, with the attestation warning stated
      before confirmation and no preselected destructive option. For a minor the
      request comes from a live approved guardian and still needs Super Admin
      review; a self-managed adult exercises her own rights and a historical
      link makes nobody her owner. Rejected and never-admitted applications:
      **twelve months maximum**. The **R111 ↔ R122 contradiction is resolved** —
      `referenceCode` survives Option A as protected pseudonymous data and is
      deleted by Option B, never a back door into deleted history.
      `docs/SRS-PROPOSAL-R131.md` and
      [personal-data-map](development/personal-data-map.md).
      - [ ] **IMPLEMENTATION BLOCKED BY DESIGN until the seven reconciliations in
            the data map are closed** — `ChildApplication`'s copied identity
            fields (now including R130's birth date), Trash snapshots, audit
            detail, consent evidence, `NormalizedEmailLock`, backups, and the
            12-month application purge that touches the same rows. **A partial
            purge that claims data is gone while obvious copies remain is worse
            than none.** No purge job is to be written before then.
      - [x] **DONE (2026-09-04) — Option A now keeps `referenceCode`.**
            `deIdentifyAccount` no longer clears it, and `hadIdentitySurface`
            stopped counting it in the same change: leaving it in that predicate
            while the field is deliberately kept would have made an idempotent
            job rotate `qr_ref` and write a second audit row on every retry.
            Preserving it opens no way back in — the one surface that takes a
            code resolves `WHERE deleted_at IS NULL` and a closed account is
            soft-deleted — and it is never reissued, because
            `allocateReferenceCode` counts rows regardless of `deleted_at`.
            13 focused tests; proved against the defect. **Option B remains
            unimplemented and the rest of the R131 map is untouched.**
      - [x] **DONE (Owner, 2026-09-04) — self-managed authority is DURABLE.** R132 read
      it as *an account with no active login identity*; Option A deletes
      `UserIdentity`, so that reading broke the moment closure shipped — and held
      only because the resolver separately requires a live student. Authority is
      now derived from the **approved `SelfManagedClaim`**, which survives
      identity removal, logout, closure and re-binding. `DOB ≥ 18` is eligibility
      only; a credential is a mechanism only. Three paths corrected, including
      the **linking write**, where a closed self-managed adult would otherwise
      have been accepted as a linkable child and a guardian handed authority over
      an adult who had taken it away (`ACCOUNT_SELF_MANAGED`). One additive
      index; no column, backfill or fabricated status. 11 policy tests + 126
      across the affected suites; proved against the defect.
- [x] **WITHDRAWN (Owner, 2026-09-05 — R133) — Option A / Option B and
      `FullDeletionRequest`.** Both were built on 2026-09-04: the request/review
      control plane, then destructive execution. R133 replaces the pair with
      **one** concept — «حذف الحساب» — and makes ordinary permanent deletion do
      what Option B did, so the distinction has no subject and the review queue
      nothing to decide between. Removed: the model and its table, four routes,
      the contract entries, the TD-3 registrations, the profile request block,
      the adapter, the Arabic copy and the `pending_full_deletion_request`
      account purpose. `erasure.ts` survives as the destruction primitive,
      reached now by the single deletion path.
- [x] **DONE (2026-09-04) — the guardian-only cleanup GUARD.** R131's §4.3
      clause was ratified but had **not been carried into `SRS.md`** by the
      reconciliation pass; it is there now. `policies/guardian-purpose.ts`
      answers *does this account still have a purpose?* across all seven §4.3
      conditions plus two the platform gained since (a self-managed adult is
      never a guardian-only account; an undecided full-deletion request preserves
      both parties). The predicate is **inclusive by design**: a missed purpose
      closes an account that should have lived, while a spurious one merely
      leaves one alive. 11 tests, including §4.3's named case of a rejected link
      beside a pending application.
- [x] **WITHDRAWN (Owner, 2026-09-05 — R133) — guardian-only closure as a
      separate concept.** The dedicated action and its account-purpose policy
      lasted a day. They only made sense while *closing a guardian* differed from
      *deleting an account*; under R133 it does not. The route, service, policy,
      its tests, the row action, the copy and the browser harness are gone.
      **The safeguarding property survives and was never the guard's doing** —
      *deleting a guardian must not touch her child* belongs to the erasure
      boundary, and is asserted directly against ordinary deletion in both
      directions. Her `FamilyLink` rows go with her (§10); the other party keeps
      everything.
- [x] **WITHDRAWN (Owner, 2026-09-05 — R133) — the ten-year educational
      retention clock.** §4.10a gave it three purposes: educational continuity,
      former-beneficiary requests and attestations. R133 withdraws two outright —
      there is no attestation promise after deletion and no return path — and the
      third is served by the account's own lifetime. **It was never externally
      required**: §4.10a says in terms that it is the association's own policy and
      not CNDP-prescribed, so removing it costs no obligation. The service, dry
      run, daily job, readiness slot, tests and tombstone exemption are gone;
      `erasure.ts` survives as the primitive that decides what counts as her own
      data, now reached only by permanent account deletion.
- [x] **DONE (2026-09-04) — the 12-month REJECTED-application eligibility.**
      `application-retention.service.ts` reports rejected child applications past
      twelve months from `decided_at`, the one reference point §4.10a makes
      precise. **A dry run: it deletes nothing**, and the rows it names still
      carry the child's copied identity fields — which is exactly why execution
      waits. 6 tests including the exact boundary.
- [x] **RESOLVED AND ENFORCED (Owner, 2026-09-04) — the PENDING-application
      reference point is `created_at`.** Twelve months from when she asked, and
      **deliberately not `updated_at`**: an administrator opening a record would
      otherwise postpone its expiry, which is a retention clock nobody controls.
      Rejected applications keep `decided_at`. Both clocks now EXECUTE —
      `purgeElapsedApplications`, scheduled daily beside the other purges — and
      execution deletes the whole row rather than stripping it: a husk with every
      identifying column nulled and a `consent_text_version` recording consent
      for a child who never existed is an evidence shape with nothing left to
      evidence. **The Trash snapshot goes in the same transaction**, or the
      erasure is cosmetic. There is no renewal lifecycle; a family who still
      wants a place submits a fresh application.
- [x] **BUILT (Owner, 2026-09-05 — R133 §14) — rejected-registration
      retention.** The blocker was a missing rejection instant, and the smallest
      correct fix was the one recorded: one nullable
      `user.account_status_decided_at`, written by the four operations that
      decide a status — approval, rejection, suspension, reactivation.
      **`updated_at` is not that instant** and reading it would measure the wrong
      thing. Twelve months from the recorded decision, and it **deletes through
      the account's own lifecycle** — soft delete into the seven-day window, then
      the ordinary purge — so there is one deletion path and a week in which a
      Super Admin can undo a sweep nobody asked for. System-initiated: no actor
      is borrowed, `deleted_by` is null.
      **The legacy exception is silence, not a guess**: rows decided before the
      column existed carry NULL, are skipped by construction, and are left for an
      administrator to delete deliberately. Backfilling from `updated_at` would
      fabricate a rejection date for a real person.
- [x] **RESOLVED BY AUDIT, not by decision (2026-09-04) — `notification.subject_user_id`.**
      §4.10a kept it PRESERVE provisionally and warned that a surviving
      notification must not become a covert store of deleted data. **In this
      schema it cannot**: a `Notification` stores a type enum and foreign keys and
      **no text at all**, and the title is composed at read time from the subject
      relation — so de-identifying a person de-identifies every notification about
      her automatically. The provisional classification is therefore safe as a
      **consequence of the schema**, not as a policy guess, and no Owner decision
      is needed. **The conclusion depends on that shape**, so a guard asserts the
      table has no free-text column and says in its failure message to reopen the
      classification if one appears.
- [x] **DECIDED AND IMPLEMENTED — the birth date's Option A classification.**
      *(Owner decision 2026-09-04.)* **The birth date is ACCOUNT data and Option
      A clears it.** The audit that preceded the decision had already established
      the engineering half — no retained educational record reads a birth date,
      nothing else depends on it, and nothing exposes it after closure — leaving
      only the policy question of whether a future attestation must name one.
      The Owner's answer: it need not, because `reference_code` is already the
      protected pseudonymous locator that reconnects a returning person with her
      history, so a birth date adds nothing the archive needs while being one of
      the most identifying fields the row holds.
      **Removed, never transformed** — no year-only truncation and no age
      snapshot, each of which would invent a new fact at the moment of erasure.
      `sex` still survives, and the asymmetry is the test this list applies:
      §4.4b evaluates Level restrictions against it, so a preserved enrolment
      stops making sense without it, while nothing reads a date of birth.
      Audit names the field and never the value.
      - [x] **WITHDRAWN (Owner, 2026-09-05 — R133) — the return/reactivation
            workflow.** Built on 2026-09-04 and removed the next day, because the
            archive it reconnected people to no longer exists: permanent account
            deletion now destroys the beneficiary's own history. Within seven
            days a Super Admin restores the account through the Trash; afterwards
            a returning person **registers normally** and gets a new record.
            `AccountReturnRequest`, its table, routes, screen, navigation entry,
            registration intent, copy and browser harness are all gone.
- [x] **DIRECTION SETTLED (Owner, 2026-09-03) — the normalized-email lock is to be
  keyed, not raw.** The design is ratified and complete in
  [email-lock-keying](development/email-lock-keying.md):
  `HMAC-SHA-256(EMAIL_LOCK_KEY, "bodour.email-lock.v1|" + normalized)` as the primary
  key — **HMAC and not bare SHA-256**, because the space of real addresses is
  enumerable and an unkeyed digest is the address in a thin disguise. Rotation and
  secret loss are both *truncate and continue*: a lock row carries no ownership and no
  history, so nothing is lost, and there is deliberately **no dual-key lookup** (a
  digest is a lookup key, and recomputing one needs the plaintext this design stops
  storing). The migration is forward-only and truncates rather than backfilling, for
  the same reason. `deIdentifyAccount` still must **not** delete lock rows.
  - [x] **IMPLEMENTED AND LOCALLY VERIFIED; ROLLOUT REQUIRES PROVISIONING.** The later
        B2/B3/B7 instruction authorises code and disposable verification without
        installing real secrets or shipping. The original secret-before-code stopping
        point is superseded only for that local engineering work. `EMAIL_LOCK_KEY`
        remains required at boot, without a raw/default fallback; every writer must
        receive the same operator-managed key before the stopped-writer migration and
        restart. No real environment has been changed. See the current recovery entry
        at the top of this file and the linked runtime evidence.
- [x] **TEST ISOLATION (2026-09-03) — the refresh-token suite destroyed audit rows it did not
  own.** Its cleanup deleted `auditLog` where `{ targetEntity: 'User', actorUserId: null }`
  **with no ownership term at all**, so every run swept every system-written User audit row in
  the database, whoever wrote it and whenever — caught by the all-table guard as `audit_log`
  losing two pre-existing rows across a full run. System rows carry a null actor and cannot be
  found through the tagged actor the rest of the cleanup uses, so they are now scoped by
  **target**, resolved from the suite's own users first — the shape the P1.2 fix below used for
  staffing. **Proved against the defect**: an unowned probe row survives the fixed cleanup
  (1 → 1) and is destroyed by the old predicate (1 → 0).
- [x] **P1.2 TEST ISOLATION — the integration sweep now leaves shared Local Development state
  unchanged.** The staffing loss reproduced in `branch.integration.test.ts` alone: its first
  `beforeEach` cleared with `userId: actorUserId ?? undefined` before the id existed, and Prisma
  omitted the undefined predicate, deleting all staffing. Cleanup now resolves suite-tagged user
  ids first; the shared teaching helper rejects unsafe ownership tags before querying.

  **The durable guard is broader than the incident.** `scripts/dev/test-integration.sh` compares
  privacy-safe logical hashes for every application base table before and after the sweep, while
  a source test rejects unscoped/undefined-filter `deleteMany` cleanup. Deliberately restoring the
  bad predicate left **17/17** branch tests green but made the wrapper fail on the exact **2 → 0**
  staffing loss. The same guard exposed and drove exact `finally` restoration for whole-set
  Branch/Category/Subject reorder tests, Morocco-local association dates for online-class tests,
  fail-safe recording teardown, and three browser authorization probes that could mutate ambient
  Teacher, Admin, Level, Category, beneficiary, or enrolment state. Those probes now use exact
  tagged, fail-safe-cleaned identities and coordinates. B-01 retry assertions now distinguish
  equivalent live-worker convergence from a dedicated exact-job pg-boss retry proof, eliminating
  competition with the running Production worker without weakening final row/object checks. The
  final sweep passed **1802** active tests and its complete logical database snapshot was identical
  before and after. Fixture reseeding is no longer the remedy or the definition of success.

  **Reviewed and hardened on integration (Claude, 2026-08-27).** The root cause was reproduced
  independently — the pre-fix file alone passes 17/17 and takes staffing 2 → 0, and the new
  wrapper catches it — which also **corrects this document's own earlier claim** that a preceding
  suite was required. That claim was a mismeasurement and is withdrawn. Three additions, each
  closing a way a guard could pass while proving nothing:

  1. **The state snapshot refuses to emit an empty catalogue**, and the wrapper refuses an empty
     digest file. `cmp -s` on two empty files succeeds, so a snapshot that returned nothing would
     have reported every run clean — the same fail-open shape as the three CI guards that
     depended on an absent `rg`.
  2. **The source guard now falsifies itself.** Its only assertion read the real tree and expected
     `[]`, which a detector that matched nothing would satisfy forever. It is now aimed at both
     unsafe constructs and required to report them, at their safe counterparts and required to
     stay quiet, and at parentheses inside strings and comments.
  3. **One B-01 race survived**, in a sibling of the test that was isolated: *«a transient
     public-delete failure stays fail-closed and retryable»* still reached the live queue through
     `decide` + `reevaluate`, so the running worker could delete the public object before the
     assertion that it was still there. It now sets its precondition directly, which is the
     isolation the replacement, deletion and pg-boss retry tests in the same file already use.
     No assertion changed.
  4. **A fourth, found by the review rather than by either author.**
     `check-prisma-mass-write.sh` has scanned `backend/src` since R39b and covered the offending
     file, yet reported nothing: its pattern was `:\s*undefined`, which matches `id: undefined`
     and misses `userId: actorUserId ?? undefined` — the shape that shipped. **The hole was the
     pattern, not the coverage.** Broadened to `\bundefined\b` and proven by restoring the
     pre-fix file, which it now reports. The two guards are complementary: this one covers every
     Prisma mass write in `backend/src` and `backend/prisma`; Codex's covers integration suites
     and shared helpers including a missing `where` entirely.

- [x] **P1.2 follow-up — every named shared-state leak is closed (2026-08-28).**
  The setting fixture restores the complete logical row (`value`, `version`, `updated_by_id`),
  not merely its JSON value. Registration, approval and staff-registration suites record exact
  random onboarding-token JTIs at issue time and delete only those coordinates; neither a
  purpose-wide delete nor a before/after delta can erase a real user's replay guard. The final
  full sweep exposed the previously masked staff-registration issuer as `consumed_token 0 → 14`;
  its 14/14 focused run now leaves the snapshot unchanged. R76's whole-set Category/Subject
  ordering is restored from exact captured ids in `finally`.

  The later `[تجريبي]` soft-delete signature was independently resolved by making the deletion
  suites own the rows they target; seeded groups/schedules are never selected as convenient
  ambient examples. The audit-purge repository proof now uses a unique per-run marker and fixed
  clock inside a deliberately rolled-back transaction, so it exercises the production-wide
  query without consuming an ambient historical fact. These are fixture corrections, not a
  reseed or an Owner-data rewrite; the logical-table isolation guard remains the acceptance
  condition. Final sweep: **89 files / 1857 active tests passed, 10 skipped**, with every
  application-table digest identical before and after.

## OWNER RATIFICATIONS OD-01 … OD-07 — 2026-08-26 · all answered, none open

**OD-01 · Catalogue management — Admin AND Super Admin.** Admin may manage ordinary
operational/reference catalogues **subject to the Admin's branch/scope where the catalogue is
scoped**. Platform-wide security, authorization, compliance and destructive-retention
configuration stays Super-Admin-only. **The UI is never the authorization boundary.** Applies
to the activity-type catalogue and Partners rather than hardcoding either.

> **OD-01 sub-decision (Owner, final): the split is by AXIS, not by visibility.**
>
> | catalogue | authority | vs R61 |
> |---|---|---|
> | الفئات · المستويات · المواد · مواد المستوى · مقرر الحفظ | **Super Admin only** | **unchanged** |
> | global platform / security / compliance settings | **Super Admin only** | unchanged |
> | scheduling types · Partners | **Super Admin only** until a later Owner decision | new — no supersession |
> | genuinely operational/scoped catalogues | **Admin + Super Admin**, where the write can be scoped safely | see below |
>
> **So R61 survives almost entirely.** The reversal is narrow, and two consequences must be
> settled inside the reconciling revision rather than assumed:
>
> **(1) Branch itself may not be scopable, and Rooms are.** The Owner's own criterion is
> *"where the existing authorization model can scope the write safely"*. A **Room** belongs to
> a Branch, so an Admin's branch scope bounds the write naturally. **Creating or deleting a
> Branch is inherently platform-level** — there is no existing branch to scope it by, and
> `GET /admin/branches` is Admin-*readable* precisely because selectors need it (R61.2), which
> is not an argument about writes. Recommend: **Rooms → Admin; Branch create/delete → Super
> Admin**; Branch *edit* is the genuinely open sub-case.
>
> **(2) R105's heading must stay truthful.** الإدارة means *Super-Admin-only by placement*. If
> any node inside it becomes Admin-manageable, either that node **leaves الإدارة** (a menu
> change the Owner must approve — **do not reshuffle silently**) or the heading stops being a
> fact about permission, which is exactly what R105 forbids. The Owner's framing — *«a
> truthful Super-Admin-only permission section for global curriculum/platform management»* —
> points at the first option for Rooms if they are delegated.
>
> **Neither blocks NEW B §C.**

**OD-02 · Parent edits preserve occurrence overrides.** `overridden = true` continues to
protect an individually-changed occurrence from a later parent update; *this and following*
keeps R50's split. Already the built behaviour — no change, now ratified for visibility too.

**OD-03 · عطلة is an ordinary Event**, `attendance_required = false`, schedulable and shown on
the calendar like any other. **Concrete §D requirement:** attendance-specific controls are
**not presented** when the chosen type does not require attendance — the catalogue's
`attendance_required` drives the form, which is why it is a stored column and not display text.

**OD-04 · Level orthography — the Subjects procedure, authorized.** Read-only semantic
reconciliation → in-place normalization only where identity is unambiguous → same id, all
relationships preserved → never a duplicate → **stop and ask on any genuinely ambiguous row.**

**OD-05 · حسابي shows no guardian personal or contact data by default.** The existence, type
and status of the relationship may be shown where useful; private guardian fields may not.

**OD-06 · Account retention — NO blanket decision.** NEW O's 35-relationship classification
comes first (DELETE · ANONYMIZE · PRESERVE · TRANSFER/REASSIGN · BLOCK). **Safeguarding,
consent and audit evidence are not physically deleted** merely because an account is, pending
an established legal/operational retention rule. The account may disappear while the necessary
historical record survives anonymized or retained.

**OD-07 · Re-registration.** During the 3-day window the identity/email gets **no new account**
— the original is in a recoverable deletion state, and restoration restores **that** account
rather than creating another. After permanent purge a genuinely new registration is allowed,
subject to whatever preserved/anonymized records remain. Consistent with §4.1's *"never
silently re-register or reactivate"*.

## READINESS AUDIT — 2026-08-26 (final planning pass)

### Supersessions the next session must write (all four are NEW B §C's first commit)

`Visibility` already exists as `public | private | hidden`; the **next free revision number is
109**. Four ratified clauses are contradicted by the Owner's NEW B decisions and must be
superseded explicitly, not silently reconciled:

| clause | says today | superseded by |
|---|---|---|
| **R43** | *"Sessions are PUBLIC — anonymous visitors browse the timetable"* | حصة gains a tier; legacy backfill `public` **preserves** this exact behaviour |
| **§4.6** | *"An exam has no visibility tier of its own"* | امتحان gains one |
| **§4.4** | `hidden` = staff + scope; **Admins see ALL hidden regardless of branch** | `hidden` = responsible + Super Admin — this **narrows** Admin reach |
| **`Event.visibility` default** | `private` (schema) | `public` for new rows only |

**§4.4's change is a NARROWING, not a widening** — today every Admin sees every hidden Event.
Say so in the revision; it is the one place where the new rule removes access somebody has.

### THE TWO RETENTION POLICIES ARE DIFFERENT — do not merge

* **Trash today: `PURGE_WINDOW_DAYS` = 90** (`trash.repository.ts`), BR-15's default window.
* **NEW O: 3 days**, for a **self-deleted account** only.
* **Automatic quarantine destruction of Educational Content remains an OPEN Owner decision**
  (R59.4) and is **not** authorised by the 3-day account rule.

⇒ NEW O introduces a **second, shorter window for one entity type**. It must not change
`PURGE_WINDOW_DAYS`, must not start the quarantine scanner, and must be visibly distinct in
Trash so a Super Admin can tell a 3-day account from a 90-day record.

### Resolved — do NOT re-ask

visibility semantics · default `public` · `hidden` = responsible + Super Admin ·
Event responsible = `EventStaff.responsible` (R71.3) · حصة responsible =
`CourseScheduleStaff.position='teacher'` **effective on the occurrence's own date** ·
امتحان responsible = `ExamStaff.supervisor` · legacy backfill `public` ·
occurrence-only = `overrideSession` + `overridden=true` · this-and-following = R50 split,
**no other mechanism authorised** · overridden rows protected from parent edits (already built,
`protected_sessions`) · Event × Content independence (already built, *"the content gates, the
sessions do not"*) · `الكل` = `UserBranchRole.branch_id IS NULL`, never a Branch row ·
Teacher phone/email stay blank.

## OWNER ADDENDUM — 2026-08-26 · manageable reference data, account deletion, legal pages

### Global rule (binding)

**Seeded does not mean immutable.** Any business/reference catalogue shown to users must have
an Admin/Super Admin management path; the seed is the initial state, never a whitelist, and a
seed rerun must preserve Owner-created rows. **Excluded**: internal ids, security policy, audit
records, tokens/hashes, migration metadata, authorization internals, immutable historical
evidence. **Reuse existing primitives** — `DataTable`, `FormDialog`, R76 ordering/reorder,
TD-5 blocked-delete + `BlockedNotice`, Trash/restore. No parallel management architecture.

### Management audit — result

| catalogue | managed today | action |
|---|---|---|
| Branches · Rooms · Categories · Subjects · Level Subjects · مقرر الحفظ | ✔ node + CRUD | none |
| **Academic Years** | ✖ **seeded, user-visible in scheduling/content forms, NO screen** | **new finding — add to plan** |
| **Scheduling types** | ✖ frontend constant `SCHEDULING_TYPE_SPECS` | NEW H |
| **Partners** | ✖ model does not exist | NEW N |
| Quran Surahs (114) | ✖ read-only | **deliberately excluded** — religious canon, not association data |
| Roles (5) | ✖ | **deliberately excluded** — §7: *roles are seeded, no CRUD in the MVP* |

### NEW H — DONE 2026-08-26 (R110)

Shipped as designed. `SchedulingType` is a seeded reference entity — `name`,
`structural_kind`, `attendance_required`, `display_order`, TD-15 `version`, TD-5 soft delete —
with a Super-Admin screen **أنواع الجدولة** (a NEW الإدارة node, not a reshuffle of R105's
order; two order guards restated). Five rows, three entities, no fifth model:
`class` → `RecurringCourseSchedule`, `activity` → `Event`, `exam` → `Exam`, **stored** and never
read off the Arabic name. `Event.scheduling_type_id` is nullable + required at the boundary
(R35) with `ON DELETE RESTRICT` and a blocked delete. Read = any staff who may schedule
(مؤطِّرة included, R93/R94); write = Super Admin only (OD-01). The **open question is answered**:
a seeded reference table, and OD-03's *"stored column, not display text"* is what settled it.
**R56 is exercised, not contradicted** — it named `attendance_required`'s exact condition — and
its other half stands: a holiday cancels no class. `docs/SRS-PROPOSAL-R110.md` is written for
the Owner; `SRS.md` untouched. Frontend registry **split, not deleted**: the catalogue is server
data, `STRUCTURAL_KIND_SPECS` keeps only what an entity can express.

### NEW H (original plan) — catalogue becomes a seeded reference MODEL + management

Five rows, each carrying **`attendance_required`** and **`structural_kind`**
(`RecurringCourseSchedule` | `Exam` | `Event`) — the kind is **stored, never inferred from the
Arabic name**. Order is a column, not a UI constant. Super Admin manages; **whether Admin may
write is an open question** — reference-taxonomy writes are Super-Admin-only today (R26/R61),
so granting Admin would widen an existing permission and needs ratification.
Historical scheduling rows must still resolve their type after it is deactivated/deleted →
use TD-5 blocked-delete + soft delete, never a hard delete. **Precedes §D.**

### NEW L — normalization protocol (same standard as the Subjects)

Inspect row + all relationships → verify no canonical duplicate → normalize **in place**,
same id, all relationships → never delete/recreate for spelling → never leave a near-duplicate
beside the historical row → **stop and report** any row whose semantic identity is uncertain.

### NEW G — privacy constraints (binding on the redesign)

Show: her own profile · registrations · enrolment (Category/Level/Branch) · teaching groups ·
account relationship/status. **Never by default**: guardian email, guardian phone, internal
account ids, identity/provider data, audit data, administrative notes, unrelated guardian
fields. A guardian field required by a business rule is **reported, not assumed**.

### NEW N — `Partner` model + landing section

New reference entity: `name`, `display_order`, active/visible state, soft delete. Four seeded
rows. **No logos, URLs, descriptions or contacts invented.** Landing reads from the database
and **renders no section at all when zero partners are visible.** Seed must not clobber
Owner-created rows.

### NEW O — self-service account deletion · **DESIGN SECTION FIRST, NO SCHEMA**

**Scale, measured: 35 foreign keys reference `"user"`** — audit_log, child_application (×4),
consent_record (×3), course_schedule_staff, enrollment, event_staff, exam_staff, family_link
(×2), grade, notification, quran_progress_log (×2), rate_limit_counter, refresh_session,
refresh_token, session_recording (×2), session_staff, student_exam_submission,
student_surah_progress, student_teaching_group, teacher_availability,
teacher_category_capability, teacher_subject_capability, trash.deleted_by, user.deleted_by,
user_branch_role, user_identity.

Every one must be classified: **delete · detach · anonymize · preserve as institutional record
· block purge until reassigned.** Deleting a login must **not** destroy grades, Quran progress,
attendance, safeguarding evidence or audit history. **Never `CASCADE DELETE User`.**

Already available to reuse: R102 revokes every session on rejection (same mechanism needed
here) · TD-5 Trash + `purge_after` · the pg-boss `content.quarantine-purge` worker is the
**exact template** for a durable, idempotent, retryable 3-day purge · `assertFreshActive`
already fails closed on suspended/deleted accounts.

**Known tension to resolve in design**: hidden scheduling items are owned by a *responsible
person* (NEW B §3). A deleted responsible principal must not orphan a hidden item →
likely category 5 (block until reassigned).

### NEW P — legal pages · **must follow NEW O**

`/privacy` and `/terms` **do not exist**. The policy must describe what the platform actually
does, so it cannot be drafted before the retention model is settled. Anything not supplied by
the Owner — registration numbers, legal entity, addresses, CNDP references, governing law —
is marked **OWNER/LEGAL INPUT REQUIRED**, never invented. Verify Google's current OAuth
requirements against Google's own documentation, not repository notes. **Do not submit
verification.**

### Production blockers — STILL OPEN, not closed by this batch

Historical list at that batch boundary; B1 object-store replacement is now locally closed
above, with live rollout still pending. Remaining here: backup target/retention · backup automation/alerting · Production
RTO drill · automatic quarantine destruction · ~~P1.2 test isolation~~ **CLOSED 2026-08-27** ·
manual Production launch data · no-PII audit · §18/M8 rehearsal. **Production undeployed.**

## NEXT BATCH — planned 2026-08-26, ready to execute after reset

**Order is dependency-safe. Do not reorder without re-reading the reasons.**

| # | section | kind | why here |
|---|---|---|---|
| 1 | **NEW B §C** backend visibility | feature + migration | design ratified; precondition audit below |
| 2 | ~~**NEW H** scheduling-type catalogue~~ **DONE (R110)** | reconciliation → feature | precedes §D, as planned — §D now builds on a picker that already reads the catalogue |
| 3 | ~~**NEW B §D** frontend Add/Edit + scope prompt~~ **DONE 2026-08-26** | feature | R50's scope prompt already shipped, so the tier joined the fields those three scopes already carry — no second recurrence mechanism |
| 4 | ~~**NEW B §E** full authorization matrix~~ **DONE 2026-08-26 — NEW B is CLOSED** | tests | 35 HTTP assertions; proven against four reintroduced defects; shared dev state measured identical before/after |
| 5 | ~~**NEW D** Teacher content-library lookups~~ **DONE 2026-08-27** | defect (backend authz) | `GET /me/scope-options` (R93.4's pattern); admin reads untouched and still refused |
| 6 | ~~**NEW E** الملف التدريسي false dirty~~ **DONE 2026-08-27** | **defect** | `dirty` meant *has content*, not *has changed*. Fixed via the shared `isDirty`; recorded as **UX rule AY.1**; guarded in `teachers.test.tsx` (proved against the reintroduced defect) and in the browser at check 14 |
| 7 | ~~**§8** table columns audit~~ **DONE 2026-08-27** | feature | Owner supplied the brief; recorded permanently as **UX rule BA**. الجدولة, حصص الجدول, المستويات, الفئات, المجموعات الإدارية and طاقم التأطير all gained the fields their rows already carried |
| 8 | ~~NEW I~~ **DONE** · ~~**NEW J/K/L**~~ **DONE 2026-08-27** | data | Owner supplied the dataset. Seeded for a fresh install and **reconciled in place** for an initialized one via `backend/scripts/reconcile-reference-data.ts`. **Category/Level descriptions are the one part not done** — see the open Owner decision below |
| 9 | **§9A–D/F** edit-form audit | feature | includes NEW E and NEW F |
| 10 | ~~**NEW F** availability page gains capabilities~~ **DELIVERED BY R106** | feature | `/teacher/availability` already shows her Subjects and Categories as **text**, and already compares `dirty` against the loaded record. Covered by `verify-teacher-portal.sh` (24/24). **Making them editable is not this item** — R88.2 refuses it in terms, so that would be a new Owner decision, not a carry-forward |
| 11 | ~~**§10** Rule AX carry-forwards~~ **DONE 2026-08-27** | feature | Recorder dialog converted onto the **shared** `useContentScope`. `session-materials-dialog` deliberately untouched — the audit marks it *Borderline, Owner decision*, and changing it would pre-empt that. The conversion uncovered a real seeding race in `useScopeOptions` (see below) |
| 12 | **NEW M** Teacher baseline import | **data, Production only** | after §9 so the profile form is correct |
| 13 | ~~**NEW O** account deletion — design only~~ **DESIGN DELIVERED 2026-08-27** | reconciliation | `docs/SRS-PROPOSAL-R111.md` classifies all 35, enumerated from the **live database**. Central finding: 26 must survive, so deletion is the **de-identification of a row that continues to exist**. **All four questions ANSWERED by the Owner 2026-08-27** and folded into §7; implementation (#14) is unblocked |
| 14 | ~~**NEW O** implementation~~ **DONE 2026-08-28** | feature (no migration needed) | **UNBLOCKED 2026-08-27** — R111's design is ratified. Self-deletion for every user including مؤطِّرات; admin-initiated deletion on the same 3-day window; tombstone «حساب محذوف»; BLOCK refuses **with an explanation naming what must be reassigned**, and does not reassign in the same action |
| 15 | **NEW M** Teacher import | data, **Production only** | R104 — never Staging |
| 16 | ~~**NEW G** حسابي redesign~~ **DONE 2026-08-27** | UX | The page said who she is and not where she is. `GET /profile` now carries `enrolments`, `circles` and `guardians`; the guardian block is **a name and a status, enforced by the projection**. Guarded in `pages/profile/privacy.test.ts`, proved against a reintroduced phone leak |
| 17 | ~~**NEW N** Partner model + landing~~ **DONE 2026-08-28 (R113)** | feature | Model, Super-Admin CRUD, public `GET /partners`, الشركاء screen, landing section that renders **nothing** when none is visible. **The four names are not seeded** — they are not recorded anywhere in this repository and the brief forbids inventing them; Owner decision: enter them through the screen |
| 18 | ~~**NEW P** privacy/terms + OAuth readiness~~ **DONE 2026-08-28** | docs + UX | `/privacy` and `/terms`, public, linked from the footer of every public page. Google's requirements verified against **Google's own documentation**; the platform requests only non-sensitive scopes, so app verification is not triggered. **Not submitted.** Everything legal is marked ⚠ rather than invented |
| — | **Academic Years management** | feature | fold into #8 (reference-data batch) |

### Findings that change the work (established, not assumed)

* **NEW C — CLOSED 2026-08-27, browser proof included.** Root cause was **not** the
  three-source union: `sort` was missing from `approvals.tsx`'s loader dependency array, so
  the header updated state and never re-requested. Fixed, with `sorted-pages-refetch.test.ts`
  covering all four server-sorted pages. The owed browser confirmation is now
  `scripts/dev/browser/verify-approvals-sorting.sh` (**7/7**). It seeds **three
  scenario-owned pending applicants** — the fixture work that was the honest reason to leave
  it open — whose name order (أ ب ج) and oldest-first submission order (ج أ ب) are neither the
  same list nor reverses of each other, so a screen returning its default order cannot satisfy
  both assertions. It asserts on its own rows' relative order only and removes exactly what it
  created; the queue was verified empty afterwards.
* **NEW D — the incorrect layer is the SHARED HOOK, not the page.** `useScopeOptions` calls
  `listLevels`, `listSubjects`, `listAcademicYears` — all `403` for a Teacher (R93.4) — while
  `listBranches` correctly returns `200` (branch.service admits teachers). R93.4 already set
  the precedent and the mechanism: **`GET /me/event-scope-options`** answers *what may I
  address this to* without widening any admin endpoint. **Do the same for content scope; do
  not grant Teachers the admin reads.** Fix is backend + hook, not per-page.
* **NEW H — there is NO `EventType` table.** The catalogue lives in
  `frontend/src/adapters/scheduling-types.ts` as `SCHEDULING_TYPE_SPECS`, a frontend registry.
  The five Owner types map onto three entities: **حصة دراسية → RecurringCourseSchedule ·
  اختبار → Exam · محاضرة/حفل/عطلة → Event**. `حضور اجباري` is a real property with nowhere
  to live today. **Decide before §D**: seeded reference table vs. extending the registry.
  Recommend a **seeded reference table** — the Owner calls the order canonical, and a
  frontend constant cannot be seeded or ordered by an administrator.
* **NEW I — DONE 2026-08-27.** `branch.phone_secondary` added (one additive nullable
  `VARCHAR(20)`), validated by the same rule as `phone`, mapped on both write paths, surfaced as
  its own management column/field and published on the §5.1 allowlist. Both contract key guards
  restated. **`phone` was not overloaded**, as instructed.
* **NEW M — "all branches" is already structural.** `UserBranchRole.branch_id IS NULL` means
  every branch (`branch-scope.ts`). **Never encode «الكل» as a Branch row.**

### Real-data / environment policy (binding)

* **NEW I, J, K, L** = Production **reference** data → `prisma/seed/production.ts`, additive
  and idempotent, matching R107's fail-closed style. Safe in Local Development.
* **NEW M (30 named real people)** = **Production only.** R104 forbids real person data in
  Staging and the Owner has **not** superseded it. **Never seed into fixtures, never into
  Staging.** Recommend an **Owner-controlled import file + a one-shot import script**, not a
  migration: a migration would replay real personal data into every environment that runs it.
* Keep `production.ts` (reference) and `fixtures.ts` (synthetic) strictly separate — the
  §15.2 firewall already exists; do not blur it.
* Phone/email for Teachers are unknown. **Do not invent placeholders.**

### BLOCKED FOR LACK OF A RECORDED BRIEF (found 2026-08-27, while continuing the roadmap)

Two roadmap rows carry a one-line label and nothing else. Neither can be implemented without
guessing, and guessing here produces rework rather than a wrong answer that shows up in a test:

* **§8 — "table columns audit".** Which tables, which columns, and what each is for is recorded
  **nowhere** in this repository — only the roadmap row. Its stated dependency (NEW I's column)
  is now satisfied, so the brief is the only thing missing. It came from an Owner message that
  was never written down.
* **NEW J, NEW K, NEW L — the reference-data baseline.** NEW I's *schema* half is done. J and K
  are **not defined anywhere in TASKS.md**, and no authoritative dataset — branch addresses,
  phones, opening hours, the Level orthography list — is recorded. The real-data policy is
  explicit that placeholder contact data must not be invented, so this cannot proceed on a guess
  either. NEW L's *protocol* is recorded; the rows it applies to are not.

**What would unblock them:** for §8, the list of screens and the columns to add; for J/K/L, the
actual values, which are Production reference data the Owner holds.

### Needs Owner decision before its section starts

1. ~~**NEW H** — reference table vs frontend registry, and whether `عطلة` is
   schedulable-with-attendance.~~ **ANSWERED and shipped (R110).** OD-03 settled both:
   `attendance_required` is *"a stored column and not display text"*, which requires a table;
   and عطلة is an ordinary schedulable Event with `attendance_required = false`.
2. ~~**NEW N** — static content vs Super-Admin-managed reference data.~~ **ANSWERED: Super-Admin-managed reference data (R113).** The landing page reads the table, so a partner is added without a deployment.
3. **NEW L** — existing Level names differ in spelling from the baseline; the same
   orthography question as the Subject normalization. Audit before touching.
4. ~~**NEW G** — which guardian fields may a beneficiary see?~~ **ANSWERED BY THE CONSTRAINT ITSELF, 2026-08-27.** The recorded rule already excludes guardian email, guardian phone and every unrelated guardian field *by default*, and requires that a field a business rule needs be **reported, not assumed**. So the conservative reading was implemented — **name and relationship status only** — and the projection is what enforces it. If the Owner wants more shown, that is an additive decision against a screen that currently discloses nothing extra.

- [x] **NEW B §C — scheduling visibility — DONE 2026-08-26 (R109).** Shipped: `visibility` on
  `RecurringCourseSchedule` (template), `Session` (snapshot), `Exam` (one column, no snapshot);
  `event.visibility` default `private` → `public` for new rows only; hand-written migration
  `20260826120000_r109_scheduling_visibility` backfilling every legacy row `public`, verified in
  the dev database (775 / 15 / 6 rows, events unchanged at 8/2/4). `hidden` narrowed from scope
  to **ownership** — responsible party + Super Admin — in one policy,
  `policies/scheduling-visibility.ts`, for all three kinds. The precondition below was honoured
  as designed: **`SessionStaff` is the resolution**, because it IS `CourseScheduleStaff`
  effective on the occurrence's own date, materialized. Tier gates publication
  (`/calendar`, `/me/calendar`, the §5.2 page, content→sessions), **not** the management lists.
  23 new integration assertions, **proven against the pre-R109 behaviour** (9 fail on it), plus
  HTTP-level assertions in the calendar and session-page suites. Three superseded §4.4 guards
  **restated, not deleted**. `docs/SRS-PROPOSAL-R109.md` written for the Owner — SRS.md untouched.
  ~~**Still owed by §D:** the frontend adapter maps `null` for a class and a sitting.~~
  **CLOSED by §D (2026-08-26):** both mappers hydrate, one shared `VisibilityField` renders for
  every kind and in the occurrence editor, and the three R50 scopes carry the tier to the
  endpoints they already owned. 19/19 in the browser.
- [x] ~~**NEW B §C — scheduling visibility (schema + migration + recurrence integration).**~~ Design **[Closed 2026-09-21 ledger review — done 2026-08-26 as R109 — the ticked copy is above]**
  ratified in §B; **not started** — the capacity checkpoint refused it at 19% session remaining.
  **Precondition audit COMPLETE (Owner question 3b), and it changes the design:**
  `@@unique([scheduleId, userId])` was withdrawn by R91, so a schedule may hold **several**
  `position = 'teacher'` rows — but *"at most one main مؤطِّرة active on any date"* is an
  **enforced invariant**, not an assumption: `course-schedule.service.ts` refuses overlapping
  mains with `OVERLAPPING_MAIN_TEACHER`, and `effective-staffing.ts` resolves `main` as a single
  `find`. **So the responsible party is unambiguous on any given DATE and ambiguous across the
  series.** The consequence for §C: hidden visibility of a **Session** must resolve its
  responsible teacher **effective on that occurrence's own date** (R91), never as of *now* —
  resolving as of today would strip a replaced مؤطِّرة of the occurrences she actually taught and
  hand her ones she did not. **This is the exact defect Codex caught in R106's exam scope**, so it
  is written down here rather than rediscovered. For an امتحان the responsible party is
  `ExamStaff.position = 'supervisor'`, which carries no effective dating and is therefore
  date-independent.
  Entry points: `course-schedule.service.ts` (`splitCourseSchedule`, `regenerateSessions`),
  `session.service.ts` (`overrideSession`), `calendar.service.ts` (`visibilityFilter`).
  **A second symptom of the same family, observed 2026-08-26:**
  `consent-safeguarding.integration.test.ts` passes **19/19 in isolation** and failed once inside a
  full sweep on `expected { state: 'completed' }` — a **pg-boss job-state timing assertion** under
  concurrency, in a file §6 did not touch. Both symptoms say the suite is not isolated: one loses
  shared fixture rows, the other races a background worker. **Fix them together.**
- [x] **P1.1 Quran-domain Production seed (R107–R108)** — القرآن الكريم is the domain, not
  a Subject. The additive initial baseline is أحكام القرآن, حفظ القرآن,
  ترتيل وتجويد القرآن, تفسير القرآن, فقه, السيرة النبوية, العقيدة, الأذكار; محو الأمية is
  not seeded fresh. Only حفظ carries `tracks_quran_progress`; runtime authorization resolves
  that marker rather than a name, so every other initial or later Quran-domain Subject remains
  ordinary unmarked curriculum. The seed preflights duplicate حفظ rows and conflicting live
  markers, asserts its exactly-one launch postcondition, and never deletes, renames or rewrites
  Super-Admin additions or historical rows. تفسير follows the Level's مقرر الحفظ Surahs but
  remains outside memorisation authorization and coverage. The disposable fresh-stack drill
  applies every migration, runs the actual Production seed twice, proves exact/stable baseline
  data plus additive preservation and fail-closed conflicts, and exercises marked-versus-unmarked
  teacher authorization through the real Quran policy/service before running the affected suites
- [ ] Manual launch-data entry session(s) with coordinator: branches, rooms, groups, roster (R-5, §15.1)
- [~] **No-PII log audit (TD-14) — independently determined code paths are closed.** Nginx now
  generates (rather than trusts) the request id and logs no URI/client address; Express logs the
  registered route template or `<unmatched>`; API and job-start logs copy no raw exception text;
  and the shared AuditLog repository recursively refuses copied identity/display fields and exact
  storage locators. Catalogue actions use target ids/changed field names; content audit uses a
  non-reversible exact-coordinate id while exact actionable keys remain in governed domain/Trash/job
  rows. Current finalization retry derives its immutable key from the accepted SHA-256 and grant id,
  retaining a read-only fallback for legacy audit rows. Unit, real PostgreSQL/MinIO behavior tests
  and the CI guard pin these boundaries. **DOCUMENT OWNER DECISION
  REQUIRED — AUTH AUDIT IDENTITY:** TD-8 says `auth.login` / `auth.login_denied` detail includes
  identity email, while TD-14 and §20 rule 18 say never log emails. Current implementation follows
  the stricter no-email rule. Reconcile TD-8 by either removing `identity email` (recommended;
  actor/target User id + provider + reason remain attributable) or explicitly defining a narrowly
  controlled AuditLog exception and its access/retention basis. **DOCUMENT OWNER DECISION REQUIRED
  — CONTENT AUDIT COORDINATES:** TD-8 R53 literally requires previous/new/raw deletion storage keys,
  while TD-14 prohibits filename-derived values in logs. Replace that wording with non-reversible
  storage-coordinate ids (recommended; exact locators remain recoverable in the authoritative
  lifecycle records), or define a controlled exact-key exception. **OWNER DECISION REQUIRED —
  AUDIT FREE TEXT:** TD-8 mandates reasons/justifications and setting old/new values, and consent
  audit accepts an optional note; each can contain personal data. Decide whether these are a
  governed AuditLog exception with explicit access/retention/input notice, or whether actions use
  structured reason codes while governed source-record text stays outside AuditLog. Until these
  decisions are reconciled, the audit remains partial rather than falsely marked complete.
- [ ] §18 Data, Admin & Audit checklist green

## M8 — Rehearsal, UAT, Launch
- [ ] §19.1 pipeline executed on the production Moroccan VPS (steps 1–10)
- [ ] Full E2E suite J1–J8 green on rehearsal deployment (§17, §19.2)
- [ ] All §19.2 named regression tests green (incl. VERSION_CONFLICT, capacity race, double-approval, MinIO-down, worker-down)
- [ ] UAT with branch coordinator incl. low-digital-literacy registration drill (R-1)
- [ ] R-9 upload failure rate measured during UAT; escalation decision recorded
- [ ] Certificate automation (Let's Encrypt) verified on VPS (R-8)
- [ ] §18 Platform & Deployment checklist fully green
- [ ] Production launch; LAUNCH row in CHANGES.log

### Owner clarification — account administration vs operational work (2026-08-28)

Recorded authoritatively in `docs/SRS-PROPOSAL-R111.md` §6a; the route and its
normative wording are proposed in `docs/SRS-PROPOSAL-R112.md`.

- [x] **المستخدمون is Super-Admin-only**, enforced in `user.service.ts` for the
      list and **every write beneath it**; proved with forged requests.
- [x] **`GET /admin/directory`** — the operational people-picker, Admin+, exactly
      `id`, `name_arabic`, `nickname`, `roles`. Five screens moved onto it.
- [x] **TD-3 line added by the Document Owner's instruction 2026-08-28** — R112 is
      in `docs/SRS.md` (§5.6, §5.7, TD-2) and all 27 CI guards are green. Was: `check-openapi-td3.sh` enforces
      §20 rule 16 and is **correctly failing**: an endpoint in the API document
      that TD-3 does not list is forbidden. `docs/SRS.md` is the Owner's; the
      exact proposed entry is in `SRS-PROPOSAL-R112.md` §3, with the TD-2 change
      in §4. **This is the only red guard.**
- [x] **Account deletion (R111 #14) — DONE 2026-08-28.** No migration was needed:
      a fifth `account_status` value was drafted and **reverted**, because the
      schema already records that TD-1's Deleted state is `deleted_at IS NOT NULL`
      so the two cannot disagree. Was: The
      authorization split above is its precondition. Still to build: the
      `AccountStatus` terminal value and its migration, self-delete for every
      user, the last-active-Super-Admin refusal (reusing the existing
      `LAST_SUPER_ADMIN` guard), Super-Admin delete of another account, permanent
      delete as R111's de-identification performed now, the 3-day window as a
      **second** retention window that must not disturb `PURGE_WINDOW_DAYS = 90`,
      and R111's BLOCK on live staff responsibilities.


### Found while building NEW N, not fixed — the Owner's edit

`/admin/scheduling-types` (R110) is in `admin-modules.ts` and in the navigation
harness, and **§14.1's sitemap does not list it**. `admin-modules.test.ts` did not
catch it because its expected list is hand-maintained against the registry rather
than against the SRS — the exact failure its own comment warns about. R113's
approved scope covers Partners only, so this is reported rather than taken.

### Owner decisions and open items from the 2026-08-28 batch

- [x] **A role is held once per account** — partial unique index
      `user_branch_role_one_live_role_per_user`, service refusal
      (`DUPLICATE_ROLE`), dropdown filtered. **Multi-branch scoping withdrawn
      deliberately** (ratified): a role carries one scope, a single branch or all
      of them. No account used the multi-branch form when measured.
- [x] **R80 point 6 amended** — `sex` is published on the Super-Admin-only
      `/admin/users` read so §5.6's edit form can hydrate it, and **nowhere
      else**. R80.3/R80.4 unchanged.
- [x] **عطلة is a `holiday` structural kind**; محاضرة corrected to `class`;
      `نشاط` added. Corrected in place with ids preserved.
- [x] **RESOLVED by the Owner, 2026-09-03 — minors and guardian emails (R129).**
      The earlier reading — *a minor signs in through her guardian's address* —
      is **superseded**. The model stands as §4.3 already had it: a minor is a
      **login-less row** reached through an approved `FamilyLink`, with no
      identity and no address of any kind, and R62.9 makes exactly that the
      definition. The guardian's authenticated email **may also be her own
      contact address** — there is no second column and none is to be added —
      but it is **never** copied into the child's identity, the child's
      pre-provisioned address, `ChildApplication` or `FamilyLink`, and it never
      means the child authenticates as her. A message concerning a child
      resolves the **live approved guardian** and reads her current address;
      there is still no email, SMS or push provider. The generic `email`
      projection keeps its wire name — the screen labels it «بريد Google», so it
      already reads as the login address — and the invariant is documented
      instead. `docs/development/account-and-membership.md`;
      `docs/SRS-PROPOSAL-R129.md` is **APPLIED to `SRS.md`** (2026-09-03).
- [x] **RESOLVED by the Owner, 2026-09-03 — a platform account is not membership
      (R129).** A guardian authenticating to manage children is **guardian-only**:
      not a beneficiary, not a Student, not enrolled, not staff, not a member,
      and absent from every beneficiary list. This is what the platform already
      did — R62 leaves `mustEnrol` empty for her and R79.3 writes
      `isBeneficiary` from the set the approval *enrols* — but nothing asserted
      it end to end. Now pinned by six tests. A guardian who later joins uses
      the **same** `User`; no second account and no second membership system.
- [ ] Codex's four open Owner questions (audit identity email, exact storage-key
      wording, required free-text audit evidence, the R111 3-day purge job)
      remain open and were **not** touched by this batch.
- [x] **R122 — an enrolment belongs to an academic period.** `AcademicPeriod`
      added; `Enrollment.academic_period_id` nullable in the schema and
      **required at the write boundary**; the live-row unique index becomes
      `(student_id, level_id, academic_period_id)`, narrowing BR-21 to *within a
      period*. Currency is derived from the period's dates — `deleted_at` keeps
      its single meaning of *ended early by a person*. **No historical row is
      backfilled and the seed creates no periods**: guessing a semester the
      association never recorded would be indistinguishable from a real one a
      year later. `Level` remains the studies year; no `StudiesYear` entity was
      created.
- [x] **الفصول الدراسية — the management screen** (`/admin/academic-periods`,
      الإدارة, Super Admin). Built with the model rather than after it: the seed
      creates no periods, so without it approval would have refused every
      applicant with nothing an administrator could do. List · create · edit;
      **no delete**, because a semester the association ran is a fact and
      enrolments point at it under RESTRICT.
- [ ] **Owner data task, not an engineering one:** the periods of the current
      academic year must be entered on that screen. Until one covers today,
      approval refuses with `NO_CURRENT_ACADEMIC_PERIOD` — which is the intended
      behaviour, not a defect.
- [x] **R123 — attendance (§4.7) is built.** `Attendance` on the three dated
      occurrence carriers; `attendance_mode` replaces `attendance_required`;
      `attendance_marking` on the class and the activity;
      `Category.self_attendance_allowed` makes «a minor never self-marks»
      machine-readable. The register lives in the shared occurrence dialog, the
      beneficiary gets «تسجيل حضوري» and never the roster, and عطلة/حفل are
      refused server-side on every path. **No analytics, no QR.**
- [x] **SRS Revision 123 RATIFIED** by the Document Owner, 2026-09-04. §4.7 is
      replaced, §20 rule 16 no longer names attendance, §10.1's roadmap bullet is
      retired and §7 carries `Attendance`. Both sub-decisions were answered:
      **حفل stays `disabled`** and **اختبار is `required`** — and exam attendance
      is normatively independent of exam submission and exam grade.
- [x] **R124 — the online assessment builder.** `exam.mode = 'online'` activated;
      `ExamQuestion`/`ExamQuestionOption`/`StudentExamAnswer`/`StudentExamAnswerOption`
      replace two `jsonb` blobs; five targets behind one resolver; draft →
      published → closed; حفظ ≠ إرسال; the paper freezes on the first
      submission. **Grading is the existing sheet** — no second scale, no
      automatic scoring, no analytics.
- [x] **SRS Revision 124 RATIFIED** by the Document Owner, 2026-09-04. §4.6's
      *«online is declared and refused»* is superseded, its question-type and
      auto-grading clauses are narrowed to v1, and §7 carries the four new
      entities. Both sub-decisions were answered: **the first submission freezes
      the paper** (no question versioning in v1) and **there is no staff reopen,
      reset or resubmit action in v1**.

### Open questions from the autonomous session of 2026-09-04

- [x] **ANSWERED AND IMPLEMENTED — SRS Revision 125 (2026-09-05).** A Level
      target **does not** override branch authorization: a branch-scoped Admin
      may create, use or publish one only when the resolved audience is entirely
      within her branches — checked through §4.4c's single audience definition,
      re-asked **at publish**, and refused with `TARGET_OUTSIDE_BRANCH_SCOPE`. A
      Super Admin is unaffected.
- [x] **ANSWERED AND IMPLEMENTED — SRS Revision 125 (2026-09-05).** A مؤطِّرة may
      address an individual beneficiary **within her own teaching**, answered by
      `studentsTaughtBy` — *may she address THIS student*, never *this whole
      Level*. She gains no association-wide beneficiary lookup, and out of scope
      answers `404` rather than `403`.
- [x] **The R124 target picker is built** (R125). `GET /assessments/targets` is
      server-scoped per caller and staff-only; the builder composes the existing
      `SearchInput` and `SelectField` rather than a second generic picker. **The
      list is not the boundary** — every refusal is made again on the write.
- [x] **DECIDED AND FIXED (Owner, 2026-09-03) — `DELETE /exams/{id}` now refuses
      an assessment holding student educational evidence.** Any
      `StudentExamSubmission` in any state, or any `Grade` in any status, is
      sufficient: the refusal is a `STATE_CONFLICT` carrying
      `STUDENT_EVIDENCE_EXISTS` and the two counts, and the scheduling screen
      names what is there instead of «تعذّر الحذف». **Publication does not
      block** — a published paper nobody sat is still a plan (R118.1's rule for
      schedules) — and **attendance does not block**, because R123 makes it an
      occurrence fact rather than achievement. No `cancelled` state was added
      and grade visibility was not touched. The guard is the first statement in
      the transaction, so a refusal rolls back before the cancellation
      notification, the tombstones, the Trash snapshot and the audit row.
      `docs/SRS-PROPOSAL-R126.md` carries the clauses and is **APPLIED to
      `SRS.md`** (2026-09-03) — including the correction of R59 clause (3), whose
      *"cascades to exactly one child table"* rationale R123 and R124 made false.
- [x] **DECIDED AND REMOVED (Owner, 2026-09-03) — `Exam.access_policy` and the
      `single_submission` policy are withdrawn.** Save-and-resume is the only
      response policy in v1, which resolves §17's contradiction with R124 in
      R124's favour. The column, the `ExamAccessPolicy` enum, the unused
      `SINGLE_SUBMISSION_FINAL` code and its Arabic fallback are gone;
      `20260904100000_drop_exam_access_policy` is a TD-6b contract-phase drop
      that **refuses** while any exam reads `single_submission` and passes
      default rows without comment. Proved against the existing local database
      and against a fresh disposable one. `errors.test.ts` now pins
      `CAPACITY_FULL` and `SINGLE_SUBMISSION_FINAL` as retired **by name**.
      `docs/SRS-PROPOSAL-R127.md` lists the six current normative references to
      withdraw, and is **APPLIED to `SRS.md`** (2026-09-03).

- [x] **R136 — the unified exam lifecycle (§4.6, R124/R125/R133/R134 extended).**
      `POST /exams/schedule` is now the ONE atomic write that ever moves an
      `Exam` row past `draft` — physical or online — always onto an
      independently copied occurrence, never the reusable source itself.
      `PATCH /assessments/{id}/target` and `POST /assessments/{id}/publish`
      are withdrawn as routes. `Exam.available_from` (migration
      `20260908100000_r136_exam_available_from`) is a new Student-access fact,
      separate from calendar publication, enforced in `eligible()`; six
      availability choices collapse to it, manual opening is one-way, and no
      background job exists. Frontend rebuilt to match: بناء الاختبارات
      (مسودة badge, mode choice on create, retired retarget dialog), الجدولة
      (inline paper picker, shared five-arm target picker, availability
      choices, one حفظ for both modes), the canonical occurrence dialog
      (three-state availability action), and نقاط الامتحانات on both portals
      (`target_kind`-aware audience label, «إنشاء نسخة في بناء الاختبارات»).
- [x] **R136 also closes nine Codex-found defects from the R134-era flow**,
      each verified against its actual failure mode rather than assumed fixed
      by the architecture change: **B1** (scheduling atomicity) — three new
      tests fail the transaction LATE and assert nothing survived the
      rollback, plus a real `Promise.all` concurrency test against the same
      draft source. **B2** (submission/question-edit race) — `lockExamRow`
      row-locks both paths. **B3/B5** (teacher authority) — `staffsSession`
      and new `staffsTeachingGroup` give `session`/`teaching_group` the same
      direct, R91-dated predicate `student` already had, on both authoring
      and grading; the Level/administrative-group fallthrough is now also
      R91-dated instead of defaulting to today. **B4** (branch-scoped online
      grading) — the audience-within-branch-scope check authoring already
      runs is no longer skipped for lack of a `branch_id`. **H1** (grading
      reachability) — `GET /exams` reads `status`, not `mode`. **H2** (purge
      completeness) — the R133 purge plan owns `ExamQuestion`/
      `ExamQuestionOption`/`Notification`, gated by a new
      `EXAM_HAS_RECORDED_EVIDENCE` conditional-purge guard. **M2**
      (notification counts) — audited counts are the live, deduplicated,
      notified set. **M4** (date validation) — one shared, leap-year-correct
      `calendarDate` validator replaces independently-drifting duplicates.
- [x] **SRS Revision 136 RATIFIED** by the Document Owner, 2026-09-08, after a
      three-round negotiation (read-only reconciliation, a proposal round the
      Owner corrected on one point — scheduling must copy, never retarget or
      consume, the reusable source — then final ratification with a detailed
      29-section specification). Revision 134's clauses (11)/(12)/(14) are
      superseded by R136's clauses (1)-(4); its clauses (1)-(10)/(13) stand.
      Full verification: backend lint/typecheck/build clean, 331 unit tests,
      2,359 integration tests across 105 files (17 pre-existing unrelated
      skips); frontend lint/typecheck/build clean, 1,086 unit tests; OpenAPI
      regenerated and TD-3 conformance unchanged in shape; all
      `scripts/ci/check-*.sh` guards, doc-links and `git diff --check` pass.
- [x] **R136 frontend-completion pass**, closing an Owner browser walk's five
      findings against the already-ratified R136 architecture (no backend
      architecture change; one narrow new authorization primitive). **(1)**
      بناء الاختبارات's «اختبار جديد» is now CONTENT-ONLY — اسم الاختبار/
      الوصف/طريقة الأداء/النقطة على/المستوى/المادة/السنة الدراسية, no target
      and no date at creation — `createAssessment`'s `target` became optional
      and a new `assertMayAuthorLevel` (does she teach/administer ANYTHING in
      this Level, not may she address THIS audience) authorizes the
      content-only placeholder row; a real target is still resolved fresh,
      never from this placeholder, whenever the content is scheduled. **(2)**
      `?kind=exam&new=1` now reliably shows اختبار in الجدولة's own visible
      «نوع العنصر» selector, not merely in the fields underneath — the
      catalogue-backed `schedulingTypeId` is now seeded from the validated
      query kind once the catalogue loads, guarded so a later deliberate pick
      is never silently reverted. **(3)** Source-aware scheduler prefill
      (`?source=&mode=`) re-fetches the paper through the same authorized
      `readAuthorPaper` read بناء الاختبارات itself uses — never the URL
      alone — prefilling only mode/level/subject/year/classification and
      never an occurrence fact, failing safe (empty picker, no crash, no
      exposure) on any mode mismatch or authorization/staleness failure.
      **(4)** الجدولة's physical branch gains the deferred authored-source
      picker: optional (`required={false}`, an explicit «بلا ورقة مُعدَّة»
      choice, `onClear`), never required the way an online source is;
      choosing one hides Level/Subject/Year/max grade (they travel with the
      copy) while Branch/Room/date/time/staff/audience stay independently
      set; the existing content-free physical path is unchanged and still
      valid. **(5)** New/updated frontend unit and component tests cover all
      of the above plus builder/exam-grades navigation and a regression guard
      against the retired retarget-dialog path; a new backend regression
      test proves the narrower authorization boundary (a teacher scoped only
      to one administrative group may still create content-only, where the
      old strict target-based check would have wrongly refused her).
- [x] **Real-browser E2E acceptance of the frontend-completion pass**
      (`scripts/dev/browser/verify-exam-scheduling.mjs`/`.sh`, disposable
      `[asmguard]`-tagged fixtures, self-cleaning): Journey A (remote source
      created through the content-only dialog → مسودة confirmed → content
      added → «استخدام مرة أخرى» → lands on الجدولة already open with
      اختبار/عن بُعد/the source prefilled and every occurrence-only field
      still blank → completed and saved → the new occurrence's
      `source_exam_id` confirmed one hop from the authored draft). Journey B
      (نقاط الامتحانات's «＋ جدولة امتحان» → `?kind=exam&new=1` → اختبار
      actually shown, not «حصة دراسية»). Journey C (an authored physical
      draft: the paper picker is optional, selecting it hides Level/Subject/
      Year/the maximum, Branch stays, save succeeds, `source_exam_id` and the
      copied classification are both confirmed via the API, and no Student
      submission row exists for the sitting). Journey D (the pre-existing
      content-free physical path still saves with no `source_exam_id` — no
      regression). Responsive/RTL spot-check at 1440/768/390px across all
      three dialog contexts (بناء الاختبارات's create dialog, a fresh
      `?kind=exam&new=1` open, a `?source=&mode=` prefilled open): no
      horizontal page scroll introduced by opening the dialog, the dialog
      fits its viewport, no label collides with its own control. **90/90
      checks passed.** The walk itself found and fixed two real
      frontend-only defects the unit/component suite could not see (both in
      files this pass had already changed, confirmed against `git diff` at
      the walk's start, no backend change involved): `PaperPicker` hard-coded
      a `null` auth token, so typing into the paper search (remote or
      physical, beyond whatever a URL prefill had separately resolved) always
      got a `401` and returned nothing; and الجدولة's save validation
      unconditionally required a typed اسم الاختبار even when an authored
      source was chosen, though the adapter never sends `bare.title` in that
      case (the server copies the source's own title) — both are now fixed
      (`exam-section.tsx`'s `PaperPicker` takes a real `token` prop threaded
      from `scheduling.tsx`; `validationError()` skips the title check when
      `type === 'exam' && examSource.sourceId !== ''`).
- [ ] **Deliberately deferred, named rather than dropped:** arrangement-editing
      UI for an already-scheduled remote occurrence (no backend capability
      exists to revise one short of scheduling again from a fresh copy —
      الجدولة's list hides Edit for it instead of opening a form that cannot
      save).

## R137 (Document Owner decision, ratified 2026-09-09) — see SRS Revision 137

- [x] **(1) Academic Year full CRUD, co-located with its semesters at
      الفصول الدراسية** — `POST/PATCH/DELETE /admin/academic-years`, TD-5
      soft delete, TD-15 optimistic locking, Super Admin only. Deleting the
      current year refused (`ACADEMIC_YEAR_IS_CURRENT`). Semester form now
      offers every year, not only the current one. **Two real defects found
      by real-browser testing and fixed in the same unit:** the write
      schema's wire key (`isCurrent` → `is_current`, matching TD-3 and the
      already-correct OpenAPI prose) and `label`'s uniqueness (plain →
      partial index scoped to live rows, matching `scheduling_type.name`,
      so a soft-deleted year's label is reusable within TD-5's undo window).
      §14's stale `/superadmin/settings` AcademicYear-management line is
      corrected in place, superseded.
- [x] **(2) Link an existing reusable assessment to an existing Session**,
      past/present/future — `GET /calendar/sessions/{id}` gains
      `linked_exams` (calendar-tier gated, `examTierWhere`); the calendar
      dialog renders it through the shared `ExamAccessAction`; two entry
      points (بناء الاختبارات, a Session's own dialog) both navigate to the
      SAME الجدولة surface via `?target_kind=session&target_id=`, re-
      validated by `TargetPicker` itself rather than trusted from the URL.
      Session date and exam availability remain independent facts.
- [x] **(3) Optional per-question point allocation** (`ExamQuestion.points`),
      never auto-awarded, all-or-nothing checked only at scheduling
      (`QUESTION_POINTS_INCOMPLETE`/`QUESTION_POINTS_MISMATCH`). R136 copy
      independence proven in both directions (editing the source after
      scheduling never touches the copy; editing the copy afterward is
      independent of the source).
- [x] **(4) Complete question CRUD proven exhaustively** — create/read/تعديل/
      delete/reorder, R124 freeze unchanged, R136 copy independence proven
      for prompt/options/question-count in both directions (not just points).
- [x] **(5) MC option CRUD, create AND edit** — تعديل replaces the full
      option set; removed options soft-deleted, never dangling in a live
      read; the ≥2-option shape guard applies identically on edit. No
      correct-answer concept exists in this platform's model, so that named
      concern is structurally moot.
- [x] **(6) Secondary add actions read as real buttons** — إضافة خيار/إضافة
      دور fixed via the shared `variant="add"`, not a two-screen patch;
      `atomic-components.test.tsx` guards the convention platform-wide.
- [x] **(7) عطلة carries no staffing fields, structurally** — `hideStaffing`
      removes the controls from the tree (not CSS/disabled-hidden); switching
      to عطلة clears any staffing already typed; the save payload sends an
      explicitly empty staff array. Backend `HOLIDAY_SHAPE` refusal predates
      this and is unchanged.
- [x] **(8) One collapsed dropdown shape platform-wide** — `SearchableSelect`/
      `MultiSelectField` now collapse behind the same `field__control`
      trigger `SelectField` already used, opening on click/Enter/Space;
      `MultiSelectField`'s panel is real checkboxes (`ChoiceField`) with a
      "٣ محددة" closed-state summary. New shared `useDisclosure` hook
      (`NotificationBell`'s own Escape/outside-click pattern, factored out).
      No existing call site changed (props unchanged). Guarded platform-wide;
      verified in a real 375px RTL browser check (no overflow, correct
      truncation/chevron rendering).
- [x] **(9) Compact paired date/time controls platform-wide** — a one-time
      item's span end date now shares `RecurrenceEditor`'s start-date
      `.form__row` (the same slot *repeat until* occupies for a repeating
      pattern); `exam-section.tsx`'s custom date+time and
      `academic-periods.tsx`'s semester start/end date get the same
      treatment, closing the remaining unpaired instances found by a
      platform-wide audit.
- [x] **(10) Self-attendance for المرأة restated as additive** — no
      authorization change was needed (R123 already checked staff authority
      first); the configuration form's own hint previously described only
      the beneficiary's gain and now states both halves explicitly.
- [x] **(11) مرة واحدة offered, and DEFAULT, for حصة دراسية/محاضرة** —
      `allowsOnce` true for all four structural kinds; `anchor_date` reused
      as the one-time occurrence's own date (no new column);
      `course_schedule_recurrence_shape_check` extended to require it for
      `none`. SRS §7's Revision-43 CHECK note corrected in place, superseded
      for this one kind. Editing existing recurring schedules unaffected.
- [x] **(12) طلبات الحساب المستقل moved out of the standing menu**, R132
      preserved in full — `hiddenFromNav` keeps the route/authorization/deep
      links; `SelfManagedClaimsQueue` extracted so the direct route and a new
      نوع الطلب filter on طلبات الانضمام render the SAME component (no
      duplicated decision logic); the filter's label deliberately reuses the
      queue's own title rather than colliding with `identity-review`'s
      distinct, pre-existing label. Real-browser walk (extended
      `verify-self-managed-claim.mjs`): the same pending claim reachable and
      decidable both ways; sidebar link genuinely gone (DOM query, not text
      scan); filter reset restores the ordinary table. 20/20 checks passed.
- [x] **(13) تعديل بيانات المستخدم states phone/DOB requirements honestly** —
      `birth_date`/`is_beneficiary` on `GET/PATCH /profile`; a beneficiary's
      form now shows both as required, reusing registration's own validator;
      `updateOwnProfile` checks the RESULTING record, so a legacy incomplete
      beneficiary is asked to complete the gap on any edit, not only when she
      touches phone/DOB directly. Guardian-only/staff accounts untouched.
- [x] **(14) R136's exam architecture deliberately unchanged** — بناء
      الاختبارات=WHAT, الجدولة=WHEN/WHERE/WHO(+WHICH RESERVED SESSION since
      (2)), التقويم=discovery, نقاط الامتحانات=grading; scheduling still
      copies, never retargets; no `Paper`/`Sitting` table; no retired
      publish/retarget UX restored; grade save/publish stay distinct.
- [x] **SRS Revision 137 RATIFIED**, 2026-09-09. Full verification: backend
      lint/typecheck/build clean; frontend lint/typecheck/build clean, 100
      files/1,179 unit tests; full disposable-stack integration suite — 105
      files/2,404 tests (17 pre-existing unrelated skips) — including new
      coverage for (1)/(3)/(4)/(5); OpenAPI regenerated with no diff
      (169 paths/220 operations), TD-3 unchanged in shape (220/228, 8
      pending, 0 undocumented); all `scripts/ci/check-*.sh` guards,
      doc-links and `git diff --check` pass.
- [x] **Real-browser E2E acceptance, targeted rather than exhaustive.** New/
      extended walks for the two genuinely new write surfaces this revision
      built — clause (1) (`verify-academic-periods.mjs`, new checks 5-7) and
      clause (12) (`verify-self-managed-claim.mjs`, new checks) — where the
      risk of an untested wire-contract mismatch was highest, and clause
      (1)'s walk is exactly what found this revision's own two defects.
      Clauses (2)-(11)/(13) extend or compose EXISTING, already-E2E-proven
      infrastructure (R90/R123/R125/R136's own browser harnesses) with
      comparatively thin additions and are covered instead by the
      disposable-stack integration suite plus targeted frontend unit/guard
      tests. **A pre-existing, unrelated defect was found and deliberately
      NOT fixed here** (avoiding broadening this revision into another
      milestone): `verify-academic-periods.mjs`'s own checks (2)-(4) predate
      the platform-wide native `type="date"` retirement (2026-09-05) and
      fail against the current `DatePicker` regardless of anything in this
      revision; this revision's own new checks (5)-(7) are built independent
      of that stale DOM state (a fresh page navigation) specifically so the
      pre-existing failure cannot mask new evidence.

## R138 (Document Owner decision, ratified 2026-09-09) — see SRS Revision 138

- [x] **(1) `recurrence=none` teaching-candidates 400 fixed** —
      `teachingCandidatesQuerySchema` accepts `none` + a required `date`;
      `weekdayOf(date)` feeds the existing weekday+time-overlap conflict
      machinery, checked symmetrically against a colleague's own one-time
      class. The default ＋ إضافة عنصر dialog produces no failing request.
- [x] **(2)/(3) Session gains title/description at occurrence AND series
      scope, with an explicit, Session-level (never field-level)
      preserve-vs-overwrite choice for manually edited Sessions** —
      `Session.title`/`description` snapshot-plus-`overridden` on the same
      footing `delivery_mode`/`visibility` already have; NO per-field
      override-column family introduced, per the Owner's own explicit
      instruction — one `overridden` flag now covers seven mirrored fields.
      `overwrite_manually_edited` threads through `updateCourseSchedule`/
      `splitCourseSchedule`, scoped to Sessions protected for `OVERRIDDEN`
      alone (never one also `HAS_CONTENT`/`HAS_ATTENDANCE`/`LIFECYCLE`).
      Asked only when at least one eligible Session exists in range, through
      ONE shared `ManualEditsDialog`/`sessionsEligibleForOverwrite` reused by
      both the occurrence screen's wider scopes and the series editor's own
      save — no two competing "all Sessions" implementations.
- [x] **(4) Portal navigation collapses on mobile, opens as a bounded
      overlay never an expanding column, on ANY width** — one shared
      `PortalShell` for Admin/Teacher/Student; mobile default collapsed
      (pure CSS, no JS-guessed first frame); desktop default unchanged
      (expanded inline, nothing pressed). **Owner-found desktop defect,
      corrected in this same revision**: opening the sidebar now NEVER sets
      `grid-template-columns` — it is always `position: fixed`, right-side
      RTL, bounded width (mobile unchanged; desktop 16rem, never the whole
      viewport); collapsing is the only state that changes the grid, and it
      only ever reclaims width, never regrows toward the sidebar. Escape,
      backdrop tap and any nav-link click all close it at every width.
- [x] **(5) Homepage: no authenticated hero CTA, two sections removed,
      أين تجدنا/شركاؤنا redesigned** — `Hero` renders no `hero__actions` at
      all once signed in (not a smaller/different CTA); مسالك التعليم/كيف
      تنضمّين removed entirely, their only components (`Card`/`Step`) and
      component-specific CSS deleted with them (`.card__title` kept —
      `BranchCard` uses it on an unrelated footing); a lone branch no longer
      sits stranded in a two-column grid (`auto-fit` minmax); each partner
      renders as its own bordered surface. Both stay fully data-driven.
- [x] **(6)/(7) Versioned, Super-Admin-managed Privacy Policy and Terms of
      Use** — new `LegalDocument` model, the SAME pattern R119's
      `LegalConsentText` already proved (immutable once active, nothing ever
      deleted, DB-enforced one-active invariant), with `kind` as the one
      genuine difference: the partial unique index is scoped
      `(kind) WHERE status='active'`, so Privacy Policy and Terms of Use
      each keep their own independently active version. No FK from
      `ConsentRecord` — this is not the same evidentiary link as the
      registration consent wording. `GET /legal-documents/{kind}` anonymous;
      `/admin/legal-documents...` Super Admin only. `pages/legal.tsx` is
      dynamic now (fetches the active version, honest "not yet published"
      state, never a hardcoded fallback); nothing auto-seeded in production,
      same precedent as `LegalConsentText`/`PARTNERS`. Content reviewed
      against actual R133/R138 behaviour; genuinely unresolved facts
      (retention period, legal-entity/CNDP detail, governing law) stay
      marked ⚠, not fabricated — operational preparation, Owner/legal review
      still appropriate before activating in production. `/superadmin/settings`
      gains a `LegalDocumentsSection`, mounted per kind, structured
      identically to `ConsentTextsSection`.
- [x] **(8) Mobile month-grid chips wrap up to 3 lines instead of
      ellipsis-truncating** — «حصة تجويد القرآن» no longer reads as «حـ…»;
      wrap rule scoped inside the EXISTING `44rem` breakpoint, no new
      overlapping breakpoint. A thin kind-indicator bar (extending R58's
      exam-only pattern to session/event kinds) survives with
      delivery/tag/time hidden on mobile. 7-column real month grid
      unchanged in every particular — no agenda/list/day/card view.
- [x] **SRS Revision 138 RATIFIED**, 2026-09-09. Full verification: backend
      lint/typecheck/build clean, 38 files/334 unit tests; frontend
      lint/typecheck/build clean, 103 files/1,211 unit tests; full
      disposable-stack integration suite — 107 files/2,446 tests (17
      pre-existing unrelated skips) — including new coverage for (1), (2)/(3)
      and (6)/(7) (`legal-document.integration.test.ts` 14 tests,
      `legal-document.http.integration.test.ts` 5 tests over real HTTP);
      OpenAPI regenerated with no hand-edits (174 paths/225 operations, up
      from 169/220), TD-3 unchanged in shape (225/233, 8 pending, 0
      undocumented); all `scripts/ci/check-*.sh` guards, doc-links and
      `git diff --check` pass.
- [x] **Real-browser evidence, targeted at the two areas with genuine,
      previously-unproven layout/wire risk.** A new, backend-free CSS-
      geometry harness (`nav-toggle-harness.html` /
      `verify-nav-toggle-geometry.mjs`, 18/18 checks) proves the navigation
      correction specifically — at 390/1280/1440px, opening never moves or
      resizes `.admin__main`, the overlay is always `position: fixed` and
      bounded, Escape/backdrop/nav-link-click all close it — the same
      layout-shift-no-source-check-can-see reasoning
      `measure-page-header.mjs` already established. The legal-document HTTP
      suite is the real-HTTP proof for (6)/(7)'s new wire contract. (4)'s
      mobile behaviour, (5)'s CSS-only redesign and (8)'s chip wrapping are
      covered by the EXISTING, unmodified `verify-public-reader.mjs`/
      `calendar-geometry.mjs` real-browser suite (still 320-1280px clean)
      plus targeted frontend unit/source-pinning tests. **(1) and (2)/(3)
      are NOT walked in a real browser this revision** — backed instead by
      the integration suite above (9 tests for (1); 4 service tests plus
      HTTP-level coverage for (2)/(3)) plus frontend unit/typecheck/lint/
      build, the same real-DB-but-not-browser-driven tier Revision 137 used
      for its own thinner extensions — the same "targeted rather than
      exhaustive" reasoning Revision 137 recorded, re-applied explicitly
      rather than silently. **Deliberately not built**: a
      dedicated CDP click-through of the Super Admin legal-document editor's
      own UI — the equivalent property (wire contract, authorization,
      immutability, supersession) is proven at the HTTP layer instead, and
      the screen's own composition already inherits `ConsentTextsSection`'s
      established browser coverage. No Staging or Production action taken.

## R138 correction — mobile nav-toggle overlap and a stale semester notice (Owner-reported on Staging, 2026-09-10)

Both found by the Document Owner actually using R138 on the deployed Staging
site (`develop`@`ca1ef5c`), by screenshot. Fixes only — no SRS clause
changes, no product-policy decision; see [CHANGES](CHANGES.log) for full
detail.

- [x] **Item (4)'s own toggle button overlapped the drawer it opens** —
      `.admin-nav-toggle` carried a visible «القائمة» text label wide enough
      to collide with the mobile overlay drawer's first nav link at narrow
      widths. Made icon-only, matching `ApplicationHeader`'s own burger
      convention exactly (a11y label unchanged, `visually-hidden`); moved to
      `position: fixed` so it is never a grid child at all; the overlay
      drawer's own mobile width tightened from `85vw` to `75vw` as the one
      measured side effect. `verify-nav-toggle-geometry.mjs` gained
      dedicated toggle-vs-drawer and toggle-vs-page-action rect-intersection
      checks and now runs at 320px (the narrowest width §14 names, not
      merely a comfortable one): 26/26 checks pass, superseding the 18/18-
      at-390px figure recorded above.
- [x] **`تسجيل مستفيدة`'s «يرجى اختيار الفصل الدراسي قبل الحفظ» notice
      outlived the semester being chosen** — pre-existing R122 behaviour,
      surfaced by R138's own Staging walkthrough. The server-derived default
      period (`listAcademicPeriods`) resolves asynchronously; a reader who
      pressed حفظ in the moment before it resolved saw the refusal, watched
      the field fill itself in correctly a beat later, and the refusal
      stayed on screen describing a state that was no longer true — `notice`
      was previously cleared only at the start of a subsequent successful
      submit. A new effect clears it the instant Level, branch and period
      are all answered, mirroring the same three checks `submit()` itself
      gates on. Source-pinned in `enrolment-period.test.ts`.
- [x] Verification: frontend typecheck/lint/build clean; 103 files/1,214
      unit tests (up from 1,211); `check-design-tokens.sh`,
      `check-header-nav-exclusive.sh`, `check-shared-layout.sh` and
      `git diff --check` all clean; `verify-nav-toggle-geometry.mjs` 26/26 at
      320/1280/1440px. Backend untouched by either fix, so not re-run.

## R138 correction #2 — the nav-toggle redesigned in-layout (Owner-reported on Staging, same day, 2026-09-10)

The FIX directly above cleared the drawer overlap geometrically by making the
toggle `position: fixed` and icon-only — and the Owner's very next report on
the same deployed Staging build named what that broke: a control floating
disconnected from the layout it operates, and — icon-only beside
`ApplicationHeader`'s own icon-only burger — indistinguishable from it at a
glance (two apparent hamburgers on one screen). This correction replaces
that fix's approach rather than tuning it further; see [CHANGES](CHANGES.log)
for full detail.

- [x] **The toggle is an ordinary flex child of `.admin__head`'s own
      `.admin__actions` now** — the SAME row a page's own action button
      already uses, never a floating element with its own coordinates. Two
      flex siblings cannot overlap by construction, which is the
      "structurally reserved space" the correction asked for.
- [x] **It carries a `sidebar` panel icon (new `IconName`) and its OWN
      VISIBLE Arabic label** — never `menu`/`close`, `ApplicationHeader`'s
      own icons — reading the SAME noun each portal's `<nav aria-label>`
      already carries (`admin.nav.label` أقسام الإدارة, `teacher.nav.label`
      أقسام التدريس, `student.nav.label` أقسامي), threaded into `PortalShell`
      as a new `navLabel` prop so Admin/Teacher/Student stay consistent
      without a fourth invented word. Desktop states the exact phrasing
      specified (`إظهار`/`إخفاء {label}`); mobile — which starts collapsed
      regardless — states the neutral noun alone.
- [x] **The opened drawer is now a PANEL (`.admin-nav-panel`) with its own
      header and close button**, not a bare `<nav>` — a title (`navLabel`
      again) plus a close control that does not depend on the (now in-flow,
      possibly covered) trigger being reachable again. The close button
      itself is a new shared `IconButton` component (constitution §2.4/§2.6:
      "promote it the moment a second consumer appears... by moving it,
      never copying it") — `Dialog`'s own close button was the first
      consumer of this exact concept and now renders through the same
      component, `.dialog__close` kept only as the class name callers still
      recognise.
- [x] Escape, the backdrop, any nav-link click and the new internal close
      button all close the overlay, at both widths — the approved behaviour
      is unchanged, only reached one more way.
- [x] `verify-nav-toggle-geometry.mjs` rewritten: no more assumptions about
      a fixed bottom-corner element: checks the in-layout toggle's own
      non-overlap with the page's action button and heading, the new panel's
      header/close-button geometry, and — replacing a brittle "never
      intersects" assertion that could not hold once the toggle became
      ordinary in-flow content — a paint-order check (`elementFromPoint` at
      the genuine overlap point) proving the OPEN drawer always visually
      wins over content behind it, which is the actual property the
      original defect violated. **46/46 checks pass, at 320/390/1280/1440px**
      (widened from 320/1280/1440, matching the correction's own width list).
- [x] Verification: frontend typecheck/lint/build clean; 103 files/1,218
      unit tests (up from 1,214); `check-design-tokens.sh`,
      `check-header-nav-exclusive.sh`, `check-shared-layout.sh`, doc-links
      and `git diff --check` all clean. The semester-notice fix (337e425) is
      untouched. No Staging or Production action taken; no SRS change —
      this replaces one already-shipped correction's approach, it does not
      alter ratified product policy.

## R138 correction #3 — an empty-drawer regression, `أقسامي` opened on nothing (Owner-reported on Staging, same day, 2026-09-10)

**Root cause**: correction #2 above still had every portal layout build its
own `<nav>` UNCONDITIONALLY, so `PortalShell` could only ever check whether
a `<nav>` element existed — never whether the session's own,
permission-filtered module list for that portal actually had anything in
it. A Student session whose active role `STUDENT_MODULES` admits none of
(and who is not a guardian actively acting for a linked child) got an empty
`<ul>` inside a perfectly normal-looking `<nav>`, and `أقسامي` opened a
drawer with nothing in it. See [CHANGES](CHANGES.log) for full detail.

- [x] **Each layout now computes its own final module list BEFORE deciding
      what to pass `PortalShell`** — `AdminLayout`/`TeacherLayout`/
      `StudentLayout` all hoist `visible*Modules(...)` out of their
      `*Sidebar` sub-component and pass `sidebar={null}` when it is empty,
      never a `<nav>` wrapping zero links.
- [x] **`PortalShell.sidebar` is `ReactNode | null` now**, and `null` is a
      first-class signal (`hasNav = sidebar !== null`) that suppresses the
      toggle, the drawer, its header and close button, the backdrop, AND the
      grid column `.admin`'s two-column layout would otherwise reserve for
      it (`admin--no-nav`, `>=60rem` only — below that the layout is already
      single-column). The page's own action row (`.admin__actions`) now
      renders only when it would hold something — the toggle, a page action,
      or both — never as an empty container.
- [x] **Admin keeps its control** — §14.1's five sections are never empty
      for an admin role, so nothing changes there. Teacher and Student now
      correctly show no control at all when their own final list is empty,
      the same rule Admin already satisfied by construction.
- [x] Nine new `portal-shell.test.tsx` cases: Admin/Teacher/Student each with
      a real, non-empty list (control renders); Teacher with a role
      `TEACHER_MODULES` admits none of (permission filtering → empty, no
      control — the general case); Student with the EXACT Owner-reported
      shape (a role `STUDENT_MODULES` admits none of); and four
      `PortalShell`-level contract tests isolated from any registry
      (`sidebar={null}` → nothing renders; no actions row when nothing would
      be in it; a lone page action still renders without a toggle; a real
      sidebar still renders the toggle).
- [x] A second static harness (`nav-toggle-harness-empty.html`) added
      alongside the existing one, replicating a portal with no contextual
      nav plus a stand-in `ApplicationHeader` burger. `verify-nav-toggle-geometry.mjs`
      checks it at all four widths (no toggle/nav/panel/backdrop, the grid
      column reclaimed) and confirms the header burger stays visible and
      untouched on mobile specifically (its own visibility at desktop widths
      is `check-header-nav-exclusive.sh`'s property, not duplicated here).
      **68/68 checks pass.**
- [x] Verification: frontend typecheck/lint/build clean; 103 files/1,227
      unit tests (up from 1,218); `check-design-tokens.sh`,
      `check-header-nav-exclusive.sh`, `check-shared-layout.sh`, doc-links
      and `git diff --check` all clean. Correction #2's own approved
      behaviour (non-floating control, bounded overlay, desktop inline
      default, RTL positioning, Escape/backdrop/link/internal-close) and the
      semester-notice fix (337e425) are both untouched — this only narrows
      WHEN the control appears. No Staging or Production action taken; no
      SRS change.

## R138 correction #4 — a POPULATED mobile drawer with an invisible list (Owner-reported against localhost, same day, 2026-09-10)

**Root cause, exact**: `@media (width < 60rem) { .admin-nav { display: none; }
}` (`admin.css`) exists for exactly ONE shape — the plain, unwrapped resting
default, collapsed until the toggle is pressed. It carries no selector
scoping it away from the SAME `.admin-nav` class nested inside
`.admin-nav-panel` once the drawer is genuinely open (correction #2's own
addition), and `.admin-nav-panel .admin-nav`'s own reset rule never set
`display`, so nothing outranked it. The panel wrapper rendered correctly —
bounded, `position: fixed`, its header and close button visible — while its
one child computed `display: none`, a `0×0` box: a populated drawer with a
correctly-sized frame and nothing paintable inside it. Confirmed live
against `localhost` with the Owner's own real multi-role account and a
plain single-role student fixture before any fix was written.

**Why the 68/68 pass on the previous correction proved nothing about this**:
every prior geometry check measured `.admin-nav-panel` or `.admin-nav` as a
WHOLE — its own rect, `display`, `position` — never a level further in. The
static harness's own stub list was two items long and never gave a
`display: none` list anything visible to lose. And `element.click()`, used
throughout the harness to simulate closing the drawer, fires a handler
whether or not the element is actually rendered — a property no real tap
has, so every "clicking a link closes it" check stayed green regardless of
whether the link could ever have been seen or reached first.

- [x] **Fix**: `.admin-nav-panel .admin-nav { display: grid; ... }` — the
      SAME value `.admin-nav`'s own base rule already declares, restated at
      `.admin-nav-panel .admin-nav`'s higher specificity so it outranks the
      collapse rule at every width, regardless of media-query source order.
- [x] `nav-toggle-harness.html`'s stub list is now SEVEN real Student labels
      (`ar.ts`'s `student.nav.*`, the exact portal from the Owner's
      screenshot), one marked `aria-current="page"`.
      `verify-nav-toggle-geometry.mjs` gained `checkPopulatedNav()` — reads
      the LINKS themselves: exact count and labels, computed
      `display`/`visibility` and a non-zero rect, containment within the
      drawer and below its header, the active one's distinct highlight, and
      genuine keyboard focusability (impossible under a `display: none`
      ancestor). Run at the resting desktop default, the mobile overlay and
      the desktop overlay alike, plus a dedicated short-viewport pass
      proving the list scrolls independently once it outgrows the panel.
      **110/110 checks pass**, up from 68/68 (42 new).
- [x] The existing empty-list scenario (`nav-toggle-harness-empty.html`,
      correction #3) is untouched and still 0 toggle/drawer/backdrop at
      every width — a populated list rendering correctly does not relax the
      "nothing renders when there is nothing to navigate to" rule.
- [x] **Real-browser confirmation against the running local stack**, not
      only the static harness: minted real dev sessions (`issue-dev-session.sh`)
      for three genuine accounts already in the local database — a
      single-role Student, a single-role Teacher, and the Owner's own
      multi-role account acting as Admin — and drove headless Chrome against
      `localhost` at 390px. Before the fix: the Student session reproduced
      the exact defect (`.admin-nav` computed `display: none`, `0×0`, while
      the panel itself measured correctly). After: all seven Student links,
      six permitted Teacher links (capability-gated `إدخال حفظ المستفيدات`
      correctly absent — no capability, no entry, unrelated to this fix),
      and all twenty-four Admin links render with real non-zero rects;
      clicking a link in each case produces a genuine route change
      (`/teacher/availability`, `/admin/users`) and the drawer is gone
      afterward.
- [x] Verification: frontend typecheck/lint/build clean; 103 files/1,227
      unit tests (unchanged — a pure CSS defect, invisible to markup-only
      SSR tests, so no new vitest assertions apply); `check-design-tokens.sh`,
      `check-header-nav-exclusive.sh`, `check-shared-layout.sh`, doc-links
      and `git diff --check` all clean. The ApplicationHeader hamburger, the
      non-floating toggle, bounded overlay geometry, RTL positioning, the
      empty-list behaviour (correction #3) and the semester-notice fix
      (337e425) are all unchanged. No Staging or Production action taken; no
      SRS change — a defect in already-ratified navigation behaviour, not a
      policy change.
- [x] **Separately discovered, out of scope, NOT touched**: the local dev
      database has drifted behind migrations (`column "title" of relation
      "session" does not exist`), breaking `seed-r82-scenario.ts` and the
      `verify-portals.sh`/`verify-admin-navigation.sh` harnesses that depend
      on it. Unrelated to this navigation work and to R138; a normal
      additive `prisma migrate deploy` against the local database would
      resolve it, left to the Document Owner to authorize separately per
      this session's explicit instruction not to migrate.

## Owner revision — flexible event scope, Teacher scheduling/Hifz/grades, scoped personal calendars, library deep-link, dialog-based attendance (in progress, 2026-09-10)

Six sections, sequenced smallest-safest first per the Owner's own instruction.
The pre-implementation audit (SRS, schema, authorization, event dialogs,
TD-3, OpenAPI) found **three of the six already built or substantially
built** — reused rather than reimplemented, per rule 5:

* **§5 (`إدخال الحفظ`/`نقاط الامتحانات` for Teachers)** — already fully
  wired: `assertCanManageQuranProgress` and `grade.service.ts` both already
  carry a teacher arm scoped through `studentsTaughtBy`; TD-2 already grants
  both; `/teacher/quran` and `/teacher/exams` are already in her menu (R106),
  gated on `teachesQuran`. Needs verification/tests, not new code.
* **§6 (attendance inside event dialogs)** — already built and already
  sitting at the bottom of `EventDetailsDialog` via `<AttendancePanel>`
  (R123): self-confirm for المرأة, staff sheet, correct
  `attendance_mode`/`attendance_marking` gating, full TD-3/OpenAPI coverage.
  On the Owner's own stop-condition: §4.7 carries no timing/finalization
  rule beyond "whoever staffs that occurrence on its date" — nothing to
  invent; the existing rule already governs it.
* **§4 (Library deep-link)** — `resources.tsx` already reads `?content=<id>`
  and opens `ContentPreviewDialog` on arrival (2026-08-17), the identical
  mechanism `EventDetailsDialog`'s own materials links already use. Only
  `library.tsx`'s own link was missing the parameter — see below, now fixed.

§1 (Event scope) and §3 (personal/scoped calendars) are real, scoped
extension work — `Event` already has full multi-branch/multi-Level scope
(`EventBranch`/`EventLevel`/`EventCategory`, a Level-less `holiday` kind);
`RecurringCourseSchedule` stays single-target by design. §2 (Teacher
scheduling creation) is a genuine policy reversal of TD-2's existing `⊘` —
Owner-confirmed anchor: a Teacher may create a schedule only for a
Level/branch she already holds through `TeacherCategoryCapability`/
`TeacherSubjectCapability` and a `UserBranchRole`, never through the
schedule she is about to create.

### §4 — Library `عرض المحتوى` deep-links to the exact item

- [x] `frontend/src/pages/dashboard/library.tsx`'s open-item link now
      carries `&content=${item.id}` alongside the existing `?level=`,
      reusing `resources.tsx`'s already-built `?content=` focus mechanism
      verbatim — no new backend route, no new dialog, no new viewer. A
      missing or unauthorized id already opens nothing (the item is looked
      up only inside the server-scoped shelf `resources.tsx` already
      fetched), which is the existing honest non-disclosure behaviour, not a
      new one. Autoplay is unaffected — `ContentPreviewDialog`'s
      `<video>`/`<audio>` already carry `controls` and no `autoPlay`. Back
      navigation is the browser's own history on a real `<a href>`, not a
      client-side route.
- [x] New source-pinning test, `library.test.tsx` (3 cases): the exact href
      template, `?level=` retained alongside `?content=`, and the id read
      from the row rather than a hoisted/shared value.
- [x] `verify-student-flows.mjs` gained three real-browser checks (8a/8b/8c):
      the link exists and is clicked through the real screen; the resulting
      page is `/resources` with `?content=` in the URL AND the preview
      dialog genuinely open, titled with the real item; a hard `Page.reload`
      reopens the identical item, proving the durable-URL requirement rather
      than only asserting the string. **Not executable locally right now** —
      blocked by the same pre-existing, unrelated local-DB migration drift
      noted above (`seed-r82-scenario.ts`); written to the established
      pattern and will run once that is resolved.
- [x] Verification: frontend typecheck/lint/build clean; 104 files/1,230
      unit tests (up from 1,227); `check-design-tokens.sh`,
      `check-header-nav-exclusive.sh`, `check-shared-layout.sh`, doc-links
      and `git diff --check` all clean. No SRS change — `resources.tsx`'s
      own doc comment already describes this exact intended behaviour; this
      corrects `library.tsx` to actually reach it, it does not establish a
      new rule.

### §5/§6 — Teacher Hifz/exam grades, and dialog-based attendance: verified already built, no code change

Both confirmed by the pre-implementation audit as already fully built;
this pass is confirmatory only, per rule 5 (reuse, never a second
implementation of something that already exists).

- [x] **§5** — `assertCanManageQuranProgress` (`roster-resolution.ts`) and
      `grade.service.ts`'s teacher arm already scope both to
      `studentsTaughtBy`, already tested for both allowed and forbidden
      cross-scope access (`grade.http.integration.test.ts`: "a Teacher may
      create a sitting inside the scope they staff" / "refuses a level the
      Teacher does not teach" / "refuses a branch the Teacher does not
      staff" / "a Teacher outside their scope cannot read/enter/publish";
      `roster-resolution.integration.test.ts`: "a teacher reaches exactly
      the students of the schedules they staff" / "a teacher with no
      schedules reaches nobody"). Actor provenance already recorded:
      `QuranProgressLog.loggedById`/`loggedAt` per entry;
      `grade.service.ts`'s `audit.write('grade.enter'|'grade.publish'|
      'grade.republish', actorUserId: ...)` per sheet save. `/teacher/quran`
      and `/teacher/exams` are already in her menu (R106), the former gated
      on `teachesQuran`. Confirmed live against the real running local stack
      with a real single-role Teacher account (`0a6c7dcb-…`): both screens
      render correctly with the platform's own honest empty state
      («لا توجد عناصر بعد.») rather than a blank page or a crash.
- [x] **§6** — `AttendancePanel` already sits at the bottom of
      `EventDetailsDialog` (R123), already gated on
      `attendance_mode`/`attendance_marking` so a vacation/party shows
      nothing (`attendance.integration.test.ts` §1–2), already implements
      exactly the two roles named in this request: `تسجيل حضوري`-equivalent
      self-confirm for a Woman student only where her Category permits it,
      enforced server-side and hidden entirely otherwise
      (`attendance-ui.test.ts`: "hides it entirely unless the SERVER says
      her Category permits it"), and a staff roster sheet with bulk
      completion, a picker for one sheet rather than a directory
      (`attendance.integration.test.ts` §20), and corrections recorded as
      staff work with one honest history (§24). Role/branch boundaries
      (§17), the occurrence-date-scoped roster (§15–16) and the audit
      record (§18) are already tested. On the request's own stop-condition:
      §4.7 carries no timing/finalization rule beyond "whoever staffs that
      occurrence on its date" — confirmed by direct SRS reading, nothing to
      invent, no Owner question outstanding.
- [x] Verification: backend lint/typecheck clean, 38 files/334 unit tests;
      full disposable-stack integration suite — **107 files/2,446 tests
      (17 pre-existing unrelated skips), all-table isolation intact** —
      including `attendance.integration.test.ts`,
      `grade.http.integration.test.ts`,
      `roster-resolution.integration.test.ts`,
      `quran-entry.integration.test.ts`, `quran.integration.test.ts`, all
      green; frontend suite (1,230 tests) already green from §4's run,
      including `attendance-ui.test.ts`'s 12 cases. No code changed, so no
      migration, no OpenAPI/TD-3 change, no new commit beyond this
      documentation entry.

### §1 — Flexible event scope: the five-tier taxonomy already existed; the read side and the creation picker are corrected to reach it

The pre-implementation audit (schema, `event.service.ts`, `calendar.service.ts`,
the frontend scope picker, existing tests) found the taxonomy itself —
platform-wide / all-branches-the-actor-may-reach / selected branches /
all-Levels-in-selected-branches / selected Levels, plus no-Level-at-all for a
genuinely general event — already fully server-enforced through the existing
`EventScopes` shape and `EventBranch`/`EventCategory`/`EventLevel`/
`EventAdministrativeGroup` join tables (§7, R24). Two genuine, narrowly-scoped
gaps were found and fixed; nothing about authorization, the data model or
`RecurringCourseSchedule`'s single-target invariant (§4.4c, including محاضرة
per the 2026-08-28 class-shape ruling) changed.

- [x] **`calendar.service.ts`** — removed a `take: 1` truncation on the
      `branchScopes`/`categoryScopes`/`levelScopes` Prisma includes that
      silently showed a reader only the FIRST attached branch/category/Level
      of a genuinely multi-scoped event; the join rows and every
      authorization/audience-matching read over them were always complete.
      `Occurrence` gains `branch_ids`/`branch_names`, `category_ids`/
      `category_names`, `level_ids`/`level_names`, additive beside the
      unchanged singular fields (Revision 36); always single-element for a
      Session or an Exam.
- [x] **`calendar.controller.ts`**'s `occurrenceDto()` — carries the six new
      plural fields onto the wire (`branch_ids`, `branch_names`,
      `category_ids`, `category_names`, `level_ids`, `level_names`).
- [x] **`class-section.tsx`**'s `ActivitySection` — the scope-target picker
      is now `MultiSelectField`-based (`scopeIds: string[]`), on the SAME
      `EventScopes` arrays the backend already accepted; explicit Arabic
      hints distinguish "no Level chosen → every Level in the selected
      branch(es)" from the platform/all-branches global case.
- [x] **`scheduling.tsx`** — submits the full chosen set
      (`{ branchIds: scopeIds }` etc.) instead of a single-element array.
      Two incidental defects found and fixed in the same touched code: the
      scope-required check lacked the `!editing` guard its siblings already
      have (a Teacher editing her own event, whose picker is locked/hidden
      on edit, could be wrongly blocked from saving an unrelated change);
      switching `scopeKind` did not clear the previous dimension's
      `scopeIds` (a branch id could be submitted as a `levelId` after an
      un-deselected dimension switch).
- [x] **`event-details-dialog.tsx`** — renders every attached
      branch/category/Level when there is more than one, joined with `، `,
      falling back to the existing singular display otherwise.
- [x] New tests: `calendar.integration.test.ts` (+4 — the whole scope is
      read back, not only the first branch/Level/category; a Level-less
      event reports empty arrays not null; a Session always reports exactly
      one), `calendar.http.integration.test.ts` (+1 — the plural fields are
      real arrays over real HTTP, each containing the singular field's own
      value), `class-section.scope.test.tsx` (new file, 13 cases — picker
      count/empty-state/labels, the all-Levels hint shown/hidden correctly,
      the global hint, locked/editing state, and source-pinned assertions
      against `scheduling.tsx`'s own payload/kind-switch/`!editing`-guard
      code), `calendar.test.tsx` (+5 — a multi-scoped event shows every
      attached branch/category/Level).
- [x] Verification: backend lint/typecheck/build clean, 38 files/334 unit
      tests; frontend lint/typecheck/build clean, 105 files/1,248 unit
      tests (up from 1,230); full disposable-stack integration suite green,
      all-table isolation intact; `docs/openapi.json` regenerated with no
      hand-edits (174 paths/225 operations, unchanged route count — wire
      fields added, not routes), TD-3 conformance unchanged (225/233
      implemented, 0 undocumented); all `check-*.sh` guards, doc-links and
      `git diff --check` clean. **No migration** — the join tables already
      stored multiple rows per event; only the read projection and the
      creation form changed. SRS Revision 139 ratified. No Staging or
      Production action taken. Remaining sections (§3, §2) continue in
      subsequent commits.

### §3 — personal calendars corrected against R139's flexible Event scope

`GET /me/calendar` (R82.8, `personalFilters()` in `calendar.service.ts`) was
already the platform's answer to *"what concerns me"* — a filter composed
into the same `readCalendar` projection `GET /calendar` uses, never a second
pipeline. Auditing it against R139 found one genuine defect and confirmed
the rest already correct.

- [x] **The defect** — `personalFilters`'s Event predicate checked each
      scope dimension (branch/category/level/group) as an INDEPENDENT `OR`
      arm, so a student enrolled in the right Level at the WRONG branch
      matched an Event scoped to *"this branch AND that Level"* through the
      Level arm alone. `eventAudienceWhere` (`roster-resolution.ts`, R82.7)
      already resolves the identical Event's NOTIFICATION audience as an
      intersection; `personalFilters` now reads the same way — `OR` across
      her enrolments, `AND` across the dimensions ONE enrolment must satisfy.
      The global-event arm and her own `EventStaff` assignment arm are
      unchanged.
- [x] Confirmed, not merely assumed: R139's multi-value scope already
      reached the personal calendar correctly (`some`/`in`, never `take: 1`
      — that was §1's separate display-projection bug, already fixed).
      Session-side scoping (R92 combined-branch audience, R91 dated
      staffing) needed no correction — already exercised by
      `session-audience.http.integration.test.ts` and
      `effective-staffing.http.integration.test.ts`.
- [x] Confirmed unchanged, asserted rather than left alone: `GET /calendar`
      and R135's filter-prefill semantics; `GET /me/calendar`'s deliberate
      narrower-than-public scope (R82.8's own text); `GET
      /calendar/sessions/{id}`'s direct-ID `404`-not-existence-leak
      behaviour (`session-page.http.integration.test.ts`); §4's Library
      deep-link.
- [x] New tests: `personal-calendar.integration.test.ts` (new file, 9 cases
      — the intersection correction with its control cases, R139's
      multi-branch/multi-Level scope reaching the personal calendar, the
      global-Event arm, a مؤطِّرة's own staffed-regardless-of-scope arm, and
      her own class session appearing on her calendar).
- [x] Verification: backend lint/typecheck clean, 334/334 unit tests; full
      disposable-stack integration suite green, all-table isolation intact,
      including the new file (9/9). No migration, no OpenAPI/TD-3 change.
      SRS Revision 140 ratified (§3 clause).

### §2 — a مؤطِّرة may create a class within her own declared scope

TD-2's *"Create/edit Recurring Course Schedules"* row read Teacher `⊘` since
Revision 43 — R71.0/R72.1 recorded why: §4.4c derives her scope *from the
schedules she staffs*, so creating one with no other anchor would widen her
own reach circularly. The Owner's own anchor decision (declared
`TeacherCategoryCapability`/`TeacherSubjectCapability`, R114, **OR**, plus a
`teacher` `UserBranchRole` — never the schedule about to exist) breaks the
circularity; this supersedes R114(2)'s *"grants no scheduling authority"*
for this one grant only.

- [x] **`course-schedule.service.ts`** — `createCourseSchedule` accepts a
      مؤطِّرة when: her branch is one she holds a live `teacher`
      `UserBranchRole` in (`assertCanActOnBranch`, the SAME mechanism an
      Admin's own scope uses); the target Level's Category or Subject is
      declared (`assertTeacherDeclaredCapability`, checked once the target
      resolves); `teaching_mode` is `entire_level` only
      (`assertTeacherEntireLevelOnly` — Administrative/Teaching Group
      targeting stays with the administration); she is named the schedule's
      own `teacher` (`assertTeacherSelfStaffed`, `TEACHER_MUST_SELF_STAFF`
      otherwise — R93(3)'s `RESPONSIBLE_MUST_BE_SELF` precedent, reused).
      `updateCourseSchedule` accepts her for a schedule she currently,
      effectively staffs (`assertTeacherCurrentlyStaffs`, any position —
      R87 §G), refuses `NOT_FOUND` otherwise (§20 rule 17), refuses a
      `staff` patch that removes her own `teacher` position
      (`assertTeacherRemainsStaffed`), and keeps `this_and_future` splitting
      and deletion manager-only, unchanged.
- [x] **`GET /me/course-schedule-options`** (new route,
      `scope-options.service.ts`/`.controller.ts`) — a second, single-
      purpose read beside `/me/scope-options`, never a flag on it (an Admin
      reads that SAME endpoint for the SAME `ClassSection` chain, unbounded
      by declared capability). Branches from her `teacher` `UserBranchRole`;
      a Level whose Category she declared offers every Subject it teaches;
      a Level reached only through a declared Subject offers just that one;
      an undeclared Level is absent.
- [x] **Frontend** — `/teacher/schedules`'s `TEACHER_TYPES` gains `class`,
      reusing the canonical `SchedulingDialog`/`ClassSection` (no duplicate
      scheduler). `ClassSection` gains `staffLocked` (a static "you are this
      class's مؤطِّرة" statement replacing the multi-row staffing editor she
      is server-refused from using any other way, on `ActivitySection`'s own
      `responsibleLocked` precedent) and `modes` is restricted to
      `['entire_level']` for her. `useScopeOptions` gains
      `restrictToOwnCapability`, read only at `ClassSection`'s own call
      site, selected by the same `canAssignStaff` flag already
      distinguishing Admin from Teacher throughout the shared dialog — every
      other caller and item type is unaffected.
- [x] New tests: `course-schedule-teacher.integration.test.ts` (new file, 14
      cases — the full positive/negative matrix: Category-alone and
      Subject-alone grants, wrong branch, undeclared Level/Category via
      direct target substitution, non-`entire_level` targeting,
      missing/wrong self-staffing, a bare Teacher role with neither anchor,
      edit bounded by current staffing with the NOT_FOUND-not-FORBIDDEN
      shape, the remain-staffed guard, `this_and_future` refusal,
      Admin/Super Admin unchanged, and the cross-section chain — her
      created class's materialized Session reaching both the enrolled
      student's and her own personal calendar); 7 new cases in
      `scope-options.http.integration.test.ts` for
      `/me/course-schedule-options`; `class-section.staff-locked.test.tsx`
      (new file, 9 cases — the locked-staffing render, and source-pinned
      assertions against `scheduling.tsx`/`teacher/schedules.tsx`'s own
      wiring).
- [x] Real-browser: `verify-teacher-scheduling.mjs` extended — check 10/11
      updated (حصة now correctly offered, no longer asserted absent), new
      check 13 (the entire_level-only mode and the staffLocked statement
      render correctly for a real Teacher account; her Level picker is
      genuinely empty — server-filtered, not client-guessed — since this
      scenario declares her no capability). **Not executable in this
      session** — blocked by the same pre-existing, unrelated local-DB
      migration drift already recorded elsewhere in this ledger
      (`session.title` column absent from the persistent local dev
      database, predating this work — `20260909120000_r138_session_title`
      was never applied there); written to the established pattern and
      will run once that drift is resolved. The disposable-stack
      integration suite is the real-HTTP-equivalent evidence for the exact
      same scenarios in the meantime.
- [x] Verification: backend lint/typecheck/build clean, 334/334 unit tests;
      frontend lint/typecheck/build clean, unit suite green (see combined
      count below); full disposable-stack integration suite green,
      all-table isolation intact, including both new files (14/14, 9/9) and
      the 7 new `/me/course-schedule-options` cases (22/22 total in that
      file). `docs/openapi.json` regenerated with no hand-edits (175
      paths/226 operations, one new route); TD-3 conformance updated
      (`scripts/ci/td3-routes.txt`), 226/234 implemented, 0 undocumented.
      All `check-*.sh` guards, doc-links and `git diff --check` clean. **No
      migration** — every table this section reads or writes already
      existed. SRS Revision 140 ratified (§2 clause). No Staging or
      Production action taken.

Both §3 and §2 complete the six-section Owner-requested revision (§4/§5/§6
already verified; §1 shipped as Revision 139). All six sections are now
implemented, verified and documented.

## Follow-up repair — portal-shell control placement, and the legal pages' BA-000 (2026-09-10)

Two Owner-reported acceptance defects found in manual testing after the six
sections above shipped. Neither reopens §1–§6; both are fixed at the layer
the Owner's own report named.

### Defect A — the sections toggle read as page content, not a shell control

- [x] **Root cause**: `PortalShell` (R138 correction #2) placed the
      show/hide-sections toggle inside `.admin__head`'s own `.admin__actions`
      row — page-specific content, in `.admin__main` (the grid's SECOND
      column). In RTL that column sits to the LEFT of the sidebar's own first
      column, stranding the control on the opposite side from the navigation
      it operates; below the two-column breakpoint the same row falls
      directly under the page title, reading as a page action.
- [x] **Fix (R138 correction #5)** — `portal-shell.tsx`: the toggle moved
      into a new `admin-nav-region` wrapper occupying the SAME grid slot
      `.admin-nav` used to occupy alone (structurally, still exactly two
      grid participants — no new tracks or areas). Below `60rem` DOM order
      alone puts it ahead of `.admin__main`; at `≥60rem` it stacks above the
      sidebar, in the sidebar's own column. `admin.css`: new
      `.admin-nav-region` rule; `.admin--nav-collapsed`/`.admin--nav-overlay`
      narrow the column to `auto` (the toggle's own width) rather than to
      zero, since the control must stay reachable to re-expand.
- [x] Tests: `portal-shell.test.tsx` — replaced the stale "renders inside
      `.admin__actions`" assertion with two: outside the page-actions row,
      and inside its own shell region (19 tests total, up from 18).
      `nav-toggle-harness.html`/`verify-nav-toggle-geometry.mjs` restructured
      to match, with new checks: the toggle sits outside `.admin__main` on
      desktop (the headline regression — 1008 ≥ 976 at 1280px, never
      stranded), above the page title on mobile, remains visible and
      reachable after collapsing, and no document-level horizontal overflow
      at every tested width (320/390/1280/1440) — **124/124 real-Chrome
      checks pass**.
- [x] Real-app spot-check (fresh dev-session cookies, live local stack,
      1280px desktop + 390px mobile): Admin (`/admin`), Teacher (`/teacher`),
      Student (`/dashboard/student`) all render the toggle inside
      `admin-nav-region`, positioned identically to the harness
      (`toggle.left=1008 ≥ main.right=976`); Super Admin (same `/admin`
      shell) confirmed via the shared `AdminLayout`. Mobile: toggle above
      the title, no overflow, on all three.

### Defect B — سياسة الخصوصية / شروط الاستعمال failed with BA-000

- [x] **Root cause, proven from the running environment, not assumed** (see
      `docs/CHANGES.log` for the full diagnostic trail): TWO independent,
      purely environmental local-dev-stack defects, neither in application
      code. **(1)** `bodour-api-1`'s running image predated the R138 commit
      (`f0cfc8d`) by ~7 hours — `dist/src/app.js` inside the stale container
      carried no `legal-documents` route at all, so every request fell
      through to the `guarded` router's unconditional auth middleware and
      came back `401`, not the coded `404`/`503` the actual implementation
      would give. **(2)** The local dev database had never had
      `20260909120000_r138_session_title` or
      `20260909132600_r138_legal_documents` applied —
      `_prisma_migrations` stopped at R137 — so even a correct image would
      have hit a raw "relation does not exist" Prisma error, collapsed by
      `normalize()` into a generic `INTERNAL`/500 the frontend's
      `classifyError()` renders as **BA-000** (`error-classes.ts`'s own
      `'unknown'` bucket — a status/shape the classifier does not name a
      specific code for). The schema, migration, service, controller,
      route, validators, frontend adapter/page and OpenAPI/TD-3 registry
      were all already correct and mutually consistent — confirmed line by
      line before touching anything.
- [x] **Fix — local development environment only, via the repository's own
      documented workflow** (`docs/development/getting-started.md`), no
      code changed: `docker compose build api` (current `develop` HEAD),
      `docker compose run --rm api npx prisma migrate deploy` (applied
      exactly the two pending migrations), `docker compose up -d
      --force-recreate --no-deps api`. `GET /healthz` green; the public
      route now correctly answers `503 LEGAL_DOCUMENT_NOT_CONFIGURED` for
      an empty kind — the honest "not yet published" state, never `BA-000`.
- [x] **Content** — the database held zero `LegalDocument` rows of either
      kind (never auto-seeded, by design, same as `PARTNERS`/
      `LegalConsentText`). Real Arabic Privacy Policy and Terms of Use text
      authored and activated through the actual Super Admin API (`POST
      /admin/legal-documents` → `POST .../{id}/activate`), reconciled
      against the current, implemented platform: Google OAuth
      (`openid`/`email` only), what is actually collected (name, email,
      optional phone, date of birth, branch/category/Level, attendance
      incl. self-attendance where R123 permits, exam/assessment
      answers/grades, Quran/Hifz progress, consent records incl.
      `media_release`), the **seven-day** deletion recovery window (R133 —
      the pre-existing recommended-draft text in `ar.ts` still said R111's
      superseded three days; corrected there too), what R133 retains after
      deletion, monthly/two-generation backup rotation (R133(6)), public
      calendar/content tiers, and voluntary teacher voice recordings.
      Genuinely unresolved facts (CNDP registration, legal representative,
      governing law/jurisdiction, exact retention period for de-identified
      records) are marked with the platform's own `⚠` owner-input
      convention, never invented (§20 rule 9). `ar.ts`'s own
      `termsLawBody` was missing entirely (a heading with no body) —
      added, same convention.
- [x] Real-browser: `verify-legal-pages.mjs` extended — a hard reload
      (`ignoreCache: true`) re-renders the real body, not a cached error;
      320px/390px mobile renders the real body with no document-level
      horizontal overflow, for both pages. **18/18 checks pass**, live
      local stack, genuinely anonymous (no bearer token at any point).
- [x] Lifecycle verification: the existing R138 suites
      (`legal-document.integration.test.ts`,
      `legal-document.http.integration.test.ts`) already cover the full
      matrix this defect touches — one active per kind, activation
      supersedes, active immutable, superseded cannot reactivate,
      unauthorized management refused, anonymous public read, the
      not-configured 503 itself (with the other kind unaffected, restored
      after the test) — unchanged, re-run clean against the disposable
      stack as part of this pass's full verification (nothing in this
      code path was touched).
- [x] Verification: backend lint/typecheck/build clean, 334/334 unit
      tests; frontend lint/typecheck/build clean, 106 files/1,258 unit
      tests; full disposable-stack integration suite green, all-table
      isolation intact. No OpenAPI/TD-3 change (no route added or
      changed). All `check-*.sh` guards, doc-links and `git diff --check`
      clean. No migration authored — the two pending ones were already
      written by R138 and merely needed applying. No Staging or Production
      action taken; only the local dev container/database were touched,
      using the repository's own documented, safe workflow.

## Comprehensive HEAD review, Vercel-blocked push/Staging — 2026-09-14

- [x] **Owner-authorized comprehensive read-only review** of the current
      repository (`develop` @ `ecfbeda`, unchanged since H3), across all nine
      requested areas (requirements/contract, auth/account lifecycle,
      authorization/safeguarding, scheduling/exams, storage lifecycle,
      database/jobs/concurrency, frontend, infrastructure/operations,
      privacy/data minimization). Full detail and disposition of every
      finding in `docs/CHANGES.log`'s 2026-09-14 entry.
- [x] **One confirmed High defect fixed**: the `this_and_future` course-
      schedule split (SRS Revision 50) could silently double-book a room by
      being blind to a retained, R43.6-protected session — its conflict
      check excluded the whole predecessor schedule rather than only the
      sessions actually being removed, and the successor's materialization
      had no visibility into that retained session's date either. Fixed in
      `course-schedule.service.ts` (`findConflicts` gained
      `excludeSessionIds`, scoped precisely) and `session-materialize.
      service.ts` (`materializeSchedule` gained `reservedDates`, split-
      only). Two new regression tests in `course-schedule.integration.
      test.ts`, confirmed to fail without the fix and pass with it.
- [x] Two other candidates investigated and recorded as NOT defects
      (documented, tested design) rather than changed: `consent_forced_
      private` staff download scope, and consent-withdrawal's asynchronous
      `consentForcedPrivate` reevaluation. See CHANGES.log for the exact
      evidence.
- [x] Verification: backend typecheck/lint/build clean; full backend unit
      suite 342/342; focused disposable-stack integration run (four
      scheduling suites, 133/133 incl. the two new tests) green. No
      frontend/schema/migration/route/OpenAPI change — those gates were not
      rerun, nothing they cover changed.
- [x] **Mandatory Vercel precondition failed**: the Vercel Git integration's
      legacy Commit Status API posted a fresh "success" status directly on
      `ecfbeda` (current HEAD) at 2026-09-13T21:15:48Z, confirmed live via
      `gh api` before any push — the integration is still connected, not
      disconnected. Per this task's explicit instruction, local review/fixes
      were completed and committed, but the push to `origin/develop` and the
      authorized Staging deployment were both stopped short. Exact Owner
      action required: disconnect the Vercel project's Git integration
      (Vercel dashboard → Settings → Git), or remove this repository from
      Vercel's installed GitHub App (GitHub → Settings → Integrations →
      Installed GitHub Apps → Vercel → Configure) — documented already in
      `docs/operations/environments.md`.
- [x] **Owner explicitly authorized pushing regardless** (2026-09-14,
      superseding the stop above for this one push): pushed `32b0052` to
      `origin/develop`. Hosted CI (run `34816379502`) failed the Integration
      job on `trash-coverage.integration.test.ts`'s deletedAt-coverage guard
      — a false positive against `session-materialize.service.ts`'s
      deliberately tombstone-reading `existingRows` query (`Session` carries
      an unconditional `@@unique([scheduleId, date])`, not partial on
      `deletedAt`), exposed only because this same-day fix's added JSDoc
      pushed the guard's 40-line lookback window past the nearest visible
      `deletedAt` token. Corrected by adding `session-materialize.service.ts`
      to the guard's existing `READS_TOMBSTONES_DELIBERATELY` allowlist with
      a full justification — the same mechanism already used for three other
      legitimate tombstone-reading files — not by weakening the guard
      generally. Full detail in `docs/CHANGES.log`'s same-day continuation
      entry. Re-verified locally (targeted suite 138/138, full disposable
      integration run green, typecheck/lint clean) and pushed as a new,
      independently reviewable commit.
- [x] Hosted CI green for `ad76612` after one evidenced retry (unrelated
      pre-existing pagination-under-concurrency test flake in
      `assessment.integration.test.ts`, not a defect — see CHANGES.log).
      All 7 jobs green, run `34817742991`; exact-commit GHCR images published.
- [x] **Staging deployed and verified**: `ad76612` deployed to
      `staging.bodouralamal.com` (`92.222.65.141`,
      `vps-ddc32604.vps.ovh.net`, OVH, `/opt/bodour`), upgrading from
      `ca1ef5c2`. Host preflight caught and resolved (with Owner
      confirmation) a pending reboot and a post-reboot NTP-sync race;
      `EMAIL_LOCK_KEY` provisioned for the new email-lock migration (Owner
      confirmed, generated on-host, never displayed); `pg_dump` rollback
      point taken before migration; all 3 pending migrations applied; seeds
      idempotent. First boot failed health on four dead, pre-existing
      malformed `pgboss.job` rows blocking the new storage-retirement
      import — root-caused precisely and deleted with Owner confirmation
      (Staging-only, already-terminal, not real content). `/healthz`
      green (4/4 components, 12/12 workers). TLS/HSTS/CSP/redirect/port-
      exposure/auth-boundary all independently verified; a live, real Super
      Admin session (evidently the Owner) actively and successfully used the
      freshly-deployed site throughout. One pre-existing, NOT fixed,
      out-of-scope issue found: intermittent `500` on `DELETE /exams/:id`
      during that session (5 occurrences, self-stopped, likely the same
      family of stale synthetic fixture data as the pg-boss cleanup —
      unconfirmed, flagged for follow-up). Full detail in CHANGES.log.

## Owner-reported: exam deletion 500, delete dialog, semester message — 2026-09-14

- [x] **Exam deletion 500 fixed** (this is the follow-up the entry above
      flagged — root cause found, not the "stale fixture data" guess).
      `examStudentRecipients` (`notification.service.ts`) coalesced a null
      exam `branch_id` to `''` before an `audienceWhere` UUID filter,
      crashing on any unplaced physical/level-target exam (a real, permitted
      DB state). Fixed to mirror `examAudienceWhere`'s already-correct
      null-branch handling. New regression test in
      `exam-deletion.integration.test.ts`, confirmed to fail without the fix.
- [x] **Delete-confirmation dialog on `/admin/scheduling` now closes (or
      explains why not) on every outcome.** It never adopted the shared
      `classifyDeletion`/`deletionNotice` contract `groups.tsx` and others
      already use; any failed delete left the same prompt open with the
      explanation posted elsewhere on the page. Now migrated to that shared
      contract; the exam-evidence refusal moved into the dialog's own
      `blocked` slot instead of a floating notice. New source-pinning test
      `scheduling-delete.test.tsx`, confirmed to fail without the fix.
- [x] **`تسجيل مستفيدة` semester selector** no longer visually shows a
      period as chosen when none actually is. `SelectField` fell back to
      displaying its first option whenever `periodId` was genuinely `''` (no
      `placeholder` was passed) — confirmed on Staging that no
      `AcademicPeriod` row currently covers today's date, so `periodId` is
      correctly empty per the server's own derivation; the "preselected"
      look was always an illusion. Added an explicit placeholder and a
      distinct hint for "periods exist, none covers today" vs. "none
      recorded at all." **Owner action still needed**: record an
      `AcademicPeriod` covering the current date on Staging — the code fix
      makes the empty state honest, it cannot fabricate a semester.
      Two new regression tests in `enrolment-period.test.ts`, confirmed to
      fail without the fix.
- [x] Verification: backend/frontend typecheck/lint/build clean; backend
      unit 342/342; frontend unit 1,269/1,269; full disposable-stack
      integration 2,566/2,566; all 31 guards and doc-links pass.
- [x] Pushed as `791b517`; hosted CI green on the first run, all 7 jobs
      (run `34825423221`); deployed to Staging (`staging.bodouralamal.com`),
      no new migrations, `/healthz` green within seconds of recreation, no
      new host-state issues. Full detail in CHANGES.log.
- [x] **Owner action still needed**: record an `AcademicPeriod` covering **[Closed 2026-09-21 ledger review — done — see «Owner action done» below]**
      the current date on Staging — the semester-select fix makes the empty
      state honest, it cannot supply real academic-calendar dates.

## Six Owner-reported/requested items — 2026-09-14 (continued)

- [x] **Approval refusal message fixed** (not the refusal logic — analysed
      and confirmed correct per R122). `NO_CURRENT_ACADEMIC_PERIOD` now
      shows a real remedy instead of "already decided," and leaves the
      dialog open since the item still needs deciding. New tests in
      `approvals.test.tsx`.
- [x] **عطلة edit form fixed**: `fromEvent` now classifies `type: 'holiday'`
      correctly via the scheduling-type catalogue instead of hardcoding
      `'activity'` for every Event. New tests in `scheduling-visibility.test.ts`.
- [x] **Online exam `at_start`/`offset_minutes` scheduling fixed**: the
      online branch of `saveSchedulingItem` now forwards `start_time`/
      `end_time`, matching the physical branch (was silently dropped —
      stale "Physical only" doc comment was the likely cause). New tests
      in `scheduling-exam-availability.test.tsx`.
- [x] **Pending-approval screen no longer a dead end**: wrapped in the
      ordinary site header/footer (reaches no further than an anonymous
      visitor already can — TD-1's server-side denial is unchanged). New
      tests in `pending-guard.test.tsx`.
- [x] **Scope picker redesigned** into independent, always-visible
      dimension selectors (فروع/فئات/مستويات/مجموعات + a separate
      association-wide checkbox), per Owner preference — structurally
      eliminates the "select away and back" display bug as a side effect.
      `class-section.tsx`, `scheduling.tsx` rewritten; three test files
      updated/rewritten to match.
- [x] **New public homepage section** «برامجنا التعليمية» (SRS Revision 144,
      TD-3.16): `GET /programs`, public/anonymous, Categories→Levels→
      Subjects/Surahs, fixed allowlist projection. New backend service/
      controller/integration tests, frontend adapter/component/styles,
      inserted before «أين تجدنا» on the landing page. Required adding
      `/programs` to `pending-denial.http.integration.test.ts`'s
      known-public-routes exemption list (found by the full suite run).
- [x] Verification: backend/frontend typecheck/lint/build clean; backend
      unit 342/342; frontend unit 1,281/1,281; full disposable-stack
      integration 2,571/2,571 non-flaky (one already-known transient flake,
      unrelated, not re-investigated); all 31 guards, doc-links and
      `git diff --check` pass; TD-3/OpenAPI regenerated and reconciled
      (228/236 implemented).
- [x] Pushed as `74631b7`; hosted CI green on the first run, all 7 jobs
      (run `34901759632`); deployed to Staging, no new migrations, no host
      issues, `/healthz` and the new public `/programs` endpoint both
      verified live returning real data. Full detail in CHANGES.log.
- [x] **Owner action done**: an `AcademicPeriod` covering the current date
      (`2026-09-14`–`2027-01-31`) is present on Staging — confirmed directly
      while investigating the item below, not actioned by this session.

## Five Owner-reported Staging items — 2026-09-15

- [x] **Public calendar management-button leak fixed**: `EventDetailsDialog`
      gained a `canManage` prop (default `true`); the public `/calendar`
      page is the one caller that passes `false`, so «ربط اختبار» no longer
      appears there for a signed-in admin/teacher/super_admin browsing the
      public timetable. New `event-details-dialog.test.tsx` +
      `calendar.test.tsx` addition.
- [x] **Mobile nav «حسابي» link fixed**: added `AccountButton`
      (`components/header/auth-buttons.tsx`) and mounted it in
      `MobileMenu`'s authenticated actions block, matching the desktop
      `UserMenu`'s `/profile` link. New `mobile-menu.test.tsx`.
- [x] **"Can't edit a scheduled exam"** — investigated: this is R136 clause
      12's own ratified design (an online occurrence has no edit route by
      construction; a physical exam edits fine). **No code changed.**
      Raised to the Owner as a genuine open product question — build a new
      edit capability, or not — rather than decided silently.
- [x] **"Student didn't get notified / doesn't see the exam"** — verified
      against the live Staging row: notification created correctly at
      scheduling time; the paper's computed `available_from` had simply not
      yet arrived when checked. **No code changed** — the availability gate
      is working as R136/R142 specify.
- [x] **"تقويمي shows all levels, not my own scope"** — re-read
      `personalFilters`/`readCalendar` line by line against R140 §3 and
      re-ran `personal-calendar.integration.test.ts` (9/9, real disposable
      stack): the code is already correctly scoped for both student and
      Teacher. **No code changed** — no reproducible defect found; flagged
      back to the Owner to re-check on a hard refresh.
- [x] **"Teacher doesn't see إدخال الحفظ"** — confirmed this is SRS
      Revision 106's own rule (`requiresCapability: 'teachesQuran'`,
      gated on currently staffing a `tracks_quran_progress`-flagged
      schedule). **No code changed** — a data/assignment question, not a
      permission bug; backend write authorization independently confirmed
      already correct.
- [x] Verification: frontend typecheck/lint/build clean; full frontend
      unit suite 1,288/1,288; focused personal-calendar integration 9/9;
      full disposable-stack integration 2,571/2,571 (18 pre-existing
      skips, no new flake); all 31 guards, doc-links and
      `git diff --check` pass. No backend/schema/route/OpenAPI change.
- [x] Pushed as `4e3d652`; hosted CI green on the first run, all 7 jobs
      (run `34912991227`); deployed to Staging, no new migrations, no
      host issues, `/healthz` green within seconds, TLS/HSTS/CSP
      reconfirmed. Full detail in CHANGES.log.
- [x] **Open product question, answered**: the Owner ratified a new
      capability to edit an already-scheduled online exam's arrangement
      (SRS Revision 145 §1) — see the section below.

## Eleven further Owner-reported items — 2026-09-15 (continued)

- [x] **تقويمي's filter dropdown fixed**: new `GET /me/calendar/options`
      (SRS Revision 145 §2) gives it the caller's own vocabulary instead
      of the public bootstrap's whole catalogue. New
      `personal-calendar-options.integration.test.ts` (6/6) and
      `personal-calendar.test.tsx`.
- [x] **اختباراتي always shows its table now**, migrated to `DataTable`
      (the same rule already applied to every admin list, 2026-08-30).
      New `assessments.test.tsx`.
- [x] **إضافة عنصر's نوع العنصر preselection bug fixed** — the recurring
      unmatched-`<select>`-value pattern; added an explicit placeholder.
      New `scheduling-form.test.tsx`.
- [x] **الجدولة's المؤطِّرات column now shows names, not a count** — plus
      a second, adjacent bug found and fixed at the same time: activity
      staffing was hardcoded to show none at all, contradicting R71.
      Existing `event.http.integration.test.ts`/`exam.http.integration
      .test.ts` updated; new `scheduling-staff-names.test.ts`.
- [x] **Built: an online exam's scheduling is now editable** (SRS
      Revision 145 §1, superseding R136 clause 12) — new
      `PATCH /exams/{id}/schedule`. Content (R124's freeze) untouched;
      one stated, Owner-accepted risk around retargeting after
      submissions exist; re-notification on reschedule deliberately not
      built (a separate future ask). New `exam-schedule-update.http
      .integration.test.ts` (10/10) and `scheduling-exam-edit.test.tsx`.
- [x] **Reported, not implemented, each with its own reasoning** (see
      CHANGES.log for the full detail on each):
      - إدخال الحفظ for a newly-staffed مؤطرة — no Subject on Staging
        carries `tracks_quran_progress`, and there is no admin capability
        to set it; a data/capability gap, not a bug this session can fix
        silently.
      - حصصي removal — would silently remove حصص الحلقة (R106.6a) and
        عرض المستفيدات, neither reachable from تقويمي's list view by
        design (rule AO).
      - تعديل العنصر's frozen branch/level/mode/subject/year — confirmed
        deliberate, SRS Revision 57.
      - group/circle/category targeting for حصة دراسية/محاضرة — a real
        schema/migration decision (`RecurringCourseSchedule` has no
        category concept at all), not a UI change.
      - removing حسابي from the student's own side menu — that page
        carries her reference code/enrolments (R86), which `/profile`
        does not; removing the menu entry would strand that information.
- [x] Verification: backend/frontend typecheck/lint/build clean; backend
      unit 342/342; frontend unit 1,303/1,303; full disposable-stack
      integration 2,589/2,589 (18 pre-existing skips, no flake);
      `docs/openapi.json` regenerated (179 paths/230 operations); TD-3
      230/238 implemented, 0 undocumented; all 31 guards, doc-links and
      `git diff --check` pass. One second defect caught by the full run
      and fixed in the same commit: a new deliberately-unfiltered
      tombstone read needed adding to the trash-coverage guard's own
      allowlist (see CHANGES.log).
- [x] Pushed as `ca1aa9b`; hosted CI green on the first run, all 7 jobs
      (run `34948449244`); deployed to Staging, no new migrations, no
      host issues, `/healthz` green within seconds, the new
      `/me/calendar/options` route confirmed live and correctly refusing
      an anonymous caller. Full detail in CHANGES.log.

## A further Staging round, same day — 2026-09-15 (continued)

- [x] **Compliance question answered, outside code**: the Hostoweb VPS
      reply reviewed against `provider-acceptance.md`/`personal-data-
      audit.md`. Morocco/root/Docker/IPv4/SSD/monthly billing confirmed
      in writing; the "no backup at all" plan and the DPA/CNDP question
      both handed back to the Owner rather than resolved by engineering
      — see CHANGES.log for the exact reasoning on each.
- [x] **Fixed: a named exam supervisor can now grade her own sitting**
      (SRS Revision 146 §1) — the same `ExamStaff.position: 'supervisor'`
      short-circuit attendance already had, missing from grading.
- [x] **Built: `tracks_quran_progress` (R73) is admin-settable** (SRS
      Revision 146 §2) — closes the data/capability gap flagged in the
      previous round.
- [x] **Built: «حسابي» is one page** (SRS Revision 146 §3) —
      `/dashboard/student/account` retired and merged into `/profile`,
      including its one genuinely missing piece (the active child's
      identity while a parent acts for one).
- [x] **Investigated, not built**: viewing a student's actual exam
      answers (backend reads exist, no frontend wiring) and per-question
      grading/publishing (no such storage exists at all) — real features,
      scoped for their own pass.
- [x] **Reported, not implemented** (Owner asked again after the previous
      round's flags; still deferred, not declined): تقويمي/حصصي redesign,
      class branch/level/mode/subject/year editing with this-vs-future
      propagation (supersedes SRS Revision 57), and the class
      group/circle/category schema migration — each needs its own
      dedicated design pass given the risk to the scheduling engine's
      core tables.
- [x] Verification: backend/frontend typecheck/lint/build clean; backend
      unit 342/342; frontend unit 1,308/1,308; full disposable-stack
      integration 2,592/2,592 (18 pre-existing skips, no flake) after
      fixing one genuine regression the full run caught (an exact
      key-set assertion needed the new `tracks_quran_progress` field
      added); no migration, no OpenAPI/TD-3 change. All 31 guards,
      doc-links and `git diff --check` pass.
- [x] Pushed as `4d443e0`; hosted CI green on the first run, all 7 jobs
      (run `34968177974`) — a prior docs-only push's Release job hit a
      transient GHCR blip, confirmed unrelated to code, and did not
      recur. Deployed to Staging, no new migrations, no host issues,
      `/healthz` green within seconds, `/profile` and the retired
      `/dashboard/student/account` both verified reachable. Full detail
      in CHANGES.log.

## SRS Revision 147 — seven fixed, three explicitly deferred — 2026-09-15 (cont. 2)

- [x] **Fixed: every page renders inside the platform's chrome** (SRS
      Revision 147 §1) — `StudentAssessmentsPage`'s `Paper` sub-component
      wrapped in `StudentLayout` for all three states, not only the
      table view; a repo-wide audit found no other reachable bare page.
- [x] **Fixed: تقويمي's personal exam read now narrows by audience, not
      only tier** (SRS Revision 147 §2) — the actual root cause of
      «تعذّر تحميل الاختبار» on «بدء الاختبار»; a pure staff actor's
      coarse-tier view is unaffected.
- [x] **Built: a remote exam's supervisor/assistants, end to end** (SRS
      Revision 147 §3) — `StaffPicker` on the online scheduling form,
      `ExamStaff` rows now written on the online CREATE path (previously
      silently dropped), and the missing adapter forward fixed.
- [x] **Fixed: النقطة القصوى removed from bare exam CREATE; server
      defaults it to 20** (SRS Revision 147 §4) — closes the Owner's
      exact reported `VALIDATION_FAILED`/`bare.max_grade` crash without
      reversing Revision 136 clause 12's bare-pathway ratification;
      still editable, unchanged, once the sitting exists.
- [x] **Built: حصصي retired; تقويمي's قائمة is catalogue-shaped like
      الجدولة's own** (SRS Revision 147 §5) — new backward-compatible
      `catalogList` prop on `PersonalCalendar`; «حصص الحلقة» carried over
      as a row action. **«عرض المستفيدات» has no replacement — flagged
      for the Owner's decision, not silently dropped or rebuilt.**
- [x] **Built: terminology unified on اختبار** (SRS Revision 147 §6) —
      all 61 occurrences of امتحان in `ar.ts` (the sole location of
      user-facing text) replaced; three test fixtures updated.
- [x] **Confirmed, not changed: past dates already allowed in «إضافة
      عنصر»** (SRS Revision 147 §7) — audited both layers, no restriction
      found anywhere; the Owner's ratification recorded as confirmation.
- [x] **Deferred, explicitly, to their own dedicated pass**: viewing a
      student's exam responses and per-question grading/publishing (new
      schema), a simple class branch/level/mode/subject/year editing
      mechanism (supersedes Revision 57), and the real group/circle/
      category schema migration for `RecurringCourseSchedule` — each a
      genuine schema/architecture undertaking, not rushed alongside the
      seven items above.
- [x] Verification: backend/frontend typecheck/lint/build clean; backend
      unit 342/342; frontend unit 1,310/1,310; full disposable-stack
      integration 2,599/2,617 (18 pre-existing skips, no flake, all-table
      isolation intact); all 31 guards, doc-links and `git diff --check`
      pass. New coverage in `personal-calendar.integration.test.ts`,
      `assessment.integration.test.ts`, `scheduling-exam-source.test.tsx`.
- [x] Pushed as `d3e3599`; hosted CI's Backend job failed on
      `npm run typecheck`'s stricter `exactOptionalPropertyTypes` (a
      genuine gap in the new test fixture, not caught by the default
      `tsc -p .` run beforehand). Fixed, re-verified against the exact
      CI commands, re-ran the full integration suite and all 31 guards
      green, pushed as `ca94645`; hosted CI green on that run, all 7
      jobs (run `34983753496`) including Release. Deployed to Staging,
      upgrading from `4d443e0`: no new migrations, no host issues,
      `/healthz` green within seconds, TLS/security headers intact, no
      leftover disposable containers. Full detail in CHANGES.log.

## SRS Revision 149 — النقطة القصوى returns to «إضافة عنصر» — 2026-09-15 (cont. 3)

- [x] **Built: النقطة القصوى asked again on CREATE, pre-filled with 20**
      (SRS Revision 149) — reconsiders Revision 147 §4's removal;
      deliberately not pre-filled on EDIT (empty there means "leave it
      alone").
- [x] Verification: frontend typecheck/lint/build clean; full frontend
      unit suite 1,311/1,311. No backend change, no migration.

## SRS Revision 148 — checkpoint 1 of Revision 147's three deferred items — 2026-09-15 (cont. 3)

- [x] **Built: editable class branch/level/mode/subject/year, through R50's
      own split** (SRS Revision 148 §1) — five new optional fields on
      `updateCourseScheduleSchema`, `this_and_future`-only; successor
      identity resolved through the same `resolveTarget`/
      `assertSubjectTaughtAtLevel` CREATE uses; frontend identity
      section added to `schedule-sessions.tsx`'s `ScopeDialog`,
      admin-portal only.
- [x] **Fixed: a named exam supervisor may now read a student's submitted
      answers** (SRS Revision 148 §2) — new `loadForAuthorOrSupervisor`,
      scoped to `listSubmissions`/`readSubmission` only; authoring
      itself is untouched.
- [x] Two test-isolation bugs found and fixed while writing coverage:
      shared-fixture-teacher staffing leaking into an unrelated later
      assertion, and the shared `slot()` allocator overflowing past 24
      hours from a describe block moved to the end of the file.
- [x] Verification: backend/frontend typecheck/lint/build clean; backend
      unit 342/342; frontend unit 1,311/1,311; full disposable-stack
      integration suite green, all-table isolation intact; all 31
      guards, doc-links and `git diff --check` pass; OpenAPI
      regenerated, no drift. No migration.
- [x] Pushed as `ea73d0e` (bundled with SRS Revision 149's max_grade
      revert); hosted CI green on the first run, all 7 jobs (run
      `34999505173`) including Release. Deployed to Staging, upgrading
      from `ca94645`: no new migrations, no host issues, `/healthz`
      green within seconds, TLS/security headers intact, no leftover
      disposable containers. Full detail in CHANGES.log.
## SRS Revision 150 — checkpoint 2: responses reachable, online staff editable — 2026-09-15 (cont. 4)

- [x] **Built: viewing a student's submitted responses, reachable end to
      end** (SRS Revision 150 §1) — the feature was already fully
      built; the gap was `authorPaper` still gating on plain
      `loadForAuthor`, plus no navigation link from نقاط الاختبارات.
      Both fixed; no new viewer written.
- [x] **Fixed: an online exam's supervisor/assistants are editable**
      (SRS Revision 150 §2) — `StaffPicker` added to `exam-section.tsx`'s
      locked+online branch; underlying state/forwarding already correct.
- [x] Verification: backend/frontend typecheck/lint/build clean; backend
      unit 342/342; frontend unit 1,312/1,312; full disposable-stack
      integration suite green, all-table isolation intact; all 31
      guards, doc-links and `git diff --check` pass. No migration.
- [x] Pushed as `495f397`; hosted CI green on the first run, all 7 jobs
      (run `35004430067`) including Release. Deployed to Staging,
      upgrading from `ea73d0e`: no new migrations, no host issues,
      `/healthz` green within seconds, TLS/security headers intact, no
      leftover disposable containers. Full detail in CHANGES.log.
## SRS Revision 151 — checkpoint 3: per-question grading and publishing — 2026-09-15 (cont. 5)

- [x] **Built: per-question grading, one new table** (SRS Revision 151) —
      `grade_question_score`, purely additive; `Grade.score` stays the
      total, computed and written together in the same transaction.
- [x] **Built: R137's all-or-nothing points rule re-checked defensively**
      (SRS Revision 151 §2) — never assumed, since it is only enforced
      at REMOTE publish time; a physical sitting's questions are never
      verified against it otherwise.
- [x] **Built: the wire contract and frontend UI** (SRS Revision 151 §§3–4)
      — `question_scores` replaces `score` when sent; partial saves are
      legal drafts; replaced whole on every save; one column per
      question in `GradeSheetView`, total derived and read-only.
- [x] **Deliberately not extended: the student's own published-grades
      list** (SRS Revision 151 §5) — a new drill-down screen, not
      requested; left for its own future ask.
- [x] Two test-isolation issues found and fixed, one with real
      collateral cost (a cleanup-order mistake that broke two unrelated
      files' cleanup on a subsequent run) — confirmed resolved by a
      fully green re-run.
- [x] Verification: backend/frontend typecheck/lint/build clean; backend
      unit 342/342; frontend unit 1,315/1,315; full disposable-stack
      integration 2,613/2,631 (18 pre-existing skips, all-table
      isolation intact); all 31 guards, doc-links and
      `git diff --check` pass; OpenAPI regenerated, no drift.
- [x] Pushed as `1f18fab`; hosted CI green on the first run, all 7 jobs
      (run `35009329959`) including Release. Deployed to Staging,
      upgrading from `495f397`: `prisma migrate deploy` applied
      `20260915180000_r151_grade_question_score` cleanly (first real
      migration in this batch), `/healthz` green on the first check,
      TLS/security headers intact, no leftover disposable containers.
      Full detail in CHANGES.log.
## SRS Revision 152 — checkpoint 4: teacher قائمة gains تعديل — 2026-09-15 (cont. 6)

- [x] **Built: تعديل on `/teacher/schedules`' قائمة** (SRS Revision 152 §1) —
      reuses the exact `SchedulingDialog` edit mode الجدولة's own قائمة
      already opens; no server change needed, all three kinds
      (class/Event/Exam) already tolerate an in-scope Teacher on UPDATE.
- [x] **Deliberately NOT built: حذف, on any kind** (SRS Revision 152 §2) —
      every kind's DELETE stays server-refused for a Teacher by a
      separately-ratified decision (class ⊘ Revision 140 §2; Event
      Admin-only Revision 43/72/R71.3; Exam Admin-and-above R70.4, no
      `created_by` to express "her own"). Wiring it in would either 403
      on every row or silently reverse one of these three boundaries —
      reported to the Document Owner, not assumed. **Open question for
      the Owner**: should Event/Exam حذف be granted to a Teacher for
      rows she is responsible for/staffs, and on what scoping basis for
      Exam given the missing `created_by`; and was B1 intended to also
      reopen the already-ratified class-delete `⊘`?
- [x] Verification: frontend typecheck/lint/build clean; frontend unit
      1,319/1,319, including a new `schedules-edit.test.tsx` confirmed
      to fail without the fix by stash/restore. No backend change, no
      migration.
- [x] Pushed as `555fbea`; hosted CI (run `35011959262`) failed on
      `Integration`, unrelated to this checkpoint's diff — see the
      defect fix below. Deploy follows once a green run lands.

## Defect found and fixed while verifying checkpoint 4's CI — 2026-09-15

- [x] **`assessment.integration.test.ts`'s unfiltered `listAssessments`
      library assertions were flaky, unrelated to any checkpoint in
      this batch.** Four call sites read `listAssessments(prisma,
      superAdmin(), {})` (no filter) and then located their own
      freshly-created row by id. Every `levelPaper()` fixture in the
      file shares the same `date` (`TODAY`), so the endpoint's
      `[{date:'desc'},{id:'desc'}]` order tie-breaks on a random UUID
      once enough same-date drafts exist — a coin flip on whether a
      given row lands inside the default 25-row page. Tripped hosted
      CI run `35011959262` on an assertion this batch's checkpoint 4
      never touched.
- [x] Fixed by scoping all four calls to the file's own unique
      `levelId` (created fresh per file in `beforeAll`, so the filter
      bounds the candidate set to this file's own fixtures without
      weakening what each assertion actually tests).
- [x] Verification: focused run of the file — 133/133 passed;
      backend lint/typecheck/unit 342/342; full disposable-stack
      integration 2,613/2,631 (18 pre-existing skips, all-table
      isolation intact); all 31 guards, doc-links and
      `git diff --check` pass. No migration.
- [x] Pushed as `45e5e69`; hosted CI green on the first run, all 7 jobs
      (run `35013779376`) including Release. Deployed to Staging,
      upgrading from `1f18fab` (carrying checkpoint 4/SRS Revision 152
      together with this fix): no pending migrations, `/healthz` green
      on the first check, TLS/security headers intact, no leftover
      disposable containers. Full detail in CHANGES.log.

## A3 — group/circle/category schema migration: investigated, not implemented — 2026-09-15

- [x] Investigated `RecurringCourseSchedule`'s current single-exclusive-arm
      targeting (`resolveTarget`, 3 nullable FKs + enum) against `Event`'s
      4 independent join tables (AND across dimensions, OR within one);
      confirmed Revision 139 (ratified 5 days earlier) explicitly left
      `RecurringCourseSchedule` "untouched" and single-target; confirmed
      Event has deliberately no Teaching-Group arm at all.
- [x] Mapped every downstream consumer a matching redesign would touch:
      `resolveTarget`, `roster-resolution.ts` (multiple functions),
      `notification.service.ts`, `attendance.service.ts`,
      `calendar.service.ts`'s `personalFilters` (the `session` branch,
      preserving R92's override semantics), scope-options service, and
      shared frontend `ScopeSelectors` (also depended on by
      `ActivitySection`/`ExamSection` — a real regression risk if
      touched without care).
- [x] Confirmed the R43 expand/contract precedent (additive expand,
      never combined with a same-migration drop; a separate later
      contract phase) as the right-shaped pattern, but noted unlike
      R43's zero-beneficiary-data situation, real data now exists, so a
      genuine backfill/migrate design is a real design question, not an
      implementation detail.
- [x] **Document Owner decision, 2026-09-16 — the dimensions are named**:
      branches, categories, levels, administrative groups, teaching
      circles, subjects, main/assistant teachers, "using dynamic
      filters." Resolves WHICH dimensions; does not by itself resolve
      HOW they combine, whether the old single-target columns are kept
      alongside the new join tables (expand-only) or eventually
      dropped (contract phase, needing a real backfill design against
      live data), or the exact multi-select UI shape.
- [x] **Built end to end (SRS Revision 155), 2026-09-16** — the Document
      Owner's explicit "implement end to end" instruction resolved the
      remaining HOW questions this section had left open: the old
      single-target columns stay (expand-only, no contract phase in
      this pass — see Revision 155 §4/§5 for what is deliberately
      still out of scope: R50 `this_and_future` split, the admin
      scheduling form's own multi-select UI). Full detail in
      CHANGES.log and SRS Revision 155.

## Teacher delete-own (B1's حذف half) and اختباراتي/نقاطي merge — 2026-09-16

- [x] **Built: اختباراتي/نقاطي merge** (SRS Revision 153) — one table,
      client-merged by exam id; طريقة الحضور on every row; الحالة and
      «مراجعة إجاباتي»/«فتح» only for a remote row; النقطة on either
      mode once published; sortable on every header. Fixed alongside
      it: a parent acting for a child could not open اختباراتي at all
      (`myAssessments` never sent `X-Active-Child-ID`).
- [x] **Built: a Teacher may delete her own class/event/exam**
      (SRS Revision 154) — reverses Revision 140 §2, Revision 43/72/
      R71.3 and R70.4, on explicit Document Owner instruction. The SAME
      boundary each kind's edit grant already uses, never wider:
      `assertTeacherCurrentlyStaffs` (class), `assertMayEdit`'s scope
      (event), `assertScope`'s §4.4c scope (exam). Teacher قائمة gains
      حذف, reusing الجدولة's own delete/notify-decision flow exactly
      (Revision 152's precedent extended, not a second implementation).
- [x] **Confirmed, no code needed: roster access for the 3 named
      workflows.** Investigated Quran memorization recording, exam
      grade entry, and event-occurrence attendance recording — each
      already shows the teacher exactly the scoped beneficiaries list
      she needs (`studentsTaughtBy`, `audienceOf`, `assertMayMark`
      respectively), independently server-scoped, none a general
      roster-browsing screen. The `عرض المستفيدات` gap this resolves is
      therefore closed by confirmation, not by new capability — no
      general roster list is being restored, matching what the Owner
      actually asked for.
- [x] **Audit-trail principle — built end to end (SRS Revision 156),
      2026-09-16.** The Document Owner's explicit instruction resolved
      the "separate, much larger decision" this section had reported:
      `created_by`/`created_at` (mostly already existed) for every
      MANUAL-creation model, `deleted_by`/`deleted_at` (mostly already
      existed) for every soft-delete, explicitly excluding automatic
      creation (Notification named by the Owner; generalised to every
      model sharing that shape). 31 models classified and wired; the
      same bare-scalar-no-FK convention `deleted_by` already used, for
      the same reason (`docs/architecture/security.md`'s stance against
      duplicating actor columns, and to avoid `RESTRICT` blocking
      account erasure). Found and fixed alongside it: `SessionStaff`'s
      one genuine manual path (`replaceSessionStaff`, the per-occurrence
      override) never recorded who removed OR who revived a name. Full
      detail in CHANGES.log and SRS Revision 156.
- [x] Verification: backend/frontend typecheck/lint/build clean;
      backend unit 342/342; frontend unit 1,329/1,329; full
      disposable-stack integration suite, 2,620/2,638 (18 pre-existing
      skips), all-table isolation intact; all 31 guards, doc-links and
      `git diff --check` pass. Two pre-existing tests corrected (not
      weakened) and one test-isolation gap fixed — see CHANGES.log for
      all three, including the cascading `grade.http.integration.
      test.ts` fixture regression the first full-suite run surfaced
      and this pass resolved. Three E2E browser scripts updated to the
      merged route, not yet re-run live. No migration.
- [x] Pushed as `895173f`; hosted CI green on the first run, all 7 jobs
      (run `35067326661`) including Release. Deployed to Staging,
      upgrading from `44b886a`: no pending migrations, `/healthz`
      green on the first check, TLS/security headers intact, no
      leftover disposable containers. Full detail in CHANGES.log.

- [x] The روster-viewing gap decision (`عرض المستفيدات`) is now resolved **[Closed 2026-09-21 ledger review — the line itself records it resolved]**
      — see the confirmation above; nothing further outstanding here.

## A3 end-to-end + platform-wide audit trail — 2026-09-16

- [x] **Built: class multi-dimension targeting, end to end** (SRS
      Revision 155) — a fourth, additive `multi_dimension` arm on
      `RecurringCourseSchedule`, mirroring `Event`'s own join-table
      shape (branches/categories/levels/administrative groups) plus
      one genuinely new rule a Teaching Circle needed (unions with the
      rest rather than intersecting, since Event never had a circle
      arm to combine against). Backend only — see Revision 155 §5 for
      the admin scheduling form's multi-select UI, deliberately not
      built this pass — and R50 `this_and_future` split is refused by
      name (`MULTI_DIMENSION_SPLIT_NOT_SUPPORTED`) rather than guessed
      at, both flagged as named follow-up work.
- [x] **Built: a `created_by` audit trail for every manually-created
      or -deleted row** (SRS Revision 156), 31 models classified and
      wired, following the SAME bare-scalar-no-FK convention
      `deleted_by` already used. Found and fixed alongside it:
      `SessionStaff`'s one manual override path never recorded who
      removed or who revived a name.
- [x] Verification: backend typecheck/lint/build clean; backend unit
      342/342; full disposable-stack integration suite, 2,631/2,649
      (18 pre-existing skips) including new coverage for both
      revisions; all-table isolation intact; all 31 guards, doc-links
      and `git diff --check` pass. Full detail in CHANGES.log and SRS
      Revisions 155–156.
- [x] Pushed as `14b193b`; hosted CI green, all 7 jobs (run `35091290782`),
      Release included (one Integration-job browser-timing flake, confirmed
      unrelated and cleared by a clean rerun). Deployed to Staging, upgrading
      from `895173f`: pre-migration dump taken, `prisma migrate deploy`
      applied all three new migrations cleanly, `/healthz` green on the
      first check, no leftover disposable containers. Full detail in
      CHANGES.log.

## SRS Revision 155 completed end to end + six Owner-reported fixes — 2026-09-16

- [x] **Built: SRS Revision 155's own deferred §4/§5, end to end** (SRS
      Revision 157) — `this_and_future` now reaches a `multi_dimension`
      schedule (carry-forward by default, an explicit rename validated
      against every effective Level), and the admin scheduling form
      gained its own five-independent-picker UI, unscoped
      administrative-group/circle reads, and the locked-on-edit
      "fixed at creation" statement `ActivitySection` already uses.
- [x] **Built: نقاط الاختبارات's per-student "view her responses and
      grade them" dialog** (SRS Revision 158) — reuses the exact
      submission read و question/answer rendering بناء الاختبارات's own
      `SubmissionDialog` already established, adds an editable grade
      input beside each question, and a plain total field always
      offered (not only when the exam has no points). Saves that ONE
      student immediately as a draft, through the identical
      `entryPayload`/`saveGrades` path the bulk save uses. No backend
      change.
- [x] **Built: five smaller Owner-reported fixes** (SRS Revision 159)
      — a misleading sentence removed from بناء الاختبارات's freeze
      notice; حصص الجدول's «المؤطِّرات» column now shows names (the
      same fix Revision 155 already gave the schedule list, missed
      here); الجدولة's occurrence dialog: التوقيت's stray `dir="ltr"`
      fixed, التاريخ's Hijri half reformatted with a real separator, an
      exam's own supervisors now named (`ExamStaff`, in their own row —
      never folded into `instructors`); بناء الاختبارات/نقاط الاختبارات
      moved to the end of both main navs, matching the Owner's stated
      order, with `/admin/assessments`/`/teacher/assessments` finally
      added to §14.1's own sitemap text (both missing since R124); and
      «بدء الاختبار» now withdraws once the sitting's own end time
      passes, replaced by «عرض الاختبار» for a student/parent (the
      existing read-only review capability, reached by a new route).
- [x] Verification: backend/frontend typecheck/lint/build clean;
      backend unit 342/342; frontend unit 1,348/1,348; full
      disposable-stack integration suite, 2,636/2,654 (18
      pre-existing skips), all-table isolation intact; all 31 guards,
      doc-links and `git diff --check` pass. Full detail in
      CHANGES.log and SRS Revisions 157–159.
- [x] Pushed as `20ffa0e`; hosted CI's first run failed `Backend —
      lint, typecheck, test, build` (two unchecked `unknown` reads in
      the new R157 split tests, caught by `npm run typecheck`'s own
      `tsconfig.typecheck.json` — the config that actually typechecks
      test files, unlike the plain one this pass had been running
      directly). Fixed, pushed as `326289f`; hosted CI green, all 7
      jobs (run `35126306570`), Release included. Deployed to
      Staging, upgrading from `14b193b`: no pending migrations,
      `/healthz` green on the first check, no leftover disposable
      containers. Full detail in CHANGES.log.

## SRS Revision 160 — eight-item Owner batch, landing incrementally — 2026-09-16

- [x] **Built: نقاط الاختبارات §1** — removed the exam-wide «فتح في بناء
      الاختبارات» link and the students-and-answers inbox table it
      pointed at; added `GradeSheetRow.submitted` (same predicate
      `readSubmission` uses) gating the per-row «عرض الإجابات» and
      shown in a new «حالة الإجابة» column. Found and fixed a
      pre-existing integration-test teardown gap alongside it.
- [x] **Built: registration §5** — `register.kindSelfManaged` (R132)
      hidden from the dropdown for this release; validation,
      submission and the review queue untouched.
- [x] **Built: content library §8** — «تنزيل الملف» now mints its own
      `attachment`-disposed presigned URL instead of reusing the
      previewer's `inline` one, so it actually downloads.
- [x] **§2 — filter UX overhaul: confirmed by the Owner on 2026-09-20 and
      built for classes as SRS Revision 163 §5 (see that section below).**
      Original note, kept for the record — investigated and explained; redesign
      held pending confirmation. `multiDimensionHint`'s intersection
      rule matches what the Owner described (SRS Revision 160 §2's
      full explanation). Collapsing the three teaching modes into
      always-shown filters is mechanically possible but changes what
      a self-service Teacher is offered (`MODES` gates both); true
      mutual cascading needs a faceted-options read that does not
      exist today. Awaiting confirmation of the exact shape.
- [x] **Built: §3 — تعديل الحصة per-occurrence overrides** (SRS
      Revision 161), on explicit Owner instruction. R92's branch-only
      audience override generalised to level/category/administrative-
      group/circle (four new join tables mirroring the existing one;
      `audienceForSession` is the only function that changed — every
      other caller and `audienceWhere`'s own arms are untouched) and
      the mode restriction lifted (works for every teaching mode
      now). A per-occurrence Subject override added to `PATCH
      /sessions/{id}`, validated against the schedule's own Level(s).
      «الحضور» dialog is now five independent pickers; «تعديل» gains
      a Subject select. Route renamed `PUT /sessions/{id}/audience`.
- [x] Verification: backend/frontend typecheck/lint/build clean;
      backend unit 342/342; frontend unit 1,356/1,356; full
      disposable-stack integration suite, 2,648/2,666 (18
      pre-existing skips), all-table isolation intact; all 31 guards,
      doc-links and `git diff --check` pass. Full detail in
      CHANGES.log and SRS Revision 161.
- [x] Pushed as `88fee22`; hosted CI green, all 7 jobs (run
      `35501918178`), Release included. Deployed to Staging,
      upgrading from `325e360`: pre-migration dump taken, `prisma
      migrate deploy` applied the new R161 migration cleanly,
      `/healthz` green on the first check, no leftover disposable
      containers. Full detail in CHANGES.log.
- [x] **§4 — multi-role registration, investigated.** **[Closed 2026-09-21 — built as R168 §1: the join table is `role_request`, and a PARTIAL approval leaves an ACTIVE account with its other requests still pending or declined]** The blocker is
      `User.requestedRole`, a single scalar column read/written
      everywhere a registration is created, listed or approved.
      Supporting several roles needs it widened to a set (most likely
      a join table) and a real answer for what a PARTIAL approval
      leaves behind. A schema-and-workflow decision with more than
      one defensible shape — awaiting confirmation before building.
- [x] **Built: بناء الاختبارات §6** — the question list carried no
      stylesheet rule at all; each question is now a numbered card
      with kind/points as badge chips and its actions in one row.
      The rest of the screen (summary, library table) was checked
      and left as-is — no logic, request or i18n string changed.
- [x] **Built: مستجدّات §7** — each notice is now an icon (a new
      per-category glyph) beside a text column in its own soft card;
      the unread marker stays the AG-required inline-start border
      (shape, not colour), a soft tint added only as a second cue. No
      headline/reason text changed.
- [x] Full disposable-stack re-run: 2,640/2,658 (18 pre-existing
      skips), all-table isolation intact, up from 2,636/2,654. All 31
      guards, doc-links and `git diff --check` pass. Pushed as four
      commits (`fc14bb2`, `98c3279`, `0ffae92`, `325e360`), hosted CI
      green on each, all 7 jobs. Deployed `325e360` to Staging,
      upgrading from `326289f`: no pending migrations, `/healthz`
      green on the first check, no leftover disposable containers.
      §2/§3/§4 remain open pending Owner confirmation — see above.
      Full detail in CHANGES.log.

## SRS Revision 162 — independent codex review of Revision 161, fixed — 2026-09-20

- [x] **Built: §1 HIGH — consent withdrawal now discovers `multi_dimension`
      and R161-override sessions.** `consentSessionIdsForStudent` hand-
      derived its own audience test, blind to `multi_dimension` (Revision
      155) and Revision 161's four newer override tables — a withdrawal
      against a beneficiary reached only through either created NO
      reevaluation obligation, so BR-2's gate could stay wrong indefinitely.
      Rewritten as a superset candidate query narrowed by the SAME
      `audienceForSession`/`audienceWhere` every other reader composes.
- [x] **Built: §2 HIGH — personal calendars reach `multi_dimension` Sessions
      and all five R161 override dimensions.** `personalFilters`'s own
      Session predicate never learned either; a beneficiary could be
      entirely absent from her own calendar. Superset SQL restored to exact
      precision by a new `filterSessionsByPersonalAudience`, mirroring
      `filterExamsByAudience`'s established pattern.
- [x] **Built: §3 HIGH — الحضور no longer synthesises the venue as a chosen
      branch.** `readSessionRoster` fell back to the schedule's own branch
      whenever a mode genuinely has none — saving from that state (even
      touching only another dimension) silently invited the whole venue
      branch. Fallback removed; an empty dimension now reaches the editor
      empty.
- [x] **Built: §4 MEDIUM — a `multi_dimension` assignment now carries the
      same exam/Hidden-event scope its legacy-mode equivalent does.**
      `teacherEventScope`, `assertExamInTeacherScope` and
      `examScopeWhereForTeacher` all read three legacy singular columns
      alone, all `NULL` on a `multi_dimension` row. Now also read its five
      scope tables; a Level-only `multi_dimension` schedule (no group, no
      circle) carries whole-Level authority, matching what `audienceWhere`
      itself already resolves for that shape.
- [x] **Built: §5 MEDIUM — a session's own Subject override is now read by
      every consumer, not only the record itself.** The calendar's title,
      `subject_id` and its filter, `teachesQuran`'s occurrence arm and
      `studentsTaughtBy`'s occurrence arm all preferred the schedule's
      Subject unconditionally. Also: `updateCourseSchedule`'s "overwrite
      manually edited" resync now clears a Subject override alongside
      `overridden`, the same footing room/delivery/visibility already had.
- [x] **Built: §6 MEDIUM — a Subject override against a group-only/circle-
      only `multi_dimension` class validates against the Level that group
      or circle actually implies.** `scheduleLevelIds` returned the
      schedule's own directly-named levels alone — empty for such a class —
      silently skipping curriculum validation. Now unions in the implied
      Levels, reusing `course-schedule.service.ts`'s own `effectiveLevelIds`
      computation.
- [x] **Built: §7 MEDIUM — a genuine concurrent double-mark on «تسجيل
      حضوري» now always answers idempotently.** `markPresent`'s check-then-
      insert could lose a real race to `409 DUPLICATE`, contradicting its
      own "idempotent by construction" claim. The loser now re-reads the
      winner's row instead of propagating the constraint error. Proved with
      an actual `Promise.all` race against PostgreSQL.
- [x] **Built: §8 LOW — الحضور's group/circle pickers walk every page.**
      `listAdministrativeGroups`/`listCircles` were each called once with
      `meta.total` discarded and no failure notice. A new `fetchAllPages`
      walks every page; a failed load now sets the same notice the roster
      read already used.
- [x] **Not addressed, left as already tracked:** the pre-existing Library↔
      calendar cancelled-Session backlink inconsistency ("Calendar/media
      regression correction — 2026-09-07" above) — unrelated to Revision
      161, not a regression from it, and its own entry already asks for a
      deliberate lifecycle/navigation-contract decision.
- [x] **Additional defect found and fixed during this pass, not one of the
      eight reported:** the first draft of §5's calendar `subject_id` filter
      spread a second top-level `OR` key onto the SAME `where` object
      `sessionTierWhere(actor)` already spreads one onto — silently
      overwriting R109's visibility-tier filter (public/private/hidden-if-
      responsible) whenever a caller also passed `subject_id`, for any
      Admin/Teacher/Student/Parent actor. Found by re-reading the diff
      before verification, not by a failing test. Fixed by composing every
      OR-bearing condition through one `AND` array instead of sibling
      top-level spreads.
- [x] Verification: backend/frontend typecheck/lint/build clean; backend
      unit 342/342 (unchanged — every fix needed real PostgreSQL, so none
      is unit-testable); frontend unit 1,361/1,361 (5 new, behavioural, not
      source-string pins); full disposable-stack integration suite,
      full disposable-stack integration suite **2,670/2,688 (18
      pre-existing skips)**, up from 2,648 by exactly the 22 tests this
      pass added, all-table isolation intact;
      all 31 guards, `check-openapi-current.sh`, doc-links and
      `git diff --check` pass. No schema change, no migration. Full detail
      in CHANGES.log and SRS Revision 162.
- [x] Pushed as `c5f1006`; hosted CI green, all 7 jobs (run
      `35507143651`), Release included. Deployed to Staging, upgrading
      from `88fee22`: host preflight initially failed on free disk (14
      GiB, below the 20-GiB approved floor) — ~40 old release-generation
      images plus one stray target-host-built image removed (all
      permanently recoverable from GHCR), 27 GiB free, preflight passed.
      **An unrelated, pre-existing incident occurred and was fully
      recovered during this deployment — see the new open item below and
      CHANGES.log for the complete account.** After recovery: `api`/
      `nginx` recreated and verified on `c5f1006`'s exact label,
      `/healthz` green (4/4 components, 12/12 workers), no error-level
      log lines, TLS/HSTS/CSP headers reconfirmed. No Production action.

## RESOLVED — Document Owner decision: one SeaweedFS model for every tier (2026-09-20)

- [x] **Found while deploying SRS Revision 162 to Staging, not part of that
      task.** Commit `d9c25e6` ("B1 — maintained object store",
      2026-09-12) replaced the `minio` service's image with SeaweedFS in
      `docker-compose.storage.yml`. That commit's own `docs/TASKS.md`/
      `docs/CHANGES.log` entries state five times over that this was
      **local engineering acceptance only** — "no live rollout occurred,"
      "legacy Local/Staging MinIO configuration unchanged," "live
      provisioning… require[s] separate authorization." But the compose
      file itself did not encode that distinction: `minio`'s definition
      in `docker-compose.storage.yml` was identical regardless of which
      tier overlay sat beside it, so the documented deployment runbook's
      own commands could perform exactly the "live rollout" that
      commit's documentation said requires separate authorization —
      proven when running the routine `prisma migrate
      deploy` step against Staging recreated `bodour-minio-1` on the new
      image against a fresh, empty volume, causing `/healthz` `503`s
      within seconds. Recovered within minutes with zero data loss
      (original `bodour_minio-data` volume was never touched); full
      timeline in `docs/CHANGES.log`'s "SRS Revision 162" deployment
      entry.
- [x] **Owner decision, 2026-09-20: explicitly authorize discarding
      Localhost and Staging object-storage data and run SeaweedFS 4.46
      identically on Localhost, Staging and Production.** Resolves both
      open questions this item left: SeaweedFS is now authorized for
      Localhost and Staging immediately (data recreated, not migrated —
      the Owner explicitly waived object-by-object migration/rollback for
      those two tiers); Production will run the same implementation
      whenever its own separate go-live is authorized (unchanged by this
      decision). The structural fix: `docker-compose.storage.yml` no
      longer exists — its content now lives directly in
      `docker-compose.yml`, so there is no longer a separate file for any
      tier's compose invocation to silently include or omit. Full
      implementation, file list and verification: see "SeaweedFS
      unification" below and `docs/CHANGES.log`.

## SeaweedFS unification — one object-storage model for every tier (2026-09-20)

- [x] Merged `docker-compose.storage.yml`'s `minio`/`minio-init` service
      definitions directly into `docker-compose.yml`, replacing the base
      file's previous real-MinIO services entirely; deleted
      `docker-compose.storage.yml`. Preserved verbatim: the pinned
      SeaweedFS 4.46 digest, disabled telemetry/Admin UI/WebDAV/Iceberg/
      Lance/IAM/auto-bucket-creation, `volume.nocopy` empty-restore
      target, the `weed mini -s3.port=9000` healthcheck, and the Node/
      AWS-SDK `storage-init.mjs` initializer (bucket creation, policy
      checks, versioning/lifecycle/Object Lock refusal).
- [x] `docker-compose.production.yml` reduced to its one remaining line
      (`NODE_ENV=production`) — its `minio`/`minio-init extends:` blocks
      and volume-name override are gone, now redundant with the base
      file. `docker-compose.release.yml` gained a `minio-init` image
      default (the exact-commit API image, matching `api`/`nginx`) so
      Staging gets the real release image there too, not
      `bodour-api:dev`. `docker-compose.staging.yml`'s `minio-init`
      memory ceiling raised 64m → 256m (Node/SDK image, not the former
      static `mc` client).
- [x] Updated every script/fixture referencing the retired file or the
      retired real-MinIO credential shape: `scripts/deploy/
      preflight-host.sh` (unified its semantic validator's storage checks
      across both tiers; removed the `MC_HOST_local`/`MINIO_ROOT_USER`
      Staging-only branch and the tier-conditional legacy-volume
      refusal — now unconditional for both), `scripts/ci/
      check-host-preflight.sh`, `scripts/deploy/enable-tls.sh`,
      `scripts/ci/check-release-artifacts.sh`, `scripts/backup/
      run-scheduled.sh`, `scripts/deploy/verify-production-bootstrap.sh`,
      `scripts/ci/test-integration.sh` (dropped the retired `-f`
      reference), `scripts/ci/fixtures/docker-compose.integration.yml`,
      `scripts/ci/fixtures/docker-compose.host-preflight.yml`,
      `scripts/deploy/fixtures/docker-compose.production-drill.yml`
      (removed now-dead credential overrides), `scripts/backup/
      fixtures/docker-compose.yml`, `scripts/storage/
      fixtures/docker-compose.yml` (retargeted `extends:` to
      `docker-compose.yml`), `scripts/seed/fixtures/docker-compose.yml`
      + `scripts/seed/verify-production-seed.sh` (rewritten onto the
      shared `extends:`-based definition; moved the credential export
      before the first `docker compose up`).
- [x] Updated documentation to describe the unified architecture:
      `docs/architecture/storage.md`, `docs/operations/deployment.md`,
      `docs/operations/recovery.md`, `docs/operations/environments.md`,
      `docs/development/ci-cd.md`, `docs/compliance/
      personal-data-audit.md`, `docs/README.md`,
      `docs/architecture/README.md`. `docs/development/testing.md`'s
      dated B1 evidence entries deliberately left untouched as historical
      record (documentation policy).
- [x] Verified: backend/frontend typecheck/lint/build clean. All three
      tiers' resolved Compose graphs inspected directly — identical
      pinned image, credentials, `nocopy` volume, healthcheck and
      `bodour_seaweedfs-data` physical volume name in all three; Staging's
      and Production's `minio-init` both resolve to the exact-commit API
      image. `check-host-preflight.sh` and `check-release-artifacts.sh`
      pass. Five full disposable-stack drills, all green: CI integration
      gate **117 files / 2 skipped (119), 2,670 tests / 18 skipped
      (2,688), 193/193 browser checks** — the exact pre-change baseline,
      zero regression; storage-lifecycle **5/5**; backup/restore drill
      full matrix plus a complete raw+logical restore in **160s**;
      production-seed drill **547/547** across three suites plus SQL
      bootstrap assertions; Production-mode bootstrap dress rehearsal.
      Full detail in `docs/CHANGES.log`.
- [x] One pre-existing, unrelated defect found and **not fixed here** (out
      of scope): `backend/scripts/seed-notify-scenario.ts` and
      `seed-grading-exams.ts` both pass `questions: []` to
      `prisma.exam.create()`, which the current schema rejects since the
      R124 assessment-builder migration normalized `questions` into a
      relation. Neither script was touched by this pass. **Fixed
      afterwards — see "Fixture-script repair after R124" below.** Note
      that `verify-production-seed.sh` therefore did not exit clean in this
      pass: its Vitest batches passed 547/547 but its final scenario-fixture
      loop failed on this defect.
- [x] Pushed to `develop` (`cd82fe6`); hosted CI 7/7 green including the
      exact-commit image publication. **Not deployed** to any remote
      environment (Owner instruction: no remote environment changes as part
      of this task). Production go-live remains a separate, still-open
      decision, unaffected by this change.

## Fixture-script repair after R124 — 2026-09-20

- [x] **Reproduced first**, against a disposable PostgreSQL 18 (every
      migration applied, production seed, dev fixtures, pg-boss schema
      created): `seed-grading-exams.ts` and `seed-notify-scenario.ts` both
      exit 1 with ``Argument `questions`: Invalid value provided. Expected
      ExamQuestionUncheckedCreateNestedManyWithoutExamInput, provided ()``.
      `questions` has been an `ExamQuestion[]` relation since R124, not a
      JSON column.
- [x] **Fixed both** (`backend/scripts/`): dropped `questions: []` and set
      `status: 'published'` + `publishedAt`, exactly as `exam.service` and
      the maintained dev fixture write a physical sitting. Removing the key
      alone would have left a `draft`, which `listExams` excludes (drafts
      belong to the assessment builder) — invisible to the sittings list and
      grading picker these harnesses drive. Proved against the real
      `listExams`: published → both seeded exams listed; forced back to
      `draft` → neither.
- [x] All eight scripts in the seed drill's scenario loop run and `--clean`
      with exit 0. Five (`online-join`, `quran`, `r82`, `r91`, `r92`) had
      never been reached since R124 because the loop stops at the first
      failure; none was stale.
- [x] `scripts/seed/verify-production-seed.sh` now exits **0** end to end:
      SQL bootstrap assertions, Vitest 13 + 335 + 199 = **547/547**, and the
      full scenario loop.
- [x] **Correction to the storage pass's report.** That pass described this
      drill as green from its 547/547 test count; it had in fact exited
      non-zero at its final loop step (recorded correctly in
      `docs/CHANGES.log`, overstated in the chat summary).
- [x] **Closed — why this went unnoticed, part 1: `scripts/` was never
      type-checked.** `backend/scripts/*.ts` sat outside `tsconfig.json` and
      `tsconfig.typecheck.json`. Fixed the four type-only errors an ad-hoc
      check had found (all three scripts ran correctly): `generate-openapi.ts`
      — the synthetic config now carries `RECORDING_STAGING_BUCKET`, and the
      duplicated `/auth/switch-role` path key is reduced to the later
      definition, which is the one JavaScript already kept, so **regenerating
      `docs/openapi.json` is byte-identical** and both OpenAPI guards pass
      (no documentation call was needed after all); `seed-dev-scenario.ts` —
      `person()`'s dead `sex: null` option removed (no caller passed it and
      the column is required); `seed-r82-scenario.ts` — `academicYearId` is
      omitted rather than `undefined` under `exactOptionalPropertyTypes`.
      `tsconfig.typecheck.json` now includes `scripts`; the shipped build
      config still emits none of it. Proven able to fail: a probe file with
      the original `questions: []` shape is rejected by `npm run typecheck`
      with exactly R124's error.
- [x] **Closed — part 2: the seed drill was not in hosted CI.** Added a
      `seed-drill` job to `.github/workflows/ci.yml` running
      `scripts/seed/verify-production-seed.sh`, and added it to the release
      job's `needs`. `check-release-artifacts.sh` now fails if the job or
      that dependency is removed (both mutations verified). The CI handbook
      and deployment runbook say seven verification jobs now.
- [x] **Localhost moved to SeaweedFS** (Owner-authorized, 2026-09-20). Only
      the `minio` service was recreated (`--no-deps`, both compose files) on
      the new `bodour_seaweedfs-data` volume, then `minio-init` ran. The old
      `bodour_minio-data` volume (about 82 MB: `public` 81M, `private`
      864K, `recordings-staging` empty) is retained, unreferenced. **Five
      `educational_content` rows reference objects that were not migrated**,
      so their downloads no longer resolve on Localhost — re-upload, or
      delete the old volume once you are sure. Verified: `/healthz` green
      (storage ok, 12/12 workers), zero error-level API log lines, an
      authenticated PUT/GET/DELETE round trip on both buckets, and anonymous
      GET `200` on `public` versus `403` on `private`.
- [x] **Documentation drift corrected.** The B1 row in
      `deployment-readiness.md` said SeaweedFS was "now the running object
      store on Localhost and Staging" — untrue when written (nothing had been
      deployed). It now says the repository defines one model, Localhost runs
      it, and Staging still runs its pre-change container. Stale "MinIO"
      wording for the object store in `testing.md` and `resilience.md` was
      reworded; dated history and the accurate legacy-volume refusals were
      left as written.
- [x] **Staging's deployment: done, 2026-09-20** — see "Storage unification
      finished end to end" below. (Preflight does refuse a host that still
      carries `bodour_minio-data`; that is now recorded in
      `deployment-readiness.md` for any future host.)
- [x] **Correction, found by the first hosted run of the new job.** This
      pass first recorded the `mc` (MinIO client) users as "working,
      verified". That held only where the image was already cached: on a clean
      runner `docker pull minio/mc` is refused (`pull access denied`), and the
      new `seed-drill` job failed at its bucket step. Fixed for the seed
      drill: the `minio-init` service and its `minio/mc` image are removed
      from `scripts/seed/fixtures/docker-compose.yml`, and the drill runs the
      canonical `scripts/storage/initialize.mjs` on the host from `backend/`
      (the storage-lifecycle drill's existing pattern) — which also checks
      the public-read policy and refuses versioning/lifecycle/retention, so it
      is stricter than the `mc mb` it replaces.
- [x] **The last three `minio/mc` users replaced; none remains anywhere in
      `scripts/` or any compose file.** The backup fixture loses its
      `minio-init` service and gains a loopback-only port; the drill runs the
      canonical `initialize.mjs` and seeds/reads back its canary through
      `scripts/backup/fixtures/object-probe.mjs` (the backend's own S3 SDK).
      Both livekit harnesses list through
      `scripts/dev/browser/list-bucket.mjs`, which exits non-zero on any
      failure (verified: unreachable store and wrong credentials both fail).

## Storage unification finished end to end — Localhost and Staging — 2026-09-20

Owner authorization (2026-09-20): Localhost and Staging may be touched and
changed destructively; Production go-live remains on hold.

- [x] **Four pre-existing defects found by actually running what was changed,
      all fixed.** (1) `verify-backup-restore.sh` corrupted *the first pack
      `find` listed*; pack names are content hashes, so about half the time it
      hit a tree pack, the next backup failed in `create` instead of `verify`,
      and the drill died silently (1 pass in 3 before; **3 of 3 after**, 117s,
      117s, 113s). It now locates a **data** pack exactly through restic.
      (2) Both livekit harnesses read the browser run's status on the line
      after it under `set -e`, so a failing check aborted them before their
      storage check. (3) The ingest harness swallowed a failed listing and then
      printed PASS for "nothing left in staging". (4) The join harness asserted
      media in the staging bucket, unsatisfiable since ingest began sweeping it
      (R99.13); it now requires this run's new MP4 and OGG in the canonical
      store. Its two failing «دخول الحصة» checks were **not** a product
      regression: it clicked the first chip whose text said تفسير, which is the
      dev fixtures' in-person class; it now selects today's cell and the online
      mark. Result: join **61/61** plus a real 5.5 MB MP4 and 126 KB OGG;
      ingest **27/27**; both exit 0 against SeaweedFS.
- [x] **Localhost is whole, and the earlier report is corrected.** "Five
      `educational_content` rows lost their objects" overcounted: four are dev
      fixture rows that never had objects. One real recording (84,378,142
      bytes) and 106 private residue objects existed. All **107 were copied at
      the S3 level and verified by size, SHA-256 and content type, zero
      mismatches**; the recording is served through the real Nginx edge with
      its exact length and range reads. The legacy `bodour_minio-data` volume
      was then deleted. Localhost also now runs current `HEAD` images, no
      pending migrations, `/healthz` green with 12/12 workers. (One transient
      `job runner failed to start` occurred when a migration command was
      launched one second after the API started; the identical startup
      succeeded by hand and on restart. Cause not proven.)
- [x] **Staging deployed at `a6b599d9148cff7732db7511a4ddf07f428682e4`,
      through the documented Staging pipeline** (base + release + staging
      overlay only). Hosted CI 8/8 green first, images published. Order:
      exact detached checkout → `pg_dump` outside the checkout → writers and
      the hand-started MinIO stopped → legacy volume copied into a holding
      volume and verified (38 files, identical tree SHA-256) → legacy
      container and `bodour_minio-data` removed → **host preflight PASS** →
      pull, both revision labels verified → `db` + SeaweedFS up, explicit
      bucket bootstrap → `migrate deploy` (no pending migration) →
      `seed:production` → `seed:fixtures` → app up → `enable-tls.sh` →
      verification. The `migrate deploy` step that recreated the object store
      in this morning's incident left it untouched: there is one storage
      model now, so nothing differs to reconcile. The database container was
      never recreated.
- [x] **Staging's UAT objects preserved, not discarded.** Discarding was
      authorized, but the copy was cheap: **5 of 5 objects, 151,132,392
      bytes, verified by size, SHA-256 and content type, zero mismatches**
      (that figure plus the four fixture rows' nominal sizes equals the
      database's 144 MB total exactly). Run from a one-off container, not
      inside the live API, with a streamed verification read.
- [x] **Staging verified on the real edge.** `/healthz` 200, four components
      ok, 12/12 workers; both containers carry the exact revision label;
      TLS/HSTS/CSP intact; zero error-level API lines; the three public
      objects served at their exact lengths; an unsigned private read denied
      (Nginx answers the store's 403 with its designed `302
      /content-unavailable`); a **signed PUT/GET round trip through the TLS
      proxy with the application's own presigner** passes, including the
      migrated 33,231,224-byte private file; **15/15** anonymous browser
      assertions. Temporary server, holding volume and both cached `minio/*`
      images removed; preflight still PASS on the final state; 26 GiB free.
- [ ] **Production go-live: on hold (Owner).** Nothing in this pass touched
      Production. It will launch on the identical storage model; that decision
      remains separate and open.
- [ ] Not changed, stated for completeness: `verify-backup-restore.sh` is
      still outside hosted CI (the Production dress rehearsal that is in CI
      already exercises backup and restore against the real release graph).

## SRS Revision 163 — five Owner-reported items — 2026-09-20

- [x] **§1 — «صوت فقط» is the default «نوع الاتصال».** One shared
      `initialMediaMode`: an unset value reads audio-only in إضافة عنصر and
      when an in-person occurrence is moved online; a saved «صوت وصورة» is
      kept.
- [x] **§2 — «العنوان» in every item's dialog.** New `item_title` on the
      occurrence (a class's own typed title; `title` stays its Subject, so
      every chip, filter and harness reading it is unaffected).
- [x] **§3 — «الحضور» only for the administration and the main/assistant
      staff of that occurrence, and never on the public calendar.** New
      advisory `viewer_may_mark_attendance`, the server's own answer in batch
      form; `assertMayMark` remains the authority and an integration test
      holds the two together, occurrence by occurrence and actor by actor.
      **An Event's and an Exam's assistants may now mark** (a Session's
      already could); `assertMayEdit` is untouched, so R71.3 stands.
- [x] **Found and fixed while verifying §3 in a browser: the management
      calendar read `GET /calendar` with no credential.** Its comment said the
      adapter read the session itself; it never did. An administrator's own
      calendar therefore showed the PUBLIC tier only — every private or hidden
      class and activity was missing from it.
- [x] **§5 — classes are addressed through five «الكل» filters; «نمط
      التدريس» is asked nowhere.** In إضافة عنصر and in the «from this date
      onward» editor, through one shared module
      (`components/scheduling/audience-filters.tsx`): parent-to-child
      narrowing, dropped orphan choices, every group/circle page loaded, the
      class's own branch taken from the filter when it names exactly one and
      asked as «الفرع المنظِّم» otherwise. The schedule list names the
      audience instead of printing «أبعاد متعددة». A self-service مؤطِّرة
      keeps her one-whole-Level form and is offered none of the filters.
- [x] Verification: backend typecheck/lint, unit 342/342; frontend
      typecheck/lint, unit 1,371/1,371; focused integration on a disposable
      stack (attendance, calendar, course-schedule 145/145; four HTTP suites
      including the pinned calendar key set); real browser on Localhost —
      `verify-attendance` 6/6, `verify-unsaved-guard` 24/24, new
      `verify-class-filters` 12/12 (create through the filters, then a real
      «from this date onward» split). Full local gate: 2,674 passed, one
      failure — the static soft-delete guard's forty-line look-back, fixed
      by hoisting a select into a constant. Full detail in CHANGES.log.
- [x] **§4 — DECIDED by the Owner on 2026-09-20: self-hosted, on every tier —
      built as SRS Revision 164 (section below).** Original note, kept for the
      record — OWNER DECISION: a media provider for Staging and Production.
      «خدمة الحصص عن بُعد غير مهيّأة بعد» is the truthful answer, not a
      defect: no release tier has ever had a provider. LiveKit Cloud (account,
      cost, media outside Morocco, no recording into our store) or
      self-hosting (media ports published, reversing §19.1's 80/443-only rule,
      and tight memory on Staging). Recorded in `deployment-readiness.md`.
      Nothing was provisioned.
- [x] **§5 (i) — OWNER DECISION: should activities intersect like classes?** **[Closed 2026-09-21 — the Owner: YES. Built as R169 §6. Notifications, attendance and personal calendars already intersected (R140); the teacher's private view, the calendar's Level/Category/group filters and the form's wording were what still unioned]**
      Their dimensions are UNIONED today (R139), so an unselected one means
      *nobody through this one*, not «الكل». «الكل»-by-default filters for
      activities means changing who existing multi-dimension activities reach.
      Labels deliberately left alone: «الكل» over a union would be false. A
      circle dimension for activities would also be a new table.
- [x] **§5 (ii) — OWNER DECISION: exams and «سورة».** An exam is single-Level **[Closed 2026-09-21 ledger review — decided and built in R165 §2: a class names one or more Surahs, an exam exactly one]**
      by schema, and grading, the grade sheet's audience and a مؤطِّرة's exam
      scope all read that one Level. `exam.surah_id` exists but no route has
      ever accepted it — new API surface whose placement (exam only, or a حفظ
      class too) is the Owner's.
- [x] **Kept, for the Owner to confirm or overturn:** a class must still name **[Closed 2026-09-21 — OVERTURNED by the Owner. Built as R169 §7 — «الكل» on all three = every Level that teaches the Subject, resolved when the class is saved]**
      a Level, a group or a circle. «الكل» on all three is refused in words,
      because a class's Subject must be taught at every Level it reaches
      (R43/R155). The alternative — «الكل» meaning *every Level that teaches
      this Subject* — is a new audience rule.
- [x] **Fixed by SRS Revision 165 §4 (section below)** — *a «from this date
      onward» edit at a class's FIRST occurrence answered `500`.* The split closes the predecessor the
      day before `from_date`; at the first occurrence that is before its own
      anchor, `course_schedule_effective_until_check` refuses it, and the
      service lets the database error through instead of answering a coded
      refusal (or treating it as the whole series). Older than this revision
      and independent of the filters — it needs a decision on which of those
      two it should be. The new harness splits at the second occurrence.
- [x] **The «from this date onward» editor names a missing Subject or year**
      instead of sending an empty id and showing a bare `400`.
- [x] **`seed-dev-scenario`'s cleanup is ownership-based now.** A split's
      successor takes the occurrence's title («حصة»), so the title-keyed wipe
      never saw it and it pinned the scenario's branch, Subject, Level and six
      users on Localhost while the wrapper's `|| true` hid the failure.
      Residue removed; the wipe also finds schedules by tagged Subject/branch.
- [x] **Repaired by SRS Revision 165 §3 (section below)** — *two stale
      harnesses* (`qa-inventory.md` has the detail): `verify-schedule-edit` still drives a native date
      input the platform retired; `verify-teacher-scheduling` still selects
      the item type by a value that became a catalogue id under R110. The
      assertions this revision touched were restated in both; neither is
      reported as passing.
- [x] Pushed as `4ec1a27`; hosted CI green, all 8 jobs (run `35524209891`),
      including the full integration gate with the soft-delete guard and the
      release. **Deployed to Staging**, upgrading from `a6b599d`, by the
      documented Staging pipeline: dump taken, preflight PASS, no pending
      migration, `/healthz` 200 with 12/12 workers, both revision labels
      exact, zero error-level API lines, 15/15 anonymous browser assertions.
      On the real site every occurrence carries `item_title` (a class's chip
      still reads its Subject, its dialog reads what was typed) and an
      anonymous reader is offered no attendance anywhere. No Production
      action.

## SRS Revision 164 — self-hosted online classes on every tier — 2026-09-20

Owner decision: LiveKit + Egress + Redis, self-hosted, one architecture on
Localhost, Staging and Production; no LiveKit Cloud; media and recordings stay
in our infrastructure; the 80/443-only rule relaxed to the minimum WebRTC needs.

- [x] **Resources verified BEFORE building**, with real rooms and recordings:
      video recording 1.7–1.9 cores / ~700 MiB, audio-only 0.2–0.35 core /
      ~360 MiB, media server 0.35 core / 140 MiB. Whole stack confined to two
      cores: still true 30 fps (888 frames in 29.6 s), 1.98 of 2 cores,
      1.33 GiB.
- [x] **The defect that measurement found:** Egress prices a room recording at
      4 cores by default and refuses what it thinks the host cannot afford —
      under a 2-CPU quota every VIDEO recording answered `503` while audio
      worked. Costs now set from measurement (2.0 / 1.0; Staging 1.5 / 0.5).
- [x] **One model in `docker-compose.yml`** (not an overlay): `livekit`,
      `livekit-egress`, `redis`, each with a health check, bounded logs and a
      restart policy; configuration passed as environment bodies, no secret in
      Git; the two dev-only config files deleted.
- [x] **Ports: exactly 7881/tcp and 7882/udp added**, by the release overlay.
      Signalling is same-origin (`wss://<domain>/rtc` through Nginx); 7880 is
      never published; one multiplexed UDP port, no range.
- [x] **No third-party STUN:** the host's address is stated
      (`LIVEKIT_NODE_IP`), and preflight holds it to the approved public IPv4.
- [x] **Preflight and CI enforce the new rule** — nine services, the exact four
      ports, one key pair across API/media server/recorder, a dedicated secret,
      a same-origin `LIVEKIT_URL`, CPU floors (Staging 2, Production 4) — with
      seven mutation tests proving each can fail.
- [x] **Recordings leave no residue:** Egress's unused `EG_*.json` manifest is
      switched off; the staging bucket is left exactly as it was found.
- [x] Localhost, real browser: `verify-livekit-join` **61/61** with a real MP4
      and OGG through the same-origin route; `verify-livekit-ingest` **27/27**;
      and **61/61 again with a stated host address and media ports on every
      interface** — the release network shape, recordings included.
- [x] Documentation: SRS R164 (and TD-13), provider decision page rewritten
      around the measurements, deployment runbook (host contract, firewall,
      pull list, media verification step), configuration and rotation tables,
      environments, provider matrix, readiness ledger, `.env.example`.
- [x] **No third-party STUN, from either end** — found only by joining Staging
      from outside: LiveKit's default hands every client Twilio's and Google's
      STUN servers. The media server now names only a dead port on its own
      host (3478) and the classroom passes an explicit empty ICE list. My first
      fix named the media port itself and an outside A/B test showed it forcing
      media onto TCP; corrected, with a preflight mutation test for that
      mistake.
- [x] **Deployed to Staging at `f4d2a61`** (after `6c5d4fe` and `cfbbc9e`), by
      the documented pipeline; hosted CI 8/8 before each. Host changes, all
      authorized: `LIVEKIT_*` set in `.env` with the secret generated on the
      host; 7881/tcp and 7882/udp allowed in UFW; `net.core.rmem_max`/
      `wmem_max` raised to 5 MB persistently (LiveKit warned the default was
      too small); superseded release images removed when preflight refused
      19 GiB against the 20-GiB floor.
- [x] **Verified on Staging from OUTSIDE** (a real browser behind home NAT):
      signalling on 443, media on **UDP 7882**, a client handed only our own
      host, 7880 and 3478 closed. **A real recording made on the 2-vCPU host**
      came back from its own store as 1280x720 at 29.99 fps; recorder 1.1-1.4
      cores / ~750 MiB; host never above 166% of 200%; the recorder itself
      reached the media server over UDP through the host's public address.
      Probe recordings and tooling removed; zero error-level API lines.
- [ ] **For the Owner to try:** «دخول الحصة» on Staging with a real Google
      login, and one audio and one video recording through the real screens —
      the only part an automated check cannot do there, because Staging
      sessions cannot be minted (Google sign-in only, by design).
- [ ] **PRODUCTION PREREQUISITES (host not yet provisioned):** at least 4
      vCPU; 7881/tcp and 7882/udp admitted by the host AND the provider
      firewall with inbound UDP unfiltered; `LIVEKIT_NODE_IP`; a dedicated
      `LIVEKIT_API_SECRET`. Go-live itself remains on hold (Owner).

## SRS Revision 165 — nine reported items — 2026-09-20

Owner-reported batch across the online classroom, إضافة عنصر, the series
editor, المواد and the browser harnesses. One migration
(`20260920100000_r165_surahs_in_scheduling`); additive wire changes; no new route.

- [x] **§1a — the recording line follows the recording.** «جارٍ بدء التسجيل…»
      and «جارٍ إيقاف التسجيل…» stayed on screen after the state had moved on:
      it was read once. Re-read every 3 s while transitional, stopped once
      settled; not printed at all when it would repeat the live banner.
- [x] **§1b — the recording's TITLE** is type — Subject — Surah(s) — main
      teacher (public display name) — date and time «إيقاف التسجيل» was pressed
      (`stopped_at`, never *now*, so a retry answers the same). The storage key
      and file name are unchanged on purpose: a key must not carry a person's
      name and must resolve identically on a retry. Import, linking and
      «التسجيلات» were already R99's.
- [x] **§2 — a Subject that works by Surah names WHICH Surah.**
      `subject.requires_surahs` (a column, never the name; set on حفظ القرآن and
      تفسير القرآن; the tracker must carry it — CHECK plus a coded
      `TRACKER_REQUIRES_SURAHS`). One rule, `resolveSurahs`, asked when a class
      is created, edited, split, when one occurrence is edited, and on every
      exam write: `SURAHS_REQUIRED` · `SURAHS_NOT_APPLICABLE` ·
      `SURAH_NOT_IN_SYLLABUS`. A class names one or more
      (`course_schedule_surah`); an exam exactly one (`exam.surah_id`, now
      writable), any number of exams per Surah. `/me/scope-options` carries the
      marker, each Level's «مقرر الحفظ» and the Surah names, so a مؤطِّرة has
      them too. المواد shows and edits the marker.
- [x] **§2 — the title is SUGGESTED** for a class and an exam and follows the
      form until she types. A repeating class carries its time and NO date (its
      title is copied onto every occurrence); a one-off carries both.
- [x] **Recorded, not built:** completing a Level = memorising its Surahs AND **[Closed 2026-09-21 ledger review — built the next day as R166 §1; R168 §3 then made completion the administration's act]**
      passing the تفسير exams of the same Surahs. The data now exists to
      compute it; nothing computes it yet.
- [x] **§3 — `verify-schedule-edit` 13/13 and `verify-teacher-scheduling`
      14/14**, both driving the real date picker and choosing the item type by
      what it says. Running them again found three defects, all fixed:
      a مؤطِّرة's exam refused `400` (R140's capability narrowing applied to every
      item type cleared the Level/Subject her class supplied — now class-only);
      then refused `403 WHOLE_LEVEL_OUT_OF_SCOPE` (the group list she cannot
      read dropped her class's group — it now comes from the class she named);
      and the dev scenario used a soft-deleted academic year.
- [x] **§4 — the first-session split saves.** Nothing left to the predecessor →
      retired (soft-deleted, `predecessor_retired` in the audit row, no Trash
      snapshot: a restore would re-materialize the series over its successor).
      Protected history left → it stays alive, closed on its anchor date.
- [x] **§5 — the Surah is editable for ONE occurrence** (`session_surah`):
      it REPLACES the class's for that date; `[]` returns to the class's; naming
      the class's own is stored as inherit. Asked only when Surahs are named or
      the taught Subject really changes, so an unrelated edit of an older class
      is never held to a Surah the screen cannot offer. The series editor's rows
      now carry `subject_id` (a saved override used to reopen as the class's
      Subject and be cleared by the next save) and `surah_ids`.
- [x] **§6 — one branch question.** «الفرع المنظِّم» is derived
      (`homeBranchOf`); rooms are offered across the branches in play.
- [x] **§7 — a multi-choice dropdown names what was chosen**, never «1 محددة».
- [x] **§8 — the filters-combine sentence removed.**
- [x] **§9 — the Production hosting quote assessed** in
      [provider acceptance](operations/provider-acceptance.md#assessment-of-one-quotation-against-this-matrix-2026-09-20):
      enough to launch on; the 100 GB disk is the limit (≈25–30 h of video or
      ≈250–330 h of audio before it must grow); six questions for the provider,
      UDP 7882 through the anti-DDoS layer first. Nothing ordered; go-live on hold.
- [x] **Also fixed:** a filter-built class addressed by group or circle alone
      published `level_id: null`, so its «from this date onward» editor opened
      with the Subject empty. `level_id` now names the first Level it addresses.
- [x] `verify-class-filters` 16/16 — names not counts, one branch question,
      the required Surah, the suggested title, the inherited Surah, and the
      first-session split answering `200` and leaving one class.
- [x] **Hosted CI refused `ff304fb`** (seed drill red, 7/8 green; no image
      published, nothing deployed). I changed the Production seed without
      running the drill: two scenario seeds (`seed-r91-scenario`,
      `seed-quran-scenario`) schedule the real by-Surah Subjects through the
      real service and named no Surah. Fixed; the drill passes locally to exit 0.
- [x] **The seed drill's default ports moved below the ephemeral range**
      (25437, 29004): a browser's outbound connection from local port 59004 made
      it fail «address already in use» twice on a port nobody listened on.
- [ ] **Same latent fragility, not changed here:** the integration stack and the
      backup drill also default to ephemeral-range host ports (55438, 58083,
      59005, 59006). They passed today; moving them touches CI and its docs.
- [x] **Hosted CI green on `886aac6`, 8/8 (run `35541675670`); deployed to
      Staging** from `f4d2a61` by the documented pipeline: dump, preflight PASS
      (24 GiB free), exact revision labels, migration applied and read back
      (`requires_surahs` on exactly حفظ القرآن and تفسير القرآن; both joins
      present), `/healthz` 200 with 12/12 workers, `/rtc/validate` 401, zero
      error-level API lines, `surah_names` on all 27 public occurrences, the
      new strings served and the removed ones gone. No Production action.
- [ ] **For the Owner to try on Staging** (a session there needs Google
      sign-in): set a Level's «مقرر الحفظ», schedule a تفسير or حفظ class — the
      form asks «السور» and suggests the title — edit one occurrence's Surah,
      split a class at its first session, and record an online class to read
      its new title under «التسجيلات».

## SRS Revision 166 — Level completion, one dialog for one session, composed titles, stranded recordings — 2026-09-21

Owner-reported batch of five. One migration
(`20260921090000_r166_class_title_is_composed` — two columns stop being
required; nothing dropped or rewritten).

- [x] **§1 — Level completion built.** BR-11's unreachable second clause is
      defined: every Surah of the «مقرر الحفظ» memorised AND — where the Level
      teaches تفسير (by-Surah, not the tracker; by columns, never the name) — an
      exam of it TAKEN (a mark that is not «غائبة», or a submitted remote
      paper). One pure rule (`policies/level-completion.ts`) behind both reads;
      shown on «حفظي» and the مؤطِّرة's Quran screen, naming which Surahs are
      still to memorise and which still need their exam. Derived, never stored.
- [x] **For the Owner to confirm:** *taken*, not *passed* — the platform has no **[Closed 2026-09-21 ledger review — answered 2026-09-21 (R168 §3): neither — a Level is completed when the administration records it]**
      pass mark (§4.6), and her word was «taking». A pass mark would be a new
      rule; this clause is where it would go.
- [x] **§2 — «تعديل الحصة» changes everything about ONE session in one save**:
      audience (five lists), Subject, Surah, room, delivery, date, times,
      visibility, «الوصف», main teacher and assistants. `PATCH /sessions/{id}`
      takes `audience`, written in the same transaction by the audience route's
      own writer, under one version bump. Only what changed is sent.
- [x] **§3 — a class is CALLED what it is.** No «العنوان» for a class or an
      exam; the server composes *type — Subject — Surah — main teacher — when*
      at read time, so a cover teacher or a changed Surah is in the title the
      moment it is saved. «الوصف» carries anything typed and now reaches the
      calendar dialog for a class. An activity, a holiday and a sitting from an
      authored paper keep their typed title; a bare sitting's is composed and
      stored, recomposed on edit only while it is still the composed one.
      `title` is refused (not dropped) on the class, session and bare-exam
      write bodies. The two class title columns are retired in place.
- [x] **§4 — recordings of filter-built classes import.** The job resolved a
      Level from the single-target columns only; every class since R163 §5 has
      none, so each recording was refused four times and stranded.
      `npm run ops:requeue-recordings` (shipped in the image) re-queues stranded imports; the
      Owner's seven on Localhost imported.
- [x] **A composed title can no longer overflow `VARCHAR(120)`** — it would
      have REFUSED a recording's or a bare exam's row. Surahs give way first,
      then the main teacher, never «when».
- [x] **Platform-wide, found in passing: every instant was written an hour
      early and read an hour late** (`@prisma/adapter-pg` assumes a UTC
      session; the database's default is `Africa/Casablanca`). Self-cancelling
      on a round trip, wrong everywhere else. Every application session is now
      UTC; a test asks what a round trip cannot and fails 3/3 without the fix.
- [x] **Known limit, not changed:** a recording belongs to ONE Level **[Closed 2026-09-21 — lifted, R169 §10 — an item keeps a home Level and names its OTHER Levels; a private recording of a class over two Levels reaches both]**, so a
      *private* recording of a class addressing two Levels is listed for the
      first Level's beneficiaries only.
- [x] **§5 — the provider's written answers recorded** in
      [provider acceptance](operations/provider-acceptance.md#what-the-provider-has-since-answered-in-writing-2026-09-21-and-what-is-still-open),
      with what is still open (UDP 7882/TCP 7881, the platform, the art. 25
      contract) and what launching without the backup line means. The final
      email to the provider was drafted for the Owner; nothing was sent,
      ordered or paid by this work.
- [x] Harness cleanups no longer hide a failure: `verify-class-filters` and
      `verify-schedule-edit` SAY when `seed-dev-scenario --clean` fails (it had
      been `|| true`, and hid a failed cleanup three times in two days).
      Fixtures and scenario seeds find the classes they own by what they are
      attached to (`test-support/owned-schedules.ts`), not by a title.
- [x] **Hosted CI green on the first push** (`d608fc7` and `c8d86c9`, 8/8 each;
      the seed drill was run locally to exit 0 beforehand). **Deployed to
      Staging at `c8d86c9`** from `886aac6` by the documented pipeline: dump,
      preflight PASS, exact labels, migration applied, `/healthz` 200,
      `/rtc/validate` 401, zero error-level lines, the app's session `UTC`.
      **The Owner's three stranded Staging recordings re-queued with the shipped
      tool and imported**, titled and linked to their session. Their titles read
      one hour early — written before the UTC fix; new ones are right.
- [ ] **For the Owner to try on Staging:** «تعديل الحصة» on one session (its
      audience, Subject, Surah and staff in one save); schedule a class and an
      exam with no «العنوان» and read what they are called; record an online
      class and find it under «التسجيلات»; and open «حفظي» for a مستفيدة whose
      Level teaches تفسير to read her completion.

## SRS Revision 167 — Morocco's clock, recordings never left behind, whole-Category content, «إتمام المستوى» and its certificate, install as an app — 2026-09-21

Owner-reported batch of six. One migration
(`20260922090000_r167_whole_category_content_and_level_completion_mark` — one
column, one table, one sequence; nothing dropped or rewritten).

- [x] **§1 — «العنوان (يُنشأ تلقائيًا)» is shown in «إضافة عنصر»**, read-only and
      live, where the field used to be, with a sentence pointing to «الوصف».
      A preview by the same parts in the same order; the server stays the
      authority on the stored title.
- [x] **§2 — the platform follows the time Morocco actually observes.** The
      host's `Africa/Casablanca` zone file is mounted read-only into `api` and
      `db`; the backend parses it itself, re-reads it when it changes, and no
      backend code may read the process's local clock
      (`check-no-local-clock.sh`). `GET /clock` publishes the offset in force
      and the browser formats instants with it. On Localhost: `/clock` answers
      offset 0 from `host-zoneinfo` while the container's own ICU (2025b) still
      says +01 — the defect, measured.
- [x] **§3 — one «إدارة التسجيلات» dialog** replaces «تسجيل» and «تعديل»: every
      placement, edit/end each, place in another Level.
- [x] **§3 — «إتمام المستوى» is recorded, with BR-11 said in words first.** A
      stored attestation (`LevelCompletionMark`) beside the derived rule, never
      instead of it. Unmet is stated under the Level; marking anyway needs
      `acknowledge_unmet` and is kept as `requirements_met: false` for ever.
- [x] **§3 — the certificate is a second confirmation**, numbered from a
      sequence at first issue; withdrawing hides it and keeps the number.
- [x] **§3 — «شهاداتي»** in the beneficiary portal (child context): the
      certificate at A4-landscape proportions, «تحميل PDF / طباعة» by the
      browser's own print-to-PDF — one page, real Arabic text, nothing stored.
- [x] **§4 — «تثبيت التطبيق»** in the top menu (desktop bar and phone sheet):
      the browser's install sheet where announced, the Share-sheet steps on
      iPhone/iPad, the browser-menu steps on other phones, nothing once
      installed. Manifest, icons and a service worker that caches NOTHING.
- [x] **§5 — a recording for a whole Category.** `whole_category` on the item,
      read through its Level's Category at read time; set by the ingest when
      the class addresses every live Level of exactly one Category, settable by
      staff; «كل مستويات الفئة» shelf on المحتوى التعليمي. One Level otherwise
      (kept, as the Owner decided).
- [x] **§5 — a recording is never left behind.** `session-recording-reconcile`
      every fifteen minutes: asks the provider about recordings whose callback
      never came, believes a staged file where the provider has no answer,
      re-queues every import that has not succeeded — indefinitely — and
      closes a recording the provider positively no longer knows after a day.
      `npm run ops:active-recordings` is asked before a deployment restarts
      the recorder.
- [x] **Declared residual risk (not built):** a recorder CRASH mid-class still **[Closed 2026-09-21 ledger review — closed by R168 §2 — safety segments, assembly, and re-recording after a crash]**
      loses that class's capture. Segmented output uploaded during the class
      would close it.
- [x] **§6 — one registration form for several roles: PROPOSAL ONLY**, **[Closed 2026-09-21 — ratified and built as R168 §1]**
      [`SRS-PROPOSAL-R168.md`](SRS-PROPOSAL-R168.md). Six decisions are the
      Owner's — first, whether administrative staff may ask through the public
      form at all (R49 says no today).
- [x] Harnesses read the class type's NAME from their scenario: the Owner
      renamed «حصة دراسية» to «حصة» on Localhost and two harnesses went blind.
- [x] **Not repaired:** `verify-scheduling-types`, `verify-visibility-ui` and **[Closed 2026-09-21 ledger review — repaired in R168 §4 — harnesses read the live catalogue; none types a name]**
      `verify-exam-scheduling` still type «حصة دراسية» in assertions about the
      SEEDED catalogue; on the Owner's renamed Localhost they will report it.
- [x] **Hosted CI 8/8 on `7655a6b` (first push); deployed to Staging at
      `7655a6b`** by the documented pipeline, from `c8d86c9`. `/clock` there
      answers offset 0 from `host-zoneinfo` (host tzdata `2026c`) while the
      container's own ICU still says GMT+1; the reconciler ran at 11:31 UTC;
      `/healthz` 200, zero error lines. No Production action.
- [ ] **For the Owner to try on Staging:** المستفيدات → «إدارة التسجيلات» (mark a
      Level, read the warning, confirm the certificate); sign in as that
      مستفيدة → «شهاداتي» → «تحميل PDF»; «تثبيت التطبيق» from a phone; schedule a
      class and watch «العنوان» compose; and read any time on screen against a
      clock on the wall.

## SRS Revision 168 — a recorder crash loses nothing, completion is the administration's act, type names are hers to change, the registration form's four roles — 2026-09-21

The Owner's six replies to Revision 167's report. One migration so far
(`20260923090000_r168_recording_recovered_from_segments` — one column).

- [x] **§2 — a recorder that dies mid-class loses nothing recorded.** Every
      recording is requested as a final file PLUS ten-second safety segments
      uploaded while the class runs. Where the final file never arrives the
      reconciler assembles the segments with `ffmpeg` (remux only) into the
      recording's own key, and the ordinary import publishes it, marked as
      recovered. Cost of a crash: at most the last ten seconds.
- [x] **§2 — and nothing AFTER it.** The provider calls a killed recorder
      «active» for ever (measured), so silence of the segments decides. The
      classroom says the recorder stopped; «بدء التسجيل» again — believed once
      storage agrees, ninety silent seconds — retires the dead recording and
      starts a new one.
- [x] **§2 — a recording is as long as the class was.** The UPLOAD caps (100 MB
      audio, 500 MB video) were being applied to the platform's own capture and
      would have refused every audio class over ≈1 h 40 and every video class
      over ≈47 min, permanently. The platform's recording is bounded at 5 GiB.
- [x] A صوت فقط recording is now `audio/mp4` (AAC), not OGG — the segments are
      AAC and one recording has one codec. It also plays on every iPhone.
- [x] Operator commands: `ops:reconcile-recordings`, `ops:recording-segments`.
- [x] **§3 — a Level is completed when the administration records it.** Not an
      exam taken, not an exam passed. «حفظي» and the مؤطِّرة's Quran screen say
      «أتمّت المستوى» only where a mark exists; BR-11's reading is shown as the
      conditions, with what is still missing named.
- [x] **§4 — a scheduling type's name is hers to change.** No application code
      reads a name (audited); the seed never brings an old name back (now
      tested); harnesses ask the platform for the live catalogue. Fresh installs
      are seeded «حصة».
- [x] A failed browser check now fails its run: `finish()` sets the exit code.
      Thirteen harnesses had been exiting 0 over FAIL lines.
- [x] **§5 — the certificate carries no seal.**
- [x] Ledger review: 24 boxes closed with their evidence (20 found already done
      by later sections, 4 resolved by this revision).
- [x] **§1 — one registration form, four roles, each decided separately.**
      RATIFIED by the Owner (administrative staff may ask through the public
      form; asking grants nothing) and BUILT as this revision's second part:
      four checkboxes, none preselected, her identity asked once; «بيانات ولي
      الأمر» only when registering children is all she asked for.
- [x] §1 — each role is approved or declined on its own
      (`POST /admin/approvals/{id}/roles/{kind}/approve|decline`). مستفيدة =
      a placement; هيئة التدريس = مؤطِّرة; هيئة الإدارة = مسؤولة or مشرفة عامة,
      the APPROVER's choice and a Super Admin's decision only; وليّة أمر grants
      nothing (her children stay one decision each). The account is activated
      by the FIRST approval and rejected only when every role was declined.
- [x] §1 — a first-time مستفيدة ranks the memorisation حلقات that suit her,
      offered from SCHEDULED classes of her Category's first Level at her
      branch (`GET /registration/circle-slots`); the approver sees her order
      beside the placement control. A wish, never a seat.
- [x] §1 — طلبات الانضمام names every requested role with its own state and
      offers «البتّ في الصفات المطلوبة» where one «موافقة» has no meaning (the
      server answers `DECIDE_PER_ROLE` there).
- [x] Found while building: three browser harnesses had been red for months
      unnoticed — a date «typed» into the calendar control, a branch list that
      became a dropdown, a date field that left the assessment builder. All
      repaired; `date-picker.mjs` DRIVES the calendar for every harness.
- [x] R160 §8 kept: the self-managed claim has no entry on the form (reached by
      `/register?mode=self-managed`); its harness now asserts exactly that.
- [x] **§1 — not built, and said:** an account that already EXISTS cannot yet **[Closed 2026-09-21 — built, R169 §1 — «طلب صفة إضافية», and a declined role is asked for again by re-opening its row]**
      ask for a further role through a form («a declined role may be asked for
      again» is, for now, the administration granting it from «المستخدمون»).
      Wants the Owner's word on whether it is needed before go-live.
- [x] **§1 — the proposal's five other recommendations were taken as drafted** **[Closed 2026-09-21 — the Owner confirmed three (one notice per decision; a declined role may be asked again; teaching = مؤطِّرة) and asked my view on two, carried in R169's section]**
      (one notification per decision; a declined role may be asked again;
      slots = scheduled classes; a returning مستفيدة is asked nothing more;
      teaching = the one role مؤطِّرة). Each is the Owner's to change.
- [ ] **For the Owner — data, not code:** the ordered circle choice is offered
      from SCHEDULED classes. Today there is no «حلقة» for حفظ القرآن at all and
      no weekly memorisation class. For المرأة · المستوى الأول · مقر تاركة:
      create three حلقات (حلقات المواد → حفظ القرآن), then one weekly class per
      حلقة in الجدولة — الثلاثاء 15:00–20:00, الخميس 09:00–12:00, السبت
      15:00–20:00 — and تفسير on الأربعاء 09:00–12:00 for the whole Level.
- [x] **Hosted CI 8/8 on `072b611` (first push); deployed to Staging at
      `072b611`** by the documented pipeline, from `7655a6b` — the running
      release was asked `ops:active-recordings` first. ffmpeg runs inside the
      shipped image; a reconciler pass is clean; `/healthz` 200; zero error
      lines. The first class type on Staging is already «حصة» (the Owner's own
      rename), and the deployment left it alone. No Production action.
- [x] **Hosted CI 8/8 on `0c6f24a` (first push); deployed to Staging at
      `0c6f24a`** by the documented pipeline, from `072b611` — the running
      release was asked `ops:active-recordings` first. Migration
      `20260923100000_r168_role_requests` applied (no pending registration
      there, so nothing to back-fill); `/healthz` 200; zero error lines; the two
      new routes answer 400 (public, validated) and 401 (guarded) from outside.
      No Production action.
- [ ] **For the Owner to try on Staging** (a session there needs Google
      sign-in): register with a second Google account ticking several choices;
      as Super Admin open طلبات الانضمام → «البتّ في الصفات المطلوبة» and decide
      each role. The circle question appears once the three حلقات and their
      weekly classes exist there (the data item above), and placing a مستفيدة
      needs an academic period covering today (الفصول الدراسية).

## SRS Revision 169 — the Owner's answers to the open-decision list — 2026-09-21

- [x] **§1 — an existing account asks for a further role, and again for a
      declined one.** «حسابي» → «صفاتي وطلباتي» → «طلب صفة إضافية»: the
      registration form's own role sections, one role at a time.
      `GET|POST /profile/role-requests`. Re-opens the same row; grants nothing;
      the decline reason never reaches her. The queue marks such an item
      `account_active` and offers the per-role review only.
- [x] §1 — registering a child re-opens a declined guardian request.
- [x] **§2 — a granted role needs no new sign-in.** Already true; now proven by
      an HTTP test and said on «المستخدمون».
- [x] **§3 — room capacity** published, editable, shown beside the room when
      scheduling. Informational only.
- [x] **§4 — a cancelled class is not named as where a content was used.**
- [x] §5 — answered with nothing to build: Admin sees branch names; the server
      already obeys the active role; descriptions already exist; one notice per
      decision; teaching = the one role مؤطِّرة.
- [x] Ledger: eleven boxes closed with their evidence (six were stale).
- [x] **Part two — audience rules (the Owner: YES to both) — BUILT, R169 §6/§7:** activities combine
      their audience dimensions as classes do (the notification, attendance and
      personal-filter reads ALREADY intersect; the teacher's visibility filter,
      `teacherEventScope` and the calendar grid's scope filters still union, and
      the form still says «لم تُختَر جهة بعد» where a class says «الكل»); and a
      class addressed to «الكل» on Level, group AND circle = every Level that
      teaches its Subject at its branch(es).
- [x] **Part three — BUILT, R169 §8: the Trash restores a Subject circle, a class schedule and
      a Level** (the Owner: build). A Level's event-audience joins are hard-
      deleted today; they must be snapshotted from now on.
- [x] **Part four — BUILT, R169 §9: a date of birth for every beneficiary** (the Owner: fill the
      gaps so it can be mandatory). To be built with a MARKER on a filled date:
      a placeholder that looks real would drive the 18-year rule (R132) for a
      child, and «completion, never correction» would stop anyone fixing it.
- [x] **Part five — BUILT, R169 §10: a recording or content item belonging to several Levels**
      (the Owner: do it if it can be done). It can; it is a join table and a
      wide read-side change (library predicate, consent re-evaluation, DTOs,
      the content form).
- [x] **Part six — BUILT (the half the application can see), R169 §11: the administrator's operational alert read** (the Owner:
      yes). Job failures and queue lag can be read from PostgreSQL now; backup
      failure and TLS expiry live on the HOST, which the API container cannot
      see — they need the host monitor to write its status where the API reads.
- [ ] **Automatic grading components (the Owner: build).** NOT started, and said
      why: the SRS lists the grading-template engine as «not present by design»
      (§10.1, §20 rule 16 — «do not pre-create»), and it has no tables, weights
      or screens specified to the point of building. Needs a proposal first.
- [x] **For the Owner — her questions back to me, answered in the report:**
      slots from scheduled classes (keep); a returning مستفيدة asked nothing
      more (keep, with one optional line for «مستواي السابق»).
      **[Closed 2026-09-21 — the Owner: keep both as they are (R170 §14).]**
- [x] **[Answered by the Owner, 2026-09-21 — every item is now a box of its own
      under Revision 170 below; three stay open there.]** **Owner questions still open** (each one sentence, in the report): the
      adult-Category marker; a spoken reference code for every beneficiary;
      schedule history in the Trash; retention of old reference rows; automatic
      destruction of quarantined files after 90 days; the login audit's e-mail;
      exact storage keys in the audit; free text in the audit; whether a
      guardianship document is checked and recorded; a refused applicant's
      right to the real reason; the three sensitive fields for minors; the
      CNDP filing and the Arabic privacy notice's TEXT (hers to supply).
- [x] **R111 SRS reconciliation — document work, not code:** **[Closed 2026-09-21 — §5.2's Profile bullet no longer says «no deletion control ships» (it names R111's control, R133's seven days and the purge job), and TD-7 lists `trash.retention-purge`, `application.retention-purge` and `registration.rejected-purge`, all built long ago and absent from the table]** the account purge
      job EXISTS (`trash.retention-purge` → `deIdentifyAccountSystem`) and the
      window is SEVEN days, but §5.2/§14.1 still call account deletion
      unapproved and TD-7 lists no such job. To be reconciled in the SRS.
- [x] **Hosted CI 8/8 on `6d7f2c1` (part one); deployed to Staging at
      `6d7f2c1`** from `0c6f24a` — the running release was asked
      `ops:active-recordings` first; no pending migration; `/healthz` 200; zero
      error lines; `GET /profile/role-requests` answers 401 without a session.
      My first attempt started BEFORE the CI run had finished (I misread my own
      log line); the host preflight refused — the images were not published
      yet — and nothing on Staging changed. Redeployed once CI was green.
- [x] **Hosted CI 8/8 on `8d87feb` (part two); deployed to Staging at
      `8d87feb`** from `6d7f2c1`. The host preflight refused first: Docker's
      disk had 19 GiB free against the approved 20 GiB floor — seven releases'
      images had piled up. The five oldest UNUSED release images were removed
      (re-pullable from the registry; the running release and its predecessor
      kept) → 23 GiB free, preflight PASS. `/healthz` 200; zero error lines.
- [x] **Hosted CI 8/8 on `aa9e879` (part three); deployed to Staging at
      `aa9e879`** from `8d87feb` — recordings asked first; one older release
      image removed (running release and predecessor kept), 22 GiB free;
      no pending migration; `/healthz` 200; zero error lines.
- [ ] **For the Owner — data, not code (R169 §9):** the beneficiaries whose date
      of birth was never recorded now read «غير مسجَّل» and carry the marked
      placeholder: 3 on Localhost, 9 on Staging. Recording the real date from
      «المستخدمون» (or each from her own «حسابي») replaces it once. A filter
      «بلا تاريخ ميلاد» on «المستخدمون» is NOT built — say if it is wanted.
- [x] **Hosted CI 8/8 on `ede0770` (part four); deployed to Staging at
      `ede0770`** from `aa9e879` — recordings asked first; one older release
      image removed; migration `20260924090000` applied: 9 records marked, none
      left without a date; `/healthz` 200; zero error lines.
- [x] **Two browser harnesses were RED on Localhost, not caused by this
      revision — both settled the same day.** `verify-library-recorder` check 10
      was STALE: it asserted that an unset page filter REFUSES the recorder,
      which `c393425` removed on purpose (a filter is not a precondition; the
      recorder asks for its scope itself). Restated → 16/16.
      `verify-content-scope` «the LIBRARY RESULTS change» read the table 0.9 s
      after choosing a Level while the machine was running the integration
      suite; alone it passes 14/14. Its detail now prints its numbers.
- [ ] **§11's other half — backup freshness and certificate expiry on «حالة
      النظام».** They live on the HOST; the API container deliberately cannot
      read the backup repository or `/etc/letsencrypt`. Needs the host monitor
      to publish its status where the API may read it (a read-only mounted
      file, or a row it writes), and a certificate-expiry check, which exists
      nowhere yet. Infrastructure, for the go-live runway.
- [ ] **«حالة النظام» sits LAST in الإدارة** — appended to the Owner's R105
      sequence, not placed by her. Hers to move.
- [x] **Found by «حالة النظام» on its first reading, and fixed:** an orphan
      cron schedule (`retention.educational-purge`, retired by R133) was still
      creating a job every night that no worker could take — nine «late» on
      Localhost. The worker now retires, at start-up, every schedule this
      release does not own. Staging never had it.
- [x] **Hosted CI 8/8 on `439f1ba` (part five) after re-running ONE job** — the
      «Production smoke» job had failed on a Docker Hub registry timeout (exit
      125), not on code. **Deployed to Staging at `439f1ba`** from `ede0770`;
      migration `20260924100000` applied; `/healthz` 200; zero error lines.
- [x] **Hosted CI 8/8 on `028d597` (part six); deployed to Staging at
      `028d597`** from `439f1ba` — recordings asked first; no pending
      migration; `/healthz` 200; zero error lines. «حالة النظام» there shows 3
      failed jobs (history) and 0 late.
- [ ] **For the Owner to try on Staging (R169):** «حسابي» → «طلب صفة إضافية»;
      «الفروع» → «القاعات» → سعة القاعة, then schedule a class in that room;
      a class with Level, group and circle all left at «الكل»; delete a حلقة
      with no class and restore it from «سلة المحذوفات»; «مكتبة المحتوى» →
      تعديل → «مستويات أخرى ينتمي إليها»; and «حالة النظام».
- [ ] **AUTOMATIC GRADING COMPONENTS — the Owner said «build this»; NOT started,
      and the reason is hers to weigh.** It is the weight-template engine she
      herself postponed to after launch (R12/R13, «deadline protection»; §10.1
      «do not pre-create»): weighted averages, a Draft↔Active template per
      Level with a 10,000-point gate, a recalculation job, frozen «stale»
      averages, and averages shown to students. Today every grade is a
      per-exam mark and no average is shown anywhere. The largest feature left.
      ONE question: is it wanted BEFORE launch?

## SRS Revision 170 — the Owner's third batch of answers — 2026-09-21

- [x] **§1 — «صفاتي وطلباتي» is ALWAYS on «حسابي».** The Owner could not find
      it: her account holds every role and never registered, so nothing was
      askable, nothing was listed, and the section rendered nothing. It now
      names the roles held (`held[]` on `GET /profile/role-requests`), says why
      there is no button when nothing is askable, and shows a failed read as a
      failure. Rule BG.
- [x] **§2 — the registration form redesigned.** «ماذا تريدين؟» is one closed
      multi-select with «أسجّل نفسي كمستفيدة» chosen (reverses R168 §1's
      «nothing preselected», at her word); three steps said first; numbered
      section cards; two columns on a wide screen, one on a phone; required
      before optional, the optional block said once per person. No field or
      request key changed. Five harnesses moved onto `role-chooser.mjs`.
- [ ] **§3 — the consent gate becomes a WARNING** (nothing forced, default
      public, staff switch to private themselves). Reverses BR-2/BR-3.
- [ ] §4 — editing an already-scheduled remote session's arrangements.
- [ ] §5 — a مؤطِّرة's list shows her activities with her classes.
- [ ] §6 — Category tick-box «its beneficiaries hold their own login» + an age
      range, on «الفئات»; the enrolment picker then stops offering everybody.
- [ ] §7 — a spoken reference code for EVERY beneficiary, adults included.
- [ ] §8 — a deleted class keeps its past sessions visible in the Trash for the
      same window as everything else.
- [ ] §9 — a closed branch, room or subject still pointed to by old records is
      kept for ever; deletable only once nothing points to it.
- [ ] §10 — quarantined files destroyed automatically after 90 days.
- [ ] §11 — a refused applicant MAY be told the real reason (optional, the
      approver's choice each time).
- [ ] §12 — recorded, nothing to build: no guardianship-document check; health,
      family situation and home address are NOT collected for minors.
- [ ] §13 — CNDP filing material and the Arabic privacy-notice TEXT, drafted for
      the Owner's review.
- [ ] §15 — run the performance measurement (TD-11a).
- [ ] §16 — start the §18 acceptance checklists and journeys J1–J8 on Staging;
      prepare for Production whatever needs neither its server nor a payment.
- [ ] **Still the Owner's, one sentence each:** the login audit — keep the
      e-mail, or the user id only? (her answer named both); exact storage keys
      vs a non-reversible id in the audit; free text vs fixed codes in the
      audit; and whether the automatic grading components are wanted BEFORE
      launch.
