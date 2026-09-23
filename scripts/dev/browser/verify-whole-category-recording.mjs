/**
 * «تسجيل صوتي» for a whole Category, on the real screens (SRS Revision 172
 * §1/§11; the Owner, 2026-09-23: «I still can't register a recording for a
 * category, and I still have to select a level to be able to select a subject»).
 *
 * The recorder in «مكتبة المحتوى» asks for the Category first and offers
 * «{الفئة} — كل مستويات الفئة» IN the Level list, always. Chosen, the Subject
 * control is enabled: with nothing assigned to the Category whole it says so
 * and names «مواد المستوى»; once a Subject is assigned there (through the real
 * dialog, in the same session) the recorder offers it and the save is no
 * longer blocked. Both halves are proved here in one run, because the first
 * build offered the choice only after the assignment and then dropped it the
 * moment it was made — two defects no unit test saw.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const COOKIE = process.env.DEV_REFRESH_COOKIE;
if (!COOKIE) throw new Error('DEV_REFRESH_COOKIE is required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9233');
const { check, finish } = results();
await send('Network.setCookie', { name: 'bodour_refresh', value: COOKIE, domain: 'localhost', path: '/api/v1/auth', httpOnly: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(expr, tries = 120) {
  for (let i = 0; i < tries; i += 1) {
    if (await evaluate(expr).catch(() => false)) return true;
    await wait(250);
  }
  return false;
}
const pickIn = (scopeSel, labelText, choose) => `(async () => {
  const root = document.querySelector(${JSON.stringify(scopeSel)});
  const sel = [...root.querySelectorAll('select')].find((s) => (s.closest('.field')?.textContent ?? '').includes(${JSON.stringify(labelText)}));
  if (!sel) return { missing: true };
  const opt = [...sel.options].find(${choose});
  if (!opt) return { noOption: true, options: [...sel.options].map((o) => o.textContent.trim()).slice(0, 8) };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(sel, opt.value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 900));
  return { chosen: opt.textContent.trim(), value: sel.value, disabled: sel.disabled };
})()`;

// 1 · the recorder: Category first, then «كل مستويات الفئة» in the Level list.
await send('Page.navigate', { url: `${BASE}/admin/content` });
await until(`document.querySelector('.admin-table, .state') !== null`);
await evaluate(`(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'تسجيل صوتي')?.click(); })()`);
await until(`document.querySelector('dialog[open] select') !== null`);
const category = await evaluate(pickIn('dialog[open]', 'الفئة', `(o) => o.value !== '' && o.textContent.includes('[dev-scenario]')`));
check('the recorder asks for the Category first', category.chosen !== undefined, JSON.stringify(category));
const whole = await evaluate(pickIn('dialog[open]', 'المستوى', `(o) => o.textContent.includes('كل مستويات الفئة')`));
check('«كل مستويات الفئة» is in the Level list for the chosen Category — and STAYS chosen', whole.chosen !== undefined && whole.value.startsWith('category:'), JSON.stringify(whole));
const subjectState = await evaluate(`(() => {
  const dialog = document.querySelector('dialog[open]');
  const sel = [...dialog.querySelectorAll('select')].find((s) => (s.closest('.field')?.textContent ?? '').includes('المادة'));
  return { disabled: sel?.disabled ?? null, options: [...(sel?.options ?? [])].map((o) => o.textContent.trim()), hint: dialog.textContent.includes('مواد لكل مستويات الفئة') };
})()`);
check('with nothing assigned to the Category whole, the recorder says so and names «مواد المستوى»', subjectState.hint === true, JSON.stringify(subjectState).slice(0, 300));
const categoryLabel = category.chosen;

// 2 · assign a Subject to that Category whole, through the real dialog.
await send('Page.navigate', { url: `${BASE}/admin/level-subjects` });
await until(`document.querySelectorAll('table').length >= 2`);
await wait(500);
const opened = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('table')[0].querySelectorAll('tbody tr')];
  const row = rows.find((r) => r.textContent.includes(${JSON.stringify(categoryLabel)}));
  if (!row) return false;
  [...row.querySelectorAll('button')].find((b) => b.textContent.includes('تعديل'))?.click();
  return true;
})()`);
check('«مواد لكل مستويات الفئة» opens the Category’s dialog', opened === true, categoryLabel);
await until(`document.querySelector('dialog[open] .multi-select') !== null`);
await evaluate(`(() => { document.querySelector('dialog[open] .multi-select .dropdown-trigger')?.click(); })()`);
await wait(400);
const assigned = await evaluate(`(() => {
  const li = [...document.querySelectorAll('dialog[open] .multi-select li[data-option-value]')].find((l) => l.textContent.includes('[dev-scenario]'));
  if (!li) return null;
  li.querySelector('input').click();
  return li.textContent.trim();
})()`);
await wait(200);
await evaluate(`(() => { [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.trim() === 'حفظ')?.click(); })()`);
const saved = await until(`document.querySelector('dialog[open]') === null && document.body.textContent.includes('حُفظت')`, 60);
check('a Subject is assigned to the whole Category and saved', saved === true && assigned !== null, String(assigned));

// 3 · back in the recorder: the Subject is offered, chosen, and the save is not blocked.
await send('Page.navigate', { url: `${BASE}/admin/content` });
await until(`document.querySelector('.admin-table, .state') !== null`);
await evaluate(`(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'تسجيل صوتي')?.click(); })()`);
await until(`document.querySelector('dialog[open] select') !== null`);
await evaluate(pickIn('dialog[open]', 'الفئة', `(o) => o.textContent.trim() === ${JSON.stringify(categoryLabel)}`));
await evaluate(pickIn('dialog[open]', 'المستوى', `(o) => o.textContent.includes('كل مستويات الفئة')`));
const subject = await evaluate(pickIn('dialog[open]', 'المادة', `(o) => o.value !== ''`));
check('the whole-Category Subject is offered and chosen with NO Level', subject.chosen !== undefined && subject.disabled === false, JSON.stringify(subject));
const blocked = await evaluate(`(() => {
  const dialog = document.querySelector('dialog[open]');
  return { chooseScope: dialog.textContent.includes('اختاري المستوى والمادة'), hint: dialog.textContent.includes('مواد لكل مستويات الفئة'), start: [...dialog.querySelectorAll('button')].some((b) => b.textContent.trim() === 'بدء التسجيل') };
})()`);
check('the recorder is ready for a whole-Category recording (no scope problem shown)', blocked.hint === false && blocked.start === true, JSON.stringify(blocked));

// Put the curriculum back.
await send('Page.navigate', { url: `${BASE}/admin/level-subjects` });
await until(`document.querySelectorAll('table').length >= 2`);
await wait(500);
await evaluate(`(() => {
  const rows = [...document.querySelectorAll('table')[0].querySelectorAll('tbody tr')];
  const row = rows.find((r) => r.textContent.includes(${JSON.stringify(categoryLabel)}));
  [...row.querySelectorAll('button')].find((b) => b.textContent.includes('تعديل'))?.click();
})()`);
await until(`document.querySelector('dialog[open] .multi-select') !== null`);
await evaluate(`(() => { document.querySelector('dialog[open] .multi-select .dropdown-trigger')?.click(); })()`);
await wait(300);
await evaluate(`(() => { [...document.querySelectorAll('dialog[open] .multi-select li[data-option-value] input')].filter((i) => i.checked).forEach((i) => i.click()); })()`);
await wait(200);
await evaluate(`(() => { [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.trim() === 'حفظ')?.click(); })()`);
await until(`document.querySelector('dialog[open]') === null`, 60);

await close();
finish();
