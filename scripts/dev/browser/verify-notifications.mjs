/**
 * **R77 in a real browser, on the real student screens.**
 *
 * The scenario is the association's own — تفسير · وميض الأمل · كل اثنين
 * 15:00–17:00 · تاركة · القاعة 5 — seeded by scripts/dev/seed-dev-scenario.sh
 * into the development database, and read back through the actual application.
 *
 * ## What only this layer can prove
 *
 * The integration suite proves the contract: who is notified, what a restore
 * reconciles, what the envelope holds. It cannot prove that a **student sitting
 * in front of the platform** sees any of it — that the dashboard renders the
 * section, that the reason reaches the screen, that a refresh after a
 * cancellation shows the change, that the unread marker appears and clears.
 * Those are the facts the Owner asked to be verified, and they live in the DOM.
 *
 * ## Identity
 *
 * Three real sessions, each minted through issueNewSession — the production
 * path the OAuth callback calls — and presented as the ordinary bodour_refresh
 * cookie on its own route. **No authorisation is bypassed:** the student session
 * is an ordinary student with no role beyond student, and every request it
 * makes is checked exactly as any other. Switching identity is done by replacing
 * the cookie, which is what a different person on a different device is.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.SCENARIO ?? '{}');
const COOKIES = JSON.parse(process.env.COOKIES ?? '{}');
if (!COOKIES.admin || !COOKIES.student || !COOKIES.outsider) {
  throw new Error('COOKIES must carry admin, student and outsider refresh tokens');
}

const { send, evaluate, close } = await connect(process.env.PORT ?? '9224');
const { check, finish } = results();

let current = null;

/**
 * Becomes this person: the refresh cookie IS the session (TD-12).
 *
 * **The rotated cookie is carried forward, and it has to be.** TD-4.13 rotates
 * on every refresh — the presented token is revoked and a successor issued —
 * with reuse detection behind it. Re-setting the token this script was handed
 * therefore works exactly once per identity; the second switch back presents a
 * revoked token and is correctly refused with 401. That is the platform
 * behaving properly, and a harness that ignored it would report a defect the
 * application does not have.
 *
 * So each identity keeps its own jar: what the browser holds when we switch
 * away is what we restore when we switch back, which is what a second person on
 * a second device actually is.
 */
async function beAs(who) {
  if (current !== null) {
    const { cookies } = await send('Network.getCookies', { urls: [`${BASE}/api/v1/auth/refresh`] });
    const live = cookies.find((c) => c.name === 'bodour_refresh');
    if (live) COOKIES[current] = live.value;
  }
  await send('Network.clearBrowserCookies');
  await send('Network.setCookie', {
    name: 'bodour_refresh',
    value: COOKIES[who],
    domain: 'localhost',
    path: '/api/v1/auth/refresh',
    httpOnly: true,
  });
  current = who;
}

async function goto(path, settle = '.card, .state, .admin-table, .datatable__skeleton') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 80; i += 1) {
    const state = await evaluate(`(() => {
      if (document.location.pathname.startsWith('/login')) return 'login';
      if (document.querySelector('.datatable__skeleton')) return 'loading';
      return document.querySelector(${JSON.stringify(settle)}) ? 'ready' : 'waiting';
    })()`).catch(() => null);
    if (state === 'ready' || state === 'login') return state;
    await new Promise((r) => setTimeout(r, 250));
  }
  return 'timeout';
}

/** The rendered notification section, as a student would read it. */
const readInbox = () =>
  evaluate(`(() => {
    const section = [...document.querySelectorAll('section.card')]
      .find((s) => s.querySelector('#notifications-heading'));
    if (!section) return { present: false, items: [] };
    return {
      present: true,
      count: section.querySelector('.notifications__count')?.textContent?.trim() ?? null,
      items: [...section.querySelectorAll('.notifications__item')].map((li) => ({
        unread: li.classList.contains('is-unread'),
        headline: li.querySelector('.notifications__headline')?.textContent?.trim() ?? '',
        reason: li.querySelector('.notifications__reason')?.textContent?.trim() ?? null,
        hasMarkRead: li.querySelector('button') !== null,
      })),
    };
  })()`);

/**
 * The student's own upcoming sessions, as rendered on the dashboard.
 *
 * **It waits for the list rather than reading immediately.** The identity block
 * is a .card and renders as soon as GET /students/me resolves, while the
 * timetable is a second request behind it — reading straight after navigation
 * measured an empty section that filled in 300ms later. A probe that races the
 * page it measures reports a defect the application does not have.
 */
const readTimetable = () =>
  evaluate(`(async () => {
    for (let i = 0; i < 40; i += 1) {
      const section = document.querySelector('#upcoming-heading')?.closest('section');
      const rows = section ? [...section.querySelectorAll('li')] : [];
      if (rows.length > 0) {
        return {
          rows: rows.length,
          mentionsSubject: rows.some((li) => li.textContent.includes('تفسير')),
          first: rows[0].textContent.trim(),
        };
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return { rows: 0, mentionsSubject: false, first: document.querySelector('main')?.textContent?.slice(0, 200) ?? '' };
  })()`);

/** An admin action taken through the API the admin screens use, with the ADMIN's
 *  own session — the cancellation is not the thing under test, the student's
 *  view of it is. */
const asAdminApi = (method, path, body) =>
  evaluate(`(async () => {
    const r = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: '{}',
    });
    const { access_token } = await r.json();
    const res = await fetch(${JSON.stringify(`/api/v1${path}`)}, {
      method: ${JSON.stringify(method)},
      headers: { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' },
      ${body === undefined ? '' : `body: JSON.stringify(${JSON.stringify(body)}),`}
    });
    return { status: res.status, body: await res.text() };
  })()`);

/**
 * The current TD-15 version of one occurrence, **through the read the admin
 * screen itself uses**.
 *
 * The harness first asked GET /calendar/sessions/{id}, and got undefined.
 * That is the endpoint being right, not wrong: the Session page is **public at
 * the caller's tier** (§4.9/R43), and a concurrency token is a write-path
 * concern that has no business travelling on an anonymous read. Sending
 * version: 0 after that made the application answer 409 STATE_CONFLICT —
 * optimistic locking doing exactly its job.
 *
 * GET /admin/course-schedules/{id}/sessions is the authoritative source and
 * the one schedule-sessions.tsx reads before offering «إلغاء» or «استعادة».
 * Using it keeps the harness on the real production flow rather than inventing
 * a shortcut around the mechanism it is supposed to be exercising.
 */
async function scheduleSessions() {
  const res = await asAdminApi(
    'GET',
    `/admin/course-schedules/${S.scheduleId}/sessions?page=1&page_size=100`,
  );
  return JSON.parse(res.body).data;
}

async function currentVersion(sessionId) {
  const row = (await scheduleSessions()).find((r) => r.id === sessionId);
  if (row === undefined) throw new Error(`occurrence ${sessionId} not on its schedule`);
  return row.version;
}

/* ── 1–3 · the student signs in and sees her timetable ───────────────────── */

await beAs('student');
const dash = await goto('/dashboard/student');
check('1 · student reaches her dashboard with a real session', dash === 'ready', `state=${dash}`);

const timetable = await readTimetable();
check('2–3 · her timetable carries the تفسير occurrences', timetable.mentionsSubject, JSON.stringify(timetable));

const before = await readInbox();
check('the notification section is absent when there is nothing to say', before.present === false, JSON.stringify(before));

/* ── 4–5 · an administrator cancels ONE Monday ───────────────────────────── */

await beAs('admin');
await goto('/admin/branches');

/**
 * **A FUTURE Monday, deliberately.**
 *
 * The harness first took the earliest scheduled occurrence, which was a Monday
 * already past — and restoreSession refuses that with
 * STATE_CONFLICT / SESSION_IN_PAST, because reinstating a class that has
 * already not happened would put a session on the calendar claiming it did.
 * That is the application being right; the harness was aiming at the one
 * occurrence the scenario cannot be run against.
 *
 * Taking the next Monday ahead also makes this the Owner's own case: the class
 * the student can still see on her fortnight view is the one that gets
 * cancelled, which is what makes checks 6–9 meaningful rather than incidental.
 */
const today = new Date().toISOString().slice(0, 10);
// **Selected from the schedule's OWN read, not from the calendar by title.**
// Matching on a title picked up an occurrence belonging to a different schedule
// — other suites seed their own تفسير — and the version lookup then failed
// against a row that was never ours. The schedule is the identity here; a name
// never was.
const occurrence = (await scheduleSessions())
  .filter((o) => o.status === 'scheduled' && o.date > today)
  .sort((a, b) => a.date.localeCompare(b.date))[0];
check(
  '4 · an administrator can reach the next upcoming occurrence',
  occurrence !== undefined,
  occurrence?.date,
);

const cancelled = await asAdminApi('POST', `/sessions/${occurrence.id}/cancel`, {
  reason: 'الأستاذة مريضة',
  version: await currentVersion(occurrence.id),
});
check('5 · the cancellation is accepted, with its reason', cancelled.status === 200, `${cancelled.status} ${cancelled.body.slice(0, 120)}`);

/* ── 6–9 · the student returns and sees it ───────────────────────────────── */

await beAs('student');
await goto('/dashboard/student');
const after = await readInbox();
check('6–7 · the student sees the notification after returning', after.present && after.items.length === 1, JSON.stringify(after));
check('8 · it is unread, and offers «تم الاطّلاع»', after.items[0]?.unread === true && after.items[0]?.hasMarkRead === true, JSON.stringify(after.items[0]));
check(
  '9 · it names the class, the date and the REASON',
  after.items[0]?.headline.includes('تفسير') &&
    after.items[0]?.headline.includes(occurrence.date) &&
    after.items[0]?.reason?.includes('الأستاذة مريضة'),
  JSON.stringify(after.items[0]),
);
check('9b · no placeholder survived into the rendered copy', !after.items[0]?.headline.includes('{'), after.items[0]?.headline);

// Wrapped in an async IIFE: Runtime.evaluate parses the expression as a
// script, where a top-level await is a syntax error rather than a wait.
const cancelledOnCalendar = await evaluate(`(async () => {
  const body = await (await fetch('/api/v1/calendar?from=${S.from}&to=${S.to}')).json();
  return body.data.filter((o) => o.id === ${JSON.stringify(occurrence.id)}).map((o) => o.status);
})()`);
check('7b · the cancelled Monday is still ON the calendar, marked', String(cancelledOnCalendar) === 'cancelled', String(cancelledOnCalendar));

/* ── 10 · an unrelated student gets nothing ──────────────────────────────── */

await beAs('outsider');
await goto('/dashboard/student');
const outsider = await readInbox();
check('10 · a student enrolled elsewhere receives nothing', outsider.present === false, JSON.stringify(outsider));

/* ── 14 · no duplicates ──────────────────────────────────────────────────── */

await beAs('student');
await goto('/dashboard/student');
const again = await readInbox();
check('14 · exactly one notice, never a duplicate', again.items.length === 1, JSON.stringify(again));

/* ── 11–12 · restore withdraws the UNREAD notice ─────────────────────────── */

await beAs('admin');
await goto('/admin/branches');
const restored = await asAdminApi('POST', `/sessions/${occurrence.id}/restore`, {
  version: await currentVersion(occurrence.id),
});
check('11 · the occurrence is restored', restored.status === 200, `${restored.status} ${restored.body.slice(0, 120)}`);

await beAs('student');
await goto('/dashboard/student');
const withdrawn = await readInbox();
check('12 · the UNREAD notice is withdrawn — it is no longer true', withdrawn.present === false, JSON.stringify(withdrawn));

/* ── 13 · a READ notice is corrected instead ─────────────────────────────── */

await beAs('admin');
await goto('/admin/branches');
await asAdminApi('POST', `/sessions/${occurrence.id}/cancel`, {
  reason: 'الأستاذة مريضة',
  version: await currentVersion(occurrence.id),
});

await beAs('student');
await goto('/dashboard/student');
// Press «تم الاطّلاع» as a person would, then confirm the marker clears.
const marked = await evaluate(`(async () => {
  const section = [...document.querySelectorAll('section.card')]
    .find((s) => s.querySelector('#notifications-heading'));
  section.querySelector('.notifications__item button').click();
  await new Promise((r) => setTimeout(r, 1200));
  const li = section.querySelector('.notifications__item');
  return { unread: li.classList.contains('is-unread'), stillShown: li !== null,
           count: section.querySelector('.notifications__count') !== null };
})()`);
check('13a · pressing «تم الاطّلاع» clears the unread marker and the count', marked.unread === false && marked.count === false, JSON.stringify(marked));
check('13b · a READ notice stays on screen — it is still true', marked.stillShown === true, JSON.stringify(marked));

await beAs('admin');
await goto('/admin/branches');
await asAdminApi('POST', `/sessions/${occurrence.id}/restore`, {
  version: await currentVersion(occurrence.id),
});

await beAs('student');
await goto('/dashboard/student');
const corrected = await readInbox();
check(
  '13c · a notice already READ is CORRECTED, not silently deleted',
  corrected.present === true &&
    corrected.items.length === 1 &&
    corrected.items[0].headline.includes('عادت') &&
    corrected.items[0].reason === null,
  JSON.stringify(corrected),
);
check('13d · the correction arrives UNREAD, because it is news', corrected.items?.[0]?.unread === true, JSON.stringify(corrected.items?.[0]));

close();
process.exit(finish());
