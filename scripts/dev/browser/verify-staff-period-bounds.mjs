/**
 * **A staffing period is measured against its schedule while it is typed.**
 *
 * The Owner's report: a class beginning 30 غشت 2026 with an assignment of
 * 29 غشت → 29 غشت. The server was right to refuse
 * (`STAFF_PERIOD_OUTSIDE_SCHEDULE`, §5) and the invariant is untouched; what
 * this pins is that the administrator is told **before** Save, on the fields
 * that are wrong.
 *
 * **The last check is the one that needs a browser.** Editing the SCHEDULE's
 * start date must re-mark a staffing row that nobody touched — a property no
 * source test can observe, because it is about what re-renders.
 *
 * Read-only: it opens the form, types into it, and never saves, so it owns no
 * rows and leaves none (P1.2).
 */
import { connect, results } from './cdp.mjs';
const BASE = process.env.APP_BASE ?? 'http://localhost';
const { send, evaluate, close } = await connect(process.env.PORT ?? '9252');
const { check, finish } = results();
await send('Network.setCookie', {
  name: 'bodour_refresh', value: process.env.DEV_REFRESH_COOKIE, domain: 'localhost',
  path: '/api/v1/auth', httpOnly: true,
});
await send('Page.navigate', { url: `${BASE}/admin/schedules` });
await new Promise((r) => setTimeout(r, 4500));

const out = await evaluate(`(async () => {
  const setV = (el, v) => {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const add = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().includes('إضافة عنصر'));
  if (!add) return { noAdd: true };
  add.click();
  await new Promise((r) => setTimeout(r, 1800));
  const d = document.querySelector('dialog[open]');
  if (!d) return { noDialog: true };

  const field = (label) => [...d.querySelectorAll('.field')].find((f) =>
    (f.querySelector('.field__label')?.textContent ?? '').trim().startsWith(label));

  // The schedule begins 30 غشت 2026 — the Owner's exact scenario.
  const startField = field('تاريخ البداية') ?? field('التاريخ');
  if (!startField) return { noStartField: true, labels: [...d.querySelectorAll('.field__label')].map((l) => l.textContent.trim()) };
  setV(startField.querySelector('input'), '2026-08-30');
  await new Promise((r) => setTimeout(r, 600));

  // Add a staffing row and give it 29 غشت → 29 غشت.
  const addStaff = [...d.querySelectorAll('button')].find((b) => b.textContent.trim().includes('إضافة مؤطّرة') || b.textContent.trim().includes('إضافة إسناد'));
  if (!addStaff) return { noAddStaff: true, buttons: [...d.querySelectorAll('button')].map((b) => b.textContent.trim()) };
  addStaff.click();
  await new Promise((r) => setTimeout(r, 800));

  const d2 = document.querySelector('dialog[open]');
  const froms = [...d2.querySelectorAll('.field')].filter((f) => (f.querySelector('.field__label')?.textContent ?? '').includes('من تاريخ'));
  const untils = [...d2.querySelectorAll('.field')].filter((f) => (f.querySelector('.field__label')?.textContent ?? '').includes('إلى تاريخ'));
  if (froms.length === 0) return { noPeriodFields: true, labels: [...d2.querySelectorAll('.field__label')].map((l) => l.textContent.trim()) };
  const fromInput = froms[froms.length - 1].querySelector('input');
  const untilInput = untils[untils.length - 1].querySelector('input');
  const bounds = { min: fromInput.getAttribute('min'), max: fromInput.getAttribute('max') };
  setV(fromInput, '2026-08-29');
  await new Promise((r) => setTimeout(r, 400));
  setV(untilInput, '2026-08-29');
  await new Promise((r) => setTimeout(r, 900));

  const d3 = document.querySelector('dialog[open]');
  const errors = [...d3.querySelectorAll('.field__error')].map((e) => e.textContent.trim());
  const invalidMarked = d3.querySelectorAll('input[aria-invalid="true"]').length;

  // Now move the SCHEDULE forward so the same untouched row becomes valid.
  setV(startField.querySelector('input'), '2026-08-01');
  await new Promise((r) => setTimeout(r, 900));
  const d4 = document.querySelector('dialog[open]');
  const afterScheduleMoved = [...d4.querySelectorAll('.field__error')].map((e) => e.textContent.trim());

  return { bounds, errors, invalidMarked, afterScheduleMoved };
})()`);

console.log(JSON.stringify(out, null, 1));
check('the period pickers are bounded by the schedule', out.bounds?.min === '2026-08-30', JSON.stringify(out.bounds));
check('29 غشت against a class starting 30 غشت is marked immediately',
  Array.isArray(out.errors) && out.errors.some((e) => e.includes('خارج فترة الحصة')), JSON.stringify(out.errors));
check('the wrong fields are marked invalid for a screen reader', out.invalidMarked >= 2, String(out.invalidMarked));
check('moving the SCHEDULE re-validates the untouched row',
  Array.isArray(out.afterScheduleMoved) && !out.afterScheduleMoved.some((e) => e.includes('خارج فترة الحصة')),
  JSON.stringify(out.afterScheduleMoved));
close();
process.exit(finish());
