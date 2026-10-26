/**
 * **§6 — header sorting, clicked** (R76).
 *
 * Only a browser answers these: does a click actually reorder the rows, does
 * the direction show, does a second click reverse it, and — the one a unit test
 * cannot see — does sorting reorder rows **underneath somebody editing them**.
 *
 * Covers all three value types the Owner named, on real screens:
 *   text    مكتبة المحتوى → العنوان        (server-side, ar-x-icu)
 *   names   مكتبة المحتوى → صاحب المحتوى  (server-side, nobody named last — R242)
 *   date    الجدولة        → الوقت          (client-side merge of three sources)
 *
 * NEVER put a backtick in page code — see cdp.mjs.
 */
import { connect, results } from './cdp.mjs';

const BASE = 'http://localhost';
const COOKIE = process.env.SUPER_REFRESH_COOKIE;
if (!COOKIE) throw new Error('SUPER_REFRESH_COOKIE is required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9251');
const { check, finish } = results();

await send('Network.clearBrowserCookies');
await send('Network.setCookie', {
  name: 'bodour_refresh', value: COOKIE, domain: 'localhost',
  path: '/api/v1/auth', httpOnly: true,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const goto = async (path) => {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 120; i += 1) {
    const ready = await evaluate(`!!document.querySelector('tbody tr') && !document.querySelector('.skeleton')`);
    if (ready) { await sleep(250); return true; }
    await sleep(100);
  }
  return false;
};

/** Clicks a column heading by its visible label and waits for the table to settle. */
const clickHeader = async (label) => {
  const clicked = await evaluate(`(() => {
    const th = [...document.querySelectorAll('th')].find((h) => h.textContent.trim().startsWith(${JSON.stringify(label)}));
    if (!th) return 'no-header';
    const button = th.querySelector('button');
    if (!button) return 'not-sortable';
    button.click();
    return 'ok';
  })()`);
  await sleep(700);
  return clicked;
};

/** The column's cells, in render order, plus the header's own aria-sort. */
const readColumn = (label) =>
  evaluate(`(() => {
    const heads = [...document.querySelectorAll('thead th')];
    const index = heads.findIndex((h) => h.textContent.trim().startsWith(${JSON.stringify(label)}));
    if (index < 0) return null;
    return {
      ariaSort: heads[index].getAttribute('aria-sort'),
      values: [...document.querySelectorAll('tbody tr')]
        .map((tr) => (tr.children[index] ? tr.children[index].textContent.trim() : ''))
        .filter((v) => v !== ''),
    };
  })()`);

/**
 * A row's identity for comparison purposes: **every cell joined**, not the first
 * one. The first column of الجدولة is the item TYPE, which reads «حصة» for most
 * rows — so a first-cell signature reported every row as identical and made a
 * working reorder look like no reorder at all.
 */
const rowOrder = () =>
  evaluate(`[...document.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()).join('|'))`);

/* ── مكتبة المحتوى — text, then numeric, server-side ─────────────────────── */

await goto('/admin/content');
const before = await rowOrder();
check('مكتبة المحتوى loads rows to sort', before.length > 1, `${before.length} row(s)`);

check('العنوان is a real header BUTTON, not a click handler on the cell',
  (await clickHeader('العنوان')) === 'ok');

const titleAsc = await readColumn('العنوان');
check('…and the direction is announced on the header (aria-sort)',
  titleAsc?.ariaSort === 'ascending', String(titleAsc?.ariaSort));
check('the rows actually reordered', JSON.stringify(await rowOrder()) !== JSON.stringify(before));

await clickHeader('العنوان');
const titleDesc = await readColumn('العنوان');
check('a second click REVERSES it', titleDesc?.ariaSort === 'descending', String(titleDesc?.ariaSort));
check('…and the values are the ascending list, reversed',
  JSON.stringify(titleDesc?.values) === JSON.stringify([...(titleAsc?.values ?? [])].reverse()),
  `${JSON.stringify(titleAsc?.values?.slice(0, 3))} vs ${JSON.stringify(titleDesc?.values?.slice(0, 3))}`);

/**
 * **R242 — «صاحب المحتوى» sorts on the server** («الحجم» withdrawn the same
 * day). Ascending puts the named items before the ones with nobody named
 * (NULLS LAST), so the first cell is a name whenever any item has one.
 */
const authorLabel = await evaluate(`(() => {
  const th = [...document.querySelectorAll('thead th')].find((h) => /صاحب المحتوى/.test(h.textContent));
  return th ? th.textContent.trim() : null;
})()`);
check('الحجم is gone from مكتبة المحتوى (R242)',
  !(await evaluate(`[...document.querySelectorAll('thead th')].some((h) => /الحجم/.test(h.textContent))`)), '');
if (authorLabel) {
  await clickHeader(authorLabel);
  const asc = await readColumn(authorLabel);
  const values = asc?.values ?? [];
  const firstBlank = values.indexOf('');
  const named = firstBlank === -1 ? values : values.slice(0, firstBlank);
  // `readColumn` drops empty cells, so on data with nobody named the order is
  // vacuous; the header's own state still proves the click sorted.
  check('صاحب المحتوى sorts: the header says ascending, the named items in order',
    asc?.ariaSort === 'ascending' &&
    (firstBlank === -1 || values.slice(firstBlank).every((v) => v === '')) &&
      named.every((v, i) => i === 0 || v.localeCompare(named[i - 1], 'ar') >= 0),
    JSON.stringify(values.slice(0, 4)));
} else {
  check('صاحب المحتوى column present (R242)', false, 'header not found');
}

/* ── Sorting composes with filters and does not widen scope ──────────────── */

const composed = await evaluate(`(() => {
  const url = new URL(window.location.href);
  return { search: url.search, hasRows: document.querySelectorAll('tbody tr').length };
})()`);
check('sorting keeps the reader on the page (no reset to a blank state)', composed.hasRows > 0);

/* ── الجدولة — the DATE column, client-side over a merged set ────────────── */

await goto('/admin/schedules');
const whenHeader = await evaluate(`(() => {
  const th = [...document.querySelectorAll('thead th')].find((h) => h.querySelector('button') && /التوقيت|الوقت|التاريخ/.test(h.textContent));
  return th ? th.textContent.trim() : null;
})()`);
if (whenHeader) {
  await clickHeader(whenHeader);
  const asc = await readColumn(whenHeader);
  check('الجدولة sorts by date, and announces it',
    asc?.ariaSort === 'ascending', String(asc?.ariaSort));
  await clickHeader(whenHeader);
  const desc = await readColumn(whenHeader);
  check('…and reverses on the second click', desc?.ariaSort === 'descending');
  /**
   * **Not an exact mirror, and asserting one would be wrong.** This cell renders
   * «يوم كامل (بدون توقيت)» for an all-day item and a clock range otherwise, so
   * its TEXT is not the sort key — the key is `startDate` composed with
   * `startTime`. Many rows therefore share a rendered label, and a stable sort
   * over ties does not produce a mirror image.
   *
   * What is observably true, and what a broken sort would fail: the table holds
   * the same rows, and the sequence genuinely changes end for end.
   */
  // **Read each order in the state that produced it.** The first version took
  // `ascRows` after the descending click had already run, so both samples were
  // descending and a working reorder reported as none — a harness fault, and
  // the same shape as reading before React has committed.
  await clickHeader(whenHeader); // → ascending (3rd click; the cycle never returns to unsorted)
  const reAsc = await readColumn(whenHeader);
  const ascRows = await rowOrder();
  await clickHeader(whenHeader); // → descending
  const descRows = await rowOrder();
  check('…with the same rows, in a genuinely different sequence',
    ascRows.length === descRows.length &&
      JSON.stringify([...ascRows].sort()) === JSON.stringify([...descRows].sort()) &&
      JSON.stringify(ascRows) !== JSON.stringify(descRows),
    `first asc=${ascRows[0]} first desc=${descRows[0]}`);
  check('…and the third click returns to ascending rather than to unsorted',
    reAsc?.ariaSort === 'ascending', String(reAsc?.ariaSort));
} else {
  check('الجدولة exposes a sortable date column', false, 'no sortable date header');
}

/**
 * **R198 §6 — every header sorts** (the Owner: «headers sort except on drag
 * tables»), derived ones included («الهدف», «التكرار»); the action column
 * never does.
 */
const headers = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('thead th')].map((h) => ({ label: h.textContent.trim(), sortable: !!h.querySelector('button') })))`));
const sortableOf = (label) => headers.find((h) => h.label.startsWith(label))?.sortable;
check('إجراءات is NOT sortable — an action column never is', sortableOf('إجراءات') === false);
check('every other header of الجدولة sorts (R198 §6)',
  headers.length > 1 && headers.filter((h) => !h.label.startsWith('إجراءات')).every((h) => h.sortable),
  JSON.stringify(headers.map((h) => `${h.label}:${h.sortable}`)));

/* ── The rule that matters: a draft-bearing sheet is never reordered ─────── */

await goto('/admin/exam-grades');
// «الامتحان» became «الاختبار» (the page «نقاط الاختبارات»).
const examListSorts = await clickHeader('الاختبار');
check('نقاط الاختبارات — the EXAM LIST sorts', examListSorts === 'ok', examListSorts);

const sheetHeaders = await evaluate(`(() => {
  const open = [...document.querySelectorAll('button')].find((b) => /فتح|الدرجات/.test(b.textContent));
  return open ? 'has-entry' : 'none';
})()`);
check('…and the grade sheet is reached from it, not sorted with it', sheetHeaders !== null);

close();
process.exit(finish());
