/**
 * **R269 — «تعديل الحصة» → النوع: اختبار**, through the real screens.
 *
 * 1. The مؤطِّرة opens today's online class in «حصص الجدول» → «تعديل».
 * 2. «النوع» offers the exam types; choosing one swaps the form for what an
 *    exam needs, prefilled; «تحويلها إلى اختبار».
 * 3. The row says «أصبحت اختبارًا», offers «إرجاعها حصة» and no «تعديل».
 * 4. A beneficiary's calendar shows the exam, whose «دخول الحصة» is the
 *    class's own call.
 * 5. «إرجاعها حصة» changes it back: the row is an ordinary class again.
 *
 * `SHOTS=<dir>` writes screenshots at 1366 and 390 px.
 */
import { writeFileSync } from 'node:fs';

import { connect, newPage, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.R98_SCENARIO ?? '{}');
const PORT = process.env.PORT ?? '9255';
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
  page.waitFor = async (predicate, tries = 60) => {
    for (let i = 0; i < tries; i += 1) {
      const ok = await page.evaluate(`(() => Boolean(${predicate}))()`).catch(() => false);
      if (ok) return true;
      await wait(400);
    }
    return false;
  };
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

/** Today's row in «حصص الجدول»: its status text and its action labels. */
const todayRow = `(() => {
  const row = [...document.querySelectorAll('.admin-table tbody tr')].find((tr) =>
    tr.querySelector('time')?.getAttribute('datetime') === ${JSON.stringify(S.today ?? '')} ||
    tr.querySelector('time')?.getAttribute('datetime') === new Date().toLocaleDateString('en-CA'));
  if (!row) return null;
  return {
    text: row.innerText.replace(/\\s+/g, ' '),
    actions: [...row.querySelectorAll('.row-action')].map((b) => b.textContent.trim()),
  };
})()`;
const clickRowAction = (label) => `(() => {
  const row = [...document.querySelectorAll('.admin-table tbody tr')].find((tr) =>
    tr.querySelector('time')?.getAttribute('datetime') === new Date().toLocaleDateString('en-CA'));
  [...row.querySelectorAll('.row-action')].find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click();
})()`;

const main = await tab(true);
const sessionsPage = `/teacher/schedules/${S.tafseerSchedule}/sessions`;

// 1–2 — «تعديل الحصة» → النوع.
await main.beIdentity(process.env.SAFA_COOKIE);
const teacher = await tab();
await teacher.beIdentity(process.env.SAFA_COOKIE);
await teacher.open(sessionsPage, '.admin-table tbody tr');
const before = await teacher.evaluate(todayRow);
check('today\'s class is in «حصص الجدول», editable', before?.actions.includes('تعديل') === true, JSON.stringify(before));
await teacher.evaluate(clickRowAction('تعديل'));
check('«تعديل الحصة» offers «النوع»',
  await teacher.waitFor(`[...document.querySelectorAll('dialog[open] label')].some((l) => l.textContent.trim().startsWith('النوع'))`, 30));
const typeChosen = await teacher.evaluate(`(() => {
  const field = [...document.querySelectorAll('dialog[open] .field')].find((f) => f.querySelector('label')?.textContent.trim().startsWith('النوع'));
  const select = field?.querySelector('select');
  const option = [...(select?.options ?? [])].find((o) => o.value !== '');
  if (!option) return null;
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, option.value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return option.textContent.trim();
})()`);
check('an exam type is offered and chosen', typeChosen !== null, String(typeChosen));
check('the form becomes the exam\'s: «تحويلها إلى اختبار», the class\'s own fields gone',
  await teacher.waitFor(`[...document.querySelectorAll('dialog[open] button')].some((b) => b.textContent.trim() === 'تحويلها إلى اختبار')
    && !document.querySelector('dialog[open] input[name="scope"]')`, 20));
check('the Subject is prefilled from the class',
  await teacher.evaluate(`(() => {
    const field = [...document.querySelectorAll('dialog[open] .field')].find((f) => f.querySelector('label')?.textContent.trim().startsWith('المادة'));
    return Boolean(field?.querySelector('select')?.value);
  })()`));
await teacher.shot('r269-convert-form');
await teacher.evaluate(`(() => [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.trim() === 'تحويلها إلى اختبار').click())()`);

// 3 — the row.
check('the dialog closes and the row says «أصبحت اختبارًا»',
  await teacher.waitFor(`!document.querySelector('dialog[open]') && (${todayRow})?.text.includes('أصبحت اختبارًا')`, 40),
  JSON.stringify(await teacher.evaluate(todayRow)));
const after = await teacher.evaluate(todayRow);
check('it offers «إرجاعها حصة», and no «تعديل» or «إلغاء»',
  after?.actions.includes('إرجاعها حصة') && !after.actions.includes('تعديل') && !after.actions.includes('إلغاء الحصة'),
  JSON.stringify(after?.actions));
await teacher.shot('r269-row');

// 4 — the beneficiary's calendar.
await main.beIdentity(process.env.STUDENT_A_COOKIE);
const student = await tab();
await student.beIdentity(process.env.STUDENT_A_COOKIE);
await student.open('/calendar?subject_id=', '.is-today .event-chip--interactive');
const offered = await student.evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const chips = () => [...document.querySelectorAll('.is-today .event-chip--interactive')];
  const count = chips().length;
  for (let i = 0; i < count; i += 1) {
    chips()[i].click();
    await wait(500);
    const dialog = document.querySelector('dialog[open]');
    const link = [...(dialog?.querySelectorAll('a') ?? [])].find(
      (a) => a.getAttribute('href') === ${JSON.stringify(`/classroom/${S.tafseerToday}`)},
    );
    const title = dialog?.querySelector('h2')?.textContent ?? '';
    dialog?.querySelector('button[aria-label="إغلاق"]')?.click();
    await wait(250);
    if (link) return { count, title, text: link.textContent.trim() };
  }
  return { count, title: null };
})()`);
check('the calendar shows the exam, and its «دخول الحصة» is the class\'s own call',
  offered.title !== null && offered.text === 'دخول الحصة', JSON.stringify(offered));
await student.shot('r269-calendar');

// 5 — «إرجاعها حصة».
await main.beIdentity(process.env.SAFA_COOKIE_2);
const back = await tab();
await back.beIdentity(process.env.SAFA_COOKIE_2);
await back.open(sessionsPage, '.admin-table tbody tr');
await back.evaluate(clickRowAction('إرجاعها حصة'));
await back.waitFor(`document.querySelector('dialog[open]')`, 10);
await back.evaluate(`(() => [...document.querySelectorAll('dialog[open] button')]
  .filter((b) => b.textContent.trim() === 'إرجاعها حصة').pop().click())()`);
check('«إرجاعها حصة» changes it back: an ordinary, editable class',
  await back.waitFor(`(${todayRow})?.actions.includes('تعديل') && !(${todayRow}).text.includes('أصبحت اختبارًا')`, 40),
  JSON.stringify(await back.evaluate(todayRow)));

process.exit(finish());
