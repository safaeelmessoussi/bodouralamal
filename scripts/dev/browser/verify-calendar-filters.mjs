/**
 * **One filter state, two views** — the defect of 2026-08-19 measured.
 *
 * The back office applied its filters to قائمة and not to تقويم: the list
 * queried with branch, subject, year and type while the grid called
 * `GET /calendar` with a date range and nothing else. Switching view silently
 * changed the dataset.
 *
 * What is checked is the property, not the plumbing: **choose a filter, switch
 * view, and the choice is still made** — in the controls, in the URL, and in the
 * request the second view sends. Source reading cannot show any of that.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const COOKIE = process.env.DEV_REFRESH_COOKIE;
if (!COOKIE) throw new Error('DEV_REFRESH_COOKIE is required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9236');
const { check, finish } = results();

await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth/refresh',
  httpOnly: true,
});
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
});
await send('Network.enable');

/** Every /calendar request the page makes, so the GRID's narrowing is observable. */
const calls = [];
send('Network.setCacheDisabled', { cacheDisabled: true });

async function goto(path, ready = 'main') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 120; i += 1) {
    const ok = await evaluate(
      `(() => document.querySelector(${JSON.stringify(ready)}) !== null)()`,
    ).catch(() => false);
    if (ok) {
      await new Promise((r) => setTimeout(r, 700));
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** The filter controls as a reader sees them: label → selected option text. */
const shown = () =>
  evaluate(`(() => {
    const out = {};
    for (const field of document.querySelectorAll('.field')) {
      const label = field.querySelector('label');
      const select = field.querySelector('select');
      if (label && select) out[label.textContent.trim()] = select.value;
    }
    return { fields: out, url: window.location.search };
  })()`);

/** Choose the first real option of the labelled select, and report what it was. */
const choose = (label) =>
  evaluate(`(async () => {
    const field = [...document.querySelectorAll('.field')].find((f) => {
      const l = f.querySelector('label');
      return l && l.textContent.includes(${JSON.stringify(label)});
    });
    if (!field) return { missing: true };
    const select = field.querySelector('select');
    const option = [...select.options].find((o) => o.value !== '');
    if (!option) return { noOptions: true };
    const setNative = (el, v) => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setNative(select, option.value);
    await new Promise((r) => setTimeout(r, 1200));
    return { value: option.value, label: option.textContent.trim() };
  })()`);

const switchTo = (label) =>
  evaluate(`(async () => {
    const tab = [...document.querySelectorAll('.cal-segmented button')].find(
      (b) => b.textContent.trim() === ${JSON.stringify(label)},
    );
    if (!tab) return { missing: true };
    tab.click();
    await new Promise((r) => setTimeout(r, 1400));
    return { view: new URLSearchParams(window.location.search).get('view') };
  })()`);

/* ── the back office ────────────────────────────────────────────────────── */

await goto('/admin/schedules?view=list', '.admin-table, .state, .cal-segmented');

const picked = await choose('الفرع');
check(
  `1 · admin قائمة — a branch can be chosen (${picked.label ?? 'none'})`,
  picked.value !== undefined,
  JSON.stringify(picked),
);

const afterPick = await shown();
check(
  '2 · and the choice is written to the URL, so it can be shared and survives',
  afterPick.url.includes('branch_id='),
  afterPick.url,
);

await switchTo('تقويم');
const inCalendar = await shown();
check(
  '3 · switching to تقويم KEEPS the branch — the defect this fixes',
  inCalendar.url.includes(`branch_id=${picked.value}`),
  inCalendar.url,
);

// The decisive one: the grid must actually ASK for the narrowed set. A control
// that still shows a value while the request ignores it is the same defect
// wearing the fix.
const gridRequest = await evaluate(`(() => window.__lastCalendarUrl ?? null)()`).catch(() => null);
const requested = await evaluate(`(async () => {
  const seen = [];
  const original = window.fetch;
  window.fetch = (...args) => {
    const url = typeof args[0] === 'string' ? args[0] : args[0].url;
    if (url.includes('/calendar?')) seen.push(url);
    return original(...args);
  };
  // Step a month and back: two requests the grid must make with the filter on.
  const next = [...document.querySelectorAll('.cal-segmented button')].find((b) =>
    b.textContent.trim() === 'التالي',
  );
  if (next) {
    next.click();
    await new Promise((r) => setTimeout(r, 1500));
  }
  window.fetch = original;
  return seen;
})()`);
check(
  '4 · the GRID asks the server for the narrowed set, not just the controls',
  Array.isArray(requested) && requested.some((u) => u.includes(`branch_id=${picked.value}`)),
  JSON.stringify(requested),
);

await switchTo('قائمة');
const backToList = await shown();
check(
  '5 · switching back to قائمة keeps it too — the switch is presentation only',
  backToList.url.includes(`branch_id=${picked.value}`),
  backToList.url,
);
check(
  '6 · and the control still SHOWS the choice, not merely the URL',
  Object.values(backToList.fields).includes(picked.value),
  JSON.stringify(backToList.fields),
);

/* ── the public calendar, same architecture ─────────────────────────────── */

await goto('/calendar', '.cal-header');
/* **«المستوى», not «الفئة»** — restated for R84's matrix, not weakened. The
   public surface offers المستوى and النوع; الفئة is a back-office and مؤطرة
   control, because a visitor narrows by *which level* rather than by the
   association's internal grouping. The property under test — that a public
   choice survives the switch through the same hook — is unchanged. */
const pub = await choose('المستوى');
check(
  `7 · public — a level can be chosen (${pub.label ?? 'none'})`,
  pub.value !== undefined,
  JSON.stringify(pub),
);
const pubUrl = await shown();
check(
  '8 · public — the choice reaches the URL through the SAME hook',
  pubUrl.url.includes('level_id='),
  pubUrl.url,
);
await switchTo('قائمة');
const pubList = await shown();
check(
  '9 · public — switching to قائمة keeps the level',
  pubList.url.includes(`level_id=${pub.value}`),
  pubList.url,
);
await switchTo('تقويم');
const pubBack = await shown();
check(
  '10 · public — and back again',
  pubBack.url.includes(`level_id=${pub.value}`),
  pubBack.url,
);

/* ── a deep link arrives already filtered ───────────────────────────────── */

await goto(`/calendar?level_id=${pub.value}&view=list`, '.cal-header');
const deep = await shown();
check(
  '11 · a filtered calendar is a link somebody can send',
  Object.values(deep.fields).includes(pub.value),
  JSON.stringify(deep),
);

close();
process.exit(finish());
