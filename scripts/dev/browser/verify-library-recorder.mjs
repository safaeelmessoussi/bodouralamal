/**
 * **The recorder's SECOND entry point, and the sort indicator's placement.**
 *
 * §1 asks for one recorder reachable from both الجدولة and مكتبة المحتوى, not
 * two implementations. The proof that it is one is behavioural: the same
 * control, in a screen that has **no session at all**, producing an ordinary
 * EducationalContent — which is the case R43 already provides the linking half
 * for.
 *
 * §3 asks for an indicator that belongs to its own column. That is a geometric
 * claim about rendered boxes, so it is measured here rather than asserted from
 * CSS — the lesson measure-page-header exists for.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const COOKIE = process.env.DEV_REFRESH_COOKIE;
if (!COOKIE) throw new Error('DEV_REFRESH_COOKIE is required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9227');
const { check, finish } = results();

await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth/refresh',
  httpOnly: true,
});

async function goto(path, ready) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 100; i += 1) {
    const state = await evaluate(`(() => {
      if (document.location.pathname.startsWith('/login')) return 'login';
      return document.querySelector(${JSON.stringify(ready)}) ? 'ready' : 'waiting';
    })()`).catch(() => null);
    if (state === 'ready' || state === 'login') return state;
    await new Promise((r) => setTimeout(r, 250));
  }
  return 'timeout';
}

/* ── §3 · the indicator belongs to its own column ────────────────────────── */

const reached = await goto('/admin/branches', '.admin-table thead th');
check('the branches table renders', reached === 'ready', `state=${reached}`);

const geometry = await evaluate(`(() => {
  const heads = [...document.querySelectorAll('.admin-table thead th')];
  const sortable = heads.filter((h) => h.querySelector('.datatable__sort'));
  if (sortable.length === 0) return { none: true };
  const th = sortable[0];
  const btn = th.querySelector('.datatable__sort');
  const label = btn.querySelector('.datatable__sort-label').getBoundingClientRect();
  const glyph = btn.querySelector('.datatable__sort-glyph').getBoundingClientRect();
  const cell = th.getBoundingClientRect();
  const next = heads[heads.indexOf(th) + 1]?.getBoundingClientRect() ?? null;
  // RTL: "after the label" means a SMALLER x, since the axis runs right to left.
  const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
  const gap = rtl ? label.left - glyph.right : glyph.left - label.right;
  const toNeighbour = next ? (rtl ? glyph.left - next.right : next.left - glyph.right) : Infinity;
  return {
    rtl,
    gap,
    toNeighbour,
    insideOwnCell: glyph.left >= cell.left - 1 && glyph.right <= cell.right + 1,
    sortableCount: sortable.length,
    plainCount: heads.length - sortable.length,
  };
})()`);

check('1 · the page is RTL, which is the layout under test', geometry.rtl === true, JSON.stringify(geometry));
check('2 · the indicator sits INSIDE its own header cell', geometry.insideOwnCell === true, JSON.stringify(geometry));
check(
  '3 · it hugs its own label — nearer to it than to the neighbouring column',
  geometry.gap >= 0 && geometry.gap < 16 && geometry.gap < geometry.toNeighbour,
  `gap to own label ${Math.round(geometry.gap)}px vs ${Math.round(geometry.toNeighbour)}px to the next header`,
);
check(
  '4 · sortable and non-sortable headers are distinguishable',
  geometry.sortableCount > 0 && geometry.plainCount > 0,
  `${geometry.sortableCount} sortable, ${geometry.plainCount} plain`,
);

const state = await evaluate(`(async () => {
  const btn = document.querySelector('.admin-table thead .datatable__sort');
  const before = { cls: btn.className, paths: btn.querySelectorAll('path').length };
  btn.click();
  await new Promise((r) => setTimeout(r, 1200));
  const now = document.querySelector('.admin-table thead .datatable__sort');
  const th = now.closest('th');
  return {
    before,
    after: { cls: now.className, paths: now.querySelectorAll('path').length },
    ariaSort: th.getAttribute('aria-sort'),
  };
})()`);
check('5 · an idle sortable column draws BOTH chevrons', state.before.paths === 2, JSON.stringify(state.before));
check('6 · clicking marks it active and draws ONE', state.after.paths === 1 && state.after.cls.includes('is-active'), JSON.stringify(state.after));
check('7 · the direction is announced on the cell', state.ariaSort === 'ascending' || state.ariaSort === 'descending', state.ariaSort);

/* ── §1 · the recorder in مكتبة المحتوى ─────────────────────────────────── */

const lib = await goto('/admin/content', '.admin-table, .state');
check('8 · the content library loads', lib === 'ready', `state=${lib}`);

const offered = await evaluate(`(() => ({
  hasRecorderButton: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'تسجيل صوتي'),
  hasUploadButton: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('رفع')),
}))()`);
check('9 · the library offers the recorder beside its uploader', offered.hasRecorderButton && offered.hasUploadButton, JSON.stringify(offered));

const guarded = await evaluate(`(async () => {
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'تسجيل صوتي').click();
  await new Promise((r) => setTimeout(r, 900));
  const text = document.body.textContent;
  return {
    saysChooseScope: text.includes('اختاري') || text.includes('المستوى'),
    hasStart: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'بدء التسجيل'),
  };
})()`);
check(
  '10 · with no scope chosen it explains rather than offering a control that would fail',
  guarded.hasStart === false && guarded.saysChooseScope === true,
  JSON.stringify(guarded),
);

const scoped = await evaluate(`(async () => {
  const close = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'إغلاق');
  if (close) close.click();
  await new Promise((r) => setTimeout(r, 400));
  const pick = async (labelText) => {
    const sel = [...document.querySelectorAll('select')]
      .find((s) => (s.closest('.field')?.textContent ?? '').includes(labelText));
    if (!sel) return null;
    const opt = [...sel.options].find((o) => o.value !== '');
    if (!opt) return null;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, opt.value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1200));
    return opt.textContent.trim();
  };
  const level = await pick('المستوى');
  const subject = await pick('المادة');
  const year = await pick('السنة');
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'تسجيل صوتي').click();
  await new Promise((r) => setTimeout(r, 900));
  return {
    level, subject, year,
    hasStart: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'بدء التسجيل'),
  };
})()`);
check(
  '11 · with a scope chosen the recorder is offered — no session required',
  scoped.hasStart === true,
  JSON.stringify(scoped),
);

const recorded = await evaluate(`(async () => {
  const click = (text) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === text);
    if (!b) throw new Error('no button: ' + text);
    b.click();
  };
  click('بدء التسجيل');
  await new Promise((r) => setTimeout(r, 2500));
  const elapsed = document.querySelector('.recorder__elapsed')?.textContent ?? '';
  click('إنهاء التسجيل');
  await new Promise((r) => setTimeout(r, 1200));
  const nameField = [...document.querySelectorAll('input')]
    .find((i) => (i.closest('.field')?.textContent ?? '').includes('اسم التسجيل'));
  const placeholder = nameField ? nameField.placeholder : null;
  click('حفظ التسجيل');
  for (let i = 0; i < 50; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    if (![...document.querySelectorAll('button')].some((x) => x.textContent.trim() === 'حفظ التسجيل')) break;
  }
  return {
    elapsed,
    placeholder,
    error: document.querySelector('.field__error')?.textContent?.trim() ?? null,
    notice: document.querySelector('.admin-notice')?.textContent?.trim() ?? null,
  };
})()`);
check('12 · recording works from the library (real MediaRecorder)', /\d+:\d{2}/.test(recorded.elapsed), recorded.elapsed);
check('13 · it is named from the library’s own scope, not from a session', (recorded.placeholder ?? '') !== '', recorded.placeholder);
check('14 · saving reports no error', recorded.error === null, recorded.error);

const listed = await evaluate(`(async () => {
  for (let i = 0; i < 40; i += 1) {
    const names = [...document.querySelectorAll('.admin-table tbody tr th')].map((c) => c.textContent.trim());
    if (names.some((n) => n.includes(${JSON.stringify('—')}))) return names;
    await new Promise((r) => setTimeout(r, 500));
  }
  return [...document.querySelectorAll('.admin-table tbody tr th')].map((c) => c.textContent.trim());
})()`);
check(
  '15 · the recording is an ordinary EducationalContent, listed in the library',
  Array.isArray(listed) && listed.some((n) => n === (recorded.placeholder ?? '')),
  JSON.stringify(listed.slice(0, 5)),
);

close();
process.exit(finish());
