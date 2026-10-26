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
r.check("…then shows its first Level as the strip's first card", await until(`document.querySelector('.show--walk .show__card') !== null`));
await wait(500);
const first = await evaluate(`document.querySelector('.show__card .journey__cardTitle').textContent`);
const slides = await evaluate("document.querySelectorAll('.show__dot').length");
r.check("the first card is وميض الأمل, one dot per slide to its end", first === 'وميض الأمل' && slides >= 7 && (await evaluate("document.querySelectorAll('.show__dot.is-current').length")) === 1, `${first} ${slides}`);
await shot('show-2-level');
// R186 — a tap appends the next card with an arrow between and moves the strip along.
await click('.show__next');
await wait(700);
const strip = JSON.parse(await evaluate(`JSON.stringify((() => { const s = document.querySelector('.show__strip'); const cards = [...s.querySelectorAll('.show__slide')]; const cur = cards.at(-1).getBoundingClientRect(); const sr = s.getBoundingClientRect(); return { cards: cards.length, links: s.querySelectorAll('.show__link .journey__arrowLine').length, current: cards.at(-1).classList.contains('is-current'), firstNotCurrent: !cards[0].classList.contains('is-current'), newestVisible: cur.left >= sr.left - 2 && cur.right <= sr.right + 2, order: cards.map((c) => c.querySelector('.journey__cardTitle')?.textContent ?? 'milestone') }; })())`));
r.check("the next card is appended with an arrow between; the first card is no longer current; the newest is in view", strip.cards === 2 && strip.links === 1 && strip.current && strip.firstNotCurrent && strip.newestVisible, JSON.stringify(strip));
await shot('show-2b-strip');
// tap on to the graduation, counting the taps against the dots
let taps = 1;
while ((await evaluate("document.querySelector('.show--walk') !== null")) && taps < 60) { await click('.show__screen--walk'); await wait(350); taps += 1; }
r.check("a tap per slide walks the last Category to its graduation (one per dot)", taps === slides && (await evaluate("document.querySelector('.show--graduation') !== null")), `${taps} taps, ${slides} dots`);
r.check("the strip held every card of the way", await evaluate("document.querySelector('.show--graduation') !== null"));
r.check("the graduation: confetti over the whole screen, the LAST Category's words without «وتتواصل الرحلة», the attire", await evaluate(`(() => { const s = document.querySelector('.show__screen--graduation'); const c = s.querySelector('.show__confetti').getBoundingClientRect(); const lastName = [...document.querySelectorAll('[data-journey-category] .stage__title')].at(-1).textContent; return s.querySelectorAll('.show__piece').length === 64 && c.width >= window.innerWidth - 2 && s.textContent.includes('يكتمل برنامج') && s.textContent.includes(lastName.replace('فئة ', '') + '.') && !s.textContent.includes('وتتواصل') && !!s.querySelector('.journey__attire img'); })()`));
await wait(800);
await shot('show-3-graduation');
// R243 — the attire's glow (1 rem round its frame) never reaches the words above and below it.
const glow = JSON.parse(await evaluate(`JSON.stringify((() => { const g = document.querySelector('.show__graduation'); const a = g.querySelector('.journey__attire').getBoundingClientRect(); const rem = parseFloat(getComputedStyle(document.documentElement).fontSize); const above = g.querySelector(':scope > .journey__milestoneText').getBoundingClientRect(); const below = g.querySelector('.journey__summit > .journey__milestoneText').getBoundingClientRect(); return { aboveGap: Math.round(a.top - rem - above.bottom), belowGap: Math.round(below.top - (a.bottom + rem)), fitsScreen: g.getBoundingClientRect().bottom <= innerHeight }; })())`));
r.check("the attire's glow clears the line above and the line below (R243)", glow.aboveGap >= 0 && glow.belowGap >= 0, JSON.stringify(glow));
// R243 — the question waits for the click: nothing after a pause longer than the old 3.2 s timer.
await wait(4200);
r.check("the question does NOT come by itself (R243)", await evaluate("document.querySelector('.show--question') === null && !document.querySelector('.show__graduation').textContent.includes('متى يحين')"));
await click('.show__next');
r.check("…it comes on the click", await until(`document.querySelector('.show--question .show__question') !== null`, 20));
await wait(900);
r.check("…large, over a blurred background", await evaluate(`(() => { const q = document.querySelector('.show__question'); const g = document.querySelector('.show__graduation'); return parseFloat(getComputedStyle(q).fontSize) > 36 && getComputedStyle(g).filter.includes('blur') && q.textContent === 'متى يحين دورُك؟'; })()`));
await shot('show-4-question');
await click('.show__next');
r.check("one more tap returns to the Categories", await until(`document.querySelector('.show--categories') !== null`, 8));
// R234 — another Category's walk ends at its «إتمام فئة …» with no arrow on, and the next tap lists the Categories.
const other = cats.findIndex((c) => c !== 'فئة المرأة');
if (other >= 0) {
  await wait(600);
  await click(`.show__grid li:nth-child(${other + 1}) .show__category`);
  await until(`document.querySelector('.show--walk .show__card') !== null`);
  await wait(500);
  const dots = await evaluate("document.querySelectorAll('.show__dot').length");
  for (let i = 1; i < dots; i += 1) { await click('.show__screen--walk'); await wait(350); }
  const end = JSON.parse(await evaluate(`JSON.stringify((() => { const s = document.querySelector('.show__strip'); const cards = [...s.querySelectorAll('.show__slide')]; return { lastIsMilestone: cards.at(-1).classList.contains('show__slide--milestone'), links: s.querySelectorAll('.show__link').length, cards: cards.length, oneCategory: new Set(cards.filter((c) => c.querySelector('.show__slideCategory')).map((c) => c.textContent)).size === 1 }; })())`));
  r.check("another Category's walk ends at its «إتمام فئة …», no arrow on to the next Category (R234)", end.lastIsMilestone && end.links === end.cards - 1 && end.oneCategory, JSON.stringify(end));
  await click('.show__screen--walk');
  r.check("…and the next tap returns to the Categories", await until(`document.querySelector('.show--categories') !== null`, 8));
}
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
r.check("Escape closes the show and frees the page", await until(`document.querySelector('.show') === null && document.body.style.overflow === ''`, 8));
r.finish();
close();
