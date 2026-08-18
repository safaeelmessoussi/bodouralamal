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
    path: '/api/v1/auth/refresh',
    httpOnly: true,
  });
}

async function goto(path) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 100; i += 1) {
    const ready = await evaluate(`(() => document.querySelector('.cal-toolbar') !== null)()`).catch(
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
  const tabs = [...document.querySelectorAll('.cal-toolbar [role="tab"]')].map((b) => ({
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

const list = await evaluate(`(async () => {
  const tab = [...document.querySelectorAll('.cal-toolbar [role="tab"]')]
    .find((b) => b.textContent.trim() === 'قائمة');
  tab.click();
  await new Promise((r) => setTimeout(r, 1500));
  return {
    url: window.location.search,
    hasList: document.querySelector('.occurrence-list') !== null,
    hasGrid: document.querySelector('.calendar-grid') !== null,
    navHidden: ![...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'اليوم'),
    items: [...document.querySelectorAll('.occurrence-list__item')].length,
    first: document.querySelector('.occurrence-list__item')?.textContent?.trim()?.slice(0, 90) ?? null,
  };
})()`);
check('4 · قائمة renders the list view', list.hasList === true, JSON.stringify(list));
check('5 · the chosen view is in the URL, so a reload and a shared link keep it', list.url.includes('view=list'), list.url);
check('6 · month stepping is withheld in the list, where it means nothing', list.navHidden === true);
check('7 · the list carries occurrences with their date and time', list.items > 0, list.first);

const rtl = await evaluate(`(() => {
  const item = document.querySelector('.occurrence-list__item');
  if (!item) return { none: true };
  const style = getComputedStyle(item);
  return {
    dir: getComputedStyle(document.documentElement).direction,
    // The mark is on the inline START, so RTL needs no rule of its own.
    startBorder: style.borderInlineStartWidth,
    endBorder: style.borderInlineEndWidth,
  };
})()`);
check('8 · RTL, with the marker on the inline start', rtl.dir === 'rtl' && rtl.startBorder !== '0px' && rtl.endBorder === '0px', JSON.stringify(rtl));

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
 */
await anonymous();
const publicRow = JSON.parse(
  (
    await evaluate(`(async () => {
      const res = await fetch('/api/v1/calendar?from=${upcoming.date}&to=${upcoming.date}');
      return JSON.stringify(await res.json());
    })()`)
  ) || '{}',
).data?.find((o) => o.id === upcoming.id);
check(
  '13b · the public projection carries that occurrence as cancelled',
  publicRow !== undefined && publicRow.status === 'cancelled',
  JSON.stringify(publicRow && { id: publicRow.id, status: publicRow.status, title: publicRow.title }),
);

await goto(`/calendar?view=list&from=${upcoming.date}`);
const publicView = await evaluate(`(async () => {
  await new Promise((r) => setTimeout(r, 2000));
  const items = [...document.querySelectorAll('.occurrence-list__item')];
  const match = items.find(
    (li) =>
      li.textContent.includes(${JSON.stringify(upcoming.date)}) &&
      li.textContent.includes(${JSON.stringify(publicRow?.title ?? '\u0000')}),
  );
  return {
    total: items.length,
    found: match !== undefined,
    marked: match ? match.className.includes('is-cancelled') : null,
    saysCancelled: match ? match.textContent.includes('ملغاة') : null,
    // The REASON is staff information and must not reach a public reader.
    leaksReason: (document.body.textContent ?? '').includes('الأستاذة مريضة'),
  };
})()`);
check('14 · the cancelled occurrence STAYS on the public calendar', publicView.found === true, JSON.stringify(publicView));
check('15 · and is marked as cancelled, in words', publicView.marked === true && publicView.saysCancelled === true, JSON.stringify(publicView));
check('16 · the cancellation REASON does not leak publicly', publicView.leaksReason === false);

close();
process.exit(finish());
