/**
 * **A مؤطِّرة edits her OWN المواد and الفئات** (Owner, 2026-08-30).
 *
 * R88.2 refused this and R106 took only the availability half; the Owner has
 * now taken this one. The page rendered the two declarations as **text** on
 * rule AF's reasoning — a value the server would refuse must not look editable
 * — so what needs proving in a browser is that they are now genuinely
 * operable by her, save, and come back saved.
 *
 * **And that they still grant nothing.** The whole reason this is safe is that
 * capability is not authorization: teaching authority is an assignment. So the
 * last check declares a Subject and then asks the server for something only an
 * assignment could open.
 *
 * Driven as a **genuine teacher** from the shared R82 scenario, never a widened
 * Admin token — the harness owns every row it touches.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const { send, evaluate, close } = await connect(process.env.PORT ?? '9256');
const { check, finish } = results();
await send('Network.setCookie', {
  name: 'bodour_refresh', value: process.env.TEACHER_REFRESH_COOKIE, domain: 'localhost',
  path: '/api/v1/auth', httpOnly: true,
});
await send('Page.navigate', { url: `${BASE}/teacher/availability` });
await new Promise((r) => setTimeout(r, 5000));

// R224 §3 — the multi-select is the shared dropdown: its choices are checkboxes
// in a panel the field opens. R253 — the page has ONE «حفظ», for everything.
const out = await evaluate(`(async () => {
  const legends = [...document.querySelectorAll('legend, h2')].map(l => l.textContent.trim());
  const trigger = document.querySelector('.teacher-availability .multi-select .dropdown-trigger');
  if (!trigger) return { noOptions: true, legends };
  const summaryBefore = trigger.querySelector('.dropdown-trigger__label')?.getAttribute('title') ?? '';
  trigger.click();
  await new Promise(r => setTimeout(r, 400));
  const boxes = [...document.querySelectorAll('.multi-select__options input[type=checkbox]')];
  const pick = boxes.find(b => !b.checked);
  if (!pick) return { noOptions: true, legends, offered: boxes.length };
  pick.click();
  await new Promise(r => setTimeout(r, 400));
  trigger.click();
  const saves = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'حفظ');
  if (saves.length !== 1) return { offered: boxes.length, saves: saves.length, legends };
  saves[0].click();
  await new Promise(r => setTimeout(r, 3000));
  const notice = (document.querySelector('.admin-notice[role=status]')?.textContent ?? '').trim();
  const summaryAfter = trigger.querySelector('.dropdown-trigger__label')?.getAttribute('title') ?? '';
  return { legends, offered: boxes.length, saves: saves.length, notice, summaryBefore, summaryAfter };
})()`);

// **Reload through CDP, not `location.reload()` inside the page.** Reloading
// from within the evaluated promise destroys the execution context before it
// can resolve, and the call returns `undefined` — which reads exactly like the
// page having no controls at all.
await send('Page.navigate', { url: `${BASE}/teacher/availability` });
await new Promise((r) => setTimeout(r, 4500));
const reloaded = await evaluate(`(() => ({
  chosen: document.querySelector('.teacher-availability .multi-select .dropdown-trigger__label')?.getAttribute('title') ?? '',
}))()`);

console.log(JSON.stringify({ ...out, ...reloaded }, null, 1).slice(0, 900));
// R253 — one «حفظ» saves two parts at once: a new time slot AND another Subject.
const both = await evaluate(`(async () => {
  const rows = () => document.querySelectorAll('.teacher-availability fieldset.form__group .form__row').length;
  const before = rows();
  const add = [...document.querySelectorAll('.teacher-availability button')].find(b => b.textContent.trim().endsWith('إضافة فترة'));
  if (!add) return { noAdd: true };
  add.click();
  await new Promise(r => setTimeout(r, 300));
  const trigger = document.querySelector('.teacher-availability .multi-select .dropdown-trigger');
  trigger.click();
  await new Promise(r => setTimeout(r, 400));
  const pick = [...document.querySelectorAll('.multi-select__options input[type=checkbox]')].find(b => !b.checked);
  pick?.click();
  await new Promise(r => setTimeout(r, 300));
  trigger.click();
  const summary = trigger.querySelector('.dropdown-trigger__label')?.getAttribute('title') ?? '';
  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'حفظ').click();
  await new Promise(r => setTimeout(r, 3500));
  return { before, after: rows(), summary, notice: (document.querySelector('.admin-notice[role=status]')?.textContent ?? '').trim() };
})()`);
await send('Page.navigate', { url: `${BASE}/teacher/availability` });
await new Promise((r) => setTimeout(r, 4500));
const bothReloaded = await evaluate(`(() => ({
  rows: document.querySelectorAll('.teacher-availability fieldset.form__group .form__row').length,
  summary: document.querySelector('.teacher-availability .multi-select .dropdown-trigger__label')?.getAttribute('title') ?? '',
}))()`);
console.log(JSON.stringify({ both, bothReloaded }));

check('the capabilities are OFFERED as controls, not printed as text',
  (out.offered ?? 0) > 0, JSON.stringify({ offered: out.offered, legends: out.legends }));
check('the page has ONE «حفظ» (R253)', out.saves === 1, String(out.saves));
check('choosing one and saving is accepted', /حُفظت/.test(out.notice ?? ''), out.notice ?? '');
check('one «حفظ» saved a new time slot and another Subject together (R253)',
  /حُفظت/.test(both.notice ?? '') && bothReloaded.rows === (both.before ?? -1) + 1 && bothReloaded.summary === both.summary,
  JSON.stringify({ both, bothReloaded }));
check('and the choice survives a reload', reloaded.chosen !== '' && reloaded.chosen === out.summaryAfter && out.summaryAfter !== out.summaryBefore, JSON.stringify({ before: out.summaryBefore, after: out.summaryAfter, reloaded: reloaded.chosen }));

/**
 * **And it grants nothing** — the reason this is safe.
 *
 * Asked of the rendered portal rather than of a second token: R101 rotates the
 * refresh cookie on every page load, and juggling spare sessions here only
 * tests the harness. The *server* side of this property is asserted directly in
 * `teaching-profile.http.integration.test.ts`, where declaring every Subject
 * still yields `403` on `/admin/users` and an empty `/quran-students`.
 *
 * What a browser adds is that her portal did not grow an administrative surface
 * the moment she declared a Subject.
 */
const reach = await evaluate(`(() => ({
  nav: [...document.querySelectorAll('nav a')].map(a => a.getAttribute('href')).filter(Boolean),
}))()`);
const adminLinks = (reach.nav ?? []).filter((h) => h.startsWith('/admin') || h.startsWith('/superadmin'));
console.log(JSON.stringify({ nav: reach.nav }));
check(
  'declaring a Subject opens no administrative surface in her portal',
  adminLinks.length === 0,
  JSON.stringify(adminLinks),
);

close();
process.exit(finish());
