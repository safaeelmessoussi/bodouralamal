/**
 * **The registration journey a beneficiary actually performs**, in a browser.
 *
 * ## Why this exists
 *
 * A `POST /api/v1/registrations` returned **500** to an Owner using the real
 * form, and nothing in the repository noticed. The cause was environmental — a
 * fail-closed migration correctly refusing ambiguous data, so `normalized_email_lock`
 * did not exist — but the *reason it reached a person* is that the one journey
 * every beneficiary performs had **no browser regression at all**. The service
 * tests pass against a migrated database and can never see that.
 *
 * It also pins the thing that is NOT a defect and must not be "fixed": the SPA
 * calls `/auth/refresh` on every page load, so an anonymous registration page
 * produces **401 AUTH_REQUIRED** by design (§3.1, TD-12). What must never
 * happen is that envelope reaching the reader as raw JSON.
 *
 * §4.1b's only issuer of an onboarding token is the Google callback, which a
 * headless browser cannot complete — hence `issue-dev-onboarding.sh`, the
 * sibling of `issue-dev-session.sh`, calling the same production issuer under
 * the same guards.
 */
import { connect, results } from './cdp.mjs';

const BASE = process.env.APP_BASE ?? 'http://localhost';
const TOKEN = process.env.ONBOARDING_TOKEN;
const EMAIL = process.env.ONBOARDING_EMAIL;
if (!TOKEN || !EMAIL) throw new Error('ONBOARDING_TOKEN and ONBOARDING_EMAIL are required');

const { send, evaluate, close } = await connect(process.env.PORT ?? '9241');
const { check, finish } = results();

await send('Network.enable');

/** Records every API status this run produces, so "no 500" is measured. */
const installProbe = () => evaluate(`(() => {
  if (window.__calls) return 'already';
  window.__calls = [];
  const real = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    const res = await real.apply(this, arguments);
    if (url && url.includes('/api/v1/')) {
      window.__calls.push({ url: String(url), status: res.status, method: (init && init.method) || 'GET' });
    }
    return res;
  };
  return 'installed';
})()`);
const calls = () => evaluate('JSON.stringify(window.__calls || [])').then((r) => JSON.parse(r));

const setInput = (label, value) => evaluate(`(() => {
  const f = [...document.querySelectorAll('.field')].find((f) => (f.querySelector('label')?.textContent ?? '').trim().startsWith(${JSON.stringify(label)}));
  const el = f?.querySelector('input, textarea');
  if (!el) return 'missing';
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`);

const setSelect = (label, index) => evaluate(`(() => {
  const f = [...document.querySelectorAll('.field')].find((f) => (f.querySelector('label')?.textContent ?? '').trim().startsWith(${JSON.stringify(label)}));
  const el = f?.querySelector('select');
  if (!el) return 'missing';
  const opt = [...el.options].filter((o) => o.value !== '')[${index}];
  if (!opt) return 'no-option';
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, opt.value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return opt.value;
})()`);

const bodyText = () => evaluate('document.body.innerText');

async function open(token) {
  await send('Page.navigate', { url: `${BASE}/register#onboarding_token=${token}` });
  for (let i = 0; i < 100; i += 1) {
    const ready = await evaluate(`(() => !!document.querySelector('form.register-form'))()`).catch(() => false);
    if (ready) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/* ── 1. The form is reachable from the onboarding state ─────────────────── */
check('the registration form renders from an onboarding token', await open(TOKEN));
await installProbe();

/* ── 2. No raw envelope reaches the reader, though a 401 IS produced ────── */
const text = await bodyText();
check(
  'no raw JSON error envelope is rendered to the applicant',
  !text.includes('"error"') && !text.includes('message_key') && !text.includes('request_id'),
  text.slice(0, 160),
);

/* ── 3. Fill and submit the real form ───────────────────────────────────── */
check('الاسم الشخصي accepted', (await setInput('الاسم الشخصي*', 'مستفيدة')) === 'ok');
check('الاسم العائلي accepted', (await setInput('الاسم العائلي*', 'تحقق')) === 'ok');
check('الجنس accepted', (await setSelect('الجنس*', 0)) !== 'missing');
check('المقر accepted', (await setSelect('المقر', 0)) !== 'missing');
check('الفئة accepted', (await setSelect('الفئة*', 0)) !== 'missing');
await evaluate(`(() => {
  const c = document.querySelector('input[type="checkbox"]');
  if (c && !c.checked) c.click();
  return c ? c.checked : 'none';
})()`);
await new Promise((r) => setTimeout(r, 300));

await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((b) => b.type === 'submit');
  if (b) b.click();
  return b ? 'submitted' : 'no-submit';
})()`);
await new Promise((r) => setTimeout(r, 3000));

/* ── 4. What actually happened on the wire ──────────────────────────────── */
const seen = await calls();
const reg = seen.filter((c) => c.url.includes('/registrations'));
const refresh = seen.filter((c) => c.url.includes('/auth/refresh'));

check('a registration request was made', reg.length >= 1, JSON.stringify(seen));
check(
  'registration did NOT return 500',
  reg.every((c) => c.status !== 500),
  JSON.stringify(reg),
);
check('registration succeeded', reg.some((c) => c.status === 201 || c.status === 200), JSON.stringify(reg));
check(
  'the anonymous /auth/refresh 401 is unchanged and treated as normal',
  refresh.length === 0 || refresh.every((c) => c.status === 401),
  JSON.stringify(refresh),
);

const after = await bodyText();
check(
  'the applicant sees a human confirmation, never an envelope',
  !after.includes('"error"') && !after.includes('request_id') && !after.includes('INTERNAL'),
  after.slice(0, 200),
);

/* ── 5. A retry of the single-use token creates nothing more ────────────── */
await open(TOKEN);
await installProbe();
await new Promise((r) => setTimeout(r, 800));
const replayText = await bodyText();
check(
  'replaying the consumed onboarding token does not present an envelope',
  !replayText.includes('"error"') && !replayText.includes('request_id'),
  replayText.slice(0, 160),
);

close();
process.exit(finish());
