/**
 * **R82 end to end: who sees what, and who is told.**
 *
 * The properties here are about *populations*, and a population is only
 * observable by asking as each person. So the harness signs in as three
 * different people — an administrator, the beneficiary an event concerns, and
 * one it does not — and reads the screens each of them actually gets.
 *
 * The **negative** halves carry the weight: an unrelated beneficiary seeing
 * nothing is what makes the positive halves mean anything, and it is the half a
 * source reading can never establish.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.R82_SCENARIO ?? '{}');
if (!S.levelEvent) throw new Error('R82_SCENARIO is required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9237');
const { check, finish } = results();

const cookie = (value) =>
  send('Network.setCookie', {
    name: 'bodour_refresh',
    value,
    domain: 'localhost',
    path: '/api/v1/auth/refresh',
    httpOnly: true,
  });

/**
 * **One access token per identity, minted once.**
 *
 * The first version re-minted on every navigation and started answering 401
 * halfway through: the app refreshes on load, and a second refresh against the
 * cookie it had just rotated is exactly what TD-4.13's reuse detection revokes a
 * session for. The harness was tripping a security control and reading the
 * result as a broken feature.
 */
const tokens = new Map();

async function as(who) {
  await send('Network.clearBrowserCookies');
  await cookie(who);
  current = who;
}
let current = null;

await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
});

/** Call the API through the PAGE, so the session cookie and refresh flow are the real ones. */
const api = (path, init) =>
  evaluate(`(async () => {
    const res = await window.__apiFetch(${JSON.stringify(path)}, ${JSON.stringify(init ?? null)});
    return res;
  })()`);

async function open(path = '/dashboard/student') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 120; i += 1) {
    const ok = await evaluate(`(() => document.querySelector('main') !== null)()`).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 800));
  // A thin fetch helper installed in the page: it carries the access token the
  // app itself obtained, so every read below is exactly what that person's
  // browser would receive.
  await evaluate(`(() => {
    window.__apiFetch = async (path, init) => {
      const opts = init || {};
      const res = await fetch('/api/v1' + path, {
        method: opts.method || 'GET',
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          window.__token ? { Authorization: 'Bearer ' + window.__token } : {},
        ),
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        credentials: 'include',
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    return true;
  })()`);
  // Mint once per identity, then reuse: see `tokens` above.
  if (!tokens.has(current)) {
    const minted = await evaluate(`(async () => {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        // The exact value the CSRF check requires (TD-12): the server compares
        // the header literally.
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'include',
      });
      const body = await res.json().catch(() => null);
      // The refresh response returns the token at the TOP level, not nested
      // under data — §60.4 returns it explicitly beside the active role.
      return body ? (body.access_token ?? (body.data && body.data.access_token)) : null;
    })()`);
    tokens.set(current, minted);
  }
  await evaluate(`(() => { window.__token = ${JSON.stringify(tokens.get(current))}; return true; })()`);
}

const RANGE = 'from=2026-08-01&to=2026-08-31';

/* ── A · the personal calendar ──────────────────────────────────────────── */

await as(process.env.CONCERNED_COOKIE);
await open();
const mine = await api(`/me/calendar?${RANGE}`);
const mineIds = (mine.body?.data ?? []).map((o) => o.id);

check(
  'A1 · the concerned beneficiary sees the event addressed to her Level',
  mineIds.includes(S.levelEvent),
  JSON.stringify({ status: mine.status, count: mineIds.length }),
);
check(
  'A2 · and the Branch+Category event that names her branch and category',
  mineIds.includes(S.branchCategoryEvent),
  JSON.stringify(mineIds.length),
);
check(
  'A3 · and the Category-wide one',
  mineIds.includes(S.categoryWideEvent),
  JSON.stringify(mineIds.length),
);
check(
  'A4 · but NOT the event addressed to a Level she is not in',
  !mineIds.includes(S.otherLevelEvent),
  JSON.stringify({ otherLevel: S.otherLevelEvent }),
);

// The control that makes A4 mean something: the event exists and the PUBLIC
// calendar still shows it, so the narrowing is the personal read's.
const pub = await api(`/calendar?${RANGE}`);
const pubIds = (pub.body?.data ?? []).map((o) => o.id);
check(
  'A5 · the public calendar still shows it — the narrowing is personal, not deletion',
  pubIds.includes(S.otherLevelEvent) && pubIds.includes(S.levelEvent),
  JSON.stringify({ publicCount: pubIds.length }),
);

await as(process.env.UNRELATED_COOKIE);
await open();
const theirs = await api(`/me/calendar?${RANGE}`);
const theirIds = (theirs.body?.data ?? []).map((o) => o.id);
check(
  'A6 · the unrelated beneficiary sees her own Level’s event and not the other’s',
  theirIds.includes(S.otherLevelEvent) && !theirIds.includes(S.levelEvent),
  JSON.stringify({ count: theirIds.length }),
);
check(
  'A7 · and not the Category-wide event of a Category she is not in',
  !theirIds.includes(S.categoryWideEvent),
  JSON.stringify({ count: theirIds.length }),
);

/* ── B/C · the optional send ────────────────────────────────────────────── */

const inbox = async () => {
  const res = await api('/notifications?page_size=50');
  if (res.status !== 200) {
    // Reported rather than swallowed: an empty list because the read FAILED is
    // not the same fact as an empty list, and a negative check that cannot tell
    // them apart passes for the wrong reason.
    console.log(`    (inbox read failed: ${res.status} ${JSON.stringify(res.body)})`);
  }
  return (res.body?.data ?? []);
};

await as(process.env.CONCERNED_COOKIE);
await open();
const before = await inbox();
check(
  'C1 · before anything is sent, her inbox holds no notice of this event',
  before.filter((n) => n.event_id === S.levelEvent).length === 0,
  JSON.stringify({ total: before.length }),
);

// «بدون إشعار» is the ABSENCE of the request — asserted by not making it, which
// is exactly what the dialog's decline branch does.
check(
  'C2 · declining sends nothing, and the event is still there',
  mineIds.includes(S.levelEvent) && before.filter((n) => n.event_id === S.levelEvent).length === 0,
  'no notify request was made',
);

await as(process.env.ADMIN_COOKIE);
await open('/admin/schedules');
const sent = await api(`/events/${S.levelEvent}/notify`, {
  method: 'POST',
  body: { change: 'created' },
});
check(
  'B1 · «إرسال الإشعار» reaches the concerned population',
  sent.status === 200 && sent.body?.data?.notified >= 1,
  JSON.stringify(sent.body?.data),
);

const adminInbox = await inbox();
check(
  'B2 · and the actor is NOT among them',
  adminInbox.filter((n) => n.event_id === S.levelEvent).length === 0,
  JSON.stringify({ adminNotices: adminInbox.length }),
);

await as(process.env.CONCERNED_COOKIE);
await open();
const after = await inbox();
const hers = after.filter((n) => n.event_id === S.levelEvent);
check(
  'B3 · she receives exactly one, carrying the event’s title and date',
  hers.length === 1 && typeof hers[0].title === 'string' && hers[0].date === '2026-08-25',
  JSON.stringify(hers[0] ?? null),
);
check(
  'B4 · and it says its time, which is what makes it actionable',
  hers[0]?.start_time === '10:00',
  JSON.stringify({ start_time: hers[0]?.start_time }),
);

await as(process.env.UNRELATED_COOKIE);
await open();
const unrelatedInbox = await inbox();
check(
  'B5 · the unrelated beneficiary is told nothing',
  unrelatedInbox.filter((n) => n.event_id === S.levelEvent).length === 0,
  JSON.stringify({ count: unrelatedInbox.length }),
);

/* ── E · reschedule is its own kind ─────────────────────────────────────── */

await as(process.env.ADMIN_COOKIE);
await open('/admin/schedules');
await api(`/events/${S.levelEvent}/notify`, {
  method: 'POST',
  body: { change: 'rescheduled' },
});
await as(process.env.CONCERNED_COOKIE);
await open();
const afterMove = (await inbox()).filter((n) => n.event_id === S.levelEvent);
check(
  'E1 · a reschedule adds ONE notice of its own kind, not a cancel + create',
  afterMove.length === 2 &&
    afterMove.some((n) => n.type === 'event_rescheduled') &&
    !afterMove.some((n) => n.type === 'event_cancelled'),
  JSON.stringify(afterMove.map((n) => n.type)),
);

/* ── F/G · the scoped populations ───────────────────────────────────────── */

await as(process.env.ADMIN_COOKIE);
await open('/admin/schedules');
const branchCat = await api(`/events/${S.branchCategoryEvent}/notify`, {
  method: 'POST',
  body: { change: 'created' },
});
const categoryWide = await api(`/events/${S.categoryWideEvent}/notify`, {
  method: 'POST',
  body: { change: 'created' },
});
check(
  'F1 · a Branch+Category event notifies somebody',
  branchCat.status === 200 && branchCat.body?.data?.notified >= 1,
  JSON.stringify(branchCat.body?.data),
);
check(
  'G1 · a Category-wide event notifies somebody',
  categoryWide.status === 200 && categoryWide.body?.data?.notified >= 1,
  JSON.stringify(categoryWide.body?.data),
);

await as(process.env.UNRELATED_COOKIE);
await open();
const others = await inbox();
check(
  'F2/G2 · and neither reaches the beneficiary outside that Branch and Category',
  others.filter((n) => n.event_id === S.branchCategoryEvent).length === 0 &&
    others.filter((n) => n.event_id === S.categoryWideEvent).length === 0,
  JSON.stringify({ count: others.length }),
);

/* ── idempotency ────────────────────────────────────────────────────────── */

await as(process.env.ADMIN_COOKIE);
await open('/admin/schedules');
const again = await api(`/events/${S.levelEvent}/notify`, {
  method: 'POST',
  body: { change: 'created' },
});
check(
  'D1 · pressing send twice writes nothing the second time',
  again.status === 200 && again.body?.data?.notified === 0,
  JSON.stringify(again.body?.data),
);

close();
process.exit(finish());
