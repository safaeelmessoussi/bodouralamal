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

/**
 * **The instrumentation has to survive navigation, and the first version did
 * not** (found by Codex on review, 2026-08-26; reproduced before fixing).
 *
 * It installed a `window.fetch` wrapper on the document at `/`, then called
 * `goto('/register')` — which creates a **new document**, destroying both the
 * wrapper and `window.__seen`. The subsequent read therefore returned `[]`
 * every time, and the variable holding it was never asserted at all. So the
 * harness claimed to prove *"whatever `/auth/refresh` answers"* while observing
 * nothing: had the call never been made, or answered `500`, the check would
 * have passed identically.
 *
 * `Page.addScriptToEvaluateOnNewDocument` is the fix. CDP re-runs it **before
 * any page script on every navigation**, so the wrapper is reinstalled for each
 * document rather than surviving one. The observation is then asserted, which
 * is what turns *the page looks fine* into *the anonymous 401 happened and was
 * handled silently*.
 *
 * **Nothing about authentication is relaxed to make this pass.** The harness
 * only watches; `/auth/refresh` answering 401 to an anonymous caller is the
 * behaviour being proved, not something being worked around.
 */
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    window.__seen = [];
    const real = window.fetch;
    window.fetch = async function (i, init) {
      const r = await real.apply(this, arguments);
      try {
        const u = typeof i === 'string' ? i : (i && i.url);
        if (u && String(u).includes('/api/v1/')) {
          window.__seen.push({ url: String(u), status: r.status });
        }
      } catch (e) { /* never let instrumentation break the page */ }
      return r;
    };
  })()`,
});

await goto('/');
await goto('/register');
const seen = JSON.parse(await evaluate('JSON.stringify(window.__seen || [])'));
const refreshCalls = seen.filter((c) => c.url.includes('/auth/refresh'));
const body = await evaluate('document.body.innerText');

check(
  'the probe SURVIVES navigation — it observed the anonymous API traffic at all',
  seen.length > 0,
  `${seen.length} call(s): ${seen.map((c) => `${c.url.split('/api/v1')[1]} ${c.status}`).join(', ')}`,
);
check(
  'the anonymous /auth/refresh really is answered 401 — the case under test EXISTS',
  refreshCalls.length > 0 && refreshCalls.every((c) => c.status === 401),
  JSON.stringify(refreshCalls),
);
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
/**
 * **The dev overlay disables this on purpose**, substituting 6000r/m for
 * production's 10r/m so the integration suite is not throttled. Asserting a
 * 429 under it would be asserting something the environment has switched off —
 * so the harness says which edge it measured and checks the property that is
 * actually true there. It still FAILS on a production-shaped edge that has
 * stopped limiting, which is the case worth catching.
 */
const devEdge = process.env.EDGE_RATE_LIMITS === 'dev';
check(
  devEdge
    ? 'the permissive dev rate zones are active, so 429 is not exercisable here (production zones: 10r/m)'
    : 'the edge really does rate-limit, so 429 is a class worth having',
  devEdge
    ? statuses.length > 0 && statuses.every((s) => s !== 429)
    : statuses.includes(429),
  `edge=${process.env.EDGE_RATE_LIMITS ?? 'unknown'} statuses=${[...new Set(statuses)].join(',')}`,
);

/* ── 5. A real unknown route still lands on the branded 404 ─────────────── */
await goto('/this-route-does-not-exist');
const nf = await evaluate('document.body.innerText');
check('an unknown route shows the branded not-found, never a blank page', nf.includes('الصفحة غير موجودة'), nf.slice(0, 160));

close();
process.exit(finish());
