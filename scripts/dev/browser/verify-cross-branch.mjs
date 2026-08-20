/**
 * **One occurrence, two branches — through the real screens** (R92, with R91).
 *
 * Six identities, because the whole point is that they see different things
 * about the same occurrence: the Admin who combines it, the two beneficiaries
 * who now share it, an unrelated one who must not, the مؤطِّرة covering it, and
 * the one who staffs the schedule but not that date.
 *
 * The last block is the proof the revision exists for: **staffing and audience
 * are independent occurrence-specific dimensions**, and the following week
 * returns to normal on both.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.R92_SCENARIO ?? '{}');
const { send, evaluate, close } = await connect(process.env.PORT ?? '9249');
const { check, finish } = results();

await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
});

async function beIdentity(cookie) {
  await send('Network.clearBrowserCookies');
  await send('Network.setCookie', {
    name: 'bodour_refresh', value: cookie,
    domain: 'localhost', path: '/api/v1/auth/refresh', httpOnly: true,
  });
}

/**
 * One refresh per identity, bearer kept — the trap recorded in `testing.md`.
 *
 * **And no navigation here.** Navigating boots the SPA, which refreshes on its
 * own; setting a cookie and racing that refresh means two consumers of one
 * token, which is exactly what TD-4.13 revokes a session for. The symptom is a
 * 401 for the *fourth or fifth* identity — timing-dependent, and it reads as a
 * مؤطِّرة who is assigned to nothing. The page is parked once, below, on a route
 * that has already finished booting.
 */
async function tokenFor(cookie) {
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
  if (parsed.status !== 200) throw new Error(`refresh failed: ${parsed.status}`);
  return JSON.parse(parsed.body).access_token;
}

const json = async (token, path) => {
  const raw = await evaluate(`(async () => {
    const res = await fetch('/api/v1' + ${JSON.stringify(path)}, {
      headers: { Authorization: 'Bearer ' + ${JSON.stringify(token)} },
    });
    return { status: res.status, body: await res.text() };
  })()`);
  return { status: raw.status, ...JSON.parse(raw.body || '{}') };
};

async function open(path, ready = 'main') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 120; i += 1) {
    const ok = await evaluate(
      `(() => document.querySelector(${JSON.stringify(ready)}) !== null)()`,
    ).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 1200));
}

/* ── 1–4 · the Admin combines the occurrence, on the real screen ─────────── */

// Park the page once, and let the app finish its own boot refresh before any
// identity's cookie is put in front of it.
await send('Page.navigate', { url: `${BASE}/content-unavailable` });
await new Promise((r) => setTimeout(r, 2500));

const adminToken = await tokenFor(process.env.ADMIN_COOKIE);
await beIdentity(process.env.ADMIN_COOKIE);
await open(`/admin/schedules/${S.targaSchedule}/sessions`, '.admin-table, .state');

/**
 * **The row is located by INDEX derived from the API, not by its text.**
 *
 * The occurrences table renders dates through the platform's Arabic formatter,
 * so an ISO string matches nothing — and matching a formatted date would tie
 * this harness to a presentation choice. The list is ordered by date ascending
 * and so is the API's, so the id's position in one is its row in the other:
 * identity comes from the fixture, exactly as §32 requires.
 */
const listed = await json(adminToken, `/admin/course-schedules/${S.targaSchedule}/sessions?page=1&page_size=200`);
const rowIndex = (listed.data ?? []).findIndex((x) => x.id === S.combined);

const opened = await evaluate(`(async () => {
  const rows = [...document.querySelectorAll('.admin-table tbody tr')];
  const row = rows[${rowIndex}];
  if (!row || ${rowIndex} < 0) return { noRow: true, rows: rows.length, index: ${rowIndex} };
  const action = [...row.querySelectorAll('button')].find((b) =>
    b.textContent.includes('الحضور من الفروع'),
  );
  if (!action) return { noAction: true, labels: [...row.querySelectorAll('button')].map((b) => b.textContent.trim()) };
  action.click();
  await new Promise((r) => setTimeout(r, 2500));
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return { noDialog: true };
  return {
    opened: true,
    text: dialog.textContent,
    // The venue is TEXT, and the audience is the control — two facts, and the
    // dialog must not offer to move the class.
    venueShown: dialog.textContent.includes('مكان الحصة'),
    saysThisOnly: dialog.textContent.includes('هذه الحصة وحدها'),
    chosen: [...dialog.querySelectorAll('button')]
      .filter((b) => b.textContent.trim().endsWith('✕'))
      .map((b) => b.textContent.replace('✕', '').trim()),
  };
})()`);

check('1 · «الحضور من الفروع» opens on the occurrence', opened.opened === true, JSON.stringify(opened).slice(0, 300));
check(
  '2 · it names the VENUE separately, and says it affects this occurrence only',
  opened.venueShown === true && opened.saysThisOnly === true,
  JSON.stringify({ venueShown: opened.venueShown, saysThisOnly: opened.saysThisOnly }),
);
check(
  '3 · and opens with the INHERITED branch already chosen — replacement, unambiguously',
  (opened.chosen ?? []).some((c) => c.includes('تاركة')) && (opened.chosen ?? []).length === 1,
  JSON.stringify(opened.chosen),
);

const combined = await evaluate(`(async () => {
  const dialog = document.querySelector('dialog[open]');
  const add = [...dialog.querySelectorAll('button')].find((b) =>
    b.textContent.includes('الفرع الثاني') && b.textContent.trim().startsWith('＋'),
  );
  if (!add) return { noOption: true, options: [...dialog.querySelectorAll('button')].map((b) => b.textContent.trim()) };
  add.click();
  await new Promise((r) => setTimeout(r, 500));
  const save = [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === 'حفظ');
  save.click();
  await new Promise((r) => setTimeout(r, 3000));
  return { closed: document.querySelector('dialog[open]') === null };
})()`);
check('4 · adding the second branch saves', combined.closed === true, JSON.stringify(combined));

/* ── 5–7 · the roster says who, and where, as separate facts ─────────────── */

const roster = await json(adminToken, `/sessions/${S.combined}/roster`);
const rosterIds = (roster.data?.students ?? []).map((s) => s.id);
check(
  '5 · the roster gathers BOTH branches’ beneficiaries',
  rosterIds.includes(S.studentA) && rosterIds.includes(S.studentB),
  JSON.stringify({ ids: rosterIds, branches: roster.data?.audience_branches }),
);
check(
  '6 · and excludes the unrelated branch’s',
  !rosterIds.includes(S.studentC),
  JSON.stringify(rosterIds),
);
check(
  '7 · the physical venue is still Targa — audience moved, the class did not',
  roster.data?.venue?.branch_id === S.targa && roster.data?.overridden === true,
  JSON.stringify(roster.data?.venue),
);

/* ── 8–11 · the beneficiaries, each asked for herself ────────────────────── */

const calendarOf = async (cookie) => {
  const token = await tokenFor(cookie);
  const r = await json(token, `/me/calendar?from=${S.combinedDate}&to=${S.nextDate}`);
  return (r.data ?? []).map((o) => o.id);
};

const aSees = await calendarOf(process.env.A_COOKIE);
const bSees = await calendarOf(process.env.B_COOKIE);
const cSees = await calendarOf(process.env.C_COOKIE);

check('8 · Targa’s beneficiary sees the occurrence', aSees.includes(S.combined), JSON.stringify(aSees));
check(
  '9 · the second branch’s beneficiary sees the SAME occurrence',
  bSees.includes(S.combined),
  JSON.stringify(bSees),
);
check('10 · the unrelated beneficiary sees neither', !cSees.includes(S.combined), JSON.stringify(cSees));
check(
  '11 · and NEXT week is branch-separated again — an override never propagates',
  aSees.includes(S.next) && !bSees.includes(S.next),
  JSON.stringify({ a: aSees.includes(S.next), b: bSees.includes(S.next) }),
);

/* ── 12–13 · staffing is the other dimension, resolved independently ─────── */

const staffCal = async (cookie) => {
  const token = await tokenFor(cookie);
  const r = await json(token, `/me/calendar?from=${S.combinedDate}&to=${S.nextDate}`);
  // **Status first.** A non-200 answers `{ error }` with no `data`, and reading
  // `r.data ?? []` would turn a failed request into "she is assigned to
  // nothing" — the trap `testing.md` records as *a negative check that cannot
  // fail proves nothing*.
  if (r.status !== 200) throw new Error(`calendar ${r.status}: ${JSON.stringify(r.error ?? {})}`);
  return (r.data ?? []).map((o) => o.id);
};
const aminaSees = await staffCal(process.env.AMINA_COOKIE);
const safaSees = await staffCal(process.env.SAFA_COOKIE);
check(
  '12 · the مؤطِّرة covering that occurrence has it; the schedule’s does not',
  aminaSees.includes(S.combined) && !safaSees.includes(S.combined),
  JSON.stringify({ amina: aminaSees.length, safa: safaSees.length }),
);
check(
  '13 · and next week returns to the schedule’s مؤطِّرة — both dimensions, independently',
  safaSees.includes(S.next) && !aminaSees.includes(S.next),
  JSON.stringify({ safaNext: safaSees.includes(S.next), aminaNext: aminaSees.includes(S.next) }),
);

/* ── 14–15 · cancelling tells the people who were expected ───────────────── */

await beIdentity(process.env.ADMIN_COOKIE);
const admin2 = await tokenFor(process.env.ADMIN_COOKIE);
const told = await evaluate(`(async () => {
  const t = ${JSON.stringify(admin2)};
  const h = { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
  const list = await fetch('/api/v1/admin/course-schedules/' + ${JSON.stringify(S.targaSchedule)} + '/sessions?page=1&page_size=200', { headers: h }).then((r) => r.json());
  const row = (list.data ?? []).find((s) => s.id === ${JSON.stringify(S.combined)});
  const cancelled = await fetch('/api/v1/sessions/' + ${JSON.stringify(S.combined)} + '/cancel', {
    method: 'POST', headers: h,
    body: JSON.stringify({ version: row.version, reason: 'درس واحد للفرعين' }),
  });
  const notified = await fetch('/api/v1/sessions/' + ${JSON.stringify(S.combined)} + '/notify', {
    method: 'POST', headers: h, body: JSON.stringify({ change: 'cancelled' }),
  });
  return { cancelled: cancelled.status, notified: notified.status, body: (await notified.text()).slice(0, 120) };
})()`);

const inboxOf = async (cookie) => {
  const token = await tokenFor(cookie);
  const r = await json(token, '/notifications?page=1&page_size=50');
  if (r.status !== 200) return { error: r.status };
  return { ids: (r.data ?? []).map((n) => n.session?.id ?? n.session_id ?? null) };
};

const aInbox = await inboxOf(process.env.A_COOKIE);
const bInbox = await inboxOf(process.env.B_COOKIE);
const cInbox = await inboxOf(process.env.C_COOKIE);
const aminaInbox = await inboxOf(process.env.AMINA_COOKIE);
const safaInbox = await inboxOf(process.env.SAFA_COOKIE);

const got = (inbox) => (inbox.ids ?? []).includes(S.combined);
check(
  '14 · both branches’ beneficiaries are told, and the unrelated one is not',
  told.cancelled === 200 && told.notified === 200 && got(aInbox) && got(bInbox) && !got(cInbox),
  JSON.stringify({ told, a: got(aInbox), b: got(bInbox), c: got(cInbox) }),
);
check(
  '15 · the covering مؤطِّرة is told; the one who does not take that date is not',
  got(aminaInbox) && !got(safaInbox),
  JSON.stringify({ amina: got(aminaInbox), safa: got(safaInbox) }),
);

/* ── 16 · it survives a reload ───────────────────────────────────────────── */

const persisted = await json(adminToken, `/sessions/${S.combined}/roster`);
check(
  '16 · the override persists, and the roster still reads both branches',
  persisted.data?.overridden === true &&
    (persisted.data?.audience_branches ?? []).length === 2,
  JSON.stringify(persisted.data?.audience_branches),
);

close();
process.exit(finish());
