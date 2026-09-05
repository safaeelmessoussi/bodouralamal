/**
 * **The one date picker, on the real screens it replaced a native input on.**
 *
 * DOB (public registration, no login), الفصول الدراسية (AcademicPeriod, R122),
 * بناء الاختبارات (the online assessment builder, R124) and الجدولة (a physical
 * exam's date, R58) — four call sites of `DateField`, in four different
 * portals, driven the way a person actually uses them: opened, drilled from
 * year → month → day, and read back in Arabic with Western digits. One pass is
 * also done with the keyboard alone, and one at a phone width, because both are
 * named requirements and neither is provable from a source scan.
 *
 * Every negative check asserts the surface it reads actually rendered first —
 * this project has shipped a check that passed against a page that never
 * loaded, twice, and the lesson stuck.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.DATE_PICKER_SCENARIO ?? '{}');
const { send, evaluate, close } = await connect(process.env.PORT ?? '9254');
const { check, finish } = results();

async function viewport(width, height = 900) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: width < 700,
  });
}
await viewport(1440);

async function beIdentity(cookie) {
  await send('Network.clearBrowserCookies');
  if (cookie) {
    await send('Network.setCookie', {
      name: 'bodour_refresh', value: cookie,
      domain: 'localhost', path: '/api/v1/auth', httpOnly: true,
    });
  }
}

async function open(cookie, path) {
  await beIdentity(cookie);
  await send('Page.navigate', { url: BASE + path });
  for (let i = 0; i < 40; i += 1) {
    const ready = await evaluate(
      "document.readyState === 'complete' && !!document.querySelector('main')",
    );
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 900));
}

const text = async () => evaluate("(document.querySelector('main') || document.body).innerText");
const html = async () => evaluate("(document.querySelector('main') || document.body).innerHTML");

/** No English date shape anywhere the picker rendered — the literal criterion
 *  the brief closes on. */
async function assertNoEnglishPlaceholder(label) {
  const body = await text();
  check(
    `${label}: no mm/dd/yyyy-shaped placeholder anywhere on the page`,
    !/\b(mm|dd|yyyy)\b/i.test(body),
    body.slice(0, 300),
  );
}

/** Clicks the Nth date-picker trigger found on the page (0-indexed) and
 *  returns whether the panel actually opened. */
async function openNthPicker(index) {
  return evaluate(`(() => {
    const triggers = [...document.querySelectorAll('.date-picker__trigger')];
    const el = triggers[${index}];
    if (!el) return 'no trigger at index ${index}';
    el.click();
    return true;
  })()`);
}

async function panelOpen() {
  return evaluate("!!document.querySelector('.date-picker__panel')");
}

/* ── 1 · DOB on the public registration form, drilled year → month → day ──── */

await open(null, `/register#onboarding_token=${S.onboardingToken}`);
let body = await text();
check('the registration page rendered, DOB field included', body.includes('تاريخ الميلاد'), body.slice(0, 300));
check(
  'the empty DOB control shows the Arabic placeholder, not mm/dd/yyyy',
  body.includes('يوم / شهر / سنة'),
  body.slice(0, 300),
);
await assertNoEnglishPlaceholder('register');

const opened = await openNthPicker(0);
check('clicking the DOB trigger opens the calendar', opened === true && (await panelOpen()), String(opened));

const drilled = await evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const panel = document.querySelector('.date-picker__panel');
  if (!panel) return 'no panel';

  // Day view → click the header to drill into month view.
  const monthHeader = panel.querySelector('.date-picker__head-title');
  if (!monthHeader) return 'no month header';
  monthHeader.click();
  await wait(300);

  // Month view → click its header (the bare year) to drill into year view.
  const yearHeader = document.querySelector('.date-picker__panel .date-picker__head-title');
  if (!yearHeader) return 'no year header';
  const yearBefore = yearHeader.textContent;
  yearHeader.click();
  await wait(300);

  // Year view → page back far enough for a real DOB, then pick 1990.
  const target = '1990';
  let page = document.querySelector('.date-picker__years');
  let tries = 0;
  while (page && ![...page.querySelectorAll('button')].some((b) => b.textContent === target) && tries < 20) {
    const prevBtn = [...document.querySelectorAll('.date-picker__panel .btn')]
      .find((b) => b.getAttribute('aria-label') === 'السنوات السابقة');
    if (!prevBtn) break;
    prevBtn.click();
    await wait(150);
    page = document.querySelector('.date-picker__years');
    tries += 1;
  }
  const yearBtn = [...document.querySelectorAll('.date-picker__years button')]
    .find((b) => b.textContent === target);
  if (!yearBtn) return 'year 1990 not reached, tries=' + tries;
  yearBtn.click();
  await wait(300);

  // Now in month view for 1990 — pick March.
  const monthsList = document.querySelector('.date-picker__months');
  if (!monthsList) return 'no months list after picking year';
  const marchBtn = [...monthsList.querySelectorAll('button')].find((b) => b.textContent.includes('مارس'));
  if (!marchBtn) return 'مارس not found: ' + monthsList.textContent;
  marchBtn.click();
  await wait(300);

  // Now in day view for March 1990 — pick the 12th.
  const grid = document.querySelector('.date-picker__grid');
  if (!grid) return 'no day grid after picking month';
  const dayBtn = [...grid.querySelectorAll('button')].find((b) => b.textContent.trim() === '12');
  if (!dayBtn) return 'day 12 not found';
  dayBtn.click();
  await wait(300);

  return JSON.stringify({ yearBefore, closed: !document.querySelector('.date-picker__panel') });
})()`);

const parsedDrill = typeof drilled === 'string' && drilled.startsWith('{') ? JSON.parse(drilled) : null;
check('drilling year → month → day reached a real cell and picked it', parsedDrill !== null, String(drilled));
check('choosing a day closes the panel', parsedDrill?.closed === true, String(drilled));

body = await text();
check(
  'the trigger now reads the chosen date in Arabic, Western digits, no reload needed',
  body.includes('12 مارس 1990'),
  body.slice(0, 400),
);
check('still no Arabic-Indic digits anywhere on the page', !/[٠-٩]/.test(body), body.slice(0, 300));

/* ── 2 · Keyboard-only: tab to the trigger, open and pick with the keyboard ── */

await open(null, `/register#onboarding_token=${S.onboardingToken}`);
const keyboardResult = await evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (el, key, shiftKey = false) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));

  const trigger = document.querySelector('.date-picker__trigger');
  if (!trigger) return 'no trigger';
  trigger.focus();
  if (document.activeElement !== trigger) return 'trigger did not accept focus';

  // ArrowDown opens the panel from the closed trigger (combobox convention).
  fire(trigger, 'ArrowDown');
  await wait(300);
  if (!document.querySelector('.date-picker__panel')) return 'ArrowDown did not open the panel';

  const focused = () => document.activeElement;
  const before = focused()?.id ?? null;
  fire(focused(), 'ArrowRight');
  await wait(150);
  const afterRight = focused()?.id ?? null;

  fire(focused(), 'Escape');
  await wait(300);
  const closedByEscape = !document.querySelector('.date-picker__panel');
  const refocusedTrigger = document.activeElement === trigger;

  return JSON.stringify({ before, afterRight, closedByEscape, refocusedTrigger });
})()`);
const kb = typeof keyboardResult === 'string' && keyboardResult.startsWith('{') ? JSON.parse(keyboardResult) : null;
check('the trigger is a real focusable, keyboard-openable control', kb !== null, String(keyboardResult));
check('ArrowRight moves roving focus to a different day cell', kb && kb.before !== kb.afterRight, String(keyboardResult));
check('Escape closes the panel and returns focus to the trigger', kb?.closedByEscape && kb?.refocusedTrigger, String(keyboardResult));

/* ── 3 · Mobile: the picker fits a phone, and still shows the chosen date ──── */

await viewport(390, 800);
await open(null, `/register#onboarding_token=${S.onboardingToken}`);
const overflow = await evaluate(
  'JSON.stringify({ doc: document.documentElement.scrollWidth, vw: window.innerWidth })',
);
const { doc, vw } = JSON.parse(overflow);
check('the registration form does not scroll sideways at 390px', doc <= vw + 1, `${doc} > ${vw}`);

await openNthPicker(0);
await evaluate("document.querySelector('.date-picker__panel')?.scrollIntoView()");
const panelOverflow = await evaluate(
  'JSON.stringify({ doc: document.documentElement.scrollWidth, vw: window.innerWidth })',
);
const opened390 = JSON.parse(panelOverflow);
check(
  'the OPEN calendar panel does not scroll the page sideways at 390px either',
  opened390.doc <= opened390.vw + 1,
  `${opened390.doc} > ${opened390.vw}`,
);
await viewport(1440);

/* ── 4 · AcademicPeriod (R122) — the create dialog's start-date field ─────── */

await open(S.adminCookie1, '/admin/academic-periods');
const openedPeriodDialog = await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('إضافة فصل'));
  if (!b) return 'no create button';
  b.click();
  return true;
})()`);
check('the AcademicPeriod create dialog opens', openedPeriodDialog === true, String(openedPeriodDialog));

const periodPicked = await evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return 'no open dialog';
  const trigger = dialog.querySelector('.date-picker__trigger');
  if (!trigger) return 'no date trigger in dialog';
  trigger.click();
  await wait(300);
  const grid = dialog.querySelector('.date-picker__grid');
  if (!grid) return 'no day grid opened';
  const enabled = [...grid.querySelectorAll('button:not(:disabled)')];
  if (enabled.length === 0) return 'every day was disabled';
  const label = enabled[0].getAttribute('aria-label');
  enabled[0].click();
  await wait(300);
  return JSON.stringify({ label, closed: !dialog.querySelector('.date-picker__panel') });
})()`);
const periodParsed = typeof periodPicked === 'string' && periodPicked.startsWith('{') ? JSON.parse(periodPicked) : null;
check('a real day in the AcademicPeriod start-date grid can be picked', periodParsed !== null, String(periodPicked));
check('picking it closes the panel inside the dialog', periodParsed?.closed === true, String(periodPicked));

const dialogAfterPick = await evaluate(
  "document.querySelector('dialog[open]')?.querySelector('.date-picker__trigger')?.textContent ?? ''",
);
check(
  'the trigger now shows a chosen date, not the empty placeholder any more',
  dialogAfterPick !== '' && dialogAfterPick !== 'يوم / شهر / سنة',
  dialogAfterPick,
);
await assertNoEnglishPlaceholder('academic-periods');

/* ── 5 · The online-assessment builder (R124) — the exam date field ───────── */

await open(S.adminCookie2, '/admin/assessments');
const openedAssessment = await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('اختبار جديد'));
  if (!b) return 'no create button';
  b.click();
  return true;
})()`);
check('the assessment builder’s create dialog opens', openedAssessment === true, String(openedAssessment));

const assessmentDatePicked = await evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return 'no open dialog';
  const trigger = dialog.querySelector('.date-picker__trigger');
  if (!trigger) return 'no date trigger — target defaults to level, which needs one';
  trigger.click();
  await wait(300);
  const grid = dialog.querySelector('.date-picker__grid');
  if (!grid) return 'no day grid opened';
  const today = grid.querySelector('button.is-today');
  const cell = today ?? grid.querySelector('button:not(:disabled)');
  if (!cell) return 'no pickable day';
  cell.click();
  await wait(300);
  return JSON.stringify({ closed: !dialog.querySelector('.date-picker__panel') });
})()`);
const assessmentParsed =
  typeof assessmentDatePicked === 'string' && assessmentDatePicked.startsWith('{')
    ? JSON.parse(assessmentDatePicked)
    : null;
check(
  'the exam date field opens and a real day can be picked',
  assessmentParsed !== null,
  String(assessmentDatePicked),
);
await assertNoEnglishPlaceholder('assessments');

/* ── 6 · الجدولة (R58) — a physical exam’s date field, reached the real way ── */

await open(S.adminCookie3, '/admin/schedules');
const openedSchedule = await evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const setSelect = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const add = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('إضافة عنصر'));
  if (!add) return 'no add button';
  add.click();
  await wait(700);

  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return 'no dialog opened';
  const typeSelect = [...dialog.querySelectorAll('select')]
    .find((s) => [...s.options].some((o) => /اختبار|امتحان/.test(o.textContent)));
  if (!typeSelect) return 'no type select';
  const examOption = [...typeSelect.options].find((o) => /اختبار|امتحان/.test(o.textContent));
  setSelect(typeSelect, examOption.value);
  await wait(700);
  return true;
})()`);
check('the scheduling «إضافة عنصر» dialog reaches the exam type', openedSchedule === true, String(openedSchedule));

const schedulePicked = await evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return 'no open dialog';
  const trigger = dialog.querySelector('.date-picker__trigger');
  if (!trigger) return 'no date trigger for the exam';
  trigger.click();
  await wait(300);
  const grid = dialog.querySelector('.date-picker__grid');
  if (!grid) return 'no day grid opened';
  const cell = grid.querySelector('button:not(:disabled)');
  if (!cell) return 'no pickable day';
  cell.click();
  await wait(300);
  return JSON.stringify({ closed: !dialog.querySelector('.date-picker__panel') });
})()`);
const scheduleParsed =
  typeof schedulePicked === 'string' && schedulePicked.startsWith('{') ? JSON.parse(schedulePicked) : null;
check(
  'the physical exam’s scheduling date field opens and a real day can be picked',
  scheduleParsed !== null,
  String(schedulePicked),
);
await assertNoEnglishPlaceholder('schedules');

await close();
finish();
