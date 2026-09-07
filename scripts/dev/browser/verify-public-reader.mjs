/** Invoked only by the disposable content integration fixture. Fresh Chrome,
 * real built SPA/API/Nginx/MinIO; never reads .env or changes business data. */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, results } from './cdp.mjs';

if (!process.env.BODOUR_INTEGRATION_API_IMAGE?.startsWith('bodour-integration-api:bodour-ci-integration-')) throw new Error('disposable stack required');
const base = process.env.PUBLIC_BASE_URL;
const fixture = JSON.parse(process.env.READER_FIXTURE);
const work = await mkdtemp(join(tmpdir(), 'bodour-public-reader-'));
const browserBin = process.env.BODOUR_BROWSER_BIN;
if (!browserBin) throw new Error('BODOUR_BROWSER_BIN is required');
const chrome = spawn(browserBin, ['--headless=new', '--disable-gpu', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0', "--remote-allow-origins=*", `--user-data-dir=${work}`, 'about:blank'], { stdio: 'ignore' });
const { check, finish } = results();
let browser;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  let port;
  for (let n = 0; n < 60 && !port; n++) {
    port = await readFile(join(work, 'DevToolsActivePort'), 'utf8').then((s) => s.split('\n')[0]).catch(() => null);
    if (!port) await pause(250);
  }
  if (!port) throw new Error('Chrome did not start within 15 seconds');
  browser = await connect(port);
  const { send, evaluate } = browser;
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__readerErrors = [];
    window.__readerCalls = [];
    window.addEventListener('error', (e) => { if (e.message) window.__readerErrors.push(e.message); });
    window.addEventListener('unhandledrejection', (e) => window.__readerErrors.push(String(e.reason)));
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const response = await originalFetch(input, init);
      const headers = new Headers(init.headers || {});
      const call = {
        url: typeof input === 'string' ? input : input.url,
        status: response.status,
        authorized: headers.has('authorization'),
      };
      if (call.url.includes('/download-url') && response.ok) {
        call.resultUrl = await response.clone().json().then((body) => body.url).catch(() => null);
      }
      window.__readerCalls.push(call);
      return response;
    };
  ` });
  async function waitFor(expression) {
    for (let n = 0; n < 60; n++) {
      if (await evaluate(expression).catch(() => false)) return true;
      await pause(150);
    }
    return false;
  }
  async function open(path, ready = 'main') {
    await send('Page.navigate', { url: `${base}${path}` });
    if (!await waitFor(`document.readyState === 'complete' && !!document.querySelector(${JSON.stringify(ready)})`)) throw new Error(`page not ready: ${path}`);
  }
  async function width(value) {
    await send('Emulation.setDeviceMetricsOverride', { width: value, height: 900, deviceScaleFactor: 1, mobile: false });
  }
  const overflow = () => evaluate('document.documentElement.scrollWidth <= innerWidth + 1');
  const agendaDatesDoNotCollide = () => evaluate(`[...document.querySelectorAll('.occurrence-list__when')].every(row => {
    const boxes = [...row.children].map(child => child.getBoundingClientRect());
    return boxes.every((a, i) => boxes.slice(i + 1).every(b => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top));
  })`);
  const dialogFits = () => evaluate(`(() => {
    const d = document.querySelector('dialog[open]'); if (!d) return false;
    const r = d.getBoundingClientRect(), b = d.querySelector('.dialog__close').getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 && b.width >= 32 && b.left >= r.left && b.right <= r.right;
  })()`);
  const shelf = (id) => `/resources?level=${fixture.levelId}&content=${id}`;
  await send('Network.clearBrowserCookies');
  await width(390);
  await open('/resources');
  check('fresh anonymous public library has real fixture level', await waitFor(`!!document.querySelector('a[href*="${fixture.levelId}"]')`));
  for (const [kind, id] of Object.entries(fixture.items)) {
    await open(shelf(id));
    check(`${kind}: preview opens anonymously`, await waitFor("!!document.querySelector('dialog[open] .preview__actions button')"));
    check(`${kind}: anonymous application mint succeeds`, await evaluate(`window.__readerCalls.some(c => c.url.includes('/content/${id}/download-url') && c.status === 200 && !c.authorized)`));
    const media = kind === 'image' ? 'img.preview__image' : kind === 'pdf' ? 'iframe.preview__pdf' : kind;
    check(`${kind}: underlying file through real edge`, await evaluate(`(async () => {
      const e = document.querySelector(${JSON.stringify(media)});
      const call = [...window.__readerCalls].reverse().find(c => c.url.includes('/content/${id}/download-url'));
      const url = e ? (e.src || e.querySelector('source')?.src) : call?.resultUrl;
      if (!url) return false;
      const res = await fetch(url);
      const data = new Uint8Array(await res.arrayBuffer());
      return res.status === 200 && data.length > 100 && res.headers.get('content-type')?.includes(${JSON.stringify(kind === 'pdf' ? 'application/pdf' : kind === 'document' ? 'application/msword' : kind + '/')});
    })()`));
    if (kind === 'document') check('document: download-only state is explicit', await evaluate("!!document.querySelector('.preview__stage .preview__placeholder') && !document.querySelector('.preview__stage iframe, .preview__stage img, .preview__stage audio, .preview__stage video')"));
    if (kind === 'image') check('image decodes', await waitFor("document.querySelector('.preview__image')?.naturalWidth > 0"));
    if (kind === 'audio' || kind === 'video') {
      check(`${kind}: actual playback advances`, await evaluate(`(async () => { const e = document.querySelector('${kind}'); e.muted = true; await e.play(); await new Promise(r => setTimeout(r, 400)); return !e.error && e.currentTime > 0; })()`));
    }
    check(`${kind}: phone dialog fits`, await dialogFits());
    check(`${kind}: no runtime errors`, await evaluate('window.__readerErrors.length === 0'));
  }
  await open(shelf(fixture.items.image));
  check('public content does not expose a hidden Session', await waitFor(`document.querySelectorAll('.preview__sessions a').length === 1`) && await evaluate(`!document.querySelector('a[href*="${fixture.privateSessionId}"]')`));
  await evaluate("document.querySelector('.preview__sessions a').click()");
  check('content link opens canonical occurrence dialog', await waitFor(`location.pathname === '/calendar' && !!document.querySelector('dialog[open] .details')`));
  await send('Page.reload');
  check('calendar link survives refresh', await waitFor("!!document.querySelector('dialog[open] .details')"));
  check('canonical dialog includes subject, staff, audience and materials', await waitFor("!!document.querySelector('dialog[open] .details__list a')") && await evaluate(`(() => {
    const text = document.querySelector('dialog[open]')?.textContent ?? '';
    return [${JSON.stringify(fixture.expected.subject)}, ${JSON.stringify(fixture.expected.audience)}, ${JSON.stringify(fixture.expected.instructor)}].every(value => text.includes(value));
  })()`));
  check('materials link includes level and content', await evaluate(`document.querySelector('dialog[open] .details__list a')?.getAttribute('href') === ${JSON.stringify(shelf(fixture.items.image))}`));
  for (const w of [320, 360, 375, 390, 412, 430, 768, 1280]) {
    await width(w);
    check(`${w}: canonical dialog is open`, await waitFor("!!document.querySelector('dialog[open] .details')"));
    check(`${w}: complete dialog fits`, await dialogFits());
    check(`${w}: calendar no document overflow`, await overflow());
    check(`${w}: intentional agenda/grid presentation`, await evaluate(`(() => { const g = document.querySelector('.cal-grid'), a = document.querySelector('.cal-agenda'); return ${w < 768} ? getComputedStyle(g).display === 'none' && getComputedStyle(a).display !== 'none' : getComputedStyle(g).display !== 'none'; })()`));
    if (w < 768) check(`${w}: Gregorian, Hijri and time labels do not collide`, await agendaDatesDoNotCollide());
  }
  check('calendar has no runtime errors', await evaluate('window.__readerErrors.length === 0'));
  await width(320);
  await evaluate("document.querySelector('dialog[open] .dialog__close')?.click()");
  check('canonical dialog closes', await waitFor("!document.querySelector('dialog[open]')"));
  check('phone filter toggle is visible', await evaluate("getComputedStyle(document.querySelector('.cal-filter-toggle')).display !== 'none'"));
  await evaluate("document.querySelector('.cal-filter-toggle').click()");
  check('phone filters expand and remain within the document', await waitFor("getComputedStyle(document.querySelector('.cal-header__filters')).display !== 'none'") && await overflow());
  await evaluate("document.querySelector('.cal-filter-toggle').click()");
  const occurrenceSelector = '.cal-agenda .occurrence-list__title button';
  const occurrenceReady = await waitFor(`!!document.querySelector(${JSON.stringify(occurrenceSelector)})`);
  check('calendar occurrence control is available', occurrenceReady);
  if (occurrenceReady) await evaluate(`document.querySelector(${JSON.stringify(occurrenceSelector)}).click()`);
  check('clicking a calendar occurrence opens the canonical dialog', occurrenceReady && await waitFor("!!document.querySelector('dialog[open] .details')"));
  for (const id of [fixture.privateSessionId, '00000000-0000-4000-8000-000000000000']) {
    await open(`/calendar?occurrence=session:${id}&date=${fixture.date}`);
    check('hidden/missing occurrence is safely unavailable', await waitFor("document.querySelector('dialog[open]')?.textContent.includes('هذا الموعد غير متاح')"));
  }
  await open(`/calendar/sessions/${fixture.sessionId}`);
  check('old detail route no longer renders a Session page', !await evaluate("!!document.querySelector('.details')") && await evaluate("document.body.textContent.includes('غير موجودة')"));
  await open('/resources');
  check('private content denied anonymously', await evaluate(`fetch('/api/v1/content/${fixture.restrictedId}/download-url').then(r => r.status === 404)`));
  for (const [role, cookie] of Object.entries(fixture.cookies)) {
    await send('Network.clearBrowserCookies');
    await send('Network.setCookie', { name: 'bodour_refresh', value: cookie, url: base, path: '/api/v1/auth', httpOnly: true });
    await open(shelf(fixture.restrictedId));
    check(
      `${role}: authenticated library request completed`,
      await waitFor("window.__readerCalls.some(c => c.url.includes('/api/v1/library?') && c.status === 200 && c.authorized)"),
    );
    const authorized = role !== 'student';
    check(
      `${role}: application session applies private authorization`,
      authorized
        ? await waitFor("!!document.querySelector('dialog[open] .preview__actions button')")
        : await evaluate("!document.querySelector('dialog[open]')"),
    );
    if (authorized) {
      check(`${role}: private mint used authenticated authority`, await evaluate(`window.__readerCalls.some(c => c.url.includes('/content/${fixture.restrictedId}/download-url') && c.status === 200 && c.authorized)`));
      check(`${role}: authorized private bytes pass the edge`, await evaluate(`(async () => {
        const source = document.querySelector('dialog[open] iframe, dialog[open] img, dialog[open] audio source, dialog[open] video source');
        const url = source?.src; if (!url) return false;
        const res = await fetch(url); return res.status === 200 && (await res.arrayBuffer()).byteLength > 100;
      })()`));
    }
  }
  await send('Network.clearBrowserCookies');
  await open('/resources');
  check('anonymous state is restored after role checks', await waitFor("window.__readerCalls.some(c => c.url.includes('/api/v1/library?') && c.status === 200 && !c.authorized)"));
  process.exitCode = finish();
} finally {
  browser?.close();
  chrome.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise((resolve) => chrome.once('exit', () => resolve(true))),
    pause(3000).then(() => false),
  ]);
  if (!exited) {
    chrome.kill('SIGKILL');
    await new Promise((resolve) => chrome.once('exit', resolve));
  }
  // Only this process's mkdtemp-owned browser profile, never a user's profile.
  await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
