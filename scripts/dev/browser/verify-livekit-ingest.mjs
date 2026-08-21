/**
 * **R99 C2 — a class is recorded, and a beneficiary actually plays it.**
 *
 * The one thing this file exists to prove, which no integration test can:
 * **the whole chain works with real bytes through the real screens.** A مؤطِّرة
 * presses «بدء التسجيل» in the classroom she is teaching in, a real Egress
 * worker writes a real file, the platform imports it, and a مستفيدة opens the
 * library and **plays it** — with the browser reporting a duration and a
 * readyState, not merely a 200.
 *
 * ## Why the media assertions are what they are
 *
 * A recording pipeline can be green end to end and still deliver a file nobody
 * can hear. The three things this harness insists on, each because the cheaper
 * check would have passed anyway:
 *
 * * **`readyState >= 2` and `duration > 0`** on a real `<audio>`/`<video>` —
 *   a zero-length object serves a perfectly good `200`.
 * * **A byte count** on the fetched object, for the same reason.
 * * **The URL is Bodour's** — a library item pointing at the provider's staging
 *   bucket would play fine today and rot when the provider expires it (R99.13).
 *
 * ## And the negative is a DIFFERENT LEVEL
 *
 * §4.9's visibility is Level-based, so *the same Level at another branch* is a
 * POSITIVE — she is legitimately elsewhere, not excluded. A refusal test using
 * her would assert the opposite of the rule while looking like a refusal. The
 * excluded reader is مستفيدة ج, enrolled in a different Level.
 */
import { connect, newPage, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.R99_SCENARIO ?? '{}');
const PORT = process.env.PORT ?? '9253';
const { check, finish } = results();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function tab(existing = false) {
  const page = existing ? await connect(PORT) : await newPage(PORT);
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

  page.beIdentity = async (cookie) => {
    await page.send('Network.clearBrowserCookies');
    await page.send('Network.setCookie', {
      name: 'bodour_refresh',
      value: cookie,
      domain: 'localhost',
      path: '/api/v1/auth/refresh',
      httpOnly: true,
    });
  };

  page.open = async (path, ready = 'main') => {
    await page.send('Page.navigate', { url: `${BASE}${path}` });
    for (let i = 0; i < 120; i += 1) {
      const ok = await page
        .evaluate(`(() => document.querySelector(${JSON.stringify(ready)}) !== null)()`)
        .catch(() => false);
      if (ok) break;
      await wait(250);
    }
    await wait(800);
    const denied = await page
      .evaluate(`(() => document.body.innerText.includes('ليست لديك صلاحية'))()`)
      .catch(() => false);
    if (denied) throw new Error(`session revoked while opening ${path} (cookie reuse)`);
  };

  page.awaitConnected = async () => {
    for (let i = 0; i < 80; i += 1) {
      const state = await page
        .evaluate(`(() => {
          const stage = document.querySelector('.classroom__stage');
          if (stage && stage.getAttribute('data-connection') === 'connected') return 'in';
          if (document.body.innerText.includes('لا يمكنك دخول هذه الحصة')) return 'refused';
          return 'waiting';
        })()`)
        .catch(() => 'waiting');
      if (state !== 'waiting') return state;
      await wait(400);
    }
    const seen = await page
      .evaluate(`(() => document.body.innerText.replace(/\\s+/g, ' ').slice(0, 220))()`)
      .catch(() => '');
    return `timeout: ${seen}`;
  };

  /** Clicks a button by its exact visible label — the human path. */
  page.clickLabel = async (label) =>
    page.evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(
        (x) => x.textContent.trim() === ${JSON.stringify(label)},
      );
      if (!b) return false;
      b.click();
      return true;
    })()`);

  page.text = async () =>
    page.evaluate(`(() => document.body.innerText.replace(/\\s+/g, ' '))()`).catch(() => '');

  return page;
}

const main = await tab(true);

async function tokenFor(cookie) {
  await main.beIdentity(cookie);
  const raw = await main.evaluate(`(async () => {
    const r = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: '{}',
    });
    return JSON.stringify({ status: r.status, body: await r.text() });
  })()`);
  const parsed = JSON.parse(raw);
  if (parsed.status !== 200) throw new Error(`refresh failed: ${parsed.status}`);
  return JSON.parse(parsed.body).access_token;
}

// **Navigate BEFORE minting anything.** Every call below is a relative fetch,
// and a tab still on about:blank has no origin to resolve one against.
await main.open('/calendar');

const API = {};
for (const who of ['safa', 'amina', 'hind', 'studentA', 'studentB', 'studentC']) {
  API[who] = await tokenFor(process.env[`${who.toUpperCase()}_API_COOKIE`]);
}

/** One authenticated API call, from inside the page so it shares the origin. */
async function api(token, method, path, body) {
  const raw = await main.evaluate(`(async () => {
    const res = await fetch(${JSON.stringify(`/api/v1${path}`)}, {
      method: ${JSON.stringify(method)},
      headers: {
        Authorization: 'Bearer ' + ${JSON.stringify(token)},
        'Content-Type': 'application/json',
      },
      ${body === undefined ? '' : `body: ${JSON.stringify(JSON.stringify(body))},`}
    });
    return JSON.stringify({ status: res.status, body: await res.text() });
  })()`);
  const parsed = JSON.parse(raw);
  let payload = {};
  try {
    payload = JSON.parse(parsed.body || '{}');
  } catch {
    payload = { raw: parsed.body };
  }
  return { status: parsed.status, body: payload };
}

/**
 * Polls the recording until it reaches a resting state.
 *
 * **`availability`, not `status`** — that is the whole distinction C2 exists
 * for. `status = completed` means the provider left an object in a staging
 * bucket, and a harness that stopped there would declare success before the
 * platform had a single byte of its own.
 */
async function settle(sessionId, token, tries = 60) {
  let last = null;
  for (let i = 0; i < tries; i += 1) {
    const res = await api(token, 'GET', `/sessions/${sessionId}/recording`);
    last = res.body.data ?? null;
    if (last && ['available', 'import_failed', 'failed'].includes(last.availability)) break;
    await wait(2000);
  }
  return last;
}

/* ── 1. Recording is OPTIONAL, asserted before anything starts ───────────── */

{
  /**
   * **R99.2, stated FIRST**, because *optional* is only true if it is true by
   * default. صفاء staffs this occurrence and will record it in section 6; right
   * now nobody has pressed anything, and there must be nothing at all.
   *
   * The reader has to be somebody who **can** see the state, or a `404` for
   * being out of scope would look like the same answer as *no recording* —
   * two very different facts behind one status.
   */
  const untouched = await api(API.safa, 'GET', `/sessions/${S.tafseerToday}/recording`);
  check(
    'a class that nobody recorded has no recording state at all',
    untouched.status === 200 && untouched.body.data === null,
    JSON.stringify(untouched.body),
  );
}

/* ── 2. صوت فقط: the real UI, a real OGG, and a beneficiary who plays it ── */

let audioContentId = null;
{
  // هند is the one-off cover on this occurrence, so this also proves R91 cover
  // authority reaches the recording control on a real screen.
  const room = await tab();
  await room.beIdentity(process.env.HIND_COOKIE);
  await room.open(`/classroom/${S.seerahToday}`, 'main');
  const state = await room.awaitConnected();
  check('the مؤطِّرة enters the صوت فقط class through the real classroom', state === 'in', state);

  // **The real button, not the API.** R99.2's "explicitly" is about a person
  // choosing, and a fetch proves the route rather than the choice.
  const pressed = await room.clickLabel('بدء التسجيل');
  check('«بدء التسجيل» is on her screen and she presses it', pressed === true);

  await wait(9000);
  const banner = await room.text();
  check('«جاري التسجيل» appears — nobody is recorded silently', banner.includes('جاري التسجيل'));

  /**
   * **Her browser is CLOSED WHILE THE RECORDING RUNS, and she never comes
   * back.**
   *
   * This is the failure a browser recorder makes routine — a laptop that sleeps,
   * a tab that closes — and R99.4 answers it by putting capture on the server.
   * C1 proved the *capture* survives; what C2 has to prove is that everything
   * AFTER it does too: the provider's callback, the queued job, the server-side
   * copy and the content row all happen with **nobody watching**.
   */
  await wait(4000);
  room.close();
  await wait(6000);

  const survived = await api(API.hind, 'GET', `/sessions/${S.seerahToday}/recording`);
  check(
    'the recording keeps running after she closes her classroom entirely',
    survived.body.data?.live === true,
    JSON.stringify(survived.body.data),
  );

  // Real audio has to accumulate, or the file is a passing lifecycle and a
  // failed recording.
  await wait(10000);

  // Ended from her session, not from her screen — there is no screen any more.
  const stopped = await api(API.hind, 'POST', `/sessions/${S.seerahToday}/recording/stop`, {});
  check('and it can be ended without her returning to the browser', stopped.status === 202);

  const final = await settle(S.seerahToday, API.hind);
  check(
    'the recording becomes AVAILABLE with the starter gone from the browser entirely',
    final?.availability === 'available',
    JSON.stringify(final),
  );
  check(
    'and «available» carries the library item, never a provider URL (R99.13)',
    Boolean(final?.educational_content_id) &&
      !JSON.stringify(final).includes('recordings-staging'),
    JSON.stringify(final),
  );
  audioContentId = final?.educational_content_id ?? null;
}

/* ── 3. The imported recording is an ORDINARY library item ───────────────── */

if (audioContentId) {
  const page = await api(API.hind, 'GET', `/calendar/sessions/${S.seerahToday}`);
  const recordings = page.body.recordings ?? [];
  const materials = page.body.linked_content ?? [];
  check(
    'it appears under «التسجيلات» on the Session page, and not under المواد',
    recordings.some((c) => c.id === audioContentId) &&
      !materials.some((c) => c.id === audioContentId),
    JSON.stringify({ recordings: recordings.length, materials: materials.length }),
  );
  check(
    'named by R75.6 from the class and the date, with no numeric suffix on the first',
    typeof recordings[0]?.title === 'string' && !/\s\d+$/.test(recordings[0].title),
    recordings[0]?.title,
  );

  const lib = await api(
    API.hind,
    'GET',
    `/library?level_id=${S.level}&page_size=100`,
  );
  check(
    'and in the existing Educational Content library — no special recordings page',
    (lib.body.data ?? []).some((c) => c.id === audioContentId),
  );
}

/* ── 4. An authorised beneficiary opens it and it actually PLAYS ─────────── */

/**
 * Loads a URL into a real media element and reports what the browser made of
 * it. **`readyState` and `duration`**, because a zero-length object serves a
 * perfectly good `200` and every cheaper check passes on one.
 */
async function playable(page, kind, url) {
  return page.evaluate(`(async () => {
    const el = document.createElement(${JSON.stringify(kind)});
    el.preload = 'auto';
    el.muted = true;
    el.src = ${JSON.stringify(url)};
    document.body.appendChild(el);
    const ok = await new Promise((resolve) => {
      const done = () => resolve(el.readyState >= 2);
      el.addEventListener('loadeddata', done, { once: true });
      el.addEventListener('error', () => resolve(false), { once: true });
      setTimeout(() => resolve(el.readyState >= 2), 20000);
    });
    const info = {
      ok,
      readyState: el.readyState,
      duration: Number.isFinite(el.duration) ? el.duration : 0,
    };
    el.remove();
    return JSON.stringify(info);
  })()`);
}

if (audioContentId) {
  const student = await tab();
  await student.beIdentity(process.env.STUDENT_A_COOKIE);
  await student.open('/resources', 'main');

  const minted = await api(API.studentA, 'GET', `/content/${audioContentId}/download-url`);
  check(
    'an enrolled مستفيدة is granted a download URL for the recording',
    minted.status === 200 && typeof minted.body.url === 'string',
    `status ${minted.status}`,
  );

  const url = minted.body.url ?? '';
  check(
    'and the URL is BODOUR storage, not the provider staging bucket (R99.13)',
    url.includes('/storage/') && !url.includes('recordings-staging'),
    url.slice(0, 120),
  );

  const bytes = await student.evaluate(`(async () => {
    const res = await fetch(${JSON.stringify(url)});
    const buf = await res.arrayBuffer();
    return JSON.stringify({ status: res.status, size: buf.byteLength });
  })()`);
  const fetched = JSON.parse(bytes);
  check(
    'the object downloads with REAL bytes — not an empty file behind a 200',
    fetched.status === 200 && fetched.size > 5000,
    JSON.stringify(fetched),
  );

  const played = JSON.parse(await playable(student, 'audio', url));
  check(
    'and a real <audio> element genuinely loads and can play it',
    played.ok === true && played.duration > 0,
    JSON.stringify(played),
  );

  // R99.13's durability, in the only way that means anything: ask again later.
  await student.open('/resources', 'main');
  const again = await api(API.studentA, 'GET', `/content/${audioContentId}/download-url`);
  const replayed = JSON.parse(await playable(student, 'audio', again.body.url ?? ''));
  check(
    'a reload mints a fresh URL and it still plays — the asset is durable',
    again.status === 200 && replayed.ok === true,
    JSON.stringify(replayed),
  );
  student.close();
}

/* ── 5. The visibility ladder — and the negative is a DIFFERENT Level ────── */

if (audioContentId) {
  const other = await api(API.studentB, 'GET', `/content/${audioContentId}/download-url`);
  check(
    'same Level, other branch: behaves by the existing Level rule, not a new one',
    other.status === 200,
    `status ${other.status}`,
  );

  const wrongLevel = await api(API.studentC, 'GET', `/content/${audioContentId}/download-url`);
  check(
    'a beneficiary in a DIFFERENT Level is refused — 404, never 403 (§20 rule 17)',
    wrongLevel.status === 404,
    `status ${wrongLevel.status}`,
  );

  const anonymous = await main.evaluate(`(async () => {
    const res = await fetch('/api/v1/content/' + ${JSON.stringify(audioContentId)} + '/download-url');
    return res.status;
  })()`);
  check(
    'and an anonymous visitor gets nothing at all — BR-2 access is unchanged',
    anonymous === 401 || anonymous === 404,
    `status ${anonymous}`,
  );
}

/* ── 6. صوت وصورة: a real MP4, played by a real <video controls> ─────────── */

let videoContentId = null;
{
  const room = await tab();
  await room.beIdentity(process.env.SAFA_COOKIE);
  await room.open(`/classroom/${S.tafseerToday}`, 'main');
  const state = await room.awaitConnected();
  check('the مؤطِّرة enters the صوت وصورة class', state === 'in', state);

  const pressed = await room.clickLabel('بدء التسجيل');
  check('and starts a real recording of it', pressed === true);
  await wait(14000);
  await room.clickLabel('إيقاف التسجيل');
  await wait(1500);
  room.close();

  const final = await settle(S.tafseerToday, API.safa, 90);
  check(
    'the صوت وصورة recording becomes available',
    final?.availability === 'available',
    JSON.stringify(final),
  );
  videoContentId = final?.educational_content_id ?? null;
}

if (videoContentId) {
  const student = await tab();
  await student.beIdentity(process.env.STUDENT_A_COOKIE);
  await student.open('/resources', 'main');

  const minted = await api(API.studentA, 'GET', `/content/${videoContentId}/download-url`);
  const url = minted.body.url ?? '';
  const played = JSON.parse(await playable(student, 'video', url));
  check(
    'a native <video controls> genuinely loads the imported MP4',
    minted.status === 200 && played.ok === true && played.duration > 0,
    JSON.stringify(played),
  );
  student.close();

  const page = await api(API.safa, 'GET', `/calendar/sessions/${S.tafseerToday}`);
  check(
    'and the MP4 is a RECORDING, which the superseded MIME rule could not represent',
    (page.body.recordings ?? []).some((c) => c.id === videoContentId),
  );
}

/* ── 7. R99.8's other half: an ordinary MP4 upload is STILL refused ──────── */

{
  const refused = await api(API.safa, 'POST', '/uploads/initiate', {
    filename: 'lesson.mp4',
    size: 2048,
    mime: 'video/mp4',
    content_meta: {
      level_id: S.level,
      subject_id: null,
      academic_year_id: null,
      branch_id: S.branch,
    },
  });
  check(
    'a person uploading an MP4 is refused — R99 admits a PIPELINE, not a file type',
    refused.status === 400,
    `status ${refused.status}`,
  );

  // …and saying it is a class recording does not help, which is the trap: the
  // origin marker DESCRIBES and never PERMITS (R99.12).
  const stillRefused = await api(API.safa, 'POST', '/uploads/initiate', {
    filename: 'lesson.mp4',
    size: 2048,
    mime: 'video/mp4',
    content_meta: {
      level_id: S.level,
      subject_id: null,
      academic_year_id: null,
      branch_id: S.branch,
      origin: 'session_recording',
    },
  });
  check(
    'and claiming `origin: session_recording` does not widen it',
    stillRefused.status === 400,
    `status ${stillRefused.status}`,
  );
}

/* ── 8. Mixed origins share ONE naming namespace ─────────────────────────── */

if (audioContentId) {
  // The Session page's suggestion is what the browser recorder shows, and it is
  // numbered against everything already linked — including the recording the
  // provider produced. A separate sequence would collide with it.
  const page = await api(API.hind, 'GET', `/calendar/sessions/${S.seerahToday}`);
  const suggested = page.body.suggested_recording_name;
  const titles = [...(page.body.recordings ?? []), ...(page.body.linked_content ?? [])].map(
    (c) => c.title,
  );
  check(
    'the browser recorder is offered a name the imported recording has already taken into account',
    typeof suggested === 'string' && !titles.includes(suggested) && /\s2$/.test(suggested),
    `${suggested} vs ${JSON.stringify(titles)}`,
  );
}

for (const t of []) t.close();
main.close();
process.exit(finish());
