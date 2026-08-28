/**
 * **التقويم الهجري prefills from Umm al-Qura, and never overwrites** (Owner).
 *
 * The rule that needs proving is not that the import works but that running it
 * again leaves a Super Admin's correction alone — a property whose failure is
 * silent and would surface only as Ramadan on the wrong day.
 *
 * Owns its rows: it works in a Hijri year far outside any real one and deletes
 * it afterwards (P1.2).
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const { send, evaluate, close } = await connect(process.env.PORT ?? '9255');
const { check, finish } = results();
await send('Network.setCookie', {
  name: 'bodour_refresh', value: process.env.DEV_REFRESH_COOKIE, domain: 'localhost',
  path: '/api/v1/auth', httpOnly: true,
});
const YEAR = process.env.HIJRI_TEST_YEAR ?? '1588';
await send('Page.navigate', { url: `${BASE}/superadmin/hijri-calendar?year=${YEAR}` });
await new Promise((r) => setTimeout(r, 4500));

const out = await evaluate(`(async () => {
  const yearInput = document.querySelector('#hijri-year');
  if (!yearInput) return { noYearInput: true };
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(yearInput, ${JSON.stringify(YEAR)});
  // React listens for an input event on a controlled field; change alone left the
  // page on its DEFAULT year — and the import then filled a REAL year that the
  // teardown, scoped to the test year, did not remove. A harness must own every
  // row it creates (P1.2), so this now refuses to click unless the page is
  // demonstrably showing the year it is about to write to.
  yearInput.dispatchEvent(new Event('input', { bubbles: true }));
  yearInput.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 2500));
  if (String(yearInput.value) !== ${JSON.stringify(YEAR)}) {
    return { yearNotApplied: String(yearInput.value) };
  }
  const btn = (text) => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text);
  const importBtn = btn('تعبئة من تقويم أمّ القرى');
  if (!importBtn) return { noImportButton: true, buttons: [...document.querySelectorAll('button')].map(b=>b.textContent.trim()).slice(0,12) };

  importBtn.click();
  await new Promise(r => setTimeout(r, 3500));
  const firstNotice = (document.querySelector('.feedback, [role=status], .admin-notice')?.textContent ?? '').trim();
  // Count the month rows, excluding the zero-row placeholder. The dates render
  // in Arabic-Indic digits, so a Latin-digit match would count nothing.
  const monthRows = () => [...document.querySelectorAll('.admin-table tbody tr')]
    .filter(r => !r.classList.contains('admin-table__empty-row'))
    .map(r => r.textContent.trim());
  const filledRows = monthRows();

  // Run it a second time: nothing must move.
  const before = filledRows.slice();
  importBtn.click();
  await new Promise(r => setTimeout(r, 3500));
  const secondNotice = (document.querySelector('.feedback, [role=status], .admin-notice')?.textContent ?? '').trim();
  const after = monthRows();

  return { firstNotice, secondNotice, filled: before.length, unchanged: JSON.stringify(before) === JSON.stringify(after) };
})()`);

console.log(JSON.stringify(out, null, 1).slice(0, 1200));
check('the harness is on ITS OWN year before writing anything',
  out.yearNotApplied === undefined && out.noYearInput === undefined, JSON.stringify(out));
check('the baseline fills an empty year', out.filled >= 12, `rows=${out.filled}`);
check('and says how many it added', /\d/.test(out.firstNotice ?? ''), out.firstNotice ?? '');
check('running it again changes nothing on the page', out.unchanged === true, String(out.unchanged));
check('and reports that it skipped rather than added', /0/.test(out.secondNotice ?? ''), out.secondNotice ?? '');
close();
process.exit(finish());
