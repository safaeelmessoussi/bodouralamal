/**
 * **R266 — «دخول الحصة» from five minutes before, «إنهاء الحصة للجميع», and the
 * classroom as part of the platform**, against a REAL local LiveKit server.
 *
 * 1. A beneficiary opens today's class from her calendar and enters.
 * 2. The مؤطِّرة enters; only she is offered «إنهاء الحصة للجميع».
 * 3. An audio-only class shows a card per person, the مؤطِّرة first.
 * 4. The مؤطِّرة ends the class: both tabs show «انتهت الحصة».
 * 5. Entering again is refused in words; the calendar offers no «دخول الحصة».
 *
 * `SHOTS=<dir>` writes screenshots at 1366 and 390 px.
 */
import { writeFileSync } from 'node:fs';

import { connect, newPage, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.R98_SCENARIO ?? '{}');
const PORT = process.env.PORT ?? '9253';
const SHOTS = process.env.SHOTS ?? '';
const { check, finish } = results();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function tab(existing = false) {
  const page = existing ? await connect(PORT) : await newPage(PORT);
  page.size = async (width) =>
    page.send('Emulation.setDeviceMetricsOverride', {
      width,
      height: width < 600 ? 844 : 900,
      deviceScaleFactor: 1,
      mobile: width < 600,
    });
  await page.size(1366);
  page.beIdentity = async (cookie) => {
    await page.send('Network.clearBrowserCookies');
    await page.send('Network.setCookie', {
      name: 'bodour_refresh',
      value: cookie,
      domain: 'localhost',
      path: '/api/v1/auth',
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
    await wait(900);
  };
  page.text = async () =>
    page.evaluate(`(() => document.body.innerText.replace(/\\s+/g, ' '))()`).catch(() => '');
  page.waitFor = async (predicate, tries = 60) => {
    for (let i = 0; i < tries; i += 1) {
      const ok = await page.evaluate(`(() => Boolean(${predicate}))()`).catch(() => false);
      if (ok) return true;
      await wait(400);
    }
    return false;
  };
  page.connected = () =>
    page.waitFor(`document.querySelector('.classroom__stage')?.getAttribute('data-connection') === 'connected'`, 80);
  page.shot = async (name) => {
    if (!SHOTS) return;
    for (const width of [1366, 390]) {
      await page.size(width);
      await wait(700);
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${SHOTS}/${name}-${width}.png`, Buffer.from(data, 'base64'));
    }
    await page.size(1366);
  };
  return page;
}

const main = await tab(true);
const classroom = `/classroom/${S.tafseerToday}`;

/**
 * Opens each of today's online chips; returns how many there were and whether
 * one's dialog leads to `href`. The count is the positive control: «not
 * offered» means nothing unless the chips were actually there.
 */
const dialogOffers = (page, href) =>
  page.evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const chips = () => [...document.querySelectorAll('.is-today .event-chip--interactive')].filter(
      (c) => c.querySelector('.event-chip__delivery'),
    );
    const count = chips().length;
    for (let i = 0; i < count; i += 1) {
      chips()[i].click();
      await wait(500);
      const link = [...document.querySelectorAll('dialog[open] a')].find(
        (a) => a.getAttribute('href') === ${JSON.stringify(href)},
      );
      document.querySelector('dialog[open] button[aria-label="إغلاق"]')?.click();
      await wait(250);
      if (link) return { count, offered: true };
    }
    return { count, offered: false };
  })()`);

// 1 — the beneficiary, from her calendar.
await main.beIdentity(process.env.STUDENT_A_COOKIE);
const student = await tab();
await student.beIdentity(process.env.STUDENT_A_COOKIE);
await student.open(classroom);
check('the beneficiary enters the class', await student.connected());
const studentText = await student.text();
check('the room is named in its own header (title, times, «مباشر»)',
  studentText.includes('مباشر') && /\d{2}:\d{2} — \d{2}:\d{2}/.test(studentText), studentText.slice(0, 160));
check('a beneficiary is NOT offered «إنهاء الحصة للجميع»',
  !(await student.evaluate(`(() => Boolean(document.querySelector('[aria-label="إنهاء الحصة للجميع"]')))()`)));

// 2 — the مؤطِّرة.
await main.beIdentity(process.env.SAFA_COOKIE);
const teacher = await tab();
await teacher.beIdentity(process.env.SAFA_COOKIE);
await teacher.open('/calendar?subject_id=', '.is-today .event-chip--interactive');
const before = await dialogOffers(teacher, classroom);
check('the calendar offers «دخول الحصة» on a class that is running', before.offered, JSON.stringify(before));
await teacher.open(classroom);
check('the مؤطِّرة enters the class', await teacher.connected());
check('the مؤطِّرة is offered «إنهاء الحصة للجميع»',
  await teacher.waitFor(`document.querySelector('[aria-label="إنهاء الحصة للجميع"]')`, 10));
check('both see two people present',
  await teacher.waitFor(`document.body.innerText.includes('الحاضرون: 2')`, 30));
await teacher.shot('r266-teacher-video');
await student.shot('r266-student-video');

// 3 — an audio-only class.
await main.beIdentity(process.env.HIND_COOKIE);
const cover = await tab();
await cover.beIdentity(process.env.HIND_COOKIE);
await cover.open(`/classroom/${S.seerahToday}`);
check('the audio-only class connects', await cover.connected());
check('it shows a card per person with the مؤطِّرة badge',
  await cover.waitFor(`document.querySelector('.classroom__participant.is-teacher .classroom__badge')`, 20));
await cover.shot('r266-audio-only');

// 4 — «إنهاء الحصة للجميع».
await teacher.evaluate(`(() => document.querySelector('[aria-label="إنهاء الحصة للجميع"]').click())()`);
check('a confirmation is asked first',
  await teacher.waitFor(`document.querySelector('dialog[open]')?.innerText.includes('لن يمكن لأحد الدخول')`, 10));
await teacher.shot('r266-confirm');
await teacher.evaluate(`(() => [...document.querySelectorAll('dialog[open] button')]
  .find((b) => b.textContent.trim() === 'إنهاء الحصة').click())()`);
check('the مؤطِّرة sees «انتهت الحصة»',
  await teacher.waitFor(`document.querySelector('.classroom-card__title')?.textContent === 'انتهت الحصة'`, 30));
check('the beneficiary is put out and sees «انتهت الحصة»',
  await student.waitFor(`document.querySelector('.classroom-card__title')?.textContent === 'انتهت الحصة'`, 40),
  (await student.text()).slice(0, 160));
check('no «إعادة الدخول» after the end',
  !(await student.text()).includes('إعادة الدخول'));
await student.shot('r266-ended');

// 5 — nobody enters after, and the calendar no longer offers the door.
await main.beIdentity(process.env.STUDENT_A_COOKIE_2);
const again = await tab();
await again.beIdentity(process.env.STUDENT_A_COOKIE_2);
await again.open(classroom);
check('entering again is refused in words',
  await again.waitFor(`document.body.innerText.includes('انتهت هذه الحصة، ولم يعد الدخول إليها ممكنًا.')`, 20),
  (await again.text()).slice(0, 200));
await again.shot('r266-refused');
await main.beIdentity(process.env.SAFA_COOKIE_2);
const teacherAfter = await tab();
await teacherAfter.beIdentity(process.env.SAFA_COOKIE_2);
await teacherAfter.open('/calendar?subject_id=', '.is-today .event-chip--interactive');
const after = await dialogOffers(teacherAfter, classroom);
check('the calendar no longer offers «دخول الحصة» for it (today\'s online chips were there)',
  after.count > 0 && !after.offered, JSON.stringify(after));

finish();
