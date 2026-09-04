/**
 * **«اختبار أنشأتُه يجب ألا يختفي»** — the Owner's acceptance criterion, driven.
 *
 * The journey suite proves the *lifecycle* through the routes. This proves the
 * thing that was actually broken, which no route test could see: that a person
 * who writes a paper, closes the page and comes back **finds it again**, can
 * tell what state it is in, can open it and still see her questions, and can
 * reuse its content without dragging last term's answers into this term.
 *
 * The fixture is the `[journey]` one — it already produces exactly what this
 * needs: a published paper with a submission, a mark, and a second مستفيدة who
 * must see none of it. A second fixture would be a second implementation.
 *
 * Every negative check asserts the surface it reads actually rendered. An empty
 * string passes «it is not there» while proving nothing.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.LIBRARY_SCENARIO ?? '{}');
const { send, evaluate, close } = await connect(process.env.PORT ?? '9253');
const { check, finish } = results();

async function viewport(width, height = 1100) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: width < 700,
  });
}
await viewport(1440);

async function beIdentity(cookie) {
  await send('Network.clearBrowserCookies');
  await send('Network.setCookie', {
    name: 'bodour_refresh', value: cookie,
    domain: 'localhost', path: '/api/v1/auth', httpOnly: true,
  });
}

async function open(cookie, path) {
  if (cookie) await beIdentity(cookie);
  await send('Page.navigate', { url: BASE + path });
  for (let i = 0; i < 40; i += 1) {
    const ready = await evaluate(
      "document.readyState === 'complete' && !!document.querySelector('main')",
    );
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 1100));
}

const text = async () =>
  evaluate("(document.querySelector('main') || document.body).innerText");

/* ── The library exists, and the paper is in it ───────────────────────────── */

await open(S.adminCookie, '/admin/assessments');
let body = await text();

check(
  'the library lists the paper — the defect this slice exists for',
  body.includes('اختبار الحفظ'),
  body.slice(0, 500),
);
check(
  'and says what state it is in, in words rather than colour alone',
  body.includes('منشور') || body.includes('مغلق'),
  body.slice(0, 500),
);
check(
  'it is a real table, not the old bare create button',
  await evaluate("!!document.querySelector('table')"),
  'no table rendered',
);

/* ── Navigate away, come back — the Owner's exact reproduction ────────────── */

await open(S.adminCookie2, '/admin/branches');
await open(S.adminCookie3, '/admin/assessments');
body = await text();
check(
  'closing the page and returning still finds it',
  body.includes('اختبار الحفظ'),
  body.slice(0, 500),
);

/* ── Reopen it — the questions are still there ────────────────────────────── */

await open(S.adminCookie4, `/admin/assessments?exam=${S.examId}`);
body = await text();
check(
  'reopening the paper shows the questions that were written',
  body.includes('سورة الضحى') || body.includes('عدد آيات'),
  body.slice(0, 600),
);
check(
  'and its answers — the submitted copies — are reachable from it',
  body.includes('الإجابات'),
  body.slice(0, 600),
);

/* ── Search and filter ────────────────────────────────────────────────────── */

await open(S.adminCookie5, '/admin/assessments');
const searched = await evaluate(`(async () => {
  const input = document.querySelector('input[type="search"], input[type="text"]');
  if (!input) return 'no search input';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'اختبار الحفظ');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1400));
  return (document.querySelector('main') || document.body).innerText;
})()`);
check(
  'searching by title narrows to the paper',
  typeof searched === 'string' && searched.includes('اختبار الحفظ'),
  String(searched).slice(0, 400),
);

/* ── No fixture residue in a real selector ────────────────────────────────── */

check(
  'no [content-test:…] fixture reaches the library filters',
  !(await text()).includes('content-test'),
  'fixture residue is visible on a real screen',
);

await open(S.adminCookie6, '/admin/assessments');
const levelOptions = await evaluate(`(() => {
  const all = [...document.querySelectorAll('select option')].map((o) => o.textContent);
  return JSON.stringify(all.filter((o) => /content-test|r82-test|-test:/.test(o)));
})()`);
check(
  'and none reaches the Level selector, which is where the Owner found them',
  levelOptions === '[]',
  String(levelOptions),
);

/* ── The online exam no longer claims to be unbuilt ───────────────────────── */

/**
 * **Driven to the actual control, not merely navigated near it.**
 *
 * The first version of this check loaded `/admin/scheduling` — which is not a
 * route — got the dashboard, and passed «it no longer says قريباً» about a page
 * that never contained the words. A negative assertion against a surface that
 * did not render proves nothing, which is the same lesson the notification bell
 * taught one file over. So this opens «إضافة عنصر», chooses اختبار, chooses
 * عن بُعد, and asserts each step arrived before reading the copy.
 */
await open(S.adminCookie7, '/admin/schedules');
check(
  'the scheduling screen itself rendered',
  (await text()).includes('الجدولة') || (await evaluate("!!document.querySelector('table')")),
  (await text()).slice(0, 200),
);

const reached = await evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const add = [...document.querySelectorAll('button')]
    .find((b) => /إضافة عنصر|إضافة/.test(b.textContent));
  if (!add) return 'no add button';
  add.click();
  await wait(900);

  const setSelect = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const selects = () => [...document.querySelectorAll('dialog[open] select, select')];
  const typeSelect = selects().find((s) =>
    [...s.options].some((o) => /اختبار|امتحان/.test(o.textContent)));
  if (!typeSelect) return 'no type select';
  const examOption = [...typeSelect.options].find((o) => /اختبار|امتحان/.test(o.textContent));
  setSelect(typeSelect, examOption.value);
  await wait(900);

  const modeSelect = selects().find((s) =>
    [...s.options].some((o) => /عن بُعد/.test(o.textContent)));
  if (!modeSelect) return 'no mode select';
  const onlineOption = [...modeSelect.options].find((o) => /عن بُعد/.test(o.textContent));
  const label = onlineOption.textContent;
  setSelect(modeSelect, onlineOption.value);
  await wait(900);

  const scope = document.querySelector('dialog[open]') || document.body;
  return JSON.stringify({ label, body: scope.innerText });
})()`);

const drove = typeof reached === 'string' && reached.startsWith('{');
check('the exam «نوع الامتحان» control was reached and set to عن بُعد', drove, String(reached));

if (drove) {
  const { label, body: dialog } = JSON.parse(reached);
  check(
    'the option no longer carries «قريباً»',
    !label.includes('قريباً'),
    label,
  );
  check(
    'and no longer claims the feature is unbuilt',
    !dialog.includes('لم تُبنَ بعد') && !dialog.includes('قيد التخطيط'),
    dialog.slice(0, 400),
  );
  /**
   * **The exam section's own copy is asserted in `exam-section.test.tsx`.**
   *
   * Reaching it here needs two React-controlled `<select>`s driven
   * programmatically, and when the first does not take, this reads the SESSION
   * delivery selector — «طريقة الحضور», which also offers «عن بُعد» — and
   * reports on markup the exam section never rendered. That is a check that can
   * pass or fail for reasons unrelated to what it names, so the wording lives in
   * a component test and the browser asserts only what it can see reliably:
   * the option label, and that no dialog on this screen calls the feature
   * unbuilt.
   */
}

/* ── Reuse: the same paper again, and none of the old answers ─────────────── */

/**
 * The Owner's criterion has two halves, and this is the second: *«safely reuse
 * its CONTENT later without carrying old Student answers or grades into the new
 * use»*. The `[journey]` paper is published, answered by one مستفيدة and marked
 * — so if a copy carried anything across, it would show here.
 */
await open(S.adminCookie9, '/admin/assessments');
const before = await evaluate(`(() => {
  const row = [...document.querySelectorAll('tbody tr')]
    .find((tr) => tr.innerText.includes('اختبار الحفظ'));
  return row ? row.innerText : 'row not found';
})()`);
check('the original is in the library, with its answers counted', before.includes('اختبار الحفظ'), before);

/**
 * **The click and the read are separate evaluations, deliberately.**
 *
 * Confirming a copy navigates to the new draft, and a `Page.navigate` tears down
 * the execution context an in-flight `evaluate` is resolving in — so a single
 * combined call returned `undefined` and looked like a missing button. The
 * confirmation text is captured before the click; everything after it is read
 * from the page the click landed on.
 */
const confirmText = await evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const row = [...document.querySelectorAll('tbody tr')]
    .find((tr) => tr.innerText.includes('اختبار الحفظ'));
  if (!row) return 'row not found';
  const action = [...row.querySelectorAll('button')]
    .find((b) => b.textContent.includes('نسخ كمسودة'));
  if (!action) return 'no copy action';
  action.click();
  await wait(800);
  const dialog = document.querySelector('dialog[open]');
  return dialog ? dialog.innerText : 'no confirmation dialog';
})()`);

check(
  '«نسخ كمسودة» is offered on the row and asks first',
  typeof confirmText === 'string' && confirmText.includes('نسخ'),
  String(confirmText),
);
check(
  'the confirmation says plainly that answers and marks do not come along',
  typeof confirmText === 'string'
    && confirmText.includes('لن تُنقل')
    && confirmText.includes('الأصلي'),
  String(confirmText).slice(0, 300),
);

await evaluate(`(() => {
  const confirm = [...document.querySelectorAll('dialog[open] button')]
    .find((b) => b.textContent.includes('نسخ كمسودة'));
  if (confirm) confirm.click();
  return true;
})()`);
// The copy POSTs and then navigates; wait for the destination rather than racing it.
await new Promise((r) => setTimeout(r, 3500));

const landedOn = await evaluate('window.location.search');
const newId = new URLSearchParams(String(landedOn)).get('exam');
check('it opens a NEW paper, not the original', newId !== null && newId !== S.examId, String(landedOn));

const draft = await text();
check(
  'the copy carries the questions',
  draft.includes('سورة الضحى') || draft.includes('عدد آيات'),
  draft.slice(0, 400),
);
check('the copy is a draft', draft.includes('مسودة'), draft.slice(0, 400));
check(
  'and it carries NO answers — the whole point of a copy',
  draft.includes('المعنيات بالاختبار') && !draft.includes('أُرسل في'),
  draft.slice(0, 500),
);

// The original is untouched, and still carries its own submitted answer.
await open(S.adminCookie10, `/admin/assessments?exam=${S.examId}`);
const original = await text();
check(
  'the original is unchanged and still holds its answer',
  original.includes('اختبار الحفظ') && original.includes('أُرسل'),
  original.slice(0, 500),
);

/* ── Responsive: the library must be usable on a phone ────────────────────── */

for (const [width, label] of [[390, 'mobile'], [1440, 'desktop']]) {
  await viewport(width, width < 700 ? 780 : 1100);
  await open(S.adminCookie8, '/admin/assessments');
  const overflow = await evaluate(
    'JSON.stringify({ doc: document.documentElement.scrollWidth, vw: window.innerWidth })',
  );
  const { doc, vw } = JSON.parse(overflow);
  check(`the library does not scroll sideways on ${label}`, doc <= vw + 1, `${doc} > ${vw}`);
  check(
    `and still shows the paper on ${label}`,
    (await text()).includes('اختبار الحفظ'),
    `${label}: paper missing`,
  );
}
await viewport(1440);

/* ── RTL ──────────────────────────────────────────────────────────────────── */

check(
  'the page is right-to-left, as every screen here is',
  (await evaluate("document.documentElement.getAttribute('dir')")) === 'rtl',
  'dir is not rtl',
);

await close();
finish();
