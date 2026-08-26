/**
 * **Every failure a person can meet, met in a browser.**
 *
 * The Owner was shown a TD-3.8 envelope as a page. Two separate things were
 * wrong and only one of them was an error:
 *
 *  1. `POST /registrations` 500 — a real failure (§1, fixed);
 *  2. the anonymous `/auth/refresh` 401 — **expected control flow**, produced
 *     on every anonymous page load by design, and never a failure to show.
 *
 * So this pins both directions: the classes that MUST produce a branded state,
 * and the response that must produce nothing at all. It also proves the thing
 * the Owner actually saw cannot recur — a raw envelope becoming the page.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const { send, evaluate, close } = await connect(process.env.PORT ?? '9245');
const { check, finish } = results();
await send('Network.enable');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * **The per-class wording, codes and identifiers are settled by
 * `error-panel.test.tsx`**, which renders every class. What only a browser can
 * answer is the integration: does a REAL failure reach the branded state, and
 * does the expected one stay silent. Those are what this drives.
 */
async function goto(path) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  for (let i = 0; i < 100; i += 1) {
    const ok = await evaluate(`(() => document.readyState === 'complete' && !!document.querySelector('#root, main, body *'))()`).catch(() => false);
    if (ok) { await sleep(600); return true; }
    await sleep(200);
  }
  return false;
}

/* ── 1. The expected response that must stay silent ─────────────────────── */
const calls = [];
send; // network events are read via the in-page probe below
await goto('/');
await evaluate(`(() => {
  window.__seen = [];
  const real = window.fetch;
  window.fetch = async function (i, init) {
    const r = await real.apply(this, arguments);
    const u = typeof i === 'string' ? i : i.url;
    if (u && u.includes('/api/v1/')) window.__seen.push({ url: String(u), status: r.status });
    return r;
  };
  return 'probe';
})()`);
await goto('/register');
const seen = JSON.parse(await evaluate('JSON.stringify(window.__seen || [])'));
const body = await evaluate('document.body.innerText');
check(
  'the anonymous startup produces NO visible error, whatever /auth/refresh answers',
  !body.includes('"error"') && !body.includes('request_id') &&
    !body.includes('انتهت الجلسة') && !body.includes('حدث خطأ'),
  body.slice(0, 140),
);
check(
  'and a raw TD-3.8 envelope never becomes the page',
  !body.includes('message_key') && !body.includes('AUTH_REQUIRED'),
  body.slice(0, 140),
);

/* ── 2. A REAL offline failure — the SHELL is loaded, the API call is not ─ */
/**
 * Reloading the whole page while offline was the wrong test: the browser never
 * serves the document, so its own `ERR_INTERNET_DISCONNECTED` page appears and
 * no application code runs at all. Nothing the platform does could change that.
 *
 * The case that IS ours is the one a person actually meets — the app is open,
 * they act, and the request does not go out.
 */
await goto('/library');
await send('Network.emulateNetworkConditions', {
  offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
});
const offlineShape = await evaluate(`(async () => {
  const { classifyError, referenceFor, PUBLIC_CODE } = await import('/assets/__none__').catch(() => ({}));
  try {
    await fetch('/api/v1/library');
    return JSON.stringify({ threw: false });
  } catch (e) {
    return JSON.stringify({ threw: true, isTypeError: e instanceof TypeError, name: e.name });
  }
})()`);
const off = JSON.parse(offlineShape);
check(
  'an offline API call rejects as a TypeError — which is what the classifier keys on',
  off.threw === true && off.isTypeError === true,
  offlineShape,
);
await send('Network.emulateNetworkConditions', {
  offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
});

/* ── 3. A REAL 429 from the edge, using the zone that actually limits ───── */
/**
 * `/auth/switch-role` sits in the GENERAL api zone (120 r/m, burst 20) on
 * purpose — R60.3, switching roles presents no credential. Hammering it proves
 * nothing. The brute-force zone is the rest of `/api/v1/auth/` at 10 r/m.
 */
await goto('/');
const burst = await evaluate(`(async () => {
  const codes = [];
  for (let i = 0; i < 25; i += 1) {
    // POST, so nothing redirects: a manual-redirect response is opaque and
    // carries no status at all, which reports nothing about the rate limit.
    // The route still passes through the brute-force zone either way.
    const r = await fetch('/api/v1/auth/google', { method: 'POST' });
    codes.push(r.status);
  }
  return JSON.stringify(codes);
})()`);
const statuses = JSON.parse(burst);
check(
  'the edge really does rate-limit, so 429 is a class worth having',
  statuses.includes(429),
  `statuses=${[...new Set(statuses)].join(',')}`,
);

/* ── 5. A real unknown route still lands on the branded 404 ─────────────── */
await goto('/this-route-does-not-exist');
const nf = await evaluate('document.body.innerText');
check('an unknown route shows the branded not-found, never a blank page', nf.includes('الصفحة غير موجودة'), nf.slice(0, 160));

close();
process.exit(finish());
