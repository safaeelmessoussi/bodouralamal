/**
 * **طلبات الانضمام actually reorders** — NEW C's owed proof, clicked.
 *
 * The sorting contract was verified on four tables and this one was left open,
 * because the queue is *pending registrations* and a healthy development
 * database has none to sort. `approvals-fixture.ts` creates three, tagged and
 * owned by this scenario, whose **alphabetical order and submission order are
 * different lists** — أ/ب/ج by name, ج/ب/أ by submission. That is the point: a
 * screen that dropped the sort parameter and returned its default would satisfy
 * one of the two assertions and fail the other, where a single-column check
 * would have passed and proved nothing.
 *
 * Assertions are on the **relative order of the three tagged rows**, never on
 * the whole table: the queue may legitimately hold other applicants, and a
 * harness that demanded an exact table would fail for a reason that is not a
 * defect.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const COOKIE = process.env.DEV_REFRESH_COOKIE;
if (!COOKIE) throw new Error('DEV_REFRESH_COOKIE is required');
const TAG = '[cnew-approvals]';

const { send, evaluate, close } = await connect(process.env.PORT ?? '9228');
const { check, finish } = results();

await send('Network.setCookie', {
  name: 'bodour_refresh',
  value: COOKIE,
  domain: 'localhost',
  path: '/api/v1/auth',
  httpOnly: true,
});

async function goto(path) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 100; i += 1) {
    const state = await evaluate(`(() => {
      if (document.location.pathname.startsWith('/login')) return 'login';
      if (document.querySelector('.datatable__skeleton, .state[role="status"]')) return 'loading';
      return document.querySelector('.admin-table tbody tr, .state') ? 'ready' : 'waiting';
    })()`).catch(() => null);
    if (state === 'ready' || state === 'login') return state;
    await new Promise((r) => setTimeout(r, 250));
  }
  return 'timeout';
}

/**
 * Clicks the header whose label matches, waits for the refetch to settle, and
 * returns this scenario's rows **in the order the table now shows them**.
 */
const sortBy = (label) =>
  evaluate(`(async () => {
    const heads = [...document.querySelectorAll('.admin-table thead th')];
    const th = heads.find((h) => h.textContent.includes(${JSON.stringify(label)}));
    if (!th) return { error: 'no such header: ' + ${JSON.stringify(label)} };
    const btn = th.querySelector('.datatable__sort');
    if (!btn) return { error: 'header is not sortable: ' + ${JSON.stringify(label)} };
    btn.click();
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 250));
      if (!document.querySelector('.datatable__skeleton')) break;
    }
    await new Promise((r) => setTimeout(r, 400));
    const after = [...document.querySelectorAll('.admin-table thead th')]
      .find((h) => h.textContent.includes(${JSON.stringify(label)}));
    return {
      ariaSort: after.getAttribute('aria-sort'),
      // Only this scenario's rows, in the table's current order.
      mine: [...document.querySelectorAll('.admin-table tbody tr')]
        .map((tr) => tr.textContent)
        .filter((text) => text.includes(${JSON.stringify(TAG)}))
        .map((text) => {
          const m = text.match(/\\[cnew-approvals\\]\\s*(\\S+)/);
          return m ? m[1] : '?';
        }),
    };
  })()`);

const reached = await goto('/admin/approvals');
check('طلبات الانضمام: reached', reached === 'ready', `state=${reached}`);

if (reached === 'ready') {
  const seeded = await evaluate(
    `[...document.querySelectorAll('.admin-table tbody tr')].filter((tr) => tr.textContent.includes(${JSON.stringify(TAG)})).length`,
  );
  check('the three scenario applicants are on the queue', seeded === 3, `found ${seeded}`);

  const nameAsc = await sortBy('المعنيّون بالطلب');
  check(
    'المعنيّون بالطلب ascending orders by name (أ ب ج)',
    !nameAsc.error && nameAsc.ariaSort === 'ascending' && nameAsc.mine.join('') === 'أبج',
    nameAsc.error ?? `aria-sort=${nameAsc.ariaSort} order=${nameAsc.mine.join('،')}`,
  );

  const nameDesc = await sortBy('المعنيّون بالطلب');
  check(
    'a second click reverses it (ج ب أ)',
    !nameDesc.error && nameDesc.ariaSort === 'descending' && nameDesc.mine.join('') === 'جبأ',
    nameDesc.error ?? `aria-sort=${nameDesc.ariaSort} order=${nameDesc.mine.join('،')}`,
  );

  // The independent list. Oldest first is ج (3 days ago) → أ (2) → ب (1), which
  // is neither the ascending name list (أ ب ج) nor its reverse — so the sort
  // parameter is demonstrably load-bearing here rather than incidentally
  // satisfied by a default the server would have returned anyway.
  const submittedAsc = await sortBy('تاريخ الإرسال');
  check(
    'تاريخ الإرسال ascending orders oldest-first (ج أ ب), a DIFFERENT list',
    !submittedAsc.error &&
      submittedAsc.ariaSort === 'ascending' &&
      submittedAsc.mine.join('') === 'جأب',
    submittedAsc.error ?? `aria-sort=${submittedAsc.ariaSort} order=${submittedAsc.mine.join('،')}`,
  );

  const submittedDesc = await sortBy('تاريخ الإرسال');
  check(
    'and reverses to newest-first (ب أ ج)',
    !submittedDesc.error &&
      submittedDesc.ariaSort === 'descending' &&
      submittedDesc.mine.join('') === 'بأج',
    submittedDesc.error ?? `aria-sort=${submittedDesc.ariaSort} order=${submittedDesc.mine.join('،')}`,
  );

  // Exactly one header claims a direction at a time.
  const directed = await evaluate(
    `[...document.querySelectorAll('.admin-table thead th')].filter((h) => ['ascending','descending'].includes(h.getAttribute('aria-sort') ?? '')).length`,
  );
  check('exactly one header claims a direction', directed === 1, `${directed} directed`);
}

await close();
process.exit(finish());
