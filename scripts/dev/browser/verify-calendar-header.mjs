/**
 * **The calendar header, and the table note, as rendered geometry.**
 *
 * Both properties here are invisible to source reading. *Centred* is not
 * `text-align: center` — the title can be perfectly centred inside a box that is
 * itself off-centre, which is exactly what a flex row with unequal control groups
 * produces. And *wraps too early* is a fact about a line box against its
 * container, which no stylesheet states.
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
  path: '/api/v1/auth/refresh',
  httpOnly: true,
});

const width = (w, h = 900) =>
  send('Emulation.setDeviceMetricsOverride', {
    width: w,
    height: h,
    deviceScaleFactor: 1,
    mobile: w < 700,
  });

async function goto(path, ready) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 120; i += 1) {
    const ok = await evaluate(
      `(() => document.querySelector(${JSON.stringify(ready)}) !== null)()`,
    ).catch(() => false);
    if (ok) {
      await new Promise((r) => setTimeout(r, 600));
      return true;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** The header's three regions and the rows beneath it, as boxes. */
const header = () =>
  evaluate(`(() => {
    const h = document.querySelector('.cal-header');
    if (!h) return { missing: true };
    const box = (sel) => {
      const el = h.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top),
               centre: Math.round((r.left + r.right) / 2), w: Math.round(r.width) };
    };
    const hr = h.getBoundingClientRect();
    const grid = h.querySelector('.cal-header__bar').getBoundingClientRect();
    const content = document.querySelector('.cal-grid, .cal-list, .admin-table');
    return {
      headerCentre: Math.round((hr.left + hr.right) / 2),
      barTop: Math.round(grid.top),
      view: box('.cal-header__start .cal-segmented'),
      title: box('.cal-header__centre .cal-title'),
      nav: box('.cal-header__end .cal-segmented'),
      filters: box('.cal-header__filters'),
      contentTop: content ? Math.round(content.getBoundingClientRect().top) : null,
    };
  })()`);

/* ── the public calendar, desktop ───────────────────────────────────────── */

await width(1440);
await goto('/calendar', '.cal-header');
const pub = await header();

check(
  '1 · public — the header renders all three regions',
  pub.view !== null && pub.title !== null && pub.nav !== null,
  JSON.stringify({ view: !!pub.view, title: !!pub.title, nav: !!pub.nav }),
);
// RTL: the first column reads on the RIGHT, so the view switch has the larger
// x-coordinate and the stepping the smaller. Asserting the geometry rather than
// the source order is what makes this a check and not a restatement.
check(
  '2 · public — view switch RIGHT, month stepping LEFT (RTL)',
  pub.view.left > pub.title.right && pub.nav.right < pub.title.left,
  JSON.stringify({ view: pub.view.left, titleL: pub.title.left, titleR: pub.title.right, nav: pub.nav.right }),
);
// The whole point of the grid: the title's centre is the HEADER's centre, not
// the midpoint of whatever the two unequal control groups left over.
const drift = Math.abs(pub.title.centre - pub.headerCentre);
check(
  `3 · public — the title is centred on the header, not on the leftover space (drift ${drift}px)`,
  drift <= 2,
  JSON.stringify({ titleCentre: pub.title.centre, headerCentre: pub.headerCentre, viewW: pub.view.w, navW: pub.nav.w }),
);
check(
  '4 · public — and the two side groups are genuinely unequal, so that was a real test',
  Math.abs(pub.view.w - pub.nav.w) > 40,
  JSON.stringify({ viewW: pub.view.w, navW: pub.nav.w }),
);
check(
  '5 · public — filters sit on their own row BELOW the header bar',
  pub.filters !== null && pub.filters.top > pub.title.top + 10,
  JSON.stringify({ barTop: pub.barTop, filtersTop: pub.filters?.top }),
);
check(
  '6 · public — the calendar content is below the filters',
  pub.contentTop !== null && pub.filters !== null && pub.contentTop > pub.filters.top,
  JSON.stringify({ filtersTop: pub.filters?.top, contentTop: pub.contentTop }),
);

/* ── narrow ────────────────────────────────────────────────────────────── */

await width(390, 780);
await new Promise((r) => setTimeout(r, 700));
const phone = await header();
check(
  '7 · public — on a phone the title leads and the controls share the row below',
  phone.title.top < phone.view.top && Math.abs(phone.view.top - phone.nav.top) <= 4,
  JSON.stringify({ titleTop: phone.title.top, viewTop: phone.view.top, navTop: phone.nav.top }),
);
check(
  '8 · public — nothing overflows the viewport at 390px',
  await evaluate(`document.documentElement.scrollWidth <= window.innerWidth + 1`),
  'no horizontal scroll',
);

/* ── the back office, same component ───────────────────────────────────── */

await width(1440);
await goto('/admin/schedules?view=calendar', '.cal-header');
const admin = await header();
check(
  '9 · admin — the same header, with the same three regions',
  !admin.missing && admin.view !== null && admin.title !== null && admin.nav !== null,
  JSON.stringify({ view: !!admin.view, title: !!admin.title, nav: !!admin.nav }),
);
const adminDrift = Math.abs(admin.title.centre - admin.headerCentre);
check(
  `10 · admin — its title is centred on the header too (drift ${adminDrift}px)`,
  adminDrift <= 2,
  JSON.stringify({ titleCentre: admin.title.centre, headerCentre: admin.headerCentre }),
);
check(
  '11 · admin — view switch RIGHT and stepping LEFT, exactly as the public one',
  admin.view.left > admin.title.right && admin.nav.right < admin.title.left,
  JSON.stringify({ view: admin.view.left, nav: admin.nav.right }),
);

await goto('/admin/schedules?view=list', '.cal-header');
const list = await header();
check(
  '12 · admin list — the same header, without a month it does not have',
  !list.missing && list.view !== null && list.title === null && list.nav === null,
  JSON.stringify({ view: !!list.view, title: !!list.title, nav: !!list.nav }),
);

/* ── the table note ────────────────────────────────────────────────────── */

const note = () =>
  evaluate(`(() => {
    const n = document.querySelector('.datatable__reorder');
    if (!n) return { missing: true };
    const table = document.querySelector('.admin-table');
    const r = n.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(n);
    const lines = range.getClientRects().length;
    return {
      text: n.textContent.trim().slice(0, 30),
      // The width the note is ALLOWED, against the width its container offers.
      allowed: Math.round(parseFloat(getComputedStyle(n).maxWidth) || Infinity),
      available: Math.round(table.getBoundingClientRect().width),
      own: Math.round(r.width),
      lines,
      // The honest measure of premature wrapping: the longest line against the
      // space the note actually has.
      longestLine: Math.round(Math.max(...[...range.getClientRects()].map((x) => x.width))),
    };
  })()`);

await goto('/admin/levels', '.admin-table');
const levels = await note();
check(
  '13 · المستويات — the table note carries no measure cap at all',
  !levels.missing && !Number.isFinite(levels.allowed),
  JSON.stringify({ allowed: levels.allowed, available: levels.available }),
);
check(
  '14 · المستويات — it uses the table width rather than a 64ch slice of it',
  levels.own >= levels.available - 2,
  JSON.stringify({ own: levels.own, available: levels.available }),
);
// The defect was the LAST WORD wrapping with space beside it. If the text fits
// the container it must be one line; if it genuinely needs two, the first must
// be using nearly all the width available.
check(
  `15 · المستويات — no premature wrap (${levels.lines} line(s), longest ${levels.longestLine}px of ${levels.available}px)`,
  levels.lines === 1 || levels.longestLine > levels.available * 0.9,
  JSON.stringify(levels),
);

/* **Proof that the check can fail** — the same note, with the prose measure put
   back on it, in the same page. Without this, checks 13-15 assert that today's
   rendering is today's rendering; with it they assert that the cap was the cause
   and its removal was the fix. */
const withCap = await evaluate(`(() => {
  const n = document.querySelector('.datatable__reorder');
  const before = n.style.maxWidth;
  n.style.maxWidth = 'var(--measure)';
  const range = document.createRange();
  range.selectNodeContents(n);
  const lines = range.getClientRects().length;
  const width = Math.round(n.getBoundingClientRect().width);
  n.style.maxWidth = before;
  return { lines, width };
})()`);
check(
  `15b · المستويات — restoring the 64ch prose cap brings the wrap back (${withCap.lines} lines at ${withCap.width}px)`,
  withCap.lines > levels.lines,
  JSON.stringify({ capped: withCap, uncapped: { lines: levels.lines, width: levels.own } }),
);

await goto('/admin/groups', '.admin-table');
const groups = await note();
check(
  '16 · مجموعات المستويات — the same holds on a second page',
  groups.missing || (!Number.isFinite(groups.allowed) && (groups.lines === 1 || groups.longestLine > groups.available * 0.9)),
  JSON.stringify(groups),
);

close();
process.exit(finish());
