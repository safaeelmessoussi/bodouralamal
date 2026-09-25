[Documentation](../README.md) › [Development](README.md) › **Testing**

# Testing

Four layers, each testing something the others structurally cannot.

| Layer | Scope | Tooling | Gate |
|---|---|---|---|
| **Unit/default** | Services: interval merge, state machines, consent evaluation, time and DST logic, Arabic normalization | Vitest | CI on every push/PR |
| **Integration** | Repositories against **real PostgreSQL**: constraints actually reject bad writes, partial indexes, native collation ordering, soft-delete filtering | Vitest + a real stack | CI on every push/PR, disposable stack |
| **API** | HTTP integration tests against the contract; child-context tests; envelope conformance | Vitest + real Nginx/API/pg-boss | CI on every push/PR, disposable stack |
| **Browser/E2E** | Journeys, RTL rendering, mandatory UI states, upload retry | Chrome over CDP | Targeted harnesses; the public-reader path is required by disposable integration CI, other journeys are operator-run |

- Coverage **≥ 80 % on services and policies**; no gate on generated or boilerplate code.
- Exact test totals belong to each verified commit's [CHANGES entry](../CHANGES.log) and hosted run, never a second inventory here.
- Integration tests run **serially** (one shared database); the integration job provisions an isolated real stack, never Local Development.
- Both package builds include a compiler pass and CI keeps the named exact-typecheck step: types get their own gate, the build verifies emission and bundling.
- Backend default suite: deterministic worker-readiness regressions (injected clock and pg-boss live-worker view: startup failure, incomplete registration, lost/stale workers, long-running handler); controller tests prove a healthy database plus a present `pgboss` schema cannot make `/healthz` green when the runner never started.
- The shared HTTP helper returns `res.headers`: the calendar bootstrap's `Cache-Control`/`ETag` are contract.

## Running them

Focused tests while editing; the full established gates once at the coherent boundary; bounded timeouts; diagnose a stall, never retry blindly. Repository root unless stated.

| Purpose | Command |
|---|---|
| Focused unit | `npm --prefix frontend test -- src/pages/calendar.test.tsx` · `npm --prefix backend test -- src/lib/health.test.ts` |
| Package gates | `cd backend && npm run lint && npm run typecheck && npm test && npm run build` · `cd frontend && npm run lint && npx tsc --noEmit -p . && npx vitest run && npm run build` |
| Guards | `for g in scripts/ci/check-*.sh; do bash "$g" \|\| exit; done` (incl. `check-doc-links.sh`) |
| Integration, disposable stack | `FFMPEG_PATH=/usr/bin/ffmpeg bash scripts/ci/test-integration.sh src/controllers/calendar.http.integration.test.ts` (focused) · same with no path (full, incl. the public-reader browser gate) |
| Seed drill | `PRODUCTION_SEED_DESTRUCTIVE_FIXTURE=1 bash scripts/seed/verify-production-seed.sh` — seeds twice, runs every scenario seed and `ops:remove-fixtures` |
| Browser acceptance (own stack) | `bash scripts/dev/browser/verify-platform-owner-framing.sh` |
| Production-mode bootstrap drill | `bash scripts/deploy/verify-production-bootstrap.sh` — real images, Production overlay with synthetic secrets, seed twice + row diff, synthetic TLS + `nginx -T`/HSTS/CSP, headless Chrome on the built RTL routes, worker drain across SIGTERM, restart of every container over stateful volumes, encrypted recovery point → destroy volumes → restore → `/healthz`. Repository-side evidence only (no GHCR, no public cert, no VPS budget) |
| Host preflight (read-only) | `BODOUR_RELEASE_TAG=<40-char-sha> bash scripts/deploy/preflight-host.sh production bodouralamal.com <public-ipv4> <min-free-GiB>` |
| Backup drill | `bash scripts/backup/verify-backup-restore.sh` (disposable volumes + local encrypted repository) |
| Screenshots | `bash scripts/dev/browser/shoot-pages.sh` |

`scripts/dev/test-integration.sh` and most operator harnesses write to the **configured dev stack** — not safe on an Owner-populated Localhost without authorization. Nothing here deploys or cleans live data.

### B8 same-VPS backup and recovery

Owner authorizes same-VPS encrypted storage temporarily, **not VPS-loss DR** ([recovery](../operations/recovery.md)); no application, schema, API or job-catalog change. No timer installed, no external host, no live dataset; drills remove only their uniquely named resources.

| Check | Proved | Figure |
|---|---|---|
| `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/backup -p 'test_*.py'` | Missing/mismatched repository, project or image identity fails closed; green worker counts hide neither retirement failure nor an unknown copy | 12/12 |
| `scripts/backup/verify-backup-restore.sh` | Raw and logical-dump restore, object/config bytes, container identities, low-space/wrong-key/overlap refusal before outage, durable repeated failures, a corrupted **data** pack located through restic (a first-listed pack may hold tree blobs and fail in `create` instead) fails verification without pruning, repaired retry, two project generations, foreign-project preservation, monthly skip, foreign-snapshot refusal **before target creation**; restore waits for real data-service health | pass, 150 s |
| `scripts/deploy/verify-production-bootstrap.sh` | Frozen source (SHA-256), Production-mode graph, read-only operator command before/after raw rollback; a synthetic future-due unknown-copy row is reported despite healthy workers, then removed before final health | pass; 96/96 migrations; browser 15/15 |
| `scripts/storage/verify-storage-lifecycle.sh` | Own disposable volumes; whole staging-prefix catalog, strict 48-hour boundary, canonical objects survive; purge with the queue removed rolls back; real worker with a lost first `DeleteObject` retries, both exact leftovers go, a newer key under the same content UUID stays; a stale quarantine job removes the late copy only. Automatic `purge_after` destruction asserted **absent** (Owner decision pending) | 5/5 |
| Guards | 30 non-link guards; OpenAPI/TD-3 226/234 (eight pending, zero undocumented); systemd template validation; one-second utility timeout with exact cleanup; templates never installed | pass |

## Why integration tests use a real database

The properties do not exist in a mock: does the partial unique index reject the second row, does `ar-x-icu` order Arabic, does the transaction roll back, does the presigned signature survive the proxy.

| Suite | Pins |
|---|---|
| R115 identity/framing matrix | Owner singleton and triggers; owner-only transfer with two concurrent targets; first verified Google binding, no fabricated subject; bootstrap/rerun; strict هيئة التأطير one/multiple/all/online framing; deferred constraints; read-only post-approval projection; per-window mode; legacy-null/modality warnings. Fixtures restore singleton, User version counters and owner id |
| Calendar/Hijri | Reserved test-only Hijri years **and** remote Gregorian dates (lookup is Gregorian-timeline based); never 1447/1448; teardown by those coordinates only |
| B-01 safeguarding (19) | Real PostgreSQL/MinIO/pg-boss: read before withdrawal, denial while migration pends, full-stream SHA-256, write-only public staging, R92 audience changes, retained Sessions, bounded discovery, lock graphs, monotonic re-grant, exact key obligations, ambiguous storage response, duplicate/stale jobs, retry, restart, terminal failure, CAS; real Nginx method allowlist, S3 Select/WebDAV denial, signed vs unsigned PUT, bucket-root denial, fail-closed path normalization; never deletes the consent backlog |
| Storage proxy P0.1 | An unsigned bodyless request with the vendor-named unsupported content-hash mode gets the Nginx-only marker, then a real presigned PUT/GET round trip |
| B-02 placement | `EducationalContent.visibility` is the authority: real row, both buckets, real Nginx; new/replacement/manipulated visibility, contradictory pre-fix ticket, anonymous reads, `SessionContent`, recording origin; cleanup owns exact keys incl. quarantine |
| B-03 finalization (50/50; 86/86 with upload HTTP and R99 ingest) | Presigned PUT, strict HEAD, one staging GET, magic/length, SHA-256, re-hashed canonical PUT; collision fixture = equal-size PDFs, equal MD5, different SHA-256; staging replaced after the source GET opens → canonical/audit match the opened snapshot; truncated source → no row/object, retryable; barriers: same ticket → one row/audit/object, different tickets → one winner + `VERSION_CONFLICT`; `PutObject`/audit/`DeleteObject` failures; stop after canonical PUT reuses one object; replacement without `replaces_version` rejected |
| `trash-lifecycle` | Real `RESTRICT` graph: owned-child ids snapshotted, an independently deleted child not swept, no stale Trash after leaf purge or unique-pair revival |
| `email-ownership` | Production `lockNormalizedEmail`, no mutex, no sleeps: an early onboarding token cannot create a second account and stays unconsumed; case-varied double arrival → one owner, one conflict; registration-first blocks pre-provisioning; forced failure rolls back ownership and lock row. Lock rows have no User FK, so suites delete their own |
| `session-recording-ingest` | Real SeaweedFS, fault only at the selected `DeleteObject`: canonical row/object exist while staging remains, `ingestion_failure_reason` null; retry deletes only that key; real temporary pg-boss queue: durable `retry`, worker restart, terminal `failed` with the error in output, production limit → five executions (delay only removed) |
| `session-recording` | Fake provider on purpose: *who may record* fails for authorization, never for an unreachable media server; only `verify-livekit-join.sh` proves media |
| R111 final erasure | Concurrent with teaching-profile replacement, safeguarding upsert, notification delivery and upload initiation at the User lock: no satellite for the tombstone in either order; deletion-first mints no upload authority |
| `visibility-matrix.http` (35/35) | Three tiers × نشاط/حصة/امتحان × thirteen callers; direct-by-id **404, never 403**; management list un-gated; a WARNED public recording served, warning to staff only (R170 §3); R91 dated ownership |
| `notification.http` + `notification-targets.http` + `event-staff` (74/74) | R116 four-target CHECK, account-safe DTO, exact recipients, idempotency, remove/re-grant, reconciliation, R109 withdrawal (Session → teacher, Event → responsible, Exam → supervisor) |
| `journey.integration.test.ts` | Admission-to-achievement over real routes, beside `business-scenario` (teaching steps), two shared entities. Found `publishAssessment` notified nobody (R116 wired physical, R124 built online on the same `Exam` row): a composition question needs a composition test |
| `abandoned-fixtures.integration.test.ts` | Sweeps rows older than `ABANDONED_AFTER_MS` under `RUN_UNIQUE_FIXTURE_PREFIXES` (both), never force-deletes FK-held rows, asserts nothing aged survives and a fresh same-shape row does |

## Test the property, not the path

> ❌ *"The service calls `checkPermission` before returning."* ✅ *"A teacher requesting another teacher's student receives `404`."*

- The first passes when the check is refactored into something broken; the second fails.
- Examples: mid-transaction process kill persists nothing · suspended teacher denied a presigned mint inside the token window · a stalled cache row repaired by the read guard · two concurrent enrolments at capacity − 1 admit one · every path resolves to a page (would have caught `/dashboard` rendering blank).

## Assert the exact key set, not the presence of the fields you wanted

```ts
expect(Object.keys(res.body).sort()).toEqual(BRANCH_KEYS);
```

- Not `toHaveProperty` per field: the guarded failure is a field **arriving** that nobody chose (R38: `GET /admin/branches` returned raw Prisma rows for months with every test green and no HTTP-level test).
- [`check-contract-dto.sh`](ci-cd.md#guards-scriptscicheck-sh--each-proven-by-reintroducing-its-bug) makes the projection exist; the test makes it correct.

### The client half of the same guard

- `api<T>()` is an unchecked cast ([adapter layer](../architecture/frontend.md#the-unchecked-cast-under-this-whole-layer)): a wrong adapter type compiles, passes fixtures built from itself, fails only in a browser.
- Counterpart: a fixture literal typed as the adapter's interface with the server-pinned key set — `const WIRE: HijriMonthRow = { hijri_month: 1, month_name_ar: 'محرم', /* all six keys */ };` — so a renamed field fails typecheck. Example: `pages/admin/hijri-calendar.test.tsx`.

## Driving a real browser, on real authenticated screens

- Vitest renders with `renderToStaticMarkup` (no jsdom, layout, events, fetches); no Playwright (§3.1a). Harnesses drive the installed Chrome over CDP with Node's built-in `WebSocket`; `scripts/dev/browser/cdp.mjs` is the shared client.
- Only `verify-public-reader.mjs` runs in CI; the rest need a live stack, Chrome and a development database and report in the slice that ran them.
- Address a control by what it **is**: `catalogue.mjs` (scheduling type by kind and attendance mode, R168 §4), `date-picker.mjs` (`pickDate`: trigger → year → month by position → day), registration `data-role-choice`/`data-role-section`/`data-circle-ranking`/`data-ranked-circle`.
- Source-text tests cannot see `busy` mapped to `disabled`, or `value=''` with no matching `<option>` showing the first option (عام) for `null`. When the property is what a person sees or can do, the test is a browser; `verify-content-visibility.sh` reintroduced both defects. A suspected third (an effect overwriting a choice) could not be demonstrated: guarded, but no check claims it.
- Localhost runtime is separate evidence: the dev overlay bind-mounts `frontend/dist` but `api` runs baked code, so a new SPA can call an old API and `/healthz` proves dependencies, not freshness. Compare the running build with the checkout before changing authorization; with Owner approval refresh only the API (`build api`, `up -d --no-deps --wait api`, dev overlay, no migrations or seeds), verify in fresh Chrome. Disposable fixtures never prove the Owner's runtime was refreshed.
- No source suite sees a CSP: `connect-src 'self'` blocked R98's classroom; the pre-upgrade validation request is plain HTTP and raises no `securitypolicyviolation`, so **both** schemes are in `nginx/snippets/media-origin.conf`.

### Testing the Google identity boundary without trusting a fixture token

- No live Google, no payload decoding as validation: ephemeral RSA keypair, locally signed deterministic ID tokens, injected provider-certificate response, the real Google Auth Library verifier.
- Matrix: valid, invalid signature, expiry, wrong issuer, wrong audience, malformed/unsupported headers, unknown key, missing identity claims, unverified email, certificate retrieval failure.
- The code exchange has a narrow verifier seam exposed only to tests; a callback test with a valid signed flow-state cookie and PKCE verifier rejects a decodable forged token before account resolution. No seam grants a role.

### Getting past the login wall without bypassing it

- `/admin/*` needs a session and the only issuer is Google OAuth (§4.1b). `scripts/dev/issue-dev-session.sh` calls **`issueNewSession`** (the callback's own path) and prints the raw `bodour_refresh` value (`Path=/api/v1/auth`, TD-12, R101). Authorization is untouched; only the provider is replaced, only in a development database (refuses non-loopback `DATABASE_URL` and `NODE_ENV=production`).
- `bash scripts/dev/issue-dev-session.sh` → its own `super_admin`; `… <user-uuid>` → that user **as they are** (grants nothing).
- Cookie set with the real attributes incl. `Secure` on `http://localhost` (deliberate exception; never weaken). Local edge is HTTP-only and loopback-only on `127.0.0.1` and `[::1]`; harnesses probe both families (an IPv4-only edge refuses a later full-page navigation; a dead 443 gives a TLS reset; the Compose guard pins the port boundary).
- Auth HTTP coverage: refresh rotates first, logout receives the successor, chain revoked, retained copy refused, another device still rotates, repeat/missing-session logout idempotent, cookie cleared with matching Path/attributes.
- R101 races use barriers on the real session lock, never sleeps: both identify/lock orders; refresh paused after rotation → `401`, no credential; purge race before/after successor insertion; forced mandatory-audit failure rolls revocation back, success commits revocation + `auth.logout`.
- User-lock races: suspension-first → callback re-reads Suspended, redirects to the deactivated contract, mints nothing; login-first → suspension revokes the new anchor plus two older sessions; an unrelated login completes (lock not global); forced `auth.login` audit failure rolls back anchor and token; `FOR NO KEY UPDATE` removes the FK-lock cycle (successor's implicit User FK `KEY SHARE`); suspension-vs-first-binding in both orders.
- Active-role: bearer minted 50 min in the past, switched twice, `exp` never later; suspension and deletion refuse switching. Pending → Rejected returns no credential; a Pending control still rotates; reactivation never reverses revocation. Durable revoke-all on Pending → Rejected remains an Owner decision (TD-4.15 lists only suspension and deletion; no rejection reason value).
- The R101 rollout test executes the data-migration SQL inside a rolled-back transaction.

### The scenario the browser reads

- `scripts/dev/seed-dev-scenario.sh`: المرأة — وميض الأمل · تفسير · كل اثنين 15:00–17:00 · تاركة · القاعة 5 · صفاء (أستاذة) · أمينة (مساعدة) · مستفيدة مسجّلة · مستفيدة غير معنية (the control); ids printed as one JSON line.
- Occurrences come from **`materializeSchedule`** incl. the R43.4 staffing snapshot; the class sits on a live academic year.
- Rows tagged `[dev-scenario]`; `--clean` removes exactly those; idempotent; same guards as the session script; nothing in CI calls it.

## Browser harnesses

All under `scripts/dev/browser/` (`.sh` wrapper + `.mjs`); fuller descriptions and the last complete sweep in [qa-inventory](qa-inventory.md#browser-harnesses-that-exist-today). «—» = no run figure recorded.

| Harness | Proves | Last run |
|---|---|---|
| `measure-page-header.sh` | Primary action stays put as the description grows, nine widths | 9/9 widths |
| `shoot-pages.sh` | A look, not a check (`design.mmd` §13): 13 surfaces at 390/1366 px into `scratch/shots/`, flags sideways overflow | 13, none scrolls sideways |
| `verify-academic-periods.sh` | R122 الفصول الدراسية create; جارٍ from dates; year as text (rule AF) | 4/4 |
| `verify-account-deletion.sh` | R133 one deletion, Trash as recovery, three withdrawn workflows absent; read-only | 20/20 |
| `verify-admin-navigation.sh` | R105 menus as rendered (Admin: no الإدارة heading); cookie transport regression (Back/Forward, reload, re-login, consumed callback, fresh tab); real Admin bearer vs server; R61.2 reads kept beside refused writes | 42/42 |
| `verify-approvals-sorting.sh` | NEW C طلبات الانضمام reorders; three tagged applicants whose name and submission orders are neither equal nor reversed | 7/7 |
| `verify-assessment-library.sh` | A created paper is found after navigating away and back; fixture = journey suite | stale since R136 §2 (24/31) |
| `verify-assessments.sh` | R124/R125 builder: draft saves, target picker names her own student, إرسال asks then locks | 6/6 |
| `verify-attendance.sh` | R123/R163 §3: public calendar offers «الحضور» to nobody; management roster marks حاضرة; عطلة offers none | 6/6 |
| `verify-authenticated-login.sh` | Landing and `/api/v1/auth/google` in both session states; authenticated lands on her dashboard server-side | — |
| `verify-calendar-filters.sh` | AL a filter survives the view switch (controls, URL, other view's request) | 11/11 |
| `verify-calendar-header.sh` | AJ/AK geometry at 1440/390 px, title drift, dual-date order | 19/19 |
| `verify-calendar-surfaces.sh` | AO five calendar surfaces, one contract matrix | 23/23 |
| `verify-circle-branch.sh` | R172 §15 circles carry and filter by branch (`?branch_id=`) | 10/10 |
| `verify-circles-reorder.sh` | R78.1 حلقات المواد drag and ↑/↓ persisted; by seeded id | 9/9 |
| `verify-class-filters.sh` | R163 §5/R165–R167 five-filter class form, server-composed name, «السور», split editor, journeys C (`200`, one class) and D (one `PATCH /sessions/{id}`) | 20/20 |
| `verify-consent-disclosure.sh` | `[hidden]` hides by computed style (rule AG), legend spacing, wording = `GET /registration/consent-text`, 360 px | 19/19 |
| `verify-content-scope.sh` | NEW D مؤطِّرة: admin routes 403, `/me/scope-options`, Level narrows المادة to `subject_ids`, results change, rule AX | 14/14 |
| `verify-content-visibility.sh` | §14.1 selector operated; `/uploads/initiate` carries `visibility: "private"`; no «استبدال الملف»; real upload removed | 24/24 |
| `verify-cross-branch.sh` | R91 × R92 six identities on one combined occurrence | 16/16 |
| `verify-date-picker.sh` | The one date picker on DOB, R122 periods, R124 builder, R58 exam date | 24/24 |
| `verify-delivery.sh` | R97 حضوري/عن بُعد; `ADMIN_COOKIE` vs `ADMIN_API_COOKIE`; throws on «ليست لديك صلاحية» | — |
| `verify-dialog-states.sh` | AG closed/open/close/reopen on 15 pages, scroll ownership | 110/110 |
| `verify-effective-staffing.sh` | R91 replacement as four identities, per-date occurrences | 13/13 |
| `verify-enrolment-gender.sh` | R79 six person-shapes + R27/BR-21 Level narrowing | 17/17 |
| `verify-enrolment-save.sh` | حفظ on تسجيل مستفيدة sends two `201`s (enrolment + circle); owns its fixtures | 4/4 |
| `verify-enrolments-dialog.sh` | R167 `GET /clock`, «إدارة التسجيلات», «إتمام المستوى» naming BR-11 gaps, `acknowledge_unmet`, certificate as the student, PDF portal, installable manifest | 24/24 |
| `verify-error-experience.sh` | Rule AZ: expected `401` seen and silent, offline `TypeError`, real 429 on a production edge, branded 404; detects the edge | 7/7 |
| `verify-exam-scheduling.sh` | R136 sitting from الجدولة, `?source=&mode=` prefill, paper-less physical named by the server (R166 §3), three widths | 92/92 |
| `verify-grading.sh` | R81 own maximum, empty ≠ zero, publish notifies, draft silent | 16/16 |
| `verify-guardian-child.sh` | R96.1 switcher: each child's `user_qr_ref`; forged child and revoked FamilyLink refused | 12/12 |
| `verify-hijri-baseline.sh` | Umm al-Qura import fills, a second import skips twelve; clicks only once its test year shows; teardown removes derived `source` | 5/5 |
| `verify-journey.sh` | Admission-to-achievement screens; fixture = journey suite (`JOURNEY_KEEP=1`, `journey-fixture-ids.ts`), cleaned from a `trap` | — |
| `verify-legal-pages.sh` | NEW P `/privacy`, `/terms` signed-out, OWNER-INPUT markers | 8/8 |
| `verify-level-subjects.sh` | «مواد المستوى» bounded reads, Subjects listed, edit saves without `DUPLICATE` | 7/7 |
| `verify-library-recorder.sh` | Recorder's second entry in مكتبة المحتوى, measured sort indicator | 16/16 |
| `verify-livekit-ingest.sh` | R99 C2 record → Egress → import → plays (`readyState >= 2 && duration > 0`); URL `/storage/` not `recordings-staging`; starter's tab closed; staging swept (R99.13) | 28/28 |
| `verify-livekit-join.sh` | R98 real `livekit-server --dev`, fake devices, three-party room across tabs, `data-connection`, media bytes via `list-bucket.mjs` | 61/61 |
| `verify-nav-toggle-geometry.sh` | R138 item 8 sidebar toggle at 320/390/1280/1440; empty-module portal | 46/46 |
| `verify-notifications.sh` | R77/R82/R83 audience through `/notify`: the resolver, not the button; ids from `GET /admin/course-schedules/{id}/sessions` | 22/22 |
| `verify-notify-ui.sh` | Clicks «إرسال الإشعار», reads the recipient's own bell; R91/R92, Event delete/cancel, grade republish | 37/37 |
| `verify-occurrence-details.sh` | AT one details dialog from four calendars; walks to the scenario's month by ARIA label | 13/13 |
| `verify-operations-status.sh` | R169 §11 «حالة النظام»: anonymous refused, five counts, no payload/key on screen | 8/8 |
| `verify-partners.sh` | NEW N «شركاؤنا» absent without a visible partner, present with one | 1/1 + 3/3 |
| `verify-platform-owner-framing.sh` | R115 on its own disposable stack: framing choices, approval, per-window modes, Owner controls withheld, transfer, former owner's bearer rejected, exact DB rows | 23/23 + 8/8 DB |
| `verify-portals.sh` | AP three portals, one frame; R87 §M gates «إدخال حفظ المستفيدات» | 25/25 |
| `verify-public-calendar.sh` | قائمة/تقويم anonymously; no name, notification, recording or cancellation reason; R83 with `include_cancelled=true` | 18/18 |
| `verify-public-reader.mjs` (CI, owned by `scripts/ci/test-integration.sh`) | Anonymous media bytes through Nginx, playback, content↔occurrence links, protected-coordinate refusal, role calendar transitions, `calendar-geometry.mjs` 320–1280 px; Chrome + ffmpeg required | 193/193 |
| `verify-quran-entry.sh` | Section C إدخال الحفظ as ten identities; R88 grants nothing; R91/R92; forged Surah refused | 24/24 |
| `verify-recorder-crash.sh` | R168 §2 recorder SIGKILLed: segments every 10 s, provider still «active», re-offer after 90 silent s, `recovered_from_segments` via `ffmpeg`; ~15 min, no clock switch by design | 14/14 |
| `verify-recorder.sh` | R75 real `MediaRecorder` (fake device): lifecycle, « 2» numbering, bytes in MinIO, library row; API not stubbed | 22/22 |
| `verify-registration.sh` | R117/R168 §1/R170 §2 family journey via `role-chooser.mjs` and `date-picker.mjs`, Super Admin review from the bell, stale id → unavailable | 45/45 + 12/12 DB |
| `verify-reorder.sh` | R76 five screens: header sends `sort_by`, drop survives reload, handle explained | 30/30 |
| `verify-role-requests.sh` | R168 §1/R169 §1/R170: four roles, scheduled circles ranked, per-role review, first approval activates, Super Admin places; re-ask after decline; `[r168-roles]`; one session per sign-in | 85/85 |
| `verify-room-capacity.sh` | R169 §3 capacity refused in words, saved, kept, cleared | 8/8 |
| `verify-schedule-edit.sh` | «تعديل العنصر» hydrates; «نهاية التكرار» via the real picker; `teaching_mode`/`target_id` untouched | 13/13 |
| `verify-scheduling-types.sh` | R110 catalogue in stored order, picker offers only catalogue rows, notice follows the flag; no name typed (R168 §4) | 11/11 |
| `verify-self-managed-claim.sh` | R132/R160 §8 claim only via `/register?mode=self-managed`; pending claim, nothing bound; found a silent `validate` dead end (pinned in `register.test.tsx`) | 20/20 |
| `verify-sorting-headers.sh` | §6 `<th>` button, `aria-sort`, text/numeric/date; audit columns carry no button | 19/19 |
| `verify-sorting.sh` | R76 four tables, no row on two pages (R76.3 `id`); found «التسجيلات» `sort_by=first_name` → 400 (2026-09-22) | 39/39 |
| `verify-staff-period-bounds.sh` | Staffing period marked as typed (`min`, `aria-invalid` on both dates); schedule-start edit re-marks it; never saves | 5/5 |
| `verify-staff-picker.sh` | AR five مؤطِّرات told apart; matches the select offering a seeded name | 13/13 |
| `verify-student-flows.sh` | Beneficiary portal incl. حسابي enrolments (NEW G) | 10/11 (check 11 fixture-coupled) |
| `verify-teacher-capabilities.sh` | مؤطِّرة edits her own المواد/الفئات as a genuine teacher, no admin link gained; server half in `teaching-profile.http.integration.test.ts` | 4/4 |
| `verify-teacher-portal.sh` | R106 menu, availability operated and written with a real bearer; other profile/directory/curriculum/own-class edit (TD-2 `⊘`) refused; prints staffed-class count (§4.4c) | 25/25 |
| `verify-teacher-scheduling.sh` | Merged مؤطرة surface: R93 assistant notice, R94 type picker, exam on own class, R140 Level list | 14/14 |
| `verify-teaching-profile.sh` | AQ/X/AY «الملف التدريسي»; NEW E untouched profile closes silently; dialog scoped to the row | 14/14 |
| `verify-trash-restore.sh` | R169 §8 «استعادة» offered, asks, restores, reports seats | 6/6 |
| `verify-uat-2026-09-02.sh` | Level `الوصف` survives reload, `type=` sent, new activity on `مرة واحدة`, content edit has no file input | 5/5 |
| `verify-unsaved-guard.sh` | Rule AY pristine/dirty on `＋إضافة مقر` and `＋تسجيل مستفيدة`; new-class default `entire_level` | 24/24 |
| `verify-user-qr.sh` | R96 own squares, distinct payloads, no PII/role, child context, reference refused as credential | 11/11 |
| `verify-ux-slice.sh` | AG/AI/W scroll ownership, control geometry, sidebar `scrollTop` | 22/22 |
| `verify-visibility-ui.sh` | NEW B §D tier on three forms, hydration, dirty close; NEW H notice by kind (`catalogue.mjs`); R50 scopes; `--clean` | 20/20 |
| `verify-weekly-follows-start.sh` | R172 §13 start moved a day; server `weekdays` and next three occurrences follow | 4/4 |
| `verify-whole-category-recording.sh` | R172 §1/§11 recorder asks the Category first; «كل مستويات الفئة»; Subject offered with no Level | 7/7 |

### Harness rules

- Mint **once per identity**; the app refreshes on load and re-presenting a rotated cookie is the replay TD-4.13 revokes for (symptom: `401` after the first read, or «ليست لديك صلاحية» on the second navigation). One session per consumer and per phase; mint every bearer up front; set the browser cookie once.
- `/auth/refresh` compares `X-Requested-With` literally with `XMLHttpRequest` (TD-12).
- A fixture user needs the **role** its screen is gated on, not only the domain fact.
- Identify rows by **id from the API**, never by rendered title or date.
- A negative check must prove the surface **opened** (`/admin/scheduling` is not a route; an unopened bell panel yields `''`); helpers report a non-200 instead of swallowing it.
- Scope the query to the row and assert **whose** record the dialog shows.
- `.state[role="status"]` is loading, not ready; wait for the requested pathname and the skeleton to leave.
- Discriminate a control by what it offers, not its label; `.admin-nav a`, not `nav a` (`PortalShell`, rule AP); `/teacher`, not `/dashboard/teacher`; `.bell__count`, not `.bell__badge`.
- If the requirement is that the UI sends the request, the harness makes the UI send it; a notification is proved by reading it as the recipient.
- Match the **tagged** name (the dev database holds a Level «وميض الأمل»); reproduce against the reporter's own rows first (R78.3 excludes the actor, so a cancellation can resolve correctly to nobody); a zero-recipient result must say so.
- Click in one `evaluate`, read in the next; instrument with `Page.addScriptToEvaluateOnNewDocument` and assert the observation, not only the absence of a symptom.
- Detect the edge (DEV auth zone 6000 r/m vs production 10 r/m) and assert what is true there.
- Make state readable (`data-connection`); a rendered element is not a connected one. `readyState >= 2 && duration > 0` is the only proof a recording plays.
- Every harness traps `EXIT`; batch long runs (the tool cap SIGTERMs the loop and an outer trap does not fire for the killed child); kill the process **group** (`setsid`, negative PID) or renderers keep the `mktemp -d` profile open.
- Chrome debug-port wait is `60 × 0.5s`, a missing port an explicit `FAIL` (the dev overlay's Egress worker also runs headless Chrome).
- **NO RESULT** (no summary line) is never green. Open note: `verify-recorder`/`verify-reorder` reported NO RESULT in long sweeps while passing alone (not memory, not leaked browsers); one clean sweep since is not evidence. Rerun individually; never drop them from the sweep.
- A bare `finish()` exits 0 whatever it printed; «لا يُسجَّل الحضور» contains «يُسجَّل الحضور».
- A contract change reaches harnesses: `grep -rln '<route>' scripts/dev/browser/`, restate rather than loosen.
- Running them is what makes them coverage; unrun harnesses decay silently.

## Environment traps

- **Real Nginx rate limits**: a `429` where `200` was expected, moving between tests on repeated full runs, is the auth zone; rerun the one suite alone.
- **`api` has no bind mount**: any backend change needs an image rebuild before HTTP or browser suites see it; batch edits; verify the running revision — `docker exec bodour-api-1 sh -c 'grep -c "your-new-route" /app/dist/src/app.js'` — never the build log. Stale container: `404 <unmatched>`; dropped table: `500` or an empty result. Health is `/healthz` at the origin root (a `401` under `/api/v1/` is the guarded router).
- **Frontend reaches the harness by `cd frontend && npm run build`**: the dev overlay bind-mounts `./frontend/dist`; `docker compose up -d --build nginx` may leave the container on the old image. Compare `curl -s http://127.0.0.1/ | grep -o '/assets/index-[^"]*\.js'` with a local `npx vite build`; `curl -s http://localhost/assets/index-XXXX.js | grep -c '<removed string>'`.
- **Never bring the edge up without the dev overlay**: `docker compose up -d --force-recreate nginx` drops `nginx/dev/default.conf` and port 80, fails closed to HTTPS, and every harness dies with `ECONNRESET` on 443. Recovery: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --force-recreate --no-deps nginx`.
- **`scripts/dev/test-integration.sh`, never `vitest` directly**: `.env` is container-shaped (TD-13: `DATABASE_URL` → `db`, `MINIO_ENDPOINT` → `minio`); the script rewrites both to the published loopback ports. Sourcing `.env`: the storage suite fails with `no object at the initiated key`.
- **A new TD-7 queue needs a worker restart** (`pgboss.job` is partitioned by queue; inserts fail on `q_fkey`).
- **Never run the integration sweep with a browser sweep or with itself**: one database, one consent text, one fixture namespace (53 failures across `quran`, `quran-entry`, `effective-staffing` once). A failure that moves between runs is residue; a regression fails the same test every time.
- **`session.materialize` runs in the API container concurrently with the suite that owns a schedule**: teardown re-sweeps just before the schedule delete and retries **once** (`session_schedule_id_fkey`); moving assertion failures in scheduling suites are a known, unfixed intermittency. Proper fix (own slice): count only owned occurrences; never widen timeouts or disable the worker.
- **A killed run leaves damage a green rerun cannot clear**: a `*-test-*` label left `active` in `legal_consent_text` fails later suites with «… is already in force». Restore through `removeTestConsentText`, never SQL (supersedes the scratch row, reactivates the displaced one, restores the counter, never deletes a row consent records reference).
- **`?raw` on a `.css` file reads `''`** under Vitest: CSS invariants are shell guards in `scripts/ci/`, checking `length > 0` first; grep guards strip comments (`check-progress-css.sh`).
- **CI guards search with POSIX `grep`**: an absent `rg` prints to stderr and the prohibition condition is false, so the guard passes open (proved with a `proxy_pass $minio_upstream` bypass against `check-storage-edge.sh`; `check-backup-tooling.sh` failed closed). `check-ci-portability.sh` fails on `rg`, `fd`, `ag`, `ack` and refuses moving `check-no-pii-logs.sh` before `npm ci`.

## Fixture ownership

- A fixture creates and destroys rows it **owns** (`TAG` prefix) and only borrows others; a `where` without the tag is the smell. Tags are disjoint namespaces (`[appr-test-place]`, never `${TAG}p`).
- Tag every row incl. children nobody reads; sweep by ownership (`parentId IN (…)`) where the FK graph allows; one untagged `Restrict` child pins a cluster onto the public homepage.
- Hold a handle in a column no test writes: R111 rewrites `nameArabic` to «حساب محذوف», emptying a `startsWith(TAG)` sweep; record ids (`createdUserIds`) and delete the union.
- Run-unique tags (`[content-test:${randomUUID()}]`) prevent cross-process deletion but strand rows on a killed run; `src/test-support/abandoned-fixtures.ts` sweeps by age + prefix; new prefixes go into `RUN_UNIQUE_FIXTURE_PREFIXES`. R111, content, teaching-profile and notification suites carry a random run id.
- Restore **first**, teardown in `finally`, capture once per file (`test-support/legal-consent-text.ts` records what was in force, installs the suite wording, puts the previous back, leaves its own row `superseded` while consent evidence points at it).
- Track ownership at creation (registration fixtures record their onboarding-token JTIs; a before/after delta could delete a real user's replay guard).
- Never sweep a namespace you do not own: `test-support/academic-period.ts` mints **one year per file** with counter-numbered periods (a random label from an 800-wide band collided inside one file); the band is only asserted.
- Global invariants need global fixtures: the `LAST_SUPER_ADMIN` test once revoked every real Super Admin's role; it now creates synthetic successors and its `afterAll` asserts one active Super Admin remains. Platform-wide destructive proofs (audit purge, R101 rollout, R141 migration) run inside an always-rolled-back transaction.
- Shared cleanup (`clearPlacement`) runs **after** the rows referencing it (`User.intended_category_id` RESTRICT); a red teardown is the next run's false failure; a failure list spanning unrelated files means the fixture.
- Quran fixtures consume the seeded `tracks_quran_progress` marker (partial unique index, R73.4/R107–R108, حفظ القرآن only) through a fail-closed helper, never creating or deleting the reference Subject; the R91 fixture uses تفسير القرآن; teardown removes only owned joins.
- A new table means every fixture touching its parent (`session_recording` RESTRICTs `session`); a seed failing in its **wipe** is a UI-created row the tag never saw — key teardown on the owning entity and follow the FKs (`seed-notify-scenario.ts`).
- Seeds create the reference data their assertions turn on (`findFirstOrThrow` once picked a Subject with `tracks_quran_progress: false`); schedules go through `createCourseSchedule` (a raw `prisma.create` has no occurrences); a cover is `PATCH /sessions/{id}` with `staff` (sets `overridden`, R43.6), never a raw `SessionStaff` row; `seed-attendance-scenario.ts` (`[attguard]`) deletes nothing outside its tag.
- "Today" is the association's clock: `Date.UTC(y, m, d + offset)` from local parts, every date from one clock (UTC-zeroed date and local `getDay()` disagree at 00:34 Casablanca).
- **All-table isolation**: `scripts/test/run-integration-suite.sh` digests every base table (counts + row hashes minus `created_at`/`updated_at`, no row data) before and after Vitest and fails on any difference; a source guard rejects `deleteMany` without `where` or with `undefined` (P1.2: `branch.integration.test.ts` deleted all `course_schedule_staff` via `userId: undefined`). Re-seeding is not a remedy. Caught: a leaked `normalized_email_lock`, relative-only `display_order` restoration, a UTC-built online-class date, `SessionRecording` missing from teardown, browser probes on ambient "first" rows, `user 25 → 27` from the mutable-tag suite.
- Consent-migration retry accepts `completed` and `already_completed` (a live worker may converge first); the retry proof uses a unique real pg-boss queue with the TD-7 policy and asserts its job id.

## Named regression tests

Ramadan DST wall-clock stability · consent revocation rippling to bucket migration · Teacher global-scope rejection · re-upload cache-key immutability · retained completed-upload PUT mutates staging only (forced verification/copy race) · pending-session data-access denial on all endpoints plus the client route guard · child-context verification on every student-context endpoint incl. Student-role bypass and foreign-parent `404` · Quran log deletion synchronously un-completing a level · onboarding-token replay → `409` · presigned PUT/GET through the proxy · case-variant Google email → one identity · stale-version edit → `VERSION_CONFLICT` · concurrent roster adds at capacity − 1 admit one · double approval: first wins, second `409` · MinIO down: content 503s, scheduling and grading work · workers down: enqueues succeed, jobs drain on restart · body-email substitution against a valid onboarding token ignored · suspended teacher denied a presigned mint · self-healing cache repairs a stale row · first draft save initializes absent-zero rows · concurrent teacher score vs admin override → `VERSION_CONFLICT` · 31st upload in an hour → `429`, two concurrent initiations at the boundary admit one · replayed refresh token outside grace revokes the session · suspension revokes refresh tokens in its own transaction · two-tab refresh rotates once, logs nobody out.

## The token lifecycle is specified as tests

| # | Criterion | Expected |
|---|---|---|
| T1 | Refresh with the current live token | New access **and** refresh token; predecessor revoked; one transaction; audit written |
| T2 | Tokens never stored raw | Only the hash persists; a dump yields no credential |
| T3 | Immediate predecessor **within** 10 s | Accepted; no third token minted |
| T4 | Immediate predecessor **after** 10 s | Refused as reuse |
| T5 | Anything older, or already revoked | Whole session revoked; two audit rows |
| T6 | Logout | Revokes only the current session |
| T7 | Revoke-all | Every live token revoked; no user-facing route |
| T8 | Suspension | All tokens revoked in the suspension transaction |
| T9 | Soft delete | As T8, different reason |
| T10 | Past expiry | Refused; a purged token refused identically (fail-closed) |
| T11 | Revoked token, any age | Never accepted, never resurrected |
| T12 | Concurrent refresh, two tabs | Exactly one rotation; the loser absorbed by grace |

## Mutation testing, guards and failures

- Mutation testing is standard; a surviving mutant is distrusted until the mutation is proven shipped: a build break kept the old image, an unquoted variable made the runner run zero tests, single-file runs use another failure format — each read as "every mutant survived".
- Every CI guard is proven by reintroducing its bug (display-identity guard: an inline fallback in the calendar service; header-navigation guard: the burger re-declared after its media query). A guard that has never failed is untested.
- A guard failing because the product changed is restated, not deleted: R98.18's «mounts no recording affordance» became, after R99, "composes بذور الأمل's own panel, mounts no vendor recording component, grants no `roomRecord`".
- Assert that a failure is actionable: pin the cause (`details`), not only `code: 'SERVICE_UNAVAILABLE'`.
- Test the error path with the error that makes it hard: `startRecording`'s catch used `update` (throws when the row is gone); `updateMany` is the clean-up semantics.
- A negative uses the rule's axis: §4.9 visibility is Level-based, so the same Level at another branch is a positive; the refused person is in another Level.
- A date-scoped rule threads the date through: `teacherEventScope(prisma, teacherId)`'s `on` defaulted to today and `assertExamInTeacherScope` dropped it; the group now comes from the staffing row's schedule, date-correct by construction.
- No-PII logging is tested both ways: `request-context.test.ts` (email-shaped `X-Request-Id`, paths and exception reach no output), `audit.repository.test.ts` (nested identity/locator keys never reach the write), content tests with an email-shaped filename keep only 64-hex ids, Trash audit outlives its entity without the label; `check-no-pii-logs.sh` pins Nginx id generation, no URI/client address in the access format, no raw exception text, no mailbox/raw key/Trash label in audit detail, every audit write through the recursive repository guard (mutation-tested with a direct `prisma.auditLog.create`).

### The `auth-refresh` flake, and what it actually was

- `expected 429 to be 401`: `limit_req_zone` keys on `$binary_remote_addr` and the whole suite arrives from one host; TD-13 models a person, not a runner.
- Fix in the dev overlay only: `nginx/snippets/rate-limits.dev.conf` over `rate-limits.conf` via `docker-compose.dev.yml`; only zone rates change, every `limit_req`, zone assignment and burst stays as production.
- Rejected: retrying on 429 (hides interference), dropping `limit_req` from dev (stops exercising the limiter), raising production numbers (bends a normative value). Verified by three consecutive clean sweeps.
- Method: read the failure message before theorising about the harness.

## What is not tested, and why

- No continuous load testing; latency targets verified against ceiling-scale fixtures before launch; no metrics stack.
- Browser-matrix testing is E2E-only, at the audio-playback level.
- The staging origin never exercises authenticated flows (cross-origin by design); those run on the local same-origin stack and the production rehearsal.

## HIGH readiness checkpoint 2026-09-13

H1/H2/H4/H5/H6 closed for local engineering (base `45cf1f0`, committed, not pushed); H3 untouched.

| Evidence | Figure |
|---|---|
| Nine-suite focused run (below) after the maximum-grade fixture correction | 245/245 (5 skipped) |
| H2 gap fixed: `publishOccurrenceTx`'s publish re-check (R125) called `assertAudienceWithinBranchScope`, the branch-only subset of `assertMayAuthor`; a مؤطِّرة with no `admin` scope read as zero reachable branches → `FORBIDDEN TARGET_OUTSIDE_BRANCH_SCOPE` at publish. `assessment.service.ts` now calls `assertMayAuthor`; reachable only for `mode: 'online'` (`exam_online_has_no_room_check` gives `branchId: null`, so the admin arm's `assertCanActOnBranch` is a no-op) | rerun 245/245 |
| `notification-targets.http.integration.test.ts` «re-publishing after the score CHANGED» silently no-opped `PUT /exams/:id/grades` (H5 requires the current version) → `notified: 0`; fixture supplies the version | no assertion weakened |
| H6 `consent-safeguarding.integration.test.ts`: retagging both directions without a bucket move, immediate anonymous denial, immutable-byte private migration, mandatory-audit rollback, first-link/discovery race; B4/B5 regressions unchanged | pass |
| Full disposable stack | 2,549 / 18 skipped, 112 files / 2, browser 193/193, 96 migrations, both seeds, isolation clean |
| Backend lint/typecheck/test/build; storage-lifecycle source guard (four-argument cron registration, explicit timezone, reconcile-only payload) | 342/342, 40 files |
| 9 non-link guards, `git diff --check`, TD-3 226/234 (eight pending), `check-openapi-current.sh` 175 paths / 226 operations; no `bodour-ci-integration-*` residue | pass |

```bash
timeout --signal=TERM --kill-after=30s 1800 bash scripts/ci/test-integration.sh \
  src/controllers/exam.http.integration.test.ts \
  src/controllers/teacher-exam-scope.http.integration.test.ts \
  src/controllers/grade.http.integration.test.ts \
  src/controllers/exam-max-grade.http.integration.test.ts \
  src/services/assessment.integration.test.ts \
  src/services/exam-deletion.integration.test.ts \
  src/services/consent-safeguarding.integration.test.ts \
  src/services/storage-retirement.integration.test.ts \
  src/services/storage-lifecycle.integration.test.ts
```

## H3 readiness checkpoint 2026-09-13

Closed locally (base `5eabe63`, one further commit, not pushed). Owner decision ([SRS R142](../SRS.md)): a manual remote exam is opened explicitly by an authorized teacher or administrator through «فتح الاختبار», never by its start time.

| Evidence | Figure |
|---|---|
| No schema change: `Exam.available_from` (R136 clause 5) already allowed an explicit staff «open now»; `openAssessment` = `POST /assessments/{id}/open`, mirroring `/close`: `lockExamRow` first, re-read in the same transaction, `assertMayAuthor` (never its branch-only subset), one `audit.write`; mode/status/already-open refused together as `STATE_CONFLICT`/`INVALID_TRANSITION`; **non-idempotent by design** (audit count shows no duplicate) | — |
| `bash scripts/ci/test-integration.sh src/services/assessment.integration.test.ts`, 13 new: Admin opens; `entire_level` Teacher opens; exact-Session Teacher opens hers, `FORBIDDEN` on a Level; R91 ended assignment authorizes inside its window only; branch Admin `FORBIDDEN`/`TARGET_OUTSIDE_BRANCH_SCOPE` across branches; outsider Teacher and the student refused; `physical` and `draft` → `STATE_CONFLICT`/`INVALID_TRANSITION`; repeat and two concurrent Opens (`Promise.allSettled`, real row lock) leave one audit row; audit names actor and target; student `NOT_FOUND` before, reads after; an unrelated student's Level refusal not bypassed | 128/128 |
| Authoring mistakes corrected: Level/group fallback is `FORBIDDEN` not `NOT_FOUND` (`assertExamInTeacherScope` taxonomy); fixtures dated `OTHER_DATE`, not `TODAY` (pagination convention) | no assertion weakened |
| Full disposable stack | 2,563 / 18 skipped, 112 files / 2, browser 193/193, isolation clean |
| Backend units; frontend lint/typecheck/build and units (13 source-guard assertions in `assessment-ui.test.ts`, none rendering the DOM) | 342/342 (40 files); 1,263 (106 files) |
| 9 guards, diff and doc links; TD-3 227/235 (`/assessments/{id}/open`, same eight pending); OpenAPI regenerated (`npm --prefix backend run openapi:generate`) 176 paths / 227 operations; no residue | pass |
| Frontend `openable` action (rule O, `ExamAccessAction`; the server remains the boundary): «فتح الاختبار» beside «إغلاق الاختبار» for an unopened `online`/`published` paper the caller may write to, on the shared `ConfirmDialog`/`busy`/`act()` machine; «لم يُفتح بعد» badge | — |

## B2/B3/B7 account-lifecycle acceptance (2026-09-11)

Disposable runtime proof only: the [CI integration harness](../../scripts/ci/test-integration.sh) with its synthetic `EMAIL_LOCK_KEY`, all migrations onto an empty database, focused suites first, then the full suite with all-table isolation; never Owner-populated localhost; never bypass an execution rejection or cite an earlier passing version as proof of the final move. Not Production approval.

| Evidence | Figure |
|---|---|
| `deletion-generation.integration.test.ts`: real Prisma transactions, barriers at the sweep read/User lock, explicit future sweep clock; immediate disable, deadline refusal, restore/re-delete generation binding, duplicate erasure, pending/rejected/approved claim minimization, claim-vs-purge serialization, SQL digest shape; exact digest cleanup replaces plaintext-prefix cleanup | 159/159 (7 suites); lifecycle 8/8 |
| First run 156/159: a purge barrier also paused the newly locked restore (now purge only); a minimized claim asserts `NOT_FOUND`, null credentials, no resurrected identity | corrected |
| Populated upgrade (`scripts/test/verify-deletion-upgrade.mjs`, own PostgreSQL, bounded timeouts): only `email_digest`/`created_at` remain in the lock table, malformed coordinates fail its CHECK, the shared HMAC primitive is used; ownership, Users, Trash and recoverable claims untouched; proven-erased claims lose credentials, approved transition facts still block former-guardian authority; live pending claims need both credential fields; races yield one owner; wrong/missing deployment key refused before startup | 93→94: 11 Users, 10 claim states, two windows; three proven-erased claims minimized; 26 pre-existing SQL/Prisma differences reproduced against `a4174b1`, no new divergence |
| Fresh `prisma migrate deploy` | 94/94 |
| Final boundary: `trash-coverage` flagged `account-deletion.service.ts:638 selfManagedClaim.findMany` (must include deleted claims; a live-only filter would retain PII) → `user.repository.ts` `minimizeSelfManagedClaimIdentity` on the caller's transaction and held lock; no guard change or reader widening | ten-suite retry 220/220 |
| Final full run | 2,513 / 17 skipped, 110 files / 2, 390.39 s, browser 193/193, 94/94 migrations, isolation clean |

```bash
timeout --kill-after=30s 1200s bash scripts/ci/test-integration.sh \
  src/services/deletion-generation.integration.test.ts \
  src/services/email-ownership.integration.test.ts \
  src/services/self-managed-claim.integration.test.ts \
  src/policies/self-management.integration.test.ts \
  src/services/account-closure.integration.test.ts \
  src/services/trash-lifecycle.integration.test.ts \
  src/controllers/user-management.http.integration.test.ts \
  src/services/trash-coverage.integration.test.ts \
  src/services/auth.integration.test.ts \
  src/services/user.integration.test.ts
(cd backend && timeout --kill-after=10s 240s node --import tsx ../scripts/test/verify-deletion-upgrade.mjs)
timeout --kill-after=30s 1500s bash scripts/ci/test-integration.sh
```

### R141 self-managed rejection audit follow-up

| Evidence | Figure |
|---|---|
| B7 fixture rejects with `b7-rejection-pii:` + identifier + email, confirms rationale retained before erasure, searches User/claim/audit after delete/restore/re-delete/final-erasure; claim Trash reason must disappear; actor/claim/beneficiary/time evidence survives | 7/1 before the writer fix, then pass |
| `self-managed-audit-migration.integration.test.ts`: exact R141 data-only SQL over synthetic events — five reason keys, orphan targets, actor/timestamp and unrelated actions preserved, rationale unchanged, second run no-op; **always rolled back**; no value-based PII scrubber or generic audit-mutation API | pass |
| Focused: deletion-generation, self-managed-claim, self-management, account-closure, user-management HTTP, trash-coverage, audit-purge, audit-migration | 140/140; 95/95 migrations |
| Full run; lint/typecheck/build; units; 30 guards; doc links | 2,514 / 17 skipped, 111 files, 467.44 s, 193/193; 341/341; 1,031/1,031 |

## B4/B5/B6 storage retirement and Event scope (2026-09-12)

Locally accepted, one local commit, no push; [pre-maintenance legacy import](../operations/runbooks.md#b5-retirement-backlog-and-rollout) is a separately authorized prerequisite; a healthy worker is not proof the backlog is empty; not Production approval.

| Evidence | Figure |
|---|---|
| Parent visibility move copied to a shared destination and deleted it on optimistic-lock loss → barrier regression: one winner, unchanged bytes at a fresh canonical key, safe same-visibility retry; real-store post-copy publication failure, lost copy response, exact orphan cleanup, stale retirement of a live coordinate | pass |
| `storage-retirement.integration.test.ts` on the production worker catalog: duplicate delivery, failure evidence beyond five attempts, lost execution history, reconciliation, lost delete response, legacy import, queue-absence rollback; queue fixture always rolls back; all-table guard includes the new table | pass |
| Consent: revocation before/after stale migration completion; completion rechecks under the Content lock; a later transition renews an old obligation | pass |
| `scripts/storage/verify-storage-lifecycle.sh`: worker restart, replacement quarantine failure, missing queue, strict staging GC, exact-key ambiguous deletion; same-origin config, signed-ticket staging object inserted internally, **no Nginx claim** | 5/5 |
| B6: crafted mixed/foreign branches over HTTP → total rollback, all-permitted expansion retained, PATCH scope keys rejected; Teacher definitions: own-group authority, live responsibility, unrelated global definitions, hidden assistants, date filtering; public calendar unchanged | pass |
| Intermediate runs exposed duplicate wakeup accounting, the queue fixture's schedule FK, hidden-assistant exclusion, wakeup duplication behind an active job → obligations own initial/renewal wakeups with backlog recovery | fixed |
| First full run failed one: calendar operational-boundary fixture created its Event before its branch was operational → fixed; concurrent retirement wakeups serialized on their own row (pg-boss `singleton_key` is not unique); outbox suppresses active exact-operation duplicates; reconciliation/import releases each record's transaction before the next | five-suite retry 129/129 |
| Review found DB locks could expire while a remote COPY pended → reproduced first (barrier holds the copy: deterministic injection, not a real timeout), then `copy_settled` added to the still-uncommitted migration 96; publication uses a one-attempt S3 client; positive settlement commits before destructive I/O; SQL rejects completion while false; late-orphan retirement never deletes the winner; unknown absence cannot complete | 77/77; drill 5/5; 95→96 rehearsal |
| Populated 95→96 rehearsal: legacy User and failed-job payload byte-for-byte, idempotent import, only its fixture job removed, obligation/locator survives, locator constraint fails closed | pass |
| Final affected batch (eight suites); final full gate | 193/193; 2,534 / 18 skipped, 112 files / 2, 299.42 s, browser 193/193, 96/96 |
| Lint, typecheck, units, build, Prisma format/validate/generate, 30 guards, shell/Node syntax, doc links; OpenAPI 175/226, TD-3 226/234; no residue; no SRS/frontend contract change, no new constitution exception | 341/341 (39 files); 1,038/1,038 |

```bash
timeout --kill-after=30s 1200s bash scripts/ci/test-integration.sh \
  src/services/content.integration.test.ts \
  src/services/storage-retirement.integration.test.ts \
  src/services/consent-safeguarding.integration.test.ts \
  src/services/event.integration.test.ts \
  src/services/event-list.integration.test.ts \
  src/services/event-staff.integration.test.ts \
  src/controllers/event.http.integration.test.ts \
  src/services/trash-coverage.integration.test.ts
timeout --kill-after=15s 300s bash scripts/storage/verify-storage-lifecycle.sh
(cd backend && timeout --kill-after=15s 240s node --import tsx \
  ../scripts/test/verify-storage-retirement-upgrade.mjs)
timeout --kill-after=30s 1500s bash scripts/ci/test-integration.sh
```

## B1 SeaweedFS compatibility and recovery

The [selected object store](../architecture/storage.md#b1-candidate-verification-checkpoint) is tested in isolated Compose projects; the shared Production store definition serves `scripts/ci/test-integration.sh`, the bootstrap/recovery drill and the storage-lifecycle drill; no live data copied. B1 locally closed, not deployed.

| Evidence | Figure |
|---|---|
| Bodyless browser presigner attached CRC32(empty) → `WHEN_REQUIRED` on the public-origin client only; internal checksums stay `WHEN_SUPPORTED`, placement COPY single-attempt, completion checks the whole stream's SHA-256; unit test checks signature, non-default host port, no invented body checksum | pass |
| Truncated stream: SeaweedFS reaches the application's length-mismatch refusal (MinIO gave a transport refusal) → parameterized regression accepts only those failures, transport failure stays 503, no row/object, server staging cleaned, browser staging retained, same ticket completes with full bytes | pass |
| Explicit source failure exposed an unobserved Smithy checksum-promise rejection → narrow observation in the shared client; 107 passing **plus an unhandled rejection** was not accepted | 108/108 (four suites), 193/193, exit zero |
| SeaweedFS serializes singleton policy Action/Resource as strings → initializer accepts only that representation; policy unit rejects added grants, broad resources, conditions, `NotAction`; no policy silently cleared | pass |
| Recreation drill assumed a physical volume name → label-based resolver; restore refuses an image scaffold copied into a fresh volume (`volume.nocopy`); preflight negatives: wrong image digest, legacy physical volume reuse, `nocopy` removed | pass |
| Four-suite run: real Nginx signed PUT/GET, private Range 206, MIME, signed Content-Disposition, public canonical/stale/restricted/deleted coordinates, public-staging denials, method/root normalization; immutable winner, late COPY, ambiguous copy/delete, job-history-loss recovery; edge and authorization code unmodified | pass; drill 5/5 |
| Final full run | 2,536 / 18 skipped, 112 files / 2, 433.40 s, browser 193/193, 96/96 migrations, isolation clean |
| Production-mode drill: repeat bucket/seed init, dependency-down recovery, durable queue work, service restart, stop/start, force-recreate with stable volume identities, encrypted raw-volume restore into empty targets; canaries revert to the recovery point; images built from the uncommitted worktree, labelled with parent HEAD (local evidence only) | browser 15/15 |
| Lint, typecheck, build, units; 30 guards; OpenAPI 175/226, TD-3 226/234; syntax/diff/doc links; no residue; legacy MinIO still mounts only `bodour_minio-data`; no schema, route, frontend or SRS change | 342/342 (40 files); 1,046/1,046 |

## Acceptance checklists

A module is Done when its SRS §18 checklist is ticked, its test gates pass and its journeys run green — per module, not per week. Checklists: Authentication & Onboarding, Registration/Approvals/Family, Scheduling & Calendar, Quran Progress, Exams & Grading, Content/Consent/Storage, Data/Admin/Audit, Platform & Deployment.

---

**Next:** [CI/CD](ci-cd.md) · **Related:**
[User journeys](../overview/user-journeys.md), [Conventions](conventions.md), [UX rules](ux-architecture.md)
