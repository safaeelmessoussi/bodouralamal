/**
 * **The UX slice, measured rather than declared.**
 *
 * Scroll ownership, control size and sidebar position are all facts about
 * rendered boxes — `scrollHeight` against `clientHeight`, bounding rectangles,
 * `scrollTop` before and after a navigation. None of them can be read from CSS,
 * which is the whole reason this file exists.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const COOKIE = process.env.DEV_REFRESH_COOKIE;
if (!COOKIE) throw new Error('DEV_REFRESH_COOKIE is required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9232');
const { check, finish } = results();

await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth/refresh',
  httpOnly: true,
});

async function goto(path, ready = '.admin-table, .state, .cal-toolbar') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 100; i += 1) {
    const ok = await evaluate(
      `(() => document.querySelector(${JSON.stringify(ready)}) !== null)()`,
    ).catch(() => false);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const width = async (w, h = 900) =>
  send('Emulation.setDeviceMetricsOverride', {
    width: w,
    height: h,
    deviceScaleFactor: 1,
    mobile: w < 700,
  });

/** Every element inside the open dialog that actually scrolls vertically. */
const scrollers = () =>
  evaluate(`(() => {
    const dialog = document.querySelector('dialog[open]');
    if (!dialog) return { noDialog: true };
    const all = [dialog, ...dialog.querySelectorAll('*')];
    const scrolling = all
      .filter((el) => {
        const st = getComputedStyle(el);
        const canScroll = ['auto', 'scroll'].includes(st.overflowY);
        return canScroll && el.scrollHeight - el.clientHeight > 1;
      })
      .map((el) => ({
        cls: el.className && String(el.className).slice(0, 40),
        tag: el.tagName.toLowerCase(),
        over: el.scrollHeight - el.clientHeight,
      }));
    return { scrolling, count: scrolling.length };
  })()`);

/* ── 3 · dialog scroll ownership ─────────────────────────────────────────── */

await width(1440);

// A genuinely SHORT form: a Category is a name and nothing else. The enrolment
// dialog is not short — it carries a searchable list, a Level, a branch, a
// group and the circles — and using it here measured a real overflow as a defect.
await goto('/admin/categories');
const shortForm = await evaluate(`(async () => {
  const add = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('إضافة'));
  if (!add) return { noButton: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 8) };
  add.click();
  await new Promise((r) => setTimeout(r, 1800));
  return { opened: document.querySelector('dialog[open]') !== null };
})()`);
check('a SHORT dialog opens', shortForm.opened === true, JSON.stringify(shortForm));

const shortScroll = await scrollers();
check(
  '3a · a short form creates NO scrolling region at all',
  shortScroll.count === 0,
  JSON.stringify(shortScroll.scrolling),
);

await goto('/admin/enrollments');
const longForm = await evaluate(`(async () => {
  // The table can be on screen before the header's action is — waiting for the
  // BUTTON rather than for the page is what makes this repeatable; it read
  // undefined once on a slower run and took the whole harness down with it.
  let add = null;
  for (let i = 0; i < 40 && !add; i += 1) {
    add = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('تسجيل مستفيدة'));
    if (!add) await new Promise((r) => setTimeout(r, 250));
  }
  if (!add) return { noAdd: true };
  add.click();
  await new Promise((r) => setTimeout(r, 2000));
  return true;
})()`);
check('the enrolment dialog opens', longForm === true);

// Force a long form by widening the option lists: pick a beneficiary so the
// Level list and the circles appear.
const longScroll = await evaluate(`(async () => {
  const box = [...document.querySelectorAll('.searchable-select')]
    .find((f) => (f.querySelector('legend')?.textContent ?? '').includes('المستفيدة'));
  const btn = box?.querySelector('.searchable-select__options li button');
  if (btn) btn.click();
  await new Promise((r) => setTimeout(r, 2200));
  const dialog = document.querySelector('dialog[open]');
  const all = [dialog, ...dialog.querySelectorAll('*')];
  const scrolling = all
    .filter((el) => {
      const st = getComputedStyle(el);
      return ['auto', 'scroll'].includes(st.overflowY) && el.scrollHeight - el.clientHeight > 1;
    })
    .map((el) => ({ cls: String(el.className).slice(0, 44), over: el.scrollHeight - el.clientHeight }));
  return { scrolling, count: scrolling.length };
})()`);
// The bounded option lists are DELIBERATE nested scrollers; the defect is the
// dialog and its body both scrolling.
const shellScrollers = (longScroll.scrolling ?? []).filter(
  (s) => !s.cls.includes('select__options'),
);
check(
  '3b · at most ONE shell scroller — the dialog and its body never both scroll',
  shellScrollers.length <= 1,
  JSON.stringify(longScroll.scrolling),
);
check(
  '3c · when the shell scrolls, it is the BODY that owns it',
  shellScrollers.length === 0 || shellScrollers[0].cls.includes('dialog__body'),
  JSON.stringify(shellScrollers),
);

await width(390, 780);
await new Promise((r) => setTimeout(r, 800));
const narrow = await scrollers();
const narrowShell = (narrow.scrolling ?? []).filter((s) => !s.cls.includes('select__options'));
check(
  '3d · the same holds at a narrow viewport',
  narrowShell.length <= 1 && (narrowShell.length === 0 || narrowShell[0].cls.includes('dialog__body')),
  JSON.stringify(narrow.scrolling),
);
await width(1440);

/* == 1 . the enrolment edit dialog offers Groups and Circles only ============ */

await goto('/admin/enrollments');
await new Promise((r) => setTimeout(r, 600));
const editDialog = await evaluate(`(async () => {
  const edit = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('تعديل'));
  if (!edit) return { noRow: true, buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 14), rows: document.querySelectorAll('.admin-table tbody tr').length, notes: document.querySelectorAll('.admin-notice').length };
  edit.click();
  await new Promise((r) => setTimeout(r, 500));
  const d = document.querySelector('dialog[open]');
  if (!d) return { noDialog: true };
  const labels = [...d.querySelectorAll('label')].map((l) => l.textContent.trim());
  return {
    labels,
    // The editable controls, whatever they are called: an identity field that is
    // merely HIDDEN would still be here, which is the thing being checked.
    editable: [...d.querySelectorAll('select, input, .searchable-select, .multi-select')].length,
    // **Exact labels, never a substring.** «مجموعات المستويات» — the group
    // selector that SHOULD be here — contains «المستوي», and matching loosely
    // reported the identity field as present while looking straight at its
    // absence. The same trap was recorded once already this week.
    levelControl: labels.some((l) => l === 'المستوى' || l === 'المستوي'),
    branchControl: labels.some((l) => l.includes('المقر')),
    statesIdentityIsFixed: d.textContent.includes('لا يُعدَّلان'),
    showsBranchAsText: d.textContent.includes('المقر'),
  };
})()`);

check(
  '1a . the edit dialog offers NO Level control at all — not hidden, absent',
  editDialog.levelControl === false,
  JSON.stringify(editDialog.labels),
);
check(
  '1b . and no Branch control either',
  editDialog.branchControl === false,
  JSON.stringify(editDialog.labels),
);
check(
  '1c . it still SHOWS the branch, and says why it cannot be changed here',
  editDialog.showsBranchAsText === true && editDialog.statesIdentityIsFixed === true,
  JSON.stringify({
    shows: editDialog.showsBranchAsText,
    explains: editDialog.statesIdentityIsFixed,
  }),
);
await evaluate(`(() => { const d = document.querySelector('dialog[open]'); if (d) d.close(); })()`);

/* == 4 . the action message =================================================
 *
 * **Not measured in the browser, and that is a gap, not a pass.**
 *
 * Three attempts are recorded here because each one is a trap the next harness
 * would otherwise walk into:
 *
 *  1. Reading whatever notices `/admin/hijri-calendar` happened to show. It has
 *     none unless drafts exist, so the check PASSED against an empty list —
 *     vacuous, the failure mode this project has already paid for once.
 *  2. Provoking a real BR-21 refusal by re-submitting an existing enrolment.
 *     Driving the searchable list from script picked the wrong option, so the
 *     form never reached the server; the harness then reported a missing message
 *     that had never been asked for.
 *  3. Opening the session editor, which states the scope of a change before it is
 *     made. `/admin/schedule-sessions` is a DRILL-DOWN and renders no rows on its
 *     own, so there was nothing to open.
 *
 * What would settle it is a refusal the server produces with no mutation behind
 * it, reached without driving a combobox. Until then the property is held by
 * `atomic-components.test.tsx` — one implementation, proven against the defect —
 * and the placement is a static fact of the markup, not a measured one.
 */

/* == 5 . calendar controls: compact, grouped, and the SAME on every surface == */

/** The rendered geometry of the two control groups on whatever page is open. */
const controls = () =>
  evaluate(`(() => {
    const groups = [...document.querySelectorAll('.cal-segmented')];
    return groups.map((g) => {
      const r = g.getBoundingClientRect();
      const kids = [...g.querySelectorAll('button')].map((b) => {
        const br = b.getBoundingClientRect();
        return { w: Math.round(br.width), h: Math.round(br.height), label: b.textContent.trim() };
      });
      return {
        role: g.getAttribute('role') || g.tagName.toLowerCase(),
        w: Math.round(r.width),
        h: Math.round(r.height),
        kids,
        // One group means one row: if the parts wrapped, the heights differ from
        // the group's own, which is what a CSS reading cannot tell you.
        rows: new Set(kids.map((k) => k.h)).size,
        primaries: g.querySelectorAll('.btn--primary').length,
      };
    });
  })()`);

await goto('/calendar', '.cal-grid, .cal-segmented');
await new Promise((r) => setTimeout(r, 600));
const publicCal = await controls();

check(
  '5a . the public calendar renders BOTH control groups as segmented units',
  publicCal.length === 2,
  JSON.stringify(publicCal.map((g) => g.role)),
);
check(
  '5b . no control in either group is a primary call to action',
  publicCal.every((g) => g.primaries === 0),
  JSON.stringify(publicCal.map((g) => g.primaries)),
);
// The complaint was SIZE. 7.5rem at this root font size is 120px; the measured
// width is what decides whether the fix landed, not the stylesheet.
const widest = Math.max(...publicCal.flatMap((g) => g.kids.map((k) => k.w)));
check(
  `5c . every control is compact — widest measured ${widest}px, was 120px minimum`,
  widest < 100,
  JSON.stringify(publicCal.flatMap((g) => g.kids)),
);
check(
  '5d . each group sits on ONE row, so it reads as one control',
  publicCal.every((g) => g.rows === 1),
  JSON.stringify(publicCal.map((g) => g.rows)),
);
check(
  '5e . exactly one view is marked selected, so "where am I" is answerable',
  await evaluate(
    `document.querySelectorAll('.cal-segmented [aria-selected="true"]').length === 1`,
  ),
  'aria-selected count',
);
// Focus must survive a group with overflow: hidden, which is the thing that
// clips a ring and cannot be seen from the CSS.
const ring = await evaluate(`(() => {
  const b = document.querySelector('.cal-segmented button');
  b.focus();
  const st = getComputedStyle(b, ':focus-visible');
  const r = b.getBoundingClientRect();
  const g = b.closest('.cal-segmented').getBoundingClientRect();
  return {
    focused: document.activeElement === b,
    inside: r.top >= g.top - 1 && r.bottom <= g.bottom + 1,
    outline: st.outlineWidth,
  };
})()`);
check(
  '5f . the keyboard ring is inside the clipping group, not cut off by it',
  ring.focused && ring.inside,
  JSON.stringify(ring),
);

await goto('/admin/schedules', '.cal-segmented, .admin-table, .state');
await new Promise((r) => setTimeout(r, 600));
const adminCal = await controls();
check(
  '5g . the admin calendar uses the SAME component, at the same size',
  adminCal.length > 0 &&
    adminCal.every((g) => g.kids.every((k) => k.w === publicCal[0].kids[0].w || k.w < 100)),
  JSON.stringify(adminCal.flatMap((g) => g.kids)),
);

await width(390, 780);
await new Promise((r) => setTimeout(r, 600));
const phone = await controls();
check(
  '5h . on a phone the group spans the width and still does not wrap',
  phone.every((g) => g.rows === 1 && g.w > 300),
  JSON.stringify(phone.map((g) => ({ w: g.w, rows: g.rows }))),
);
await width(1440);

/* == 6 . the sidebar keeps its place across a navigation ==================== */

await goto('/admin/branches');
await new Promise((r) => setTimeout(r, 500));

const navBox = () =>
  evaluate(`(() => {
    const nav = document.querySelector('.admin-nav');
    if (!nav) return { missing: true };
    const active = nav.querySelector('[aria-current="page"]');
    const nr = nav.getBoundingClientRect();
    const ar = active ? active.getBoundingClientRect() : null;
    return {
      scrollTop: Math.round(nav.scrollTop),
      canScroll: nav.scrollHeight - nav.clientHeight > 1,
      overflow: nav.scrollHeight - nav.clientHeight,
      pageY: Math.round(window.scrollY),
      activeVisible: ar ? ar.top >= nr.top - 1 && ar.bottom <= nr.bottom + 1 : null,
      activeLabel: active ? active.textContent.trim() : null,
    };
  })()`);

const before = await navBox();
check(
  '6a . the sidebar is its own scroll container on the desktop layout',
  before.canScroll === true,
  JSON.stringify(before),
);

// Scroll the MENU (not the page) to its far end, then navigate from there —
// the exact sequence that used to land on the next page with the menu at zero.
await evaluate(`(() => {
  const nav = document.querySelector('.admin-nav');
  nav.scrollTop = nav.scrollHeight;
  nav.dispatchEvent(new Event('scroll'));
  return nav.scrollTop;
})()`);
const parked = await evaluate(`Math.round(document.querySelector('.admin-nav').scrollTop)`);
await new Promise((r) => setTimeout(r, 300));

await goto('/admin/users');
await new Promise((r) => setTimeout(r, 700));
const after = await navBox();

check(
  `6b . the position survives the navigation — parked at ${parked}, restored to ${after.scrollTop}`,
  after.scrollTop > 0,
  JSON.stringify(after),
);
check(
  '6c . the active entry is visible in the sidebar after the load',
  after.activeVisible === true,
  JSON.stringify(after),
);
check(
  '6d . only the sidebar moved — the PAGE is still at the top',
  after.pageY === 0,
  `window.scrollY = ${after.pageY}`,
);

/* The other half of the rule: an entry that is already visible must move
   NOTHING. The first attempt at this check asserted it while navigating to
   «الفروع والقاعات», which genuinely sits below the fold at `scrollTop: 0` — so
   the move it recorded was correct and the check was wrong. The destination is
   therefore MEASURED rather than assumed: whichever entry the top of the menu
   already shows is the one that must not provoke a scroll. */
await evaluate(`(() => {
  const nav = document.querySelector('.admin-nav');
  nav.scrollTop = 0;
  nav.dispatchEvent(new Event('scroll'));
})()`);
const nearTop = await evaluate(`(() => {
  const nav = document.querySelector('.admin-nav');
  const navBottom = nav.getBoundingClientRect().bottom;
  const link = [...nav.querySelectorAll('a')].find(
    (a) => !a.hasAttribute('aria-current') && a.getBoundingClientRect().bottom < navBottom - 40,
  );
  return link ? { href: link.getAttribute('href'), label: link.textContent.trim() } : null;
})()`);
await new Promise((r) => setTimeout(r, 300));
await goto(nearTop.href);
await new Promise((r) => setTimeout(r, 700));
const neighbour = await navBox();
check(
  `6e . and it does NOT jump when the entry is already visible — ${nearTop.label}`,
  neighbour.scrollTop === 0 && neighbour.activeVisible === true,
  JSON.stringify(neighbour),
);

close();
process.exit(finish());
