/**
 * **Look at it** — `design.mmd` §13.
 *
 * Renders the platform's key surfaces at a phone width and a laptop width
 * into PNGs, so a styling change is SEEN before it is shipped. Public pages
 * need nothing; the signed-in ones take `DEV_REFRESH_COOKIE` (issued by
 * `scripts/dev/issue-dev-session.sh`) and set it ONCE — the refresh token
 * rotates on first use, so re-setting the original on every navigation would
 * sign the browser out again.
 *
 *   node scripts/dev/browser/shoot-pages.mjs <cdp-port> <out-dir>
 */
import { connect } from './cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const [port, out] = process.argv.slice(2);
if (!port || !out) throw new Error('usage: shoot-pages.mjs <cdp-port> <out-dir>');
mkdirSync(out, { recursive: true });
const BASE = process.env.APP_BASE ?? 'http://localhost';
const { send, evaluate, close } = await connect(port);

const PHONE = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };
const LAPTOP = { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false };

/** [name, path, viewport, optional page-side action before the shot] */
const PUBLIC = [
  ['landing-phone', '/', PHONE],
  ['landing-laptop', '/', LAPTOP],
  ['menu-phone', '/', PHONE, "document.querySelector('.app-header__burger')?.click()"],
  ['login-phone', '/login', PHONE],
  ['calendar-phone', '/calendar', PHONE],
  ['calendar-laptop', '/calendar', LAPTOP],
  ['library-phone', '/resources', PHONE],
  ['register-phone', '/register', PHONE],
];
const SIGNED_IN = [
  ['admin-home-phone', '/admin', PHONE],
  ['circles-laptop', '/admin/teaching-groups', LAPTOP],
  ['circles-phone', '/admin/teaching-groups', PHONE],
  [
    'circles-dialog-phone',
    '/admin/teaching-groups',
    PHONE,
    "[...document.querySelectorAll('button')].find((b) => b.textContent.includes('إضافة حلقة'))?.click()",
  ],
  ['schedules-laptop', '/admin/schedules', LAPTOP],
];

async function shoot([name, path, viewport, action]) {
  await send('Emulation.setDeviceMetricsOverride', viewport);
  await send('Page.navigate', { url: `${BASE}${path}` });
  await new Promise((r) => setTimeout(r, +(process.env.WAIT ?? 4000)));
  if (action) {
    await evaluate(action);
    await new Promise((r) => setTimeout(r, 800));
  }
  // The page must never scroll sideways (design.mmd §6) — said beside the shot.
  const width = await evaluate('document.documentElement.scrollWidth');
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${out}/${name}.png`, Buffer.from(data, 'base64'));
  console.log(`${name}: ${viewport.width}px viewport, document ${width}px${width > viewport.width ? '  ← SCROLLS SIDEWAYS' : ''}`);
}

for (const spec of PUBLIC) await shoot(spec);
if (process.env.DEV_REFRESH_COOKIE) {
  await send('Network.setCookie', {
    name: 'bodour_refresh',
    value: process.env.DEV_REFRESH_COOKIE,
    domain: 'localhost',
    path: '/api/v1/auth',
    httpOnly: true,
  });
  for (const spec of SIGNED_IN) await shoot(spec);
} else {
  console.log('(no DEV_REFRESH_COOKIE — the signed-in surfaces were not rendered)');
}
close();
