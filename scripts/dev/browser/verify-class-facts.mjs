/**
 * **R277 — «حصص الجدول» names every detail of its class**, through the real
 * screen: as a Super Admin, the scenario's tafseer class → its occurrences.
 * Under the title, the class's facts: its Subject, branch, Level, day and
 * time and staff, each as a labelled tile. `SHOTS=<dir>` writes screenshots
 * at 1366 and 390 px.
 */
import { writeFileSync } from 'node:fs';

import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const PORT = process.env.PORT ?? '9257';
const SHOTS = process.env.SHOTS ?? '';
const S = JSON.parse(process.env.R98_SCENARIO ?? '{}');
const { check, finish } = results();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const page = await connect(PORT);
const size = (width) =>
  page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height: width < 600 ? 844 : 900,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
const waitFor = async (predicate, tries = 60) => {
  for (let i = 0; i < tries; i += 1) {
    if (await page.evaluate(`(() => Boolean(${predicate}))()`).catch(() => false)) return true;
    await wait(400);
  }
  return false;
};

await size(1366);
await page.send('Network.clearBrowserCookies');
await page.send('Network.setCookie', {
  name: 'bodour_refresh',
  value: process.env.ADMIN_COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth',
  httpOnly: true,
});
await page.send('Page.navigate', { url: `${BASE}/admin/schedules/${S.tafseerSchedule}/sessions` });
check('the class\'s facts appear under its title', await waitFor(`document.querySelector('.class-facts .details__item')`, 80));
const tiles = await page.evaluate(`[...document.querySelectorAll('.class-facts .details__item')].map((d) => [d.querySelector('dt').textContent.trim(), d.querySelector('dd').textContent.trim()])`);
const labels = tiles.map(([l]) => l);
for (const label of ['المادة', 'الفرع', 'المستوى', 'التوقيت', 'المؤطِّرات']) {
  check(`«${label}» is named`, labels.includes(label) && tiles.find(([l]) => l === label)[1] !== '', JSON.stringify(tiles));
}
check('the occurrences table follows', await waitFor(`document.querySelector('.class-facts ~ * .admin-table, .class-facts ~ .admin-table, .admin-table tbody tr')`, 30));
for (const width of [1366, 390]) {
  await size(width);
  await wait(700);
  check(`no page-wide horizontal scroll at ${width} px`,
    await page.evaluate(`document.documentElement.scrollWidth <= window.innerWidth + 1`),
    String(await page.evaluate(`document.documentElement.scrollWidth`)));
  if (SHOTS) {
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${SHOTS}/r277-class-facts-${width}.png`, Buffer.from(data, 'base64'));
  }
}

process.exit(finish());
