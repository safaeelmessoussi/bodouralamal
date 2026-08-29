/**
 * Anonymous browser smoke against the disposable Production-mode deployment.
 *
 * Authentication is deliberately not faked here. The only Production issuer is
 * Google OAuth, so this probe proves the anonymous/same-origin boundary and
 * leaves authenticated Staging E2E blocked on real external credentials. It
 * drives the exact built frontend through TLS Nginx and the real API.
 */
import { connect, results } from '../dev/browser/cdp.mjs';

const base = process.env.APP_BASE;
if (!base?.startsWith('https://')) {
  throw new Error('APP_BASE must name the disposable HTTPS origin');
}

const { send, evaluate, close } = await connect(process.env.PORT);
const { check, finish } = results();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    window.__bodourProbe = { requests: [], errors: [], csp: [], consoleErrors: [] };
    const realFetch = window.fetch;
    window.fetch = async function (input, init) {
      const method = String(init && init.method || 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : input && input.url;
      try {
        const response = await realFetch.apply(this, arguments);
        window.__bodourProbe.requests.push({
          method,
          url: String(url || ''),
          status: response.status,
        });
        return response;
      } catch (error) {
        window.__bodourProbe.requests.push({
          method,
          url: String(url || ''),
          status: 0,
        });
        throw error;
      }
    };
    window.addEventListener('error', (event) => {
      window.__bodourProbe.errors.push(String(event.message || 'window error'));
    });
    window.addEventListener('unhandledrejection', (event) => {
      window.__bodourProbe.errors.push(String(event.reason || 'unhandled rejection'));
    });
    window.addEventListener('securitypolicyviolation', (event) => {
      window.__bodourProbe.csp.push(String(event.violatedDirective || 'unknown'));
    });
    const realConsoleError = console.error;
    console.error = function (...values) {
      window.__bodourProbe.consoleErrors.push(values.map(String).join(' '));
      return realConsoleError.apply(this, values);
    };
  })()`,
});

async function navigate(path, readyExpression = 'true') {
  await send('Page.navigate', { url: `${base}${path}` });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const ready = await evaluate(`(() =>
      document.readyState === 'complete' &&
      Boolean(document.querySelector('#root')) &&
      (${readyExpression})
    )()`).catch(() => false);
    if (ready) {
      await sleep(500);
      return;
    }
    await sleep(100);
  }
  throw new Error(`browser page did not become ready: ${path}`);
}

async function pageSnapshot() {
  return JSON.parse(await evaluate(`JSON.stringify({
    url: location.href,
    body: document.body.innerText,
    dir: document.documentElement.dir,
    lang: document.documentElement.lang,
    requests: window.__bodourProbe.requests,
    errors: window.__bodourProbe.errors,
    csp: window.__bodourProbe.csp,
    consoleErrors: window.__bodourProbe.consoleErrors,
    scripts: performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => name.includes('/assets/') && name.endsWith('.js')),
  })`));
}

await navigate('/login', `document.body.innerText.includes('تسجيل الدخول')`);
const login = await pageSnapshot();
const refreshes = login.requests.filter((request) =>
  request.url.includes('/api/v1/auth/refresh'),
);
const loginForm = JSON.parse(await evaluate(`JSON.stringify({
  passwordInputs: document.querySelectorAll('input[type=password]').length,
  loginHref: document.querySelector('a[href="/api/v1/auth/google"]')?.href || '',
  localStorageKeys: Object.keys(localStorage),
})`));
const shellHeaders = JSON.parse(await evaluate(`(async () => {
  const response = await fetch('/login', { cache: 'no-store' });
  return JSON.stringify({
    status: response.status,
    hsts: response.headers.get('strict-transport-security'),
    csp: response.headers.get('content-security-policy'),
    contentType: response.headers.get('x-content-type-options'),
    cache: response.headers.get('cache-control'),
  });
})()`));
const cookies = (await send('Network.getAllCookies')).cookies ?? [];

check(
  'the built application executes on the exact HTTPS same origin',
  login.url.startsWith(`${base}/login`) && login.scripts.length > 0,
  `${login.url} scripts=${login.scripts.length}`,
);
check(
  'the Production document is Arabic RTL',
  login.dir === 'rtl' && login.lang === 'ar',
  `dir=${login.dir} lang=${login.lang}`,
);
check(
  'the browser receives the required TLS, CSP, MIME and shell-cache headers',
  shellHeaders.status === 200 &&
    shellHeaders.hsts === 'max-age=31536000; includeSubDomains' &&
    shellHeaders.csp?.includes("default-src 'self'") &&
    shellHeaders.csp?.includes("frame-ancestors 'none'") &&
    shellHeaders.contentType === 'nosniff' &&
    shellHeaders.cache === 'no-cache',
  JSON.stringify(shellHeaders),
);
check(
  'login remains Google-only with no password field',
  loginForm.passwordInputs === 0 && loginForm.loginHref === `${base}/api/v1/auth/google`,
  JSON.stringify(loginForm),
);
check(
  'anonymous startup really receives 401 from refresh through the edge',
  refreshes.length > 0 && refreshes.every((request) => request.status === 401),
  JSON.stringify(refreshes),
);
check(
  'anonymous startup stores no credential and renders no raw error envelope',
  !cookies.some((cookie) => cookie.name === 'bodour_refresh') &&
    loginForm.localStorageKeys.length === 0 &&
    !login.body.includes('AUTH_REQUIRED') &&
    !login.body.includes('message_key') &&
    !login.body.includes('request_id'),
  `cookies=${cookies.map((cookie) => cookie.name).join(',')} storage=${loginForm.localStorageKeys.join(',')}`,
);
check(
  'the Production bundle raises no browser or CSP violation on login',
  login.errors.length === 0 && login.csp.length === 0 && login.consoleErrors.length === 0,
  `errors=${JSON.stringify(login.errors)} csp=${JSON.stringify(login.csp)} console=${JSON.stringify(login.consoleErrors)}`,
);

const apiBoundary = JSON.parse(await evaluate(`(async () => {
  const me = await fetch('/api/v1/me');
  const meBody = await me.json();
  const csrf = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: '{}',
  });
  const csrfBody = await csrf.json();
  return JSON.stringify({
    me: { status: me.status, body: meBody },
    csrf: { status: csrf.status, body: csrfBody },
    cors: me.headers.get('access-control-allow-origin'),
    server: me.headers.get('server'),
  });
})()`));
check(
  'anonymous API access fails in the TD-3.8 envelope without CORS',
  apiBoundary.me.status === 401 &&
    apiBoundary.me.body?.error?.code === 'AUTH_REQUIRED' &&
    typeof apiBoundary.me.body?.error?.request_id === 'string' &&
    apiBoundary.me.body.error.request_id.length > 0 &&
    apiBoundary.cors === null,
  JSON.stringify(apiBoundary.me),
);
check(
  'a missing refresh CSRF header discloses no cookie state',
  apiBoundary.csrf.status === 401 &&
    apiBoundary.csrf.body?.error?.code === 'AUTH_REQUIRED' &&
    apiBoundary.csrf.body?.error?.message_key === apiBoundary.me.body?.error?.message_key &&
    typeof apiBoundary.csrf.body?.error?.request_id === 'string' &&
    apiBoundary.csrf.body.error.request_id.length > 0,
  JSON.stringify(apiBoundary.csrf),
);
check(
  'the edge does not disclose an Nginx version',
  apiBoundary.server === 'nginx',
  `server=${apiBoundary.server ?? '<absent>'}`,
);

await navigate('/calendar', `document.body.innerText.includes('الجدول الزمني')`);
const calendar = await pageSnapshot();
check(
  'the public calendar renders from a successful anonymous API read',
  calendar.requests.some((request) =>
    request.url.includes('/api/v1/calendar') && request.status === 200,
  ) && calendar.errors.length === 0 && calendar.csp.length === 0 &&
    calendar.consoleErrors.length === 0,
  JSON.stringify(calendar.requests),
);

await navigate('/resources', `document.body.innerText.includes('المحتوى التعليمي')`);
const resources = await pageSnapshot();
check(
  'the public library renders from a successful anonymous catalogue read',
  resources.requests.some((request) =>
    request.url.includes('/api/v1/library') && request.status === 200,
  ) && resources.errors.length === 0 && resources.csp.length === 0 &&
    resources.consoleErrors.length === 0,
  JSON.stringify(resources.requests),
);

const rateLimit = JSON.parse(await evaluate(`(async () => {
  const responses = [];
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const response = await fetch('/api/v1/auth/google', { method: 'POST' });
    const text = await response.text();
    responses.push({ status: response.status, text });
  }
  return JSON.stringify(responses);
})()`));
const limited = rateLimit.filter((response) => response.status === 429);
let limitedBody = null;
try {
  limitedBody = limited.length > 0 ? JSON.parse(limited[0].text) : null;
} catch {
  limitedBody = null;
}
check(
  'the real Production auth zone rate-limits browser traffic',
  limited.length > 0,
  `statuses=${[...new Set(rateLimit.map((response) => response.status))].join(',')}`,
);
check(
  'the edge-generated rate limit is a traceable TD-3.8 envelope',
  limitedBody?.error?.code === 'RATE_LIMITED' &&
    limitedBody?.error?.message_key === 'errors.rate_limited' &&
    typeof limitedBody?.error?.request_id === 'string' &&
    limitedBody.error.request_id.length > 0,
  JSON.stringify(limitedBody),
);

await navigate('/this-route-does-not-exist', `document.body.innerText.includes('الصفحة غير موجودة')`);
const notFound = await pageSnapshot();
check(
  'an unknown Production route renders the branded not-found page',
  notFound.body.includes('الصفحة غير موجودة') &&
    notFound.errors.length === 0 && notFound.csp.length === 0 &&
    notFound.consoleErrors.length === 0,
  notFound.body.slice(0, 160),
);

close();
process.exit(finish());
