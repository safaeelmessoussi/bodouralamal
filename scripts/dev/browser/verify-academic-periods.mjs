/**
 * **الفصول الدراسية — the screen that keeps R122 from being a locked door.**
 *
 * The seed creates **no** academic periods, and an enrolment now requires one.
 * That combination is only safe because a Super Admin can open a period; if
 * this screen does not work, approval refuses every applicant and there is
 * nothing an administrator can do about it. That is the failure this harness
 * exists to catch, and no unit test can see it — it is a claim about a rendered
 * page reaching a real API.
 *
 * Four properties, in the order a person meets them:
 *
 * 1. **Data-first (rule A)** — the table is populated before any year is
 *    chosen. A management screen that shows nothing until a filter is set is
 *    the defect rule A was written for.
 * 2. **Create works end to end** — the form posts and the row comes back.
 * 3. **جارٍ is read from the dates**, not from anything stored: the period this
 *    harness creates spans today, and the badge must say so.
 * 4. **The year is not editable (rule AF)** — on edit it is TEXT with a line
 *    saying what to do instead, never a select that looks editable.
 *
 * It owns its rows (P1.2): its own academic year in the far-future fixture
 * band, and the period it creates. The wrapper removes both.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const YEAR_LABEL = process.env.PERIOD_YEAR_LABEL ?? '2145-2146';
const { send, evaluate, close } = await connect(process.env.PORT ?? '9253');
const { check, finish } = results();

await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: process.env.DEV_REFRESH_COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth',
  httpOnly: true,
});
await send('Page.navigate', { url: `${BASE}/admin/academic-periods` });
await new Promise((r) => setTimeout(r, 4000));

const before = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.admin-table tbody tr')];
  const filter = document.querySelector('select');
  return {
    // Rule BD — an empty DataTable still renders its table and headers, so a
    // row count is NOT evidence of data here. What this checks is that the
    // table and its controls are on the page with no year chosen; check 2 then
    // shows a real row appearing while the filter is still unset, which is the
    // data-first property itself.
    hasTable: Boolean(document.querySelector('.admin-table')),
    rowCount: rows.length,
    // The filter must be present and must be sitting on "all years": the rule
    // is that filters narrow, never gate.
    filterValue: filter ? filter.value : null,
    addLabel: [...document.querySelectorAll('button')]
      .map((b) => b.textContent.trim())
      .find((t) => t.includes('إضافة فصل')) ?? null,
  };
})()`);

check(
  '1 · the table and its controls render with NO year chosen (rule A — a filter never gates)',
  before.hasTable === true && before.filterValue === '' && before.addLabel !== null,
  JSON.stringify(before),
);

const created = await evaluate(`(async () => {
  const setInput = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const setSelect = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const add = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('إضافة فصل'));
  if (!add) return { noAdd: true };
  add.click();
  await new Promise((r) => setTimeout(r, 800));
  const d = document.querySelector('dialog[open]');
  if (!d) return { noDialog: true };

  const year = d.querySelector('select');
  const option = [...year.options].find((o) => o.textContent.trim() === ${JSON.stringify(YEAR_LABEL)});
  if (!option) return { noYearOption: [...year.options].map((o) => o.textContent.trim()) };
  setSelect(year, option.value);

  const inputs = [...d.querySelectorAll('input')];
  const seq = inputs.find((i) => i.type !== 'date');
  const dates = inputs.filter((i) => i.type === 'date');
  if (!seq || dates.length < 2) return { fields: inputs.map((i) => i.type) };

  const y = new Date().getUTCFullYear();
  setInput(seq, '1');
  setInput(dates[0], (y - 1) + '-01-01');
  setInput(dates[1], (y + 1) + '-12-31');
  await new Promise((r) => setTimeout(r, 200));

  const save = [...d.querySelectorAll('button')].find((b) => /حفظ|إضافة|إنشاء/.test(b.textContent));
  if (!save || save.disabled) return { saveDisabled: true };
  save.click();
  await new Promise((r) => setTimeout(r, 2500));

  const row = [...document.querySelectorAll('.admin-table tbody tr')]
    .find((r) => r.textContent.includes(${JSON.stringify(YEAR_LABEL)}));
  return {
    dialogClosed: !document.querySelector('dialog[open]'),
    rowText: row ? row.textContent.replace(/\\s+/g, ' ').trim() : null,
  };
})()`);

check(
  '2 · إضافة فصل posts, and the new period appears WITHOUT the year filter being set',
  created.rowText !== null && created.rowText !== undefined,
  JSON.stringify(created),
);

check(
  '3 · جارٍ is read from the period’s own dates — a span containing today reads current',
  typeof created.rowText === 'string' && created.rowText.includes('جارٍ'),
  String(created.rowText),
);

const edit = await evaluate(`(async () => {
  const row = [...document.querySelectorAll('.admin-table tbody tr')]
    .find((r) => r.textContent.includes(${JSON.stringify(YEAR_LABEL)}));
  if (!row) return { noRow: true };
  const action = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'تعديل');
  if (!action) return { noEditAction: true };
  action.click();
  await new Promise((r) => setTimeout(r, 900));
  const d = document.querySelector('dialog[open]');
  if (!d) return { noDialog: true };
  return {
    // Rule AF: shown as text, and the line saying which action DOES change it.
    yearIsSelect: Boolean(d.querySelector('select')),
    showsYearAsText: d.textContent.includes(${JSON.stringify(YEAR_LABEL)}),
    explains: /لا تُعدَّل السنة/.test(d.textContent),
  };
})()`);

check(
  '4 · on edit the academic year is TEXT with the reason, never a select (rule AF)',
  edit.yearIsSelect === false && edit.showsYearAsText === true && edit.explains === true,
  JSON.stringify(edit),
);

await close();
process.exit(finish());
