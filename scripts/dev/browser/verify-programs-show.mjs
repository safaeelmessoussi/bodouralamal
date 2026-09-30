/**
 * «برامجنا التعليمية» — the full-screen show (SRS Revision 185 §5), walked
 * in a real browser: it opens on the Categories, choosing one zooms its card
 * and shows its first Level, a tap per Level reaches the graduation (confetti
 * over the whole screen, the attire, the words without «وتواصل الرحلة»), the
 * question comes by itself and stands large over a blurred background, a tap
 * returns to the Categories, and Escape closes the show and frees the page.
 *
 * Public: no session. `APP_BASE` (default http://localhost), `WIDTH` (1366 or
 * 390), `OUT` (a directory for captures, optional).
 */
import { writeFileSync } from 'node:fs';

import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const { send, evaluate, close } = await connect(process.env.PORT ?? '9235');
const r = results();
const width = Number(process.env.WIDTH ?? 1366);
const out = process.env.OUT;
await send("Emulation.setDeviceMetricsOverride", { width, height: width < 600 ? 844 : 800, deviceScaleFactor: 1, mobile: width < 600 });
await send("Page.navigate", { url: `${BASE}/#programs` });
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
async function until(expr, tries = 80) { for (let i = 0; i < tries; i += 1) { if (await evaluate(expr).catch(() => false)) return true; await wait(250); } return false; }
async function shot(name) { if (!out) return; const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/${name}-${width}.png`, Buffer.from(s.data, 'base64')); }
async function click(sel) { await evaluate(`document.querySelector('${sel}').scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })`); await wait(250); const b = JSON.parse(await evaluate(`JSON.stringify((() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`)); for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 }); }
await until(`document.querySelectorAll('.journey__card').length >= 2`);
await wait(600);
await click('.journey__show');
r.check("the show opens on the Categories", await until(`document.querySelector('.show--categories .show__category') !== null`));
r.check("the page behind cannot scroll", (await evaluate("document.body.style.overflow")) === 'hidden');
const cats = await evaluate(`[...document.querySelectorAll('.show__category .show__categoryTitle')].map((e) => e.textContent)`);
r.check("every Category on the road is a card", cats.length === (await evaluate("document.querySelectorAll('[data-journey-category]').length")), cats.join(' | '));
await shot('show-1-categories');
// choose المرأة
const idx = cats.findIndex((c) => c === 'فئة المرأة');
await click(`.show__grid li:nth-child(${idx + 1}) .show__category`);
r.check("choosing a Category zooms its card", await until(`document.querySelector('.show__category.is-zooming') !== null`, 8));
r.check("…then shows its first Level", await until(`document.querySelector('.show--level .show__card') !== null`));
await wait(500);
const first = await evaluate(`document.querySelector('.show__card .journey__cardTitle').textContent`);
r.check("the first Level card is وميض الأمل, with its dots", first === 'وميض الأمل' && (await evaluate("document.querySelectorAll('.show__dot').length")) === 7 && (await evaluate("document.querySelectorAll('.show__dot.is-current').length")) === 1);
await shot('show-2-level');
// tap through the rest of the Levels
let taps = 0;
while ((await evaluate("document.querySelector('.show--level') !== null")) && taps < 10) { await click('.show__screen--level'); await wait(450); taps += 1; }
r.check("a tap per Level walks to the graduation (7 taps)", taps === 7 && (await evaluate("document.querySelector('.show--graduation') !== null")), String(taps));
r.check("the graduation: confetti over the whole screen, the words without «وتواصل الرحلة», the attire", await evaluate(`(() => { const s = document.querySelector('.show__screen--graduation'); const c = s.querySelector('.show__confetti').getBoundingClientRect(); return s.querySelectorAll('.show__piece').length === 64 && c.width >= window.innerWidth - 2 && s.textContent.includes('تُتمّ المتعلّمة برنامج المرأة.') && !s.textContent.includes('وتواصل') && !!s.querySelector('.journey__attire img'); })()`));
await wait(800);
await shot('show-3-graduation');
r.check("the question comes by itself after the graduation", await until(`document.querySelector('.show--question .show__question') !== null`, 20));
await wait(900);
r.check("…large, over a blurred background", await evaluate(`(() => { const q = document.querySelector('.show__question'); const g = document.querySelector('.show__graduation'); return parseFloat(getComputedStyle(q).fontSize) > 36 && getComputedStyle(g).filter.includes('blur') && q.textContent === 'متى يحين دورُك؟'; })()`));
await shot('show-4-question');
await click('.show__next');
r.check("one more tap returns to the Categories", await until(`document.querySelector('.show--categories') !== null`, 8));
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
r.check("Escape closes the show and frees the page", await until(`document.querySelector('.show') === null && document.body.style.overflow === ''`, 8));
r.finish();
close();
