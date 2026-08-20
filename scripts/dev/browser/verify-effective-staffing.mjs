/**
 * **Effective-dated staffing, across its boundaries, in a real browser** (R91).
 *
 * Four identities — Admin, Safa, Amina, an assistant — because the whole point
 * of the revision is that they see different things on the same class at the
 * same moment. Source inspection cannot show that; only asking each of them can.
 *
 * Dates are relative to today (the fixture's), so the harness does not rot.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.R91_SCENARIO ?? '{}');
const { send, evaluate, close } = await connect(process.env.PORT ?? '9245');
const { check, finish } = results();

await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
});

async function beIdentity(cookie) {
  await send('Network.clearBrowserCookies');
  await send('Network.setCookie', {
    name: 'bodour_refresh',
    value: cookie,
    domain: 'localhost',
    path: '/api/v1/auth/refresh',
    httpOnly: true,
  });
}

/**
 * **One refresh per identity, and the access token is kept** — the trap this
 * project has paid for twice (`docs/development/testing.md`).
 *
 * The app refreshes on load and **rotates the cookie**. A harness that refreshes
 * again against the cookie it just rotated is exactly what TD-4.13's reuse
 * detection revokes a session for: the first read succeeds and everything after
 * it answers 401, which reads like a broken feature. The first run of this file
 * did precisely that — three checks reported empty data that was really a 401.
 *
 * So: mint the bearer **before** navigating, and reuse it.
 */
async function tokenFor(cookie) {
  await send('Page.navigate', { url: `${BASE}/content-unavailable` });
  await new Promise((r) => setTimeout(r, 600));
  await beIdentity(cookie);
  const res = await evaluate(`(async () => {
    const r = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: '{}',
    });
    return JSON.stringify({ status: r.status, body: await r.text() });
  })()`);
  const parsed = JSON.parse(res);
  if (parsed.status !== 200) throw new Error(`refresh failed: ${parsed.status} ${parsed.body}`);
  return JSON.parse(parsed.body).access_token;
}

async function open(path, ready = 'main') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 120; i += 1) {
    const ok = await evaluate(
      `(() => document.querySelector(${JSON.stringify(ready)}) !== null)()`,
    ).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 1000));
}

/** A read with a bearer already in hand — no second refresh, ever. */
const api = (token, path) =>
  evaluate(`(async () => {
    const res = await fetch('/api/v1' + ${JSON.stringify(path)}, {
      headers: { Authorization: 'Bearer ' + ${JSON.stringify(token)} },
    });
    return { status: res.status, body: await res.text() };
  })()`);

const json = async (token, path) => {
  const r = await api(token, path);
  return { status: r.status, ...JSON.parse(r.body || '{}') };
};

/* ── 1–3 · the Admin sees the periods on the real form ───────────────────── */

const adminToken = await tokenFor(process.env.ADMIN_COOKIE);
await open('/admin/schedules', '.admin-table, .state');

const form = await evaluate(`(async () => {
  const row = [...document.querySelectorAll('.admin-table tbody tr')].find((tr) =>
    tr.textContent.includes('r91-replacement'),
  );
  if (!row) return { noRow: true };
  const edit = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'تعديل');
  if (!edit) return { noEdit: true };
  edit.click();
  await new Promise((r) => setTimeout(r, 3000));
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return { noDialog: true };
  const dates = [...dialog.querySelectorAll('input[type=date]')].map((i) => i.value);
  const selects = [...dialog.querySelectorAll('select')];
  const people = selects
    .filter((s) => [...s.options].some((o) => o.textContent.includes('r91-replacement')))
    .map((s) => s.options[s.selectedIndex]?.textContent.trim() ?? '');
  return {
    opened: true,
    heading: dialog.textContent.includes('المؤطّرات وفتراتهن'),
    rows: people.length,
    people,
    dates,
    // The form must say how a replacement is expressed, not leave her to infer
    // it from four fields.
    explains: dialog.textContent.includes('تعويض'),
  };
})()`);

check(
  '1 · the class opens showing its staffing as DATED rows',
  form.opened === true && form.heading === true,
  JSON.stringify(form),
);
check(
  '2 · Safa appears TWICE — the case the old unique index made impossible',
  (form.people ?? []).filter((p) => p.includes('صفاء')).length === 2 &&
    (form.people ?? []).some((p) => p.includes('أمينة')),
  JSON.stringify(form.people),
);
check(
  '3 · and the replacement dates are on screen, with the form explaining the shape',
  (form.dates ?? []).includes(S.replaceFrom) &&
    (form.dates ?? []).includes(S.replaceUntil) &&
    form.explains === true,
  JSON.stringify({ dates: form.dates, explains: form.explains }),
);

/* ── 4–5 · the occurrences carry the right person per date ───────────────── */

const sessions = await json(
  adminToken,
  `/admin/course-schedules/${S.schedule}/sessions?page=1&page_size=200`,
);
const staffOn = (predicate) =>
  (sessions.data ?? [])
    .filter(predicate)
    .flatMap((s) => (s.staff ?? []).filter((x) => x.position === 'teacher').map((x) => x.user_id));

const during = staffOn((s) => s.date >= S.replaceFrom && s.date <= S.replaceUntil);
const after = staffOn((s) => s.date > S.replaceUntil);

check(
  '4 · every occurrence INSIDE the replacement is Amina’s',
  during.length > 0 && during.every((id) => id === S.amina),
  JSON.stringify({ count: during.length, unique: [...new Set(during)] }),
);
check(
  '5 · and every one after it is Safa’s again — from one edit, no occurrence touched',
  after.length > 0 && after.every((id) => id === S.safa),
  JSON.stringify({ count: after.length, unique: [...new Set(after)] }),
);

/* ── 6–9 · each مؤطِّرة is asked, today ───────────────────────────────────── */

const asks = {};
const tokens = {};
for (const [name, cookie, pageCookie] of [
  ['safa', process.env.SAFA_COOKIE, process.env.SAFA_PAGE_COOKIE],
  ['amina', process.env.AMINA_COOKIE, process.env.AMINA_PAGE_COOKIE],
  ['helper', process.env.HELPER_COOKIE, process.env.HELPER_PAGE_COOKIE],
]) {
  // eslint-disable-next-line no-await-in-loop
  const token = await tokenFor(cookie);
  tokens[name] = token;
  // eslint-disable-next-line no-await-in-loop
  const me = await json(token, '/me');
  // eslint-disable-next-line no-await-in-loop
  const roster = await json(token, '/quran-students');
  // The menu is read from the rendered shell, which refreshes on its own — so
  // it goes AFTER the API reads, whose bearer is already in hand.
  // eslint-disable-next-line no-await-in-loop
  await beIdentity(pageCookie);
  // eslint-disable-next-line no-await-in-loop
  // **`/teacher`, her portal's home** — `/dashboard/teacher` is not a route and
  // rendered «الصفحة غير موجودة», whose empty menu the harness read as a hidden
  // entry for somebody whose roster and marker were both correct.
  await open('/teacher', 'main');
  // eslint-disable-next-line no-await-in-loop
  await new Promise((r) => setTimeout(r, 1500));
  // eslint-disable-next-line no-await-in-loop
  const menu = await evaluate(
    // **`.admin-nav a`, the class the shared `PortalShell` renders** (rule AP —
    // three portals, one frame). A bare `nav a` matched nothing and reported an
    // absent menu entry for a مؤطِّرة whose roster and marker were both correct.
    `(() => [...document.querySelectorAll('.admin-nav a')].map((a) => a.textContent.trim()))()`,
  );
  asks[name] = {
    teachesQuran: me.teaches_quran,
    /**
     * **`/quran-students` answers `{ students, levels }` since Section C**
     * (restated 2026-08-20). It used to answer a bare array; it now carries the
     * Levels the roster reaches and each Level's `LevelSurah` syllabus, because
     * the entry form's three selectors are one question and a مؤطِّرة is refused
     * by the admin reference endpoints that would otherwise answer the last two.
     *
     * **The property these checks pin is unchanged** — which beneficiaries she
     * reaches on which date — so this is restated, not weakened: reading
     * `.data` as an array silently produced `undefined` and every roster
     * assertion below would have compared against nothing.
     */
    students: (roster.data?.students ?? []).map((s) => s.id),
    quranMenu: (menu ?? []).some((label) => label.includes('إدخال الحفظ')),
  };
}

check(
  '6 · Safa is effective TODAY — roster, marker and menu all agree',
  asks.safa.teachesQuran === true &&
    asks.safa.students.includes(S.student) &&
    asks.safa.quranMenu === true,
  JSON.stringify(asks.safa),
);
check(
  '7 · Amina’s period has not begun — she reaches nobody, and the menu is hidden',
  asks.amina.teachesQuran === false &&
    !asks.amina.students.includes(S.student) &&
    asks.amina.quranMenu === false,
  JSON.stringify(asks.amina),
);
check(
  '8 · the ASSISTANT has the same reach as the lead (R87 §G parity)',
  asks.helper.teachesQuran === true &&
    asks.helper.students.includes(S.student) &&
    asks.helper.quranMenu === true,
  JSON.stringify(asks.helper),
);
check(
  '9 · a live assignment row is not authority — only an EFFECTIVE one is',
  // Amina holds a real, undeleted row on this schedule. Time-blind, that row
  // handed her the roster the moment it existed.
  asks.amina.students.length === 0,
  JSON.stringify({ aminaStudents: asks.amina.students }),
);

/* ── 10–11 · the personal calendars split at the boundary ────────────────── */

const calendarOf = async (token) => {
  const from = new Date();
  const to = new Date();
  to.setUTCDate(to.getUTCDate() + 120);
  const r = await json(
    token,
    `/me/calendar?from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`,
  );
  return (r.data ?? []).filter((o) => o.date !== undefined).map((o) => o.date);
};

const safaDates = await calendarOf(tokens.safa);
const aminaDates = await calendarOf(tokens.amina);

const inWindow = (d) => d >= S.replaceFrom && d <= S.replaceUntil;
check(
  '10 · Amina’s calendar holds the replacement occurrences',
  aminaDates.some(inWindow),
  JSON.stringify(aminaDates.filter(inWindow).slice(0, 4)),
);
check(
  '11 · and Safa’s does NOT — the same dates, a different answer per person',
  !safaDates.some(inWindow) && safaDates.length > 0,
  JSON.stringify({ safaInWindow: safaDates.filter(inWindow), safaTotal: safaDates.length }),
);

/* ── 12–13 · history is not rewritten ────────────────────────────────────── */

const before = await json(
  adminToken,
  `/admin/course-schedules/${S.schedule}/sessions?page=1&page_size=200`,
);
const past = (before.data ?? []).filter((s) => s.date < new Date().toISOString().slice(0, 10));
check(
  '12 · past occurrences exist and name whoever actually took them',
  past.length > 0 && past.every((s) => (s.staff ?? []).some((x) => x.user_id === S.safa)),
  JSON.stringify({ count: past.length, first: past[0]?.staff ?? null }),
);

// Hand the whole class to Amina, open-ended, and read the past back.
const handover = await evaluate(`(async () => {
  const access_token = ${JSON.stringify('')} || ${JSON.stringify(adminToken)};
  const cur = await fetch('/api/v1/admin/course-schedules?page=1&page_size=100', {
    headers: { Authorization: 'Bearer ' + access_token },
  }).then((x) => x.json());
  const row = (cur.data ?? []).find((s) => s.id === ${JSON.stringify(S.schedule)});
  if (!row) return { status: 0, body: 'schedule not visible to this admin' };
  const res = await fetch('/api/v1/admin/course-schedules/' + ${JSON.stringify(S.schedule)}, {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer ' + access_token,
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({
      version: row.version,
      staff: [{ user_id: ${JSON.stringify(S.amina)}, position: 'teacher' }],
    }),
  });
  return { status: res.status, body: (await res.text()).slice(0, 200) };
})()`);

const afterHandover = await json(
  adminToken,
  `/admin/course-schedules/${S.schedule}/sessions?page=1&page_size=200`,
);
const pastAfter = (afterHandover.data ?? []).filter(
  (s) => s.date < new Date().toISOString().slice(0, 10),
);
check(
  '13 · a handover NEVER rewrites them — the non-negotiable rule',
  handover.status === 200 &&
    pastAfter.length > 0 &&
    pastAfter.every((s) => (s.staff ?? []).some((x) => x.user_id === S.safa)) &&
    pastAfter.every((s) => !(s.staff ?? []).some((x) => x.user_id === S.amina)),
  JSON.stringify({ handover: handover.status, past: pastAfter.length, first: pastAfter[0]?.staff }),
);

close();
process.exit(finish());
