/**
 * **Simple grading, driven end to end (SRS Revision 81).**
 *
 * Two exams with different maxima, marked, published and read back as a
 * beneficiary — because the property the Owner asked for is that `15 / 20` and
 * `8 / 10` can sit beside each other, and nothing but the real screens can show
 * that they do.
 *
 * It also checks the two settings are **gone from the page**, not merely absent
 * from a payload: the complaint was that they appeared on إعدادات المنصة.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const COOKIE = process.env.DEV_REFRESH_COOKIE;
if (!COOKIE) throw new Error('DEV_REFRESH_COOKIE is required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9235');
const { check, finish } = results();

await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth',
  httpOnly: true,
});
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
});

async function goto(path, ready = 'main') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 120; i += 1) {
    const ok = await evaluate(
      `(() => document.querySelector(${JSON.stringify(ready)}) !== null)()`,
    ).catch(() => false);
    if (ok) {
      await new Promise((r) => setTimeout(r, 600));
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/* ── 1 · the settings page ──────────────────────────────────────────────── */

await goto('/admin/settings', '.admin-table, .state, main');
const settings = await evaluate(`(() => {
  const text = document.querySelector('main').textContent;
  return {
    scale: text.includes('سُلّم النقاط'),
    threshold: text.includes('حدّ النجاح'),
    rows: document.querySelectorAll('.admin-table tbody tr').length,
    keys: [...document.querySelectorAll('main')].map((m) => m.textContent.length)[0],
  };
})()`);
check(
  '1 · إعدادات المنصة no longer offers «سُلّم النقاط»',
  settings.scale === false,
  JSON.stringify(settings),
);
check(
  '2 · nor «حدّ النجاح (من 10000)»',
  settings.threshold === false,
  JSON.stringify(settings),
);
check(
  '3 · and the page still renders its remaining settings',
  settings.keys > 100,
  `main text length ${settings.keys}`,
);

/* ── 2 · the grade sheets ───────────────────────────────────────────────── */

/** The maximum a sheet says its marks are out of, from the rendered header. */
const sheetHeader = () =>
  evaluate(`(() => {
    const heads = [...document.querySelectorAll('th')].map((h) => h.textContent.trim());
    const mark = heads.find((h) => h.includes('النقطة'));
    const input = document.querySelector('table input[type=number]');
    return {
      header: mark || null,
      max: input ? input.getAttribute('max') : null,
      step: input ? input.getAttribute('step') : null,
      verdict: document.body.textContent.includes('ناجح') || document.body.textContent.includes('راسب'),
    };
  })()`);

const exams = JSON.parse(process.env.R81_EXAMS ?? '{}');
/** Injected into the page's evaluations so a row is found by WHO, not where. */
const NAME_LITERAL = JSON.stringify(exams.studentName ?? '');
if (!exams.outOf20 || !exams.outOf10) throw new Error('R81_EXAMS must name both exams');

await goto(`/admin/exam-grades?exam=${exams.outOf20}`, 'table, .state');
const a = await sheetHeader();
check(
  `4 · the /20 exam's sheet says «النقطة (من 20)» — read as "${a.header}"`,
  a.header === 'النقطة (من 20)',
  JSON.stringify(a),
);
check(
  '5 · and its input is bounded at 20, in steps the column can store',
  a.max === '20' && a.step === '0.01',
  JSON.stringify(a),
);

await goto(`/admin/exam-grades?exam=${exams.outOf10}`, 'table, .state');
const b = await sheetHeader();
check(
  `6 · the /10 exam's sheet says «النقطة (من 10)» — read as "${b.header}"`,
  b.header === 'النقطة (من 10)',
  JSON.stringify(b),
);
check(
  '7 · bounded at 10 — the first exam did not decide it',
  b.max === '10',
  JSON.stringify(b),
);
check(
  '8 · neither sheet shows ناجحة or راسبة anywhere',
  a.verdict === false && b.verdict === false,
  JSON.stringify({ a: a.verdict, b: b.verdict }),
);

/* ── 3 · entering a mark, and being refused ─────────────────────────────── */

await goto(`/admin/exam-grades?exam=${exams.outOf20}`, 'table');
const entry = await evaluate(`(async () => {
  // **Her row, not the first row.** The sheet is ordered by name, so the first
  // input belongs to whoever sorts first — which stopped being the person the
  // harness then signs in as, and reported her grades missing.
  const input = [...document.querySelectorAll('table input[type=number]')].find((el) =>
    (el.getAttribute('aria-label') || '').includes(${NAME_LITERAL}),
  );
  if (!input) return { noInput: true };
  const setNative = (el, value) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  // Over the maximum first: the browser's own constraint should refuse it, and
  // the SERVER refuses it regardless — which the integration suite proves.
  setNative(input, '21');
  const overIsInvalid = !input.checkValidity();

  setNative(input, '15');
  const fifteenIsValid = input.checkValidity();

  const save = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('حفظ'));
  if (!save) return { overIsInvalid, fifteenIsValid, noSave: true };
  save.click();
  await new Promise((r) => setTimeout(r, 1500));
  return {
    overIsInvalid,
    fifteenIsValid,
    notice: (document.querySelector('.admin-notice') || {}).textContent || null,
    stored: input.value,
  };
})()`);
check(
  '9 · the form refuses 21 on a /20 exam before it is ever sent',
  entry.overIsInvalid === true && entry.fifteenIsValid === true,
  JSON.stringify(entry),
);
check(
  `10 · 15 saves and reads back as 15 — no conversion, no rounding`,
  entry.stored === '15',
  JSON.stringify(entry),
);

await goto(`/admin/exam-grades?exam=${exams.outOf10}`, 'table');
const entryB = await evaluate(`(async () => {
  const input = [...document.querySelectorAll('table input[type=number]')].find((el) =>
    (el.getAttribute('aria-label') || '').includes(${NAME_LITERAL}),
  );
  const setNative = (el, value) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  setNative(input, '8');
  const save = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('حفظ'));
  save.click();
  await new Promise((r) => setTimeout(r, 1500));
  const publish = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('نشر'));
  if (publish) {
    publish.click();
    await new Promise((r) => setTimeout(r, 1200));
    const confirm = [...document.querySelectorAll('dialog[open] button')].find((x) =>
      x.textContent.includes('نشر'),
    );
    if (confirm) confirm.click();
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { stored: input.value };
})()`);
check(
  '11 · 8 saves on the /10 exam, unaffected by the other exam',
  entryB.stored === '8',
  JSON.stringify(entryB),
);

/* ── 4 · returning to the first exam ────────────────────────────────────── */

await goto(`/admin/exam-grades?exam=${exams.outOf20}`, 'table');
const backToA = await sheetHeader();
check(
  '12 · the first exam is still out of 20 after the second was marked',
  backToA.header === 'النقطة (من 20)' && backToA.max === '20',
  JSON.stringify(backToA),
);

/* ── 5 · what the beneficiary herself sees ──────────────────────────────── */

const studentCookie = process.env.STUDENT_COOKIE;
if (studentCookie) {
  // Publish the first exam too, so both are visible to her.
  await goto(`/admin/exam-grades?exam=${exams.outOf20}`, 'table');
  await evaluate(`(async () => {
    const publish = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('نشر'));
    if (!publish) return false;
    publish.click();
    await new Promise((r) => setTimeout(r, 1200));
    const confirm = [...document.querySelectorAll('dialog[open] button')].find((x) =>
      x.textContent.includes('نشر'),
    );
    if (confirm) confirm.click();
    await new Promise((r) => setTimeout(r, 1500));
    return true;
  })()`);

  // **Her session replaces the administrator's**, so what follows is the page a
  // beneficiary loads — not an admin's rendering of her data.
  await send('Network.clearBrowserCookies');
  await send('Network.setCookie', {
    name: 'bodour_refresh',
    value: studentCookie,
    domain: 'localhost',
    path: '/api/v1/auth',
    httpOnly: true,
  });

  await goto('/dashboard/student/grades', 'table, .state, main');
  // The page fetches after mount, so `main` existing is not the page being
  // ready — a fixed wait raced it and reported her grades missing. Wait for a
  // ROW, which is the thing being measured.
  for (let i = 0; i < 60; i += 1) {
    const ready = await evaluate(`document.querySelectorAll('td').length > 0`).catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const mine = await evaluate(`(() => {
    const cells = [...document.querySelectorAll('td')].map((c) => c.textContent.trim());
    return {
      cells,
      body: document.body.textContent,
      hasTwenty: cells.some((c) => c.replace(/\\s+/g, '') === '15/20'),
      hasTen: cells.some((c) => c.replace(/\\s+/g, '') === '8/10'),
      verdict: document.body.textContent.includes('ناجح') || document.body.textContent.includes('راسب'),
      // **Column headers only.** Every row's first cell is a th as well, and one
      // of the seeded exams is literally titled «امتحان من 20» — matching any
      // th reported the exam's own NAME as a scale in the header. The same
      // identify-by-rendered-text trap this project has paid for before.
      headers: [...document.querySelectorAll('th[scope=col]')].map((h) => h.textContent.trim()),
      scaleInHeader: [...document.querySelectorAll('th[scope=col]')].some((h) =>
        h.textContent.includes('من '),
      ),
    };
  })()`);

  check(
    '13 · the beneficiary sees 15 / 20 for the first exam',
    mine.hasTwenty === true,
    JSON.stringify({ cells: mine.cells, body: mine.body.slice(0, 200) }),
  );
  check(
    '14 · and 8 / 10 for the second — two scales, one screen',
    mine.hasTen === true,
    JSON.stringify(mine.cells),
  );
  check(
    '15 · with no ناجحة/راسبة label anywhere on her page',
    mine.verdict === false,
    'body scanned for a verdict',
  );
  check(
    '16 · and no single scale in the column header, because there is not one',
    mine.scaleInHeader === false,
    JSON.stringify(mine.headers),
  );
} else {
  check('13-16 · beneficiary view SKIPPED — no STUDENT_COOKIE was provided', false, 'not run');
}

close();
process.exit(finish());
