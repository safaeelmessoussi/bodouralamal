/**
 * «مقرر الحفظ» on the real page (Production, 2026-09-30 — RATE_LIMITED).
 *
 * The page read `/admin/levels/{id}/surahs` once PER LEVEL — thirty-odd
 * reads on load, of which TD-13's burst admitted twenty; the rest were `429`
 * and the page showed «حدث خطأ غير متوقع» for nothing the administrator did.
 * R183 §6 carries each Level's Surah ids on the Levels list and the names
 * come from the seeded 114. This proves it where it is visible: the page
 * loads with a bounded number of API reads, no per-Level read, and every
 * configured Level's Surahs on it (the dev scenario configures some).
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const COOKIE = process.env.DEV_REFRESH_COOKIE;
if (!COOKIE) throw new Error('DEV_REFRESH_COOKIE is required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9234');
const { check, finish } = results();

await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth',
  httpOnly: true,
});
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(expr, tries = 120) {
  for (let i = 0; i < tries; i += 1) {
    if (await evaluate(expr).catch(() => false)) return true;
    await wait(250);
  }
  return false;
}

await send('Page.navigate', { url: `${BASE}/admin/level-surahs` });
const ready = await until(`document.querySelector('table tbody tr') !== null`);
check('the page renders its table (no error state)', ready && !(await evaluate(`document.body.textContent.includes('حدث خطأ غير متوقع')`)));
await wait(800);

// 1 · every API read the page made, from the browser's own resource timing.
const reads = await evaluate(`(() => performance.getEntriesByType('resource')
  .map((e) => new URL(e.name).pathname)
  .filter((p) => p.startsWith('/api/v1/')))()`);
const perLevel = reads.filter((p) => /\/admin\/levels\/[^/]+\/surahs$/.test(p));
check('the page reads no Level one by one', perLevel.length === 0, JSON.stringify(perLevel.slice(0, 5)));
// The page's own reads are three (levels, the 114, categories); the shell's
// (clock, site-config, refresh, me, notifications) are not this page's to bound.
const own = reads.filter((p) => p.startsWith('/api/v1/admin/'));
check('and makes exactly three reads of its own on load', own.length === 3, JSON.stringify(own));
check('well inside TD-13\'s burst of twenty, shell included', reads.length <= 12, String(reads.length));
check('the seeded 114 are read once, for the names', reads.filter((p) => p === '/api/v1/admin/quran-surahs').length === 1);

// 2 · the table lists every Level, the configured ones with their Surahs.
const table = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('table tbody tr')];
  const configured = rows.filter((r) => !r.textContent.includes('لا مقرّر بعد'));
  return { rows: rows.length, configured: configured.length, first: configured[0]?.textContent.slice(0, 120) ?? '' };
})()`);
check('Levels are listed, the configured ones with their Surahs (never «none» from a refused read)', table.rows > 20 && table.configured > 0, JSON.stringify(table));

await close();
finish();
