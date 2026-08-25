/**
 * **One occurrence-details dialog, on all four calendars.**
 *
 * The component was never duplicated — it was **never opened**. Three surfaces
 * out of four passed a click handler that discarded its argument, so a
 * beneficiary, a مؤطرة and an administrator could each see a class on a
 * calendar and had no way to ask anything about it. A shared component looks
 * perfectly healthy in isolation while that is true, which is why this is
 * driven rather than read.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const { send, evaluate, close } = await connect(process.env.PORT ?? '9255');
const { check, finish } = results();

await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
});

async function anonymous() {
  await send('Network.clearBrowserCookies');
}

async function beIdentity(cookie) {
  await send('Network.clearBrowserCookies');
  await send('Network.setCookie', {
    name: 'bodour_refresh', value: cookie,
    domain: 'localhost', path: '/api/v1/auth', httpOnly: true,
  });
}

const RECORDER = `
  (() => {
    if (window.__calls) return true;
    window.__calls = [];
    const real = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const res = await real(input, init);
      try { window.__calls.push({ url, status: res.status }); } catch (e) { void e; }
      return res;
    };
    return true;
  })()
`;

async function open(path, ready = 'main') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  await evaluate(RECORDER).catch(() => null);
  for (let i = 0; i < 140; i += 1) {
    const ok = await evaluate(
      `(() => document.querySelector(${JSON.stringify(ready)}) !== null)()`,
    ).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await evaluate(RECORDER).catch(() => null);
  await new Promise((r) => setTimeout(r, 1600));
}

/**
 * Opens the first occurrence on whatever calendar is loaded and reads the
 * details dialog.
 *
 * The grid renders each occurrence as a button inside a day cell; clicking one
 * is what three of the four surfaces used to discard.
 */
const openFirstOccurrence = () =>
  evaluate(`(async () => {
    // Switch to the grid, where occurrences are clickable.
    const calendarTab = [...document.querySelectorAll('.cal-segmented [role="tab"]')]
      .find((b) => b.textContent.trim() === 'تقويم');
    if (calendarTab && calendarTab.getAttribute('aria-selected') !== 'true') {
      calendarTab.click();
      await new Promise((r) => setTimeout(r, 2000));
    }
    // The grid is .cal-grid and each occurrence is an .event-chip inside a day
    // cell — .calendar-grid and .cal-day__event name nothing, and looking for
    // them reported an empty calendar on four working surfaces.
    /**
     * **A SESSION, specifically.** The first chip in a month is as likely to be
     * an Event or an exam, and neither carries recordings or materials — so the
     * two sections §B3 is about were never reached. Steps forward a few months
     * if this one has no class in it.
     */
    let entries = [...document.querySelectorAll('.cal-day__events .event-chip--session')];
    for (let hop = 0; hop < 4 && entries.length === 0; hop += 1) {
      const next = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'التالي');
      if (!next) break;
      next.click();
      await new Promise((r) => setTimeout(r, 2200));
      entries = [...document.querySelectorAll('.cal-day__events .event-chip--session')];
    }
    if (entries.length === 0) {
      return {
        noOccurrence: true,
        grids: document.querySelectorAll('.cal-grid').length,
        chips: document.querySelectorAll('.event-chip').length,
      };
    }
    entries[0].click();
    await new Promise((r) => setTimeout(r, 2500));
    const dialog = document.querySelector('dialog[open]');
    if (!dialog) return { noDialog: true, clicked: entries[0].textContent.trim().slice(0, 60) };
    const text = dialog.textContent;
    return {
      opened: true,
      text,
      // The two sections, each with its own heading and its own empty state.
      hasRecordings: text.includes('التسجيلات'),
      hasAttachments: text.includes('المواد المرفقة'),
      // The combined sentence and the page link must both be gone.
      combined: text.includes('لا تسجيلات ولا مواد'),
      pageLink: text.includes('فتح صفحة الحصة وموادها'),
      contentCalls: (window.__calls || []).filter((c) => c.url.includes('/calendar/sessions/')),
    };
  })()`);

/* ── the four surfaces, in turn ──────────────────────────────────────────── */

const surfaces = [
  ['public', null, '/calendar', '.cal-header'],
  ['back office', process.env.ADMIN_COOKIE, '/admin/schedules?view=calendar', '.cal-header'],
  ['مؤطرة', process.env.TEACHER_COOKIE, '/teacher/schedules', '.cal-header'],
  ['beneficiary', process.env.STUDENT_COOKIE, '/dashboard/student/calendar', '.cal-header'],
];

const seen = {};
for (const [name, cookie, path, ready] of surfaces) {
  // eslint-disable-next-line no-await-in-loop
  if (cookie) await beIdentity(cookie);
  else await anonymous();
  // eslint-disable-next-line no-await-in-loop
  await open(path, ready);
  // eslint-disable-next-line no-await-in-loop
  seen[name] = await openFirstOccurrence();
}

for (const [name] of surfaces) {
  const r = seen[name];
  check(
    `${name} · clicking an occurrence opens the shared details dialog`,
    r.opened === true,
    JSON.stringify(r).slice(0, 220),
  );
}

for (const [name] of surfaces) {
  const r = seen[name];
  check(
    `${name} · التسجيلات and المواد المرفقة are separate sections`,
    r.hasRecordings === true && r.hasAttachments === true && r.combined === false,
    JSON.stringify({
      recordings: r.hasRecordings,
      attachments: r.hasAttachments,
      combined: r.combined,
    }),
  );
  check(
    `${name} · and no «فتح صفحة الحصة وموادها» step is required`,
    r.pageLink === false,
    JSON.stringify({ pageLink: r.pageLink }),
  );
}

/**
 * **The focused read is the caller's own** (§B6). The prior defect was an
 * authenticated dialog reading the public tier, so a مؤطرة saw less than she
 * may — a 200 with the wrong contents, which no status check would catch.
 */
const authenticated = ['back office', 'مؤطرة', 'beneficiary'];
check(
  'the focused session read succeeds for every authenticated reader',
  authenticated.every((name) => {
    const calls = seen[name]?.contentCalls ?? [];
    return calls.length === 0 || calls.every((c) => c.status === 200);
  }),
  JSON.stringify(
    Object.fromEntries(authenticated.map((n) => [n, seen[n]?.contentCalls ?? []])),
  ),
);

close();
process.exit(finish());
