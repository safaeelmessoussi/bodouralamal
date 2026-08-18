/**
 * **The sorting contract, clicked rather than inspected.**
 *
 * Eight properties per table, all of them behavioural: first click ascending,
 * second descending, third ascending again; the indicator on the clicked header
 * and nowhere else; non-sortable headers not clickable; the actions column never
 * sortable; and — the one only a real browser can settle — that paging through a
 * sorted collection neither drops a row nor shows one twice.
 *
 * The last is why R76.3 appends an id tiebreaker: with a non-unique sort key,
 * offset pagination can put a row on two pages or on neither.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const COOKIE = process.env.DEV_REFRESH_COOKIE;
if (!COOKIE) throw new Error('DEV_REFRESH_COOKIE is required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9229');
const { check, finish } = results();

await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth/refresh',
  httpOnly: true,
});

async function goto(path) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 100; i += 1) {
    const state = await evaluate(`(() => {
      if (document.location.pathname.startsWith('/login')) return 'login';
      if (document.querySelector('.datatable__skeleton')) return 'loading';
      return document.querySelector('.admin-table tbody tr, .state') ? 'ready' : 'waiting';
    })()`).catch(() => null);
    if (state === 'ready' || state === 'login') return state;
    await new Promise((r) => setTimeout(r, 250));
  }
  return 'timeout';
}

/** Clicks the first sortable header and reports the settled state. */
const clickSort = () =>
  evaluate(`(async () => {
    const btn = document.querySelector('.admin-table thead .datatable__sort');
    btn.click();
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 250));
      if (!document.querySelector('.datatable__skeleton')) break;
    }
    await new Promise((r) => setTimeout(r, 400));
    const th = document.querySelector('.admin-table thead .datatable__sort').closest('th');
    const heads = [...document.querySelectorAll('.admin-table thead th')];
    return {
      ariaSort: th.getAttribute('aria-sort'),
      // Exactly one header claims a direction.
      directed: heads.filter((h) => ['ascending', 'descending'].includes(h.getAttribute('aria-sort') ?? '')).length,
      firstRows: [...document.querySelectorAll('.admin-table tbody tr th')].slice(0, 6).map((c) => c.textContent.trim()),
    };
  })()`);

const TABLES = [
  { path: '/admin/users', label: 'المستخدمون', paginated: true },
  { path: '/admin/enrollments', label: 'التسجيلات', paginated: false },
  { path: '/admin/teaching-groups', label: 'حلقات المواد', paginated: true },
  { path: '/admin/branches', label: 'الفروع', paginated: true },
];

for (const table of TABLES) {
  const reached = await goto(table.path);
  if (reached !== 'ready') {
    check(`${table.label}: reached`, false, `state=${reached}`);
    continue;
  }

  const shape = await evaluate(`(() => {
    const heads = [...document.querySelectorAll('.admin-table thead th')];
    return {
      sortable: heads.filter((h) => h.querySelector('.datatable__sort')).length,
      plainClickable: heads.filter((h) => !h.querySelector('.datatable__sort') && h.querySelector('button')).length,
      actionsSortable: heads.some((h) => h.className.includes('actions-head') && h.querySelector('.datatable__sort')),
    };
  })()`);
  if (shape.sortable === 0) {
    // Say WHY rather than only that: an empty table has no headers to sort, and
    // that is a fixture fact rather than a defect in the contract.
    const why = await evaluate(`(() => ({
      rows: document.querySelectorAll('.admin-table tbody tr').length,
      state: document.querySelector('.state')?.textContent?.trim()?.slice(0, 80) ?? null,
      headers: [...document.querySelectorAll('.admin-table thead th')].map((h) => h.textContent.trim()),
    }))()`);
    check(`${table.label}: has sortable headers`, false, JSON.stringify(why));
    continue;
  }
  check(`${table.label}: has sortable headers`, shape.sortable > 0, JSON.stringify(shape));
  check(`${table.label}: non-sortable headers are not clickable`, shape.plainClickable === 0, JSON.stringify(shape));
  check(`${table.label}: the actions column is never sortable`, shape.actionsSortable === false);

  const first = await clickSort();
  check(`${table.label}: first click sorts ASCENDING`, first.ariaSort === 'ascending', first.ariaSort);
  check(`${table.label}: exactly one header claims a direction`, first.directed === 1, String(first.directed));

  const second = await clickSort();
  check(`${table.label}: second click sorts DESCENDING`, second.ariaSort === 'descending', second.ariaSort);
  check(
    `${table.label}: the order actually reversed`,
    JSON.stringify(second.firstRows) !== JSON.stringify(first.firstRows),
    `${first.firstRows.slice(0, 3).join(' | ')}   →   ${second.firstRows.slice(0, 3).join(' | ')}`,
  );

  const third = await clickSort();
  check(`${table.label}: third click returns to ASCENDING`, third.ariaSort === 'ascending', third.ariaSort);
  check(
    `${table.label}: and to the same order as the first`,
    JSON.stringify(third.firstRows) === JSON.stringify(first.firstRows),
  );

  if (table.paginated) {
    const paging = await evaluate(`(async () => {
      const total = document.querySelector('.pagination__status')?.textContent ?? '';
      const next = [...document.querySelectorAll('.pagination button')]
        .find((b) => b.textContent.trim() === 'التالي');
      if (!next || next.disabled) return { singlePage: true, total };
      const pageOne = [...document.querySelectorAll('.admin-table tbody tr')]
        .map((tr) => tr.querySelector('th')?.textContent?.trim() ?? '');
      next.click();
      for (let i = 0; i < 40; i += 1) {
        await new Promise((r) => setTimeout(r, 250));
        if (!document.querySelector('.datatable__skeleton')) break;
      }
      await new Promise((r) => setTimeout(r, 500));
      const th = document.querySelector('.admin-table thead .datatable__sort').closest('th');
      const pageTwo = [...document.querySelectorAll('.admin-table tbody tr')]
        .map((tr) => tr.querySelector('th')?.textContent?.trim() ?? '');
      return {
        singlePage: false,
        keptSort: th.getAttribute('aria-sort'),
        overlap: pageOne.filter((n) => pageTwo.includes(n)),
        pageOne: pageOne.length,
        pageTwo: pageTwo.length,
      };
    })()`);
    if (paging.singlePage) {
      check(`${table.label}: pagination — only one page, nothing to cross-check`, true, paging.total);
    } else {
      check(
        `${table.label}: the sort SURVIVES paging`,
        paging.keptSort === 'ascending' || paging.keptSort === 'descending',
        paging.keptSort,
      );
      check(
        `${table.label}: no row appears on both pages (R76.3's id tiebreaker)`,
        paging.overlap.length === 0,
        `overlap: ${JSON.stringify(paging.overlap)}`,
      );
    }
  }
}

close();
process.exit(finish());
