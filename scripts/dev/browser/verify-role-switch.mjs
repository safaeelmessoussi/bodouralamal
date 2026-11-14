/**
 * **R273 — switching «الدور الحالي» opens that role's dashboard** (the Owner,
 * 2026-11-14: «should open the dashboard of the elected role, not the landing
 * page»). As a Super Admin who holds more than one role: from /admin, choose
 * each other role in the header's switcher and say where the page settles.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const PORT = process.env.PORT ?? '9257';
const { check, finish } = results();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const HOMES = { 'مشرفة عامة': '/admin', 'مسؤولة': '/admin', 'مؤطِّرة': '/teacher', 'مستفيدة': '/dashboard/student', 'مستفيد': '/dashboard/student', 'مستفيد(ة)': '/dashboard/student' };

const page = await connect(PORT);
await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await page.send('Network.setCookie', {
  name: 'bodour_refresh', value: process.env.ADMIN_COOKIE, domain: 'localhost', path: '/api/v1/auth', httpOnly: true,
});
const settle = async () => {
  let last = '';
  for (let i = 0; i < 30; i += 1) {
    await wait(400);
    const now = await page.evaluate('location.pathname').catch(() => '');
    if (now === last && now !== '' && (await page.evaluate(`document.readyState === 'complete' && !!document.querySelector('main')`).catch(() => false))) break;
    last = now;
  }
  await wait(1500);
  return page.evaluate('location.pathname');
};
await page.send('Page.navigate', { url: `${BASE}/admin` });
await settle();

const choose = (label) => page.evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const trigger of document.querySelectorAll('.app-header__actions--desktop .menu__trigger')) {
    trigger.click();
    await wait(300);
    const panel = trigger.closest('.menu').querySelector('.menu__panel');
    const group = panel?.querySelector('.menu__group-label');
    if (!group) { trigger.click(); await wait(150); continue; }
    const options = [...panel.querySelectorAll('.menu__option')].map((o) => o.textContent.trim());
    if (${JSON.stringify(label)} === '') return options;
    const option = [...panel.querySelectorAll('.menu__option')].find((o) => o.textContent.trim() === ${JSON.stringify(label)});
    option?.click();
    return options;
  }
  return null;
})()`);

const roles = await choose('');
check('the switcher offers more than one role', Array.isArray(roles) && roles.length > 1, JSON.stringify(roles));
for (const label of (roles ?? []).filter((r) => r in HOMES)) {
  await page.send('Page.navigate', { url: `${BASE}/admin` });
  await settle();
  await page.evaluate('document.body.click()');
  await choose(label);
  const landed = await settle();
  check(`«${label}» opens ${HOMES[label]}`, landed.startsWith(HOMES[label]), landed);
}
process.exit(finish());
