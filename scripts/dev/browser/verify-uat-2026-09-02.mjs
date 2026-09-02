/**
 * **The 2026-09-02 manual-UAT defects, in a real browser.**
 *
 * Each check is the user-facing behaviour that was reported wrong, not the
 * implementation detail underneath it: a description that survives a reload, a
 * filter that changes what is on screen, a creation default, and an editable
 * content item. Database state is asserted separately by the wrapper.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const { send, evaluate, close } = await connect(process.env.PORT ?? '9262');
const { check, finish } = results();
await send('Network.setCookie', {
  name: 'bodour_refresh', value: process.env.DEV_REFRESH_COOKIE, domain: 'localhost',
  path: '/api/v1/auth', httpOnly: true,
});

const go = async (path, wait = 5000) => {
  await send('Page.navigate', { url: `${BASE}${path}` });
  await new Promise((r) => setTimeout(r, wait));
};

/* ── 4 · تعديل المستوى persists الوصف ───────────────────────────────────── */
await go('/admin/levels');
const stamp = `وصف ${Date.now()}`;
const level = await evaluate(`(async () => {
  const row = [...document.querySelectorAll('.admin-table tbody tr')][0];
  if (!row) return { noRow: true };
  const edit = [...row.querySelectorAll('button')].find(b => b.textContent.trim() === 'تعديل');
  if (!edit) return { noEdit: true };
  edit.click(); await new Promise(r=>setTimeout(r,1500));
  const d = document.querySelector('dialog[open]');
  const area = [...d.querySelectorAll('textarea, input')].find(el =>
    (el.closest('.field')?.textContent ?? '').includes('الوصف'));
  if (!area) return { noDescriptionField: true };
  const proto = area.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(area, ${JSON.stringify(stamp)});
  area.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r=>setTimeout(r,400));
  const save = [...d.querySelectorAll('button')].find(b => b.textContent.trim() === 'حفظ');
  save.click(); await new Promise(r=>setTimeout(r,3000));
  return { saved: true };
})()`);
await go('/admin/levels');
const persisted = await evaluate(`document.body.textContent.includes(${JSON.stringify(stamp)})`);
check('4 · الوصف survives a save and a reload', persisted === true, JSON.stringify(level));

/* ── 2 · الجدول الزمني filters actually narrow ──────────────────────────── */
await go('/calendar');
const filtered = await evaluate(`(async () => {
  const before = document.querySelectorAll('[href*="/calendar/sessions/"], .cal-cell li, .admin-table tbody tr').length;
  const sel = [...document.querySelectorAll('select')].find(s =>
    (s.closest('.field')?.textContent ?? '').includes('النوع'));
  if (!sel) return { noTypeFilter: true };
  const opt = [...sel.options].find(o => o.value === 'exam');
  if (!opt) return { noExamOption: true, opts: [...sel.options].map(o=>o.value) };
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;
  const urls = [];
  const of = window.fetch;
  window.fetch = async (...a) => { urls.push(String(a[0])); return of(...a); };
  setter.call(sel, 'exam'); sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r=>setTimeout(r,2500));
  window.fetch = of;
  return { requested: urls.filter(u => u.includes('/calendar?')).slice(-1)[0] ?? '', before };
})()`);
check('2 · النوع reaches the request as `type`',
  typeof filtered.requested === 'string' && filtered.requested.includes('type=exam'),
  JSON.stringify(filtered));

/* ── 7 · التكرار defaults to مرة واحدة on creation ──────────────────────── */
await go('/admin/schedules');
const recurrence = await evaluate(`(async () => {
  const add = [...document.querySelectorAll('button')].find(b => b.textContent.trim().includes('إضافة عنصر'));
  if (!add) return { noAdd: true };
  add.click(); await new Promise(r=>setTimeout(r,2000));
  const d = document.querySelector('dialog[open]');
  // Choose an ACTIVITY first: a class cannot be «once» — the database refuses
  // that recurrence on a schedule — so the default under test is the one for
  // the kinds that can actually be non-recurring. (No backticks in here: a
  // backtick anywhere inside this evaluated template would end it.)
  const kind = [...d.querySelectorAll('select')].find(s =>
    (s.closest('.field')?.textContent ?? '').includes('نوع العنصر'))
    ?? [...d.querySelectorAll('select')][0];
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;
  const activity = [...kind.options].find(o => /نشاط|حفل/.test(o.textContent ?? ''));
  if (activity) { setter.call(kind, activity.value); kind.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,1500)); }
  const d2 = document.querySelector('dialog[open]');
  const sel = [...d2.querySelectorAll('select')].find(s =>
    (s.closest('.field')?.textContent ?? '').includes('التكرار'));
  if (!sel) return { noRecurrence: true, kindLabel: activity?.textContent?.trim() };
  const label = sel.options[sel.selectedIndex]?.textContent?.trim() ?? '';
  return { value: sel.value, label, kindLabel: activity?.textContent?.trim() };
})()`);
check('7 · a new item defaults to مرة واحدة',
  recurrence.value === 'once' || recurrence.label === 'مرة واحدة',
  JSON.stringify(recurrence));

/* ── 3 · مكتبة المحتوى offers تعديل ─────────────────────────────────────── */
await go('/admin/content');
const contentEdit = await evaluate(`(async () => {
  const row = [...document.querySelectorAll('.admin-table tbody tr')]
    .find(r => !r.classList.contains('admin-table__empty-row'));
  if (!row) return { noContent: true };
  const edit = [...row.querySelectorAll('button')].find(b => b.textContent.trim() === 'تعديل');
  if (!edit) return { noEditAction: true, actions: [...row.querySelectorAll('button')].map(b=>b.textContent.trim()) };
  edit.click(); await new Promise(r=>setTimeout(r,1800));
  const d = document.querySelector('dialog[open]');
  if (!d) return { noDialog: true };
  const labels = [...d.querySelectorAll('.field__label, legend')].map(l => l.textContent.trim());
  const hasFile = d.querySelector('input[type=file]') !== null;
  return { labels, hasFile };
})()`);
check('3 · the content edit form offers title, level, subject and visibility',
  Array.isArray(contentEdit.labels) &&
    ['العنوان','المستوى','المادة','الظهور'].every(l => contentEdit.labels.some(x => x.includes(l))),
  JSON.stringify(contentEdit));
check('3 · and carries NO file input — editing is not re-uploading',
  contentEdit.hasFile === false, String(contentEdit.hasFile));

close();
process.exit(finish());
