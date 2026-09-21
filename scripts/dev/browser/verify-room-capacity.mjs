/**
 * **SRS Revision 169 §3 — a room's capacity is published, editable, and shown
 * where a class is scheduled.** Only a browser can show the three halves
 * together: the rooms dialog accepts a number and refuses a non-number BEFORE
 * the wire, the list says the capacity back, and a reload still has it. BR-23:
 * it informs and refuses nothing — so nothing here asserts a refusal by capacity.
 *
 * Works on a scenario-owned branch only (`[r168-roles] مقر تاركة`), which the
 * wrapper's `--clean` removes with its rooms.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.SCENARIO ?? '{}');
const SUPER = process.env.SUPER_REFRESH_COOKIE;
if (!SUPER || !S.branch) throw new Error('SCENARIO and SUPER_REFRESH_COOKIE are required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9269');
const { check, finish } = results();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (v) => JSON.stringify(v);
const waitFor = async (expression, tries = 80) => {
  for (let i = 0; i < tries; i += 1) {
    if (await evaluate(`(() => Boolean(${expression}))()`).catch(() => false)) return true;
    await sleep(250);
  }
  return false;
};
const setField = (label, value) => evaluate(`(() => {
  const field = [...document.querySelectorAll('dialog[open] .field')].find((f) => (f.querySelector('label')?.textContent ?? '').trim().startsWith(${q(label)}));
  const el = field?.querySelector('input');
  if (!el) return 'missing';
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, ${q(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);
const click = (text) => evaluate(`(() => {
  const b = [...document.querySelectorAll('dialog[open] button')].find((x) => (x.textContent ?? '').trim() === ${q(text)});
  if (!b) return 'missing';
  if (b.disabled) return 'disabled';
  b.click();
  return 'clicked';
})()`);

await send('Network.enable');
await send('Network.setCookie', { name: 'bodour_refresh', value: SUPER, domain: new URL(BASE).hostname, path: '/api/v1/auth', httpOnly: true });
await send('Page.navigate', { url: `${BASE}/admin/branches` });
const row = `[...document.querySelectorAll('.admin-table tbody tr')].find((tr) => tr.textContent.includes(${q(S.branch.name)}))`;
check('الفروع lists the scenario branch', await waitFor(row));
await evaluate(`[...(${row}).querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'القاعات')?.click()`);
check('its rooms dialog opens', await waitFor(`document.querySelector('dialog[open]') && document.querySelector('dialog[open]').innerText.includes('سعة القاعة')`));

await setField('إضافة قاعة', 'قاعة السعة');
await setField('سعة القاعة', '2.5');
await sleep(150);
check('a capacity that is not a whole number is refused in words, before the wire', (await click('إضافة قاعة')) === 'disabled' && (await evaluate(`document.querySelector('dialog[open]').innerText`)).includes('اكتبي عددًا صحيحًا موجبًا'));
await setField('سعة القاعة', '35');
await sleep(150);
check('a whole number is accepted', (await click('إضافة قاعة')) === 'clicked');
check('the list says it back', await waitFor(`[...document.querySelectorAll('dialog[open] .admin-list li')].some((li) => li.textContent.includes('قاعة السعة') && li.textContent.includes('السعة 35'))`));

await send('Page.navigate', { url: `${BASE}/admin/branches` });
await waitFor(row);
await evaluate(`[...(${row}).querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'القاعات')?.click()`);
check('…and it survives a reload', await waitFor(`[...document.querySelectorAll('dialog[open] .admin-list li')].some((li) => li.textContent.includes('السعة 35'))`));

await evaluate(`(() => { const li = [...document.querySelectorAll('dialog[open] .admin-list li')].find((x) => x.textContent.includes('قاعة السعة')); [...li.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'تعديل')?.click(); })()`);
await sleep(200);
check('editing hydrates the stored capacity', (await evaluate(`[...document.querySelectorAll('dialog[open] .field')].find((f) => (f.querySelector('label')?.textContent ?? '').includes('سعة القاعة'))?.querySelector('input')?.value`)) === '35');
await setField('سعة القاعة', '');
await sleep(150);
check('clearing it is «not stated», and saves', (await click('حفظ')) === 'clicked' && (await waitFor(`[...document.querySelectorAll('dialog[open] .admin-list li')].some((li) => li.textContent.includes('قاعة السعة') && !li.textContent.includes('السعة'.concat(' 35')))`)));

close();
process.exit(finish());
