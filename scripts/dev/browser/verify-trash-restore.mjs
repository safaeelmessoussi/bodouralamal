/**
 * **SRS Revision 169 §8 on the real Trash screen** — a deleted Subject circle is
 * OFFERED «استعادة» (it used to read «غير متاح — يتبعه سجلات أخرى»), comes back,
 * leaves the Trash, and the screen SAYS what came back with it.
 *
 * The rules — which seats return, a schedule's conflict check, a Level's
 * activities — are integration-tested against PostgreSQL
 * (`trash-lifecycle.integration.test.ts`). Only a browser can show that the
 * button is there for the new types and that the count reaches her eyes.
 *
 * Works on the scenario's own spare circle; `--clean` removes it.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.SCENARIO ?? '{}');
const SUPER = process.env.SUPER_REFRESH_COOKIE;
if (!SUPER || !S.spareCircle) throw new Error('SCENARIO and SUPER_REFRESH_COOKIE are required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9270');
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

await send('Network.enable');
await send('Network.setCookie', { name: 'bodour_refresh', value: SUPER, domain: new URL(BASE).hostname, path: '/api/v1/auth', httpOnly: true });

// The circle is deleted through the REAL endpoint, as the screen would: the
// page's own session is used, so nothing here holds a token of its own.
await send('Page.navigate', { url: `${BASE}/admin/trash` });
await waitFor(`document.querySelector('.admin-table, .state')`);
const deleted = await evaluate(`(async () => {
  const refreshed = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' }, credentials: 'same-origin', body: '{}' });
  const token = (await refreshed.json()).access_token;
  const res = await fetch('/api/v1/admin/teaching-groups/${S.spareCircle.id}', { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
  return res.status;
})()`);
check('the circle is deleted through the real endpoint', deleted === 200 || deleted === 204, String(deleted));

await send('Page.navigate', { url: `${BASE}/admin/trash` });
const row = `[...document.querySelectorAll('.admin-table tbody tr')].find((tr) => tr.textContent.includes(${q(S.spareCircle.name)}))`;
check('it is listed in the Trash', await waitFor(row));
const state = await evaluate(`(() => { const tr = ${row}; return { text: tr.textContent, buttons: [...tr.querySelectorAll('button')].map((b) => b.textContent.trim()) }; })()`);
check(
  'a circle is OFFERED «استعادة» — no longer «غير متاح — يتبعه سجلات أخرى»',
  state.buttons.includes('استعادة') && !state.text.includes('يتبعه سجلات أخرى'),
  JSON.stringify(state),
);

await evaluate(`[...(${row}).querySelectorAll('button')].find((b) => b.textContent.trim() === 'استعادة').click()`);
check('it asks before restoring', await waitFor(`document.querySelector('dialog[open] .confirm')`));
await evaluate(`[...document.querySelectorAll('dialog[open] .confirm button')].find((b) => b.textContent.trim() === 'استعادة')?.click()`);
check(
  'the screen says it came back — and WHAT came back with it',
  await waitFor(`document.querySelector('main').innerText.includes('تمت استعادة السجل.') && document.querySelector('main').innerText.includes('مستفيدة إلى الحلقة')`),
  (await evaluate(`document.querySelector('main').innerText`)).slice(0, 300),
);
check('it has left the Trash', await waitFor(`!(${row})`));

close();
process.exit(finish());
