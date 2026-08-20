[Documentation](../README.md) › [Development](README.md) › **Testing**

# Testing

Four layers, each testing something the others structurally cannot.

| Layer | Scope | Tooling | Gate |
|---|---|---|---|
| **Unit** | Services: interval merge, state machines, consent evaluation, time and DST logic, Arabic normalization | Vitest | Per PR |
| **Integration** | Repositories against **real PostgreSQL**: constraints actually reject bad writes, partial indexes, native collation ordering, soft-delete filtering | Vitest + a real stack | Per PR |
| **API** | Every endpoint against the contract; **permission-matrix tests generated from the matrix**; child-context tests; envelope conformance | Supertest | Per PR |
| **E2E** | Every journey, RTL rendering, mandatory UI states, upload retry | Playwright | Pre-merge to `main` |

**Coverage: ≥ 80 % on services and policies.** No coverage gate on generated or boilerplate
code — a coverage number that counts generated clients measures nothing.

Current totals: **893 backend across 49 files · 345 frontend across 27**. The backend figure
is the integration sweep, which is what `scripts/dev/test-integration.sh` runs and what CI
gates on; the unit suite is a subset of it rather than a separate number.

## Running them

```bash
# Unit — no stack required
cd backend && npm test
cd frontend && npm test

# Integration — needs the stack up
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
bash scripts/dev/test-integration.sh
```

Integration tests run **serially**, because the suites share one database.

## Why integration tests use a real database

Not mocks. The properties being checked **do not exist in a mock**:

- Does a partial unique index actually reject the second row?
- Does `ar-x-icu` collation actually order Arabic correctly?
- Does the transaction actually roll back?
- Does a presigned signature actually survive the proxy?

A mock returns whatever you told it to. The whole point of these tests is to find out what
PostgreSQL, MinIO, and Nginx *really* do.

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
| `scripts/dev/browser/measure-page-header.sh` | Does the primary action stay put as the description grows, at nine widths |
| `scripts/dev/browser/verify-reorder.sh` | R76 on the five real admin screens: is «الترتيب» gone, is the header a focusable button, does pressing it send `sort_by` to the server, does a dropped row move **and survive a reload**, is the handle disabled and explained when it cannot be used |
| `scripts/dev/browser/verify-circles-reorder.sh` | R78.1 on the real حلقات المواد page: handle disabled and explained with no `(Level, Subject)` chosen, enabled once chosen, a circle dragged to last and **persisted server-side**, surviving a reload, and ↑/↓ reordering too. Circles addressed by **seeded id, never by title**. **Last run: 9/9.** |
| `scripts/dev/browser/verify-sorting.sh` | The sorting contract **clicked** across four tables: ascending → descending → ascending, exactly one header claiming a direction, non-sortable headers not clickable, the actions column never sortable, and **no row on two pages** of a sorted collection (R76.3's `id` tiebreaker). **Last run: 39/39.** |
| `scripts/dev/browser/verify-public-calendar.sh` | قائمة and تقويم driven **anonymously**: both views offered, the choice in the URL, month stepping withheld where it means nothing, RTL with the marker on the inline start — and what a public reader must NOT see (no student name, no notification surface, no recordings, **no cancellation reason**). A cancelled occurrence stays listed and says so. **Last run: 18/18.** |
| `scripts/dev/browser/verify-library-recorder.sh` | The recorder's second entry point in مكتبة المحتوى, plus the sort indicator's **measured** placement. **Last run: 16/16.** |
| `scripts/dev/browser/verify-recorder.sh` | R75 with a **real `MediaRecorder`**: start · elapsed advancing · pause freezing the reading · resume · stop · editable name · save · discard · a second recording numbered « 2» — then the bytes in **MinIO** through a presigned URL, the row in the library, and the link as a *recording* on the Session page. Chrome runs with `--use-fake-device-for-media-capture`, which supplies a synthetic microphone; **the API is not stubbed**. **Last run: 22/22.** |
| `scripts/dev/browser/verify-schedule-edit.sh` | «تعديل العنصر»: the dialog opens with the row's own mode, a seeded المستوى and its own الحلقة; changing only «نهاية التكرار» saves; and `teaching_mode`/`target_id` are untouched afterwards. **Last run: 12/12.** |
| `scripts/dev/browser/verify-notifications.sh` | R77 on the real student dashboard: does a student see her own occurrences, does a cancellation reach her **with its reason**, is the notice unread and singular, does «تم الاطّلاع» clear it, does restoring **withdraw** an unread notice and **correct** a read one — driven as three real sessions (student · administrator · unrelated student) against the scenario the seeder builds. **Last run: 18/18.** |

### Getting past the login wall without bypassing it

Every `/admin/*` screen needs a session, and the only issuer is Google OAuth
(§4.1b) — which a headless browser on a developer machine cannot complete. That
is not a reason to skip browser verification; it is a reason to provision a
session properly.

`scripts/dev/issue-dev-session.sh` mints one by calling **`issueNewSession`, the
production code path the OAuth callback itself calls**, and prints the raw token
to be set as the ordinary `bodour_refresh` cookie — confined to its own route
(TD-12), exactly as the server sets it. **Nothing about authorisation is
bypassed**: the user is an ordinary `super_admin` row, and every request it makes
is checked by the same TD-2 rules as any other. What is replaced is the identity
*provider*, and only in a development database — the script refuses to run
against a non-loopback `DATABASE_URL` or with `NODE_ENV=production`.

It takes an optional user uuid:

```bash
bash scripts/dev/issue-dev-session.sh              # the script's own Super Admin
bash scripts/dev/issue-dev-session.sh <user-uuid>  # an existing user, as they are
```

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
  used.** `test-support/consent-setting.ts` captures the prior value once per
  suite and puts it back — including *absent*, which is a real state the suites
  deliberately exercise.
- **Capture once, not per test.** A `beforeEach` capture would re-save whatever
  the previous test left, so the suite would "restore" its own scratch value
  rather than the developer's.

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
- **Borrow the least dangerous column.** The rewritten test suspends the other
  administrators (`account_status`) instead of revoking their grants: a status
  is trivially restored and means nothing on its own, whereas a **revoked role
  assignment is indistinguishable from a deliberate administrative act** — which
  is exactly why the damage was hard to recognise as damage.
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

**One refresh cookie, one consumer.** A harness that drives the API *and* loads
the app needs a **separate session per phase**: the page's own refresh rotates
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


### Only ONE fixture may hold the Quran marker at a time

`Subject.tracks_quran_progress` has a **partial unique index** — at most one live
Subject may carry it (R73.4), because two would make *which* teaching authorises
a log ambiguous. `seed-quran-scenario.ts` and `seed-r91-scenario.ts` both create
one, so:

* they can never run **concurrently**;
* and a fixture leaked by an **interrupted** run blocks the other harness with a
  raw `duplicate key value violates unique constraint` stack trace rather than a
  legible message.

That is exactly what happened on 2026-08-20: a batch loop was SIGTERM'd while
`verify-quran-entry` was running, its `trap cleanup EXIT` never completed, and
`verify-effective-staffing` then failed to seed at all. **The recovery is
`npx tsx scripts/seed-quran-scenario.ts --clean`**, which every harness also runs
on exit.

**A harness killed mid-run leaves its fixture behind.** When one fails to seed,
check for another scenario's residue before suspecting the product.

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

## Acceptance checklists

A module is Done only when its checklist is fully ticked, its test gates pass, and its
journeys run green. **Definition of done is per module, not per week.**

The checklists are in SRS §18 — Authentication & Onboarding, Registration/Approvals/Family,
Scheduling & Calendar, Quran Progress, Exams & Grading, Content/Consent/Storage,
Data/Admin/Audit, and Platform & Deployment.

---

**Next:** [CI/CD](ci-cd.md) · **Related:**
[User journeys](../overview/user-journeys.md), [Conventions](conventions.md)
