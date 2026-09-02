[Documentation](../README.md) › [Development](README.md) › **Testing**

# Testing

Four layers, each testing something the others structurally cannot.

| Layer | Scope | Tooling | Gate |
|---|---|---|---|
| **Unit/default** | Services: interval merge, state machines, consent evaluation, time and DST logic, Arabic normalization | Vitest | CI on every push/PR |
| **Integration** | Repositories against **real PostgreSQL**: constraints actually reject bad writes, partial indexes, native collation ordering, soft-delete filtering | Vitest + a real stack | CI on every push/PR, disposable stack |
| **API** | HTTP integration tests against the contract; child-context tests; envelope conformance | Vitest + real Nginx/API/pg-boss | CI on every push/PR, disposable stack |
| **Browser/E2E** | Journeys, RTL rendering, mandatory UI states, upload retry | Chrome over CDP | Manual — CI infrastructure gap |

**Coverage: ≥ 80 % on services and policies.** No coverage gate on generated or boilerplate
code — a coverage number that counts generated clients measures nothing.

Current default CI totals: **320 backend tests · 913 frontend tests**. The repository also
contains **92 backend integration files**; the dedicated workflow job now provisions their
isolated real stack and database lifecycle rather than pointing them at Local Development.

The backend total includes deterministic worker-readiness regression tests. They inject the
clock and pg-boss live-worker view, so startup failure, incomplete registration, lost/stale
workers, and the long-running-handler exception are covered without sleeps. Controller tests
separately prove that a healthy database plus a present `pgboss` schema cannot make
`/healthz` green when the runner never started.

The R115 identity/framing matrix runs on the same disposable real stack. It exercises the
Platform Owner singleton and database lifecycle triggers, current-owner-only transfer and two
concurrent targets, first verified Google binding with no fabricated subject, exact bootstrap
and rerun behavior, strict هيئة التأطير one/multiple/all/online framing persistence, deferred
cross-table constraint failures, read-only post-approval profile projection, per-window mode,
legacy null and modality-aware advisory warnings. Its fixtures restore the singleton and User
version counters as well as the owner id, so a passing assertion cannot still mutate the seeded
owner behind the all-table isolation guard.

Calendar/Hijri suites must never reserve the operator-facing 1447/1448 years or their real
Gregorian timeline. Their overlay fixtures use reserved test-only Hijri years **and** remote
Gregorian dates, and teardown names only those coordinates. This is intentional in both
dimensions: lookup is Gregorian-timeline based, so changing only `hijri_year` can still make a
test read operator data. The all-table isolation runner caught the old teardown deleting twelve
local official rows; the repaired 46-assertion run leaves the restored catalogue unchanged.

The B-01 safeguarding suite uses real PostgreSQL, MinIO and pg-boss. It proves the public
anonymous and Nginx-gated read before withdrawal; the committed application/public-origin
denial while physical migration is pending; full-stream SHA-256 equality; and write-only
public staging. Its 19 scenarios cover R92 audience changes, retained Sessions after schedule
deletion, bounded startup discovery, opposing shared-recording lock graphs, monotonic re-grant
ordering, real upload replacement, exact old/new-key obligations, deletion before/after an
ambiguous storage response, duplicate/stale jobs, retry, process restart, terminal failure
observability and replacement/deletion CAS. The real Nginx case additionally proves the
external method allowlist, S3 Select/WebDAV-shaped denial before MinIO, signed-versus-unsigned
PUT behavior, exact bucket-root denial with listing queries, and fail-closed duplicate/encoded
path normalization. It never deletes the historical consent backlog: only tagged fixture jobs
receive temporary priority and all tagged rows/objects are removed.

The storage-proxy suite also checks the temporary P0.1 edge defence without reproducing the
object-store vulnerability: an unsigned, credential-free, bodyless request carrying the
vendor-named unsupported content-hash mode must receive the Nginx-only policy marker. The
same suite then completes a real presigned PUT/GET round trip, so a broad filter that breaks
legitimate SigV4 traffic cannot pass.

## Running them

```bash
# Unit — no stack required
cd backend && npm run lint && npm run typecheck && npm test && npm run build
cd frontend && npm run lint && npm run typecheck && npm test && npm run build

# Repository and contract guards — every scripts/ci/check-*.sh guard is represented in CI
for g in scripts/ci/check-*.sh; do bash "$g"; done

# Integration — needs the stack up
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
bash scripts/dev/test-integration.sh

# CI-equivalent integration — owns and destroys a uniquely named disposable stack
bash scripts/ci/test-integration.sh

# R115 authenticated browser acceptance — also owns and destroys its whole stack
bash scripts/dev/browser/verify-platform-owner-framing.sh

# Production-mode bootstrap/readiness — synthetic TLS, no fixtures, isolated volumes
bash scripts/deploy/verify-production-bootstrap.sh

# Actual release host — read-only; requires installed secrets, DNS, GHCR, approved disk floor,
# and non-interactive root authority for the root-only effective-SSH-policy inspection
BODOUR_RELEASE_TAG=<40-char-commit> bash scripts/deploy/preflight-host.sh \
  production bodouralamal.com <expected-public-ipv4> <minimum-free-GiB>

# Destructive only to uniquely named disposable volumes and a local encrypted repository
bash scripts/backup/verify-backup-restore.sh
```

The Production bootstrap drill fills the gap the fixture-tier integration suite intentionally
cannot cover. It builds the actual API/web images, resolves the Production Compose overlay with
synthetic secrets, applies all migrations, executes the real Production seed twice, and compares
every seeded row including ids and timestamps. It proves the exact reference counts, the single
unbound Super Admin, absence of branches/rooms/groups/rosters/schedules/content and fixture/dev
accounts, all three MinIO policies, and no host binding for PostgreSQL or MinIO. A generated
one-day certificate activates the real TLS Nginx configuration on loopback; `nginx -T`, HSTS,
CSP, public-bucket-root denial, the anonymous API boundary and the complete worker health payload
are asserted. A real headless Chrome then loads the built Arabic RTL login, calendar, library and
not-found routes through that exact TLS hostname. It proves the Google-only login surface,
anonymous refresh/API refusal, no browser credential residue, CSP/runtime cleanliness, successful
public reads, and the live Production auth rate-limit envelope. The probe never mints a development
session or loads fixture users; authenticated journeys remain a same-origin Staging acceptance
gate. The resolved API service must also carry the two-minute stop grace that outlives
pg-boss's bounded 105-second drain. The recovery half stops only its disposable MinIO and proves
fail-closed health plus recovery; leaves a real job pending while the worker is stopped and proves
it drains on return; holds a real handler active across API SIGTERM and proves the graceful drain;
then restarts PostgreSQL, Nginx, and the full stack. Finally it force-recreates every long-running
container over the same stateful volumes and rechecks the exact seed rows, migration history,
private object bytes, job terminal states, and non-migrating/non-seeding API command. The same
drill labels both candidate images with the exact repository HEAD and pins the running API/Nginx
containers to those image IDs. Its final phase creates an encrypted recovery point from this
Production-mode graph, writes newer PostgreSQL and object state, destroys both data volumes,
restores into empty replacements, and requires the exact images and whole-platform `/healthz` to
return with the pre-change values, unchanged migrations and unchanged Production seed. The same
drill is a dedicated hosted verification job, and exact-image publication waits for it. Cleanup
destroys the unique containers, volumes, encrypted repository, network, images, generated key,
and Chrome profile.

This is repository-side deployment evidence, not Staging or Production acceptance. It does not
pull from GHCR, obtain a public certificate, test a Moroccan VPS's resource budget or reboot,
exercise resource/disk pressure, use the selected Moroccan backup target/object store, or prove
realistic-volume RTO; those remain separate host/external checks.

The host preflight is the target-side complement. It is deliberately read-only and prints no
configuration values. Its source guard directly tests the Compose-version, domain and public-IP
parsers and pins every host/configuration invariant, while the actual VPS invocation checks the
daemon, filesystem, DNS, secret modes, resolved release graph and exact GHCR manifests. Passing
it still means only *ready to deploy*: no container, migration, certificate or backup has run.

The backup drill is not a source-text assertion. It writes a PostgreSQL row and MinIO object,
creates and verifies a real encrypted restic snapshot, destroys both disposable volumes,
restores them into empty replacements, reads both values back, then executes the portable dump
into a second clean PostgreSQL database. It also pins the running container IDs across recovery
creation and proves a wrong repository credential fails visibly before any service stops.
Fixture mode structurally refuses SFTP so the drill cannot send local data to an external target.
Its local under-one-minute result proves the recovery mechanism and the `< 1 h` target at fixture scale; the selected
Moroccan target and realistic Production volume still require the launch drill.

The storage-lifecycle drill is destructive only to its uniquely named disposable PostgreSQL
and MinIO volumes (`bash scripts/storage/verify-storage-lifecycle.sh`). It applies every
migration, creates objects across the complete staging-prefix catalog, proves the strict
48-hour boundary and bounded continuation, and verifies canonical objects survive. Its purge
case removes the queue first to prove the content row/Trash deletion rolls back, then uses the
real production worker with a deliberately lost first `DeleteObject` response: pg-boss retries,
both exact old leftovers disappear, and a newer key under the same content UUID remains. It
then delivers a stale quarantine job after the row is gone and proves the worker removes the
late copy without targeting that newer key.
Automatic `purge_after` destruction is asserted absent rather than simulated, because it still
requires the Owner decision.

Integration tests run **serially**, because the suites share one database.

The two production-build commands intentionally repeat part of typechecking: both package
build scripts include a compiler pass, while CI also keeps the named exact-typecheck step.
The separate step gives type failures their own gate; the build then verifies emission and
bundling, which typecheck alone cannot observe.

## Why integration tests use a real database

Not mocks. The properties being checked **do not exist in a mock**:

- Does a partial unique index actually reject the second row?
- Does `ar-x-icu` collation actually order Arabic correctly?
- Does the transaction actually roll back?
- Does a presigned signature actually survive the proxy?

A mock returns whatever you told it to. The whole point of these tests is to find out what
PostgreSQL, MinIO, and Nginx *really* do.

The content/storage suite includes focused B-02 placement and B-03 finalization matrices. B-02 treats
`EducationalContent.visibility` as the authority, inspects the real row and both MinIO buckets,
and reads through the real Nginx storage boundary. The matrix covers new public/private content,
replacement with omitted or manipulated visibility, a contradictory pre-fix ticket, anonymous
public/private reads, unrelated-object isolation, `SessionContent`, and recording origin. Its
cleanup owns exact object keys (including quarantine keys), so a green rerun cannot be borrowing
bytes or rows from an earlier run.

B-03 drives the actual presigned PUT, strict HEAD, one full staging GET, bounded magic/length
validation, SHA-256 hashing into private server staging, and the re-hashed canonical PUT. The
committed collision fixture is a copyright-free pair of valid equal-size PDFs with identical
real MD5 and different SHA-256. A production hook pauses after the real source GET is open and
its prefix accepted, replaces staging through the retained real PUT, then proves canonical
download and mandatory audit still match the opened snapshot's SHA-256. A separate truncated
source fixture proves no row/canonical object appears and client staging remains retryable.

Two-party barriers pause concurrent completions after real canonical publication and before
database publication; same-ticket calls converge to one row/audit/object, including when the
two readers accepted different stable snapshots for either creation or replacement, while
different replacement tickets produce one winner and one version conflict. Controlled canonical `PutObject`, audit and `DeleteObject`
failures prove retry, compensating cleanup and post-commit staging cleanup. A stop immediately
after canonical PUT proves restart recovery reuses one canonical object rather than overwriting
or duplicating it. Legacy non-replacement and already-completed tickets retain safe compatibility;
an outstanding replacement without `replaces_version` is rejected and must be re-initiated.

The completed B-03 matrix is **50/50** in the content service and **86/86** across
content, upload HTTP and R99 ingest. The full isolated backend integration count is recorded
by the latest `CHANGES.log` entry after each cumulative run. The recorder browser harness and
library-recorder harness remain the relevant browser gates.

**Some of the contract lives in headers.** The shared HTTP helper therefore returns
`res.headers` alongside status and body — the calendar bootstrap's `Cache-Control` and `ETag`
are a stated part of that endpoint's behaviour, and a body-only assertion cannot see whether
the policy actually shipped.

## Test the property, not the path

The most important habit on this project.

> ❌ *"The service calls `checkPermission` before returning."*
>
> ✅ *"A teacher requesting another teacher's student receives `404`."*

The first passes when someone refactors the check into something broken. The second fails.

Applied consistently, this is why the suite catches things review does not:

- The mid-transaction **process kill** test — nothing partial persists
- A **suspended teacher denied a presigned mint** within the unexpired-token window
- A **deliberately stalled cache row** repaired by the read-side guard
- **Two concurrent enrolments at capacity − 1** admitting exactly one
- **Every path resolves to a page** — the assertion that would have caught `/dashboard`
  rendering a blank white document

## Assert the exact key set, not the presence of the fields you wanted

A wire-shape test asserts the **complete** set of keys in a response:

```ts
expect(Object.keys(res.body).sort()).toEqual(BRANCH_KEYS);
```

Not `toHaveProperty('name')` for each field you expect. The failure being guarded is a field
**arriving** that nobody chose — and a presence check passes straight through that, cheerfully,
forever.

This is the lesson of Revision 38. `GET /admin/branches` returned raw Prisma rows for months:
four internal columns, `camelCase` names, an instant where TD-11 defines a date. **Every test
stayed green**, because a service test asserts the *decision* and never the *wire*, and the
endpoint had no HTTP-level test at all. Nothing in the suite could have noticed, because
nothing in the suite was looking at the response as a *shape*.

So: an endpoint whose contract matters gets a test that would fail if the contract grew. The
counterpart in CI is [`check-contract-dto.sh`](ci-cd.md#the-guards) — the guard makes the
projection exist, the test makes it *correct*.

### The client half of the same guard

A server-side key-set test catches the **API** drifting. It cannot catch the **client's
declared type** drifting, because `api<T>()` is an unchecked cast — see
[the adapter layer](../architecture/frontend.md#the-unchecked-cast-under-this-whole-layer).
A wrong adapter type compiles, passes every test that builds fixtures from that same wrong
type, and fails only in a browser.

The client-side counterpart is a **fixture literal typed as the adapter's own interface**,
written with the key set the server test pins:

```ts
const WIRE: HijriMonthRow = { hijri_month: 1, month_name_ar: 'محرم', /* …all six keys */ };
```

Rename a field in the adapter and the **typecheck** fails here. That is the check the cast
cannot perform. `pages/admin/hijri-calendar.test.tsx` is the worked example — written after a
type mismatch rendered a whole admin screen blank white with nothing red anywhere.

## Driving a real browser, on real authenticated screens

Vitest here renders with `renderToStaticMarkup`: **no jsdom, no layout engine, no
events, no fetches.** Whole classes of fact are therefore invisible to it — where
a button actually lands, whether a header click issues a request, whether a
dragged row moves. The project has no Playwright and §3.1a forbids adding a
dependency casually, so the browser scripts drive the **installed Chrome** over
the DevTools Protocol using Node's built-in `WebSocket`: no install, no lockfile
change. `scripts/dev/browser/cdp.mjs` is the shared client — connect, evaluate in
the page, record a pass/fail line — extracted when the second script had grown
its own copy of the same twenty lines and a third would have made three.

**None of them runs in CI.** They need a live stack, a real Chrome and (for the
seeded scenarios) a development database, so they are run by hand and their
result is reported in the slice that ran them.

| Script | Answers |
|---|---|
| `scripts/dev/browser/verify-platform-owner-framing.sh` | **R115 end to end on its own disposable real stack.** Operates one/multiple/all/online/both هيئة التأطير registration choices and stale-choice clearing; proves approval and read-only teaching-profile rendering; round-trips stated and legacy-null per-window modes; withholds destructive controls against a synthetic Platform Owner while her edit form adds a branch-scoped Teacher role through the primary Save without losing global Super Admin; transfers between two synthetic Global Super Admins while the current owner is filtered off-page; rejects the former owner's still-live bearer; then checks the exact PostgreSQL singleton, roles, framing and availability rows. Every ordinary phase is bounded and the project, volumes, images, Chrome profile and tagged identities are destroyed afterwards. **Last run: 23/23 plus 8/8 exact database assertions.** |
| `scripts/dev/browser/measure-page-header.sh` | Does the primary action stay put as the description grows, at nine widths |
| `scripts/dev/browser/verify-reorder.sh` | R76 on the five real admin screens: is «الترتيب» gone, is the header a focusable button, does pressing it send `sort_by` to the server, does a dropped row move **and survive a reload**, is the handle disabled and explained when it cannot be used |
| `backend/src/controllers/visibility-matrix.http.integration.test.ts` | **NEW B §E — the visibility authorization matrix over real HTTP.** Three tiers × نشاط/حصة/امتحان × a thirteen-caller cast; `hidden` asserted as a set over the whole cast; direct-by-id gated separately from the list and answering **404, never 403**; the management list asserted **un-gated**; the full 3×3 content independence including `consent_forced_private`; and R91's dated ownership — two occurrences, two main teachers, each reading only her own date. **The suite owns every row it touches under one tag and its before/after snapshot of shared state is identical.** **35/35.** |
| `scripts/dev/browser/verify-content-scope.sh` | **NEW D under a genuine, scenario-owned مؤطِّرة**: `/admin/levels`, `/admin/subjects` and `/admin/academic-years` **still 403** — no permission was widened — while `/me/scope-options` answers her; every مكتبة المحتوى filter populated, including المادة with no Level chosen; choosing a Level narrows المادة to **exactly** that Level's `subject_ids` (the Level is picked from the payload, because the first one in the list genuinely teaches nothing); the **library results change**, not merely the controls; clearing restores the wider set; the Add dialog carries its own determining fields (rule AX); and she still cannot create a Subject. **Last run: 14/14.** |
| `scripts/dev/browser/verify-visibility-ui.sh` | NEW B §D on the real forms: مستوى الظهور rendered for نشاط, حصة دراسية and اختبار and defaulting to عام; a private and a hidden حصة **hydrating from the row**; an unrelated save preserving hidden; an explicit change making the form dirty so closing asks; the NEW H attendance notice present for حصة دراسية/اختبار and **absent** for محاضرة/حفل/عطلة; and the three R50 scopes landing where they should — one occurrence for *هذه الحصة فقط*, the split leaving earlier ones alone and the overridden one keeping its tier, and future occurrences materializing under the successor. **Mutates only the scenario's own schedule**, which `--clean` removes. **Last run: 19/19.** |
| `scripts/dev/browser/verify-scheduling-types.sh` | R110 on the real pages: أنواع الجدولة renders the Owner's five seeded rows **in her order**, with `حضور إجباري` read from the column and three of the five sharing one entity; the الجدولة picker offers the **catalogue rows** and no longer the bare entity label «نشاط»; and the attendance notice follows the flag — present for اختبار, **absent for عطلة**, which is the half that makes it mean anything. **It earned its keep on the first run**, reading `5 → 4 → 3 → 2 → 1` off a catalogue a new integration test had reversed and not restored. **Last run: 10/10.** |
| `scripts/dev/browser/verify-circles-reorder.sh` | R78.1 on the real حلقات المواد page: handle disabled and explained with no `(Level, Subject)` chosen, enabled once chosen, a circle dragged to last and **persisted server-side**, surviving a reload, and ↑/↓ reordering too. Circles addressed by **seeded id, never by title**. **Last run: 9/9.** |
| `scripts/dev/browser/verify-sorting.sh` | The sorting contract **clicked** across four tables: ascending → descending → ascending, exactly one header claiming a direction, non-sortable headers not clickable, the actions column never sortable, and **no row on two pages** of a sorted collection (R76.3's `id` tiebreaker). **Last run: 39/39.** |
| `scripts/dev/browser/verify-approvals-sorting.sh` | **NEW C's owed proof: طلبات الانضمام actually reorders.** The queue holds pending registrations and a healthy development database has none, which is why this table was left out of `verify-sorting.sh`. The harness seeds **three tagged applicants of its own** whose alphabetical order (أ ب ج) and oldest-first submission order (ج أ ب) are **neither the same list nor reverses of each other** — so a screen that dropped the sort parameter and returned its default could not satisfy both assertions. Asserts on the relative order of its own rows only, never the whole table, and removes exactly what it created. **Last run: 7/7.** |
| `scripts/dev/browser/verify-public-calendar.sh` | قائمة and تقويم driven **anonymously**: both views offered, the choice in the URL, month stepping withheld where it means nothing, RTL with the marker on the inline start — and what a public reader must NOT see (no student name, no notification surface, no recordings, **no cancellation reason**). R83 removes a cancelled occurrence from the ordinary projection; `include_cancelled=true` still retrieves it. **Last run: 18/18.** |
| `scripts/dev/browser/verify-library-recorder.sh` | The recorder's second entry point in مكتبة المحتوى, plus the sort indicator's **measured** placement. **Last run: 16/16.** |
| `scripts/dev/browser/verify-error-experience.sh` | Rule AZ where only a browser can answer: the anonymous startup produces **no** visible error and no raw envelope; an offline API call really does reject as a `TypeError` (with the network cut over CDP); the edge really returns **429** when the brute-force zone is exhausted; an unknown route lands on the branded not-found. Per-class wording, codes and identifiers are settled by `error-panel.test.tsx`. **Last run: 5/5.** |
| `scripts/dev/browser/verify-uat-2026-09-02.sh` | **The 2026-09-02 manual-UAT defects**, each asserted as the user-facing behaviour that was reported wrong rather than the implementation under it: `الوصف` on a Level survives a save **and a reload**; `النوع` on الجدول الزمني reaches the request as `type=` (it was computed and never sent); a new activity opens on **`مرة واحدة`**, chosen after the kind is switched, because the kind is picked after the form opens; and the content edit form offers title, Level, Subject and visibility while carrying **no file input** — editing is not re-uploading. **Last run: 5/5.** |
| `scripts/dev/browser/verify-hijri-baseline.sh` | **التقويم الهجري prefills, and never overwrites.** Fills an empty year from the Umm al-Qura baseline, then runs the import **again** and asserts the table did not move and the notice reports twelve skipped rather than twelve added — the property whose failure is silent and would surface as Ramadan on the wrong day. **It refuses to click until the page demonstrably shows its own test year**: the year control is React-controlled and a `change` event alone did not take, so an early run imported into a REAL year that the teardown, scoped to the test year, did not remove (P1.2). The teardown now also removes anything carrying the derived `source`. **Last run: 5/5.** |
| `scripts/dev/browser/verify-teacher-capabilities.sh` | **A مؤطِّرة edits her own المواد and الفئات** — driven as a genuine teacher from the R82 scenario, never a widened Admin token. The two declarations are **operable controls** rather than the read-only text rule AF required while R88.2 stood; a choice saves and survives a reload; and her portal grows **no** administrative link by it. The server half of *grants nothing* is asserted in `teaching-profile.http.integration.test.ts`, where declaring every Subject still yields an empty `/quran-students` and `403` on `/admin/users`. **Last run: 4/4.** |
| `scripts/dev/browser/verify-enrolment-save.sh` | **حفظ on `تسجيل مستفيدة` actually saves.** The reported defect produced *no request at all*: the dialog resolved the enrolment's branch by re-looking-up the pre-chosen مستفيدة in a `beneficiaries_only` directory search, while the page builds its rows from the **union** of that fact and the Student role (R79.7) — so a person on the page could be absent from the dialog's own list, the branch came back `''`, and that both disabled the button and made `submit` return before its first statement. Drives the Owner's exact case (a Level plus a **حفظ القرآن** circle) and asserts **two** `201`s — the enrolment and the circle membership — plus a closed dialog. Seeds its own branch, مستفيدة and Student role and removes all of it, the enrolment included (P1.2). **Last run: 4/4.** |
| `scripts/dev/browser/verify-staff-period-bounds.sh` | **A staffing period is measured against its schedule as it is typed.** It first proves a new row renders with the requested responsible-`teacher` default. A class beginning 30 غشت 2026 with an assignment of 29 غشت → 29 غشت is `STAFF_PERIOD_OUTSIDE_SCHEDULE`, correctly — and the administrator learned it only on Save, from a message naming no field. Asserts the native `min` carries the schedule's start, that the pair is marked and `aria-invalid` on **both** date fields immediately, and then the half no source test can observe: **editing the schedule's own start date re-marks a staffing row nobody touched.** Read-only — it types and never saves. **Last run: 5/5.** |
| `scripts/dev/browser/verify-unsaved-guard.sh` | Rule AY in a browser, both halves: `＋إضافة مقر` **pristine** closes on a backdrop click with no question; **dirty** refuses the backdrop, asks on Escape and on Cancel, keeps the typed value when the reader continues editing, becomes **pristine again** when the value is restored, and closes only on an explicit discard. `＋تسجيل مستفيدة` is re-run as the reference; the real new-item scheduling form also proves its rendered default is `entire_level` before closing pristine. **Last run: 24/24.** |
| `scripts/dev/browser/verify-registration.sh` | **R117's exact parent + two-child journey through real Nginx/SPA/API/PostgreSQL.** Proves the guardian label, prospective required phone before the wire, one request consent, opposite per-child media decisions, two distinct requested Categories/Branches, successful single-use submission, then switches to a real Super-Admin session and clicks the new-registration notification into the exact authorized review. The details dialog must show guardian phone/email and both child blocks with their own coordinates; a stale review id must render the unavailable state rather than blank. Exact tagged DB state is asserted and cleaned. **Last run: 41/41 browser plus 12/12 database assertions.** |
| `scripts/dev/browser/verify-content-visibility.sh` | §14.1's visibility selector, **operated**: not disabled while the default is unknown · shows a placeholder rather than عام for a `null` state · initialises from the Level's Category default · خاص is genuinely selectable and stays selected · the `/uploads/initiate` body carries `visibility: "private"` · a Level change re-proposes the new default. It proves a real library row exposes no «استبدال الملف» action/dialog, while the create dialog still contains editable Level, Subject, Year, Branch and Visibility controls; changing Level inside it re-narrows Subject and re-proposes the tier. Performs a real upload and removes its own row afterwards. |
| `scripts/dev/browser/verify-admin-navigation.sh` | §14.1's back-office menu (R105) **as it renders**: the eleven main entries and the eleven under الإدارة, in the Owner's order, for a Super Admin and for a real Admin — who sees **no heading at all**, since an empty الإدارة would still be a claim. It starts from the real Local landing page with the production-shape `Secure; HttpOnly; SameSite=Lax` refresh cookie, clicks the rendered لوحة التحكم link, and pins the transport regression: HTTP origin, no dead TLS edge, Back/Forward, reload, logout/re-login, the standalone consumed-callback retry state and a fresh tab. Then the half the menu is not: a genuine Admin access token, obtained through `POST /auth/refresh` the way the application obtains one, asking the server for the same destinations. **The reads R61.2 keeps open are asserted alongside the writes it refuses**, because the wrong fix for a leaked write is to close the read — and that breaks every scope selector silently. **Last run: 42/42.** |
| `scripts/dev/browser/verify-teacher-portal.sh` | The مؤطِّرة's portal (R106) driven as a **genuine teacher**, minted as she already is: the six-entry menu in the Owner's order with no headings, `إدخال متى أنا متاحة` **operated** — planning-only notice on screen, حفظ disabled until a range is added — and then the boundary a menu cannot show: her own availability written through a real bearer token, while another مؤطِّرة's profile, the user directory, the curriculum and **editing a class she teaches** (TD-2 `⊘`) are each refused. It also **prints how many classes she staffs**, because §4.4c makes an empty portal *correct* for zero and that number is what tells a reader whether they are looking at seed data or a defect. **Last run: 25/25.** |
| `scripts/dev/browser/verify-sorting-headers.sh` | §6's header sorting **clicked**: a real `<button>` in the `<th>`, `aria-sort` announcing the direction, a second click reversing and a third returning to ascending rather than to unsorted. Covers all three value types on real screens — Arabic **text** and **numeric** size on مكتبة المحتوى (server-side; the descending run reads 31.7 MB → 1.5 MB → 396 KB → 265 KB, which a string compare cannot produce) and **date/time** on الجدولة (client-side over the three-source merge). It also runs the audit in **both** directions: `الهدف`, `التكرار` and `إجراءات` must carry no button. **Last run: 19/19.** |
| `scripts/dev/browser/verify-recorder.sh` | R75 with a **real `MediaRecorder`**: start · elapsed advancing · pause freezing the reading · resume · stop · editable name · save · discard · a second recording numbered « 2» — then the bytes in **MinIO** through a presigned URL, the row in the library, and the link as a *recording* on the Session page. Chrome runs with `--use-fake-device-for-media-capture`, which supplies a synthetic microphone; **the API is not stubbed**. **Last run: 22/22.** |
| `scripts/dev/browser/verify-schedule-edit.sh` | «تعديل العنصر»: the dialog opens with the row's own mode, a seeded المستوى and its own الحلقة; changing only «نهاية التكرار» saves; and `teaching_mode`/`target_id` are untouched afterwards. **Last run: 12/12.** |
| `scripts/dev/browser/verify-notifications.sh` | **Audience/API harness** for R77/R82/R83: cancellation and restoration reconciliation, Event scope recipients, personal calendars, and send/decline/repeat. It calls `/notify` directly, so it proves the server resolver and not the UI button. **Last run: 22/22.** |
| `backend/src/controllers/notification.http.integration.test.ts` + `notification-targets.http.integration.test.ts` + `services/event-staff.integration.test.ts` | **R116's real HTTP/PostgreSQL transition matrix.** Proves the four-target CHECK, account-safe DTO, exact Event/Session/Exam recipients, dual-role distinct meanings, no-op/retry idempotency, remove/re-grant, schedule/detail/cancel reconciliation, and R109 withdrawal: hidden Sessions retain only the teacher, hidden Events only the responsible person, hidden Exams only the supervisor. The run snapshots all application tables before/after. **Last run: 3 files, 74/74, isolation-clean.** |
| `scripts/dev/browser/verify-notify-ui.sh` | The real sender-to-recipient flow: clicks the UI decision, records the page's request, then opens the recipient's own bell. Covers Session cancel/reschedule, Event create and delete/cancel, unrelated recipients, grade publication, R91 staffing and R92 cross-branch audience. |

### Testing the Google identity boundary without trusting a fixture token

OAuth verifier tests do not call live Google services and do not replace cryptographic
validation with payload decoding. They generate an ephemeral RSA keypair, sign deterministic
ID tokens locally, inject only the corresponding provider-certificate response, and run the
real Google Auth Library verifier. The matrix includes a valid token, invalid signature,
expiry, wrong issuer, wrong audience, malformed/unsupported headers, unknown key, missing
identity claims, unverified email and signing-certificate retrieval failure.

The code exchange has a separate narrow verifier seam, and the callback exposes that same
dependency only to tests. A callback test carries a valid signed flow-state cookie and PKCE
verifier through the production handler, rejects a decodable forged token, and proves that
account resolution is never reached. Identity binding and pre-provisioned-account resolution
remain covered by the database integration suite; no test seam grants a role or bypasses
those services.

### Getting past the login wall without bypassing it

Every `/admin/*` screen needs a session, and the only issuer is Google OAuth
(§4.1b) — which a headless browser on a developer machine cannot complete. That
is not a reason to skip browser verification; it is a reason to provision a
session properly.

`scripts/dev/issue-dev-session.sh` mints one by calling **`issueNewSession`, the
production code path the OAuth callback itself calls**, and prints the raw token
to be set as the ordinary `bodour_refresh` cookie at `Path=/api/v1/auth`
(TD-12, R101), exactly as the server sets it. **Nothing about authorisation is
bypassed**: the user is an ordinary `super_admin` row, and every request it makes
is checked by the same TD-2 rules as any other. What is replaced is the identity
*provider*, and only in a development database — the script refuses to run
against a non-loopback `DATABASE_URL` or with `NODE_ENV=production`.

It takes an optional user uuid:

```bash
bash scripts/dev/issue-dev-session.sh              # the script's own Super Admin
bash scripts/dev/issue-dev-session.sh <user-uuid>  # an existing user, as they are
```

The admin-navigation browser guard sets that token with the real cookie attributes, including
`Secure`, even though the Local origin is `http://localhost`. Localhost is the deliberate
secure-context exception; tests must never make the result green by weakening cookie
attributes. The Local Compose edge is correspondingly HTTP-only and loopback-only on both
`127.0.0.1` and `[::1]`. The browser harness probes both families before opening Chrome:
`localhost` resolution may change between connections, so an IPv4-only edge can serve the
landing page and still refuse a later full-page Dashboard navigation before Nginx sees it.
A harness that inherits or publishes a dead port 443 can instead turn that navigation into a
TLS reset, so the Compose operations guard pins the complete port boundary as well as the
browser result.

The authentication integration coverage drives both cookie consumers over HTTP. It proves a
refresh rotates first, logout receives that successor, the persisted chain is revoked, a
retained copy is refused, another device still rotates, repeat/missing-session logout is
idempotent, and the response clears the cookie with the matching Path and security attributes.
The service-level R101 coverage uses explicit barriers around the real PostgreSQL session lock —
never timing sleeps — to force both ordinary orderings: refresh identifies first but logout
locks first, and logout identifies first but refresh locks first. A controller-level HTTP test
then pauses the refresh after its rotation transaction but before final access-token issuance,
lets logout commit, and proves the resumed response is `401` with no credential. The purge race
holds rotation before successor insertion, queues purge on the stable session row, then queues
logout while purge owns it; after the predecessor is deleted, logout still revokes the exact
successor. The companion after-insertion case proves purge leaves that successor usable.
A controlled mandatory-audit failure occurs after the real revocation write and proves the
enclosing database transaction rolls that write back; the same test then proves the successful
path commits both revocation and `auth.logout`.
The user-wide R101 race coverage uses a second set of explicit barriers around the production
User-row lock. In the suspension-first ordering, OAuth resolution has already read Active but
final issuance waits; suspension commits and the resumed callback re-reads Suspended, redirects
to the existing deactivated contract, and creates no access token, cookie or session. In the
login-first ordering, the callback holds the User lock while creating its anchor/token/audit;
suspension waits, then enumerates and revokes that new anchor together with two older sessions.
An unrelated user's login completes while the target is blocked, proving the lock is not global.
A forced `auth.login` audit failure proves the new anchor and token roll back before any
credential reaches the response.
The auth hardening companion coverage drives two additional database-level crossings. A refresh
holds its real session anchor immediately before successor insertion while suspension holds the
User governing lock and queues on that anchor; the successor's implicit User FK `KEY SHARE`
finishes, then suspension revokes it and refresh finalization refuses. Logout is forced through
the analogous ordering immediately before its mandatory audit insert. Both use explicit barriers
on production repository calls rather than sleeps, proving `FOR NO KEY UPDATE` removes the old
FK-lock cycle without weakening the business outcome. The same suite forces both
suspension-versus-first-binding orders: suspension-first writes neither identity nor binding
audit, while binding-first commits both before final credential issuance observes suspension.

Active-role HTTP coverage uses a bearer minted 50 minutes in the past, logs out its refresh
session, and switches the same role twice. Both replacements retain an `exp` no later than the
original, while authoritative suspension and deletion each refuse switching. Refresh lifecycle
coverage moves a Pending account to terminal Rejected and proves repeated presentation returns
no credential; a Pending control still rotates for its status-screen session. It also reactivates
a suspended account and presents its old cookie, proving reactivation never reverses durable
session revocation. Durable immediate
revoke-all on Pending → Rejected remains an Owner decision because TD-4.15 currently enumerates
only suspension and deletion and the revocation-reason enum has no rejection value.
The R101 rollout test executes the committed data-migration SQL inside a rolled-back database
transaction, so it verifies revocation and system audit without signing out local developers.

**With a uuid it grants nothing.** The Super Admin role is created only for the
script's own default user; a user named on the command line is minted for exactly
as they already exist. That distinction is the whole point of the argument:
verifying a student's own screens has to exercise a student's real authorisation,
and a script that quietly widened it would be verifying a session nobody has.

### The scenario the browser reads

`scripts/dev/seed-dev-scenario.sh` builds the association's own case in the
development database and prints the ids as one JSON line:

    المرأة — وميض الأمل · تفسير · كل اثنين 15:00–17:00 · تاركة · القاعة 5
    صفاء (أستاذة) · أمينة (مساعدة) · مستفيدة مسجّلة · مستفيدة غير معنية

The occurrences come from **`materializeSchedule`, the production materializer**,
so what the browser then reads is what the platform would really have made —
including the R43.4 staffing snapshot each Session carries. The unrelated
مستفيدة is the control: she is enrolled in nothing, and a notification reaching
her would mean the audience is not the audience.

Every row it writes is tagged `[dev-scenario]`, and **`--clean` removes exactly
those rows and nothing else**. It is idempotent — it cleans before it seeds — and
`verify-notifications.sh` traps `EXIT` to clean up after itself, so a run leaves
the database as it found it. Same guards as the session script: it refuses
`NODE_ENV=production` and a non-loopback `DATABASE_URL`. It is local development
and browser verification only; nothing in CI or in any suite calls it.

### What browser verification found that no test could

The R76 drag worked from the keyboard and did nothing on a synthetic drag
sequence. The cause was real and would have bitten a real user on a fast
pointer: `dragstart` and the first `dragover` can arrive **in the same task**, so
a handler reading only React state sees `null` and never begins. The dragged row
and the arrangement in progress now live in refs; state drives the styling, the
refs drive the logic.

The lesson generalises: *a behaviour that depends on a re-render happening between
two events is a behaviour that works only when the machine is slow enough.*
Neither a unit test nor a code reading would have asked.

The R77 run found nothing wrong with the application, and two things wrong with
the harness — worth recording because both are traps a later harness will set
again:

* **It aimed at an occurrence already past.** `restoreSession` refuses that with
  `STATE_CONFLICT / SESSION_IN_PAST`, because reinstating a class that has
  already not happened would put a session on the calendar claiming it did. The
  refusal was correct; the harness was aiming at the one occurrence the scenario
  cannot be run against. It now takes the next Monday ahead of today.
* **It matched occurrences by title.** Other suites seed their own `تفسير`, so
  the filter picked up an occurrence belonging to a different schedule. Selection
  now comes from `GET /admin/course-schedules/{id}/sessions` — the same read the
  admin screen uses before offering «إلغاء» or «استعادة». **The schedule is the
  identity; a name never was.**

The R75 run found **three real defects and no harness fault at all**, which is
the strongest argument for this kind of verification the project has:

* **Every recording was refused by the server.** TD-9's whitelist compared the
  whole declared MIME string, so `audio/webm;codecs=opus` — exactly what
  `MediaRecorder` produces — read as a foreign type. A media type is its essence
  plus parameters; that string *is* `audio/webm`.
* **The recording vanished the moment it was saved.** The dialog read the
  Session page anonymously, and that endpoint is public *at the caller's tier* —
  so it returned the public tier while a fresh recording is private. The
  numbering rule then computed its suffix from an empty set and produced **two
  recordings with the same name**, the exact overwrite R75.6 exists to prevent.
* **Uploads declared a Group as their Level**, because the sessions page read
  `levelId` from `target_id`.

None of the three is visible from source, and each needed the *next* step to
expose it — the whitelist refusal only appears once a real container reaches the
server, and the tier bug only once a private row exists to be hidden.

**The trap that caught this session twice, stated plainly:** a probe that
identifies a row by what it *renders* rather than by its **id** will one day
match a different row. The public-calendar check matched an occurrence by date
and found one another probe run had left behind — correctly not cancelled — and
reported the rendering rule broken. Identity now comes from the API. The same
mistake is why the recorder harness once matched a `تفسير` belonging to another
schedule.

A third correction was in the harness's own bookkeeping rather than its aim:
TD-4.13 **rotates the refresh token on every use**, with reuse detection behind
it, so re-presenting the token the script was handed works exactly once per
identity. Switching between three sessions means carrying each one's *rotated*
cookie forward — which is what a second person on a second device actually is.

## Source-text tests cannot see a browser

The visibility selector shipped once with tests that passed and a control nobody could
operate. Two of its three defects were **browser behaviour, not code**:

- `busy` mapped to `disabled`, so the control was present and inoperable;
- `value=''` with no matching `<option>` made the browser render the **first** option — عام —
  for a state that was actually `null`, so the control displayed a tier it did not hold and
  did not send.

Neither is visible in source. The tests asserted on the file's text and on the adapter, and
both assertions were true while the screen was broken. **A test that reads source cannot
observe a disabled attribute, a browser's first-option fallback, or what a `<select>` shows.**

The rule this leaves: **when the property is what a person sees or can do, the test has to be
a browser.** `verify-content-visibility.sh` operates the real control and reads the real
request body, and each of the two defects was reintroduced to prove it fails — the repository's
standing requirement that a guard be proven against the defect it exists for.

One further honesty note, recorded because it is the kind of thing that otherwise becomes
folklore: a **third** defect was suspected from reading the code — an effect overwriting a
deliberate choice — and could not be demonstrated in the browser. The implementation still
guards against it because doing so is cheap and states the rule legibly, but no check claims
to catch it, and the harness says so where it would otherwise be read as protection.

## Four environment traps the integration suite sets

**Running the full suite repeatedly hits the real Nginx rate limits.** The stack
under test is the production one, limits included, so a second or third full run
inside the same minute can exhaust the auth zone and fail whichever
`auth-refresh` assertions happen to land last. The signature is a **`429` where a
`200` was expected, moving to a different test each run** — a genuine failure
stays put. Confirm by running that one suite alone; if it passes, the code is
fine and the window simply needs to elapse.

**The API container serves the HTTP suites, so ANY backend change needs a
rebuild — not only a schema change.** This is stated more broadly than it first
was, because the narrow version produced a false green: a branch-visibility
change was committed after a full suite run that had exercised the *previous*
build. The suite was truthful about the container it hit and silent about the
code that had been written. The failure surfaced one commit later, looking like
a regression in unrelated work.

A green HTTP suite means *the running container passes*. Rebuild before you
believe it about your own change.

### The same trap on the client, and it has no test to catch it

**Nginx serves `frontend/dist`, a static build mounted read-only** — not a dev
server. `npm test` and `npx tsc` run against `frontend/src`, so the whole
frontend suite goes green on code the browser is not running. Nothing in CI or
in any suite observes the gap.

It surfaced exactly as you would expect: a slice removed `/dashboard/parent` and
was verified green, and the Document Owner then reported that the interface
still offered it. Both were true. `dist` was three commits old.

**`cd frontend && npm run build` after any frontend change, before believing
anything you see in a browser.** If a screen still shows what you just deleted,
check the bundle before you debug the code:

```bash
curl -s http://localhost/ | grep -o 'assets/index-[^"]*\.js'   # which bundle is served
curl -s http://localhost/assets/index-XXXX.js | grep -c 'the string you removed'
```

**The original wording, still true:**
`*.http.integration.test.ts` calls the running container, not an in-process app.
After a migration the container still holds the previous Prisma client, so a
dropped table surfaces as a `500` — or, where the route degrades, as an
unexplained empty result rather than an error. Rebuild `api` before running
those suites. (Health lives at the **origin root**, `/healthz`, not under
`/api/v1/` — a `401` there means you asked the guarded router, not that the API
is unwell.)

**Run the suite through `scripts/dev/test-integration.sh`, never `vitest` directly.**
`.env` is canonical and **container-shaped** (TD-13): `DATABASE_URL` names the
`db` service and `MINIO_ENDPOINT` names `minio`, hostnames that resolve only
inside the compose network. The script rewrites both to the loopback ports the
dev overlay publishes. Sourcing `.env` and calling `vitest` yourself rewrites
neither — or, worse, rewrites only the database, which is the confusing case:
**48 suites pass and the storage suite fails twelve times** with `no object at
the initiated key`, which reads as a broken presigned-upload implementation and
is a hostname that does not resolve.

Lifecycle purge coverage belongs in a real database suite. In particular,
`trash-lifecycle.integration.test.ts` asserts the actual `RESTRICT` graph and transaction
rollback: parent deletion snapshots exact owned-child ids, an independently deleted child
cannot be swept by a later parent purge, and leaf purge/unique-pair revival leave no stale
Trash. A repository mock cannot prove any of those properties.

**A queue must be registered before anything can be enqueued into it.**
`pgboss.job` is partitioned by queue name, so adding a job to the TD-7 catalogue
means the **worker process must restart** before any test can insert one — until
then the insert fails with a foreign-key violation on `q_fkey`, which reads like
a schema bug and is not one. Rebuild the API container after adding a queue.

## A fixture must not leave the application unrunnable

Every suite touching registration upserted `legal.consent_text_version` in
`beforeEach` and **deleted it in `afterAll`**. Running
`npm run test:integration` therefore left the developer's database with no
consent text version, and registration then failed closed with a `503` for
everyone who used the form afterwards.

The failure was doubly confusing: **the tests were green, the application was
broken, and the tests were the reason.**

Two lessons, both now enforced in code:

- **"Clean up after yourself" means restore what was there, not delete what you
  used.** `test-support/consent-setting.ts` captures the prior logical row once
  per suite and puts it back — value, version and updater, including *absent*,
  which is a real state the suites deliberately exercise. Restoring only the
  JSON while incrementing the version still changes shared application state.
- **Capture once, not per test.** A `beforeEach` capture would re-save whatever
  the previous test left, so the suite would "restore" its own scratch value
  rather than the developer's.
- **Track ownership when the coordinate is created.** Registration fixtures
  record the exact random onboarding-token JTIs they issue, then delete only
  those coordinates. A before/after database delta is unsafe too: a real user
  can finish registration during the sweep, and deleting that newly observed
  replay guard would make their spent token usable again.
- **Run platform-wide destructive repository proofs inside a rolled-back
  transaction.** The audit-purge suite uses a per-run marker and a fixed clock,
  then deliberately rolls back the purge. It can prove the production query
  without consuming an ambient audit fact that happens to resemble a fixture.

### The same failure, a second time: a global invariant needs global fixtures

It recurred while testing `LAST_SUPER_ADMIN`, and the shape is worth naming
because the first lesson did not prevent it.

That guard **counts across the whole database** — *is this the last active Super
Admin anywhere* — so proving it fires means making the target genuinely the
last. The first version revoked the `super_admin` **role assignment** of every
other holder, including real seeded accounts outside the suite's own `TAG`
namespace, and restored only the spare it had created itself. It left the
development database with **zero active Super Administrators**, locked out of
its own back office, and every test passed.

Recovering it meant hand-restoring two `user_branch_role` rows identified by a
shared `deleted_at` timestamp and a null `deleted_by` — the fingerprint of a
`updateMany` rather than of a person.

**Three rules, in order of how much they buy:**

- **A fixture may create and destroy rows it owns; it may only ever *borrow*
  rows it does not.** The `TAG` prefix convention marks ownership, and a
  `where` clause without it is the smell.
- **Prefer no ambient mutation.** The original rewrite borrowed
  `account_status` rather than revoking grants, but R115 makes even that obsolete:
  the Platform Owner cannot be suspended. The current singleton/bootstrap suite
  observes the seeded Owner and creates its own synthetic eligible successors;
  it never parks or rewrites any ambient administrator.
- **Restore in `finally`, not at the end of the happy path.** The original
  restore was the last statement of the test, so any earlier assertion failure
  skipped it. A guard this consequential must survive its own test failing.

**Why no code enforces this yet:** the check would have to know which rows a
suite owns, and `TAG` is a convention rather than a column. The cheap
approximation — assert in `afterAll` that at least one active Super Admin
exists — is now part of the test itself.

### And a third time, from the other direction: teardown ORDER and tag overlap

Revision 49 added `User.intended_category_id` as `ON DELETE RESTRICT`, and two
teardown bugs surfaced within an hour. Both looked like logic failures. Neither
was.

- **`clearPlacement` ran before the suite deleted its users.** A Category still
  named by a pending applicant refuses to go — *the constraint working exactly as
  designed*. Shared cleanup helpers must run **after** the rows that reference
  them, and the helper's docstring now says so rather than leaving each caller to
  rediscover it.
- **The placement fixture was tagged `${TAG}p`, which `startsWith(TAG)` matches.**
  The suite's own `clear()` swept the placement's Branch before its
  Administrative Group was gone, and `Restrict` refused again. Fixture tags must
  be **disjoint namespaces, not prefix extensions** — `[appr-test-place]` rather
  than `[appr-test]p`, because the closing bracket is what separates them.

**Both produced nine to fourteen red tests across unrelated files**, including
pagination and permission tests with no connection to the change. That breadth is
the signature: **when a failure list spans files with no common subject, suspect
the fixture, not the feature.**

**A failed teardown compounds.** Each crashed run left its rows behind, and after
three runs `listUsers`' first page of 25 no longer contained the user a
visibility test expected — a *real* test asserting a *real* rule, failing on
accumulated debris. The development database had to be purged by hand before the
suite could be trusted again. **A red teardown is never "just cleanup"; it is the
next run's false failure.**

### A fourth time: a tag in a MUTABLE column is not a handle (2026-08-28)

Every suite here identifies its own rows by a `TAG` prefix and sweeps them with
`startsWith(TAG)`. That works precisely as long as nothing under test rewrites
the tagged column — and R111's whole purpose is to rewrite one:

```ts
await prisma.user.update({
  where: { id: departed },
  data: { deletedAt: new Date(), nameArabic: "حساب محذوف" },
});
```

Two tests in `administrative-group.http` do this. After each of them the row no
longer answers to the TAG, the teardown found nothing, and the full sweep leaked
**two users per run** — caught by the all-table snapshot guard as
`user 25 → 27`, and invisible to the suite itself, which passed 26/26 every
time.

**The fix is to hold a handle the test under test cannot destroy: the id.**
`makeUser` records into a `createdUserIds` array and the teardown deletes the
**union** of the name query and the recorded ids — the shape
`user-management.http` already used, for exactly this reason and against exactly
this feature.

Generalised: **a fixture's handle on its rows must live in a column no test
writes.** A tag is a convenience for finding rows a helper did not record; it is
never the only handle when the subject under test is a mutation. The tell is a
suite that is green and a snapshot that is not — which is the whole reason the
snapshot guard is all-table rather than per-suite.

## Assert that a failure is ACTIONABLE, not merely that it fails

There *was* a test for the missing consent version. It asserted
`code: 'SERVICE_UNAVAILABLE'` — and passed throughout, because the code was
right. What it never asserted was that the failure told anyone what to do, so
the empty `details` that made the form say *"try again later"* was invisible to
it.

A test that pins only the status pins half the contract. Where a failure carries
a cause, assert the cause.

## The named regression tests

These are the traps the specification exists to prevent. Each has a dedicated test:

- Ramadan **DST wall-clock stability**
- Consent revocation **rippling through to bucket migration**
- Teacher **global-scope rejection**
- **Re-upload cache-key immutability**
- **Retained completed-upload PUT mutates staging only**, including a forced verification/copy race
- Pending-session **data-access denial across all endpoints**, plus the client route guard
- **Child-context verification on every student-context endpoint**, including the
  Student-role bypass and the foreign-parent `404`
- **Quran log deletion synchronously un-completing a level**
- **Onboarding-token replay → 409**
- **Presigned PUT/GET round trip through the storage proxy**
- **Case-variant Google email resolving to one identity**
- **Stale-version edit → `VERSION_CONFLICT`** (two admins, one group)
- **Concurrent roster adds at capacity − 1 admit exactly one**
- **Double approval: first wins, second `409`**
- **MinIO down: content 503s while scheduling and grading stay functional**
- **Workers down: enqueues succeed and jobs drain on restart**
- **Body-email substitution against a valid onboarding token is ignored**
- **Suspended teacher denied a presigned mint** within the token window
- **Self-healing cache repairs a deliberately stale row**
- **First draft save initializes absent-zero rows for the full roster**
- **Concurrent teacher score vs admin override → `VERSION_CONFLICT`**
- **The 31st upload in an hour → `429`**, and two concurrent initiations at the boundary
  admit exactly one
- **Replayed refresh token outside the grace window revokes the whole session**
- **Suspension revokes refresh tokens inside its own transaction**
- **Two-tab concurrent refresh rotates exactly once and logs nobody out**

## Cross-channel email ownership is a database concurrency test

`email-ownership.integration.test.ts` coordinates the production
`lockNormalizedEmail` boundary against real PostgreSQL. It never substitutes an in-memory
mutex and never sleeps to guess which transaction won. Four properties are pinned:

- an onboarding token issued before staff pre-provisioning cannot create a second account,
  remains unconsumed on refusal, and a later verified login binds the intended staff account;
- registration and pre-provisioning arriving from an initially absent, case-varied address
  produce exactly one committed owner and one expected duplicate conflict;
- registration committed first prevents later pre-provisioning from opening the other channel;
- a forced failure after lock acquisition rolls back both the ownership write and a newly
  inserted lock row, after which the same legitimate operation succeeds.

Successful ownership tests delete the lock rows for their own generated addresses. The rows
have no User foreign key by design, so deleting tagged Users alone is no longer sufficient
test cleanup.

## The token lifecycle is specified as tests

The refresh chain is *the only part of the system where a single missing check silently
extends a 30-day credential*, so it is specified as twelve pass/fail criteria rather than
prose:

| # | Criterion | Expected |
|---|---|---|
| T1 | Refresh with the current live token | New access **and** refresh token; predecessor revoked; one transaction; audit written |
| T2 | Tokens are never stored raw | Only the hash persists — **a database dump yields no usable credential** |
| T3 | Immediate predecessor **within** 10 s | Accepted; **no third token minted** — the chain does not fork |
| T4 | Immediate predecessor **after** 10 s | Refused as reuse |
| T5 | Anything older, or already revoked | **Whole session revoked**; two audit rows |
| T6 | Logout | Revokes **only** the current session; another device keeps working |
| T7 | Revoke-all | Every live token revoked; **no user-facing route exists** |
| T8 | Suspension | All tokens revoked **in the suspension transaction** — verified by refreshing immediately after |
| T9 | Soft delete | As T8, with a different reason |
| T10 | Past expiry | Refused; a purged token refused identically — **fail-closed** |
| T11 | Revoked token, any age | Never accepted, never resurrected |
| T12 | Concurrent refresh, two tabs | **Exactly one** rotation; the loser absorbed by grace, not logged out |

## Mutation testing

Used as standard practice, and it has repeatedly caught defects that inspection missed.

**But: a surviving mutant is worth distrusting until the mutation is proven to have
shipped.** Three separate false negatives here traced to harness problems, not to genuinely
robust code:

| Cause | Symptom |
|---|---|
| The mutation broke the build, so the container kept the **old image** | Every mutant "survived" |
| The shell did not word-split an unquoted variable, so the runner received **one giant filename** and ran **zero tests** | Every mutant "survived" |
| The runner uses a **different failure format** for single-file runs | Failures parsed as passes |

**Verify the mutation actually shipped before drawing a conclusion from it.**

## Testing the guards

Every CI guard was proven by **reintroducing the bug it exists to catch** and confirming the
build went red.

The display-identity guard was proven by planting an inline fallback in the calendar
service — rejected with file and line, passing again once reverted. The header-navigation
guard was proven by re-declaring the burger after its media query.

A guard that has never failed is a guard nobody has tested.

## The `auth-refresh` flake, and what it actually was

**Resolved 2026-08-05.** Worth keeping because the wrong hypothesis was reasonable and cost a
session, and because the diagnosis is a reusable method rather than a fact about one test.

**The symptom.** Green in isolation, 8/8, repeatedly. Inside the full sweep: intermittent
failures across four consecutive runs — **1, 0, 0, 3** — on **different tests each time**,
always inside *the CSRF posture (TD-12)*.

**The wrong hypothesis, recorded because it was plausible.** Non-determinism plus
isolation-passes reads as cross-file interference over the shared container and database, and
two candidates fit: the `beforeEach` re-issuing a session while another file's request is in
flight, and `purgeExpired`, the one delete in the codebase not scoped to a test tag. **Both
were wrong.** `purgeExpired` only removes genuinely expired rows, so a freshly issued token
survives it.

**What resolved it was reading the failure, not the test.** The assertion message said
`expected 429 to be 401`. Not a data problem at all:

> **`limit_req_zone` keys on `$binary_remote_addr`, and the entire suite arrives from one
> host.** TD-13's ceiling models *a person using the platform*; it does not model a test
> runner. As the suite grew past ~680 tests, it started tripping — which is why the flake
> appeared to worsen over time rather than randomly.

**The fix is in the dev overlay only** — `nginx/snippets/rate-limits.dev.conf`, mounted over
`rate-limits.conf` by `docker-compose.dev.yml`. **Only the zone rates change.** Every
`limit_req` directive, zone assignment and burst stays exactly as production has it, so a
misrouted zone still fails here rather than in production, and no TD-13 number moves.

Three alternatives were rejected, each for a reason worth keeping:

- **Retrying on 429 in the test** — hides the interference, which then resurfaces in a suite
  whose failure is not so obviously spurious.
- **Dropping `limit_req` from the dev routing** — stops exercising the limiter at all.
- **Raising the production numbers** — bends a normative value to accommodate a test harness.

**Verified by three consecutive clean sweeps** (688/688 each). One would have proved nothing:
the flake's whole character was that it passed sometimes.

### The method, which generalises

**Read the failure message before theorising about the harness.** The status code named the
cause in the first run that printed it; two sessions of plausible reasoning about FK ordering
and purge scoping did not. A flake is still a defect with a mechanism, and the mechanism is
usually in the output already.

## What is not tested, and why

- **No load-testing infrastructure runs continuously.** Latency targets are verified against
  ceiling-scale fixtures before launch. There is no metrics stack to regress against.
- **Browser matrix testing is E2E-only**, at the audio-playback level where containers
  genuinely differ per browser.
- **The staging origin never exercises authenticated flows** — it is cross-origin by design,
  so those run against the local same-origin stack and the production rehearsal.

## Browser harnesses and the traps they have paid for

Two recorded once, because both were mistaken for product defects:

**Never mint a second access token while the app is running.** The app refreshes
on load; a harness refreshing again against the cookie it had just rotated is
exactly what TD-4.13's **reuse detection revokes a session for**. The first read
succeeds and everything after it answers `401`, which reads like a broken
feature. `verify-notifications.mjs` mints **once per identity** and reuses it.

**`/auth/refresh` compares `X-Requested-With` literally** — the value must be
`XMLHttpRequest` (TD-12's CSRF posture). Any other value is `AUTH_REQUIRED`.

**One refresh chain, one rotating browser credential.** Refresh and logout are
the only two consumers (R101), but a harness that drives the API *and* loads the
app still needs a **separate session per phase**: the page's own refresh rotates
the cookie, and the other phase's mint then fails. The symptom is a dashboard
stuck at «جارٍ التحميل…», which reads as a missing feature.

**A fixture user needs the ROLE its screen is gated on**, not only the domain
fact. A beneficiary with an enrolment but no `student` role renders the error
state — reported once as a missing calendar.

**A negative check that cannot fail proves nothing.** In the same harness, every
*unrelated person sees nothing* check passed while the reads were 401ing —
an empty list because the request failed is not the same fact as an empty list.
The inbox helper now reports a non-200 rather than swallowing it.

**A harness that finds its target outside the scope it clicked in will pass
while testing something else.** `verify-teaching-profile` clicked a row's action
and then searched the **whole document** for the dialog it opens, so it opened
whichever مؤطِّرة sorted first and read *her* stale data as proof that a save had
persisted. Three checks were green and all three described the wrong person.
Scope the query to the row, and assert **whose** record the dialog is showing.

**A loading state is not a ready one.** `verify-sorting` and `verify-reorder`
waited for `.datatable__skeleton` and then accepted `.state` as ready — but the
shared `LoadingState` renders `.state[role="status"]`, so the *loading* state
satisfied the *ready* predicate. Both failed intermittently, naming a screen that
worked; the tell was «جارٍ التحميل…» sitting in the diagnostic.

**Discriminate a control by what it OFFERS, not by its label.** `verify-staff-picker`
looked for the lead selector by label text and got an empty result the moment the
catalogue said «المؤطّرة المسؤولة» rather than «المؤطّرة»; matching on the fixture
tag alone then found the *Branch* selector, whose one option was the seeded
branch. It now matches the select that offers a seeded مؤطِّرة **by name**.

**A fixture that takes whichever row sorts first asserts something nobody chose.**
`seed-r82-scenario` read `subject.findFirstOrThrow({ deletedAt: null })` and
titled its schedule «حلقة الحفظ» on the strength of it. That Subject carries
`tracks_quran_progress: false`, so R87 §M **correctly** hid «إدخال الحفظ» from a
مؤطرة who staffs no Quran class — and `verify-portals` reported the correct
behaviour as a defect. Seeds create the reference data their assertions turn on.

**A fixture created with a raw insert has no occurrences.** `seed-r91-scenario`
wrote its schedule with `prisma.create` and every per-date assertion came back
empty — materialization lives in the **service**, and the thing under test was
exactly that materialization snapshots each occurrence with the staff effective
on its own date. The seed calls `createCourseSchedule`; a seed that wrote the
Sessions by hand would be re-implementing the behaviour it exists to prove.

**Navigate to the route that exists.** The same harness read an empty menu for a
مؤطِّرة whose roster and marker were both correct, because `/dashboard/teacher` is
not a route — the teacher portal is `/teacher`, and «الصفحة غير موجودة» has no
menu. **Check what the page actually rendered before believing an absence.**

**`.admin-nav a`, not `nav a`.** All three portals render the same `PortalShell`
(rule AP), and its menu carries that class.

**A harness must not substitute an API call for the action under test.**
`verify-notifications` POSTed to `/notify` itself and was green for weeks while
manual use did not behave: it proved the audience resolver and never touched the
button a person presses. The rule is narrow and worth stating plainly — *if the
requirement is that the UI sends the request, the harness must make the UI send
it*, and nothing below that layer is evidence about it.

**And a notification is proved by reading it as the recipient.** Not a row in
the table, not a 200 from the endpoint, not a string in the bundle:
`verify-notify-ui` logs in as the student and asserts the Arabic sentence in her
own bell.

**Two ambiguities that made a working feature look broken**, both fixture-side
and both worth recognising by shape:

* **A label matched loosely picked development data.** The event scope was
  attached by matching «وميض الأمل», and the dev database already holds a Level
  by that name — so the activity was scoped to a Level the fixture's student is
  not enrolled in, the send correctly reached nobody, and the harness reported
  the feature broken. Match the **tagged** name.
* **A selector that named nothing reported a missing control.** The unread count
  is `.bell__count`; the harness looked for `.bell__badge`, found nothing, and
  called the count missing while the panel plainly showed one.

**Reproduce against the reporter's own rows before building a fixture.** Both
notification failures the Owner reported were invisible to a tagged scenario. The
Level cancellation resolved *correctly to nobody*, because the only beneficiary
enrolled in that Level at that branch was the administrator's own account and
R78.3 excludes the actor — a fact only the real ids showed. A fresh fixture would
have passed and taught nothing.

**And a zero-result success message hides a whole class of failure.**
«أُرسل الإشعار إلى 0 من المعنيين» reads as *done*. When an action resolves to
nobody, say so — the count is the answer, not a detail of it.

### Running them is what makes them coverage

On 2026-08-19 all nineteen harnesses were run for the first time in one pass.
**Three could not have been counted**: one asserted a rule R83 had reversed and
read markup R84 had replaced, one was reading a correct behaviour as a defect,
and two were racing the loading state. All three had existed, been cited in the
documentation, and been treated as coverage. A harness nobody runs decays against
the product exactly as documentation does — and it decays *silently*. The current
inventory, with the count each one actually produced, is in
[qa-inventory](qa-inventory.md#browser-harnesses-that-exist-today).

### `?raw` on a `.css` file yields an empty string

A CSS invariant written as a vitest assertion — `import css from './x.css?raw'`
— reads `''` under this setup, so the guard passes while checking nothing. It
has happened twice now; the second time (2026-08-20, the shared `ProgressBar`)
it was caught only because the assertion checked `length > 0` first.

**CSS invariants belong in `scripts/ci/`**, as shell guards over the file
itself. And whichever layer a new guard lives in, **prove it against the defect
it exists for before counting it as protection** — the tell is a guard that has
never failed, not even while being written.

**Grep guards must strip comments first.** `check-progress-css.sh` initially
failed on the component's own docstring, which *explains* why `transform:
scaleX()` was rejected. A guard that cannot tell prose from code fails on the
documentation recording its own reason.


### Fixtures consume the one Production memorisation marker

`Subject.tracks_quran_progress` has a **partial unique index** — at most one live
Subject may carry it (R73.4/R107–R108), because two would make *which* teaching authorises
a log ambiguous. In Production it belongs only to حفظ القرآن. Quran integration
and browser fixtures consume that seeded row through a shared fail-closed helper;
they never create or delete the reference Subject. The R91 Tafsir fixture consumes
the separate, unmarked تفسير القرآن row. This makes concurrent fixtures compatible
with the uniqueness invariant and makes missing, duplicate, or wrongly named marker
data fail with a legible R107/R108 setup error.

The tagged-Subject cleanup remains in the older scenario scripts solely to recover
residue created by pre-R107 versions of those fixtures. Current teardown removes only
the fixture-owned joins and retains the Production Subjects.

### The Production Subject seed has its own fresh-database drill

Run `bash scripts/seed/verify-production-seed.sh`. It starts a disposable PostgreSQL 18
volume, applies every migration, executes the **actual** Production seed entry point twice,
and then checks the R107–R108 boundary through the real policy and Quran service. It also boots
the real API/pg-boss catalog against disposable MinIO, runs all 18 integration files affected
by the reconciliation, and round-trips all eight changed scenario seeds on that same stack:

The drill's internal S3 client uses its loopback MinIO endpoint, while its browser-facing
`STORAGE_BASE_URL` is the exact same-origin `${PUBLIC_BASE_URL}/storage` coordinate required
by §3.1. The latter is configuration validation in this seed-focused harness, not a claim that
the harness's direct API listener is an Nginx storage proxy; production-shaped proxy traffic is
covered by the disposable full-stack CI gate.

- the exact eight seeded Subjects exist once, with stable ids and timestamps across the second run;
- القرآن الكريم, محو الأمية, the ambiguous bare تفسير, and separate ترتيل/تجويد synonyms are absent from a fresh seed;
- Super-Admin additions, later Quran-domain Subjects, and historical rows survive a rerun unchanged and unmarked;
- exactly one live marker exists and it is حفظ القرآن;
- a teacher staffed on حفظ القرآن can log memorisation for the resolved audience;
- teachers staffed only on أحكام القرآن, ترتيل وتجويد القرآن, تفسير القرآن, or a later
  unmarked Quran-domain Subject for that same audience receive `NOT_FOUND`;
- a conflicting Owner-managed marker aborts before Subjects or unrelated seed data change.

The opt-in variable and unique database volume are deliberate. This proof owns its whole
database and invokes the bootstrap seed, so it must never share a development or Owner
database merely to make the test convenient.

### A contract change reaches the harnesses too

`/quran-students` began answering `{ students, levels }` instead of a bare array.
The integration tests failed loudly; `verify-effective-staffing.mjs` failed with
`(roster.data ?? []).map is not a function`, and had it been written slightly
more defensively it would have read `undefined` and **passed while asserting
nothing**. When a response shape changes, grep the harnesses as well as `src` —
`grep -rln '<route>' scripts/dev/browser/` — and restate the assertion rather
than loosening it.


### A fixture must be wiped by what it OWNS, not by what it is called

`seed-notify-scenario.ts` wiped by tag: users named `[notify] …`, schedules
titled `[notify] …`. But the harnesses that use it **create a class through the
real scheduling form**, so that schedule's title is whatever the harness typed —
`تفسير الفاتحة 777777777777` — and the tag-keyed wipe never saw it. The
`course_schedule_staff` row survived, `user` RESTRICTs against it, and the
**next** run of the seed died at `user.deleteMany` with a foreign-key error
naming neither the schedule nor the harness that made it.

The tell is the shape of the failure: a seed that has worked for weeks failing
in its *wipe* rather than in its *setup*. Driving the real UI is the whole point
of a browser harness, so **anything the UI creates is fixture residue the seed
must own** — key the teardown on the entity the fixture actually created (here,
the user) and follow the foreign keys out from it.

Two related habits, both already paid for above: give every harness a `trap`
that cleans on exit, and **batch long harness runs**, because the tool cap
SIGTERMs the loop and a `trap` in the *outer* shell does not fire for the child
that was killed.

### One cookie, ONE consumer — and the symptom is not a 401

TD-4.13 refresh-token reuse detection revokes a session whose cookie is
presented twice. `verify-delivery` minted its API bearer from the Admin's
browser cookie and then handed that same cookie back to the browser; the first
navigation worked and the **second** rendered «ليست لديك صلاحية».

That reads as an authorization bug in the feature under test, which is why it
cost a debugging cycle. Two rules follow:

* mint a **separate dev session per consumer** — `ADMIN_COOKIE` for the browser,
  `ADMIN_API_COOKIE` for the harness's own `fetch`;
* mint **every** bearer up front, before the browser holds any identity, and
  then set the browser's cookie once and never touch it again — re-setting an
  identity's original cookie after a page load presents an already-rotated
  token.

`verify-delivery.mjs` now **throws** on «ليست لديك صلاحية» rather than reporting
it as a delivery failure, so the next person meets the real cause immediately.

### A live media surface needs fake devices, and a REAL server

`verify-livekit-join` is the only harness where several people are in one place
at once, and three things make that possible without a paid account or a human:

* **`livekit-server --dev`** in the dev overlay — the whole signalling stack in
  one container with a fixed key pair. CI consumes no cloud minutes.
* **`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`** — a
  headless browser has no microphone, and a permission dialog nobody can click
  makes every join time out. The tracks are synthetic; the signalling, the room
  and the connection are real.
* **Sequential identities across tabs.** Cookies are browser-wide, so a second
  participant is: set the cookie, open a new tab. The tab already connected keeps
  its in-memory access token and its live connection, which is what lets one
  browser hold a genuine three-party room.

### Assert the STATE, not the surface that displays it

The first version of that harness waited for the classroom element to appear and
called it *connected*. The element renders while the connection is still
negotiating, so **three tabs reported success while one was actually connected**
— and the check that counted participants was the only thing that noticed.

The component now puts the connection state in the DOM (`data-connection`), and
the harness asserts on that. The general rule: when a check needs a state, make
the state readable and read it; a proxy for it will eventually be true when the
state is not.

### A CSP is invisible to every test that is not a browser

R98's classroom could not open at all: §3.1's `connect-src 'self'` blocked the
media server. Neither typechecker, no unit test and no HTTP integration test can
see a CSP — the request is refused inside the browser before it reaches the
network.

**And the second half cost as much as the first.** Naming only the socket origin
(`ws://…`) left the *validation* request — plain HTTP, made before the upgrade —
still blocked, and it produces **no `securitypolicyviolation` event** on the
socket, only «could not establish signal connection: Failed to fetch». Both
schemes must be listed. See `nginx/snippets/media-origin.conf`.

### "NO RESULT" is a failure — and one of them is still unexplained

A full sweep records a harness as **NO RESULT** when it printed no summary line
at all. That is **indistinguishable from a harness that proved nothing**, so it
must never be counted as green.

After C1, full sweeps reported `verify-recorder` and `verify-reorder` as
NO RESULT while **every one of them passes on its own** (22/22, 30/30) and also
passes when run back-to-back in the same order the sweep uses. What was ruled
out, by measurement rather than assumption:

* **not memory** — 6 GB free at the time;
* **not leaked browsers** — the Chrome processes on the box were the
  developer's own, not harness leftovers (a first, too-broad `pgrep` suggested
  otherwise);
* **not the feature under test** — both pass individually, repeatedly.

**One real problem was found and fixed on the way**: every harness waited only
`30 x 0.3s = 9 seconds` for Chrome to open its debug port, and the dev overlay
now also runs an Egress worker with its own headless Chrome. Reaching `connect()`
before the port exists throws an unhelpful JSON error — exactly the shape of a
NO RESULT. The wait is now `60 x 0.5s` and a missing port is an explicit `FAIL`
with a reason. That recovered one of the three affected harnesses.

**The remaining two are an open, environment-level flake in long sweeps**, and
are recorded here rather than papered over. A sweep reporting them must be
followed by running them individually; if they pass there, the feature is fine
and this note is the reason. **Do not "fix" it by removing them from the sweep.**

**2026-08-21 (C2): the flake did NOT recur.** A full 30-harness sweep reported
**zero** NO RESULT — `verify-recorder` 22/22 and `verify-reorder` 30/30 both
inside the sweep. That is one clean run and **not** evidence the cause is gone:
the `auth-refresh` flake below passed sometimes for four runs before its cause
was found, which is exactly what made *passing sometimes* worthless as a signal.
The note stays open.

### Never run the integration sweep and a browser sweep at the same time

They share one database, and the browser harnesses **wipe and reseed** their
fixtures — users, Levels, schedules, enrolments. Running both at once produced
**53 failures across three suites** (`quran`, `quran-entry`,
`effective-staffing`), none of them related to anything being changed, and one
harness check reporting `404` where it expected `400`.

Every one of them passed on a serial re-run. The lesson is not "retry a flake":
it is that **a shared-fixture failure looks exactly like a regression in
whatever you last touched**, which is the most expensive way to lose an hour.
Run the suites in sequence, and when something unrelated to the change fails,
check what else was writing to the database before reading the diff again.

### A harness teardown leaks its profile directory

`kill "$CHROME_PID"` reaps the launcher and leaves Chrome renderer and GPU
children alive, holding the `mktemp -d` profile open — so the `rm -rf` that
follows silently fails. **727 orphaned `/tmp/tmp.*` directories** had
accumulated before anyone looked. Killing the process *group* (`setsid` at
launch, negative PID at teardown) is the fix; it is noted here rather than
applied blind, because a first attempt at it broke the single-quoted `trap`
blocks in all thirty scripts — the injected comment contained apostrophes.

**And the recovery from that mistake cost more than the mistake:** restoring
with `git checkout -- scripts/dev/browser/` reverted *every* file in the
directory, including C1 work that was correct and uncommitted. Restore the files
you broke, never the directory they live in.

### No-PII logging is tested in both directions

`request-context.test.ts` supplies an email-shaped `X-Request-Id`, an
email-shaped supported path, an email-shaped unmatched path and an internal
exception containing the same value. The accepted outputs are a newly generated
opaque id, the registered route template / `<unmatched>`, and a fixed operator
message. The input must appear in none of them. The staff-pre-provisioning
integration asserts its indefinitely retained `user.create` audit contains the
non-identifying channel and never the mailbox.

`audit.repository.test.ts` attacks the shared durable-detail boundary with
nested snake-case and camel-case identity/locator keys and proves the database
write is never reached. Real PostgreSQL/MinIO content tests use an email-shaped
filename, then prove upload, same-ticket retry, replacement and deletion retain
only deterministic 64-hex coordinate ids in audit while their exact-key storage
transitions still converge. The Trash integration proves an irreversible audit
row outlives its entity without copying the entity label.

The complete-sweep isolation guard caught a separate falsely-green proof:
`social-profile.integration.test.ts` called the platform-wide `audit.purge`
with a 2099 horizon and asserted only that its retained safeguarding row
survived. It passed while deleting ambient eligible authentication history. The
purge and survival assertion now run inside an always-rolled-back transaction;
a fixture tag cannot restore rows deleted by a global selection.

`check-no-pii-logs.sh` pins the deployment half: Nginx must generate the id,
its access format may contain neither URI nor client address, its fixed-format
error log is process-emergency only, and neither runtime logger may reintroduce
raw exception text. It also rejects copying the pre-provisioned mailbox into
the audit detail, raw content keys, or Trash labels, and requires every audit
write to cross the recursive repository guard. This is intentionally a source
guard plus behavior tests: a
behavior-only test cannot observe the loaded Nginx format, while a source-only
guard cannot prove the redaction code actually handles hostile values.
The direct-write rule was mutation-tested with an otherwise unreachable
`prisma.auditLog.create`: the guard named the exact service line and failed.
Because that final check parses TypeScript rather than grepping comments, CI
runs it after the backend's locked dependency install. `check-ci-portability.sh`
refuses either moving it back into the dependency-free job or placing it before
`npm ci`; this closes the clean-checkout failure that a warm Local install hid.

### An integration run must leave the database it found

P1.2 closed a defect that a passing suite concealed: the complete integration
sweep reduced `course_schedule_staff` from **2** rows to **0**. It was not an
interaction between files. `branch.integration.test.ts` reproduced the loss by
itself. Its first `beforeEach` called `clear()` before assigning `actorUserId`,
and Prisma omitted `userId: undefined` from the filter, turning an apparently
scoped `deleteMany` into an unscoped deletion. Cleanup now discovers the
suite-owned, tagged users first and deletes staffing only for those exact ids.
The shared teaching-fixture helper also refuses empty, malformed, or reserved
development-fixture tags before it can query anything.

`scripts/test/run-integration-suite.sh` enforces the general ownership rule for
both the Local wrapper and the disposable hosted-CI wrapper. It takes a
privacy-safe logical digest of every application base table before and after
Vitest and fails if any table differs. The digest contains row counts and
hashes of every row's logical fields, excluding only `created_at` and
`updated_at`; it prints no row data. This catches residue, deletion,
replacement, changed relationships, and same-count mutation. A source guard
also rejects integration cleanup whose `deleteMany` has no `where` clause or
contains `undefined`.

The first disposable hosted-CI run proved that this is not decorative: all
**1887 active assertions passed**, but the gate still failed on one leaked
`normalized_email_lock` and one changed `scheduling_type` digest. The first
belonged to a fixed search-fixture email omitted from teardown; the second came
from restoring only a whole-set order rather than each exact prior
`display_order`. Exact owned-email tracking and exact-coordinate restoration
make both focused suites isolation-clean.

The bounded ownership audit found further teardown defects while the original
fix was being proved:

- whole-set Branch, Category, and Subject reorder tests restored only relative
  order, not the exact shared `display_order`; they now capture and restore the
  exact shared positions in `finally` blocks;
- the online-class test constructed a date from UTC while the authorization
  path uses Morocco-local dates, so a sweep spanning local midnight could
  expire its own class window;
- recording cleanup depended on successful assertions and omitted
  `SessionRecording` from suite teardown, so one failure could strand an entire
  scenario. Both the assertion path and teardown are now fail-safe;
- three browser authorization probes depended on ambient "first" rows: the
  Teacher portal wrote availability for a development Teacher, the Admin
  navigation probe targeted a development Level and could create a Category if
  its refusal regressed, and the gender probe could create an enrolment across
  ambient user/Level/Branch coordinates. They now use exact tagged scenario
  identities and coordinates whose fail-safe shell traps remove domain, audit,
  and refresh-token rows even when the expected refusal regresses.

The consent migration retry check permits `completed` and `already_completed`:
a live worker can converge the exact obligation before the direct retry does,
and the test still proves the authoritative row and object postconditions. The
same worker race made a retry-policy test select a newer legitimate follow-up
row and made replacement setup lose an optimistic-version race. The retry proof
now uses a unique real pg-boss queue carrying the registered TD-7 policy and
asserts its exact job id; replacement/deletion tests establish their exact
forced-private precondition directly. Production delivery, follow-up
deduplication, replacement, and deletion remain covered separately, without two
workers competing for a test that is specifically measuring one retry.

R111's final-erasure regressions also meet writers at the governing User-lock
boundary rather than relying on timing. The test starts permanent
de-identification concurrently with teaching-profile replacement,
safeguarding-profile upsert, notification delivery and upload initiation. Both
legitimate serial orders must converge on no planning, case-file, inbox or quota
satellite for the tombstone, and deletion-first mints no upload authority. This
specifically detects a stale request that passed an earlier
authorization/roster read and writes after the purge's `deleteMany`; a
sequential "write, then delete" test cannot observe that race.

Those focused suites also exposed a second ownership trap: a fixed tag such as
`[content-test]` is not proof that the current process owns a row. A process
restarted after interruption can find the earlier process's tagged Users and
delete their domain/audit rows during its opening cleanup. The affected R111,
content, teaching-profile, social-profile and notification suites now include a
random run id in their ownership prefix. Their cleanup can match only ids born
in that process, while the all-table wrapper remains the backstop that detects
any residue left by an interrupted run.

The browser audit also repaired evidence defects exposed while isolation was
being measured: navigation now waits for the requested pathname and for the
skeleton to leave, the Admin catalogue expectation includes R110's tenth item,
and the enrolment scenario records the durable beneficiary fact rather than
assuming a `student` role implies it.

The ownership guard was falsified deliberately: restoring the old
`actorUserId ?? undefined` predicate left all **17/17** branch assertions green,
then the wrapper failed with only `course_schedule_staff` changing **2 → 0**.
With the correction restored, the final **1802-test** integration sweep passed
and left the all-table logical snapshot identical. Re-seeding after a sweep is
no longer an accepted remedy for isolation damage.

### In-page instrumentation must survive navigation, or it proves nothing

`verify-error-experience.sh` installed a `window.fetch` wrapper by `evaluate`
on the document at `/`, then navigated to `/register` — which creates a **new
document**, destroying the wrapper and `window.__seen` with it. The read that
followed returned `[]` every time, and the variable holding it was **never
asserted at all**. The harness therefore claimed to prove *"whatever
`/auth/refresh` answers"* while observing nothing: had the call never been made,
or answered `500`, the checks would have passed identically.

Use **`Page.addScriptToEvaluateOnNewDocument`**. CDP re-runs it before any page
script on every navigation, so each document gets the instrumentation rather
than one document keeping it. Then **assert the observation**, not only the
absence of a symptom — the repaired harness checks that `/auth/refresh` was
seen *and* answered `401`, which is what turns *the page looks fine* into *the
expected 401 happened and was handled silently*.

Proven by reintroduction: restoring the per-document install drops the probe to
**0 observed calls** and fails both checks.

### An assertion the environment has switched off is not an assertion

The same harness asserted a `429` from a 25-request burst. Under
`docker-compose.dev.yml` the auth zone is **6000r/m** against production's
**10r/m**, deliberately, so the integration suite is not throttled — the burst
cannot trip it and the check failed for a reason that had nothing to do with the
product. The harness now **detects which edge it is running against** and
asserts the property that is true there, while still failing on a
production-shaped edge that has stopped limiting.

### A guard that depends on an unasserted tool fails OPEN

Three CI guards shipped written with `ripgrep`, their prohibition checks taking
the form:

```bash
if rg -n 'forbidden-pattern' dir | grep -q .; then fail '...'; fi
```

Where `rg` is absent, the command writes `rg: command not found` to **stderr**
and nothing to stdout, so the condition is simply **false** — the guard prints
its success line and exits `0` **while the thing it forbids sits in the tree.**

It was proven rather than argued: a real `proxy_pass $minio_upstream` bypass was
injected into `nginx/snippets/`, and `check-storage-edge.sh` passed. The two
checks made inert this way were precisely the ones protecting Owner decisions —
that no Nginx path bypasses the storage edge filter, and that automatic
quarantine destruction stays disabled. A third guard (`check-backup-tooling.sh`)
failed *closed* instead, which is loud and safe but still wrong.

**So: CI guards search with POSIX `grep`.** It exists on every runner and in
every container this project uses. `check-ci-portability.sh` now fails the build
if a guard reaches for `rg`, `fd`, `ag` or `ack`; if one ever genuinely needs a
richer tool, it must assert the tool exists **first**, so a missing dependency is
loud rather than silently permissive.

This is the same rule as *"a guard must be able to read what it guards"* — the
`?raw` CSS guard that passed for a whole commit while reading empty strings —
seen from the other side. **The tell is identical: a guard that has never
failed.**

### A guard that fails because the PRODUCT changed is restated, not deleted

R98.18's frontend guard read *«mounts no recording affordance»* — true and
deliberate then, because recording did not exist. R99 authorised recording, so
the sentence stopped being the property while the property itself survived:
recording is **the platform's**, driven by its own control and its own
server-side capture, never a capability handed to a browser.

The restated check asserts the classroom composes بذور الأمل's own panel, mounts
**no vendor recording component**, and grants no `roomRecord` to any participant.
Deleting it would have removed the only thing standing between the product and a
client-side recorder.

### A new table means every fixture that touches its parent

`session_recording` references `session` with `onDelete: Restrict`, on purpose —
a recording is part of the record of what happened. The R98 fixture knew nothing
about it, so the next seed died inside its own wipe with a foreign-key error.
The rule `testing.md` already recorded — *a fixture must be wiped by what it
OWNS* — extends to tables added afterwards: adding one means auditing the
teardowns that unwind its parent.

### A failure path that can itself fail is not a failure path

`startRecording`'s catch marked the row failed with `update`, which **throws when
the row is gone** — and the row being gone is precisely one of the situations
that lands there. The throw escaped the catch, so a مؤطِّرة received a raw
database error instead of her refusal, and the orphan-cancellation the block
exists for was invisible.

`updateMany` matches zero rows without complaint, which is the correct
semantics for a clean-up. **Test the error path with the error that makes the
error path hard**, not with a convenient one.

### A mock proves the rules; only real media proves the recording

`session-recording.integration.test.ts` uses a fake provider deliberately: an
assertion about *who may record* must fail because authorization is wrong, not
because a media server was unreachable. But a fake can report any file it likes,
so it can never show that a صوت وصورة class produced video and a صوت فقط class
did not.

`verify-livekit-join.sh` therefore records **both**, against real local Egress,
and then lists the staging bucket and checks the **extensions and the byte
counts** — because a zero-length file is a passing lifecycle and a failed
recording, which is exactly the pair that check exists to tell apart.

### The staging-cleanup failure is after success, so test both truths

`session-recording-ingest.integration.test.ts` drives real MinIO and injects a fault only at
the selected `DeleteObject` call. The intermediate assertion is load-bearing: the canonical
object, content row and relation exist while the staging object remains, and
`ingestion_failure_reason` stays null. A retry must then delete the selected staging key while
the canonical object and an unrelated staging object remain byte-addressable.

The same suite runs the service behind a real temporary pg-boss queue. It observes the
durable `retry` row, stops that worker completely, starts a new worker and proves eventual
cleanup. A bounded test-only retry budget also reaches terminal `failed` state and asserts
that the cleanup error remains in job output. Every temporary queue and fixture object is
removed by the suite. The terminal-failure case uses the production retry limit against real
pg-boss and proves five executions total; only its delay is removed so the assertion finishes
promptly. The production queue name and worker catalog are unchanged.

### And only a real browser proves that a recording can be HEARD

A recording pipeline can be green end to end and still deliver a file nobody can
play. `verify-livekit-ingest.sh` (R99 C2) drives the whole chain — a مؤطِّرة
presses «بدء التسجيل» on the real screen, a real Egress worker writes a real
file, the platform imports it, a مستفيدة opens the library — and then asserts on
the **media element itself**:

```
readyState >= 2  and  duration > 0
```

Every cheaper check passes on an empty file. A `200` does; a non-zero byte count
does for a truncated one; a `<video>` element rendering does. Only the browser
decoding it says the lesson survived, and it is the last link in a chain where
every earlier one was already green.

Two further things only this harness can say:

- **The URL is Bodour's.** A library item pointing at the provider's staging
  bucket plays perfectly today and rots when the provider expires it (R99.13),
  so the minted URL is asserted to be `/storage/` and **not**
  `recordings-staging`.
- **The starter never comes back.** Her tab is closed *while the recording
  runs*, and the callback, the queued job, the server-side copy and the content
  row all happen with nobody watching.

### A negative that uses the wrong axis asserts the opposite of the rule

§4.9's content visibility is **Level**-based. So *the same Level at another
branch* is a **positive** — she is legitimately elsewhere, not excluded — and a
refusal test written against her would have asserted the opposite of the rule
while looking like a refusal test that passed.

The R98 fixture had exactly two beneficiaries and both were in the same Level,
so C2's negative needed a **new** one in a different Level. **Check which axis
the rule actually turns on before choosing the person who must be refused.**

### A date-scoped rule needs the date threaded ALL the way through

R106 scoped a مؤطِّرة's exam list per assignment window — correct — and then took
the group set from `teacherEventScope(prisma, teacherId)`, whose `on` parameter
**defaults to today**. The clause therefore read *"exams inside this
assignment's window, whose group I teach RIGHT NOW"*, and a مؤطِّرة whose group
assignment had lapsed lost her whole group-scoped history: the very symptom the
revision existed to fix, reintroduced one line lower. The `entire_level` path
masked it, because it carries no group constraint at all.

Two lessons. **A default parameter is where a date silently becomes *now*** —
`assertExamInTeacherScope` had the identical defect, receiving `on` and then not
passing it. And **the durable fix was structural, not a threaded argument**: the
group is now taken from the schedule the staffing row points at, so the answer
is date-correct *by construction* rather than by remembering.

### A fixture's "today" must be the association's clock, not UTC's

`verify-livekit-join` needs **today's** occurrence, because the join window is
real. Its fixture computed the date by zeroing the UTC hours of `new Date()` —
the idiom every other fixture here uses — while taking the weekday from
`new Date().getDay()`, which is **local**. At 00:34 in Casablanca those are two
different days, and the seed died with «no record was found» while the
occurrence sat there under tomorrow's date.

The other fixtures never noticed because they ask for occurrences **after**
today (`date: { gt: day(0) }`), where being a day out changes nothing. Build a
calendar date from the local parts — `Date.UTC(y, m, d + offset)` — whenever a
fixture needs *today* exactly, and make sure every date in it comes from the
same clock.

### A one-off cover must be written the way the platform writes it

The R98 fixture created a `SessionStaff` row directly and the harness then
reported the cover as *refused*. The row was real; materialization had
soft-deleted it seconds later, because an occurrence that is not `overridden`
gets resynced from its schedule — which named nobody (R43.6).

The platform's own cover flow is `PATCH /sessions/{id}` with `staff`, and it
sets `overridden` precisely so that cannot happen. **A fixture that writes rows
the application would have written differently is testing a state the
application cannot reach.**

## Acceptance checklists

A module is Done only when its checklist is fully ticked, its test gates pass, and its
journeys run green. **Definition of done is per module, not per week.**

The checklists are in SRS §18 — Authentication & Onboarding, Registration/Approvals/Family,
Scheduling & Calendar, Quran Progress, Exams & Grading, Content/Consent/Storage,
Data/Admin/Audit, and Platform & Deployment.

---

**Next:** [CI/CD](ci-cd.md) · **Related:**
[User journeys](../overview/user-journeys.md), [Conventions](conventions.md)
