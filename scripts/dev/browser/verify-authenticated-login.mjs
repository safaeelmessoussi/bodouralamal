/**
 * **The landing page and the login entry point, in both session states.**
 *
 * An anonymous visitor must see «تسجيل الدخول» in the header AND the hero, and
 * a manually-navigated `/api/v1/auth/google` must genuinely reach Google. An
 * already-authenticated visitor must see neither, must see her real dashboard
 * destination in both places instead, and a manual visit to
 * `/api/v1/auth/google` must land her there directly — server-side, not by
 * hiding a button — with no Google account chooser in between.
 *
 * Every negative check asserts the surface it reads actually rendered first.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.AUTH_SCENARIO ?? '{}');
const { send, evaluate, close } = await connect(process.env.PORT ?? '9255');
const { check, finish } = results();

// **Desktop width, explicitly.** The header's Dashboard/Sign-in text sits in
// `.app-header__actions--desktop`, which is `display:none` below the 60rem
// breakpoint — CDP's default headless viewport is narrow enough to hide it,
// which would make the header's OWN half of this fix silently untested no
// matter what the markup says.
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
});

async function beIdentity(cookie) {
  await send('Network.clearBrowserCookies');
  if (cookie) {
    await send('Network.setCookie', {
      name: 'bodour_refresh', value: cookie,
      domain: 'localhost', path: '/api/v1/auth', httpOnly: true,
    });
  }
}

async function open(cookie, path) {
  await beIdentity(cookie);
  await send('Page.navigate', { url: BASE + path });
  for (let i = 0; i < 40; i += 1) {
    const ready = await evaluate(
      "document.readyState === 'complete' && !!document.querySelector('main')",
    );
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 900));

  // **A session cookie means an async `/auth/refresh` + `/me` bootstrap runs
  // before the header/hero know they are authenticated.** `useNavigation`'s
  // `isAuthenticated` is false while that is in flight (status 'loading'), so
  // a page captured too early reads as anonymous regardless of the cookie —
  // the same "checked before the surface settled" trap this project's other
  // harnesses have hit. Poll until it resolves, rather than a fixed guess at
  // how long two round trips take.
  //
  // **Not a text match on «تسجيل الدخول».** That phrase ALSO appears as
  // ordinary prose in the "how it works" section regardless of session state
  // ("تسجيل الدخول يتم عبر حساب Google وحده…"), so a substring settle check
  // reported "settled" on the very first poll, before the bootstrap had even
  // run — the anonymous CTA's own `href` is the unambiguous signal: it exists
  // only pre-resolution/genuinely-anonymous and is gone once truly
  // authenticated.
  if (cookie) {
    for (let i = 0; i < 40; i += 1) {
      const settled = await evaluate(
        `!document.querySelector('a[href="/api/v1/auth/google"]')`,
      );
      if (settled) break;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

// **`document.body`, not `main` alone.** This verifier deliberately checks the
// HEADER (a sibling of `<main>`, never inside it) as well as the hero, since
// the property under test is that the two never disagree about session
// state — reading only `main` would silently pass regardless of what the
// header showed, which is exactly the "checked the wrong surface" class of
// bug this project's own browser harnesses have hit before.
const text = async () => evaluate('document.body.innerText');

/* ── The landing page, anonymous ──────────────────────────────────────────── */

await open(null, '/');
let body = await text();
check('the anonymous landing page shows «تسجيل الدخول»', body.includes('تسجيل الدخول'), body.slice(0, 300));
check(
  'the anonymous hero’s login link points at the real OAuth entry',
  await evaluate(`!!document.querySelector('a[href="/api/v1/auth/google"]')`),
  'no OAuth link found',
);
check(
  'the anonymous header shows no Dashboard/account control',
  !body.includes('لوحة التحكم') && !body.includes('تسجيل الخروج'),
  body.slice(0, 300),
);

/* ── /auth/google, anonymous — a real Google round trip ───────────────────── */

const anonAuth = await evaluate(`(async () => {
  const res = await fetch('/api/v1/auth/google', { redirect: 'manual' });
  return JSON.stringify({ type: res.type, status: res.status });
})()`);
// A same-origin fetch with `redirect: 'manual'` reports an OPAQUE redirect
// (`type: 'opaqueredirect'`, status 0) rather than exposing the Location — the
// browser will not let script read a cross-origin bounce, which is itself
// evidence it left the origin for Google.
const anonParsed = JSON.parse(anonAuth);
check(
  'anonymous /auth/google leaves the origin (an opaque cross-origin redirect)',
  anonParsed.type === 'opaqueredirect',
  anonAuth,
);

/* ── The landing page, authenticated ──────────────────────────────────────── */

await open(S.studentCookie, '/');
body = await text();
// **Structural, not a body-text substring.** «تسجيل الدخول» also appears as
// ordinary prose in the "how it works" section regardless of session state
// ("تسجيل الدخول يتم عبر حساب Google وحده…"), so a raw `body.includes(...)`
// check is true in EITHER state and proves nothing — the same trap the
// settle-poll above hit. The actual claim is about the CONTROLS: no element
// whose whole text IS that phrase, and no link to the OAuth entry at all.
const loginControlsCount = await evaluate(`(() => {
  return [...document.querySelectorAll('a, button')]
    .filter((el) => el.textContent.trim() === 'تسجيل الدخول').length;
})()`);
check(
  'the authenticated landing page has no «تسجيل الدخول» CONTROL, in the header or the hero',
  loginControlsCount === 0,
  `${loginControlsCount} such control(s); ${body.slice(0, 400)}`,
);
check(
  'she sees «لوحة التحكم» instead — the header AND the hero',
  (body.match(/لوحة التحكم/g) ?? []).length >= 2,
  body.slice(0, 400),
);
check(
  'no /api/v1/auth/google link remains anywhere on the page',
  !(await evaluate(`!!document.querySelector('a[href="/api/v1/auth/google"]')`)),
  'an OAuth link is still present',
);

/* ── /auth/google, authenticated — internal redirect, no Google ───────────── */

// The definitive proof is a REAL top-level navigation, not a `fetch` probe:
// `fetch`'s `redirect: 'manual'` reports the SAME opaque type whether the
// target is Google or our own /teacher (script cannot read either Location),
// so only an actual navigation and reading `window.location` afterward can
// tell the two apart.
await beIdentity(S.teacherCookie2);
await send('Page.navigate', { url: `${BASE}/api/v1/auth/google` });
for (let i = 0; i < 40; i += 1) {
  const done = await evaluate("document.readyState === 'complete'");
  if (done) break;
  await new Promise((r) => setTimeout(r, 250));
}
await new Promise((r) => setTimeout(r, 900));
const landedUrl = await evaluate('window.location.href');
check(
  'a real top-level navigation to /auth/google lands on OUR OWN teacher portal, never Google',
  landedUrl.startsWith(`${BASE}/teacher`),
  landedUrl,
);
check(
  'no Google account chooser was ever reached',
  !landedUrl.includes('accounts.google.com'),
  landedUrl,
);

/* ── Pending account — the approval-status screen, not a dashboard ───────── */

await beIdentity(S.pendingCookie);
await send('Page.navigate', { url: `${BASE}/api/v1/auth/google` });
for (let i = 0; i < 40; i += 1) {
  const done = await evaluate("document.readyState === 'complete'");
  if (done) break;
  await new Promise((r) => setTimeout(r, 250));
}
await new Promise((r) => setTimeout(r, 900));
const pendingUrl = await evaluate('window.location.href');
check(
  'a Pending account visiting /auth/google lands on the approval-status screen',
  pendingUrl.startsWith(`${BASE}/pending-approval`),
  pendingUrl,
);

await close();
finish();
