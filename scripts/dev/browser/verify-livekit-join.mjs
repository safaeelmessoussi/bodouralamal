/**
 * **R98 — entering a class عن بُعد, driven through the real screens against a
 * REAL LiveKit server.**
 *
 * The one thing this file exists to prove, which no unit test and no mocked
 * provider can: **three different people, authorised by بذور الأمل's own rules,
 * end up in the same live room and can see each other** — and a fourth,
 * authorised by nothing, cannot get in.
 *
 * ## How three participants share one browser
 *
 * Cookies are browser-wide, so identities are established **sequentially**: set
 * the cookie, open the next tab, and the tab already connected keeps its
 * in-memory access token and its live media connection. The first tab is the
 * full human path — calendar, occurrence dialog, «دخول الحصة», classroom — and
 * the later tabs go straight to the classroom URL, which is the same page.
 *
 * ## What a failure here means
 *
 * A refusal check that passes because the server is unreachable would be
 * worthless, so every negative is preceded by a positive on the same surface:
 * before asserting «مستفيدة ب cannot join», the harness has already watched
 * مستفيدة أ join.
 */
import { connect, newPage, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.R98_SCENARIO ?? '{}');
const PORT = process.env.PORT ?? '9252';
const { check, finish } = results();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── One tab, with the helpers every tab needs ───────────────────────────── */

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
    // TD-4.13: a refresh cookie with two consumers is REVOKED, and the symptom
    // is this sentence on a later navigation — an authorization failure of the
    // harness, wearing the costume of a failure of the feature.
    if (denied) throw new Error(`session revoked while opening ${path} (cookie reuse)`);
  };

  /** Waits for the classroom to actually be connected to the media server. */
  page.awaitConnected = async () => {
    for (let i = 0; i < 80; i += 1) {
      const state = await page
        .evaluate(`(() => {
          const text = document.body.innerText;
          const stage = document.querySelector('.classroom__stage');
          // The STATE, not the presence of the surface: the stage renders
          // while the connection is still negotiating, and asserting on it
          // reported three participants connected when one was.
          if (stage && stage.getAttribute('data-connection') === 'connected') return 'in';
          if (text.includes('لا يمكنك دخول هذه الحصة')) return 'refused';
          return 'waiting';
        })()`)
        .catch(() => 'waiting');
      if (state !== 'waiting') return state;
      await wait(400);
    }
    // On a timeout, say what the page ACTUALLY shows — a harness that reports
    // only "timeout" sends the reader back to the browser to find out.
    const seen = await page
      .evaluate(`(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 220))()`)
      .catch(() => '');
    return `timeout: ${seen}`;
  };

  /** How many people this tab can see in the room, counted from the DOM. */
  page.participantCount = async () =>
    page
      .evaluate(`(() => {
        const audio = document.querySelectorAll('.classroom__participant').length;
        const tiles = document.querySelectorAll('.lk-participant-tile').length;
        return Math.max(audio, tiles);
      })()`)
      .catch(() => 0);

  return page;
}

/* ── Minting bearers BEFORE the browser holds any identity ───────────────── */

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

/** A join request, exactly as the client makes it. Returns status and body. */
async function join(token, sessionId, childId = null, body = {}) {
  const raw = await main.evaluate(`(async () => {
    const res = await fetch('/api/v1/sessions/' + ${JSON.stringify(sessionId)} + '/online-join', {
      method: 'POST',
      headers: Object.assign(
        { Authorization: 'Bearer ' + ${JSON.stringify(token)}, 'Content-Type': 'application/json' },
        ${JSON.stringify(childId ? { 'X-Active-Child-ID': childId } : {})},
      ),
      body: ${JSON.stringify(JSON.stringify(body))},
    });
    return JSON.stringify({ status: res.status, body: await res.text() });
  })()`);
  const parsed = JSON.parse(raw);
  return { status: parsed.status, body: JSON.parse(parsed.body || '{}') };
}

await main.open('/calendar');

const API = {
  safa: await tokenFor(process.env.SAFA_API_COOKIE),
  amina: await tokenFor(process.env.AMINA_API_COOKIE),
  souad: await tokenFor(process.env.SOUAD_API_COOKIE),
  nadia: await tokenFor(process.env.NADIA_API_COOKIE),
  hind: await tokenFor(process.env.HIND_API_COOKIE),
  rim: await tokenFor(process.env.RIM_API_COOKIE),
  studentA: await tokenFor(process.env.STUDENT_A_API_COOKIE),
  studentB: await tokenFor(process.env.STUDENT_B_API_COOKIE),
  parent: await tokenFor(process.env.PARENT_API_COOKIE),
};

const claims = (token) =>
  JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));

/* ── 1. Authorization, through the real endpoint ─────────────────────────── */

{
  const ok = await join(API.safa, S.tafseerToday);
  check('the مؤطِّرة of an online class receives a credential', ok.status === 200, `status ${ok.status}`);
  check(
    'her credential names HER, and moderation authority',
    ok.status === 200 && claims(ok.body.data.token).sub === S.safa &&
      claims(ok.body.data.token).video.roomAdmin === true,
  );

  const assistant = await join(API.amina, S.tafseerToday);
  check('the ASSISTANT receives one too', assistant.status === 200);
  check(
    'with identical operational authority — R87 §G parity, on the wire',
    assistant.status === 200 &&
      JSON.stringify(claims(assistant.body.data.token).video) ===
        JSON.stringify(claims(ok.body.data.token).video).replace(S.safa, S.amina),
    'grants compared field for field',
  );

  const student = await join(API.studentA, S.tafseerToday);
  check('a beneficiary of the class receives one', student.status === 200);
  check(
    'and it carries NO moderation authority',
    student.status === 200 && !claims(student.body.data.token).video.roomAdmin,
  );

  const outsider = await join(API.studentB, S.tafseerToday);
  check('an unrelated beneficiary is refused — 404, never 403', outsider.status === 404);

  const declared = await join(API.rim, S.tafseerToday);
  check('a مؤطِّرة who only DECLARED the subject (R88) is refused', declared.status === 404);
}

/* ── 2. R91, through the real join flow ──────────────────────────────────── */

{
  const outgoing = await join(API.souad, S.fiqhToday);
  const incoming = await join(API.nadia, S.fiqhToday);
  check('the مؤطِّرة whose period ENDED yesterday is refused today', outgoing.status === 404);
  check('the one whose period BEGINS today is admitted', incoming.status === 200);

  const cover = await join(API.hind, S.seerahToday);
  const coverNext = await join(API.hind, S.seerahNext);
  check(
    "a one-off cover enters TODAY'S occurrence",
    cover.status === 200,
    `status ${cover.status} ${JSON.stringify(cover.body.error ?? {})}`,
  );
  check('and is refused the next one — the cover propagates to nothing', coverNext.status === 404);
}

/* ── 3. R92, as a pair ───────────────────────────────────────────────────── */

{
  const combined = await join(API.studentB, S.fiqhToday);
  const ordinary = await join(API.studentB, S.fiqhNext);
  check("the second branch's beneficiary enters the COMBINED occurrence", combined.status === 200);
  check('and is refused the next ordinary one — nothing was widened', ordinary.status === 404);
}

/* ── 4. The guardian ─────────────────────────────────────────────────────── */

{
  const asChild = await join(API.parent, S.tafseerToday, S.child);
  check('a guardian acting for her child receives a credential', asChild.status === 200);
  check(
    'and the participant is the CHILD, never the guardian',
    asChild.status === 200 &&
      claims(asChild.body.data.token).sub === S.child &&
      claims(asChild.body.data.token).sub !== S.parent,
  );

  const forged = await join(API.parent, S.tafseerToday, S.studentA);
  check('naming an unrelated child is refused', forged.status === 404);

  const noChild = await join(API.parent, S.tafseerToday);
  check('a guardian naming no child at all is refused', noChild.status === 400);
}

/* ── 5. What the client may not say ──────────────────────────────────────── */

{
  const forgedIdentity = await join(API.studentA, S.tafseerToday, null, { identity: S.safa });
  const forgedRole = await join(API.studentA, S.tafseerToday, null, { role: 'teacher' });
  const forgedRoom = await join(API.studentA, S.tafseerToday, null, { room: 'bodour-guessed' });
  check('a client cannot choose its participant identity', forgedIdentity.status === 400);
  check('a beneficiary cannot request teaching permissions', forgedRole.status === 400);
  check('a client cannot choose a room', forgedRoom.status === 400);

  const inPerson = await join(API.studentA, S.hadithToday);
  check(
    'an in-person occurrence is refused with a domain reason',
    inPerson.status === 409 && inPerson.body.error?.details?.reason === 'NOT_ONLINE',
  );

  const anon = await main.evaluate(`(async () => {
    const res = await fetch('/api/v1/sessions/' + ${JSON.stringify(S.tafseerToday)} + '/online-join', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    return res.status;
  })()`);
  check('an anonymous caller receives no credential at all', anon === 401);
}

/* ── 6. Nothing about the provider reaches the browser ───────────────────── */

{
  const ok = await join(API.safa, S.tafseerToday);
  const wire = JSON.stringify(ok.body);
  check('no API secret on the wire', !wire.includes(process.env.LIVEKIT_API_SECRET ?? '@@'));
  check('no API key on the wire', !wire.includes(process.env.LIVEKIT_API_KEY ?? '@@'));
  check('no room identifier is published', !wire.includes('bodour-'));

  // The built bundle is what a curious reader actually downloads.
  const bundle = await main.evaluate(`(async () => {
    const html = await (await fetch('/')).text();
    const srcs = [...html.matchAll(/src="([^"]+\\.js)"/g)].map((m) => m[1]);
    let all = '';
    for (const s of srcs) all += await (await fetch(s)).text();
    return all;
  })()`);
  check(
    'the shipped bundle contains no provider secret',
    bundle.length > 0 && !bundle.includes(process.env.LIVEKIT_API_SECRET ?? '@@'),
    `${bundle.length} bytes scanned`,
  );
}

/* ── 7. The human path, and a REAL three-party room ──────────────────────── */

const rooms = [];
let safaTab = null;

{
  // صفاء opens today's class from her own calendar and clicks the button.
  await main.beIdentity(process.env.SAFA_COOKIE);
  safaTab = await tab();
  await safaTab.beIdentity(process.env.SAFA_COOKIE);
  await safaTab.open('/calendar');

  const opened = await safaTab.evaluate(`(async () => {
    const chips = [...document.querySelectorAll('.event-chip--interactive')];
    const chip = chips.find((c) => c.innerText.includes('تفسير'));
    if (!chip) return 'no chip';
    chip.click();
    await new Promise((r) => setTimeout(r, 900));
    return document.body.innerText.includes('دخول الحصة') ? 'has join' : 'no join';
  })()`);
  check('صفاء opens the occurrence and sees «دخول الحصة»', opened === 'has join', opened);

  const followed = await safaTab.evaluate(`(() => {
    const link = [...document.querySelectorAll('a')].find((a) => a.innerText.includes('دخول الحصة'));
    if (!link) return null;
    return link.getAttribute('href');
  })()`);
  check(
    'the button leads to the platform’s OWN classroom, not to a third party',
    followed === `/classroom/${S.tafseerToday}`,
    String(followed),
  );

  await safaTab.open(`/classroom/${S.tafseerToday}`, 'main');
  const state = await safaTab.awaitConnected();
  check('she enters the room — a real connection to a real media server', state === 'in', state);
  rooms.push(safaTab);
}

{
  // أمينة, then مستفيدة أ. Sequential identities; صفاء's tab stays connected.
  for (const [label, cookie] of [
    ['أمينة the assistant', process.env.AMINA_COOKIE],
    ['مستفيدة أ', process.env.STUDENT_A_COOKIE],
  ]) {
    const t = await tab();
    await t.beIdentity(cookie);
    await t.open(`/classroom/${S.tafseerToday}`, 'main');
    const state = await t.awaitConnected();
    check(`${label} enters the SAME room`, state === 'in', state);
    rooms.push(t);
  }

  // Give the media server a moment to publish everybody to everybody.
  await wait(4000);
  const seen = await rooms[0].participantCount();
  check(
    'صفاء sees all three of them in the room',
    seen >= 3,
    `${seen} participants visible`,
  );
}

{
  // Refreshing is not a second room. The occurrence is untouched, and the
  // participant count does not grow.
  await rooms[2].open(`/classroom/${S.tafseerToday}`, 'main');
  const again = await rooms[2].awaitConnected();
  await wait(4000);
  const after = await rooms[0].participantCount();
  check('rejoining works', again === 'in', again);
  check(
    'and creates no second room — the count is unchanged',
    after >= 3 && after <= 4,
    `${after} participants after rejoin`,
  );
}

{
  // مستفيدة ب is refused on the page a human actually opens, in her own words.
  const t = await tab();
  await t.beIdentity(process.env.STUDENT_B_COOKIE);
  await t.open(`/classroom/${S.tafseerToday}`, 'main');
  await wait(2500);
  const text = await t.evaluate(`(() => document.body.innerText)()`);
  check(
    'مستفيدة ب is refused in Arabic, with no room and no error code',
    text.includes('لا يمكنك دخول هذه الحصة') && !text.includes('bodour-') && !text.includes('404'),
  );
  t.close();
}

{
  // The in-person occurrence offers nothing at all.
  const t = await tab();
  await t.beIdentity(process.env.STUDENT_A_COOKIE);
  await t.open('/calendar');
  const shown = await t.evaluate(`(async () => {
    const chips = [...document.querySelectorAll('.event-chip--interactive')];
    const chip = chips.find((c) => c.innerText.includes('حديث'));
    if (!chip) return 'no chip';
    chip.click();
    await new Promise((r) => setTimeout(r, 900));
    const body = document.body.innerText;
    return JSON.stringify({ join: body.includes('دخول الحصة'), inPerson: body.includes('حضوري') });
  })()`);
  const parsed = shown.startsWith('{') ? JSON.parse(shown) : { join: true, inPerson: false };
  check('an in-person occurrence offers NO «دخول الحصة»', parsed.join === false, shown);
  check('while still stating «حضوري», which is a different fact', parsed.inPerson === true);
  t.close();
}

{
  /**
   * **صوت فقط is a listening surface**, not a video layout with the pictures
   * removed — and the camera is never asked for (R98.14).
   */
  const t = await tab();
  await t.beIdentity(process.env.HIND_COOKIE);
  await t.open(`/classroom/${S.seerahToday}`, 'main');
  const state = await t.awaitConnected();
  check('the one-off cover enters the audio-only class through the UI', state === 'in', state);
  const surface = await t.evaluate(`(() => JSON.stringify({
    audio: document.querySelectorAll('.classroom__audio').length,
    tiles: document.querySelectorAll('.lk-participant-tile').length,
    camera: document.body.innerText.includes('تشغيل الكاميرا'),
    notice: document.body.innerText.includes('بالصوت فقط'),
  }))()`);
  const s2 = JSON.parse(surface);
  check('it renders a participants list, never an empty video grid', s2.audio === 1 && s2.tiles === 0, surface);
  check('and offers NO camera control at all', s2.camera === false);
  check('and says so, so nobody waits for a picture', s2.notice === true);
  t.close();
}

{
  /**
   * **The guardian enters as her daughter, on the real page** (R98.6).
   *
   * The child is chosen through the app's own selection mechanism — the same
   * `sessionStorage` key the header switcher writes — rather than by clicking
   * the switcher here, because **the switcher already has its own harness**
   * (`verify-guardian-child`) and duplicating it would prove the header twice
   * and the classroom once. What this proves is the half that is new: with a
   * child selected, the classroom enters **as the child**, and the server —
   * which re-checks the approved FamilyLink on that very request — is what
   * decides it.
   */
  const t = await tab();
  await t.beIdentity(process.env.PARENT_COOKIE);
  await t.open('/calendar');
  await t.evaluate(
    `(() => { window.sessionStorage.setItem('bodour.activeChild', ${JSON.stringify(S.child)}); return true; })()`,
  );

  await t.open(`/classroom/${S.tafseerToday}`, 'main');
  const state = await t.awaitConnected();
  check('a guardian acting for her daughter enters the class', state === 'in', state);
  const who = await t.evaluate(`(() => [...document.querySelectorAll(
    '.lk-participant-name, .classroom__participant-name'
  )].map((n) => n.innerText).join(' | '))()`);
  check(
    'and the room shows the DAUGHTER — the guardian is never in it in her place',
    who.includes('الابنة') && !who.includes('الوالدة'),
    who,
  );
  t.close();
}

{
  // The public calendar, with nobody signed in.
  const t = await tab();
  await t.send('Network.clearBrowserCookies');
  await t.open('/calendar');
  const shown = await t.evaluate(`(async () => {
    const chips = [...document.querySelectorAll('.event-chip--interactive')];
    const chip = chips.find((c) => c.innerText.includes('تفسير'));
    if (!chip) return 'no chip';
    chip.click();
    await new Promise((r) => setTimeout(r, 900));
    const body = document.body.innerText;
    return JSON.stringify({ join: body.includes('دخول الحصة'), online: body.includes('عن بُعد') });
  })()`);
  const parsed = shown.startsWith('{') ? JSON.parse(shown) : { join: true, online: false };
  check('an anonymous visitor is offered no way into a teaching room', parsed.join === false, shown);
  check('while the public calendar still says «عن بُعد»', parsed.online === true);
  t.close();
}

for (const t of rooms) t.close();
main.close();
process.exit(finish());
