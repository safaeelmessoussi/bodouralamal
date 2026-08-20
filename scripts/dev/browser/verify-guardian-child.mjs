/**
 * **A guardian reaches her child's account, through the real interface**
 * (R96.1, §4.3).
 *
 * The gap this closes was never about the QR. `role-home.ts` sends a parent to
 * `/dashboard/student` and records that *"the active role decides whether it
 * renders their own record or their child's"* — while `canAccess` refused her
 * there, so a **parent-only** account selecting a child was navigated straight
 * into «ليست لديك صلاحية لعرض هذه الصفحة» and every beneficiary screen was
 * unreachable to her.
 *
 * Everything here is driven the way a guardian drives it: open the account
 * switcher, click a child, read the page. **No API call substitutes for a
 * click** — the previous harness proved the server served the child's identity
 * and that was exactly the thing that did not amount to a working feature.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const S = JSON.parse(process.env.QR_SCENARIO ?? '{}');
const { send, evaluate, close } = await connect(process.env.PORT ?? '9255');
const { check, finish } = results();

await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false,
});

async function beIdentity(cookie) {
  await send('Network.clearBrowserCookies');
  await send('Network.setCookie', {
    name: 'bodour_refresh', value: cookie,
    domain: 'localhost', path: '/api/v1/auth/refresh', httpOnly: true,
  });
}

/**
 * **One refresh cookie, one consumer** (TD-4.13, and `testing.md` records it).
 *
 * The app refreshes on every boot and rotates the cookie as it does. Minting a
 * bearer from the *same* cookie the browser is driving makes two consumers of
 * one token, reuse detection fires, and the session is revoked — which shows up
 * several checks later as a blank page, not as an auth error. So the UI phases
 * below **never** call this: they set a cookie and let the app do its own
 * refresh. It is used once, on a SEPARATE session issued for the API phase.
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

async function open(path, ready = 'main') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 120; i += 1) {
    const ok = await evaluate(
      `(() => document.querySelector(${JSON.stringify(ready)}) !== null)()`,
    ).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 1500));
}

/**
 * Open the account switcher and click a child by NAME, as a person would.
 *
 * **The click must not be awaited inside the page.** Choosing a child calls
 * `switchRole` and then `window.location.assign`, so the execution context is
 * destroyed mid-`await` and the evaluation never resolves — it returns
 * `undefined`, which reads as *the menu had no such child* rather than as *the
 * navigation worked*. So the click returns immediately and the settle happens
 * out here, where a page load cannot interrupt it.
 */
async function chooseChild(nameFragment) {
  const opened = await evaluate(`(() => {
    const trigger = [...document.querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').includes('اختر الدور الذي تعمل به'));
    if (!trigger) {
      return { noTrigger: true, buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 12) };
    }
    trigger.click();
    return { opened: true };
  })()`);
  if (!opened?.opened) return { ...opened, chose: false };

  await new Promise((r) => setTimeout(r, 900));

  const clicked = await evaluate(`(() => {
    const options = [...document.querySelectorAll('[role="menuitem"], .menu button, .menu a')]
      .filter((el) => (el.textContent ?? '').includes(${JSON.stringify(nameFragment)}));
    if (options.length === 0) {
      return {
        noOption: true,
        menu: [...document.querySelectorAll('[role="menuitem"], .menu button')]
          .map((b) => b.textContent.trim()).slice(0, 12),
      };
    }
    options[0].click();
    return { clicked: true };
  })()`);
  if (!clicked?.clicked) return { ...clicked, chose: false };

  // The switch is a full page load; wait for it out here.
  await new Promise((r) => setTimeout(r, 4500));
  const landedOn = await evaluate(`(() => window.location.pathname)()`);
  return { chose: true, landedOn };
}

/** What the beneficiary account screen is showing, and for whom. */
const accountScreen = () => evaluate(`(() => {
  const fig = document.querySelector('.user-qr');
  const svg = fig?.querySelector('svg[role="img"]');
  return {
    path: window.location.pathname,
    refused: (document.body.textContent ?? '').includes('ليست لديك صلاحية'),
    nav: [...document.querySelectorAll('.admin-nav a')].map((a) => a.textContent.trim()),
    qrPresent: fig !== null,
    modules: svg ? svg.querySelectorAll('rect').length : 0,
    label: svg ? svg.getAttribute('aria-label') : null,
    payload: fig?.querySelector('.user-qr__payload')?.textContent?.trim() ?? null,
    body: (document.querySelector('main')?.textContent ?? '').slice(0, 200),
  };
})()`);

await send('Page.navigate', { url: `${BASE}/content-unavailable` });
await new Promise((r) => setTimeout(r, 2500));

/* ── 1–2 · the parent's OWN identity, before any child is chosen ─────────── */

await beIdentity(process.env.GUARDIAN_COOKIE);
await open('/profile', 'main');
const parentOwn = await accountScreen();
check(
  '1 · a parent-only account sees HER OWN QR in her own profile',
  parentOwn.qrPresent === true && /^bodour:user:v1:/.test(parentOwn.payload ?? ''),
  JSON.stringify({ payload: parentOwn.payload, label: parentOwn.label }),
);

/* ── 3–6 · she chooses a child in the switcher and lands on her record ───── */

const chose = await chooseChild('لينا');
check(
  '2 · the account switcher offers her linked child, and choosing navigates',
  chose.chose === true,
  JSON.stringify(chose).slice(0, 300),
);

await open('/dashboard/student/account', 'main');
const firstChild = await accountScreen();

check(
  '3 · she reaches حسابي — no longer «ليست لديك صلاحية لعرض هذه الصفحة»',
  firstChild.refused === false && firstChild.qrPresent === true,
  JSON.stringify({ refused: firstChild.refused, body: firstChild.body.slice(0, 120) }),
);
check(
  '4 · and the beneficiary menu is there, so every screen is reachable, not just this one',
  firstChild.nav.length >= 5,
  JSON.stringify(firstChild.nav),
);
check(
  '5 · the square shown is the CHILD’s, and is captioned with the child’s name',
  firstChild.payload !== parentOwn.payload &&
    (firstChild.label ?? '').includes('لينا'),
  JSON.stringify({ parent: parentOwn.payload, child: firstChild.payload, label: firstChild.label }),
);
check(
  '6 · and it encodes THAT child’s own user_qr_ref',
  firstChild.payload === `bodour:user:v1:${S.childQr}`,
  JSON.stringify({ onScreen: firstChild.payload, expected: `bodour:user:v1:${S.childQr}` }),
);

/* ── 7–8 · switching to the SECOND child switches the person ─────────────── */

const chose2 = await chooseChild('سارة');
await open('/dashboard/student/account', 'main');
const secondChild = await accountScreen();
check(
  '7 · switching context switches the person — the second child’s own identity',
  chose2.chose === true &&
    secondChild.payload === `bodour:user:v1:${S.child2Qr}` &&
    secondChild.payload !== firstChild.payload,
  JSON.stringify({ first: firstChild.payload, second: secondChild.payload }),
);
check(
  '8 · and the caption follows the person, so it is never unclear whose it is',
  (secondChild.label ?? '').includes('سارة'),
  JSON.stringify({ label: secondChild.label }),
);

/* ── 9 · back to her own profile — her own, distinct, unchanged ──────────── */

await open('/profile', 'main');
const parentAgain = await accountScreen();
check(
  '9 · her own profile still shows HER OWN QR, distinct from both children',
  parentAgain.payload === parentOwn.payload &&
    parentAgain.payload !== firstChild.payload &&
    parentAgain.payload !== secondChild.payload,
  JSON.stringify({ parent: parentAgain.payload }),
);

/* ── 10–11 · forgery and revocation, refused by the EXISTING rules ───────── */

// A SECOND session for the same guardian, so the API phase does not consume
// the cookie the browser has been driving.
const guardianToken = await tokenFor(process.env.GUARDIAN_API_COOKIE);
const forged = await evaluate(`(async () => {
  const ask = async (childId) => {
    const r = await fetch('/api/v1/students/me', {
      headers: {
        Authorization: 'Bearer ' + ${JSON.stringify(guardianToken)},
        'X-Active-Child-ID': childId,
      },
    });
    return r.status;
  };
  return {
    unrelated: await ask(${JSON.stringify(S.outsider)}),
    revoked: await ask(${JSON.stringify(S.revokedChild)}),
  };
})()`);
check(
  '10 · forging an UNRELATED child’s id is refused — the link is what is checked',
  forged.unrelated === 403 || forged.unrelated === 404,
  JSON.stringify(forged),
);
check(
  '11 · a REVOKED FamilyLink is refused too, by the same existing rule',
  forged.revoked === 403 || forged.revoked === 404,
  JSON.stringify(forged),
);

/* ── 12 · and neither child is even offered in the switcher ──────────────── */

await open('/profile', 'main');
const offered = await evaluate(`(async () => {
  const r = await fetch('/api/v1/me', {
    headers: { Authorization: 'Bearer ' + ${JSON.stringify(guardianToken)} },
  });
  const body = await r.json();
  return { status: r.status, links: (body.approved_child_links ?? []).map((c) => c.display_name) };
})()`);
check(
  '12 · /me offers exactly the two live links — never the revoked or unrelated child',
  offered.status === 200 &&
    offered.links.length === 2 &&
    offered.links.some((n) => n.includes('لينا')) &&
    offered.links.some((n) => n.includes('سارة')) &&
    !offered.links.some((n) => n.includes('نور')) &&
    !offered.links.some((n) => n.includes('هند')),
  JSON.stringify(offered),
);

await close();
finish();
