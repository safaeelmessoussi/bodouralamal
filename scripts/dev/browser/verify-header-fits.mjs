/**
 * **R268 — the header fits, or folds.** Signed in as a Super Admin, at every
 * width from the 60rem breakpoint up to a wide monitor: the document never
 * scrolls sideways, exactly one navigation shows (the bar or the burger), and
 * the account menu is inside the screen. At the widest width the full bar shows,
 * so folding is not simply «always the burger»; at 1366 px (the Owner's laptop)
 * the navigation itself stays. `SHOTS=<dir>` keeps 1366 px.
 */
import { writeFileSync } from 'node:fs';

import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const PORT = process.env.PORT ?? '9254';
const SHOTS = process.env.SHOTS ?? '';
const { check, finish } = results();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const page = await connect(PORT);
const size = (width) =>
  page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
await size(1366);
await page.send('Network.setCookie', {
  name: 'bodour_refresh',
  value: process.env.ADMIN_COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth',
  httpOnly: true,
});
await page.send('Page.navigate', { url: `${BASE}/` });
for (let i = 0; i < 80; i += 1) {
  const ready = await page
    .evaluate(`(() => Boolean(document.querySelector('.app-header .notification-bell, .app-header [aria-haspopup]')))()`)
    .catch(() => false);
  if (ready) break;
  await wait(250);
}
await wait(1200);

const state = () =>
  page.evaluate(`(() => {
    const shown = (el) => el && getComputedStyle(el).display !== 'none';
    const bar = document.querySelector('.app-header__bar');
    const nav = document.querySelector('.app-header__nav');
    const burger = document.querySelector('.app-header__burger');
    const inside = [...document.querySelectorAll('.app-header__actions--desktop > *')]
      .filter(shown)
      .every((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
    return {
      doc: document.documentElement.scrollWidth,
      view: document.documentElement.clientWidth,
      nav: shown(nav),
      burger: shown(burger),
      fit: bar.classList.contains('is-crowded') ? 'crowded' : bar.classList.contains('is-compact') ? 'compact' : 'full',
      inside,
    };
  })()`);

const signedIn = await page.evaluate(`(() => Boolean(document.querySelector('.app-header__actions--desktop .btn')))()`);
check('signed in as a Super Admin (the account controls are there)', signedIn);

for (const width of [960, 1100, 1280, 1366, 1440, 1600, 1920]) {
  await size(width);
  await wait(600);
  const s = await state();
  check(
    `${width}px: no sideways scroll, one navigation, every control on screen`,
    s.doc <= s.view && s.nav !== s.burger && (!s.nav || s.inside),
    JSON.stringify(s),
  );
  if (width === 1366) {
    check('1366px (the Owner\'s laptop): the full navigation stays, not the burger', s.nav, JSON.stringify(s));
  }
  if (width === 1366 && SHOTS) {
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${SHOTS}/r268-header-1366.png`, Buffer.from(data, 'base64'));
  }
}
await size(1920);
await wait(600);
check('the full bar comes back where it fits (1920px)', (await state()).nav);

// …and folds again on the way down (the remembered widths, not a stale bar).
for (const width of [1366, 1100]) {
  await size(width);
  await wait(600);
  const s = await state();
  check(`back down to ${width}px: still fits`, s.doc <= s.view && s.nav !== s.burger && (!s.nav || s.inside), JSON.stringify(s));
}

process.exit(finish());
