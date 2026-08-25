/**
 * **R96 — one stable QR identity per person, seen on the real screens.**
 *
 * Five identities, because the whole claim is that they are all the same kind
 * of person here: a Super Admin, a مؤطِّرة, an adult beneficiary, a guardian, and
 * that guardian's child. Each opens her own account surface and finds her own
 * square — not a beneficiary feature that staff happen to be excluded from.
 *
 * The two properties that would fail silently and are therefore driven rather
 * than reasoned about: **a parent sees HER OWN on `/profile`** while the child's
 * account view shows **the CHILD's**, and neither payload carries a name, a
 * contact detail or a role.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.QR_SCENARIO ?? '{}');
const { send, evaluate, close } = await connect(process.env.PORT ?? '9253');
const { check, finish } = results();

await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false,
});

async function beIdentity(cookie) {
  await send('Network.clearBrowserCookies');
  await send('Network.setCookie', {
    name: 'bodour_refresh', value: cookie,
    domain: 'localhost', path: '/api/v1/auth', httpOnly: true,
  });
}

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

async function open(path, ready = 'main') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 120; i += 1) {
    const ok = await evaluate(
      `(() => document.querySelector(${JSON.stringify(ready)}) !== null)()`,
    ).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 1400));
}

/** What the shared component actually rendered on this screen. */
const qrOnScreen = () => evaluate(`(() => {
  const fig = document.querySelector('.user-qr');
  if (!fig) return { present: false };
  const svg = fig.querySelector('svg[role="img"]');
  return {
    present: true,
    // The modules are real <rect>s, so a blank square cannot pass.
    modules: svg ? svg.querySelectorAll('rect').length : 0,
    label: svg ? svg.getAttribute('aria-label') : null,
    payload: fig.querySelector('.user-qr__payload')?.textContent?.trim() ?? null,
    note: fig.querySelector('.user-qr__note')?.textContent?.trim() ?? null,
    caption: fig.textContent ?? '',
  };
})()`);

await send('Page.navigate', { url: `${BASE}/content-unavailable` });
await new Promise((r) => setTimeout(r, 2500));

/* ── 1–3 · every kind of person reaches one, on the shared surface ───────── */

const seen = {};
for (const [who, cookie] of [
  ['superAdmin', process.env.ADMIN_COOKIE],
  ['teacher', process.env.TEACHER_COOKIE],
  ['adult', process.env.ADULT_COOKIE],
  ['guardian', process.env.GUARDIAN_COOKIE],
]) {
  // eslint-disable-next-line no-await-in-loop
  await tokenFor(cookie);
  // eslint-disable-next-line no-await-in-loop
  await beIdentity(cookie);
  // eslint-disable-next-line no-await-in-loop
  await open('/profile', 'main');
  // eslint-disable-next-line no-await-in-loop
  seen[who] = await qrOnScreen();
}

check(
  '1 · a Super Admin, a مؤطِّرة, an adult beneficiary and a guardian each see one',
  Object.values(seen).every((s) => s.present === true && s.modules > 100),
  JSON.stringify(Object.fromEntries(
    Object.entries(seen).map(([k, v]) => [k, { present: v.present, modules: v.modules }]),
  )),
);

check(
  '2 · every payload is the versioned person scheme, never a beneficiary one',
  Object.values(seen).every(
    (s) => /^bodour:user:v1:[0-9a-f-]{36}$/.test(s.payload ?? ''),
  ) && Object.values(seen).every((s) => !(s.payload ?? '').includes('beneficiary')),
  JSON.stringify(Object.values(seen).map((s) => s.payload)),
);

check(
  '3 · and they are four DIFFERENT identities',
  new Set(Object.values(seen).map((s) => s.payload)).size === 4,
  JSON.stringify(Object.values(seen).map((s) => s.payload)),
);

/* ── 4 · the screen says what it is, and what it is not ─────────────────── */

check(
  '4 · the surface states that it identifies and grants nothing',
  (seen.teacher.note ?? '').includes('للتعريف فقط') &&
    (seen.teacher.note ?? '').includes('لا يمنح'),
  JSON.stringify(seen.teacher.note),
);

/* ── 5–6 · no PII and no role in the payload ────────────────────────────── */

const forbidden = ['teacher', 'student', 'admin', 'super_admin', 'parent',
  'beneficiary', '@', '+212', 'female', 'male'];
check(
  '5 · no payload carries a role, a name, an address or a phone number',
  Object.values(seen).every((s) =>
    forbidden.every((bad) => !(s.payload ?? '').toLowerCase().includes(bad)),
  ),
  JSON.stringify(Object.values(seen).map((s) => s.payload)),
);

const superToken = await tokenFor(process.env.ADMIN_COOKIE);
const profileJson = await evaluate(`(async () => {
  const r = await fetch('/api/v1/profile', {
    headers: { Authorization: 'Bearer ' + ${JSON.stringify(superToken)} },
  });
  return { status: r.status, body: await r.text() };
})()`);
check(
  '6 · the API answers 200 and the QR object holds only a payload and a matrix',
  profileJson.status === 200 &&
    (() => {
      const qr = JSON.parse(profileJson.body).qr;
      return qr && typeof qr.payload === 'string' &&
        Array.isArray(qr.modules) && typeof qr.size === 'number' &&
        Object.keys(qr).sort().join(',') === 'modules,payload,size';
    })(),
  profileJson.body.slice(0, 160),
);

/* ── 7–9 · the parent/child distinction, which must never be silent ─────── */

await tokenFor(process.env.GUARDIAN_COOKIE);
await beIdentity(process.env.GUARDIAN_COOKIE);
await open('/profile', 'main');
const parentOwn = await qrOnScreen();

/**
 * **The guardian's CHILD-CONTEXT request, driven as a request rather than a
 * page** (restated 2026-08-20, after the page proved unreachable).
 *
 * The first version navigated the guardian to `/dashboard/student/account` and
 * read the square off it. That page answers **«ليست لديك صلاحية لعرض هذه
 * الصفحة»** for her: `student-modules.ts` admits `['student']` only, so a
 * `parent`-only account cannot open any student-portal screen — a **pre-existing
 * gate, unrelated to R96**, recorded as a discovered defect rather than widened.
 * **Rule O: never widen a permission to make a check pass.**
 *
 * What R96 actually has to prove is unchanged and is proved here: under child
 * context the server serves **the CHILD's** identity to the guardian, never her
 * own. That is the request the page would have made, made directly — and it
 * still runs the guardian's real token through the real middleware.
 */
const guardianToken = await tokenFor(process.env.GUARDIAN_COOKIE);
await beIdentity(process.env.GUARDIAN_COOKIE);
const childUnderContext = await evaluate(`(async () => {
  const r = await fetch('/api/v1/students/me', {
    headers: {
      Authorization: 'Bearer ' + ${JSON.stringify(guardianToken)},
      'X-Active-Child-ID': ${JSON.stringify(S.child)},
    },
  });
  return { status: r.status, body: await r.text() };
})()`);
const underChildContext = childUnderContext.status === 200
  ? JSON.parse(childUnderContext.body).data ?? JSON.parse(childUnderContext.body)
  : null;

check(
  '7 · a guardian’s own /profile shows HER OWN identity',
  parentOwn.payload === seen.guardian.payload,
  JSON.stringify({ profile: parentOwn.payload, earlier: seen.guardian.payload }),
);
check(
  '8 · under child context she is served the CHILD’s identity, never her own',
  childUnderContext.status === 200 &&
    underChildContext?.qr?.payload !== undefined &&
    underChildContext.qr.payload !== parentOwn.payload,
  JSON.stringify({
    status: childUnderContext.status,
    parent: parentOwn.payload,
    child: underChildContext?.qr?.payload,
  }),
);
check(
  '9 · every square on a real screen is captioned with whose it is',
  (parentOwn.label ?? '').length > 0 &&
    (parentOwn.caption ?? '').includes(parentOwn.label ?? '\u0000'),
  JSON.stringify({ label: parentOwn.label }),
);

/* ── 10 · the child sees the SAME identity logging in herself ───────────── */

await tokenFor(process.env.CHILD_COOKIE);
await beIdentity(process.env.CHILD_COOKIE);
await open('/dashboard/student/account', 'main');
const childHerself = await qrOnScreen();
check(
  '10 · the child logging in herself sees the SAME identity her guardian was served',
  childHerself.payload === underChildContext?.qr?.payload,
  JSON.stringify({
    viaGuardian: underChildContext?.qr?.payload,
    herself: childHerself.payload,
  }),
);

/* ── 11 · it is not a credential ────────────────────────────────────────── */

const ref = (childHerself.payload ?? '').replace('bodour:user:v1:', '');

/**
 * **Every cookie is cleared first, and that is the whole test.**
 *
 * The first run offered the reference as a refresh token *while the child's
 * session cookie was still set*, so `/auth/refresh` answered 200 — from the
 * cookie, not from the reference. It read as "the QR authenticates" and was in
 * fact "the harness was still logged in". A credential test that leaves a
 * credential lying around proves nothing in either direction.
 */
await send('Network.clearBrowserCookies');
const asToken = await evaluate(`(async () => {
  const attempts = [];
  // The payload as a bearer token.
  const a = await fetch('/api/v1/profile', {
    headers: { Authorization: 'Bearer ' + ${JSON.stringify(ref)} },
  });
  attempts.push(a.status);
  // The payload as a refresh cookie value.
  const b = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: ${JSON.stringify(ref)} }),
  });
  attempts.push(b.status);
  return attempts;
})()`);
check(
  '11 · holding the reference authenticates nothing — every attempt is refused',
  Array.isArray(asToken) && asToken.every((s) => s === 401 || s === 400),
  JSON.stringify(asToken),
);

await close();
finish();
