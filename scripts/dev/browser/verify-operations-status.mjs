/**
 * **SRS Revision 169 §11 on the real page** — «حالة النظام». The numbers and who
 * may read them are integration-tested; only a browser can show that the Super
 * Admin finds the screen in her menu, that it says what each number MEANS, and
 * that it says — in words — what it cannot see, so a page of zeros never reads
 * as «the backup is fine».
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const SUPER = process.env.SUPER_REFRESH_COOKIE;
if (!SUPER) throw new Error('SUPER_REFRESH_COOKIE is required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9271');
const { check, finish } = results();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (expression, tries = 80) => {
  for (let i = 0; i < tries; i += 1) {
    if (await evaluate(`(() => Boolean(${expression}))()`).catch(() => false)) return true;
    await sleep(250);
  }
  return false;
};

await send('Network.enable');
check(
  'an anonymous caller is refused the read',
  (await (await fetch(`${BASE}/api/v1/admin/operations/status`)).status) === 401,
);

await send('Network.setCookie', { name: 'bodour_refresh', value: SUPER, domain: new URL(BASE).hostname, path: '/api/v1/auth', httpOnly: true });
await send('Page.navigate', { url: `${BASE}/admin` });
check(
  'the Super Admin finds «حالة النظام» in her menu, last in الإدارة',
  await waitFor(`[...document.querySelectorAll('nav a')].some((a) => a.textContent.trim() === 'حالة النظام')`),
);

await send('Page.navigate', { url: `${BASE}/admin/operations` });
check('the screen loads its status', await waitFor(`document.querySelector('[data-operations-status]')`));
const page = await evaluate(`(() => {
  const root = document.querySelector('[data-operations-status]');
  return {
    text: root.innerText,
    counts: [...root.querySelectorAll('[data-count]')].map((li) => Number(li.getAttribute('data-count'))),
    attention: root.getAttribute('data-needs-attention'),
    hostSaid: root.querySelector('[data-host-not-visible]')?.textContent ?? '',
  };
})()`);
check('five counts are shown, every one a number', page.counts.length === 5 && page.counts.every((n) => Number.isInteger(n) && n >= 0), JSON.stringify(page.counts));
check(
  'each number says what it MEANS, not only what it is',
  page.text.includes('استنفدت محاولاتها') && page.text.includes('العامل الخلفي متوقف') && page.text.includes('ما زال في التخزين'),
);
check(
  'the headline agrees with the numbers',
  (page.attention === 'true') === (page.counts[0] > 0 || page.counts[1] > 0 || page.counts[3] > 0 || page.counts[4] > 0) &&
    page.text.includes(page.attention === 'true' ? 'يوجد ما يحتاج إلى متابعة' : 'لا شيء يحتاج إلى تدخّل الآن'),
  JSON.stringify({ attention: page.attention, counts: page.counts }),
);
check(
  'it SAYS what it cannot see — zeros never read as «the backup is fine»',
  page.hostSaid.includes('النسخ الاحتياطي') && page.hostSaid.includes('الأصفار أعلاه لا تقول شيئًا عنهما'),
  page.hostSaid.slice(0, 120),
);
check(
  'no payload, key or error text reaches the screen — queue names only',
  !/content\/[0-9a-f-]{36}|"data"|STORAGE_|Error:/.test(page.text),
);

close();
process.exit(finish());
