/**
 * **The public calendar's two views, driven anonymously.**
 *
 * Anonymously on purpose: §4.4 (R43) makes the timetable public at the caller's
 * tier, and the thing to prove is both that the public reader *sees the classes*
 * and that they see **nothing more** — no private content, no recordings, no
 * student names, no notification state.
 *
 * The cancellation half is driven with an ADMIN session in a second pass, then
 * read back anonymously: a cancelled occurrence must stay on the public calendar
 * and say so.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.SCENARIO ?? '{}');
const COOKIE = process.env.DEV_REFRESH_COOKIE;

const { send, evaluate, close } = await connect(process.env.PORT ?? '9230');
const { check, finish } = results();

async function anonymous() {
  await send('Network.clearBrowserCookies');
}

async function asAdmin() {
  await send('Network.setCookie', {
    name: 'bodour_refresh',
    value: COOKIE,
    domain: 'localhost',
    path: '/api/v1/auth',
    httpOnly: true,
  });
}

async function goto(path) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 100; i += 1) {
    /**
     * **`.cal-header`, restated 2026-08-19.** This waited on `.cal-toolbar`,
     * which R84 retired when the filter row and the view switch moved into the
     * ONE shared calendar header (rule AJ). The page had been loading correctly
     * for weeks; the harness was waiting for a class nothing renders any more,
     * timed out, and reported the load as a failure while the very next check
     * found the month controls it needed. **The property is unchanged and the
     * selector is** — a guard that fails because the code changed shape is
     * restated, never deleted.
     */
    const ready = await evaluate(`(() => document.querySelector('.cal-header') !== null)()`).catch(
      () => false,
    );
    if (ready) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const api = (path) =>
  evaluate(`(async () => {
    const r = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: '{}',
    });
    const { access_token } = await r.json();
    const res = await fetch(${JSON.stringify('/api/v1')} + ${JSON.stringify(path)}, {
      headers: { Authorization: 'Bearer ' + access_token },
    });
    return { status: res.status, body: await res.text() };
  })()`);

/* ── the two views exist and switch, anonymously ─────────────────────────── */

await anonymous();
const reached = await goto('/calendar');
check('the public calendar loads with no session at all', reached === true);

const views = await evaluate(`(() => {
  const tabs = [...document.querySelectorAll('.cal-segmented [role="tab"]')].map((b) => ({
    label: b.textContent.trim(),
    selected: b.getAttribute('aria-selected'),
  }));
  return {
    tabs,
    hasGrid: document.querySelector('.calendar-grid, table') !== null,
    hasNav: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'اليوم'),
  };
})()`);
check('1 · both قائمة and تقويم are offered', (views.tabs ?? []).length === 2, JSON.stringify(views.tabs));
check('2 · تقويم is the public default, and the grid is rendered', views.hasGrid === true && views.tabs.some((t) => t.selected === 'true'), JSON.stringify(views));
check('3 · السابق/اليوم/التالي remain available in the calendar view', views.hasNav === true);

/**
 * **قائمة is the shared `OccurrenceTable`, restated 2026-08-19.**
 *
 * This read `.occurrence-list` / `.occurrence-list__item` — the page's own
 * hand-rolled markup, which **R84 replaced with the platform's `DataTable`** so
 * the list would finally have empty, error and retry states (rule AL, *قائمة is
 * a table everywhere*). The rendering rule is unchanged and the selector is.
 */
const list = await evaluate(`(async () => {
  const tab = [...document.querySelectorAll('.cal-segmented [role="tab"]')]
    .find((b) => b.textContent.trim() === 'قائمة');
  tab.click();
  await new Promise((r) => setTimeout(r, 1500));
  return {
    url: window.location.search,
    hasList: document.querySelector('.admin-table') !== null,
    hasGrid: document.querySelector('.calendar-grid') !== null,
    monthNav: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'اليوم'),
    items: [...document.querySelectorAll('.admin-table tbody tr')].length,
    first: document.querySelector('.admin-table tbody tr')?.textContent?.trim()?.slice(0, 90) ?? null,
  };
})()`);
check('4 · قائمة renders the shared occurrence table', list.hasList === true, JSON.stringify(list));
check('5 · the chosen view is in the URL, so a reload and a shared link keep it', list.url.includes('view=list'), list.url);
/**
 * **Inverted 2026-08-19 — the property itself changed, and the reason is
 * recorded rather than the check deleted.** It asserted stepping was *withheld*
 * in the list. R84 established that the public, beneficiary and مؤطرة lists are
 * *this month's occurrences*, so stepping is exactly how a reader moves through
 * them; only the back office's list — a table of recurring definitions with no
 * month at all — omits it, and it does so by passing no month.
 */
check('6 · month stepping REMAINS in the list, which is month-scoped', list.monthNav === true);
check('7 · the list carries occurrences with their date and time', list.items > 0, list.first);

/**
 * **The direction, and that the table reads with it.** The old check measured a
 * `border-inline-start` marker on the hand-rolled row; that row no longer
 * exists. What survives the change is the property worth pinning: the document
 * is RTL and the table's first cell sits at the inline start, which is what an
 * `.occurrence-list__item` border was standing in for.
 */
const rtl = await evaluate(`(() => {
  const row = document.querySelector('.admin-table tbody tr');
  if (!row) return { none: true };
  // **Cell against cell, not cell against container.** Measuring the first cell
  // against the table's own box compared it with a scroll container whose edge
  // is not the row's; comparing the first and last cells asks the question
  // directly — in RTL the first column is the RIGHTMOST one.
  const cells = [...row.querySelectorAll('td')];
  const first = cells[0];
  const last = cells[cells.length - 1];
  return {
    dir: getComputedStyle(document.documentElement).direction,
    columns: cells.length,
    firstCellAtStart:
      cells.length > 1 &&
      first.getBoundingClientRect().right > last.getBoundingClientRect().right,
  };
})()`);
check('8 · RTL, and the table reads from the inline start', rtl.dir === 'rtl' && rtl.firstCellAtStart === true, JSON.stringify(rtl));

/* ── what a public reader must NOT see ───────────────────────────────────── */

const leak = await evaluate(`(() => {
  const text = document.body.textContent ?? '';
  return {
    // The seeded student and the private recording titles must not appear.
    student: text.includes('مستفيدة مسجّلة'),
    notifications: document.querySelector('#notifications-heading') !== null,
    recordings: text.includes('التسجيلات'),
  };
})()`);
check('9 · no student name on the public calendar', leak.student === false, JSON.stringify(leak));
check('10 · no notification surface for an anonymous reader', leak.notifications === false);
check('11 · no recordings section', leak.recordings === false);

/* ── a cancelled occurrence stays visible, and says so ───────────────────── */

await asAdmin();
await goto('/calendar');
const target = JSON.parse(
  (await api(`/admin/course-schedules/${S.scheduleId}/sessions?page=1&page_size=100`)).body || '{}',
);
const today = new Date().toISOString().slice(0, 10);
const upcoming = (target.data ?? [])
  .filter((r) => r.status === 'scheduled' && r.date > today)
  .sort((a, b) => a.date.localeCompare(b.date))[0];
check('12 · a future occurrence is available to cancel', upcoming !== undefined, upcoming?.date);

const cancelled = await evaluate(`(async () => {
  const r = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    credentials: 'same-origin', body: '{}',
  });
  const { access_token } = await r.json();
  const res = await fetch('/api/v1/sessions/' + ${JSON.stringify(upcoming?.id ?? '')} + '/cancel', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'الأستاذة مريضة', version: ${upcoming?.version ?? 0} }),
  });
  return { status: res.status };
})()`);
check('13 · the cancellation is accepted', cancelled.status === 200, String(cancelled.status));

/**
 * **The occurrence is identified by its ID, not by its date.**
 *
 * The first version of this check matched the rendered date and found a
 * DIFFERENT session that another probe run had left on 2026-08-24 — correctly
 * not cancelled — and reported the rendering rule broken. Identity comes from
 * the API for upcoming.id; the title it returns is then what locates the row.
 *
 * ## Restated 2026-08-19, because the RULE was reversed
 *
 * Checks 13b–15 asserted R77's rule: *a cancelled occurrence still appears — the
 * calendar's job is to say a class is not happening, not to hide that it was
 * scheduled.* **R83 superseded that in terms**: the Owner's calendars show what
 * is **on**, and a class that is not happening is not on. So the ordinary public
 * projection now **omits** it, and `?include_cancelled=true` is the explicit
 * administrative read that still carries it. The Session is not deleted and
 * restoring it returns it to the calendar.
 *
 * The checks are inverted rather than removed, because the reversal has a half
 * that can still regress: **omitted from the ordinary read is not the same as
 * gone**, and a projection that dropped the row entirely would pass a check that
 * only looked at the default.
 */
const publicProjection = async (query) =>
  JSON.parse(
    (
      await evaluate(`(async () => {
        const res = await fetch('/api/v1/calendar?from=${upcoming.date}&to=${upcoming.date}${query}');
        return JSON.stringify(await res.json());
      })()`)
    ) || '{}',
  ).data ?? [];

await anonymous();
const defaultRows = await publicProjection('');
const includedRows = await publicProjection('&include_cancelled=true');
const publicRow = includedRows.find((o) => o.id === upcoming.id);

check(
  '13b · the ordinary public projection OMITS the cancelled occurrence (R83)',
  defaultRows.find((o) => o.id === upcoming.id) === undefined,
  JSON.stringify({ total: defaultRows.length, ids: defaultRows.map((o) => o.id).slice(0, 3) }),
);
check(
  '13c · and include_cancelled=true still carries it, marked cancelled — omitted is not deleted',
  publicRow !== undefined && publicRow.status === 'cancelled',
  JSON.stringify(publicRow && { id: publicRow.id, status: publicRow.status, title: publicRow.title }),
);

await goto(`/calendar?view=list&from=${upcoming.date}`);
const publicView = await evaluate(`(async () => {
  await new Promise((r) => setTimeout(r, 2000));
  const rows = [...document.querySelectorAll('.admin-table tbody tr')];
  const match = rows.find(
    (tr) =>
      tr.textContent.includes(${JSON.stringify(upcoming.date)}) &&
      tr.textContent.includes(${JSON.stringify(publicRow?.title ?? '\u0000')}),
  );
  return {
    total: rows.length,
    found: match !== undefined,
    // The REASON is staff information and must not reach a public reader — the
    // one clause of the original three that R83 did not touch.
    leaksReason: (document.body.textContent ?? '').includes('الأستاذة مريضة'),
  };
})()`);
check(
  '14 · the cancelled occurrence LEAVES the public calendar (R83)',
  publicView.found === false,
  JSON.stringify(publicView),
);
check('15 · the cancellation REASON does not leak publicly', publicView.leaksReason === false);

close();
process.exit(finish());
