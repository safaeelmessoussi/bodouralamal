/**
 * «مواد المستوى» on the real page (Staging, 2026-09-23 — RATE_LIMITED, then
 * DUPLICATE).
 *
 * The page read `/admin/levels/{id}/subjects` once PER LEVEL and, since R172 §1,
 * `/admin/categories/{id}/subjects` once per Category — two dozen parallel
 * requests the edge rate limit refused; each refused read was shown as «no
 * subjects», and the editor's diff then re-sent every pair that already stood,
 * refused again as DUPLICATE. This proves the two halves of the fix where they
 * are visible: the page loads with a bounded number of API reads and every
 * Level's Subjects on it, and saving an editor that KEEPS an assigned Subject
 * and adds one succeeds (the standing pair is a 204 now, never a 409).
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const COOKIE = process.env.DEV_REFRESH_COOKIE;
if (!COOKIE) throw new Error('DEV_REFRESH_COOKIE is required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9233');
const { check, finish } = results();

await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth',
  httpOnly: true,
});
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(expr, tries = 120) {
  for (let i = 0; i < tries; i += 1) {
    if (await evaluate(expr).catch(() => false)) return true;
    await wait(250);
  }
  return false;
}

await send('Page.navigate', { url: `${BASE}/admin/level-subjects` });
await until(`document.querySelectorAll('table').length >= 2 && document.body.textContent.includes('مواد لكل مستويات الفئة')`);
await wait(800);

// 1 · every API read the page made, from the browser's own resource timing.
const reads = await evaluate(`(() => performance.getEntriesByType('resource')
  .map((e) => new URL(e.name).pathname)
  .filter((p) => p.startsWith('/api/v1/')))()`);
const perRow = reads.filter((p) => /\/admin\/(levels|categories)\/[^/]+\/subjects$/.test(p));
check('the page reads no Level or Category one by one', perRow.length === 0, JSON.stringify(perRow.slice(0, 5)));
check('and makes a bounded number of API reads on load', reads.length > 0 && reads.length <= 8, JSON.stringify(reads));

// 2 · the Levels table lists Subjects (the dev scenario assigns some).
const table = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('table')].pop().querySelectorAll('tbody tr');
  const withSubjects = [...rows].filter((r) => !r.textContent.includes('لا مواد مسندة'));
  return { rows: rows.length, withSubjects: withSubjects.length, first: withSubjects[0]?.textContent.slice(0, 120) ?? '' };
})()`);
check('Levels are listed with their Subjects, not «no subjects» from a refused read', table.rows > 0 && table.withSubjects > 0, JSON.stringify(table));

// 3 · edit a Level that already teaches something: keep it, add one, save.
const opened = await evaluate(`(() => {
  const rows = [...[...document.querySelectorAll('table')].pop().querySelectorAll('tbody tr')];
  const row = rows.find((r) => !r.textContent.includes('لا مواد مسندة'));
  if (!row) return false;
  const button = [...row.querySelectorAll('button')].find((b) => b.textContent.includes('تعديل'));
  if (!button) return false;
  button.click();
  return true;
})()`);
check('«تعديل المواد» opens for a Level that teaches something', opened === true);
await until(`document.querySelector('dialog[open] .multi-select') !== null`);
const before = await evaluate(`(() => [...document.querySelectorAll('dialog[open] .multi-select li[data-option-value] input')].map((i) => ({ v: i.closest('li').dataset.optionValue, on: i.checked })))()`);
if (before.length === 0) {
  await evaluate(`(() => { document.querySelector('dialog[open] .multi-select .dropdown-trigger')?.click(); })()`);
  await wait(400);
}
const options = await evaluate(`(() => [...document.querySelectorAll('dialog[open] .multi-select li[data-option-value] input')].map((i) => ({ v: i.closest('li').dataset.optionValue, on: i.checked })))()`);
const kept = options.filter((o) => o.on).length;
const toAdd = options.find((o) => !o.on);
check('the editor opens on the Level’s real Subjects (not empty)', kept > 0, JSON.stringify(options).slice(0, 200));
check('there is a Subject left to add', toAdd !== undefined);
if (toAdd) {
  await evaluate(`(() => { document.querySelector('dialog[open] .multi-select li[data-option-value="${toAdd.v}"] input').click(); })()`);
  await wait(200);
  await evaluate(`(() => { [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.trim() === 'حفظ')?.click(); })()`);
  const saved = await until(`document.querySelector('dialog[open]') === null && document.body.textContent.includes('حُفظت')`, 60);
  const failure = await evaluate(`(() => (document.querySelector('dialog[open] .feedback, dialog[open] [role="alert"]')?.textContent ?? ''))()`);
  check('saving with a kept Subject and a new one succeeds — no DUPLICATE for the pair that stood', saved === true, failure);
  // Put it back.
  await wait(500);
  await evaluate(`(() => {
    const rows = [...[...document.querySelectorAll('table')].pop().querySelectorAll('tbody tr')];
    const row = rows.find((r) => !r.textContent.includes('لا مواد مسندة'));
    [...row.querySelectorAll('button')].find((b) => b.textContent.includes('تعديل'))?.click();
  })()`);
  await until(`document.querySelector('dialog[open] .multi-select') !== null`);
  await evaluate(`(() => { document.querySelector('dialog[open] .multi-select .dropdown-trigger')?.click(); })()`);
  await wait(300);
  await evaluate(`(() => { document.querySelector('dialog[open] .multi-select li[data-option-value="${toAdd.v}"] input')?.click(); })()`);
  await wait(200);
  await evaluate(`(() => { [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.trim() === 'حفظ')?.click(); })()`);
  await until(`document.querySelector('dialog[open]') === null`, 60);
}

await close();
finish();
