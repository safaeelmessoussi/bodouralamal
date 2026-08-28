/**
 * **حفظ on تسجيل مستفيدة actually saves.**
 *
 * The reported defect was not a failing request but **no request at all**: the
 * dialog resolved the enrolment's branch by looking the pre-chosen مستفيدة up
 * in a `beneficiaries_only` directory search, while the page builds its rows
 * from the union of that fact and the Student role (R79.7). When the two
 * disagreed the lookup found nothing, the branch was `''`, and that both
 * disabled حفظ and made `submit` return before its first statement.
 *
 * **Why this needs a browser.** A source guard can see that the branch is taken
 * from the row; only a real screen can show that the button is live and that
 * two requests leave — the enrolment and the circle membership. The Owner named
 * the exact case: a Level plus a حفظ القرآن circle.
 *
 * The harness **owns its rows** (P1.2): its own branch, a tagged مستفيدة with a
 * Student role in it, and the enrolment it creates. The wrapper removes all
 * three, in dependency order.
 */
import { connect, results } from './cdp.mjs';
const BASE = process.env.APP_BASE ?? 'http://localhost';
const { send, evaluate, close } = await connect(process.env.PORT ?? '9251');
const { check, finish } = results();
await send('Network.setCookie', {
  name: 'bodour_refresh', value: process.env.DEV_REFRESH_COOKIE, domain: 'localhost',
  path: '/api/v1/auth', httpOnly: true,
});
await send('Page.navigate', { url: `${BASE}/admin/enrollments` });
await new Promise((r) => setTimeout(r, 4000));

const out = await evaluate(`(async () => {
  const net = [];
  if (!window.__probe) { window.__probe = true;
    const of = window.fetch;
    window.fetch = async (...a) => { const r = await of(...a);
      let b=''; try { b = await r.clone().text(); } catch {}
      net.push({ u: String(a[0]).replace(/^.*\\/api\\/v1/,''), m: (a[1]&&a[1].method)||'GET', s: r.status, b: b.slice(0,200) }); return r; };
    window.__net = net;
  }
  const row = [...document.querySelectorAll('.admin-table tbody tr')].find((r) => r.textContent.includes('[eguard]'));
  const enrol = row ? [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'تسجيل') : null;
  if (!enrol) return { noRowAction: true };
  enrol.click();
  await new Promise((r) => setTimeout(r, 1500));
  const d = document.querySelector('dialog[open]');
  if (!d) return { noDialog: true };

  // Choose the first real Level.
  const lvl = d.querySelector('select');
  const setV = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  const opt = [...lvl.options].find((o) => o.value !== '');
  const levelLabel = opt ? opt.textContent.trim() : null;
  setV.call(lvl, opt.value); lvl.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 2000));

  // Tick the first circle checkbox, if the level offers one.
  const d2 = document.querySelector('dialog[open]');
  const opts = [...d2.querySelectorAll('.multi-select__options button')];
  const circleLabel = opts[0] ? opts[0].textContent.replace('＋','').trim() : null;
  if (opts[0]) { opts[0].click(); await new Promise((r) => setTimeout(r, 600)); }

  const openNet = window.__net.map((n) => n.m + ' ' + n.u + ' → ' + n.s + ' ' + n.b.slice(0,300));
  const d3 = document.querySelector('dialog[open]');
  const save = [...d3.querySelectorAll('button')].find((b) => b.textContent.trim() === 'حفظ');
  const disabled = save ? save.disabled : null;
  window.__net.length = 0;
  if (save) save.click();
  await new Promise((r) => setTimeout(r, 3000));
  const after = document.querySelector('dialog[open]');
  return {
    levelLabel, circleLabel, disabled, openNet,
    studentCtl: [...d3.querySelectorAll('select,input')].map((e)=>e.tagName+':'+(e.value||'').slice(0,40)),
    net: window.__net.map((n) => n.m + ' ' + n.u + ' → ' + n.s + (n.s >= 400 ? ' ' + n.b : '')),
    stillOpen: !!after,
    noticeShown: after ? (after.textContent.match(/تعذّر|خطأ|يرجى|مطلوب/) ?? [null])[0] : null,
  };
})()`);

console.log(JSON.stringify(out, null, 1));
check('حفظ is live once a Level is chosen', out.disabled === false, 'disabled=' + out.disabled);
check(
  'the enrolment is created',
  Array.isArray(out.net) && out.net.some((n) => n.startsWith('POST /admin/enrollments → 201')),
  JSON.stringify(out.net),
);
check(
  'and the chosen circle is joined in the same submit',
  Array.isArray(out.net) && out.net.some((n) => /POST \/admin\/teaching-groups\/.*\/members → 201/.test(n)),
  JSON.stringify(out.net),
);
check('the dialog closes on success', out.stillOpen === false, 'stillOpen=' + out.stillOpen);
close();
process.exit(finish());
