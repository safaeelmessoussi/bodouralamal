/**
 * **A closed dialog must consume no layout; an open one must be an overlay.**
 *
 * The regression of 2026-08-18 made every mounted `<dialog>` render as ordinary
 * page content underneath the table, on most of the platform at once. It was one
 * CSS declaration, and **no source reading found it** — the component was
 * correct, the state was correct, the markup was correct. Only rendered geometry
 * says whether a dialog is on the page or above it.
 *
 * So this sweeps representative pages from BOTH sets the Owner reported: those
 * that broke (which keep their dialog mounted at all times) and those that did
 * not (which mount it conditionally). The second set is not decoration — it is
 * the control that tells a real fix apart from a coincidence.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const COOKIE = process.env.DEV_REFRESH_COOKIE;
if (!COOKIE) throw new Error('DEV_REFRESH_COOKIE is required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9233');
const { check, finish } = results();

await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth/refresh',
  httpOnly: true,
});
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});

async function goto(path) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 120; i += 1) {
    const ok = await evaluate(
      `(() => document.querySelector('.admin-table, .state, .cal-grid, .cal-list, main') !== null)()`,
    ).catch(() => false);
    if (ok) {
      await new Promise((r) => setTimeout(r, 500));
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * What every mounted dialog is doing, as rendered boxes.
 *
 * `getClientRects().length === 0` is the honest test for *takes no space*: it is
 * empty for `display: none` and for a detached subtree alike, and it does not
 * care which mechanism produced the hiding.
 */
const dialogState = () =>
  evaluate(`(() => {
    const all = [...document.querySelectorAll('dialog')];
    const body = document.body.getBoundingClientRect();
    return {
      mounted: all.length,
      open: all.filter((d) => d.open).length,
      visibleClosed: all
        .filter((d) => !d.open && d.getClientRects().length > 0)
        .map((d) => ({ cls: d.className, h: Math.round(d.getBoundingClientRect().height) })),
      pageHeight: Math.round(body.height),
      openBox: (() => {
        const d = all.find((x) => x.open);
        if (!d) return null;
        const r = d.getBoundingClientRect();
        const st = getComputedStyle(d);
        return {
          cls: d.className,
          top: Math.round(r.top),
          height: Math.round(r.height),
          position: st.position,
          display: st.display,
          // The native top layer is what puts a modal above the page without
          // z-index arithmetic; a dialog opened with showModal has a backdrop.
          hasBackdrop: d.matches(':modal'),
          onScreen: r.top >= 0 && r.bottom <= window.innerHeight + 1,
        };
      })(),
      scrollers: (() => {
        const d = all.find((x) => x.open);
        if (!d) return [];
        return [d, ...d.querySelectorAll('*')]
          .filter((el) => {
            const st = getComputedStyle(el);
            return ['auto', 'scroll'].includes(st.overflowY) && el.scrollHeight - el.clientHeight > 1;
          })
          .map((el) => ({ cls: String(el.className).slice(0, 40), over: el.scrollHeight - el.clientHeight }));
      })(),
    };
  })()`);

const openFirst = () =>
  evaluate(`(async () => {
    // **The add button is found by its VARIANT, not by its words.** Matching text
    // reported four pages as having no trigger at all — the add variant prefixes
    // a ＋ and each page words its own label, so a text matcher silently turns a
    // page into a skip. Row تعديل is the fallback for pages that only edit.
    let btn = null;
    for (let i = 0; i < 40 && !btn; i += 1) {
      btn =
        document.querySelector('.btn--add') ||
        [...document.querySelectorAll('button')].find(
          (b) => b.textContent.includes('إضافة') || b.textContent.includes('تسجيل مستفيدة') || b.textContent.includes('جديد'),
        ) ||
        [...document.querySelectorAll('.admin-table button, .admin-card button')].find((b) => b.textContent.includes('تعديل')) ||
        // The calendar opens its dialogs from a day, not from a header action,
        // and the calendar is where the reported wide dialog block appeared, so
        // it must not fall through to a skip.
        document.querySelector('.cal-day__select');
      if (!btn) await new Promise((r) => setTimeout(r, 250));
    }
    if (!btn) return { noTrigger: true };
    btn.click();
    await new Promise((r) => setTimeout(r, 700));
    return { clicked: btn.textContent.trim().slice(0, 20) };
  })()`);

const closeOpen = () =>
  evaluate(`(async () => {
    const d = document.querySelector('dialog[open]');
    if (!d) return { none: true };
    const x = d.querySelector('.dialog__close');
    if (x) x.click();
    else d.close();
    await new Promise((r) => setTimeout(r, 600));
    return { stillOpen: document.querySelector('dialog[open]') !== null };
  })()`);

/* The two sets the Owner reported, by their Arabic names. The second set is the
   CONTROL: those pages mount their dialog conditionally and never broke, so a
   fix that only moved the defect would show up as a change there. */
const AFFECTED = [
  ['الفروع', '/admin/branches'],
  ['الفئات', '/admin/categories'],
  ['المواد', '/admin/subjects'],
  ['المستويات', '/admin/levels'],
  ['مجموعات المستويات', '/admin/groups'],
  ['المستخدمون', '/admin/users'],
  ['التسجيلات', '/admin/enrollments'],
  ['الجدولة', '/admin/schedules'],
  ['مكتبة المحتوى', '/admin/content'],
  ['حلقات المواد', '/admin/teaching-groups'],
  ['التقويم العام', '/calendar'],
];
const CONTROL = [
  ['مواد المستوى', '/admin/level-subjects'],
  ['مقرر الحفظ', '/admin/level-surahs'],
  ['التقويم الهجري', '/admin/hijri-calendar'],
  ['إعدادات المنصة', '/admin/settings'],
];

for (const [label, path] of [...AFFECTED, ...CONTROL]) {
  await goto(path);

  /* **The page must really be the page.** Five of these URLs were wrong on the
     first run — `/admin/taxonomy` and `/admin/scheduling` do not exist — and the
     no-dialog check passed on every one of them, because a page that renders
     nothing has no dialogs either. A vacuous pass is worse than a failure: it
     reports coverage that was never there. */
  const rendered = await evaluate(`(() => {
    const main = document.querySelector('main');
    return {
      title: main ? (main.querySelector('h1') || {}).textContent || '' : '',
      denied: document.body.textContent.includes('لا تملكين') || document.querySelectorAll('.state').length > 0,
      hasContent: main ? main.textContent.trim().length > 60 : false,
    };
  })()`);
  check(
    `0 · ${label} — the page itself rendered (${rendered.title.trim().slice(0, 28)})`,
    rendered.hasContent === true && rendered.title.trim().length > 0,
    JSON.stringify(rendered),
  );

  const atLoad = await dialogState();

  check(
    `A · ${label} — no dialog is visible on load (${atLoad.mounted} mounted)`,
    atLoad.visibleClosed.length === 0 && atLoad.open === 0,
    JSON.stringify({ visibleClosed: atLoad.visibleClosed, open: atLoad.open }),
  );

  // Only pages that HAVE a trigger go on to the open/close cycle; a page with
  // none is still worth the check above, and saying so beats a silent skip.
  const opened = await openFirst();
  if (opened.noTrigger) {
    check(`B · ${label} — no add/edit trigger on this page, open cycle not applicable`, true, 'n/a');
    continue;
  }

  const whileOpen = await dialogState();
  check(
    `B · ${label} — exactly one dialog opens, as a modal in the top layer`,
    whileOpen.open === 1 && whileOpen.openBox?.hasBackdrop === true,
    JSON.stringify(whileOpen.openBox),
  );
  check(
    `C · ${label} — the page beneath does not grow to make room for it`,
    Math.abs(whileOpen.pageHeight - atLoad.pageHeight) <= 1,
    `${atLoad.pageHeight} → ${whileOpen.pageHeight}`,
  );
  // 13 — the single-scroll fix must survive this repair.
  const shell = whileOpen.scrollers.filter((s) => !s.cls.includes('select__options'));
  check(
    `D · ${label} — at most one shell scroller, and it is the body`,
    shell.length <= 1 && (shell.length === 0 || shell[0].cls.includes('dialog__body')),
    JSON.stringify(whileOpen.scrollers),
  );

  await closeOpen();
  const afterClose = await dialogState();
  check(
    `E · ${label} — closing removes it from the page entirely`,
    afterClose.open === 0 && afterClose.visibleClosed.length === 0,
    JSON.stringify(afterClose.visibleClosed),
  );
  check(
    `F · ${label} — and the layout underneath is exactly where it was`,
    afterClose.pageHeight === atLoad.pageHeight,
    `${atLoad.pageHeight} → ${afterClose.pageHeight}`,
  );

  const reopened = await openFirst();
  const again = await dialogState();
  check(
    `G · ${label} — it reopens`,
    !reopened.noTrigger && again.open === 1,
    JSON.stringify({ open: again.open }),
  );
  await closeOpen();
}

close();
process.exit(finish());
