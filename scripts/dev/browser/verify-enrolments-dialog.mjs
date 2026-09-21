/**
 * **SRS Revision 167 on the real pages** — «إدارة التسجيلات», «إتمام المستوى»,
 * «شهاداتي», «تثبيت التطبيق» and the clock.
 *
 * The rules are the server's and are integration-tested. Only a browser can
 * show the rest: that ONE row action opens ONE dialog, that what BR-11 is
 * missing is on screen BEFORE anything is pressed, that the awareness
 * confirmation is really asked, that a certificate reaches her only after the
 * second confirmation, and that the page she sees carries her name and a
 * download button.
 *
 * Journey A is the dev Super Admin; journey B is the scenario student HERSELF,
 * minted as she is — never a widened admin token.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.SCENARIO ?? '{}');
const ADMIN = process.env.DEV_REFRESH_COOKIE;
const STUDENT = process.env.STUDENT_REFRESH_COOKIE;
if (!ADMIN || !STUDENT) throw new Error('DEV_REFRESH_COOKIE and STUDENT_REFRESH_COOKIE are required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9236');
const { check, finish } = results();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function actAs(cookie) {
  await send('Network.clearBrowserCookies');
  await send('Network.setCookie', {
    name: 'bodour_refresh',
    value: cookie,
    domain: 'localhost',
    path: '/api/v1/auth',
    httpOnly: true,
  });
}

async function goto(path, readyExpression) {
  await send('Page.navigate', { url: BASE + path });
  for (let i = 0; i < 100; i += 1) {
    const state = await evaluate(
      '(() => { if (document.location.pathname.startsWith("/login")) return "login"; return (' +
        readyExpression +
        ') ? "ready" : "waiting"; })()',
    ).catch(() => null);
    if (state === 'ready' || state === 'login') return state;
    await sleep(250);
  }
  return 'timeout';
}

/* ── The clock, before anything else: it needs no session ─────────────────── */

const clock = await (await fetch(BASE + '/api/v1/clock')).json();
check(
  'GET /clock answers from the HOST zone file, with an offset',
  clock?.data?.source === 'host-zoneinfo' && Number.isInteger(clock?.data?.utc_offset_minutes),
  JSON.stringify(clock?.data),
);

/* ── Journey A — the Super Admin, on المستفيدات ───────────────────────────── */

await actAs(ADMIN);
const listed = await goto(
  '/admin/enrollments',
  '[...document.querySelectorAll(".admin-table tbody tr")].some((tr) => (tr.textContent.includes("[dev-scenario]") && tr.textContent.includes("مستفيدة مسجّلة")))',
);
check('المستفيدات loads with the scenario student', listed === 'ready', 'state=' + listed);
if (listed !== 'ready') {
  close();
  process.exit(finish());
}

const rowActions = await evaluate(`(() => {
  const row = [...document.querySelectorAll('.admin-table tbody tr')]
    .find((tr) => tr.textContent.includes('[dev-scenario]') && tr.textContent.includes('مستفيدة مسجّلة'));
  return [...row.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean);
})()`);
check(
  'ONE row action — «إدارة التسجيلات» — where «تسجيل» and «تعديل» were two',
  rowActions.includes('إدارة التسجيلات') && !rowActions.includes('تسجيل') && !rowActions.includes('تعديل'),
  JSON.stringify(rowActions),
);

const opened = await evaluate(`(async () => {
  const row = [...document.querySelectorAll('.admin-table tbody tr')]
    .find((tr) => tr.textContent.includes('[dev-scenario]') && tr.textContent.includes('مستفيدة مسجّلة'));
  [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'إدارة التسجيلات').click();
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    if (document.querySelector('dialog[open] [data-level-completion]')) break;
  }
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return { open: false };
  return {
    open: true,
    cards: dialog.querySelectorAll('[data-enrolment]').length,
    buttons: [...dialog.querySelectorAll('button')].map((b) => b.textContent.trim()),
    unmet: dialog.querySelector('[data-unmet]')?.textContent ?? null,
    panel: dialog.querySelector('[data-level-completion]')?.getAttribute('data-level-completion') ?? null,
  };
})()`);
check('the dialog opens with her placement as a card', opened.open === true && opened.cards === 1, JSON.stringify(opened));
check(
  'it edits, ends and ADDS from the one dialog',
  ['تعديل', 'إنهاء التسجيل', 'تسجيل في مستوى آخر'].every((label) =>
    (opened.buttons ?? []).some((b) => b.includes(label)),
  ),
  JSON.stringify(opened.buttons),
);
check(
  '«إتمام المستوى» sits under the Level it is about',
  opened.panel === S.levelId,
  'panel=' + opened.panel + ' level=' + S.levelId,
);
check(
  'what BR-11 is missing is SAID under the Level before anything is pressed',
  typeof opened.unmet === 'string' && opened.unmet.length > 10,
  String(opened.unmet),
);

/** Presses a button inside the completion panel, then answers the confirmation. */
async function pressAndConfirm(label, confirmLabel) {
  return evaluate(`(async () => {
    const seen = [];
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/level-completions')) {
        seen.push({ method: (init && init.method) || 'GET', path: url.split('/api/v1')[1], body: (init && init.body) || null });
      }
      return original(input, init);
    };
    const panel = document.querySelector('dialog[open] [data-level-completion]');
    const button = [...panel.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)});
    if (!button) { window.fetch = original; return { pressed: false, buttons: [...panel.querySelectorAll('button')].map((b) => b.textContent.trim()) }; }
    button.click();
    await new Promise((r) => setTimeout(r, 600));
    const dialogs = [...document.querySelectorAll('dialog[open]')];
    const confirm = dialogs[dialogs.length - 1];
    const asked = confirm.textContent;
    const yes = [...confirm.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(confirmLabel)});
    if (!yes) { window.fetch = original; return { pressed: true, confirmed: false, asked }; }
    yes.click();
    await new Promise((r) => setTimeout(r, 2500));
    window.fetch = original;
    const after = document.querySelector('dialog[open] [data-level-completion]');
    return { pressed: true, confirmed: true, asked, seen, panelText: after ? after.textContent : null };
  })()`);
}

const marked = await pressAndConfirm('تسجيل إتمام المستوى', 'تسجيل إتمام المستوى');
check('the awareness confirmation is really asked — it names that the conditions are not met', marked.confirmed === true && (marked.asked ?? '').includes('لم تستوفِ'), JSON.stringify(marked).slice(0, 400));
const markWrite = (marked.seen ?? []).find((c) => c.method === 'PUT');
check(
  'ONE write, and it says she was told: acknowledge_unmet',
  markWrite !== undefined && String(markWrite.body).includes('"acknowledge_unmet":true'),
  JSON.stringify(marked.seen),
);
check(
  'the Level now reads «أتمّت المستوى», with the certificate NOT yet showing',
  (marked.panelText ?? '').includes('أتمّت المستوى') && (marked.panelText ?? '').includes('الشهادة غير ظاهرة'),
  String(marked.panelText).slice(0, 300),
);

const issued = await pressAndConfirm('تأكيد إظهار الشهادة', 'تأكيد إظهار الشهادة');
check(
  'the certificate is a SECOND confirmation, and the panel then names its number',
  issued.confirmed === true && /الشهادة رقم \d+/.test(issued.panelText ?? ''),
  String(issued.panelText).slice(0, 300),
);
check(
  'a showing certificate can only be withdrawn — «إلغاء تسجيل الإتمام» is gone',
  !(issued.panelText ?? '').includes('إلغاء تسجيل الإتمام') && (issued.panelText ?? '').includes('سحب الشهادة'),
  String(issued.panelText).slice(0, 300),
);

/* ── Journey B — the student herself ─────────────────────────────────────── */

await actAs(STUDENT);
const mine = await goto(
  '/dashboard/student/certificates',
  'document.querySelector("[data-certificate]") || document.querySelector("[data-no-certificates]")',
);
check('«شهاداتي» opens for the student herself', mine === 'ready', 'state=' + mine);

const certificate = await evaluate(`(() => {
  const doc = document.querySelector('[data-certificate]');
  if (!doc) return { found: false, empty: Boolean(document.querySelector('[data-no-certificates]')) };
  const box = doc.getBoundingClientRect();
  return {
    found: true,
    text: doc.textContent,
    ratio: box.width / box.height,
    download: Boolean(document.querySelector('[data-download-certificate]')),
    nav: [...document.querySelectorAll('nav a')].map((a) => a.textContent.trim()),
    logoLoaded: (() => { const img = doc.querySelector('img'); return Boolean(img && img.complete && img.naturalWidth > 0); })(),
  };
})()`);
check('her confirmed certificate is there, in her own name', certificate.found === true && (certificate.text ?? '').includes('[dev-scenario] مستفيدة مسجّلة'), JSON.stringify(certificate).slice(0, 300));
check('it states the document, the Level and a number', ['شهادة إتمام مستوى', 'BA-'].every((x) => (certificate.text ?? '').includes(x)), String(certificate.text).slice(0, 200));
check('it is drawn at A4-landscape proportions, logo loaded', Math.abs((certificate.ratio ?? 0) - 297 / 210) < 0.02 && certificate.logoLoaded === true, 'ratio=' + certificate.ratio + ' logo=' + certificate.logoLoaded);
check('«تحميل PDF / طباعة» is offered', certificate.download === true);
check('«شهاداتي» is in her menu', (certificate.nav ?? []).includes('شهاداتي'), JSON.stringify(certificate.nav));

const printing = await evaluate(`(async () => {
  let printed = 0;
  window.print = () => { printed += 1; };
  document.querySelector('[data-download-certificate]').click();
  await new Promise((r) => setTimeout(r, 700));
  const root = document.querySelector('body > .certificate-print-root');
  const state = {
    printed,
    flagged: document.documentElement.classList.contains('print-certificate'),
    portalUnderBody: Boolean(root),
    oneDocument: root ? root.querySelectorAll('.certificate--printing').length : 0,
  };
  window.dispatchEvent(new Event('afterprint'));
  await new Promise((r) => setTimeout(r, 300));
  return { ...state, cleaned: !document.documentElement.classList.contains('print-certificate') && !document.querySelector('.certificate-print-root') };
})()`);
check(
  'the download prints ONE certificate from a portal under <body>, then cleans up',
  printing.printed === 1 && printing.flagged && printing.portalUnderBody && printing.oneDocument === 1 && printing.cleaned,
  JSON.stringify(printing),
);

/* ── Withdrawn, it is gone from her page ─────────────────────────────────── */

await actAs(ADMIN);
await goto(
  '/admin/enrollments',
  '[...document.querySelectorAll(".admin-table tbody tr")].some((tr) => (tr.textContent.includes("[dev-scenario]") && tr.textContent.includes("مستفيدة مسجّلة")))',
);
await evaluate(`(async () => {
  const row = [...document.querySelectorAll('.admin-table tbody tr')]
    .find((tr) => tr.textContent.includes('[dev-scenario]') && tr.textContent.includes('مستفيدة مسجّلة'));
  [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'إدارة التسجيلات').click();
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    if (document.querySelector('dialog[open] [data-level-completion]')) break;
  }
})()`);
const withdrawn = await pressAndConfirm('سحب الشهادة', 'سحب الشهادة');
check('the certificate is withdrawn from the same dialog', withdrawn.confirmed === true && (withdrawn.panelText ?? '').includes('الشهادة غير ظاهرة'), String(withdrawn.panelText).slice(0, 200));

await actAs(STUDENT);
await goto(
  '/dashboard/student/certificates',
  'document.querySelector("[data-certificate]") || document.querySelector("[data-no-certificates]")',
);
const gone = await evaluate(`(() => ({
  certificates: document.querySelectorAll('[data-certificate]').length,
  empty: Boolean(document.querySelector('[data-no-certificates]')),
}))()`);
check('…and it is gone from her page, which says how one comes to be there', gone.certificates === 0 && gone.empty === true, JSON.stringify(gone));

/* ── «تثبيت التطبيق» ─────────────────────────────────────────────────────── */

const pwa = await evaluate(`(async () => {
  const manifestLink = document.querySelector('link[rel="manifest"]');
  const manifest = await (await fetch(manifestLink.href)).json();
  const registration = await navigator.serviceWorker.getRegistration();
  return {
    manifestHref: manifestLink.getAttribute('href'),
    display: manifest.display,
    icons: manifest.icons.map((i) => i.sizes + ':' + i.purpose),
    worker: registration ? (registration.active || registration.installing || registration.waiting).scriptURL : null,
    cacheKeys: await caches.keys(),
  };
})()`);
check('the page links a standalone manifest with 192, 512 and maskable icons', pwa.display === 'standalone' && ['192x192:any', '512x512:any', '512x512:maskable'].every((x) => (pwa.icons ?? []).includes(x)), JSON.stringify(pwa));
check('the service worker is registered — and has cached NOTHING', typeof pwa.worker === 'string' && pwa.worker.endsWith('/sw.js') && (pwa.cacheKeys ?? []).length === 0, JSON.stringify(pwa));

await send('Emulation.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
});
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await goto('/', 'document.querySelector(".app-header__burger")');
const ios = await evaluate(`(async () => {
  document.querySelector('.app-header__burger').click();
  await new Promise((r) => setTimeout(r, 400));
  const button = document.querySelector('#mobile-menu [data-install-app]');
  if (!button) return { offered: false };
  const offer = button.getAttribute('data-install-app');
  button.click();
  await new Promise((r) => setTimeout(r, 500));
  const help = document.querySelector('dialog[open]');
  return { offered: true, offer, label: button.textContent.trim(), help: help ? help.textContent : null };
})()`);
// A real Chrome engine announces the install prompt whatever user agent it is
// told to claim, and the announced prompt rightly wins — so here «prompt» is the
// STRONGER proof: Chrome itself judged the platform installable (manifest, icons
// and worker all accepted). The iPhone steps, which no Chrome can reach, are
// held by install-app.test.ts.
check(
  'the phone menu offers «تثبيت التطبيق», and Chrome itself judged the platform installable',
  ios.offered === true && ios.label === 'تثبيت التطبيق' && (ios.offer === 'prompt' || ((ios.help ?? '').includes('الشاشة الرئيسية'))),
  JSON.stringify(ios).slice(0, 300),
);

close();
process.exit(finish());
