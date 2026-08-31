/**
 * **§14.1's back-office navigation, as a person actually meets it** (R105).
 *
 * ## Why this has to be a browser
 *
 * `admin-modules.test.ts` pins both orders in the registry, and that is a real
 * guard — but it asserts an ARRAY. It cannot see whether the sidebar renders
 * that array, whether a heading appears where no heading should, or what an
 * Admin gets when they type a Super-Admin URL into the address bar. Those are
 * the questions §4 asks, and every one of them is answered by what is on the
 * screen. The lesson is already recorded in `testing.md`: when the property is
 * what a person sees or can do, the test has to be a browser.
 *
 * ## The security half is deliberately NOT a browser check
 *
 * The Owner's requirement is that **hiding a link is never the security
 * control**. A harness that only confirmed the menu was empty would be
 * verifying precisely the thing that is not the boundary. So this file asks the
 * API directly, outside the SPA, with a real Admin session established the way
 * a real one is — refresh cookie, `POST /auth/refresh`, bearer token — and
 * asserts the server refuses. That is what "entering a URL directly" means when
 * the URL is one the client would never send.
 *
 * NEVER put a backtick in page code — see cdp.mjs.
 */
import { connect, newPage, results } from './cdp.mjs';

const BASE = 'http://localhost';
const S = JSON.parse(process.env.R82_SCENARIO ?? '{}');
const SUPER_COOKIE = process.env.SUPER_REFRESH_COOKIE;
const ADMIN_COOKIE = process.env.ADMIN_REFRESH_COOKIE;
/**
 * **Separate sessions for the API probes, and this is not tidiness.**
 *
 * R101 rotates the refresh token on every use, so the moment the browser loads
 * a page the cookie value this process holds is spent — and every probe below
 * came back `401`, which reads exactly like a missing session and is not one.
 * Two more sessions cost one command each and remove the ambiguity entirely.
 */
const SUPER_API_COOKIE = process.env.SUPER_API_COOKIE;
const ADMIN_API_COOKIE = process.env.ADMIN_API_COOKIE;
const ADMIN_RELOGIN_COOKIE = process.env.ADMIN_RELOGIN_COOKIE;
if (!SUPER_COOKIE || !ADMIN_COOKIE || !SUPER_API_COOKIE || !ADMIN_API_COOKIE || !ADMIN_RELOGIN_COOKIE) {
  throw new Error(
    'SUPER_REFRESH_COOKIE, ADMIN_REFRESH_COOKIE, SUPER_API_COOKIE, ADMIN_API_COOKIE and ' +
      'ADMIN_RELOGIN_COOKIE are required',
  );
}

/** The Owner's order, §4. Duplicated from no file on purpose: this harness is
 *  the independent reader, and pinning it against the registry would only prove
 *  the registry agrees with itself. */
const MAIN = [
  ['لوحة التحكم', '/admin'],
  ['طلبات الانضمام', '/admin/approvals'],
  ['المستخدمون', '/admin/users'],
  ['المؤطِّرات', '/admin/teachers'],
  ['المستفيدات', '/admin/enrollments'],
  ['مجموعات المستويات', '/admin/groups'],
  ['حلقات المواد', '/admin/teaching-groups'],
  ['إدخال الحفظ', '/admin/quran'],
  ['نقاط الامتحانات', '/admin/exam-grades'],
  ['الجدولة', '/admin/schedules'],
  ['مكتبة المحتوى', '/admin/content'],
];
/**
 * **What an ADMIN sees: the main list minus المستخدمون** (Owner clarification,
 * 2026-08-28).
 *
 * Global account administration is Super Admin's, so the entry leaves the
 * Admin's menu — while R105's ORDER is untouched and a Super Admin still sees
 * المستخدمون third. This is a change of membership, not of order.
 *
 * The menu is not the enforcement: `listUsers` asserts Super Admin in the
 * service, so an Admin who types the URL is refused by the server. That is
 * asserted with forged requests in the HTTP tests, which a browser check cannot
 * do.
 */
const MAIN_FOR_ADMIN = MAIN.filter(([, href]) => href !== '/admin/users');

const ADMINISTRATION = [
  ['الفئات', '/admin/categories'],
  ['المستويات', '/admin/levels'],
  ['المواد', '/admin/subjects'],
  ['مواد المستوى', '/admin/level-subjects'],
  ['مقرر الحفظ', '/admin/level-surahs'],
  ['الفروع والقاعات', '/admin/branches'],
  ['أنواع الجدولة', '/admin/scheduling-types'],
  // الشركاء (R113) — beside the other catalogue, before the platform-operations
  // tail. R105's sequence is extended, not reinterpreted.
  ['الشركاء', '/admin/partners'],
  ['سلة المحذوفات', '/admin/trash'],
  ['التقويم الهجري', '/superadmin/hijri-calendar'],
  ['إعدادات المنصة', '/superadmin/settings'],
];

const { send, evaluate, close } = await connect(process.env.PORT ?? '9247');
const { check, finish } = results();

const setSession = async (value) => {
  await send('Network.clearBrowserCookies');
  await send('Network.setCookie', {
    name: 'bodour_refresh',
    value,
    url: BASE,
    path: '/api/v1/auth',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  });
};

const goto = async (
  path,
  readiness = `!!document.querySelector('.admin-nav a, .state, .admin-empty')`,
) => {
  await send('Page.navigate', { url: `${BASE}${path}` });
  const expectedPath = new URL(path, BASE).pathname;
  // Wait for the shell to have rendered rather than for a fixed delay: a sleep
  // that reads before React commits is a harness fault that has cost this
  // project several confident wrong answers.
  for (let i = 0; i < 80; i += 1) {
    const ready = await evaluate(
      `document.location.pathname === ${JSON.stringify(expectedPath)} &&
       !document.querySelector('.skeleton') &&
       (${readiness})`,
    );
    if (ready) return;
    await new Promise((r) => setTimeout(r, 100));
  }
};

/** The sidebar exactly as it renders: the flat list, then each group heading
 *  with the items under it. */
const readSidebar = () =>
  evaluate(`(() => {
    const nav = document.querySelector('.admin-nav');
    if (!nav) return null;
    const flat = [...nav.querySelectorAll(':scope > .admin-nav__list a')].map((a) => ({
      text: a.textContent.trim(),
      href: new URL(a.href).pathname,
    }));
    const groups = [...nav.querySelectorAll('.admin-nav__group')].map((g) => ({
      title: g.querySelector('.admin-nav__group-title')?.textContent.trim() ?? '',
      items: [...g.querySelectorAll('a')].map((a) => ({
        text: a.textContent.trim(),
        href: new URL(a.href).pathname,
      })),
    }));
    return { flat, groups };
  })()`);

const readCards = () =>
  evaluate(`[...document.querySelectorAll('.level-grid .level-card')].map((a) => ({
    text: a.querySelector('.level-card__title')?.textContent.trim() ?? '',
    href: new URL(a.href).pathname,
  }))`);

const same = (got, want) => JSON.stringify(got) === JSON.stringify(want);
const labelled = (pairs) => pairs.map(([text, href]) => ({ text, href }));

/* ── Super Admin sees the complete structure, in the Owner's order ───────── */

await setSession(SUPER_COOKIE);
await send('Page.navigate', { url: BASE });
for (let i = 0; i < 80; i += 1) {
  const ready = await evaluate(
    `document.location.pathname === '/' && !!document.querySelector('a[href="/admin"]')`,
  );
  if (ready) break;
  await new Promise((r) => setTimeout(r, 100));
}
const dashboardLink = await evaluate(`(() => {
  const link = document.querySelector('a[href="/admin"]');
  return link ? { href: link.getAttribute('href'), text: link.textContent.trim() } : null;
})()`);
check(
  'Local authenticated root renders the real Dashboard link',
  dashboardLink?.href === '/admin' && dashboardLink.text === 'لوحة التحكم',
  JSON.stringify(dashboardLink),
);
await evaluate(`document.querySelector('a[href="/admin"]')?.click()`);
for (let i = 0; i < 80; i += 1) {
  const ready = await evaluate(
    `document.location.pathname === '/admin' && !!document.querySelector('.admin-nav')`,
  );
  if (ready) break;
  await new Promise((r) => setTimeout(r, 100));
}
const dashboardArrival = await evaluate(`({
  protocol: document.location.protocol,
  path: document.location.pathname,
  shell: !!document.querySelector('.admin-nav'),
  chromeError: document.body?.textContent?.includes('ERR_CONNECTION_CLOSED') ?? false,
})`);
check(
  'clicking Dashboard stays on the live Local HTTP edge (no dead TLS connection)',
  dashboardArrival.protocol === 'http:' &&
    dashboardArrival.path === '/admin' &&
    dashboardArrival.shell &&
    !dashboardArrival.chromeError,
  JSON.stringify(dashboardArrival),
);

await evaluate(`history.back()`);
for (let i = 0; i < 80; i += 1) {
  const ready = await evaluate(
    `document.location.pathname === '/' && !!document.querySelector('a[href="/admin"]')`,
  );
  if (ready) break;
  await new Promise((r) => setTimeout(r, 100));
}
const backArrival = await evaluate(
  `({ protocol: location.protocol, path: location.pathname, dashboard: !!document.querySelector('a[href="/admin"]') })`,
);
check(
  'Back returns to the authenticated Local HTTP page rather than a dead callback/TLS entry',
  backArrival.protocol === 'http:' && backArrival.path === '/' && backArrival.dashboard,
  JSON.stringify(backArrival),
);

await evaluate(`history.forward()`);
for (let i = 0; i < 80; i += 1) {
  const ready = await evaluate(
    `document.location.pathname === '/admin' && !!document.querySelector('.admin-nav')`,
  );
  if (ready) break;
  await new Promise((r) => setTimeout(r, 100));
}
const forwardArrival = await evaluate(
  `({ protocol: location.protocol, path: location.pathname, shell: !!document.querySelector('.admin-nav') })`,
);
check(
  'Forward returns to the authenticated dashboard on Local HTTP',
  forwardArrival.protocol === 'http:' && forwardArrival.path === '/admin' && forwardArrival.shell,
  JSON.stringify(forwardArrival),
);

await send('Page.reload', { ignoreCache: true });
for (let i = 0; i < 80; i += 1) {
  const ready = await evaluate(
    `document.location.pathname === '/admin' && !!document.querySelector('.admin-nav')`,
  );
  if (ready) break;
  await new Promise((r) => setTimeout(r, 100));
}
check(
  'a dashboard reload refreshes the session and remains reachable',
  await evaluate(
    `location.protocol === 'http:' && location.pathname === '/admin' && !!document.querySelector('.admin-nav')`,
  ),
);

const superNav = await readSidebar();
check(
  'Super Admin — the main list is exactly the eleven, in order, with no heading',
  same(superNav?.flat, labelled(MAIN)),
  JSON.stringify(superNav?.flat?.map((i) => i.text)),
);
check(
  'Super Admin — there is exactly ONE group heading, and it is الإدارة',
  superNav?.groups.length === 1 && superNav.groups[0].title === 'الإدارة',
  JSON.stringify(superNav?.groups.map((g) => g.title)),
);
check(
  'Super Admin — الإدارة holds exactly these, in order',
  same(superNav?.groups?.[0]?.items, labelled(ADMINISTRATION)),
  JSON.stringify(superNav?.groups?.[0]?.items?.map((i) => i.text)),
);

const superCards = await readCards();
check(
  'Super Admin — the dashboard cards ARE the menu, same order, minus itself',
  same(superCards, labelled([...MAIN.slice(1), ...ADMINISTRATION])),
  `${superCards?.length ?? 0} cards`,
);

/* ── Admin sees the main list and no الإدارة at all ──────────────────────── */

await setSession(ADMIN_COOKIE);
await goto('/admin');

const adminNav = await readSidebar();
check(
  'Admin — the same order, minus المستخدمون (account administration is Super Admin\'s)',
  same(adminNav?.flat, labelled(MAIN_FOR_ADMIN)),
  JSON.stringify(adminNav?.flat?.map((i) => i.text)),
);
check(
  'Admin — NO group heading renders at all (an empty الإدارة would still be a claim)',
  adminNav?.groups.length === 0,
  JSON.stringify(adminNav?.groups.map((g) => g.title)),
);
const adminHrefs = new Set((adminNav?.flat ?? []).map((i) => i.href));
check(
  'Admin — not one الإدارة destination is linked anywhere in the menu',
  ADMINISTRATION.every(([, href]) => !adminHrefs.has(href)),
);

const adminCards = await readCards();
check(
  'Admin — the dashboard shows exactly what it can open, and no more',
  same(adminCards, labelled(MAIN_FOR_ADMIN.slice(1))),
  `${adminCards?.length ?? 0} cards`,
);

/* ── Typing the URL: the SCREEN refuses, and it is not a blank page ──────── */

for (const [label, path] of ADMINISTRATION) {
  await goto(path);
  const state = await evaluate(`(() => {
    const el = document.querySelector('.state[role="alert"], .admin-empty, .state');
    const nav = document.querySelector('.admin-nav');
    return {
      refused: !!el && /صلاحية|الدور|لا تملك/.test(el.textContent),
      text: el ? el.textContent.trim().slice(0, 60) : null,
      shell: !!nav,
      body: document.body.textContent.trim().length,
    };
  })()`);
  check(
    `Admin at ${path} (${label}) — refused inside the shell, never a blank page`,
    state.refused && state.shell && state.body > 0,
    state.text ?? 'no state element',
  );
}

/* ── And the part that is the actual boundary: the SERVER ────────────────── */

/**
 * A real access token for the Admin, obtained the way the application obtains
 * one — so what follows is not a synthetic token asserting a synthetic rule.
 */
const accessTokenFor = async (cookie) => {
  const res = await fetch(`${BASE}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Origin: BASE,
      Cookie: `bodour_refresh=${cookie}`,
    },
  });
  // `POST /auth/refresh` answers with the token at the TOP level — it is not
  // wrapped in the `{ data }` envelope the resource routes use.
  const body = await res.json();
  return body?.access_token ?? null;
};

const adminToken = await accessTokenFor(ADMIN_API_COOKIE);
check('an Admin session yields a real access token (the probes below are genuine)', Boolean(adminToken));

const api = async (method, path, token, body) => {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.status;
};

// The three nodes whose whole capability is Super Admin.
for (const [label, path] of [
  ['سلة المحذوفات', '/admin/trash'],
  ['التقويم الهجري', '/admin/hijri-calendar?year=1447'],
  ['إعدادات المنصة', '/admin/settings'],
]) {
  const status = await api('GET', path, adminToken);
  check(`server refuses an Admin ${label} outright (403)`, status === 403, `got ${status}`);
}

/**
 * The reference-data nodes, where the READ is deliberately open (R61.2) and the
 * WRITE is not. Both halves are asserted, because the wrong fix for the second
 * is to close the first — and that would break every scope selector on the
 * platform, silently.
 */
const superToken = await accessTokenFor(SUPER_API_COOKIE);
const levelId = S.level ?? null;

for (const [label, path] of [
  ['الفئات', '/admin/categories'],
  ['المستويات', '/admin/levels'],
  ['المواد', '/admin/subjects'],
  ['الفروع والقاعات', '/admin/branches'],
]) {
  const status = await api('GET', path, adminToken);
  check(`server KEEPS ${label} readable to an Admin (R61.2 — selectors feed from it)`, status === 200, `got ${status}`);
}

if (levelId) {
  for (const [label, path] of [
    ['مواد المستوى', `/admin/levels/${levelId}/subjects`],
    ['مقرر الحفظ', `/admin/levels/${levelId}/surahs`],
  ]) {
    check(
      `server KEEPS ${label} readable to an Admin (R61.2)`,
      (await api('GET', path, adminToken)) === 200,
    );
  }
}

/**
 * The writes. A tagged name, so anything that DID get created is identifiable —
 * and the row count is re-read afterwards, because a 403 that had already
 * written would still be a 403.
 */
const countCategories = async () => {
  const res = await fetch(`${BASE}/api/v1/admin/categories`, {
    headers: { Authorization: `Bearer ${superToken}` },
  });
  return (await res.json())?.data?.length ?? -1;
};
const before = await countCategories();
const created = await api('POST', '/admin/categories', adminToken, {
  name: `${S.tag} فئة حدود الإدارة`,
});
check('server refuses an Admin CREATING a Category (403)', created === 403, `got ${created}`);
check('…and no Category was created by the attempt', (await countCategories()) === before);

if (levelId) {
  const put = await api('PUT', `/admin/levels/${levelId}/surahs/1`, adminToken);
  check('server refuses an Admin writing مقرر الحفظ (403)', put === 403, `got ${put}`);
}

const superTrash = await api('GET', '/admin/trash', superToken);
check('…while a Super Admin still reaches سلة المحذوفات (the probes discriminate)', superTrash === 200, `got ${superTrash}`);

/* ── Session lifecycle at the same Local edge ───────────────────────────── */

await goto(
  '/',
  `[...document.querySelectorAll('button.menu__trigger')]
    .some((button) => button.textContent.includes('الحساب'))`,
);
await evaluate(`(() => {
  const account = [...document.querySelectorAll('button.menu__trigger')]
    .find((button) => button.textContent.includes('الحساب'));
  account?.click();
})()`);
for (let i = 0; i < 40; i += 1) {
  if (await evaluate(`!!document.querySelector('.menu__panel')`)) break;
  await new Promise((r) => setTimeout(r, 100));
}
await evaluate(`(() => {
  const logout = [...document.querySelectorAll('.menu__panel button')]
    .find((button) => button.textContent.includes('تسجيل الخروج'));
  logout?.click();
})()`);
for (let i = 0; i < 80; i += 1) {
  const ready = await evaluate(
    `location.pathname === '/' && ` +
      `!!document.querySelector('a[href="/api/v1/auth/google"]') && ` +
      `!document.querySelector('a[href="/admin"]')`,
  );
  if (ready) break;
  await new Promise((r) => setTimeout(r, 100));
}
const logoutState = await evaluate(`({
  protocol: location.protocol,
  path: location.pathname,
  login: !!document.querySelector('a[href="/api/v1/auth/google"]'),
  dashboard: !!document.querySelector('a[href="/admin"]'),
})`);
check(
  'logout revokes the browser session and returns to the reachable anonymous Local page',
  logoutState.protocol === 'http:' &&
    logoutState.path === '/' &&
    logoutState.login &&
    !logoutState.dashboard,
  JSON.stringify(logoutState),
);

await goto('/login?error=state_mismatch', `!!document.querySelector('main.auth-page')`);
const expiredState = await evaluate(`(() => ({
  protocol: location.protocol,
  alert: document.querySelector('[role="alert"]')?.textContent.trim() ?? '',
  retry: document.querySelector('a[href="/api/v1/auth/google"]')?.getAttribute('href') ?? null,
  standalone: !!document.querySelector('main.auth-page') && !document.querySelector('.app-header'),
}))()`);
check(
  'a consumed/expired OAuth callback renders the intentional reachable standalone retry screen',
  expiredState.protocol === 'http:' &&
    expiredState.alert.includes('انتهت صلاحية الجلسة') &&
    expiredState.retry === '/api/v1/auth/google' &&
    expiredState.standalone,
  JSON.stringify(expiredState),
);

await setSession(ADMIN_RELOGIN_COOKIE);
await goto('/', `!!document.querySelector('a[href="/admin"]')`);
check(
  'a newly issued supported Local session can sign in again after logout',
  await evaluate(`location.protocol === 'http:' && !!document.querySelector('a[href="/admin"]')`),
);

const freshTab = await newPage(process.env.PORT ?? '9247');
await freshTab.send('Page.navigate', { url: BASE });
for (let i = 0; i < 80; i += 1) {
  const ready = await freshTab.evaluate(
    `location.pathname === '/' && !!document.querySelector('a[href="/admin"]')`,
  );
  if (ready) break;
  await new Promise((r) => setTimeout(r, 100));
}
check(
  'a fresh tab refreshes the shared Secure session and remains on reachable Local HTTP',
  await freshTab.evaluate(
    `location.protocol === 'http:' && location.pathname === '/' && ` +
      `!!document.querySelector('a[href="/admin"]')`,
  ),
);
freshTab.close();

close();
process.exitCode = finish();
